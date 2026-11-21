/** `pnpm db:backup` — consistent online backup + integrity check. Safe while the server runs. */
import { existsSync } from 'node:fs';
import { backupDatabase } from '../db/backup.js';
import { openDatabase, type DbHandle } from '../db/client.js';
import { loadConfig } from '../lib/config.js';
import { cliError, runCli } from './run.js';

await runCli('db:backup', async () => {
  const config = loadConfig();
  if (config.DATABASE_PATH === ':memory:' || !existsSync(config.DATABASE_PATH)) {
    throw cliError(`no database file at ${config.DATABASE_PATH}`);
  }
  let handle: DbHandle | undefined;
  try {
    handle = openDatabase(config.DATABASE_PATH);
    const file = await backupDatabase(handle.sqlite, config.BACKUP_DIR, 'manual');
    console.log(`[db:backup] written and verified (integrity_check ok): ${file}`);
  } catch (err) {
    throw cliError('FAILED — no usable backup was written.', err);
  } finally {
    handle?.close();
  }
});
