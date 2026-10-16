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

For a new database, set a setup token before starting the development server:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
SENTINEL_SETUP_TOKEN=<generated-token> npm run dev
```

Enter that token in the first-run form and create your administrator account.
Restart without the token afterward. Development uses non-secure cookies and
expects the browser origin `http://localhost:5173`.

Frontend code lives in `src/client/`; backend code lives in `src/server/`.

## Testing

```sh
npm test
npm run typecheck
npm run format:check
```

Tests cover the API, database, health checks, scheduler, and client logic.
Run `npm run build` to verify the frontend and backend compile. Use
`npm run format` after editing source or configuration.

## Database

Sentinel uses **SQLite**, with no separate database server required. The backend
creates `data/sentinel.sqlite` and applies migrations automatically on startup.
It stores service configurations, check history, the administrator password hash,
and session token hashes. Set `DATABASE_PATH` to use
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

   Configure an HTTPS reverse proxy to forward to `http://127.0.0.1:3000`.
   A proxy in another container needs a shared Docker network and the upstream
   `http://sentinel:3000`. Set your exact browser origin and an initial setup
   token in a local `.env` file beside `compose.yaml` (keep this file private):

   ```dotenv
   SENTINEL_PUBLIC_ORIGIN=https://sentinel.example.com
   SENTINEL_SETUP_TOKEN=<generated-token>
   ```

   Generate the token with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'`.
   Replace the example origin with your actual origin, including a port when
   needed, and no trailing slash or path. The Compose fallback origin is only
   a placeholder; it must match the browser origin for write requests.

   For direct HTTP on a trusted local network, explicitly configure both:

   ```dotenv
   SENTINEL_PUBLIC_ORIGIN=http://localhost:3000
   SENTINEL_ALLOW_HTTP=true
   ```

   HTTPS is the default. HTTP opt-in disables the cookie's `Secure` flag.

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

5. Open the browser origin you configured. Enter your setup token, choose a
   username and password, and create the administrator. Setup also signs you in.
   Remove `SENTINEL_SETUP_TOKEN` from `.env`, then run `docker compose up -d`
   again. Once an administrator exists, setup is permanently disabled even if
   the token remains configured.

   Add your first service through the dashboard using an HTTP or HTTPS URL
   reachable from inside the container.

   `localhost` in a monitored URL refers to the Sentinel container. For other
   services, use a reachable LAN address or a Docker service name on a shared
   network.

### Configuration

The supplied `compose.yaml` includes the settings needed to run Sentinel:

| Variable                    | Container setting                 | Purpose                                                                       |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `NODE_ENV`                  | `production`                      | Serves the built dashboard alongside the API.                                 |
| `HOST`                      | `0.0.0.0`                         | Accepts connections inside the container.                                     |
| `PORT`                      | `3000`                            | HTTP listening port; integer from 1 to 65535.                                 |
| `DATABASE_PATH`             | `/data/sentinel.sqlite`           | SQLite file inside the persistent volume.                                     |
| `SENTINEL_PUBLIC_ORIGIN`    | HTTPS example; configure your own | Required production browser origin, without a trailing slash or path.         |
| `SENTINEL_ALLOW_HTTP`       | `false`                           | Explicitly allow production HTTP and non-secure cookies.                      |
| `SENTINEL_SETUP_TOKEN`      | unset                             | At least 32 random bytes encoded as base64url; needed only for initial setup. |
| `SENTINEL_TRUST_PROXY_HOPS` | `0`                               | Number of trusted proxy hops used for client-IP rate limiting.                |

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
volume names and host ports. Backups also contain password and session hashes;
protect them like credentials. Restoring a backup can restore sessions that have
not yet expired. Run the password-reset command after a restore if you need to
revoke them.

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

Database migrations run automatically at startup. Upgrading from a version
without authentication preserves service data and history, immediately protects
all service APIs, and leaves monitoring running. Configure your browser origin
and setup token before upgrading, then complete the first-run form.

To remove the container while
keeping its data, use `docker compose down`. **Adding `-v` deletes the data volume
and its history.**

## API

The Express API uses JSON under `/api`. All service endpoints require the
administrator session cookie. POST and PATCH requests require
`Content-Type: application/json`. Every state-changing request also requires
`X-Sentinel-Request: 1`; if an `Origin` header is present it must exactly match
`SENTINEL_PUBLIC_ORIGIN`. Cross-origin API access is not enabled. Bodyless DELETE
requests do not require a content type. API responses use `Cache-Control: no-store`.

