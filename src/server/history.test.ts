import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { openDatabase } from './database.js';
import {
  createService, deleteCheckResultsBefore, getCheckHistory, getLatestCheckResult,
  getService, getServiceUptime, listLatestCheckResults, saveCheckResult,
} from './persistence.js';

function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-history-'));
  const path = join(directory, 'sentinel.sqlite');
  const database = openDatabase(path);
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const service = createService(database, { name: 'Example', url: 'http://example.test' });
  return { database, service, path };
}

test('latest results select by timestamp and ID for each service with history', (t) => {
  const { database, service } = setup(t);
  const other = createService(database, { name: 'Other', url: 'http://other.test', enabled: false });
  const empty = createService(database, { name: 'Empty', url: 'http://empty.test' });
  assert.deepEqual(listLatestCheckResults(database), []);
  const otherResult = saveCheckResult(database, { serviceId: other.id, checkedAt: 3000, healthy: true });
  saveCheckResult(database, { serviceId: service.id, checkedAt: 2000, healthy: true });
  saveCheckResult(database, { serviceId: service.id, checkedAt: 1000, healthy: true });
  const latest = saveCheckResult(database, {
    serviceId: service.id, checkedAt: 2000, healthy: false, error: 'Connection refused',
  });
  assert.deepEqual(listLatestCheckResults(database), [latest, otherResult]);
  assert.deepEqual(getLatestCheckResult(database, service.id), latest);
  assert.equal(getLatestCheckResult(database, empty.id), undefined);
});

test('uptime includes the start, excludes the end, and isolates service history', (t) => {
  const { database, service } = setup(t);
  const other = createService(database, { name: 'Other', url: 'http://other.test' });
  for (const [checkedAt, healthy] of [[999, false], [1000, true], [1500, false], [1999, true], [2000, false]] as const) {
    saveCheckResult(database, { serviceId: service.id, checkedAt, healthy });
  }
  saveCheckResult(database, { serviceId: other.id, checkedAt: 1500, healthy: false });
  const summary = getServiceUptime(database, service.id, { from: 1000, to: 2000 });
  assert.deepEqual(summary, {
    from: 1000, to: 2000, totalChecks: 3, healthyChecks: 2, unhealthyChecks: 1,
    uptimePercent: 2 / 3 * 100,
  });
});

test('uptime counts HTTP, timeout, and connection failures as unhealthy samples', (t) => {
  const { database, service } = setup(t);
  saveCheckResult(database, { serviceId: service.id, checkedAt: 100, healthy: false, httpStatus: 503 });
  saveCheckResult(database, { serviceId: service.id, checkedAt: 200, healthy: false, error: 'Check timed out' });
  saveCheckResult(database, { serviceId: service.id, checkedAt: 300, healthy: false, error: 'Connection refused' });
  assert.deepEqual(getServiceUptime(database, service.id, { from: 0, to: 400 }), {
    from: 0, to: 400, totalChecks: 3, healthyChecks: 0, unhealthyChecks: 3, uptimePercent: 0,
  });
  saveCheckResult(database, { serviceId: service.id, checkedAt: 400, healthy: true, httpStatus: 200 });
  assert.equal(getServiceUptime(database, service.id, { from: 400, to: 500 }).uptimePercent, 100);
  assert.equal(getServiceUptime(database, service.id, { from: 0, to: 500 }).uptimePercent, 25);
});

test('empty history and empty windows have unknown uptime and empty pages', (t) => {
  const { database, service } = setup(t);
  const window = { from: 0, to: 1000 };
  const empty = { ...window, totalChecks: 0, healthyChecks: 0, unhealthyChecks: 0, uptimePercent: null };
  assert.deepEqual(getServiceUptime(database, service.id, window), empty);
  assert.deepEqual(getServiceUptime(database, service.id + 1, window), empty);
  assert.deepEqual(getCheckHistory(database, service.id), { results: [], total: 0, limit: 50, offset: 0 });
  assert.deepEqual(getCheckHistory(database, service.id + 1), { results: [], total: 0, limit: 50, offset: 0 });
  saveCheckResult(database, { serviceId: service.id, healthy: true, checkedAt: 500 });
  assert.deepEqual(getServiceUptime(database, service.id, { from: 500, to: 500 }), {
    from: 500, to: 500, totalChecks: 0, healthyChecks: 0, unhealthyChecks: 0, uptimePercent: null,
  });
  assert.equal(getCheckHistory(database, service.id, { window: { from: 500, to: 500 } }).total, 0);
  assert.equal(getServiceUptime(database, service.id, { from: 501, to: 1000 }).uptimePercent, null);
});

