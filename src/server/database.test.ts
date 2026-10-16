import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { openDatabase } from './database.js';
import {
  createService,
  deleteService,
  getLatestCheckResult,
  getService,
  listServices,
  saveCheckResult,
  updateService,
} from './persistence.js';

function temporaryPath(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-database-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'nested', 'sentinel.sqlite');
}

function temporaryDatabase(t: TestContext): DatabaseSync {
  const database = openDatabase(temporaryPath(t));
  t.after(() => database.close());
  return database;
}

test('initial migration creates schema, indexes, and connection settings', (t) => {
  const database = temporaryDatabase(t);
  assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 2);
  assert.equal(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  assert.equal(
    database.prepare('PRAGMA journal_mode').get()?.journal_mode,
    'wal',
  );
  assert.equal(database.prepare('PRAGMA busy_timeout').get()?.timeout, 5000);
  const indexes = database
    .prepare(
      `
    SELECT name FROM sqlite_schema WHERE type = 'index' ORDER BY name
  `,
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(indexes, [
    'check_results_service_time',
    'check_results_time',
    'sessions_expiry',
    'sqlite_autoindex_administrator_1',
    'sqlite_autoindex_sessions_1',
  ]);
  assert.deepEqual(listServices(database), []);
});

test('service configuration and results survive reopening without rerunning migrations', (t) => {
  const path = temporaryPath(t);
  let database = openDatabase(path);
  t.after(() => database.close());
  const service = createService(database, {
    name: 'Example',
    url: 'https://example.test',
  });
  assert.equal(service.intervalMs, 60000);
  assert.equal(service.timeoutMs, 10000);
  assert.equal(service.enabled, true);
  assert.ok(service.createdAt > 0);
  const result = saveCheckResult(database, {
    serviceId: service.id,
    healthy: true,
    checkedAt: 1000,
    httpStatus: 200,
    responseTimeMs: 12.5,
  });
  database.close();
  database = openDatabase(path);
  assert.deepEqual(getService(database, service.id), service);
  assert.deepEqual(listServices(database), [service]);
  assert.deepEqual(getLatestCheckResult(database, service.id), result);
  assert.equal(result.error, null);
  assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 2);
});

test('services can be updated, disabled, and deleted with cascading history', (t) => {
  const database = temporaryDatabase(t);
  const service = createService(database, {
    name: 'Original',
    url: 'http://localhost',
  });
  const other = createService(database, {
    name: 'Other',
    url: 'http://other.test',
  });
  const updated = updateService(database, service.id, {
    name: 'Updated',
    url: 'https://updated.test',
    intervalMs: 30000,
    timeoutMs: 5000,
    enabled: false,
  });
  assert.deepEqual(updated, {
    ...service,
    name: 'Updated',
    url: 'https://updated.test',
    intervalMs: 30000,
    timeoutMs: 5000,
    enabled: false,
  });
  assert.deepEqual(updateService(database, service.id, { enabled: true }), {
    ...updated,
    enabled: true,
  });
  saveCheckResult(database, {
    serviceId: service.id,
    healthy: false,
    error: 'timeout',
  });
  const otherResult = saveCheckResult(database, {
    serviceId: other.id,
    healthy: true,
  });
  assert.equal(deleteService(database, service.id), true);
  assert.equal(getService(database, service.id), undefined);
  assert.equal(getLatestCheckResult(database, service.id), undefined);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM check_results').get()
      ?.count,
    1,
  );
  assert.deepEqual(getLatestCheckResult(database, other.id), otherResult);
  assert.equal(deleteService(database, service.id), false);
  assert.equal(
    updateService(database, service.id, { name: 'Missing' }),
    undefined,
  );
});

test('latest result uses check time and deterministic ordering for ties', (t) => {
  const database = temporaryDatabase(t);
  const service = createService(database, {
    name: 'Example',
    url: 'http://example.test',
  });
  assert.equal(getLatestCheckResult(database, service.id), undefined);
  saveCheckResult(database, {
    serviceId: service.id,
    healthy: true,
    checkedAt: 2000,
  });
  saveCheckResult(database, {
    serviceId: service.id,
    healthy: true,
    checkedAt: 1000,
  });
  const failure = saveCheckResult(database, {
    serviceId: service.id,
    healthy: false,
    checkedAt: 2000,
    error: 'connection_error',
  });
  assert.equal(failure.httpStatus, null);
  assert.equal(failure.responseTimeMs, null);
  assert.deepEqual(getLatestCheckResult(database, service.id), failure);
});

