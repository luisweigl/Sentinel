import type { DatabaseSync } from 'node:sqlite';

export interface ServiceInput {
  name: string;
  url: string;
  intervalMs?: number;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface Service {
  id: number;
  name: string;
  url: string;
  intervalMs: number;
  timeoutMs: number;
  enabled: boolean;
  createdAt: number;
}

export interface CheckResultInput {
  serviceId: number;
  healthy: boolean;
  checkedAt?: number;
  httpStatus?: number | null;
  responseTimeMs?: number | null;
  error?: string | null;
}

export interface CheckResult {
  id: number;
  serviceId: number;
  healthy: boolean;
  checkedAt: number;
  httpStatus: number | null;
  responseTimeMs: number | null;
  error: string | null;
}

const serviceColumns = `id, name, url, interval_ms AS intervalMs,
  timeout_ms AS timeoutMs, enabled, created_at AS createdAt`;
const checkColumns = `id, service_id AS serviceId, healthy, checked_at AS checkedAt,
  http_status AS httpStatus, response_time_ms AS responseTimeMs, error`;

type ServiceRow = Omit<Service, 'enabled'> & { enabled: number };
type CheckRow = Omit<CheckResult, 'healthy'> & { healthy: number };

function serviceFromRow(row: ServiceRow): Service {
  return { ...row, enabled: row.enabled === 1 };
}

export function createService(database: DatabaseSync, input: ServiceInput): Service {
  const row = database.prepare(`
    INSERT INTO services (name, url, interval_ms, timeout_ms, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING ${serviceColumns}
  `).get(input.name, input.url, input.intervalMs ?? 60000, input.timeoutMs ?? 10000,
    Number(input.enabled ?? true), Date.now()) as ServiceRow;
  return serviceFromRow(row);
}

export function getService(database: DatabaseSync, id: number): Service | undefined {
  const row = database.prepare(`SELECT ${serviceColumns} FROM services WHERE id = ?`)
    .get(id) as ServiceRow | undefined;
  return row ? serviceFromRow(row) : undefined;
}

export function listServices(database: DatabaseSync): Service[] {
  const rows = database.prepare(`SELECT ${serviceColumns} FROM services ORDER BY id`)
    .all() as ServiceRow[];
  return rows.map(serviceFromRow);
}

export function updateService(
  database: DatabaseSync, id: number, input: Partial<ServiceInput>,
): Service | undefined {
  const row = database.prepare(`
    UPDATE services SET name = COALESCE(?, name), url = COALESCE(?, url),
      interval_ms = COALESCE(?, interval_ms), timeout_ms = COALESCE(?, timeout_ms),
      enabled = COALESCE(?, enabled)
    WHERE id = ? RETURNING ${serviceColumns}
  `).get(input.name ?? null, input.url ?? null, input.intervalMs ?? null,
    input.timeoutMs ?? null, input.enabled === undefined ? null : Number(input.enabled),
    id) as ServiceRow | undefined;
  return row ? serviceFromRow(row) : undefined;
}

export function deleteService(database: DatabaseSync, id: number): boolean {
  return database.prepare('DELETE FROM services WHERE id = ?').run(id).changes > 0;
}

export function saveCheckResult(database: DatabaseSync, input: CheckResultInput): CheckResult {
  const row = database.prepare(`
    INSERT INTO check_results
      (service_id, checked_at, healthy, http_status, response_time_ms, error)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING ${checkColumns}
  `).get(input.serviceId, input.checkedAt ?? Date.now(), Number(input.healthy),
    input.httpStatus ?? null, input.responseTimeMs ?? null, input.error ?? null) as CheckRow;
  return { ...row, healthy: row.healthy === 1 };
}

export function getLatestCheckResult(
  database: DatabaseSync, serviceId: number,
): CheckResult | undefined {
  const row = database.prepare(`
    SELECT ${checkColumns} FROM check_results WHERE service_id = ?
    ORDER BY checked_at DESC, id DESC LIMIT 1
  `).get(serviceId) as CheckRow | undefined;
  return row ? { ...row, healthy: row.healthy === 1 } : undefined;
}
