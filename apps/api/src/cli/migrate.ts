/** `pnpm db:migrate` — backs up an existing DB, then applies pending migrations. */
import { existsSync } from 'node:fs';
import { backupDatabase } from '../db/backup.js';
import { openDatabase } from '../db/client.js';
import { getMigrationStatus, runMigrations } from '../db/migrator.js';
import { loadConfig } from '../lib/config.js';

const config = loadConfig();
// Path only, never data — so nobody migrates the production file by accident.
console.log(`[db:migrate] target: ${config.DATABASE_PATH} (NODE_ENV=${config.NODE_ENV})`);

const existedBefore = config.DATABASE_PATH !== ':memory:' && existsSync(config.DATABASE_PATH);
const handle = openDatabase(config.DATABASE_PATH);
try {
  const before = getMigrationStatus(handle);
  if (before.available === 0) {
    console.log('[db:migrate] no migrations yet — nothing to apply.');
  } else if (before.pending.length === 0) {
    console.log(`[db:migrate] up to date (${before.applied} applied).`);
  } else {
    if (existedBefore && before.applied > 0) {
      const file = await backupDatabase(handle.sqlite, config.BACKUP_DIR, 'pre-migrate');
      console.log(`[db:migrate] backup written and verified: ${file}`);
    }
    console.log(`[db:migrate] applying: ${before.pending.join(', ')}`);
    const after = runMigrations(handle);
    console.log(`[db:migrate] done (${after.applied} applied, ${after.pending.length} pending).`);
  }
} catch (err) {
  console.error('[db:migrate] FAILED — transaction rolled back, database unchanged.');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  handle.close();
}
