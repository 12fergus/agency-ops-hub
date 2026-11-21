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

The first admin is created without any admin session, in one of three ways: the **setup page** (below), `INITIAL_ADMIN_*` environment variables at startup, or the host CLI `pnpm auth:create-admin`. All three work only while no login-capable admin exists.

### First-run setup

| Method | Path            | Who    | Notes                                                                                                                                                                                                                                                                                                                                                      |
| ------ | --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/setup/status` | public | `{data:{needsSetup}}`: true while the DB is migrated and has no admin who can log in. Also makes sure the one-time code file exists.                                                                                                                                                                                                                       |
| POST   | `/setup`        | public | `{code, email, displayName, password}`. The code is the one-time value from `setup-code.txt` next to the DB (case-insensitive, dashes optional, compared in constant time). → **201** `{data:{user}}` + session cookie (the new admin is logged in). Wrong code → `403 SETUP_CODE_INVALID`. 10 attempts per IP per 15 min. **`404` once an admin exists.** |

## Clients (Phase 3)

All routes go through `authorizeClientAccess(actor, clientId, action)` (`apps/api/src/modules/auth/authorize.ts`). Clients a user can't access answer **404**, the same as non-existent ones. Clients are **archived, never deleted**: there is no DELETE route.

| Action                                        | admin            | owner-manager         | collaborator manager / employee | non-member       |
| --------------------------------------------- | ---------------- | --------------------- | ------------------------------- | ---------------- |
| list / view / contacts / staff / photo (read) | all clients      | ✓                     | ✓                               | 404 / not listed |
| create client                                 | ✓                | ✓ (becomes **owner**) | ✓ (becomes collaborator)        | —                |
| edit details, status, contacts, photo         | ✓                | ✓                     | ✓                               | 404              |
| add / remove staff                            | ✓ (incl. owners) | collaborators only    | 403                             | 404              |
| archive / unarchive                           | ✓                | 403                   | 403                             | 404              |

(ADR-019: every assigned member may edit, and every role may create.)

Archived clients are read-only for everyone (writes → `409 INVALID_STATE`) until an admin unarchives them. Every client response includes `permissions: {canEdit, canManageStaff, canManageContacts, canArchive}` for the current user, and the UI shows only those controls.

| Method              | Path                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET                 | `/clients`                            | Query: `page` (1+), `pageSize` (1–**100**, default 20), `q` (name/business/email/phone/industry, matched literally, plus formatting-insensitive phone digits), `status` = `current` (default: not archived) / `archived` / `all`, `statusId` (admin-defined status), `ownerId`, `sort` = `name` / `businessName` / `status` (admin-defined order) / `updatedAt` / `createdAt` (**allowlist**), `dir` = `asc` / `desc`. → `{data: ClientDto[], meta: {page, pageSize, total}}`. Scoped in SQL. |
| POST                | `/clients`                            | Any role. `{name*, businessName, industry, phone, email, notes, statusId}` → 201 (`statusId` omitted → the default status; an unknown id → 422). Non-admin creators are assigned automatically.                                                                                                                                                                                                                                                                                               |
| GET                 | `/clients/:id`                        | `ClientDto`: `status` (`active`/`archived` lifecycle), `clientStatus {id,name,color}`, `photoUrl`, `owners`, `memberCount`, `permissions`                                                                                                                                                                                                                                                                                                                                                     |
| PATCH               | `/clients/:id`                        | Any non-empty subset; **omitted fields stay unchanged** (no defaults on PATCH). Empty strings clear optional fields.                                                                                                                                                                                                                                                                                                                                                                          |
| POST                | `/clients/:id/archive` · `/unarchive` | admin. Archive sets `status=archived` + `archivedAt`; members, contacts, leads and history are untouched. Unarchive → `active`.                                                                                                                                                                                                                                                                                                                                                               |
| GET / POST          | `/clients/:id/contacts`               | `{name*, title, phone, email, isPrimary}`. At most one primary contact; setting a new one clears the old.                                                                                                                                                                                                                                                                                                                                                                                     |
| PATCH / DELETE      | `/clients/:id/contacts/:contactId`    | The contact must belong to `:id`, otherwise 404. Contacts may be deleted (reference data without history).                                                                                                                                                                                                                                                                                                                                                                                    |
| GET                 | `/clients/:id/members`                | Assigned staff: `{userId, displayName, email, role, isActive, membershipRole}`                                                                                                                                                                                                                                                                                                                                                                                                                |
| POST / DELETE       | `/clients/:id/members[/:userId]`      | `{userId, membershipRole}`. See the table above; `409 ALREADY_MEMBER`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET / POST / DELETE | `/clients/:id/photo`                  | Photo/logo. GET: the image (session-protected; same 404 rules as the client). POST: `multipart/form-data`, field `photo`, **PNG/JPEG/WebP ≤ 2 MB, identified by content (magic bytes)**; SVG and everything else → `415 PHOTO_TYPE`, too large → 413. Stored as `<UPLOADS_DIR>/clients/<clientId>.<ext>` (the filename is never user-controlled). DELETE removes it. Archived → 409.                                                                                                          |
| GET                 | `/users/assignable`                   | admin/manager: active non-admin users for the staff picker. Employees: 403.                                                                                                                                                                                                                                                                                                                                                                                                                   |

Validation (shared Zod schemas, `packages/shared/src/clients.ts`): name 1–120, business name ≤160, industry ≤80, phone ≤40 (digits, spaces, `+ - ( ) .`), valid email ≤254, notes ≤5000. `422 VALIDATION` with field paths.

Still present from Phase 2: `GET /clients/:id/leads`, `GET /leads/:id`, `POST /leads/:id/activities` (authorization proof; the leads module is a later phase).

## Client statuses (admin-defined)

| Method | Path                       | Who                | Notes                                                                                                                      |
| ------ | -------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/client-statuses`         | any logged-in user | `[{id, name, color, position, isDefault, clientCount}]` in display/sort order                                              |
| POST   | `/client-statuses`         | admin              | `{name (1–40, unique), color}`. Colors: `green gray amber blue red purple teal pink` (fixed palette). Appended at the end. |
| PATCH  | `/client-statuses/:id`     | admin              | `{name?, color?, isDefault?: true}`. Exactly one default; setting a new one clears the old.                                |
| POST   | `/client-statuses/reorder` | admin              | `{ids: [...]}`. Must list every status exactly once.                                                                       |
| DELETE | `/client-statuses/:id`     | admin              | Only unused, non-default statuses (`409 STATUS_IN_USE` / `STATUS_IS_DEFAULT`).                                             |