| Method | Authentication route | Purpose                                                                                |
| ------ | -------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/api/auth/session`  | Return authentication and initial-setup availability.                                  |
| POST   | `/api/auth/setup`    | Create the singleton administrator with `{ setupToken, username, password }`; sign in. |
| POST   | `/api/auth/login`    | Sign in with `{ username, password }`.                                                 |
| POST   | `/api/auth/logout`   | Revoke the current session; send an empty JSON object.                                 |

Setup/login return `{ user: { username } }` and set an HTTP-only session cookie.
Session status returns `{ authenticated, setupRequired, setupEnabled, user }`,
where `user` is `{ username }` or `null`. Setup returns `503` if no setup token is
configured, `403` for an invalid token, and `409` once an administrator exists.
Protected service requests return `401` when the session is missing or expired.
The public `/api/health` endpoint remains available for probes.

| Method | Route                       | Purpose                                                       |
| ------ | --------------------------- | ------------------------------------------------------------- |
| GET    | `/api/health`               | Check whether Sentinel is running.                            |
| GET    | `/api/services`             | List services.                                                |
| POST   | `/api/services`             | Create a service.                                             |
| PATCH  | `/api/services/:id`         | Edit, enable, or disable a service.                           |
| DELETE | `/api/services/:id`         | Delete a service and its history.                             |
| GET    | `/api/services/overview`    | Get services with their latest results and uptime.            |
| GET    | `/api/services/:id/history` | Get a service's latest result, uptime, and paginated history. |

Creating a service requires `name` and an HTTP/HTTPS `url`. Optional fields are
`intervalMs` (default `60000`), `timeoutMs` (default `10000`), and `enabled`
(default `true`). PATCH updates only the supplied fields.

Overview and history accept `window=24h`, `7d`, or `30d` (default `24h`). History
also accepts `page` (default `1`). Errors return JSON with an `error` message
and an appropriate HTTP status code.

## Administrator access and recovery

Sentinel supports one administrator; all service status, history, and management
require login. Usernames are trimmed and lowercased, with 3–64 ASCII letters,
digits, underscores, periods, or hyphens. Passwords contain 15–128 Unicode
characters, with no trimming or composition rules. Use a long unique passphrase.
There is no public registration or email password recovery.

Sessions expire seven days after login, survive restarts, and do not renew
implicitly. Sign out revokes the current session. Password reset revokes every
session. Expired session records are removed at startup and hourly.

Setup and login share limits of 10 attempts per IP and 50 total attempts per
15 minutes. Responses use `429` and `Retry-After`. At most two password hashes
are computed concurrently; excess requests receive `429`. Limits reset on
process restart. The bounded IP counter map holds at most 10,000 entries.

Behind a reverse proxy, keep `SENTINEL_TRUST_PROXY_HOPS=0` unless the proxy is
controlled by you. To enable accurate IP limiting, set the exact trusted hop
count, ensure every request follows that topology, prevent direct backend
access, and have the proxy overwrite untrusted forwarding headers. Cookie
security comes from the configured HTTPS origin, never forwarded headers.

To reset the existing administrator password from a terminal:

```sh
# Development/source checkout
npm run admin:reset

# Built production checkout
npm run admin:reset:production

# Running Docker Compose service
docker compose exec sentinel npm run admin:reset:production
```

Use the same `DATABASE_PATH` as the server. The command hides both password
entries, retains the username, and atomically replaces the password and revokes
all sessions. It can run while Sentinel is running. Mismatch or cancellation
leaves credentials unchanged. It requires an interactive terminal and accepts
no password arguments.

## Task 9 browser acceptance checklist

The automated suite exercises real authentication endpoints, client API calls,
SQLite migration/persistence, form markup and validation, session state changes,
request cancellation, and recovery. It uses no browser-testing dependency.
Before release, also verify the following in a real browser:

1. With a fresh database, complete initial setup; confirm password mismatch and
   invalid token errors, then reach Services after successful setup.
2. Sign out, test empty fields and invalid credentials, then sign in successfully.
3. Refresh and confirm the session persists. Add, edit, pause, and delete a service.
4. Expire the session using an isolated test database and confirm the next request
   removes service data and shows “Your session has expired.”
5. Sign out in another tab, then focus the original tab and confirm it shows login.
6. Check offline errors, pending submission, and retry behavior for login and logout.
7. Navigate using only the keyboard; check labels, focus, and error announcements.
8. At a 320px viewport and with the on-screen keyboard open, confirm the centered
   form stays readable and scrollable without horizontal overflow.
9. Verify production HTTPS cookies have `Secure`, and explicit local HTTP works.

### Task 9 verification record — 2026-10-16

- Passed all 63 Node/API/client tests, type checking, production build, formatting
  checks, and `docker compose config --quiet`.
- Ran a temporary Chrome DevTools walkthrough against the real production build
  and an isolated SQLite database, without adding browser test dependencies.
  Verified setup validation and invalid tokens, invalid and valid login,
  HTTP-only cookies, refresh and server-restart persistence, service
  add/edit/pause/resume/delete, offline login/logout retries, pending submission,
  expiry through a protected request, focus-triggered logout detection, Tab
  navigation, and no horizontal overflow at 320px. Inspected desktop and narrow
  viewport screenshots against the approved centered-box layout.
- The container suite was attempted but could not access `/var/run/docker.sock`
  (`permission denied`), including outside the execution sandbox. Container image
  build, replacement, and backup/restore verification remain pending.
- Physical mobile on-screen keyboard and screen-reader announcement checks remain
  manual release checks; the browser walkthrough used headless Chrome.
