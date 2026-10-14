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

Sentinel runs as a single container with the dashboard, API, and service checker.
Docker Compose builds the image and creates a persistent SQLite data volume. You
only need Git, Docker Engine, and the Docker Compose plugin on the host; Node.js
and npm are included in the image.

### Install and start

1. Install Docker Engine and the Docker Compose plugin for your operating system.
   Start Docker and confirm your user can access it:

   ```sh
   docker version
   docker compose version
   ```

   `docker version` should show both client and server details. If access is
   denied on Linux, configure Docker access for your user and log in again before
   continuing.

2. Clone the repository and enter its directory. Run the remaining Compose
   commands from this directory:

   ```sh
   git clone https://github.com/luisweigl/Sentinel.git
   cd Sentinel
   ```

3. Choose how you want to access the dashboard in `compose.yaml`. The default
   mapping, `127.0.0.1:3000:3000`, makes it available only on the Docker host.
   Use `127.0.0.1:8080:3000` for a different host port, or replace `127.0.0.1`
   with the server's LAN IP to allow access from your network. Leave the final
   `3000` unchanged unless you also change the container's `PORT` setting.

   Sentinel has no application authentication. Restrict access to a trusted
   network or use an authenticating reverse proxy. For HTTPS, configure your
   reverse proxy to forward to `http://127.0.0.1:3000`. A proxy in another
   container needs a shared Docker network and the upstream `http://sentinel:3000`.

4. Build and start Sentinel in the background:

   ```sh
   docker compose up --build -d
   docker compose ps
   ```

   The first build downloads the base image and installs dependencies. Compose
   creates the `sentinel-data` volume automatically; no database setup is needed.
   Wait for the service to report `healthy`. If it fails to start, inspect its logs:

   ```sh
   docker compose logs --tail=100 sentinel
   ```

5. Open http://localhost:3000 on the Docker host, or use the server address and
   host port you configured. Add your first service through the dashboard using
   an HTTP or HTTPS URL reachable from inside the container.

   `localhost` in a monitored URL refers to the Sentinel container. For other
   services, use a reachable LAN address or a Docker service name on a shared
   network.

### Configuration

The supplied `compose.yaml` includes the settings needed to run Sentinel:

| Variable | Container setting | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | Serves the built dashboard alongside the API. |
| `HOST` | `0.0.0.0` | Accepts connections inside the container. |
| `PORT` | `3000` | HTTP listening port; integer from 1 to 65535. |
| `DATABASE_PATH` | `/data/sentinel.sqlite` | SQLite file inside the persistent volume. |

Edit the service's `environment` in `compose.yaml`, then run
`docker compose up -d` to apply changes. If changing the internal port, also
update the port mapping. Keep `DATABASE_PATH` inside `/data`.

Service check intervals and timeouts are configured per service through the UI or
API. There is currently no automatic history cleanup, so allow space for growing
history.

### Persistent storage

The named volume `sentinel-data` holds service settings and history at `/data`.
It survives container replacement and image upgrades. Run one Sentinel instance
per database. For additional deployments on the same Docker host, use distinct
volume names and host ports.

To store data in a host directory instead, replace `sentinel-data:/data` with
`./data:/data` in the service's `volumes` list. Create the directory and grant the
container user (UID/GID `1000:1000`) write access before starting:

```sh
mkdir -p data
sudo chown 1000:1000 data
```

On hosts with SELinux enforcing, the bind mount may also need the `:Z` label.
Keep the entire data directory together; SQLite may create `-wal` and `-shm`
files alongside the database.

### Stop, restart, and update

Stop and start the existing container:

```sh
docker compose stop
docker compose start
```

Compose restarts Sentinel automatically after a process exit or Docker restart.
It allows 60 seconds for a clean shutdown. Increase `stop_grace_period` if your
configured service timeouts can exceed that period.

To update the installation, pull the latest source and rebuild:

```sh
git pull
docker compose up --build -d
docker compose ps
```

Database migrations run automatically at startup. To remove the container while
keeping its data, use `docker compose down`. **Adding `-v` deletes the data volume
and its history.**

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
