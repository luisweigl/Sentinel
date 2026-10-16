import { ApiError, requestJson } from './http';
import type {
  Service as StoredService,
  CheckResult as StoredCheck,
  UptimeSummary,
  CheckHistoryPage,
} from '../server/persistence';
import type { NewService } from './AddService';
import type { CheckResult, Service, UptimeWindow, HistoryData } from './types';

export function toCheck(check: StoredCheck): CheckResult {
  return {
    id: check.id,
    checkedAt: check.checkedAt,
    result: check.healthy
      ? 'Healthy'
      : check.error?.startsWith('Check timed out after ')
        ? 'Timeout'
        : 'Failed',
    httpStatus: check.httpStatus,
    durationMs: check.responseTimeMs,
    error:
      check.error ??
      (!check.healthy && check.httpStatus !== null
        ? `HTTP ${check.httpStatus}`
        : null),
  };
}

export function relativeTime(
  checkedAt: number | undefined,
  now = Date.now(),
): string {
  if (checkedAt === undefined) return 'Never';
  const seconds = Math.max(0, Math.floor((now - checkedAt) / 1000));
  if (seconds < 1) return 'Just now';
  const [amount, unit] =
    seconds < 60
      ? [seconds, 'second']
      : seconds < 3600
        ? [Math.floor(seconds / 60), 'minute']
        : seconds < 86400
          ? [Math.floor(seconds / 3600), 'hour']
          : [Math.floor(seconds / 86400), 'day'];
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
}

export function toService(
  service: StoredService,
  latest: CheckResult | null = null,
  uptime: number | null = null,
): Service {
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    intervalSeconds: service.intervalMs / 1000,
    timeoutSeconds: service.timeoutMs / 1000,
    status: !service.enabled
      ? 'paused'
      : !latest
        ? 'pending'
        : latest.result === 'Healthy'
          ? 'healthy'
          : 'failing',
    result: !latest
      ? 'Awaiting check'
      : latest.result === 'Timeout'
        ? 'Timeout'
        : latest.httpStatus !== null
          ? `${latest.httpStatus}${latest.httpStatus === 200 ? ' OK' : ''}`
          : 'Failed',
    durationMs: latest?.durationMs ?? null,
    lastChecked: relativeTime(latest?.checkedAt),
    latestCheck: latest,
    uptimePercent: uptime,
  };
}

const unauthorized = new Set<() => void>();

export function onUnauthorized(listener: () => void): () => void {
  unauthorized.add(listener);
  return () => {
    unauthorized.delete(listener);
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await requestJson<T>(`/api/services${path}`, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      for (const listener of unauthorized) listener();
    }
    throw error;
  }
}

export async function loadOverview(
  window: UptimeWindow,
  signal?: AbortSignal,
): Promise<Service[]> {
  const data = await request<{
    services: (StoredService & {
      latestResult: StoredCheck | null;
      uptime: UptimeSummary;
    })[];
  }>(`/overview?window=${window}`, { signal });
  return data.services.map((service) =>
    toService(
      service,
      service.latestResult ? toCheck(service.latestResult) : null,
      service.uptime.uptimePercent,
    ),
  );
}

export async function loadHistory(
  id: number,
  window: UptimeWindow,
  page: number,
  signal?: AbortSignal,
  to?: number,
): Promise<HistoryData> {
  const data = await request<{
    latestResult: StoredCheck | null;
    uptime: UptimeSummary;
    history: CheckHistoryPage;
    asOf: number;
  }>(
    `/${id}/history?window=${window}&page=${page}${to === undefined ? '' : `&to=${to}`}`,
    { signal },
  );
  return {
    latest: data.latestResult ? toCheck(data.latestResult) : null,
    results: data.history.results.map(toCheck),
    successful: data.uptime.healthyChecks,
    total: data.history.total,
    uptime: data.uptime.uptimePercent,
    asOf: data.asOf,
  };
}

export function createService(input: NewService): Promise<StoredService> {
  return request('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      url: input.url,
      intervalMs: input.intervalSeconds * 1000,
      timeoutMs: input.timeoutSeconds * 1000,
      enabled: input.enabled,
    }),
  });
}

export function updateService(service: Service): Promise<StoredService> {
  return request(`/${service.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: service.name,
      url: service.url,
      intervalMs: service.intervalSeconds * 1000,
      timeoutMs: (service.timeoutSeconds ?? 10) * 1000,
      enabled: service.status !== 'paused',
    }),
  });
}

export function removeService(id: number): Promise<void> {
  return request(`/${id}`, { method: 'DELETE' });
}
