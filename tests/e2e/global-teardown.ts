import { removeE2eFile } from './fs-utils.js';

/**
 * Removes the throwaway e2e database (and its WAL/SHM files). On Windows the server may still
 * hold them (Playwright stops it after teardown); those are skipped with a warning and removed
 * by global setup on the next run. Other errors fail the run.
 */
export default function globalTeardown(): void {
  const db = process.env.E2E_DATABASE_PATH;
  if (!db) return;
  for (const f of [db, `${db}-wal`, `${db}-shm`]) removeE2eFile(f);
}
