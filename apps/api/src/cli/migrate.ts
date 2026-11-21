/** `pnpm db:migrate` — backs up an existing DB, then applies pending migrations. */
import { existsSync } from 'node:fs';
import { backupDatabase } from '../db/backup.js';
import { openDatabase, type DbHandle } from '../db/client.js';
import {
  MigrationDriftError,
  PostMigrationCheckError,
  getMigrationStatus,
  runMigrations,
} from '../db/migrator.js';
import { loadConfig } from '../lib/config.js';
import { cliError, runCli } from './run.js';

await runCli('db:migrate', async () => {
  const config = loadConfig();
  // Path only, never data — so nobody migrates the production file by accident.
  console.log(`[db:migrate] target: ${config.DATABASE_PATH} (NODE_ENV=${config.NODE_ENV})`);

  const existedBefore = config.DATABASE_PATH !== ':memory:' && existsSync(config.DATABASE_PATH);
  let handle: DbHandle | undefined;
  let backupFile: string | undefined;
  try {
    handle = openDatabase(config.DATABASE_PATH);
    const before = getMigrationStatus(handle);
    if (before.available === 0) {
      console.log('[db:migrate] no migrations yet — nothing to apply.');
      return;
    }
    if (before.pending.length === 0) {
      console.log(`[db:migrate] up to date (${before.applied} applied).`);
      return;
    }
    if (existedBefore && before.applied > 0) {
      backupFile = await backupDatabase(handle.sqlite, config.BACKUP_DIR, 'pre-migrate');
      console.log(`[db:migrate] backup written and verified: ${backupFile}`);
    }
    console.log(`[db:migrate] applying: ${before.pending.join(', ')}`);
    const after = runMigrations(handle);
    console.log(`[db:migrate] done (${after.applied} applied, ${after.pending.length} pending).`);
  } catch (err) {
    // Tell the admin precisely what state the database is in — it differs per failure point.
    if (err instanceof MigrationDriftError) {
      throw cliError('REFUSED — nothing was applied, database unchanged.', err);
    }
    if (err instanceof PostMigrationCheckError) {
      throw cliError(
        'MIGRATION WAS APPLIED but the database now has foreign-key violations. Keep the API ' +
          `stopped and restore ${backupFile ?? 'the latest backup'} (docs/operations.md → Restore).`,
        err,
      );
    }
    throw cliError(
      'FAILED — the migration transaction was rolled back (or never started); database unchanged.',
      err,
    );
  } finally {
    handle?.close();
  }
});
