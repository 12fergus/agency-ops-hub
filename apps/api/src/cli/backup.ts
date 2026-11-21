/** `pnpm db:backup` — consistent online backup + integrity check. Safe while the server runs. */
import { existsSync } from 'node:fs';
import { backupDatabase } from '../db/backup.js';
import { openDatabase } from '../db/client.js';
import { loadConfig } from '../lib/config.js';

const config = loadConfig();
if (config.DATABASE_PATH === ':memory:' || !existsSync(config.DATABASE_PATH)) {
  console.error(`[db:backup] no database file at ${config.DATABASE_PATH}`);
  process.exit(1);
}

const handle = openDatabase(config.DATABASE_PATH);
try {
  const file = await backupDatabase(handle.sqlite, config.BACKUP_DIR, 'manual');
  console.log(`[db:backup] written and verified (integrity_check ok): ${file}`);
} catch (err) {
  console.error('[db:backup] FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  handle.close();
}
