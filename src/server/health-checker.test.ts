import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { test, type TestContext } from 'node:test';
import { checkService } from './health-checker.js';

async function setup(t: TestContext, handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('checks classify HTTP statuses and return service identity, timestamp, and duration', async (t) => {
  const url = await setup(t, (request, response) => {
    assert.equal(request.method, 'GET');
    response.writeHead(Number(request.url?.slice(1))).end();
  });
  for (const status of [200, 201, 204, 299, 300, 304, 400, 404, 500, 503]) {
    const before = Date.now();
    const result = await checkService({ id: 42, url: `${url}/${status}`, timeoutMs: 2000 });
    assert.equal(result.serviceId, 42);
    assert.equal(result.healthy, status >= 200 && status < 300);
    assert.equal(result.httpStatus, status);
    assert.equal(result.error, null);
    assert.ok(result.checkedAt! >= before && result.checkedAt! <= Date.now());
    assert.ok(Number.isFinite(result.responseTimeMs) && result.responseTimeMs! >= 0);
  }
});

test('duration measures delayed headers without waiting for the response body', async (t) => {
  const url = await setup(t, (_request, response) => {
    setTimeout(() => {
      response.writeHead(200);
      response.flushHeaders();
      // Intentionally leave the body unfinished.
    }, 40);
  });
  const result = await checkService({ id: 1, url, timeoutMs: 1000 });
  assert.equal(result.healthy, true);
  assert.ok(result.responseTimeMs! >= 30);
  assert.equal(result.error, null);
});

test('checks follow relative and absolute redirects and classify the final status', async (t) => {
  const destination = await setup(t, (_request, response) => response.writeHead(503).end());
  const url = await setup(t, (request, response) => {
    if (request.url === '/relative') {
      response.writeHead(302, { Location: '/healthy' }).end();
    } else if (request.url === '/absolute') {
      response.writeHead(301, { Location: destination }).end();
    } else {
      response.writeHead(204).end();
    }
  });
  const healthy = await checkService({ id: 1, url: `${url}/relative`, timeoutMs: 2000 });
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.httpStatus, 204);
  const unhealthy = await checkService({ id: 1, url: `${url}/absolute`, timeoutMs: 2000 });
  assert.equal(unhealthy.healthy, false);
  assert.equal(unhealthy.httpStatus, 503);
  assert.equal(unhealthy.error, null);
});

test('checks return failures for broken connections and redirect loops', async (t) => {
  const url = await setup(t, (request, response) => {
    if (request.url === '/disconnect') {
      request.socket.destroy();
    } else {
      response.writeHead(302, { Location: '/loop' }).end();
    }
  });
  for (const path of ['/disconnect', '/loop']) {
    const result = await checkService({ id: 1, url: `${url}${path}`, timeoutMs: 2000 });
    assert.equal(result.healthy, false);
    assert.equal(result.httpStatus, null);
    assert.ok(result.error);
    assert.ok(result.responseTimeMs! >= 0);
  }
});

test('checks time out while waiting for headers, including after redirects', async (t) => {
  const url = await setup(t, (request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/hang' }).end();
    }
    // Other requests deliberately never send headers.
  });
  for (const path of ['/hang', '/redirect']) {
    const result = await checkService({ id: 1, url: `${url}${path}`, timeoutMs: 100 });
    assert.equal(result.healthy, false);
    assert.equal(result.httpStatus, null);
    assert.equal(result.error, 'Check timed out after 100 ms');
    assert.ok(result.responseTimeMs! >= 80);
    assert.ok(result.responseTimeMs! < 2000);
  }
});
