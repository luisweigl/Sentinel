import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const prefix = 'scrypt-v1$131072$8$1';
export function validPassword(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    [...password].length >= 15 &&
    [...password].length <= 128
  );
}
export function normalizedUsername(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9_.-]{3,64}$/.test(username) ? username : undefined;
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password))
    throw new Error('Password must contain 15–128 characters.');
  const salt = randomBytes(16);
  return `${prefix}$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}
// Unknown users still perform the same expensive derivation as known users.
const dummy = `${prefix}$${'00'.repeat(16)}$${'00'.repeat(64)}`;
export async function verifyPassword(
  password: string,
  encoded = dummy,
): Promise<boolean> {
  const parts = encoded.split('$');
  if (
    parts.slice(0, 4).join('$') !== prefix ||
    !/^[a-f0-9]{32}$/.test(parts[4] ?? '') ||
    !/^[a-f0-9]{128}$/.test(parts[5] ?? '') ||
    parts.length !== 6
  )
    throw new Error('Unsupported password hash');
  return timingSafeEqual(
    await derive(password, Buffer.from(parts[4], 'hex')),
    Buffer.from(parts[5], 'hex'),
  );
}
