export interface AuthConfig {
  publicOrigin: string;
  secureCookie: boolean;
  setupToken?: string;
  trustProxyHops: number;
}

export function readAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const production = env.NODE_ENV === 'production';
  if (
    env.SENTINEL_ALLOW_HTTP !== undefined &&
    !['true', 'false'].includes(env.SENTINEL_ALLOW_HTTP)
  )
    throw new Error('SENTINEL_ALLOW_HTTP must be true or false');
  const allowHttp = !production || env.SENTINEL_ALLOW_HTTP === 'true';
  const origin =
    env.SENTINEL_PUBLIC_ORIGIN ?? (production ? '' : 'http://localhost:5173');
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('SENTINEL_PUBLIC_ORIGIN must be an HTTP(S) origin');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== origin ||
    url.username ||
    url.password
  )
    throw new Error(
      'SENTINEL_PUBLIC_ORIGIN must be an HTTP(S) origin without a path',
    );
  if (!allowHttp && url.protocol !== 'https:')
    throw new Error(
      'Production requires HTTPS; set SENTINEL_ALLOW_HTTP=true to explicitly allow HTTP',
    );
  const hops = env.SENTINEL_TRUST_PROXY_HOPS ?? '0';
  if (!/^\d+$/.test(hops) || !Number.isSafeInteger(Number(hops)))
    throw new Error('SENTINEL_TRUST_PROXY_HOPS must be a nonnegative integer');
  const setupToken = env.SENTINEL_SETUP_TOKEN || undefined;
  if (
    setupToken &&
    (!/^[A-Za-z0-9_-]{43,512}$/.test(setupToken) ||
      Buffer.from(setupToken, 'base64url').length < 32 ||
      Buffer.from(setupToken, 'base64url').toString('base64url') !== setupToken)
  )
    throw new Error(
      'SENTINEL_SETUP_TOKEN must contain at least 32 random bytes encoded as base64url',
    );
  return {
    publicOrigin: origin,
    secureCookie: production && url.protocol === 'https:',
    setupToken,
    trustProxyHops: Number(hops),
  };
}
