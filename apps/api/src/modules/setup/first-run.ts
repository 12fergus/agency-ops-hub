import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { DbHandle } from '../../db/client.js';
import { getMigrationStatus } from '../../db/migrator.js';
import { countLoginCapableAdmins } from '../../db/repositories/users.js';
import type { Config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { bootstrapFirstAdmin } from '../users/service.js';

/**
 * First-run setup without a terminal (ADR-017).
 *
 * While NO login-capable admin exists:
 * - INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD (env, optional) create the first admin at startup;
 * - otherwise a ONE-TIME setup code is generated and written to `setup-code.txt` next to the
 *   database (never logged — the log only says where the file is). The web shows an
 *   initial-setup page that requires this code. Whoever can read the server's data folder
 *   (i.e. the owner of the office PC) can create the first admin; a LAN visitor cannot.
 * Once an admin exists the code is deleted and the setup route answers 404.
 */

// No 0/O/1/I/L: easy to read off a screen and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 3;
const GROUP_LEN = 4; // 12 chars ≈ 59 bits — plus rate limiting, brute force is hopeless

const hashCode = (code: string) =>
  createHash('sha256').update(normalizeCode(code), 'utf8').digest();

/** Accept the code typed with or without dashes/spaces, any case. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');

function generateCode(): string {
  return Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  ).join('-');
}

export class FirstRunSetup {
  private codeHash: Buffer | null = null;
  private plainForProcess: string | null = null;

  constructor(
    private readonly db: DbHandle,
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Where the code is written. In-memory DBs (tests) have no data folder → no file. */
  get codeFile(): string | null {
    if (this.config.DATABASE_PATH === ':memory:') return null;
    return path.join(path.dirname(this.config.DATABASE_PATH), 'setup-code.txt');
  }

  /** True while the DB is migrated and has no admin that can log in. */
  needsSetup(): boolean {
    const status = getMigrationStatus(this.db);
    if (status.applied === 0) return false; // not migrated: setup can't work yet
    return countLoginCapableAdmins(this.db.db) === 0;
  }

  /**
   * Called at server start (and lazily). Applies the env bootstrap if configured, otherwise makes
   * sure a setup code exists. Never throws: a bad env value is logged and setup mode stays on.
   */
  async prepare(): Promise<void> {
    if (getMigrationStatus(this.db).applied === 0) {
      this.log.error('database is not migrated — run the migrations before first use');
      return;
    }
    if (!this.needsSetup()) {
      this.clearCode();
      if (this.config.INITIAL_ADMIN_PASSWORD) {
        this.log.warn(
          'INITIAL_ADMIN_* is set but an admin already exists — remove it from the config',
        );
      }
      return;
    }

    const email = this.config.INITIAL_ADMIN_EMAIL;
    const password = this.config.INITIAL_ADMIN_PASSWORD;
    if (email && password) {
      try {
        await bootstrapFirstAdmin(this.db.db, {
          email,
          displayName: this.config.INITIAL_ADMIN_NAME,
          password,
        });
        this.clearCode();
        this.log.warn(
          'first admin created from INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD — remove ' +
            'INITIAL_ADMIN_PASSWORD from the service configuration now',
        );
        return;
      } catch (err) {
        // e.g. password breaks the policy. Message only, never the value.
        const reason = err instanceof AppError ? `${err.code} ${err.message}` : String(err);
        this.log.error(
          `INITIAL_ADMIN_* could not be applied (${reason}) — falling back to setup code`,
        );
      }
    }
    this.ensureCode();
  }

  /** Generates the code once per process run and writes it to the file (not to the log). */
  ensureCode(): void {
    if (this.codeHash) return;
    const code = generateCode();
    this.codeHash = hashCode(code);
    this.plainForProcess = code;
    const file = this.codeFile;
    if (file) {
      writeFileSync(
        file,
        `CRM initial setup code (one-time; deleted automatically after the first admin is created):\n${code}\n`,
        { mode: 0o600 },
      );
      this.log.warn(`no admin yet — open the web app and use the setup code from: ${file}`);
    }
  }

  verifyCode(candidate: string): boolean {
    if (!this.codeHash) return false;
    const given = hashCode(candidate);
    return given.length === this.codeHash.length && timingSafeEqual(given, this.codeHash);
  }

  clearCode(): void {
    this.codeHash = null;
    this.plainForProcess = null;
    const file = this.codeFile;
    if (file && existsSync(file)) rmSync(file, { force: true });
  }

  /** In-process only (tests, the browser-check instance). There is NO HTTP route for this. */
  currentCodeForProcess(): string | null {
    return this.plainForProcess;
  }
}