test('constraints reject invalid records and orphan results', (t) => {
  const database = temporaryDatabase(t);
  const input = { name: 'Example', url: 'http://example.test' };
  for (const invalid of [
    { name: ' ' },
    { url: '' },
    { intervalMs: 0 },
    { timeoutMs: -1 },
    { intervalMs: 1.5 },
  ]) {
    assert.throws(() => createService(database, { ...input, ...invalid }));
  }
  const service = createService(database, input);
  for (const invalid of [
    { serviceId: service.id + 1 },
    { httpStatus: 99 },
    { httpStatus: 600 },
    { responseTimeMs: -1 },
    { checkedAt: -1 },
  ]) {
    assert.throws(() =>
      saveCheckResult(database, {
        serviceId: service.id,
        healthy: true,
        ...invalid,
      }),
    );
  }
  assert.throws(() =>
    database
      .prepare('UPDATE services SET enabled = 2 WHERE id = ?')
      .run(service.id),
  );
  assert.throws(() =>
    database
      .prepare(
        `
    INSERT INTO check_results (service_id, checked_at, healthy) VALUES (?, 0, 2)
  `,
      )
      .run(service.id),
  );
  assert.throws(() => updateService(database, service.id, { timeoutMs: 0 }));
  assert.equal(getService(database, service.id)?.timeoutMs, 10000);
});

test('failed migration rolls back schema changes and version', (t) => {
  const path = temporaryPath(t);
  // Create the parent directory through the normal connection, then replace the schema.
  const database = openDatabase(path);
  database.exec(
    'DROP TABLE check_results; DROP TABLE services; PRAGMA user_version = 0',
  );
  database.exec('CREATE TABLE check_results (id INTEGER PRIMARY KEY)');
  database.close();
  assert.throws(() => openDatabase(path), /already exists/);
  const inspection = new DatabaseSync(path);
  t.after(() => inspection.close());
  assert.equal(
    inspection.prepare('PRAGMA user_version').get()?.user_version,
    0,
  );
  assert.equal(
    inspection
      .prepare(
        `
    SELECT name FROM sqlite_schema WHERE name = 'services'
  `,
      )
      .get(),
    undefined,
  );
});

test('newer database versions are rejected without changing stored data', (t) => {
  const path = temporaryPath(t);
  const database = openDatabase(path);
  const service = createService(database, {
    name: 'Keep',
    url: 'http://keep.test',
  });
  database.exec('PRAGMA user_version = 999');
  database.close();
  assert.throws(
    () => openDatabase(path),
    /newer than this application supports/,
  );
  const inspection = new DatabaseSync(path);
  t.after(() => inspection.close());
  assert.equal(
    inspection.prepare('PRAGMA user_version').get()?.user_version,
    999,
  );
  assert.deepEqual(getService(inspection, service.id), service);
});

test('in-memory databases are supported', () => {
  const database = openDatabase(':memory:');
  try {
    assert.deepEqual(listServices(database), []);
  } finally {
    database.close();
  }
});

test('version 1 upgrade adds authentication without changing populated monitoring data', (t) => {
  const path = temporaryPath(t);
  const old = openDatabase(path);
  const service = createService(old, {
    name: 'Existing service',
    url: 'http://localhost',
  });
  saveCheckResult(old, {
    serviceId: service.id,
    checkedAt: 1000,
    healthy: true,
    httpStatus: 200,
  });
  const previousServices = old.prepare('SELECT * FROM services').all();
  const previousResults = old.prepare('SELECT * FROM check_results').all();
  old.exec(
    'DROP TABLE sessions; DROP TABLE administrator; PRAGMA user_version = 1;',
  );
  old.close();
  const upgraded = openDatabase(path);
  t.after(() => upgraded.close());
  assert.equal(upgraded.prepare('PRAGMA user_version').get()?.user_version, 2);
  assert.deepEqual(
    upgraded.prepare('SELECT * FROM services').all(),
    previousServices,
  );
  assert.deepEqual(
    upgraded.prepare('SELECT * FROM check_results').all(),
    previousResults,
  );
  assert.deepEqual(upgraded.prepare('SELECT * FROM administrator').all(), []);
  assert.deepEqual(upgraded.prepare('SELECT * FROM sessions').all(), []);
});
