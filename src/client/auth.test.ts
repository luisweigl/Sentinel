import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthForm, validateAuth } from './AuthForm';

const fields = {
  username: ' Admin ',
  password: 'a long passphrase',
  setupToken: 'token',
  confirmation: 'a long passphrase',
};
test('login and setup validation preserve passwords and report field errors', () => {
  assert.deepEqual(validateAuth(fields, true), {});
  assert.deepEqual(
    validateAuth({ ...fields, username: '', password: '' }, false),
    { username: 'Enter your username.', password: 'Enter your password.' },
  );
  const errors = validateAuth(
    {
      ...fields,
      username: 'a b',
      password: 'short',
      setupToken: '',
      confirmation: 'different',
    },
    true,
  );
  for (const name of ['username', 'password', 'setupToken', 'confirmation'])
    assert.ok(errors[name]);
  assert.deepEqual(
    validateAuth(
      { ...fields, password: '🙂'.repeat(15), confirmation: '🙂'.repeat(15) },
      true,
    ),
    {},
  );
});
test('mock login and setup forms expose accessible fields and actions', async () => {
  // Mock submission is deliberately independent of the backend while building the forms.
  const onSubmit = async () => {
    throw new Error('Invalid username or password.');
  };
  const login = renderToStaticMarkup(createElement(AuthForm, { onSubmit }));
  assert.match(login, /aria-labelledby="auth-title"/);
  assert.match(login, /autoComplete="current-password"/i);
  assert.match(login, /for="auth-username"/);
  assert.match(login, /type="submit"[^>]*>Sign in/);
  assert.doesNotMatch(login, /Confirm password|Setup token/);
  const setup = renderToStaticMarkup(
    createElement(AuthForm, { setup: true, onSubmit }),
  );
  assert.match(setup, /Create administrator/);
  assert.match(setup, /Confirm password/);
  assert.match(setup, /Setup token/);
  assert.match(setup, /15–128/);
  const unavailable = renderToStaticMarkup(
    createElement(AuthForm, { setup: true, setupEnabled: false, onSubmit }),
  );
  assert.match(unavailable, /role="alert"/);
  assert.doesNotMatch(unavailable, /<form/);
});

import { once } from 'node:events';
import { createApp } from '../server/app';
import { openDatabase } from '../server/database';
import {
  setupToken,
  testAuthConfig,
  credentials,
} from '../server/auth.test-support';
import {
  authReducer,
  initialAuthState,
  loadSession,
  signIn,
  signOut,
} from './auth-api';
import { ApiError } from './http';
import { loadOverview, onUnauthorized } from './api';

test('auth state gates loading, failures, login, expiry, focus rechecks and logout', () => {
  assert.equal(initialAuthState.checking, true);
  const session = {
    authenticated: true,
    setupRequired: false,
    setupEnabled: false,
    user: { username: 'admin' },
  };
  const loggedIn = authReducer(initialAuthState, { type: 'session', session });
  assert.equal(loggedIn.session?.authenticated, true);
  assert.equal(loggedIn.checking, false);
  const expired = authReducer(loggedIn, { type: 'expired' });
  assert.equal(expired.session?.authenticated, false);
  assert.equal(expired.notice, 'Your session has expired.');
  assert.equal(
    authReducer(loggedIn, {
      type: 'session',
      session: { ...session, authenticated: false, user: null },
    }).notice,
    expired.notice,
  );
  assert.equal(authReducer(loggedIn, { type: 'logout' }).notice, '');
  const failed = authReducer(loggedIn, { type: 'error', error: 'Offline' });
  assert.equal(failed.session, null);
  assert.equal(failed.error, 'Offline');
  assert.equal(authReducer(failed, { type: 'checking' }).checking, true);
});

test('real setup/login-to-dashboard and logout flow carries cookie and CSRF header', async (t) => {
  const database = openDatabase(':memory:');
  const server = createApp(database, undefined, testAuthConfig).listen(
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
  const original = globalThis.fetch;
  let cookie = '';
  // Node has no browser cookie jar: emulate transport while exercising real client API functions.
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      headers.set('Cookie', cookie);
      headers.set('Origin', testAuthConfig.publicOrigin);
      const response = await original(`${origin}${input}`, {
        ...options,
        headers,
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return response;
    },
  );
  assert.equal((await loadSession()).setupRequired, true);
  await signIn({ ...credentials, setupToken }, true);
  assert.equal((await loadSession()).authenticated, true);
  assert.deepEqual(await loadOverview('24h'), []);
  await signOut();
  assert.equal((await loadSession()).authenticated, false);
  await assert.rejects(
    signIn({ ...credentials, password: 'wrong password' }, false),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
  await signIn(credentials, false);
  assert.deepEqual(await loadOverview('24h'), []);
  await signOut();
  let expired = 0;
  const unsubscribe = onUnauthorized(() => {
    expired++;
  });
  t.after(unsubscribe);
  await assert.rejects(
    loadOverview('24h'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
  assert.equal(expired, 1);
});

test('client propagates rate-limit and network errors without expiring valid authentication', async (t) => {
  let expired = 0;
  const unsubscribe = onUnauthorized(() => {
    expired++;
  });
  t.after(unsubscribe);
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: 'Too many attempts. Try again in 900 seconds.',
        }),
        { status: 429 },
      ),
  );
  await assert.rejects(signIn(credentials, false), /900 seconds/);
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ error: 'Invalid username or password.' }), {
        status: 401,
      }),
  );
  await assert.rejects(signIn(credentials, false), /Invalid username/);
  assert.equal(expired, 0);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Network unavailable');
  });
  await assert.rejects(signIn(credentials, false), /Network unavailable/);
});
