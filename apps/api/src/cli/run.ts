/**
 * Shared runner for the host CLIs: one place that turns any failure into a clear, one-line
 * message + exit code 1, instead of a raw stack trace (or a silently skipped `finally`).
 * Messages print error text only — never credentials, tokens or row data.
 */

/** An error whose message is already written for the operator. */
export class CliError extends Error {}

export const cliError = (message: string, cause?: unknown) => new CliError(message, { cause });

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` (cause: ${err.cause.message})` : '';
    return `${err.message}${cause}`;
  }
  return String(err);
}

export async function runCli(name: string, main: () => Promise<void> | void): Promise<void> {
  try {
    await main();
  } catch (err) {
    console.error(`[${name}] ${describe(err)}`);
    process.exitCode = 1;
  }
}