test('history pages are newest first with stable ties and retain complete failure details', (t) => {
  const { database, service } = setup(t);
  const older = saveCheckResult(database, { serviceId: service.id, checkedAt: 1000, healthy: true });
  const firstTie = saveCheckResult(database, {
    serviceId: service.id, checkedAt: 2000, healthy: false, httpStatus: 503, responseTimeMs: 15.5,
  });
  const secondTie = saveCheckResult(database, {
    serviceId: service.id, checkedAt: 2000, healthy: false, error: 'Check timed out after 1000 ms',
    responseTimeMs: 1001,
  });
  const newest = saveCheckResult(database, { serviceId: service.id, checkedAt: 3000, healthy: true });
  const other = createService(database, { name: 'Other', url: 'http://other.test' });
  saveCheckResult(database, { serviceId: other.id, checkedAt: 4000, healthy: false });
  assert.deepEqual(getCheckHistory(database, service.id, { limit: 2 }), {
    results: [newest, secondTie], total: 4, limit: 2, offset: 0,
  });
  assert.deepEqual(getCheckHistory(database, service.id, { limit: 2, offset: 2 }), {
    results: [firstTie, older], total: 4, limit: 2, offset: 2,
  });
  assert.deepEqual(getCheckHistory(database, service.id, { limit: 2, offset: 4 }), {
    results: [], total: 4, limit: 2, offset: 4,
  });
  assert.equal(getCheckHistory(database, service.id, { offset: 100 }).results.length, 0);
});

test('history applies window boundaries before pagination and counting', (t) => {
  const { database, service } = setup(t);
  const results = [999, 1000, 1500, 1999, 2000].map((checkedAt) =>
    saveCheckResult(database, { serviceId: service.id, checkedAt, healthy: true }));
  assert.deepEqual(getCheckHistory(database, service.id, {
    window: { from: 1000, to: 2000 }, limit: 1, offset: 1,
  }), { results: [results[2]], total: 3, limit: 1, offset: 1 });
  assert.deepEqual(getCheckHistory(database, service.id, { window: { from: 1000, to: 2000 } }).results,
    [results[3], results[2], results[1]]);
});

test('history uses a bounded default page size and allows the maximum page size', (t) => {
  const { database, service } = setup(t);
  for (let checkedAt = 0; checkedAt < 501; checkedAt++) {
    saveCheckResult(database, { serviceId: service.id, checkedAt, healthy: true });
  }
  const defaultPage = getCheckHistory(database, service.id);
  assert.equal(defaultPage.results.length, 50);
  assert.equal(defaultPage.total, 501);
  assert.equal(getCheckHistory(database, service.id, { limit: 500 }).results.length, 500);
  assert.equal(getCheckHistory(database, service.id, { limit: 500, offset: 500 }).results.length, 1);
});

test('retention removes only older results across services and persists cleanup', (t) => {
  const { database, service, path } = setup(t);
  const other = createService(database, { name: 'Other', url: 'http://other.test' });
  for (const current of [service, other]) {
    saveCheckResult(database, { serviceId: current.id, checkedAt: 999, healthy: true });
  }
  const boundary = saveCheckResult(database, { serviceId: service.id, checkedAt: 1000, healthy: false });
  const newer = saveCheckResult(database, { serviceId: service.id, checkedAt: 1001, healthy: true });
  assert.equal(deleteCheckResultsBefore(database, 0), 0);
  assert.equal(deleteCheckResultsBefore(database, 1000), 2);
  assert.equal(deleteCheckResultsBefore(database, 1000), 0);
  assert.deepEqual(getCheckHistory(database, service.id).results, [newer, boundary]);
  assert.deepEqual(listLatestCheckResults(database), [newer]);
  assert.equal(getServiceUptime(database, service.id, { from: 0, to: 2000 }).uptimePercent, 50);
  assert.deepEqual(getService(database, service.id), service);
  assert.deepEqual(getService(database, other.id), other);
  const reopened = openDatabase(path);
  try {
    assert.deepEqual(getCheckHistory(reopened, service.id).results, [newer, boundary]);
    assert.equal(getCheckHistory(reopened, other.id).total, 0);
  } finally {
    reopened.close();
  }
  assert.equal(deleteCheckResultsBefore(database, 1002), 2);
  assert.deepEqual(listLatestCheckResults(database), []);
  assert.equal(getLatestCheckResult(database, service.id), undefined);
  assert.equal(getServiceUptime(database, service.id, { from: 0, to: 2000 }).uptimePercent, null);
  assert.equal(deleteCheckResultsBefore(database, 1002), 0);
});

test('invalid windows, pagination, and cutoffs are rejected without deleting results', (t) => {
  const { database, service } = setup(t);
  const result = saveCheckResult(database, { serviceId: service.id, checkedAt: 1000, healthy: true });
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const window of [{ from: value, to: 2000 }, { from: 0, to: value }]) {
      assert.throws(() => getServiceUptime(database, service.id, window));
      assert.throws(() => getCheckHistory(database, service.id, { window }));
    }
    assert.throws(() => getCheckHistory(database, service.id, { offset: value }));
    assert.throws(() => deleteCheckResultsBefore(database, value));
  }
  const reversed = { from: 2000, to: 1000 };
  assert.throws(() => getServiceUptime(database, service.id, reversed), /from must not exceed to/);
  assert.throws(() => getCheckHistory(database, service.id, { window: reversed }), /from must not exceed to/);
  for (const limit of [0, -1, 1.5, 501, NaN, Infinity]) {
    assert.throws(() => getCheckHistory(database, service.id, { limit }), /limit/);
  }
  assert.deepEqual(getCheckHistory(database, service.id).results, [result]);
});
