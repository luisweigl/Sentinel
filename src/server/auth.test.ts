import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import {
  cleanExpiredSessions,
  digest,
  resetAdministratorPassword,
  SESSION_MS,
} from './auth.js';
import { readAuthConfig, type AuthConfig } from './auth-config.js';
import {
  credentials,
  csrfHeaders,
  setupToken,
  testAuthConfig,
} from './auth.test-support.js';
import { hashPassword, verifyPassword } from './passwords.js';

async function fixture(
  t: TestContext,
  config: AuthConfig = testAuthConfig,
  path = ':memory:',
) {
  const database = openDatabase(path);
  let now = Date.now();
  const server = createApp(database, undefined, config, () => now).listen(
    0,
    '127.0.0.1',
  );
  t.after(
    () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          database.close();
          resolve();
        }),
      ),
  );
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (
    path: string,
    body?: unknown,
    cookie = '',
    extra: Record<string, string> = {},
  ) =>
    fetch(`${origin}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...csrfHeaders, Cookie: cookie, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const setup = () => request('/auth/setup', { ...credentials, setupToken });
  return {
    database,
    request,
    setup,
    origin,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const cookieOf = (response: Response) =>
  response.headers.get('set-cookie')!.split(';')[0];

test('setup creates one administrator and stores only salted hashes and session digests', async (t) => {
  const { database, request, setup } = await fixture(t);
  assert.deepEqual(await (await request('/auth/session')).json(), {
    authenticated: false,
    setupRequired: true,
    setupEnabled: true,
    user: null,
  });
  assert.equal(
    (await request('/auth/setup', { ...credentials, setupToken: 'bad' }))
      .status,
    403,
  );
  const response = await setup();
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { user: { username: 'admin' } });
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(response.headers.get('set-cookie')!, /SameSite=Lax/);
  assert.match(response.headers.get('set-cookie')!, /Max-Age=604800/);
  assert.doesNotMatch(response.headers.get('set-cookie')!, /Secure|Domain=/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const cookie = cookieOf(response);
  const row = database.prepare('SELECT * FROM administrator').get()!;
  assert.notEqual(row.password_hash, credentials.password);
  assert.ok(
    await verifyPassword(credentials.password, row.password_hash as string),
  );
  const session = database.prepare('SELECT * FROM sessions').get()!;
  assert.equal(session.token_hash, digest(cookie.split('=')[1]));
  assert.equal(
    Number(session.expires_at) - Number(session.created_at),
    SESSION_MS,
  );
  assert.throws(() =>
    database
      .prepare('INSERT INTO administrator VALUES (2, ?, ?, 0)')
      .run('other', 'hash'),
  );
  assert.equal((await setup()).status, 409);
  assert.equal((await request('/auth/session', undefined, cookie)).status, 200);
  assert.deepEqual(
    await (await request('/auth/session', undefined, cookie)).json(),
    {
      authenticated: true,
      setupRequired: false,
      setupEnabled: false,
      user: { username: 'admin' },
    },
  );
});

test('setup configuration, strict fields, malformed JSON, content type and body size', async (t) => {
  const { request, origin } = await fixture(t, {
    ...testAuthConfig,
    setupToken: undefined,
  });
  assert.equal(
    (await request('/auth/setup', { ...credentials, setupToken })).status,
    503,
  );
  assert.equal((await request('/auth/session')).status, 200);
  for (const body of [
    null,
    [],
    {},
    { ...credentials, extra: true },
    { ...credentials, username: 'a b' },
    { ...credentials, password: 5 },
    { ...credentials, password: 'x'.repeat(129) },
  ])
    assert.equal((await request('/auth/login', body)).status, 400);
  assert.equal(
    (
      await fetch(`${origin}/api/auth/setup`, {
        method: 'POST',
        headers: csrfHeaders,
        body: '{bad',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/auth/setup`, {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({ data: 'x'.repeat(5000) }),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'X-Sentinel-Request': '1' },
        body: '{}',
      })
    ).status,
    415,
  );
});

