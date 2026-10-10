# Sentinel

self-hosted service monitoring dashboard.

## Goals for MVP

- Add Services
- Periodically check services for health
- track uptime
- check and store latency, status and response time
- show status of all services


# Tasks

| Step | Work | Verification |
|---|---|---|
| 1. Project foundation | Configure TypeScript, React/Vite, Express, development commands, build, and test runner. | Type checking, build, and server smoke test. |
| 2. Database foundation | Add SQLite connection, initial migration, tables, indexes, and persistence functions. | Temporary-database tests for persistence, constraints, and migrations. |
| 3. Service management | Implement create, list, edit, enable/disable, and delete endpoints with input validation. | API tests for valid requests, invalid input, and missing services. |
| 4. Health checker | Implement HTTP checks, timeout handling, status classification, and duration measurement. | Local HTTP-server tests for healthy responses, failures, timeouts, and redirects. |
| 5. Scheduler | Schedule due checks, prevent overlap, bound concurrency, persist results, and stop cleanly. | Controlled-time tests for scheduling, overlap prevention, and disabled services. |
| 6. History and uptime | Implement latest-result queries, uptime windows, paginated history, and retention cleanup. | Database tests for window boundaries, empty history, failures, and cleanup. |
| 7. Dashboard | Build service overview, add/edit forms, detail history, polling, and loading/error states. | UI tests for core interactions and one end-to-end add-service-to-result flow. |
| 8. Self-hosting package | Add container packaging, persistent storage configuration, configuration documentation, and backup instructions. | Production-build smoke test and restart test confirming history survives. |