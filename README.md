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

## Self-hosting with Docker

Requirements: Docker Engine and the Docker Compose plugin. From a checkout:

```sh
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
docker compose logs --tail=100 -f sentinel
```

Open http://127.0.0.1:3000. One non-root Node process serves the built dashboard,
API, and scheduler. The image uses Node 22.22.0 and installs dependencies from the
lockfile. The health check verifies HTTP availability; it does not indicate that
all monitored services are healthy. Docker marks failed probes unhealthy; the
restart policy restarts exited processes, not merely unhealthy ones.

The default port mapping only allows access from the Docker host. To change the
host port, change `127.0.0.1:3000:3000` in `compose.yaml`, for example to
`127.0.0.1:8080:3000`. To allow trusted LAN clients, replace `127.0.0.1` with the
host's LAN address. Sentinel currently has no application authentication: protect
access using your network or an authenticating reverse proxy. For HTTPS, configure
your existing reverse proxy to forward to `http://127.0.0.1:3000`. A proxy running
in a container needs a shared Docker network and the upstream `http://sentinel:3000`.

### Configuration

| Variable | Application default | Container setting | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | Unset | `production` | Enables serving the built frontend. |
| `HOST` | `127.0.0.1` | `0.0.0.0` | Address bound inside the container. |
| `PORT` | `3000` | `3000` | HTTP listening port; integer from 1 to 65535. |
| `DATABASE_PATH` | `data/sentinel.sqlite` | `/data/sentinel.sqlite` | SQLite file; parent directory must be writable. |

Edit the service's `environment` in `compose.yaml` and recreate the container to
apply changes. If changing the internal port, also update the port mapping.
Keep `DATABASE_PATH` inside the mounted data directory. Outside Docker, production
startup is `npm ci`, `npm run build`, then `npm start`.

Service check intervals and timeouts are configured per service through the UI or
API. The scheduler runs up to four checks concurrently. There is currently no
automatic history cleanup; allow space for growing history and backups.

### Storage, networking, and lifecycle

The named volume `sentinel-data` mounts at `/data` and holds service settings and
history. Persist the entire directory: SQLite WAL mode can also use
`sentinel.sqlite-wal` and `sentinel.sqlite-shm`. Run one Sentinel instance per
database. The fixed volume name assumes one deployment per Docker host; use a
distinct volume name for additional deployments and adapt backup commands.

For a bind mount, replace `sentinel-data:/data` with `./data:/data`. Create the
directory first and grant the container user (UID/GID `1000:1000`) write access:

```sh
mkdir -p data
sudo chown 1000:1000 data
```

On hosts with SELinux enforcing, the bind mount may also need the `:Z` label.
The backup commands below assume the default named-volume setup.

Monitored URLs must be reachable from inside the container. `localhost` refers to
Sentinel itself; use Docker service names on shared networks or reachable host/LAN
addresses for other services. On Linux, reaching a host service through
`host.docker.internal` requires an explicit host-gateway mapping and a host service
that listens on a reachable interface.

```sh
docker compose stop
docker compose start
docker compose down
docker compose up -d
```

Stopping or removing containers preserves the named volume. **`docker compose
down -v` deletes the volume and its history.** SIGTERM stops new checks, waits for
active checks and HTTP connections, then closes SQLite. Compose allows 60 seconds
before forcing termination. Increase `stop_grace_period` if service check timeouts
or active HTTP connections can exceed that period.

To upgrade, make a backup first, update the checkout, then run:

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 sentinel
```

Database migrations run automatically at startup. For a rollback after a schema
change, restore the pre-upgrade backup and use its matching application version.

### Backup and restore

Use an offline backup for a consistent snapshot. Stop Sentinel and confirm it
exited normally before archiving. Do not copy only the main SQLite file while the
application runs: committed data may still be in the WAL file.

Run from the checkout, with the locally built `sentinel:local` image available:

```sh
mkdir -p backups
docker compose stop sentinel
docker compose ps -a
docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$(docker compose ps -aq sentinel)"
```

Confirm the inspection reports `exited 0`. If shutdown was forced or failed,
inspect the logs before continuing. Choose a new filename for each backup:

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  -v sentinel-data:/data:ro -v "$PWD/backups:/backup" \
  --entrypoint tar sentinel:local \
  -czf /backup/sentinel-before-upgrade.tar.gz -C /data .
docker compose start sentinel
```

Only restart after the archive command succeeds. Keep copies of the archive off
the Docker host and record the application revision used to create it. Archives
contain monitored service URLs; restrict access appropriately.

To restore, first back up the current deployment and stop/remove its container
with `docker compose down` (without `-v`). Restore into a **new, empty volume**:

```sh
docker volume create sentinel-restored-data
docker run --rm --user 0:0 \
  -v sentinel-restored-data:/data -v "$PWD/backups:/backup:ro" \
  --entrypoint tar sentinel:local \
  -xzf /backup/sentinel-before-upgrade.tar.gz -C /data
docker run --rm --user 0:0 -v sentinel-restored-data:/data \
  --entrypoint chown sentinel:local -R 1000:1000 /data
```

Change the top-level volume's `name` in `compose.yaml` from `sentinel-data` to
`sentinel-restored-data`; leave the service mount `sentinel-data:/data` unchanged.
The old volume remains available for recovery. Using the matching application
checkout, run `docker compose up --build -d`, check `/api/health`, and confirm the
expected services and original history in the dashboard. Subsequent backup
commands must use the new volume name. Never extract over an active database or
mix a restored database with existing WAL files.

### Container verification

```sh
npm test
npm run build
npm run test:container
```

The last command requires access to a Docker daemon and registry access for the
initial image build. It validates Compose configuration, builds the image, checks
production HTML/assets/API responses, persists a successful HTTP check, replaces
the container, and restores an offline archive into another volume. It verifies
the exact original history and runs SQLite `integrity_check` on the restored data.
It uses isolated names and dynamic host ports, and removes its own containers,
volumes, and image afterward. If interrupted forcibly, remove only resources
with that run's `sentinel-test-<UUID>` prefix.

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
