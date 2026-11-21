import { buildApp } from './app/build-app.js';
import { loadConfig } from './lib/config.js';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  // Config errors list field names only (never values) — print them without a stack trace.
  console.error(`[server] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

let app: Awaited<ReturnType<typeof buildApp>>;
try {
  app = await buildApp(config); // opens the DB: fails on a locked/unreadable file or bad pragmas
} catch (err) {
  console.error(
    `[server] failed to initialise: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

let shuttingDown = false;
const shutdown = async (signal: string, exitCode = 0) => {
  if (shuttingDown) return; // second Ctrl+C while closing
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close(); // finishes in-flight requests, closes the SQLite connection
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    exitCode = 1;
  } finally {
    process.exit(exitCode);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// A bug that escapes every handler: log it, then exit and let the service manager restart us.
// Continuing in an unknown state is worse than a restart.
process.on('unhandledRejection', (err) => {
  app.log.fatal({ err }, 'unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException', 1);
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  await app.close().catch(() => undefined); // best effort: release the DB file before exiting
  process.exit(1);
}
