import express from 'express';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ErrorRequestHandler } from 'express';
import { serviceRoutes } from './services.js';
import { createAuthentication } from './auth.js';
import { readAuthConfig, type AuthConfig } from './auth-config.js';

export function createApp(
  database: DatabaseSync,
  clientDirectory?: string,
  authConfig: AuthConfig = readAuthConfig(),
  now = Date.now,
) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', authConfig.trustProxyHops);
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.get('X-Sentinel-Request') !== '1' ||
        (request.get('Origin') !== undefined &&
          request.get('Origin') !== authConfig.publicOrigin)
      ) {
        response.status(403).json({ error: 'Request origin rejected' });
        return;
      }
      if (
        (['POST', 'PATCH', 'PUT'].includes(request.method) ||
          request.headers['content-length'] ||
          request.headers['transfer-encoding']) &&
        !/^application\/json(?:\s*;|$)/i.test(request.get('Content-Type') ?? '')
      ) {
        response
          .status(415)
          .json({ error: 'Content-Type must be application/json' });
        return;
      }
    }
    next();
  });
  const auth = createAuthentication(database, authConfig, now);
  app.use('/api/auth', express.json({ limit: '4kb' }), auth.routes);
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.use('/api/services', auth.requireAuthentication, serviceRoutes(database));

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
