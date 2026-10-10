# Sentinel

Self-hosted service monitoring dashboard. This initial foundation contains a React
placeholder, an Express server, and SQLite persistence. Monitoring features are
not yet implemented. See [PROJECT.md](PROJECT.md) for the implementation plan.

## Requirements

- Node.js 22.13 or newer (built-in SQLite requires no additional database package)
- npm

## Development

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Vite serves React and proxies `/api` requests to
Express on http://127.0.0.1:3000. Both processes restart as source files change and
stop together when you press Ctrl+C.

`GET /api/health` returns `{"status":"ok"}` to confirm Sentinel itself is running.
It does not check any external services.

## Verification

```sh
npm test
npm run build
```

Tests use Node's built-in test runner through `tsx`. The build first type-checks
the frontend, backend, configuration, and tests, then creates `dist/client` and
`dist/server`. Run `npm run typecheck` for type checking alone.

## Production

```sh
npm run build
npm start
```

Express serves the built frontend and API together at http://127.0.0.1:3000.
The start command uses POSIX shell environment syntax, suitable for Linux
self-hosting.

`HOST` and `PORT` configure the Express listener; defaults are `127.0.0.1` and
`3000`. For example, `HOST=0.0.0.0 PORT=8080 npm start`. During development, keep
port 3000 unless you also update the proxy target in `vite.config.ts`.

## Database

The server opens `data/sentinel.sqlite` on startup, creating its parent directory
and applying pending migrations automatically. Set `DATABASE_PATH` to use another
file, for example `DATABASE_PATH=/srv/sentinel/sentinel.sqlite npm start`.
Relative paths resolve from the working directory. `:memory:` is also supported.

SQLite uses WAL mode, foreign keys, and a five-second busy timeout. The connection
closes when the server shuts down. Node.js 22 may print an experimental warning
for its built-in SQLite API.

The database stores service configuration and check results, including nullable
HTTP status, response time, and error information. Timestamps are Unix milliseconds;
intervals and durations are milliseconds. Deleting a service also deletes its
check results. Typed persistence functions live in `src/server/persistence.ts`.
There are no service API routes or automatic checks yet.

Schema migrations are ordered SQL entries in `src/server/migrations.ts`, tracked
with SQLite's `user_version` and applied in a transaction. Add new entries rather
than editing migrations already deployed. A newer, unsupported database version
is rejected. Tests use temporary databases, never the configured application file.
