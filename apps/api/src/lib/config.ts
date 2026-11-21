import { existsSync } from 'node:fs';
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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof envSchema> & { webDistPath: string };

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
  for (const key of ['DATABASE_PATH', 'BACKUP_DIR'] as const) {
    if (isNetworkPath(cfg[key])) {
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
    webDistPath: path.join(REPO_ROOT, 'apps/web/dist'),
  };
}
