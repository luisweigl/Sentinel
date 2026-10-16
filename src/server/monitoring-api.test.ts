import { authenticate, testAuthConfig } from './auth.test-support.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { createService, saveCheckResult } from './persistence.js';

test('monitoring routes validate windows, pagination, timestamps, and service identity', async (t) => {
  const database = openDatabase(':memory:');
  const service = createService(database, {
    name: 'API',
    url: 'http://localhost',
  });
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
  await authenticate(t, `http://127.0.0.1:${address.port}`);
  const base = `http://127.0.0.1:${address.port}/api/services`;
  for (const query of [
    'window=bad',
    'window=24h&window=7d',
    'to=-1',
    'to=bad',
    'to=',
    `to=${Date.now() + 86400000}`,
    'to=9007199254740992',
  ]) {
    assert.equal((await fetch(`${base}/overview?${query}`)).status, 400, query);
    assert.equal(
      (await fetch(`${base}/${service.id}/history?${query}`)).status,
      400,
      query,
    );
  }
  for (const page of [
    '0',
    '-1',
    '1.5',
    'x',
    '9007199254740992',
    '9007199254740991',
  ])
    assert.equal(
      (await fetch(`${base}/${service.id}/history?page=${page}`)).status,
      400,
    );
  assert.equal((await fetch(`${base}/0/history`)).status, 400);
  assert.equal((await fetch(`${base}/999/history`)).status, 404);
  const now = Date.now() - 1;
  saveCheckResult(database, {
    serviceId: service.id,
    healthy: true,
    checkedAt: now - 86400000,
  });
  saveCheckResult(database, {
    serviceId: service.id,
    healthy: false,
    checkedAt: now,
  });
  const response = await fetch(
    `${base}/${service.id}/history?window=24h&to=${now}`,
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    uptime: { totalChecks: number; uptimePercent: number | null };
    history: { total: number };
    latestResult: { healthy: boolean };
  };
  assert.equal(body.uptime.totalChecks, 1);
  assert.equal(body.uptime.uptimePercent, 100);
  assert.equal(body.history.total, 1);
  assert.equal(body.latestResult.healthy, false);
});
