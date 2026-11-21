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

## Authentication and security model

- **Default-deny:** every `/api/v1` route requires a valid session unless it is declared with `config: { public: true }`. Public routes: `GET /health`, `POST /auth/login`. Unknown routes return `401` without a session (no route enumeration) and `404` with one.
- **Session:** the `crm_session` cookie holds a random 256-bit token: `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` over HTTPS. The DB stores only its SHA-256. It expires after `SESSION_TTL_HOURS` (12) or `SESSION_IDLE_MINUTES` (120) idle. The user's `is_active` is re-checked on **every** request.
- **CSRF / cross-origin:** POST/PATCH/PUT/DELETE require an `Origin` (or `Referer`) equal to the request host, or listed in `TRUSTED_ORIGINS`. Otherwise `403 CSRF_ORIGIN`. Only `application/json` bodies are parsed; form/text bodies get `415`.
- **Headers:** strict CSP (`'self'` only, `frame-ancestors 'none'`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, and `Cache-Control: no-store` on API responses.
- **Errors:**
  - `401 UNAUTHENTICATED`: no valid session.
  - `401 INVALID_CREDENTIALS`: the same response for an unknown email, a wrong password and a disabled account.
  - `403 FORBIDDEN`: you can see the resource, but your role can't do this action.
  - `404 NOT_FOUND`: the resource doesn't exist **or** you have no access to its client; the two are indistinguishable.
  - `409`: conflicts.
  - `422 VALIDATION`: `details` lists field paths and codes only, never the submitted values.
  - `429 RATE_LIMITED`: comes with `Retry-After`.

## Auth

| Method | Path           | Who     | Notes                                                                                                                                                                                   |
| ------ | -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`  | public  | `{email, password}` → `{data:{user}}` + Set-Cookie. A new token on every login; the presented old token is revoked. Rate limit: 5 failures per account, 30 attempts per IP, per 15 min. |
| POST   | `/auth/logout` | session | Revokes the session server-side and clears the cookie.                                                                                                                                  |
| GET    | `/auth/me`     | session | `{data:{user}}`                                                                                                                                                                         |

`user` = `{id, email, displayName, role, isActive, status, createdAt}`, where `status` is `active`, `pending` (self-signup awaiting approval) or `disabled`. The password hash is never returned.

### Self-signup

| Method | Path            | Who    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/auth/options` | public | `{data:{signupEnabled}}`. The login page uses it to show or hide the sign-up button (`SELF_SIGNUP` env).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| POST   | `/auth/signup`  | public | `{email, displayName, password}`. Creates an **employee with no client memberships** (a `role` in the body is ignored). **Default:** the account is active and logged in at once → **201** `{data:{status:"active", user}}` + session cookie; an existing email → `409 EMAIL_TAKEN`. **With `SIGNUP_REQUIRES_APPROVAL=true`:** → **202** `{data:{status:"pending"}}`, no session; the same answer for existing emails (no enumeration). Same password policy as `/users`. 5 per IP per hour. `404` when `SELF_SIGNUP=false`. |

In approval mode, an admin approves a pending account with `POST /users/:id/enable`, which sets `approved_at` and activates it. `GET /auth/options` returns `{signupEnabled, signupRequiresApproval}`.

## Users (admin only)

| Method | Path                 | Notes                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/users`             | All users                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/users`             | `{email, displayName, role, password}` → 201. Password policy (`packages/shared/src/password-policy.ts`, same rules shown live in the form): 8–256 chars, at least one letter, one digit and one symbol, no leading/trailing space, mustn't contain the email name. Violations: `422 VALIDATION` with `message` = the rule code (e.g. `PASSWORD_NEEDS_SYMBOL`). `409 EMAIL_TAKEN`. |
| PATCH  | `/users/:id/role`    | `{role}`. **Revokes all of the user's sessions.** `409 CANNOT_CHANGE_OWN_ROLE`, `409 LAST_ADMIN`.                                                                                                                                                                                                                                                                                  |
| POST   | `/users/:id/disable` | Revokes all sessions; access ends immediately. `409 CANNOT_DISABLE_SELF`, `409 LAST_ADMIN`.                                                                                                                                                                                                                                                                                        |
| POST   | `/users/:id/enable`  |                                                                                                                                                                                                                                                                                                                                                                                    |

The first admin is created only by the host CLI `pnpm auth:create-admin`. There is no HTTP route for it.

## Clients, members, leads

These routes are minimal, to exercise authorization; full CRUD comes in later phases. Every route goes through `authorizeClientAccess(actor, clientId, action)` (`apps/api/src/modules/auth/authorize.ts`).

| Method | Path                           | Action               | Notes                                                                                                                |
| ------ | ------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/clients`                     | —                    | Query-scoped: admins see all, others only their memberships                                                          |
| GET    | `/clients/:id`                 | client:read          |                                                                                                                      |
| GET    | `/clients/:id/members`         | client:read          |                                                                                                                      |
| POST   | `/clients/:id/members`         | client:manageMembers | `{userId, membershipRole?}`. Managers: only on clients they own. They may add collaborators, never owners or admins. |
| DELETE | `/clients/:id/members/:userId` | client:manageMembers | Managers can't remove owners. The removed user loses access on the next request.                                     |
| GET    | `/clients/:id/leads`           | lead:read            | Max 100, newest first                                                                                                |
| GET    | `/leads/:id`                   | lead:read            |                                                                                                                      |
| POST   | `/leads/:id/activities`        | lead:write           | `{type: note/call/whatsapp/email/meeting, body?, occurredAt?}`; `occurredAt` must include a timezone                 |
