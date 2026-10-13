export type UptimeWindow = '24h' | '7d' | '30d';
export type ServiceStatus = 'healthy' | 'failing' | 'pending' | 'paused';

export interface CheckResult {
  id: number;
  checkedAt: number;
  result: 'Healthy' | 'Failed' | 'Timeout';
  httpStatus: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface Service {
  id: number;
  name: string;
  url: string;
  status: ServiceStatus;
  result: string;
  durationMs: number | null;
  lastChecked: string;
  intervalSeconds: number;
  timeoutSeconds?: number;
  latestCheck?: CheckResult | null;
  uptimePercent?: number | null;
}

export interface HistoryData {
  latest: CheckResult | null;
  results: CheckResult[];
  successful: number;
  total: number;
  uptime: number | null;
  asOf: number;
}
