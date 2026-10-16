import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { AuthConfig } from './auth-config.js';

export const setupToken = Buffer.alloc(32, 42).toString('base64url');
export const testAuthConfig: AuthConfig = {
  publicOrigin: 'http://localhost:5173',
  secureCookie: false,
  setupToken,
  trustProxyHops: 0,
};
export const credentials = {
  username: 'admin',
  password: 'a long test passphrase',
};
export const csrfHeaders = {
  'Content-Type': 'application/json',
  'X-Sentinel-Request': '1',
};

export async function authenticate(
  t: TestContext,
  origin: string,
): Promise<string> {
  const response = await fetch(`${origin}/api/auth/setup`, {
    method: 'POST',
    headers: csrfHeaders,
    body: JSON.stringify({ ...credentials, setupToken }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const original = globalThis.fetch;
  t.mock.method(
    globalThis,
    'fetch',
    (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith(`${origin}/api/`)) {
        const headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined),
        );
        headers.set('Cookie', cookie);
        headers.set('X-Sentinel-Request', '1');
        return original(input, { ...init, headers });
      }
      return original(input, init);
    },
  );
  return cookie;
}
