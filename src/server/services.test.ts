import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { getService, type Service } from './persistence.js';

async function assertError(response: Response): Promise<void> {
  const body: unknown = await response.json();
  assert.ok(body && typeof body === 'object' && 'error' in body);
  assert.equal(typeof body.error, 'string');
}

async function setup(t: TestContext) {
  const database = openDatabase(':memory:');
  const server = createApp(database).listen(0, '127.0.0.1');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          database.close();
          error ? reject(error) : resolve();
        });
      }),
  );
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/api/services`;
  const request = (method: string, path = '', body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { database, baseUrl, request };
}

test('service API creates, lists, edits, disables/enables, and deletes persisted services', async (t) => {
  const { database, request } = await setup(t);
  const empty = await request('GET');
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), []);

  const created = await request('POST', '', {
    name: ' Example ',
    url: ' https://example.test/ ',
  });
  assert.equal(created.status, 201);
  const service = (await created.json()) as Service;
  assert.equal(service.name, 'Example');
  assert.equal(service.url, 'https://example.test/');
  assert.equal(service.intervalMs, 60000);
  assert.equal(service.timeoutMs, 10000);
  assert.equal(service.enabled, true);
  assert.ok(Number.isSafeInteger(service.id) && service.id > 0);
  assert.ok(service.createdAt > 0);
  assert.deepEqual(getService(database, service.id), service);

  const custom = await request('POST', '', {
    name: 'Private',
    url: 'http://127.0.0.1:8080/ready',
    intervalMs: 30000,
    timeoutMs: 5000,
    enabled: false,
  });
  assert.equal(custom.status, 201);
  const other = (await custom.json()) as Service;
  assert.equal(other.enabled, false);
  assert.equal(other.intervalMs, 30000);
  assert.equal(other.timeoutMs, 5000);

  const edited = await request('PATCH', `/${service.id}`, {
    name: 'Renamed',
    url: 'http://localhost:8080',
    intervalMs: 15000,
    timeoutMs: 1000,
  });
  assert.equal(edited.status, 200);
  const updated = (await edited.json()) as Service;
  assert.deepEqual(updated, {
    ...service,
    name: 'Renamed',
    url: 'http://localhost:8080',
    intervalMs: 15000,
    timeoutMs: 1000,
  });
  for (const enabled of [false, true]) {
    const toggled = await request('PATCH', `/${service.id}`, { enabled });
    assert.equal(toggled.status, 200);
    assert.deepEqual(await toggled.json(), { ...updated, enabled });
  }
  assert.deepEqual(await (await request('GET')).json(), [updated, other]);
  const deleted = await request('DELETE', `/${service.id}`);
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  assert.equal(getService(database, service.id), undefined);
  assert.deepEqual(await (await request('GET')).json(), [other]);
});

test('service API rejects invalid bodies without creating or changing services', async (t) => {
  const { database, request } = await setup(t);
  const valid = { name: 'Example', url: 'https://example.test' };
  const invalidFields = [
    { name: '' },
    { name: '  ' },
    { name: 123 },
    { name: null },
    { url: '' },
    { url: null },
    { url: 123 },
    { url: '/relative' },
    { url: 'invalid' },
    { url: 'ftp://example.test' },
    { intervalMs: 0 },
    { intervalMs: -1 },
    { intervalMs: 1.5 },
    { intervalMs: '1000' },
    { intervalMs: null },
    { intervalMs: Number.MAX_SAFE_INTEGER + 1 },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 0.5 },
    { timeoutMs: '1000' },
    { timeoutMs: null },
    { timeoutMs: Number.MAX_SAFE_INTEGER + 1 },
    { enabled: 1 },
    { enabled: 'true' },
    { enabled: null },
    { id: 10 },
    { createdAt: 0 },
    { unexpected: true },
  ];
  for (const fields of invalidFields) {
    const response = await request('POST', '', { ...valid, ...fields });
    assert.equal(response.status, 400, JSON.stringify(fields));
    await assertError(response);
  }
  for (const body of [
    {},
    { name: 'Missing URL' },
    { url: valid.url },
    [],
    null,
    'text',
    1,
  ]) {
    const response = await request('POST', '', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    await assertError(response);
  }
  assert.deepEqual(await (await request('GET')).json(), []);

  const created = await request('POST', '', valid);
  const service = (await created.json()) as Service;
  for (const body of [...invalidFields, {}, [], null, 'text', 1]) {
    const response = await request('PATCH', `/${service.id}`, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    await assertError(response);
    assert.deepEqual(getService(database, service.id), service);
  }
});

test('service API validates IDs and reports missing services', async (t) => {
  const { request } = await setup(t);
  for (const method of ['PATCH', 'DELETE']) {
    for (const id of [
      '0',
      '-1',
      '1.5',
      'abc',
      '1abc',
      '01',
      '9007199254740992',
    ]) {
      const response = await request(
        method,
        `/${id}`,
        method === 'PATCH' ? { enabled: false } : undefined,
      );
      assert.equal(response.status, 400, `${method} ${id}`);
      await assertError(response);
    }
    const missing = await request(
      method,
      '/999',
      method === 'PATCH' ? { enabled: false } : undefined,
    );
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Service not found' });
  }
  const created = await request('POST', '', {
    name: 'Example',
    url: 'https://example.test',
  });
  const { id } = (await created.json()) as Service;
  assert.equal((await request('DELETE', `/${id}`)).status, 204);
  assert.equal((await request('DELETE', `/${id}`)).status, 404);
  assert.equal(
    (await request('PATCH', `/${id}`, { enabled: false })).status,
    404,
  );
});

test('service API returns JSON errors for malformed, missing, oversized, and non-JSON bodies', async (t) => {
  const { baseUrl, request } = await setup(t);
  for (const method of ['POST', 'PATCH']) {
    const url = method === 'POST' ? baseUrl : `${baseUrl}/1`;
    const malformed = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'Invalid JSON body' });
    const missing = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(missing.status, 400);
    await assertError(missing);
    const wrongType = await fetch(url, { method, body: 'name=Example' });
    assert.equal(wrongType.status, 415);
    await assertError(wrongType);
    const oversized = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x'.repeat(110000),
        url: 'http://localhost',
      }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), {
      error: 'Request body too large',
    });
  }
  assert.deepEqual(await (await request('GET')).json(), []);
});
