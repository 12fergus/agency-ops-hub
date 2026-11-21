/**
 * `pnpm browser-check:serve` — an ISOLATED, throwaway instance of the app for the `browser-checker`
 * agent (and for manual smoke checks). Never touches data/crm.sqlite or real accounts.
 *
 * - Production build (API serves the built SPA) on 127.0.0.1:3200 (BROWSER_CHECK_PORT to change).
 * - Fresh SQLite DB in the OS temp folder, migrated, demo-seeded, plus three login-capable TEST
 *   accounts (admin / manager / employee). Password: BROWSER_CHECK_PASSWORD if set (the agent's
 *   own test value), otherwise generated per run.
 * - Credentials go to a JSON file in the OS temp folder (path printed, passwords never printed).
 * - Refuses to run when NODE_ENV=production in the calling environment.
 * - Ctrl+C / SIGTERM stops the server; the temp folder is removed on exit (best effort).
 */
import { randomBytes } from 'node:crypto';
import { passwordProblems } from '@agency-crm/shared';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../app/build-app.js';
import { openDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrator.js';
import { seedDemo } from '../db/seed-demo.js';
import { loadConfig } from '../lib/config.js';
import { addClientMember } from '../modules/clients/service.js';
import { bootstrapFirstAdmin, createUserWithPassword } from '../modules/users/service.js';
import { cliError, runCli } from './run.js';

const DIR = path.join(tmpdir(), 'crm-browser-check');
export const CREDENTIALS_FILE = path.join(DIR, 'credentials.json');

/** Test-only password that satisfies the shared policy (letter, digit, symbol, 8+). */
const testPassword = () => `Bc-${randomBytes(9).toString('base64url')}-7!`;

/**
 * The browser-checker agent passes its OWN test password (BROWSER_CHECK_PASSWORD) so it can type it
 * in the browser without reading secrets back from a file. Used for all three test accounts.
 * Only ever for this throwaway instance; must satisfy the normal password policy.
 */
function suppliedPassword(): string | null {
  const pw = process.env.BROWSER_CHECK_PASSWORD;
  if (!pw) return null;
  const problems = passwordProblems(pw);
  if (problems.length > 0) {
    throw cliError(`BROWSER_CHECK_PASSWORD breaks the password policy (${problems.join(', ')}).`);
  }
  return pw;
}

await runCli('browser-check:serve', async () => {
  if (process.env.NODE_ENV === 'production') {
    throw cliError('refused: never run the browser-check instance with NODE_ENV=production.');
  }
  const port = Number(process.env.BROWSER_CHECK_PORT ?? 3200);
  const supplied = suppliedPassword();
  const pw = () => supplied ?? testPassword();

  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const dbPath = path.join(DIR, `crm-${Date.now()}.sqlite`);

  // 1. Prepare the throwaway DB with the real migrator, demo seed and bootstrap code paths.
  const setup = openDatabase(dbPath);
  const accounts = {
    admin: { email: 'check-admin@agency.test', password: pw(), role: 'admin' },
    manager: { email: 'check-manager@agency.test', password: pw(), role: 'manager' },
    employee: { email: 'check-employee@agency.test', password: pw(), role: 'employee' },
  } as const;
  try {
    runMigrations(setup);
    seedDemo(setup.db, { nodeEnv: 'development', confirmed: true });
    await bootstrapFirstAdmin(setup.db, {
      email: accounts.admin.email,
      displayName: 'מנהלת בדיקה',
      password: accounts.admin.password,
    });
    const manager = await createUserWithPassword(
      setup.db,
      { ...accounts.manager, displayName: 'מנהל בדיקה' },
      null,
    );
    const employee = await createUserWithPassword(
      setup.db,
      { ...accounts.employee, displayName: 'עובד בדיקה' },
      null,
    );
    // Give the manager (owner) and employee access to the first demo client.
    const firstClient = setup.sqlite
      .prepare('SELECT id, name FROM clients ORDER BY name LIMIT 1')
      .get() as { id: string; name: string };
    addClientMember(
      setup.db,
      { clientId: firstClient.id, userId: manager.id, membershipRole: 'owner' },
      null,
    );
    addClientMember(setup.db, { clientId: firstClient.id, userId: employee.id }, null);

    writeFileSync(
      CREDENTIALS_FILE,
      JSON.stringify(
        {
          url: `http://127.0.0.1:${port}`,
          note: 'Throwaway TEST accounts for the isolated browser-check instance only.',
          assignedClient: firstClient.name,
          accounts,
        },
        null,
        2,
      ),
    );
  } finally {
    setup.close();
  }

  // 2. Serve the production build against that DB.
  const config = loadConfig({
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_PATH: dbPath,
    BACKUP_DIR: path.join(DIR, 'backups'),
    LOG_LEVEL: 'warn',
  });
  const app = await buildApp(config);
  const stop = async () => {
    await app.close().catch(() => undefined);
    rmSync(DIR, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (err) {
    await app.close().catch(() => undefined);
    throw cliError(`could not listen on 127.0.0.1:${port} (port in use?)`, err);
  }
  console.log(`[browser-check:serve] ready: ${config.HOST}:${config.PORT}`);
  console.log(`[browser-check:serve] test credentials: ${CREDENTIALS_FILE}`);
});
