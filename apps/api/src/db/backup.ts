import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const LABEL_RE = /^[a-z0-9-]{1,40}$/;

/**
 * Consistent online backup using SQLite's backup API (safe while the app is running in WAL mode,
 * unlike a raw file copy). The copy is converted to a single self-contained file, then verified
 * with integrity_check + foreign_key_check. A copy that fails verification never keeps a normal
 * `crm-*.sqlite` name: it is renamed to `*.failed` (or removed if it can't be renamed).
 */
export async function backupDatabase(
  sqlite: Database.Database,
  destDir: string,
  label = 'manual',
): Promise<string> {
  if (!LABEL_RE.test(label)) throw new Error('Invalid backup label');
  mkdirSync(destDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(destDir, `crm-${label}-${stamp}.sqlite`);

  try {
    await sqlite.backup(dest);
    const copy = new Database(dest, { fileMustExist: true });
    try {
      // The copy inherits WAL mode; make it one file (no -wal/-shm) so it can be moved/encrypted.
      copy.pragma('journal_mode = DELETE');
      const integrity = copy.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`integrity_check failed: ${String(integrity)}`);
      const fk = copy.pragma('foreign_key_check') as unknown[];
      if (fk.length > 0) throw new Error(`foreign_key_check found ${fk.length} violation(s)`);
    } finally {
      copy.close();
    }
    return dest;
  } catch (err) {
    // Cleanup must never replace the real reason the backup failed.
    const leftovers = quarantine(dest);
    const reason = err instanceof Error ? err.message : String(err);
    const note = leftovers.length
      ? ` Could not quarantine: ${leftovers.join(', ')} — delete it manually, it is NOT a valid backup.`
      : '';
    throw new Error(`Backup failed, no usable backup written: ${reason}.${note}`, { cause: err });
  }
}

/**
 * Moves a failed copy (and any -wal/-shm) out of the way as `*.failed`; if renaming fails it is
 * deleted. Returns files that could be neither renamed nor deleted. Never throws.
 */
function quarantine(file: string): string[] {
  const stuck: string[] = [];
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    if (!existsSync(f)) continue;
    try {
      renameSync(f, `${f}.failed`);
    } catch {
      try {
        rmSync(f, { force: true });
      } catch {
        stuck.push(path.basename(f));
      }
    }
  }
  return stuck;
}
