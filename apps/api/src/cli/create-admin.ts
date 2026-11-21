/**
 * `pnpm auth:create-admin` — creates the FIRST admin. Run on the office host itself.
 *
 * - Interactive only: refuses when stdin is not a terminal, so passwords never come from
 *   pipes, files, env vars or shell history. No default or hardcoded password exists.
 * - Password typed twice (masked with *), checked against the password policy, up to 3 attempts;
 *   stored as Argon2id.
 * - Refuses if an active admin already exists (there is no HTTP route for this at all).
 */
import { createInterface } from 'node:readline/promises';
import { createUserSchema } from '@agency-crm/shared';
import { openDatabase, type DbHandle } from '../db/client.js';
import { getMigrationStatus } from '../db/migrator.js';
import { loadConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import type { PasswordRule } from '@agency-crm/shared';
import { PASSWORD_MIN_LENGTH, checkPasswordPolicy } from '../lib/password.js';
import { BootstrapRefusedError, bootstrapFirstAdmin } from '../modules/users/service.js';
import { HiddenInput } from './hidden-input.js';
import { CliError, cliError, runCli } from './run.js';

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const input = new HiddenInput();
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      const r = input.feed(chunk);
      if (r.echo) process.stdout.write(r.echo);
      if (r.kind === 'done') {
        finish();
        resolve(r.value);
      } else if (r.kind === 'cancelled') {
        finish();
        reject(cliError('cancelled. Nothing was created.'));
      }
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

const MAX_PASSWORD_ATTEMPTS = 3;

/** Asks twice, checks the policy, and lets the user retry instead of aborting the whole run. */
async function askPassword(email: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS; attempt++) {
    const password = await readHidden(
      `Password (min ${PASSWORD_MIN_LENGTH} chars with a letter, digit and symbol; shown as *): `,
    );
    const policy = checkPasswordPolicy(password, email);
    if (policy) {
      console.error(`  ${POLICY_HELP[policy]}. Try again.`);
      continue;
    }
    const again = await readHidden('Repeat password: ');
    if (password === again) return password;
    console.error('  Passwords do not match. Try again.');
  }
  throw cliError(`no valid password after ${MAX_PASSWORD_ATTEMPTS} attempts. Nothing was created.`);
}

const POLICY_HELP: Record<PasswordRule, string> = {
  PASSWORD_TOO_SHORT: `Too short — at least ${PASSWORD_MIN_LENGTH} characters`,
  PASSWORD_NEEDS_LETTER: 'Must contain a letter',
  PASSWORD_NEEDS_DIGIT: 'Must contain a digit',
  PASSWORD_NEEDS_SYMBOL: 'Must contain a symbol (e.g. ! @ # $ % - _)',
  PASSWORD_WHITESPACE_EDGES: 'Must not start or end with a space',
  PASSWORD_CONTAINS_EMAIL: 'Must not contain the name part of the email',
  PASSWORD_TOO_LONG: 'Too long',
};

await runCli('auth:create-admin', async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw cliError(
      'must be run interactively in a terminal on the host ' +
        '(in Git Bash/mintty use `winpty pnpm auth:create-admin`, or run it from PowerShell).',
    );
  }
  const config = loadConfig();
  console.log(`[auth:create-admin] target: ${config.DATABASE_PATH} (NODE_ENV=${config.NODE_ENV})`);

  let handle: DbHandle | undefined;
  try {
    handle = openDatabase(config.DATABASE_PATH);
    const status = getMigrationStatus(handle);
    if (status.applied === 0 || status.pending.length > 0) {
      throw cliError('database schema is not up to date. Run `pnpm db:migrate` first.');
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let email: string;
    let displayName: string;
    try {
      email = (await rl.question('Admin email: ')).trim();
      displayName = (await rl.question('Display name: ')).trim();
    } finally {
      rl.close();
    }

    const password = await askPassword(email);

    const parsed = createUserSchema.safeParse({ email, displayName, role: 'admin', password });
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
      throw cliError(`invalid input (${fields}). Nothing was created.`);
    }

    const admin = await bootstrapFirstAdmin(handle.db, parsed.data);
    console.log(`[auth:create-admin] admin created (role: ${admin.role}). Log in at the web UI.`);
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (err instanceof BootstrapRefusedError) throw cliError(`refused: ${err.message}`);
    // Policy/conflict errors: code + policy name only (never the password itself).
    if (err instanceof AppError) {
      throw cliError(`rejected: ${err.code} ${err.message}. Nothing was created.`);
    }
    throw cliError('FAILED — nothing was created.', err);
  } finally {
    handle?.close();
  }
});
