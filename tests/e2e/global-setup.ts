/**
 * Prepares the throwaway e2e database using the BUILT API code (apps/api/dist), i.e. the same
 * migrator and first-admin bootstrap that `db:migrate` / `auth:create-admin` use.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { removeE2eFile } from './fs-utils.js';

/** The slice of the built API this setup uses (dist has no .d.ts, so typed here). */
interface DbHandle {
  db: unknown;
  close(): void;
}
interface ApiDist {
  openDatabase(filePath: string): DbHandle;
  runMigrations(handle: DbHandle): unknown;
  bootstrapFirstAdmin(
    db: unknown,
    input: { email: string; displayName: string; password: string },
  ): Promise<unknown>;
}

const dist = (p: string) => new URL(`../../apps/api/dist/${p}`, import.meta.url).href;

/** Set by playwright.config.ts; fail loudly instead of passing `undefined` along. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — run e2e via \`pnpm test:e2e\``);
  return value;
}

/** Leftover e2e DBs from earlier runs (only files matching our own naming pattern). */
function removeStaleE2eDatabases(current: string): void {
  const dir = path.dirname(current);
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    if (/^crm-e2e-\d+\.sqlite(-wal|-shm)?$/.test(f) && !full.startsWith(current)) {
      removeE2eFile(full);
    }
  }
}

async function loadApi(): Promise<ApiDist> {
  try {
    const [client, migrator, users] = await Promise.all([
      import(dist('db/client.js')),
      import(dist('db/migrator.js')),
      import(dist('modules/users/service.js')),
    ]);
    return {
      openDatabase: client.openDatabase,
      runMigrations: migrator.runMigrations,
      bootstrapFirstAdmin: users.bootstrapFirstAdmin,
    };
  } catch (err) {
    throw new Error('apps/api/dist is missing or stale — run `pnpm test:e2e` (it builds first)', {
      cause: err,
    });
  }
}

export default async function globalSetup(): Promise<void> {
  const dbPath = requiredEnv('E2E_DATABASE_PATH');
  const email = requiredEnv('E2E_ADMIN_EMAIL');
  const password = requiredEnv('E2E_ADMIN_PASSWORD');

  removeStaleE2eDatabases(dbPath);
  const api = await loadApi();
  const handle = api.openDatabase(dbPath);
  try {
    api.runMigrations(handle);
    await api.bootstrapFirstAdmin(handle.db, {
      email,
      displayName: 'מנהלת בדיקות',
      password,
    });
  } finally {
    handle.close();
  }
}
