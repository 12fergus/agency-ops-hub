/**
 * `pnpm db:seed:demo --confirm-demo` — fictional demo data for local development.
 * Never runs automatically. Refuses without the flag, in production, on an unmigrated
 * database and on any non-empty database (users or clients present).
 */
import { openDatabase, type DbHandle } from '../db/client.js';
import { getMigrationStatus } from '../db/migrator.js';
import { SeedRefusedError, assertSeedAllowed, seedDemo } from '../db/seed-demo.js';
import { loadConfig } from '../lib/config.js';
import { cliError, runCli } from './run.js';

await runCli('db:seed:demo', () => {
  const config = loadConfig();
  console.log(`[db:seed:demo] target: ${config.DATABASE_PATH} (NODE_ENV=${config.NODE_ENV})`);

  const confirmed = process.argv.slice(2).includes('--confirm-demo');
  const opts = { nodeEnv: config.NODE_ENV, confirmed };
  // Checked before opening the file, so a production DB is never even opened by this script.
  try {
    assertSeedAllowed(opts);
  } catch (err) {
    if (err instanceof SeedRefusedError) throw cliError(`refused: ${err.message}`);
    throw err;
  }

  let handle: DbHandle | undefined;
  try {
    handle = openDatabase(config.DATABASE_PATH);
    const status = getMigrationStatus(handle);
    if (status.applied === 0 || status.pending.length > 0) {
      throw new SeedRefusedError('Database schema is not up to date. Run `pnpm db:migrate` first.');
    }
    const summary = seedDemo(handle.db, opts);
    console.log(
      `[db:seed:demo] created ${summary.users} users, ${summary.clients} clients, ` +
        `${summary.leads} leads, ${summary.tasks} tasks (all fictional).`,
    );
  } catch (err) {
    if (err instanceof SeedRefusedError) throw cliError(`refused: ${err.message}`);
    // seedDemo runs in one transaction: a failure writes nothing.
    throw cliError('FAILED — nothing was written.', err);
  } finally {
    handle?.close();
  }
});
