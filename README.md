# Sentinel

Self-hosted service monitoring dashboard built with React, Express, and SQLite.
The dashboard uses the API for service management, latest check results, uptime,
and paginated history, refreshing monitoring data every ten seconds.
See [PROJECT.md](PROJECT.md) for the implementation plan.

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
Service management is available through the API below. The scheduler automatically
checks enabled services and stores results in SQLite.

Schema migrations are ordered SQL entries in `src/server/migrations.ts`, tracked
with SQLite's `user_version` and applied in a transaction. Add new entries rather
than editing migrations already deployed. A newer, unsupported database version
is rejected. Tests use temporary databases, never the configured application file.

## Service management API

| Method | Path                | Result                                        |
| ------ | ------------------- | --------------------------------------------- |
| GET    | `/api/services`     | List service configurations (200).            |
| POST   | `/api/services`     | Create a service (201).                       |
| PATCH  | `/api/services/:id` | Edit fields, including `enabled` (200).       |
| DELETE | `/api/services/:id` | Delete a service and its check results (204). |

POST and PATCH require `Content-Type: application/json`. Creation requires `name`
(non-empty string) and `url` (absolute HTTP/HTTPS URL). Optional fields are
`intervalMs` (default 60000), `timeoutMs` (default 10000), and `enabled` (default
true). Durations must be positive safe integers in milliseconds. PATCH requires
at least one supported field and preserves omitted fields. Names and URLs are
trimmed; null values and unknown fields are rejected.

Invalid input or IDs return 400; missing services return 404, unsupported content
types return 415, and oversized JSON bodies return 413. Errors have the shape
`{"error":"message"}`. Service objects contain `id`, `name`, `url`, `intervalMs`,
`timeoutMs`, `enabled`, and `createdAt` (Unix milliseconds).

## Dashboard read API

- `GET /api/services/overview?window=24h` returns service configurations with each
  service's latest result and uptime summary, plus the snapshot timestamp `asOf`.
- `GET /api/services/:id/history?window=24h&page=1` returns the latest result,
  uptime summary, and a newest-first history page of six results, including the
  total matching count and `asOf` timestamp. Missing services return 404.

Both routes accept `window=24h`, `7d`, or `30d` (default `24h`). An optional `to`
Unix timestamp in milliseconds fixes the window end for consistent pagination;
it must be a non-negative safe integer no later than the current time. Windows
include their start and exclude their end. Invalid query values return 400.
Services without checks have a null latest result and null uptime, not zero uptime.
