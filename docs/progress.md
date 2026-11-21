# Progress

## Phase 0 — Scaffold (accepted, committed b245bd4)

Done:

- pnpm workspace (`apps/api`, `apps/web`, `packages/shared`), strict TypeScript, ESLint flat config, Prettier
- API: Zod-validated env config, Fastify app factory, `{data}`/`{error}` envelopes, `GET /api/v1/health` with DB ping, JSON 404, log redaction for cookie/authorization headers, 1 MiB body limit, SPA serving + fallback in production
- DB: better-sqlite3 connection with WAL, foreign keys, busy timeout; Drizzle instance (no schema yet)
- Web: Hebrew RTL shell (`lang="he" dir="rtl"`), right-side navigation placeholders, i18n dictionary, he-IL/Asia/Jerusalem date formatting, health status card via TanStack Query
- Tests: API (Vitest + `inject`), web (Vitest + Testing Library), e2e (Playwright against the production build)
- Docs: architecture, decisions (ADR-001..004), schema conventions, API conventions

Not in scope (deferred): migrations/tables, auth, shadcn/ui, routing, backup scripts.

## Phase 1 — SQLite persistence (committed 54a28c6 on `phase-1-db`, PR pending)

Done:

- Migration `0000_init`: 13 tables, 17 CHECKs, composite FKs for same-client invariants, partial unique indexes, query indexes (docs/schema.md)
- `db:migrate` (transactional, repeatable, auto-backup before applying to an existing DB), `db:backup` (online backup + integrity_check), `db:seed:demo --confirm-demo` (fictional data, refused in production / on non-empty DB)
- Repositories (`apps/api/src/db/repositories`), `withTransaction` (IMMEDIATE + savepoints), services enforcing cross-client rules: clients (create + default pipeline, members, contacts, campaigns), leads (create with duplicate warning, stage change, assign, activities), tasks (create)
- Phone/email normalization, UUIDv7 helper, audit events with secret-key sanitization
- Network-share guard for `DATABASE_PATH`/`BACKUP_DIR`
- Docs: schema.md rewritten, operations.md (migrations, backup, restore), ADR-005..010

No new endpoints (health only). No auth: actor IDs are passed explicitly until Phase 2.

Carried into Phase 2 (from the review, ADR-011): actor-scoped lookups and NOT_FOUND for inaccessible IDs, a mapper for SQLite constraint errors, and Zod validation at the API boundary (lengths, email format).

## Phase 2 — Authentication & authorization (implemented 2026-11-21, awaiting acceptance; branch `phase-2-auth`)

Done:

- Argon2id via Node's built-in `crypto.argon2` (no native dependency). PHC format, OWASP parameters, constant-time verify, dummy verify for unknown emails
- Server-side sessions: random 256-bit token in an HttpOnly/SameSite=Lax cookie (Secure over HTTPS), SHA-256 stored, absolute and idle expiry, revoked on logout, role change and disable. `is_active` checked on every request
- Default-deny `onRequest` hook (routes opt in to `public`), Origin/Referer CSRF check, JSON-only bodies, security headers/CSP, login rate limiting (per account + per IP), and a mapper that turns SQLite errors into API error responses
- `authorizeClientAccess(actor, clientId, action)` and `authorizeLeadAccess`: admins see everything, others only clients they're members of (404 otherwise). Owner managers control membership without being able to escalate
- Routes: auth (login/logout/me), admin users (list/create/role/disable/enable), and minimal client/member/lead routes (reads, member management, lead activities) to prove the access rules
- `pnpm auth:create-admin`: interactive, host-only first-admin bootstrap (TTY required, hidden password, refuses if an active admin exists)
- Web: Hebrew RTL login page, user menu + logout, admin users page, any 401 → back to login. No tokens in JS storage. A tiny hash router instead of a router package
- Tests: API 113 (default-deny sweep over every route, login/cookie/expiry/logout/rotation, rate limit, CSRF, privilege change, disabled accounts, IDOR, membership rules), web 5, e2e 6
- Zero new dependencies

Resolved from the Phase 1 review: actor-scoped lookups with NOT_FOUND for inaccessible IDs, the SQLite error mapper, and Zod validation at the boundary for the new routes.

## Proposed next phases

1. ~~Auth & users~~ (Phase 2)
2. **Clients:** clients, members, contacts, access guards; client list/profile UI (router + shadcn primitives)
3. **Leads core:** pipelines/stages, campaigns, leads CRUD, phone normalization, duplicate warning, activities
4. **Views:** RTL table (TanStack Table) with filters, search, pagination; Kanban pipeline
5. **Tasks & dashboard:** follow-ups, overdue queue, dashboard counts
6. **Operations:** CSV import preview/commit and export, backup/restore scripts with integrity check, LAN deployment guide (Windows service, firewall, TLS)
7. **Email codes** (requested 2026-11-21, deferred): needs an email provider decision (Google Workspace SMTP vs. a sending service), a dependency, and internet from the host. Options: code at every login (2FA) or a one-time email verification. Also enables self-service password reset.
8. **Google sign-in** (requested 2026-11-21, deferred): needs a Google Cloud OAuth client, internet, HTTPS on a real domain (Google rejects plain-HTTP LAN redirect URLs), and staff Google/Workspace accounts. Plan together with the HTTPS/deployment work.
