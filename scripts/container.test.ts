import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';
import type { CheckResult, Service } from '../src/server/persistence.js';

const execute = promisify(execFile);
async function docker(...args: string[]): Promise<string> {
  const { stdout, stderr } = await execute('docker', args, {
    timeout: 600_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return (args[0] === 'logs' ? stdout + stderr : stdout).trim();
}

async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await read();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await setTimeout(250);
  }
  throw new Error('Container did not reach expected state within 30 seconds', {
    cause: lastError,
  });
}

test(
  'production image serves assets and preserves history through replacement and restore',
  {
    timeout: 900_000,
  },
  async (t) => {
    const prefix = `sentinel-test-${randomUUID()}`;
    const image = `${prefix}:local`;
    const volumes = [`${prefix}-data`, `${prefix}-backup`, `${prefix}-restore`];
    const containers = [
      `${prefix}-first`,
      `${prefix}-replacement`,
      `${prefix}-restored`,
    ];
    const directory = await mkdtemp(join(tmpdir(), 'sentinel-container-'));
    const setupToken = Buffer.alloc(32, 42).toString('base64url');
    const credentials = {
      username: 'admin',
      password: 'container test passphrase',
    };
    let cookie = '';
    const authHeaders = () => ({
      'Content-Type': 'application/json',
      'X-Sentinel-Request': '1',
      Cookie: cookie,
    });
    t.after(async () => {
      // Only remove the uniquely named resources owned by this test.
      for (const container of containers)
        await docker('rm', '-f', container).catch(() => {});
      for (const volume of volumes)
        await docker('volume', 'rm', volume).catch(() => {});
      await docker('image', 'rm', image).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    });

    async function start(name: string, volume: string): Promise<string> {
      await docker(
        'run',
        '-d',
        '--name',
        name,
        '-p',
        '127.0.0.1::3000',
        '--mount',
        `type=volume,src=${volume},dst=/data`,
        '-e',
        'SENTINEL_PUBLIC_ORIGIN=http://localhost:3000',
        '-e',
        'SENTINEL_ALLOW_HTTP=true',
        ...(name === containers[0]
          ? ['-e', `SENTINEL_SETUP_TOKEN=${setupToken}`]
          : []),
        image,
      );
      const port = await docker('port', name, '3000/tcp');
      const base = `http://${port}`;
      await eventually(async () => {
        const response = await fetch(`${base}/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok' });
        return true;
      });
      await docker('exec', name, 'node', 'dist/server/container-health.js');
      return base;
    }

    async function history(
      base: string,
      serviceId: number,
    ): Promise<CheckResult[]> {
      const response = await fetch(
        `${base}/api/services/${serviceId}/history`,
        {
          signal: AbortSignal.timeout(2000),
          headers: authHeaders(),
        },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        history: { results: CheckResult[] };
      };
      return body.history.results;
    }

    async function stop(name: string): Promise<void> {
      await docker('stop', '--time', '60', name);
      assert.equal(
        await docker('inspect', '--format', '{{.State.ExitCode}}', name),
        '0',
      );
    }

    try {
      await docker('version');
      await docker('compose', 'config', '--quiet');
      await docker('build', '-t', image, '.');
      for (const volume of volumes) await docker('volume', 'create', volume);
      const base = await start(containers[0], volumes[0]);
      for (const path of ['/', '/dashboard']) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /text\/html/);
        const html = await response.text();
        const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
        assert.ok(assetPath, 'built HTML references a JavaScript bundle');
        const asset = await fetch(new URL(assetPath, base));
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get('content-type') ?? '', /javascript/);
        assert.ok((await asset.text()).length > 0);
      }
      const missing = await fetch(`${base}/api/missing`);
      assert.equal(missing.status, 404);
      assert.deepEqual(await missing.json(), { error: 'Not found' });

      assert.equal((await fetch(`${base}/api/services`)).status, 401);
      const setup = await fetch(`${base}/api/auth/setup`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ...credentials, setupToken }),
      });
      assert.equal(setup.status, 201);
      cookie = setup.headers.get('set-cookie')!.split(';')[0];

      // The container's own health endpoint is a deterministic local HTTP target.
      const created = await fetch(`${base}/api/services`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: 'Container health',
          url: 'http://127.0.0.1:3000/api/health',
          intervalMs: 60_000,
        }),
      });
      assert.equal(created.status, 201);
      const service = (await created.json()) as Service;
      const original = await eventually(
        async () => (await history(base, service.id))[0],
      );
      assert.equal(original.healthy, true);
      assert.equal(original.httpStatus, 200);
      // Freeze the dataset so a new sample cannot disguise data loss.
      const disabled = await fetch(`${base}/api/services/${service.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(disabled.status, 200);
      const savedService = (await disabled.json()) as Service;

      await stop(containers[0]);
      await docker('rm', containers[0]);
      const replacement = await start(containers[1], volumes[0]);
      async function verify(baseUrl: string): Promise<void> {
        const response = await fetch(`${baseUrl}/api/services`, {
          headers: authHeaders(),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), [savedService]);
        assert.deepEqual(await history(baseUrl, service.id), [original]);
      }
      await verify(replacement);
      await stop(containers[1]);

      await docker(
        'run',
        '--rm',
        '--user',
        '0:0',
        '-v',
        `${volumes[0]}:/data:ro`,
        '-v',
        `${volumes[1]}:/backup`,
        '--entrypoint',
        'tar',
        image,
        '-czf',
        '/backup/sentinel.tar.gz',
        '-C',
        '/data',
        '.',
      );
      await docker(
        'run',
        '--rm',
        '--user',
        '0:0',
        '-v',
        `${volumes[2]}:/data`,
        '-v',
        `${volumes[1]}:/backup:ro`,
        '--entrypoint',
        'tar',
        image,
        '-xzf',
        '/backup/sentinel.tar.gz',
        '-C',
        '/data',
      );
      await docker(
        'run',
        '--rm',
        '--user',
        '0:0',
        '-v',
        `${volumes[2]}:/data`,
        '--entrypoint',
        'chown',
        image,
        '-R',
        '1000:1000',
        '/data',
      );
      const restored = await start(containers[2], volumes[2]);
      await verify(restored);
      const login = await fetch(`${restored}/api/auth/login`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(credentials),
      });
      assert.equal(login.status, 200);
      cookie = login.headers.get('set-cookie')!.split(';')[0];
      await verify(restored);
      const logout = await fetch(`${restored}/api/auth/logout`, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      assert.equal(logout.status, 204);
      assert.equal(
        (await fetch(`${restored}/api/services`, { headers: authHeaders() }))
          .status,
        401,
      );
      await stop(containers[2]);
      await docker('cp', `${containers[2]}:/data/.`, directory);
      const database = new DatabaseSync(join(directory, 'sentinel.sqlite'), {
        readOnly: true,
      });
      try {
        assert.deepEqual(
          database
            .prepare('PRAGMA integrity_check')
            .all()
            .map((row) => row.integrity_check),
          ['ok'],
        );
      } finally {
        database.close();
      }
    } catch (error) {
      for (const name of containers) {
        const logs = await docker('logs', name).catch(() => undefined);
        if (logs) t.diagnostic(`${name}: ${logs}`);
      }
      throw error;
    }
  },
);
