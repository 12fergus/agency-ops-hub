# Architecture

```
Employee browsers on office LAN
           │ HTTP(S) to one private IP:port (host firewall restricts to office subnet)
           ▼
Office host (always on)  ── optional reverse proxy for TLS
           │
           ▼
Fastify API process (apps/api) ── serves built React SPA (apps/web/dist) at same origin
           ├── /api/v1/* routes → services → permission guards
           ├── Drizzle ORM → better-sqlite3 → SQLite (WAL) on local disk: data/crm.sqlite
           └── scheduled backup job (Phase: Operations)
```

## Process model

- Exactly **one** API process owns the database connection and all writes. Never run a second instance against the same file, and never let employees open the `.sqlite` file over a share.
- SQLite pragmas on open: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL` (`apps/api/src/db/client.ts`).
- Production: `NODE_ENV=production pnpm start` serves the SPA with an `index.html` fallback for non-`/api` GETs. Unknown `/api/*` → JSON 404 envelope.
- Development: Vite on 127.0.0.1:5173 proxies `/api` to the API on 127.0.0.1:3000. The dev server is never bound to the LAN.

## Network modes

| Mode        | `HOST`                | Notes                                                                                                            |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Single user | `127.0.0.1`           | Default.                                                                                                         |
| Office team | Host's private LAN IP | Windows Firewall inbound rule for that port, scoped to the office subnet. HTTPS strongly recommended over Wi-Fi. |
| Internet    | —                     | Not supported. Never expose this server publicly.                                                                |

## Code layout

- `apps/api/src/app` — app factory (`buildApp(config)`), plugin registration, error/404 handlers
- `apps/api/src/modules/<feature>` — routes + service + repository per feature
- `apps/api/src/middleware` — auth/session/permission guards (Phase 1+)
- `apps/api/src/db` — connection, Drizzle schema, migrations
- `apps/api/src/lib` — config (Zod-validated env), errors
- `apps/web/src/{app,components,features,lib}` — shell, shared UI, feature folders, i18n/api helpers
- `packages/shared/src` — Zod schemas and API types shared by both apps