test('all service endpoints require authentication; health stays public; mutations reject CSRF', async (t) => {
  const { origin, request, setup } = await fixture(t);
  for (const [path, method] of [
    ['/services', 'GET'],
    ['/services', 'POST'],
    ['/services/overview', 'GET'],
    ['/services/1/history', 'GET'],
    ['/services/1', 'PATCH'],
    ['/services/1', 'DELETE'],
  ]) {
    for (const cookie of [
      '',
      'sentinel_session=invalid',
      `sentinel_session=${'A'.repeat(43)}`,
    ]) {
      const response = await fetch(`${origin}/api${path}`, {
        method,
        headers: { ...csrfHeaders, Cookie: cookie },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      assert.equal(response.status, 401);
    }
  }
  assert.equal((await request('/health')).status, 200);
  const cookie = cookieOf(await setup());
  for (const [path, method] of [
    ['/auth/logout', 'POST'],
    ['/auth/login', 'POST'],
    ['/auth/setup', 'POST'],
    ['/services', 'POST'],
    ['/services/1', 'PATCH'],
    ['/services/1', 'DELETE'],
  ]) {
    for (const headers of [
      { 'Content-Type': 'application/json', Cookie: cookie },
      { ...csrfHeaders, Cookie: cookie, Origin: 'https://attacker.test' },
    ]) {
      assert.equal(
        (await fetch(`${origin}/api${path}`, { method, headers, body: '{}' }))
          .status,
        403,
      );
    }
  }
  assert.equal((await request('/services', undefined, cookie)).status, 200);
});

test('login credentials, cookie replacement, fixed expiry boundary and idempotent logout', async (t) => {
  const { request, setup, advance, database } = await fixture(t);
  const original = cookieOf(await setup());
  const wrong = await request('/auth/login', {
    ...credentials,
    password: 'wrong password',
  });
  assert.equal(wrong.status, 401);
  const unknown = await request('/auth/login', {
    ...credentials,
    username: 'unknown',
  });
  assert.equal(unknown.status, 401);
  assert.deepEqual(await unknown.json(), await wrong.json());
  const login = await request(
    '/auth/login',
    { ...credentials, username: ' ADMIN ' },
    original,
  );
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  assert.notEqual(cookie, original);
  assert.equal((await request('/services', undefined, original)).status, 401);
  advance(SESSION_MS - 1);
  assert.equal((await request('/services', undefined, cookie)).status, 200);
  advance(1);
  assert.equal((await request('/services', undefined, cookie)).status, 401);
  cleanExpiredSessions(database, Date.now() + SESSION_MS + 10_000);
  assert.equal(
    database.prepare('SELECT count(*) AS n FROM sessions').get()?.n,
    0,
  );
  const fresh = cookieOf(await request('/auth/login', credentials));
  const logout = await request('/auth/logout', {}, fresh);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/services', undefined, fresh)).status, 401);
  assert.equal((await request('/auth/logout', {}, fresh)).status, 204);
});

test('concurrent setup has one winner; password reset preserves username and revokes sessions', async (t) => {
  const { setup, request, database } = await fixture(t);
  const responses = await Promise.all([setup(), setup()]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  const cookie = cookieOf(
    responses.find((response) => response.status === 201)!,
  );
  await assert.rejects(resetAdministratorPassword(database, 'short'));
  assert.equal((await request('/services', undefined, cookie)).status, 200);
  const pending = request('/auth/login', credentials);
  await resetAdministratorPassword(database, 'another long passphrase');
  await pending;
  assert.equal((await request('/services', undefined, cookie)).status, 401);
  assert.equal(
    database.prepare('SELECT count(*) AS n FROM sessions').get()?.n,
    0,
  );
  assert.equal((await request('/auth/login', credentials)).status, 401);
  assert.equal(
    (
      await request('/auth/login', {
        ...credentials,
        password: 'another long passphrase',
      })
    ).status,
    200,
  );
});

test('sessions and credentials persist across SQLite connections', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sentinel-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'auth.sqlite');
  const first = await fixture(t, testAuthConfig, path);
  const cookie = cookieOf(await first.setup());
  const second = await fixture(t, testAuthConfig, path);
  assert.equal(
    (await second.request('/services', undefined, cookie)).status,
    200,
  );
  assert.equal((await second.setup()).status, 409);
});

test('rate limits reset after 15 minutes and include Retry-After', async (t) => {
  const { request, advance } = await fixture(t);
  for (let i = 0; i < 10; i++)
    assert.equal((await request('/auth/login', {})).status, 400);
  const response = await request('/auth/login', {});
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
  advance(15 * 60 * 1000);
  assert.equal((await request('/auth/login', {})).status, 400);
});

test('proxy-aware global limit and concurrent hashing limit reject excess work', async (t) => {
  const { request, setup } = await fixture(t, {
    ...testAuthConfig,
    trustProxyHops: 1,
  });
  await setup();
  const attempts = await Promise.all(
    [1, 2, 3].map((i) =>
      request('/auth/login', credentials, '', {
        'X-Forwarded-For': `192.0.2.${i}`,
      }),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 200, 429]);
  for (let i = 0; i < 46; i++)
    assert.equal(
      (
        await request('/auth/login', {}, '', {
          'X-Forwarded-For': `192.0.2.${i + 4}`,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request('/auth/login', {}, '', {
        'X-Forwarded-For': '198.51.100.1',
      })
    ).status,
    429,
  );
});

test('production configuration defaults to secure cookies and validates settings', async (t) => {
  const config = readAuthConfig({
    NODE_ENV: 'production',
    SENTINEL_PUBLIC_ORIGIN: 'https://sentinel.test',
    SENTINEL_SETUP_TOKEN: setupToken,
  });
  const { setup } = await fixture(t, config);
  assert.match((await setup()).headers.get('set-cookie')!, /; Secure/);
  for (const env of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', SENTINEL_PUBLIC_ORIGIN: 'http://sentinel.test' },
    { SENTINEL_SETUP_TOKEN: 'weak' },
    { SENTINEL_TRUST_PROXY_HOPS: '-1' },
    { SENTINEL_PUBLIC_ORIGIN: 'http://localhost:5173/' },
    { SENTINEL_ALLOW_HTTP: 'yes' },
  ])
    assert.throws(() => readAuthConfig(env));
  assert.equal(
    readAuthConfig({
      NODE_ENV: 'production',
      SENTINEL_PUBLIC_ORIGIN: 'http://sentinel.test',
      SENTINEL_ALLOW_HTTP: 'true',
    }).secureCookie,
    false,
  );
  assert.equal(await verifyPassword('incorrect password'), false);
  assert.notEqual(
    await hashPassword(credentials.password),
    await hashPassword(credentials.password),
  );
  const empty = openDatabase(':memory:');
  try {
    await assert.rejects(
      resetAdministratorPassword(empty, credentials.password),
      /No administrator/,
    );
  } finally {
    empty.close();
  }
});
