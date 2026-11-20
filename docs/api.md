# API

Base path `/api/v1`, same origin as the SPA, JSON only.

## Conventions

- Success: `{ "data": ..., "meta"?: {...} }`. Error: `{ "error": { "code", "message", "details"? } }`.
- 5xx responses never include internal messages or stack traces; details go to server logs only, without PII or secrets.
- Pagination: max page size 100 (`MAX_PAGE_SIZE` in `@agency-crm/shared`); sort only on allowlisted columns.
- Timestamps are RFC 3339 UTC. The server owns IDs and `created_at`.
- Request bodies are limited to 1 MiB by default.
- Validation: Zod schemas in `packages/shared` are reused by both the API and the web app. The OpenAPI generation strategy will be decided when the first CRUD module lands.

## Endpoints

### `GET /api/v1/health`

Public. No PII.

```json
{ "data": { "status": "ok", "db": "ok", "version": "0.0.0", "time": "2026-11-20T10:00:00.000Z" } }
```

Returns 503 with `status: "degraded"` if the DB ping fails.

### Any unknown `/api/*` route

`404 { "error": { "code": "NOT_FOUND", "message": "Route not found" } }`
