# Operations: database, migrations, backups

## Where the database lives

- One file, `DATABASE_PATH` (default `data/crm.sqlite`), on the office host's **local** disk.
- **Never** on a network share or a mapped drive (`\\nas\...`, `Z:`). SQLite's locking and WAL shared memory are unreliable over SMB/NFS, which leads to corruption. The app refuses UNC paths. It can't detect mapped drive letters, so checking that is the admin's job.
- Durability: `synchronous=NORMAL` in WAL mode. A power cut can lose the last few seconds of commits but doesn't corrupt the file. A UPS on the host is recommended.
- WAL mode creates `crm.sqlite-wal` and `crm.sqlite-shm` next to the file. They are part of the live database: **never copy only the `.sqlite` file while the app runs**, and never delete the `-wal` file.
- Only the API process opens the file. Employees never open it directly.

## Commands

| Command                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate`                  | Prints the target path. **Refuses on drift** (an applied migration was edited, or an older migration was merged after a newer one was applied; plain drizzle would skip it silently). If the DB already has applied migrations and new ones are pending, **takes a verified backup first** (`BACKUP_DIR/crm-pre-migrate-*.sqlite`), then applies all pending migrations in **one transaction** (any error → rollback, DB unchanged). Finally runs `foreign_key_check`. Safe to run repeatedly. |
| `pnpm db:backup`                   | Online backup via SQLite's backup API (safe while the server runs), converted to a single self-contained file, then `integrity_check` + `foreign_key_check`. Output: `BACKUP_DIR/crm-manual-<UTC timestamp>.sqlite`. A copy that fails verification is renamed `*.failed` and is never left under a normal name.                                                                                                                                                                               |
| `pnpm db:seed:demo --confirm-demo` | Fictional demo data. Refuses without `--confirm-demo`, when `NODE_ENV=production` (checked before the file is even opened), when the schema isn't migrated, or when any user or client exists. Never run automatically.                                                                                                                                                                                                                                                                        |
| `pnpm db:generate`                 | Developer-only: generates migration SQL from `schema.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Users and access

- **First admin (once) — three ways; all work only while no admin that can log in exists:**
  1. **Setup page (normal, no terminal needed):** start the server and open the CRM in a browser. Instead of the login page it shows **הגדרה ראשונית**. Open `setup-code.txt` in the data folder on the server PC (next to the database, normally `datasetup-code.txt`; the server log says where), type that one-time code, plus your name, email and password. You are logged in as admin; the code file is deleted and the setup page disappears for good. A new code is generated on each server start until setup is done.
  2. **Environment variables (scripted installs):** set `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` (and optionally `INITIAL_ADMIN_NAME`) in the service configuration. On startup the admin is created once. **Then remove `INITIAL_ADMIN_PASSWORD` from the configuration**, because it sits there in plain text. If the password breaks the policy, the server logs why and falls back to the setup page.
  3. **Terminal (developers / recovery):** `pnpm auth:create-admin` (interactive).
     Demo-data admins can’t log in and don’t count. Anyone who can read the server’s data folder can complete setup, so protect that folder.
- **Further users:** either the admin creates them on the משתמשים page (hand over the initial password in person, not by email or WhatsApp), or people sign up themselves via **הרשמה** on the login page and are logged in immediately. Self-signups are **employees with no client access** until an admin assigns them to clients. Disable unwanted accounts on the users page. `SIGNUP_REQUIRES_APPROVAL=true` makes sign-ups wait for admin approval (**אישור**), and `SELF_SIGNUP=false` hides sign-up entirely. Self-service password change is planned.
- **Leaving employees:** disable the account (משתמשים → השבתה). All their sessions end immediately. Accounts are never deleted, so history stays attributable.
- **Lost admin password:** there is no reset route yet. If there is a second admin, they can restore access. Otherwise contact the developer: a host-only reset CLI is planned.
- **Account lockout:** 5 login attempts per account per 15 minutes; a successful login resets the count. The trade-off is that anyone on the LAN can lock a colleague out for 15 minutes by typing wrong passwords. Failed attempts appear in `audit_events` (`auth.login_failed`).
- **HTTPS:** on the LAN, put a TLS-terminating reverse proxy **on the same host** in front of the app and set `TRUST_PROXY=true`. Only a loopback proxy is trusted (`127.0.0.1`/`::1`): the server takes the client IP from the entry the proxy appends to `X-Forwarded-For` and ignores anything the client sent. A proxy on another machine isn't supported without a code change. The session cookie then gets `Secure` automatically (`COOKIE_SECURE=auto`). If users reach the app through a hostname different from the `Host` header the server sees, add it to `TRUSTED_ORIGINS`.

