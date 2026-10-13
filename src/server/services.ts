import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  createService,
  deleteService,
  listServices,
  updateService,
  type ServiceInput,
} from './persistence.js';

function validateInput(body: unknown, partial: boolean): Partial<ServiceInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Body must be a JSON object');
  }
  const input = body as Record<string, unknown>;
  const allowed = ['name', 'url', 'intervalMs', 'timeoutMs', 'enabled'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new Error('Unknown service field');
  }
  if (partial && Object.keys(input).length === 0) {
    throw new Error('Provide at least one service field');
  }

  const result: Partial<ServiceInput> = {};
  for (const key of ['name', 'url'] as const) {
    if (!partial || Object.hasOwn(input, key)) {
      const value = input[key];
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${key} must be a non-empty string`);
      }
      result[key] = value.trim();
    }
  }
  if (result.url !== undefined) {
    let url: URL;
    try {
      url = new URL(result.url);
    } catch {
      throw new Error('url must be an absolute HTTP or HTTPS URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      throw new Error('url must be an absolute HTTP or HTTPS URL');
    }
  }
  for (const key of ['intervalMs', 'timeoutMs'] as const) {
    if (Object.hasOwn(input, key)) {
      const value = input[key];
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value <= 0
      ) {
        throw new Error(
          `${key} must be a positive safe integer in milliseconds`,
        );
      }
      result[key] = value;
    }
  }
  if (Object.hasOwn(input, 'enabled')) {
    if (typeof input.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    result.enabled = input.enabled;
  }
  return result;
}

export function serviceRoutes(database: DatabaseSync): Router {
  const router = Router();

  router.use((request, response, next) => {
    if (
      ['POST', 'PATCH'].includes(request.method) &&
      !request.is('application/json')
    ) {
      response
        .status(415)
        .json({ error: 'Content-Type must be application/json' });
      return;
    }
    next();
  });

  router.param('id', (request, response, next, value: string) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      response
        .status(400)
        .json({ error: 'Service ID must be a positive safe integer' });
      return;
    }
    next();
  });

  router.get('/', (_request, response) => {
    response.json(listServices(database));
  });

  router.post('/', (request, response) => {
    let input: Partial<ServiceInput>;
    try {
      input = validateInput(request.body, false);
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
      return;
    }
    const service = createService(database, input as ServiceInput);
    response.status(201).json(service);
  });

  router.patch('/:id', (request, response) => {
    let input: Partial<ServiceInput>;
    try {
      input = validateInput(request.body, true);
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
      return;
    }
    const service = updateService(database, Number(request.params.id), input);
    if (!service) {
      response.status(404).json({ error: 'Service not found' });
      return;
    }
    response.json(service);
  });

  router.delete('/:id', (request, response) => {
    if (!deleteService(database, Number(request.params.id))) {
      response.status(404).json({ error: 'Service not found' });
      return;
    }
    response.sendStatus(204);
  });

  return router;
}
