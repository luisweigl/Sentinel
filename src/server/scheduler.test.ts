import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { openDatabase } from './database.js';
import {
  createService,
  deleteService,
  getLatestCheckResult,
  saveCheckResult,
  updateService,
  type CheckResultInput,
  type Service,
} from './persistence.js';
import { startScheduler } from './scheduler.js';

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 10000 });
  const database = openDatabase(':memory:');
  t.after(() => database.close());
  return database;
}

function deferredCheck() {
  const calls: Service[] = [];
  const pending = new Map<number, (result: CheckResultInput) => void>();
  return {
    calls,
    check(service: Service): Promise<CheckResultInput> {
      calls.push(service);
      return new Promise((resolve) => pending.set(service.id, resolve));
    },
    finish(serviceId: number, checkedAt = Date.now()) {
      const resolve = pending.get(serviceId);
      assert.ok(resolve, `No active check for service ${serviceId}`);
      pending.delete(serviceId);
      resolve({
        serviceId,
        checkedAt,
        healthy: true,
        httpStatus: 204,
        responseTimeMs: 12,
      });
    },
  };
}

test('runs new services immediately and existing services at their due boundary', async (t) => {
  const database = setup(t);
  const fresh = createService(database, {
    name: 'New',
    url: 'http://new.test',
    intervalMs: 1000,
  });
  const existing = createService(database, {
    name: 'Existing',
    url: 'http://existing.test',
    intervalMs: 1000,
  });
  saveCheckResult(database, {
    serviceId: existing.id,
    healthy: true,
    checkedAt: 9500,
  });
  const calls: number[] = [];
  const scheduler = startScheduler(database, {
    pollIntervalMs: 100,
    check: async (service) => {
      calls.push(service.id);
      return {
        serviceId: service.id,
        checkedAt: Date.now(),
        healthy: false,
        httpStatus: 503,
        responseTimeMs: 8,
        error: null,
      };
    },
  });
  t.after(() => scheduler.stop());
  await setImmediate();
  assert.deepEqual(calls, [fresh.id]);
  assert.deepEqual(getLatestCheckResult(database, fresh.id), {
    id: 2,
    serviceId: fresh.id,
    checkedAt: 10000,
    healthy: false,
    httpStatus: 503,
    responseTimeMs: 8,
    error: null,
  });
  t.mock.timers.tick(400);
  await setImmediate();
  assert.deepEqual(calls, [fresh.id]);
  t.mock.timers.tick(100);
  await setImmediate();
  assert.deepEqual(calls, [fresh.id, existing.id]);
  t.mock.timers.tick(500);
  await setImmediate();
  assert.deepEqual(calls, [fresh.id, existing.id, fresh.id]);
});

test('bounds total concurrency, prevents overlap, and gives waiting services a turn', async (t) => {
  const database = setup(t);
  const services = [1, 2, 3].map((id) =>
    createService(database, {
      name: `Service ${id}`,
      url: `http://service${id}.test`,
      intervalMs: 100,
    }),
  );
  const work = deferredCheck();
  const scheduler = startScheduler(database, {
    concurrency: 2,
    pollIntervalMs: 100,
    check: work.check,
  });
  await setImmediate();
  assert.deepEqual(
    work.calls.map((service) => service.id),
    [services[0].id, services[1].id],
  );
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(work.calls.length, 2);
  work.finish(services[0].id, 10000);
  await setImmediate();
  t.mock.timers.tick(100);
  await setImmediate();
  assert.deepEqual(
    work.calls.map((service) => service.id),
    services.map((service) => service.id),
  );
  const stopping = scheduler.stop();
  work.finish(services[1].id);
  work.finish(services[2].id);
  await stopping;
});

test('skips disabled services and uses service additions, edits, and re-enabling on the next poll', async (t) => {
  const database = setup(t);
  const service = createService(database, {
    name: 'Disabled',
    url: 'http://old.test',
    enabled: false,
  });
  const calls: Service[] = [];
  const scheduler = startScheduler(database, {
    pollIntervalMs: 100,
    check: async (current) => {
      calls.push(current);
      return { serviceId: current.id, healthy: true, checkedAt: Date.now() };
    },
  });
  t.after(() => scheduler.stop());
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(calls.length, 0);
  updateService(database, service.id, {
    enabled: true,
    url: 'http://new.test',
    timeoutMs: 123,
  });
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(calls[0].url, 'http://new.test');
  assert.equal(calls[0].timeoutMs, 123);
  updateService(database, service.id, { intervalMs: 100 });
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(calls.length, 2);
  updateService(database, service.id, { enabled: false });
  const added = createService(database, {
    name: 'Added',
    url: 'http://added.test',
  });
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.deepEqual(
    calls.map((current) => current.id),
    [service.id, service.id, added.id],
  );
});

test('stop waits for active checks to persist and never starts more work', async (t) => {
  const database = setup(t);
  const service = createService(database, {
    name: 'Active',
    url: 'http://active.test',
    intervalMs: 100,
  });
  createService(database, { name: 'Waiting', url: 'http://waiting.test' });
  const work = deferredCheck();
  const scheduler = startScheduler(database, {
    concurrency: 1,
    pollIntervalMs: 100,
    check: work.check,
  });
  await setImmediate();
  let stopped = false;
  const stopping = scheduler.stop().then(() => {
    stopped = true;
  });
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(stopped, false);
  assert.equal(work.calls.length, 1);
  work.finish(service.id);
  await stopping;
  assert.equal(getLatestCheckResult(database, service.id)?.httpStatus, 204);
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(work.calls.length, 1);
  await scheduler.stop();
});

test('deleting a service during a check discards its result safely', async (t) => {
  const database = setup(t);
  const service = createService(database, {
    name: 'Deleted',
    url: 'http://deleted.test',
  });
  const work = deferredCheck();
  const errors: unknown[] = [];
  const scheduler = startScheduler(database, {
    check: work.check,
    onError: (error) => errors.push(error),
  });
  await setImmediate();
  deleteService(database, service.id);
  work.finish(service.id);
  await scheduler.stop();
  assert.equal(getLatestCheckResult(database, service.id), undefined);
  assert.deepEqual(errors, []);
});

test('unexpected check failures release capacity and are reported', async (t) => {
  const database = setup(t);
  const first = createService(database, {
    name: 'First',
    url: 'http://first.test',
  });
  const second = createService(database, {
    name: 'Second',
    url: 'http://second.test',
  });
  const failure = new Error('Unexpected checker failure');
  const errors: unknown[] = [];
  let attempts = 0;
  const scheduler = startScheduler(database, {
    concurrency: 1,
    pollIntervalMs: 100,
    check: (service) => {
      attempts++;
      if (attempts === 1) throw failure;
      return Promise.resolve({ serviceId: service.id, healthy: true });
    },
    onError: (error) => errors.push(error),
  });
  t.after(() => scheduler.stop());
  await setImmediate();
  assert.deepEqual(errors, [failure]);
  t.mock.timers.tick(100);
  await setImmediate();
  assert.ok(getLatestCheckResult(database, first.id));
  t.mock.timers.tick(100);
  await setImmediate();
  assert.ok(getLatestCheckResult(database, second.id));
});

test('rejects invalid scheduler limits', (t) => {
  const database = setup(t);
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(
      () => startScheduler(database, { concurrency: value }),
      /concurrency/,
    );
    assert.throws(
      () => startScheduler(database, { pollIntervalMs: value }),
      /pollIntervalMs/,
    );
  }
});
