import type { DatabaseSync } from 'node:sqlite';
import { checkService } from './health-checker.js';
import {
  getLatestCheckResult, getService, listServices, saveCheckResult,
  type CheckResultInput, type Service,
} from './persistence.js';

interface SchedulerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  check?: (service: Service) => Promise<CheckResultInput>;
  onError?: (error: unknown) => void;
}

/** Polls for due work; intervals are measured from the previous check's start. */
export function startScheduler(database: DatabaseSync, options: SchedulerOptions = {}) {
  const concurrency = options.concurrency ?? 4;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  for (const [name, value] of Object.entries({ concurrency, pollIntervalMs })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }

  const check = options.check ?? checkService;
  const onError = options.onError ?? console.error;
  const active = new Map<number, Promise<void>>();
  let stopped = false;

  async function run(service: Service): Promise<void> {
    try {
      const result = await check(service);
      // Deleting a service also deletes its history; do not recreate orphan results.
      if (getService(database, service.id)) {
        saveCheckResult(database, { ...result, serviceId: service.id });
      }
    } catch (error) {
      onError(error);
    } finally {
      active.delete(service.id);
    }
  }

  function tick(): void {
    if (stopped || active.size >= concurrency) return;
    try {
      const now = Date.now();
      const due = listServices(database)
        .filter((service) => service.enabled && !active.has(service.id))
        .map((service) => ({
          service,
          lastCheck: getLatestCheckResult(database, service.id)?.checkedAt,
        }))
        .filter(({ service, lastCheck }) => lastCheck === undefined
          || now - lastCheck >= service.intervalMs)
        // Give waiting services priority over services just checked.
        .sort((a, b) => (a.lastCheck ?? -Infinity) - (b.lastCheck ?? -Infinity)
          || a.service.id - b.service.id);
      for (const { service } of due) {
        if (active.size >= concurrency) break;
        // Defer execution so even a synchronous checker failure sees its active entry.
        const pending = Promise.resolve().then(() => run(service));
        active.set(service.id, pending);
      }
    } catch (error) {
      onError(error);
    }
  }

  const timer = setInterval(tick, pollIntervalMs);
  tick();

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await Promise.all(active.values());
    },
  };
}
