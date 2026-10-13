# Sentinel

Sentinel is a service monitoring dashboard built with TypeScript, React + Vite,
Node.js + Express, and SQLite. It periodically checks HTTP/HTTPS services and
shows their status, response time, uptime, and check history.

See [PROJECT.md](PROJECT.md) for the project plan.

## Development

Requirements: Node.js **22.13 or newer** and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Vite serves the frontend and proxies `/api` requests
to Express at http://127.0.0.1:3000. Both processes reload on source changes.

Frontend code lives in `src/client/`; backend code lives in `src/server/`.

## Testing

```sh
npm test
npm run typecheck
```

Tests cover the API, database, health checks, scheduler, and client logic.
Run `npm run build` to verify the frontend and backend compile.

## Database

Sentinel uses **SQLite**, with no separate database server required. The backend
creates `data/sentinel.sqlite` and applies migrations automatically on startup.
It stores service configurations and check history. Set `DATABASE_PATH` to use
another database file. Tests use temporary databases.

## API

The Express API uses JSON under `/api`. POST and PATCH requests require
`Content-Type: application/json`.

| Method | Route | Purpose |
| ------ | ----- | ------- |
| GET | `/api/health` | Check whether Sentinel is running. |
| GET | `/api/services` | List services. |
| POST | `/api/services` | Create a service. |
| PATCH | `/api/services/:id` | Edit, enable, or disable a service. |
| DELETE | `/api/services/:id` | Delete a service and its history. |
| GET | `/api/services/overview` | Get services with their latest results and uptime. |
| GET | `/api/services/:id/history` | Get a service's latest result, uptime, and paginated history. |

Creating a service requires `name` and an HTTP/HTTPS `url`. Optional fields are
`intervalMs` (default `60000`), `timeoutMs` (default `10000`), and `enabled`
(default `true`). PATCH updates only the supplied fields.

Overview and history accept `window=24h`, `7d`, or `30d` (default `24h`). History
also accepts `page` (default `1`). Errors return JSON with an `error` message
and an appropriate HTTP status code.
