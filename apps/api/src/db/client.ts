import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface DbHandle {
  sqlite: Database.Database;
  db: BetterSQLite3Database;
  close: () => void;
}

/**
 * Opens the single SQLite connection owned by this API process.
 * The file must live on the host's local disk — never a network share.
 */
export function openDatabase(filePath: string): DbHandle {
  if (filePath !== ':memory:') mkdirSync(path.dirname(filePath), { recursive: true });

  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');

  const db = drizzle({ client: sqlite });
  return { sqlite, db, close: () => sqlite.close() };
}

export function pingDatabase(sqlite: Database.Database): boolean {
  try {
    return sqlite.prepare('SELECT 1 AS ok').get() !== undefined;
  } catch {
    return false;
  }
}
