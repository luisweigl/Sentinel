import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../server/app';
import { openDatabase } from '../server/database';
import { checkService } from '../server/health-checker';
import { getService, saveCheckResult } from '../server/persistence';
import {
  createService,
  loadHistory,
  loadOverview,
  relativeTime,
  removeService,
  toCheck,
  toService,
  updateService,
} from './api';
import { ServiceDetail } from './ServiceDetail';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// Exercise the same relative requests as the browser against a real API and temporary SQLite DB.
test('UI API flow creates, monitors, edits, pauses, resumes, pages history, and deletes a service', async (t) => {
  const database = openDatabase(':memory:');
  const target = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  const server = createApp(database).listen(0, '127.0.0.1');
  target.listen(0, '127.0.0.1');
  t.after(async () => {
    await Promise.all(
      [server, target].map(
        (item) => new Promise<void>((resolve) => item.close(() => resolve())),
      ),
    );
    database.close();
  });
  await Promise.all([once(server, 'listening'), once(target, 'listening')]);
  const address = server.address();
  const targetAddress = target.address();
  assert.ok(address && typeof address !== 'string');
  assert.ok(targetAddress && typeof targetAddress !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    'fetch',
    (input: string | URL | Request, init?: RequestInit) =>
      originalFetch(
        typeof input === 'string' && input.startsWith('/api/')
          ? `${origin}${input}`
          : input,
        init,
      ),
  );

  assert.deepEqual(await loadOverview('24h'), []);
  const stored = await createService({
    name: 'Local API',
    url: `http://127.0.0.1:${targetAddress.port}/health`,
    intervalSeconds: 30,
    timeoutSeconds: 2,
    enabled: true,
  });
  assert.equal(stored.intervalMs, 30_000);
  assert.equal(stored.timeoutMs, 2000);
  let [view] = await loadOverview('24h');
  assert.equal(view.status, 'pending');
  assert.equal(view.uptimePercent, null);
  assert.equal((await loadHistory(stored.id, '24h', 1)).total, 0);

  saveCheckResult(database, await checkService(stored));
  const anchor = Date.now() + 1;
  await new Promise((resolve) => setTimeout(resolve, 3));
  [view] = await loadOverview('24h');
  assert.equal(view.status, 'healthy');
  assert.equal(view.result, '204');
  assert.equal(view.uptimePercent, 100);
  assert.ok(view.durationMs !== null && view.durationMs >= 0);
  for (let index = 1; index <= 8; index++)
    saveCheckResult(database, {
      serviceId: stored.id,
      checkedAt: anchor - index * 1000,
      healthy: index % 2 === 0,
      httpStatus: index % 2 === 0 ? 200 : 503,
      responseTimeMs: 12,
    });
  const first = await loadHistory(stored.id, '24h', 1);
  const second = await loadHistory(stored.id, '24h', 2, undefined, first.asOf);
  assert.equal(first.results.length, 6);
  assert.equal(second.results.length, 3);
  assert.equal(first.total, 9);
  assert.equal(first.successful, 5);
  assert.equal(first.uptime, (5 / 9) * 100);
  assert.equal(second.asOf, first.asOf);
  assert.equal(
    new Set([...first.results, ...second.results].map((check) => check.id))
      .size,
    9,
  );
  assert.equal(
    first.results.find((check) => check.httpStatus === 503)?.error,
    'HTTP 503',
  );

  const updated = await updateService({
    ...view,
    name: 'Updated API',
    intervalSeconds: 0.5,
    timeoutSeconds: 1.5,
    status: 'paused',
  });
  assert.equal(updated.enabled, false);
  assert.equal(getService(database, stored.id)?.intervalMs, 500);
  [view] = await loadOverview('24h');
  assert.equal(view.name, 'Updated API');
  assert.equal(view.status, 'paused');
  assert.equal(view.result, '204');
  assert.equal((await loadHistory(stored.id, '30d', 1)).total, 9);
  await updateService({ ...view, status: 'healthy' });
  assert.equal(getService(database, stored.id)?.enabled, true);
  await removeService(stored.id);
  assert.deepEqual(await loadOverview('24h'), []);
  await assert.rejects(loadHistory(stored.id, '24h', 1), /Service not found/);
  await assert.rejects(updateService(view), /Service not found/);
});

test('API errors reach the UI and cancellation remains an AbortError', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ error: 'Database unavailable' }), {
        status: 500,
      }),
  );
  await assert.rejects(loadOverview('24h'), /Database unavailable/);
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('Bad gateway', { status: 502 }),
  );
  await assert.rejects(loadOverview('24h'), /Request failed \(502\)/);
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: unknown, init: RequestInit) => {
      init.signal?.throwIfAborted();
      throw new Error('Network unavailable');
    },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadOverview('24h', controller.signal), {
    name: 'AbortError',
  });
  await assert.rejects(loadOverview('24h'), /Network unavailable/);
});

test('stored results preserve unknown measurements and independently represent paused monitoring', () => {
  const stored = {
    id: 1,
    name: 'API',
    url: 'http://localhost',
    intervalMs: 60000,
    timeoutMs: 10000,
    enabled: false,
    createdAt: 1,
  };
  const check = toCheck({
    id: 2,
    serviceId: 1,
    checkedAt: 1,
    healthy: false,
    httpStatus: null,
    responseTimeMs: 10001,
    error: 'Check timed out after 10000 ms',
  });
  const service = toService(stored, check, null);
  assert.equal(service.status, 'paused');
  assert.equal(service.result, 'Timeout');
  assert.equal(service.durationMs, 10001);
  assert.equal(service.uptimePercent, null);
  assert.equal(
    toService({ ...stored, enabled: true }, check).status,
    'failing',
  );
  const html = renderToStaticMarkup(
    createElement(ServiceDetail, {
      service,
      onClose() {},
      onUpdate() {},
      onDelete() {},
    }),
  );
  assert.match(html, /Resume monitoring/);
  assert.match(html, /Check timed out after 10000 ms/);
  assert.match(html, /Loading history/);
  assert.match(html, /<strong>—<\/strong>/);
});

test('relative check ages handle empty, fresh, and older timestamps', () => {
  assert.equal(relativeTime(undefined, 1000), 'Never');
  assert.equal(relativeTime(1000, 1000), 'Just now');
  assert.equal(relativeTime(1000, 2000), '1 second ago');
  assert.equal(relativeTime(1000, 121000), '2 minutes ago');
});
