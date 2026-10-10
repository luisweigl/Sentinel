import express from 'express';
import { resolve } from 'node:path';

export function createApp(clientDirectory?: string) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  if (clientDirectory) {
    app.use(express.static(clientDirectory));
    app.get('/{*path}', (_request, response) => {
      response.sendFile(resolve(clientDirectory, 'index.html'));
    });
  }

  return app;
}
