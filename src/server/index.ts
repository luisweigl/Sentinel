import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const clientDirectory = process.env.NODE_ENV === 'production'
  ? fileURLToPath(new URL('../client', import.meta.url))
  : undefined;

const database = openDatabase(process.env.DATABASE_PATH);

const server = createApp(database, clientDirectory).listen(port, host, () => {
  console.log(`Sentinel is listening at http://${host}:${port}`);
});

server.once('error', (error) => {
  database.close();
  console.error(error);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  });
}