## Schema changes

1. Edit `apps/api/src/db/schema.ts`.
2. `pnpm db:generate --name <short_description>`, then **read the generated SQL**. Watch for table rebuilds: SQLite can't alter most constraints, so drizzle-kit emits `CREATE new → INSERT … SELECT → DROP old → RENAME`. Check that no data is dropped and FKs still hold.
3. Update `docs/schema.md` and add tests. `pnpm check` runs them on a fresh in-memory DB.
4. Commit the SQL **and** `migrations/meta/*`. Never edit a migration once it has been applied anywhere; add a new one instead.
5. Never use `drizzle-kit push` against any real database.
6. **Table rebuilds:** `PRAGMA foreign_keys=OFF` inside a generated migration has no effect, because the migrator wraps everything in a transaction. Rebuilds therefore run with FKs ON. With no cascades (ADR-008), a rebuild that would orphan rows **fails and rolls back**; it doesn't delete anything. If cascades are ever introduced, rebuild migrations need a custom runner. Add a test that applies the rebuild to a populated DB.
7. The final `foreign_key_check` runs **after** commit. It can detect a problem, not undo it. If it fails, restore the pre-migrate backup.

## Applying migrations on the office host

1. Announce downtime and **stop the API** (Windows service / terminal). `db:migrate` doesn't lock out a running server, so this step is mandatory.
2. `pnpm db:backup` (extra safety: `db:migrate` also backs up automatically).
3. `pnpm db:migrate` and read the output. On failure, the transaction was rolled back: the DB is unchanged. Keep the server stopped and report the error.
4. Start the API and check `GET /api/v1/health`.

## Backups

- **Schedule:** at least daily, plus before every migration or upgrade. Windows Task Scheduler → `pnpm db:backup` in the repo directory (the scheduled job lands with the Operations phase).
- **Location:** `BACKUP_DIR` (default `backups/`, gitignored). Also copy to a **different physical disk or machine** (USB/NAS/offsite). A backup on the same disk doesn't survive a disk failure.
- **Protection:** backups contain lead PII. Restrict folder permissions to the admin account. Encrypt copies that leave the host (e.g. BitLocker on the external drive, or 7-Zip AES-256).
- **Retention:** keep 14 daily and 8 weekly backups; delete older ones. The retention policy needs agency approval.
- **Test restores** monthly (below). A backup that has never been restored is unverified.

## Restore (manual until the Operations phase adds `scripts/restore`)

1. **Verify the backup first, away from production:** copy it to a temp folder, set `DATABASE_PATH` to that copy, and run `pnpm db:migrate`. It must report "up to date" or apply cleanly. Optionally start the API on another port and spot-check data.
2. Stop the API. **Rename** the current `crm.sqlite`, `crm.sqlite-wal` and `crm.sqlite-shm` (e.g. append `.broken-<date>`). Don't delete them, and keep all three together.
3. Copy the verified backup to `DATABASE_PATH`.
4. `pnpm db:migrate` (brings an older backup up to the current schema), start the API, and check health.
5. Rollback: stop the API and rename the `.broken-<date>` files back.
