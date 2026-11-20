# Database schema

**Status:** no tables yet (Phase 0). Migrations start in Phase 1 with `users` and `sessions`.

Conventions, binding for every migration:

- IDs: server-generated, string, time-ordered (UUIDv7). Never client-supplied.
- Timestamps: UTC ISO-8601 text (`2026-11-20T10:00:00.000Z`); `created_at`, `updated_at`; `archived_at` for recoverable business records.
- Every relationship is a real foreign key; `PRAGMA foreign_keys = ON` on every connection.
- No cascade deletes of historical leads or activities from routine flows. Hard delete is an admin maintenance operation outside the MVP.
- Phone numbers: store `phone_raw` intact and `phone_normalized` only for matching. No global unique constraint on phone; show a per-client duplicate warning instead.
- Migrations are versioned, forward-only, and reviewed before they are applied. Never run tests against the production DB file.
- Workflow: edit `apps/api/src/db/schema.ts` → `pnpm db:generate` (writes SQL to `apps/api/migrations/`) → review the SQL → `pnpm db:migrate`. `db:migrate` prints the target DB path and does nothing when there are no migrations. `drizzle-kit push` is not used.

The planned tables are listed in the product spec (§3): users, sessions, clients, client_members, client_contacts, pipelines, pipeline_stages, campaigns, leads, lead_activities, tasks, lead_import_batches, ingestion_events (P1), audit_events. Each table gets documented here when its migration lands.
