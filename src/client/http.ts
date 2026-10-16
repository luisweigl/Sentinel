export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(options.method ?? 'GET'))
    headers.set('X-Sentinel-Request', '1');
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body: { error?: unknown } = await response.json();
      if (typeof body.error === 'string') message = body.error;
    } catch {
      /* Preserve status when a proxy returns a non-JSON error. */
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
