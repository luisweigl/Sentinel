import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { startScheduler } from './scheduler.js';
import { cleanExpiredSessions } from './auth.js';
import { readAuthConfig } from './auth-config.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const clientDirectory =
  process.env.NODE_ENV === 'production'
    ? fileURLToPath(new URL('../client', import.meta.url))
    : undefined;

const authConfig = readAuthConfig();
const database = openDatabase(process.env.DATABASE_PATH);
const scheduler = startScheduler(database);
cleanExpiredSessions(database);
const sessionCleanup = setInterval(
  () => {
    try {
      cleanExpiredSessions(database);
    } catch (error) {
      console.error(error);
    }
  },
  60 * 60 * 1000,
);

const server = createApp(database, clientDirectory, authConfig).listen(
  port,
  host,
  () => {
    console.log(`Sentinel is listening at http://${host}:${port}`);
  },
);

server.once('error', (error) => {
  console.error(error);
  void shutdown(1);
});

let shuttingDown = false;
async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(sessionCleanup);
  await Promise.all([
    scheduler.stop(),
    new Promise<void>((resolve) => server.close(() => resolve())),
  ]);
  database.close();
  process.exit(exitCode);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(0);
  });
}