Migration 0002 seeds פעיל (green, default), לא פעיל (gray) and מושהה (amber). Former "paused" clients became מושהה.

## Communication log (Phase 4)

| Method | Path                          | Who                 | Notes                                                                                                                                                                                                        |
| ------ | ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/clients/:id/communications` | members, admins     | Newest first. `page`, `pageSize` (≤ 100). → `CommunicationDto[]` with `author`, `contact`, `tasks` (the follow-up tasks created from it) and `canEdit`. Non-member → 404.                                    |
| POST   | `/clients/:id/communications` | members, admins     | `{type: call/whatsapp/meeting/email/note, occurredAt (ISO with offset), summary (1–5000), contactId?}` → 201. `contactId` from another client → 422 `details: [{path: 'contactId'}]`. Archived client → 409. |
| GET    | `/communications/:id`         | members, admins     | 404 if missing or not accessible.                                                                                                                                                                            |
| PATCH  | `/communications/:id`         | **author or admin** | Same fields, all optional. Another member → 403. Archived → 409. No DELETE: records are history.                                                                                                             |

## Tasks (Phase 4)

| Method | Path         | Who               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/tasks`     | logged in         | `scope` = `mine` (default, assigned to me) / `all` (every task I may see), `status` = `active` (default: open + in_progress, non-archived clients) / `done` / `cancelled` / `all`, `clientId`, `assigneeId`, `overdue=true`, `q` (title), `sort` = `dueAt` (default; no deadline last) / `createdAt` / `updatedAt` / `title`, `dir`, `page`, `pageSize`. **Non-admins only see tasks of clients they are a member of**, even ones assigned to them. |
| POST   | `/tasks`     | members, admins   | `{clientId, title (1–200), description?, assignedUserId, dueAt?, communicationId?}` → 201. The assignee needs access to the client (`422 INVALID_ASSIGNEE`). `communicationId` must belong to the same client (422, path `communicationId`). This is **"צור משימת המשך"**.                                                                                                                                                                          |
| GET    | `/tasks/:id` | members, admins   | `TaskDto`: `overdue` is computed by the server, plus `communication` ("נוצרה מתוך"), `createdBy` and `canEdit`.                                                                                                                                                                                                                                                                                                                                     |
| PATCH  | `/tasks/:id` | any member, admin | `{title?, description?, assignedUserId?, dueAt?, status?}`. Status: `open` / `in_progress` / `done` / `cancelled`. `done` sets `completedAt`; leaving `done` clears it. Archived client → 409. No DELETE: cancel instead.                                                                                                                                                                                                                           |
