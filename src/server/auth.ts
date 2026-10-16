import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { AuthConfig } from './auth-config.js';
import {
  hashPassword,
  normalizedUsername,
  validPassword,
  verifyPassword,
} from './passwords.js';

export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const cookieName = 'sentinel_session';
export const digest = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
interface Administrator {
  username: string;
  password_hash: string;
}
export function getAdministrator(
  database: DatabaseSync,
): Administrator | undefined {
  return database
    .prepare('SELECT username, password_hash FROM administrator WHERE id = 1')
    .get() as Administrator | undefined;
}
function tokenFrom(request: Request): string | undefined {
  const tokens = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`));
  if (tokens.length !== 1) return undefined;
  const token = tokens[0].slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
export function cleanExpiredSessions(
  database: DatabaseSync,
  now = Date.now(),
): void {
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
}
function transaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function createAuthentication(
  database: DatabaseSync,
  config: AuthConfig,
  now = Date.now,
) {
  const routes = Router();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: config.secureCookie,
  };
  function user(request: Request): { username: string } | undefined {
    const token = tokenFrom(request);
    if (!token) return undefined;
    return database
      .prepare(
        `SELECT administrator.username FROM sessions
      JOIN administrator ON administrator.id = sessions.administrator_id
      WHERE token_hash = ? AND expires_at > ?`,
      )
      .get(digest(token), now()) as { username: string } | undefined;
  }
  const requireAuthentication: RequestHandler = (request, response, next) => {
    if (!user(request)) {
      response.status(401).json({ error: 'Authentication required' });
      return;
    }
    next();
  };
  function revoke(request: Request) {
    const token = tokenFrom(request);
    if (token)
      database
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(digest(token));
  }
  function insertSession(request: Request): string {
    revoke(request);
    const token = randomBytes(32).toString('base64url');
    const created = now();
    database
      .prepare(
        'INSERT INTO sessions (token_hash, administrator_id, created_at, expires_at) VALUES (?, 1, ?, ?)',
      )
      .run(digest(token), created, created + SESSION_MS);
    return token;
  }
  function setCookie(response: Response, token: string) {
    response.cookie(cookieName, token, {
      ...cookieOptions,
      maxAge: SESSION_MS,
    });
  }
  const windowMs = 15 * 60 * 1000;
  interface Counter {
    start: number;
    count: number;
  }
  const ips = new Map<string, Counter>();
  let global: Counter = { start: now(), count: 0 };
  let active = 0;
  function limited(response: Response, retry = 1): false {
    response
      .set('Retry-After', String(retry))
      .status(429)
      .json({ error: `Too many attempts. Try again in ${retry} seconds.` });
    return false;
  }
  function permit(request: Request, response: Response): boolean {
    const time = now();
    for (const [ip, counter] of ips)
      if (time >= counter.start + windowMs) ips.delete(ip);
    if (time >= global.start + windowMs) global = { start: time, count: 0 };
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const counter = ips.get(ip) ?? { start: time, count: 0 };
    if (global.count >= 50 || counter.count >= 10) {
      const reset =
        global.count >= 50 ? global.start + windowMs : counter.start + windowMs;
      return limited(response, Math.max(1, Math.ceil((reset - time) / 1000)));
    }
    if (!ips.has(ip) && ips.size >= 10000) return limited(response, 60);
    counter.count++;
    global.count++;
    ips.set(ip, counter);
    if (active >= 2) return limited(response);
    return true;
  }
  routes.get('/session', (request, response) => {
    const current = user(request);
    const setupRequired = !getAdministrator(database);
    response.json({
      authenticated: !!current,
      setupRequired,
      setupEnabled: setupRequired && !!config.setupToken,
      user: current ?? null,
    });
  });
  routes.post('/logout', (request, response) => {
    revoke(request);
    response.clearCookie(cookieName, cookieOptions).status(204).end();
  });
  for (const setup of [true, false]) {
    routes.post(setup ? '/setup' : '/login', async (request, response) => {
      if (!permit(request, response)) return;
      const body: unknown = request.body;
      const allowed = setup
        ? ['username', 'password', 'setupToken']
        : ['username', 'password'];
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !allowed.includes(key))
      ) {
        response.status(400).json({ error: 'Invalid authentication fields' });
        return;
      }
      const fields = body as Record<string, unknown>;
      const username = normalizedUsername(fields.username);
      if (
        !username ||
        typeof fields.password !== 'string' ||
        (setup
          ? !validPassword(fields.password)
          : !fields.password || [...fields.password].length > 128) ||
        (setup &&
          (typeof fields.setupToken !== 'string' ||
            fields.setupToken.length > 512))
      ) {
        response.status(400).json({
          error: setup
            ? 'Provide a valid username, a 15–128 character password, and setup token.'
            : 'Provide a valid username and password.',
        });
        return;
      }
      const admin = getAdministrator(database);
      if (setup) {
        if (admin) {
          response.status(409).json({ error: 'Administrator already exists' });
          return;
        }
        if (!config.setupToken) {
          response
            .status(503)
            .json({ error: 'Administrator setup is not configured' });
          return;
        }
        if (
          !timingSafeEqual(
            Buffer.from(digest(fields.setupToken as string), 'hex'),
            Buffer.from(digest(config.setupToken), 'hex'),
          )
        ) {
          response.status(403).json({ error: 'Invalid setup token' });
          return;
        }
      }
      active++;
      try {
        if (setup) {
          const hash = await hashPassword(fields.password);
          const token = transaction(database, () => {
            if (getAdministrator(database)) return undefined;
            database
              .prepare(
                'INSERT INTO administrator (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)',
              )
              .run(username, hash, now());
            return insertSession(request);
          });
          if (!token) {
            response
              .status(409)
              .json({ error: 'Administrator already exists' });
            return;
          }
          setCookie(response, token);
          response.status(201).json({ user: { username } });
        } else {
          const verified = await verifyPassword(
            fields.password,
            admin?.username === username ? admin.password_hash : undefined,
          );
          const token = transaction(database, () => {
            if (
              !verified ||
              !admin ||
              admin.username !== username ||
              getAdministrator(database)?.password_hash !== admin.password_hash
            )
              return undefined;
            return insertSession(request);
          });
          if (!token) {
            response
              .status(401)
              .json({ error: 'Invalid username or password.' });
            return;
          }
          setCookie(response, token);
          response.json({ user: { username } });
        }
      } finally {
        active--;
      }
    });
  }
  return { routes, requireAuthentication };
}

export async function resetAdministratorPassword(
  database: DatabaseSync,
  password: string,
): Promise<void> {
  if (!getAdministrator(database))
    throw new Error('No administrator exists. Complete initial setup first.');
  const hash = await hashPassword(password);
  transaction(database, () => {
    const result = database
      .prepare('UPDATE administrator SET password_hash = ? WHERE id = 1')
      .run(hash);
    if (result.changes !== 1) throw new Error('No administrator exists.');
    database.exec('DELETE FROM sessions');
  });
}
