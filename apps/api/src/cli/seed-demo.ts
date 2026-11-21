/**
 * `pnpm db:seed:demo --confirm-demo` — fictional demo data for local development.
 * Never runs automatically. Refuses without the flag, in production, on an unmigrated
 * database and on any non-empty database (users or clients present).
 */
import { openDatabase } from '../db/client.js';
import { getMigrationStatus } from '../db/migrator.js';
import { SeedRefusedError, assertSeedAllowed, seedDemo } from '../db/seed-demo.js';
import { loadConfig } from '../lib/config.js';

const config = loadConfig();
console.log(`[db:seed:demo] target: ${config.DATABASE_PATH} (NODE_ENV=${config.NODE_ENV})`);

const confirmed = process.argv.slice(2).includes('--confirm-demo');
// Checked before opening the file, so a production DB is never even opened by this script.
try {
  assertSeedAllowed({ nodeEnv: config.NODE_ENV, confirmed });
} catch (err) {
  console.error(`[db:seed:demo] refused: ${(err as Error).message}`);
  process.exit(1);
}

const handle = openDatabase(config.DATABASE_PATH);
try {
  const status = getMigrationStatus(handle);
  if (status.applied === 0 || status.pending.length > 0) {
    throw new SeedRefusedError('Database schema is not up to date. Run `pnpm db:migrate` first.');
  }
  const summary = seedDemo(handle.db, { nodeEnv: config.NODE_ENV, confirmed });
  console.log(
    `[db:seed:demo] created ${summary.users} users, ${summary.clients} clients, ` +
      `${summary.leads} leads, ${summary.tasks} tasks (all fictional).`,
  );
} catch (err) {
  console.error(`[db:seed:demo] ${err instanceof SeedRefusedError ? 'refused' : 'FAILED'}:`);
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  handle.close();
}
