# Sentinel

Self-hosted service monitoring dashboard. This initial foundation contains a React
placeholder and an Express server; monitoring and database features are not yet
implemented. See [PROJECT.md](PROJECT.md) for the implementation plan.

## Requirements

- Node.js 22.12 or newer
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
