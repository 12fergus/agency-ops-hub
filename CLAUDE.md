# CLAUDE.md

Agency CRM for one Israeli advertising agency (3–20 employees, office LAN). Hebrew RTL UI. pnpm monorepo: `apps/api` (Fastify + Drizzle + SQLite via better-sqlite3), `apps/web` (React + Vite + Tailwind + TanStack Query), `packages/shared` (Zod schemas, API types). One API process owns the SQLite DB and serves the built SPA from the same origin under `/api/v1`.

Read `docs/progress.md` first. Work **one phase at a time**; stop for the user's approval before the next phase. Never commit before acceptance.

## Commands

Node ≥ 24 (dev host: v26), pnpm 12. Run from repo root.

- `pnpm dev` — API (tsx watch, :3000) + Vite (:5173, proxies `/api`)
- `pnpm lint` · `pnpm format:check` · `pnpm typecheck` · `pnpm test` · `pnpm build`
- `pnpm test:e2e` — builds, then Playwright against the production server on :3100 with a temp DB
- `pnpm db:generate` — generate migration SQL from `apps/api/src/db/schema.ts` into `apps/api/migrations/`
- `pnpm db:migrate` — back up (if the DB exists), then apply pending migrations to `DATABASE_PATH` in one transaction; repeatable
- `pnpm db:backup` — online backup + integrity check into `BACKUP_DIR`
- `pnpm auth:create-admin` — interactive, host-only first-admin bootstrap (TTY; refuses if an active admin exists)
- `pnpm db:seed:demo --confirm-demo` — fictional demo data on an empty dev DB (refused in production). Procedures: `docs/operations.md`
- Single test: `pnpm --filter @agency-crm/api exec vitest run test/health.test.ts` (or `-t "name"`)
- **Before reporting a task done:** `pnpm check` (lint + format + typecheck + test + build), plus `pnpm test:e2e` in UI phases. Report actual output; never claim a pass you didn't run.
- **Review every phase:** launch the `code-reviewer` agent on the phase's changes (it includes untracked files) in parallel with `test-runner`. Fix confirmed blockers/should-fix items, re-run checks, and include the review result (what was fixed, what was deferred and why) in the phase report.

## Source of truth

- Specs/decisions: `docs/architecture.md`, `docs/decisions.md` (ADRs), `docs/schema.md`, `docs/api.md`, `docs/operations.md`, `docs/progress.md`. Update the relevant ones every phase.
- DB access: repositories in `apps/api/src/db/repositories` take an `Executor` (DB or tx); business rules live in `apps/api/src/modules/*/service.ts` and wrap writes in `withTransaction` (sync callbacks only).
- Hebrew UI strings: `apps/web/src/lib/i18n/he.ts` only — no hardcoded strings in components.
- API envelope/types: `packages/shared/src`. `@agency-crm/shared` resolves to `src` in dev/tests (tsconfig `paths` + Vite alias) and to `dist` in the production build.
- Generated, don't edit: `pnpm-lock.yaml`, `**/dist`, future Drizzle migration SQL once applied.

## Rules for this codebase

- Authorization is enforced in the backend on every list query and every ID lookup. Never trust a client-supplied `user_id`/`client_id` or a frontend role check.
- API routes are private by default (onRequest hook in `app/security.ts`). Mark a route `config: { public: true }` only with a stated reason. Anything client-scoped goes through `authorizeClientAccess` / `authorizeLeadAccess` (`modules/auth/authorize.ts`); no access = 404. Handlers take the user from `actorOf(req)`, never from the request body.
- Keep changes small and scoped to the current phase. No drive-by refactors.
- Schema changes only through versioned migrations (`db:generate` → review SQL → `db:migrate`). Never `drizzle-kit push`, never hand-edit an applied migration.
- Never modify the production SQLite file casually: no ad-hoc SQL, no migrations, no restores against it without an explicit user go-ahead and a verified backup first. Tests and dev use their own DB files.
- No silent destructive commands (deleting data/files, dropping tables, resetting git). State impact and rollback and get approval first.
- SQLite: the file lives on the host's local disk; never a network share. `foreign_keys=ON`, WAL. Backups via the online backup API / `VACUUM INTO`, never a raw copy of a live DB.
- Timestamps stored as UTC ISO-8601; display in `he-IL` / `Asia/Jerusalem`.
- RTL: logical CSS (`ms-/me-/ps-/pe-/border-e`), never `left/right`. Phones, emails, URLs, IDs rendered with `dir="ltr"`.
- No logs containing passwords, session tokens, or lead PII. No real client data in dev/test fixtures.
- No new framework, paid service, external integration or dependency without asking. Native build scripts must be allowlisted in `pnpm-workspace.yaml` → `allowBuilds`.
- Dev servers bind to `127.0.0.1`. LAN exposure only via the configured private `HOST` on the office host.

## Repo guardrails

- Destructive shell commands (rm -rf, force push, reset --hard, DROP, migrations, publish) trigger a confirmation hook. Explain impact and rollback before running them; never work around the hook.
- Writes to `.env*` (except `.env.example`), keys and lockfiles are blocked. New config goes to `.env.example` with a placeholder.
- Prettier (single quotes, width 100) runs automatically on edit now that it is installed locally.
- Project MCP servers go in `.mcp.json` at the repo root. Personal overrides go in `CLAUDE.local.md` / `.claude/settings.local.json` (gitignored).
