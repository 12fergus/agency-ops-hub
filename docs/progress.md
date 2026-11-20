# Progress

## Phase 0 — Scaffold (implemented 2026-11-20, awaiting acceptance)

Done:

- pnpm workspace (`apps/api`, `apps/web`, `packages/shared`), strict TypeScript, ESLint flat config, Prettier
- API: Zod-validated env config, Fastify app factory, `{data}`/`{error}` envelopes, `GET /api/v1/health` with DB ping, JSON 404, log redaction for cookie/authorization headers, 1 MiB body limit, SPA serving + fallback in production
- DB: better-sqlite3 connection with WAL, foreign keys, busy timeout; Drizzle instance (no schema yet)
- Web: Hebrew RTL shell (`lang="he" dir="rtl"`), right-side navigation placeholders, i18n dictionary, he-IL/Asia/Jerusalem date formatting, health status card via TanStack Query
- Tests: API (Vitest + `inject`), web (Vitest + Testing Library), e2e (Playwright against the production build)
- Docs: architecture, decisions (ADR-001..004), schema conventions, API conventions

Not in scope (deferred): migrations/tables, auth, shadcn/ui, routing, backup scripts.

## Proposed next phases

1. **Auth & users:** migrations (drizzle-kit), users/sessions, Argon2id, cookie sessions, CSRF/Origin checks, rate limiting, helmet/CSP, login page, admin user management, audit events for auth, first-admin bootstrap CLI
2. **Clients:** clients, members, contacts, access guards; client list/profile UI (router + shadcn primitives)
3. **Leads core:** pipelines/stages, campaigns, leads CRUD, phone normalization, duplicate warning, activities
4. **Views:** RTL table (TanStack Table) with filters, search, pagination; Kanban pipeline
5. **Tasks & dashboard:** follow-ups, overdue queue, dashboard counts
6. **Operations:** CSV import preview/commit and export, backup/restore scripts with integrity check, LAN deployment guide (Windows service, firewall, TLS)
