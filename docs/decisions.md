# Decisions (ADRs)

## ADR-001 — Product assumptions (approved 2026-11-20)

One agency, not SaaS/multi-tenant; 3–20 employees using browsers on the office LAN; one always-on office PC hosts the app; the administrator runs backups; no external API integrations in the MVP; no real client data seeded in development.

## ADR-002 — Stack and pinned versions (2026-11-20)

Node 26 (current LTS line on the dev host), pnpm 12.21.0, TypeScript **6.0.3** (not 7.x: `typescript-eslint` 8.73 supports `<6.1`), Fastify 5.12, `@fastify/static` 10.1 (serves the SPA, required by the same-origin design), Drizzle ORM 0.45 + better-sqlite3 13.2 (SQLite 3.54), Zod 4.6, React 19.3, Vite 8.3, Tailwind 4.3, TanStack Query 5.108, Vitest 5.1, Testing Library, Playwright 1.65, ESLint 10 + Prettier 3.10. All versions are exact in `package.json`; the lockfile pins transitive versions.

Installed later, when their phase needs them: argon2, uuidv7 (or equivalent), TanStack Table, React Hook Form + resolvers, drizzle-kit, shadcn/ui primitives, Fastify cookie/helmet/rate-limit plugins, and a client-side router (not named in the spec; to be approved in Phase 1).

## ADR-003 — Repository layout (2026-11-20)

The monorepo lives at the repo root (`C:\dev\test`), not in an `agency-crm/` subfolder. `@agency-crm/shared` is consumed from `src` in dev/tests and from `dist` in production builds, so no watch-build step is needed in development.

## ADR-004 — Fonts (2026-11-20)

Use system fonts with Hebrew coverage (Segoe UI / Arial). No Google Fonts or other external requests: the LAN may be offline, and the CSP can stay `self`-only.
