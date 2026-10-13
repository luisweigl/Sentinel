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

/** Unix timestamps in milliseconds, including from and excluding to. */
export interface CheckWindow {
  from: number;
  to: number;
}

export interface UptimeSummary extends CheckWindow {
  totalChecks: number;
  healthyChecks: number;
  unhealthyChecks: number;
  uptimePercent: number | null;
}

export interface CheckHistoryOptions {
  window?: CheckWindow;
  limit?: number;
  offset?: number;
}

export interface CheckHistoryPage {
  results: CheckResult[];
  total: number;
  limit: number;
  offset: number;
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

function checkFromRow(row: CheckRow): CheckResult {
  return { ...row, healthy: row.healthy === 1 };
}

function validateTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer in milliseconds`);
  }
}

function validateWindow(window: CheckWindow): void {
  validateTimestamp('from', window.from);
  validateTimestamp('to', window.to);
  if (window.from > window.to) throw new Error('from must not exceed to');
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
  return checkFromRow(row);
}

export function getLatestCheckResult(
  database: DatabaseSync, serviceId: number,
): CheckResult | undefined {
  const row = database.prepare(`
    SELECT ${checkColumns} FROM check_results WHERE service_id = ?
    ORDER BY checked_at DESC, id DESC LIMIT 1
  `).get(serviceId) as CheckRow | undefined;
  return row ? checkFromRow(row) : undefined;
}

/** One result per service with history, ordered by service ID. */
export function listLatestCheckResults(database: DatabaseSync): CheckResult[] {
  const rows = database.prepare(`
    SELECT ${checkColumns} FROM check_results
    WHERE id IN (
      SELECT (
        SELECT id FROM check_results WHERE service_id = services.id
        ORDER BY checked_at DESC, id DESC LIMIT 1
      ) FROM services
    )
    ORDER BY service_id
  `).all() as CheckRow[];
  return rows.map(checkFromRow);
}

/** Sample-based uptime; missing checks do not imply health or failure. */
export function getServiceUptime(
  database: DatabaseSync, serviceId: number, window: CheckWindow,
): UptimeSummary {
  validateWindow(window);
  const row = database.prepare(`
    SELECT COUNT(*) AS totalChecks, COALESCE(SUM(healthy), 0) AS healthyChecks
    FROM check_results WHERE service_id = ? AND checked_at >= ? AND checked_at < ?
  `).get(serviceId, window.from, window.to) as { totalChecks: number; healthyChecks: number };
  return {
    ...window,
    ...row,
    unhealthyChecks: row.totalChecks - row.healthyChecks,
    uptimePercent: row.totalChecks === 0 ? null : row.healthyChecks / row.totalChecks * 100,
  };
}

/** Newest first, with descending IDs breaking ties. Pages default to 50, maximum 500. */
export function getCheckHistory(
  database: DatabaseSync, serviceId: number, options: CheckHistoryOptions = {},
): CheckHistoryPage {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('limit must be an integer between 1 and 500');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative safe integer');
  }
  if (options.window) validateWindow(options.window);
  const where = options.window
    ? 'service_id = ? AND checked_at >= ? AND checked_at < ?'
    : 'service_id = ?';
  const parameters = options.window
    ? [serviceId, options.window.from, options.window.to] : [serviceId];
  const { total } = database.prepare(`SELECT COUNT(*) AS total FROM check_results WHERE ${where}`)
    .get(...parameters) as { total: number };
  const rows = database.prepare(`
    SELECT ${checkColumns} FROM check_results WHERE ${where}
    ORDER BY checked_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset) as CheckRow[];
  return { results: rows.map(checkFromRow), total, limit, offset };
}

/** Deletes results strictly older than cutoff; returns the number removed. */
export function deleteCheckResultsBefore(database: DatabaseSync, cutoff: number): number {
  validateTimestamp('cutoff', cutoff);
  return Number(database.prepare('DELETE FROM check_results WHERE checked_at < ?').run(cutoff).changes);
}
