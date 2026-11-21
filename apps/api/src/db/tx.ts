import type { AppDb } from './client.js';

/** Drizzle transaction handle for the sync better-sqlite3 driver. */
export type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/** Anything that can run queries: the root DB or an open transaction. Repositories accept this. */
export type Executor = AppDb | Tx;

/**
 * Runs `fn` atomically. better-sqlite3 is synchronous, so `fn` MUST NOT be async —
 * an awaited gap would let the transaction commit before the work finishes.
 *
 * - Root DB: BEGIN IMMEDIATE (takes the write lock up front → no SQLITE_BUSY on lock upgrade).
 * - Inside a transaction: nested SAVEPOINT, so a service can call another service safely.
 * Any thrown error rolls back everything done inside `fn`.
 */
export function withTransaction<T>(exec: Executor, fn: (tx: Tx) => T): T {
  const guarded = (tx: Tx): T => {
    const result = fn(tx);
    // Any thenable, not just native Promise. NOTE: this fires after the callback's sync prefix,
    // so writes after an `await` would escape the (rolled-back) transaction. Never pass async fns.
    if (typeof (result as { then?: unknown } | null)?.then === 'function') {
      throw new Error('withTransaction callback must be synchronous');
    }
    return result;
  };
  // Both AppDb and Tx expose a compatible sync `transaction`; the union call needs one signature.
  return (exec as AppDb).transaction(guarded, { behavior: 'immediate' });
}
