import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  createService,
  deleteService,
  listServices,
  getService,
  listLatestCheckResults,
  getLatestCheckResult,
  getServiceUptime,
  getCheckHistory,
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

  const windowDurations = {
    '24h': 86_400_000,
    '7d': 604_800_000,
    '30d': 2_592_000_000,
  };
  function readWindow(query: Record<string, unknown>) {
    const value = query.window ?? '24h';
    if (typeof value !== 'string' || !Object.hasOwn(windowDurations, value)) {
      throw new Error('window must be 24h, 7d, or 30d');
    }
    const to = query.to === undefined ? Date.now() : Number(query.to);
    if (
      (query.to !== undefined &&
        (typeof query.to !== 'string' || !/^\d+$/.test(query.to))) ||
      !Number.isSafeInteger(to) ||
      to < 0 ||
      to > Date.now()
    ) {
      throw new Error('to must be a non-negative timestamp no later than now');
    }
    return {
      from: Math.max(
        0,
        to - windowDurations[value as keyof typeof windowDurations],
      ),
      to,
    };
  }

  router.get('/overview', (request, response) => {
    let window;
    try {
      window = readWindow(request.query);
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
      return;
    }
    const latest = new Map(
      listLatestCheckResults(database).map((check) => [check.serviceId, check]),
    );
    response.json({
      services: listServices(database).map((service) => ({
        ...service,
        latestResult: latest.get(service.id) ?? null,
        uptime: getServiceUptime(database, service.id, window),
      })),
      asOf: window.to,
    });
  });

  router.get('/:id/history', (request, response) => {
    const id = Number(request.params.id);
    if (!getService(database, id)) {
      response.status(404).json({ error: 'Service not found' });
      return;
    }
    let window;
    let page;
    try {
      window = readWindow(request.query);
      const value = request.query.page ?? '1';
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))
        throw new Error('page must be a positive safe integer');
      page = Number(value);
      if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * 6))
        throw new Error('page must be a positive safe integer');
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
      return;
    }
    response.json({
      latestResult: getLatestCheckResult(database, id) ?? null,
      uptime: getServiceUptime(database, id, window),
      history: getCheckHistory(database, id, {
        window,
        limit: 6,
        offset: (page - 1) * 6,
      }),
      asOf: window.to,
    });
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
