import { rmSync } from 'node:fs';
import path from 'node:path';

/** Windows reports a file held open by another process as EBUSY or EPERM. */
const LOCKED_CODES = new Set(['EBUSY', 'EPERM']);

function isLockedFileError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof err.code === 'string' &&
    LOCKED_CODES.has(err.code)
  );
}

/**
 * Deletes a throwaway e2e file. A file that is still LOCKED (e.g. by the API server, which
 * Playwright stops only after global teardown) is skipped with a warning and cleaned up on the
 * next run. Any other error (permissions, bad path, …) is rethrown, never swallowed.
 * Returns true if the file is gone.
 */
export function removeE2eFile(file: string): boolean {
  try {
    rmSync(file, { force: true }); // force: a missing file is not an error
    return true;
  } catch (err) {
    if (!isLockedFileError(err)) throw err;
    console.warn(
      `[e2e] ${path.basename(file)} is still locked (${(err as NodeJS.ErrnoException).code}); ` +
        'it will be removed on the next run.',
    );
    return false;
  }
}
