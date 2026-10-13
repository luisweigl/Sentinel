import { performance } from 'node:perf_hooks';
import type { CheckResultInput, Service } from './persistence.js';

/** Runs one GET check. Duration includes redirects and ends at final response headers. */
export async function checkService(
  service: Pick<Service, 'id' | 'url' | 'timeoutMs'>,
): Promise<CheckResultInput> {
  const checkedAt = Date.now();
  const startedAt = performance.now();
  let signal: AbortSignal | undefined;

  try {
    signal = AbortSignal.timeout(service.timeoutMs);
    const response = await fetch(service.url, { signal, redirect: 'follow' });
    const responseTimeMs = performance.now() - startedAt;
    // Health checks only need headers; release the body without downloading it.
    await response.body?.cancel();
    return {
      serviceId: service.id,
      checkedAt,
      healthy: response.status >= 200 && response.status < 300,
      httpStatus: response.status,
      responseTimeMs,
      error: null,
    };
  } catch (error) {
    return {
      serviceId: service.id,
      checkedAt,
      healthy: false,
      httpStatus: null,
      responseTimeMs: performance.now() - startedAt,
      error: signal?.aborted
        ? `Check timed out after ${service.timeoutMs} ms`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
