import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

/** Repo root, resolved from apps/api/{src,dist}/lib. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('data/crm.sqlite'),
  BACKUP_DIR: z.string().min(1).default('backups'),
  /** Client photos etc. Default: <folder of DATABASE_PATH>/uploads. Local disk only. */
  UPLOADS_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Absolute session lifetime. */
  SESSION_TTL_HOURS: z.coerce
    .number()
    .min(1)
    .max(24 * 30)
    .default(12),
  /** Session ends after this much inactivity. */
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .min(5)
    .max(24 * 60)
    .default(120),
  /** 'auto' = Secure only when the request arrived over HTTPS (needs TRUST_PROXY behind a proxy). */
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  /** Set to true only when a reverse proxy on this host terminates TLS. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Show "sign up" on the login page (new accounts are employees with no client access). */
  SELF_SIGNUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** false (default): sign-up logs straight in. true: sign-ups wait for admin approval. */
  SIGNUP_REQUIRES_APPROVAL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Optional first-admin bootstrap for scripted installs: used ONCE at startup while no admin
   * exists. Remove INITIAL_ADMIN_PASSWORD from the config afterwards (it is plain text).
   */
  INITIAL_ADMIN_EMAIL: z.string().trim().toLowerCase().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().optional(),
  INITIAL_ADMIN_NAME: z.string().trim().min(1).max(100).default('מנהל/ת מערכת'),
  /** Extra allowed Origins for state-changing requests (comma-separated), besides same-origin. */
  TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

export type Config = Omit<z.infer<typeof envSchema>, 'UPLOADS_DIR'> & {
  webDistPath: string;
  /** Resolved uploads folder (always set). */
  UPLOADS_DIR: string;
};

/**
 * UNC paths (`\\server\share`, `//server/share`) are network shares: SQLite locking/WAL is unsafe
 * there. Mapped drive letters (e.g. Z:) can't be detected portably — see docs/operations.md.
 */
export function isNetworkPath(p: string): boolean {
  const s = p.replaceAll('/', '\\');
  // Win32 long-path prefix `\\?\C:\...` is local; `\\?\UNC\server\share` is not.
  if (s.startsWith('\\\\?\\')) return s.slice(4).toUpperCase().startsWith('UNC\\');
  return s.startsWith('\\\\');
}

/** Loads `.env` from the repo root if present (real env vars win), then validates. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const envFile = path.join(REPO_ROOT, '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Print only field names and messages, never values.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  for (const key of ['DATABASE_PATH', 'BACKUP_DIR', 'UPLOADS_DIR'] as const) {
    const value = cfg[key];
    if (value && isNetworkPath(value)) {
      throw new Error(`${key} must be on the host's local disk, not a network share`);
    }
  }
  return {
    ...cfg,
    DATABASE_PATH:
      cfg.DATABASE_PATH === ':memory:'
        ? cfg.DATABASE_PATH
        : path.resolve(REPO_ROOT, cfg.DATABASE_PATH),
    BACKUP_DIR: path.resolve(REPO_ROOT, cfg.BACKUP_DIR),
    UPLOADS_DIR: cfg.UPLOADS_DIR
      ? path.resolve(REPO_ROOT, cfg.UPLOADS_DIR)
      : cfg.DATABASE_PATH === ':memory:'
        ? path.join(tmpdir(), `crm-uploads-${process.pid}`)
        : path.join(path.dirname(path.resolve(REPO_ROOT, cfg.DATABASE_PATH)), 'uploads'),
    webDistPath: path.join(REPO_ROOT, 'apps/web/dist'),
  };
}
