import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Service } from './App';
import { ServiceDetail } from './ServiceDetail';
import {
  createHistory,
  historyForWindow,
  historyPage,
  snapshotTime,
  summarizeHistory,
} from './service-history';

const service: Service = {
  id: 1,
  name: 'Authentication',
  url: 'https://auth.example.com/health',
  status: 'failing',
  result: 'Timeout',
  durationMs: null,
  lastChecked: '9 seconds ago',
  intervalSeconds: 60,
};

test('history windows include boundaries and exclude future and older checks', () => {
  const check = createHistory(service)[0];
  const history = [
    { ...check, checkedAt: snapshotTime },
    { ...check, checkedAt: snapshotTime - 86_400_000 },
    { ...check, checkedAt: snapshotTime - 86_400_001 },
    { ...check, checkedAt: snapshotTime + 1 },
  ];
  assert.deepEqual(historyForWindow(history, '24h'), history.slice(0, 2));
  assert.equal(historyForWindow(createHistory(service), '24h').length, 12);
  assert.equal(historyForWindow(createHistory(service), '7d').length, 24);
  assert.equal(historyForWindow(createHistory(service), '30d').length, 36);
});

test('uptime counts failures and timeouts while empty history stays unknown', () => {
  const check = createHistory(service)[0];
  assert.deepEqual(summarizeHistory([]), {
    successful: 0,
    total: 0,
    uptime: null,
  });
  assert.deepEqual(
    summarizeHistory([
      { ...check, result: 'Healthy' },
      { ...check, result: 'Failed' },
      check,
      { ...check, result: 'Healthy' },
    ]),
    { successful: 2, total: 4, uptime: 50 },
  );
});

test('history pages preserve newest-first order without duplicates', () => {
  const history = historyForWindow(createHistory(service), '24h');
  assert.equal(history[0].httpStatus, null);
  assert.equal(history[0].durationMs, null);
  assert.equal(history[0].checkedAt, snapshotTime - 9000);
  assert.deepEqual(
    [...historyPage(history, 1), ...historyPage(history, 2)],
    history,
  );
  assert.deepEqual(historyPage(history, 3), []);
  assert.ok(
    history.every(
      (check, index) =>
        index === 0 || check.checkedAt < history[index - 1].checkedAt,
    ),
  );
});

test('detail renders failure information, configuration and bounded history', () => {
  const html = renderToStaticMarkup(
    createElement(ServiceDetail, {
      service,
      history: createHistory(service),
      onClose() {},
      onUpdate() {},
      onDelete() {},
    }),
  );
  assert.match(html, /Request exceeded the configured timeout/);
  assert.match(html, /Pause monitoring/);
  assert.match(html, /Edit service/);
  assert.match(html, /Delete service/);
  assert.match(html, /10 seconds/);
  assert.match(html, /Page 1 of 2/);
  assert.equal((html.match(/<time /g) ?? []).length, 6);
});

test('pending detail has no invented uptime and paused detail retains its last failure', () => {
  const pending = {
    ...service,
    status: 'pending' as const,
    result: 'Awaiting check',
  };
  assert.deepEqual(createHistory(pending), []);
  const emptyHtml = renderToStaticMarkup(
    createElement(ServiceDetail, {
      service: pending,
      history: [],
      onClose() {},
      onUpdate() {},
      onDelete() {},
    }),
  );
  assert.match(emptyHtml, /No checks recorded yet/);
  assert.match(emptyHtml, /<strong>—<\/strong>/);
  assert.equal((emptyHtml.match(/disabled=""/g) ?? []).length, 2);
  const paused = {
    ...service,
    id: 6,
    status: 'paused' as const,
    result: '503 Unavailable',
    durationMs: 220,
  };
  const pausedHtml = renderToStaticMarkup(
    createElement(ServiceDetail, {
      service: paused,
      history: createHistory(paused),
      onClose() {},
      onUpdate() {},
      onDelete() {},
    }),
  );
  assert.match(pausedHtml, /Resume monitoring/);
  assert.match(pausedHtml, /503 Unavailable/);
});
