import type { Service, UptimeWindow } from './App';

export interface CheckResult {
  checkedAt: number;
  result: 'Healthy' | 'Failed' | 'Timeout';
  httpStatus: number | null;
  durationMs: number | null;
  error: string | null;
}

export const snapshotTime = Date.parse('2026-10-13T12:00:00Z');
const dayMs = 86_400_000;
const windowDays: Record<UptimeWindow, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};

// Fixed local fixtures keep relative ages, latest results, and pagination stable.
export function createHistory(service: Service): CheckResult[] {
  if (service.result === 'Awaiting check') return [];
  const ageSeconds: Record<number, number> = {
    1: 9,
    3: 12,
    4: 28,
    5: 41,
    6: 10_800,
  };
  const latest = snapshotTime - (ageSeconds[service.id] ?? 0) * 1000;
  return Array.from({ length: 36 }, (_, index) => {
    const block = Math.floor(index / 12);
    const offset = [0, 2 * dayMs, 10 * dayMs][block];
    const latestFailure = index === 0 && !service.result.startsWith('200');
    const failure =
      latestFailure ||
      (service.id === 1 && index % 7 === 0) ||
      (service.id === 6 && index % 5 === 0);
    const timeout = failure && service.id === 1;
    return {
      checkedAt:
        latest - offset - (index % 12) * service.intervalSeconds * 1000,
      result: timeout ? 'Timeout' : failure ? 'Failed' : 'Healthy',
      httpStatus: timeout ? null : failure ? 503 : 200,
      durationMs: timeout
        ? null
        : index === 0
          ? service.durationMs
          : 80 + ((index * 17 + service.id * 13) % 140),
      error: timeout
        ? 'Request exceeded the configured timeout.'
        : failure
          ? 'HTTP 503 Service Unavailable.'
          : null,
    };
  });
}

export function historyForWindow(
  history: CheckResult[],
  window: UptimeWindow,
): CheckResult[] {
  const start = snapshotTime - windowDays[window] * dayMs;
  return history.filter(
    (check) => check.checkedAt >= start && check.checkedAt <= snapshotTime,
  );
}

export function summarizeHistory(history: CheckResult[]) {
  const successful = history.filter(
    (check) => check.result === 'Healthy',
  ).length;
  return {
    successful,
    total: history.length,
    uptime: history.length === 0 ? null : (successful / history.length) * 100,
  };
}

export const historyPageSize = 6;
export function historyPage(
  history: CheckResult[],
  page: number,
): CheckResult[] {
  return history.slice((page - 1) * historyPageSize, page * historyPageSize);
}
