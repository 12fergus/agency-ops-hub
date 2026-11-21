import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type AppDb = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  sqlite: Database.Database;
  db: AppDb;
  filePath: string;
  close: () => void;
}

/**
 * Opens the single SQLite connection owned by this API process.
 * The file must live on the host's LOCAL disk — never a network share (SMB/NFS locking
 * is unreliable and WAL requires shared memory on the same machine).
 */
export function openDatabase(filePath: string): DbHandle {
  if (filePath !== ':memory:') mkdirSync(path.dirname(filePath), { recursive: true });

  const sqlite = new Database(filePath);
  // busy_timeout first: the WAL switch itself may wait on another connection (backup/migrate CLI).
  sqlite.pragma('busy_timeout = 5000');
  const mode = sqlite.pragma('journal_mode = WAL', { simple: true });
  sqlite.pragma('foreign_keys = ON');
  // NORMAL in WAL: no corruption on power loss, but the last few commits may be lost.
  sqlite.pragma('synchronous = NORMAL');

  const expectedMode = filePath === ':memory:' ? 'memory' : 'wal';
  if (mode !== expectedMode || sqlite.pragma('foreign_keys', { simple: true }) !== 1) {
    sqlite.close();
    throw new Error(`SQLite setup failed (journal_mode=${String(mode)}, foreign_keys not ON?)`);
  }

  const db = drizzle({ client: sqlite, schema });
  return { sqlite, db, filePath, close: () => sqlite.close() };
}

export function pingDatabase(sqlite: Database.Database): boolean {
  try {
    return sqlite.prepare('SELECT 1 AS ok').get() !== undefined;
  } catch {
    return false;
  }
}
