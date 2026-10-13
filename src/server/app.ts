import express from 'express';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ErrorRequestHandler } from 'express';
import { serviceRoutes } from './services.js';

export function createApp(database: DatabaseSync, clientDirectory?: string) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.use('/api/services', serviceRoutes(database));

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  if (clientDirectory) {
    app.use(express.static(clientDirectory));
    app.get('/{*path}', (_request, response) => {
      response.sendFile(resolve(clientDirectory, 'index.html'));
    });
  }

  const handleError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const status = (error as { status?: number } | null)?.status;
    if (status === 400 || status === 413) {
      response.status(status).json({
        error: status === 400 ? 'Invalid JSON body' : 'Request body too large',
      });
      return;
    }
    console.error(error);
    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(handleError);

  return app;
}
