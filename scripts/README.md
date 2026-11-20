# scripts/

Planned (Operations phase), not implemented yet:

- `backup` — SQLite online backup / `VACUUM INTO` to a timestamped file, then `PRAGMA integrity_check` on the copy
- `restore` — restore into a temporary location, verify it, then swap in with the server stopped
- `seed-demo` — fake, clearly synthetic demo data only (no real client data)
