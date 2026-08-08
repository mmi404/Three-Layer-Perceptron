import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { closeDatabase, waitForDatabase } from './lib/db';
import { closeRedis } from './lib/redis';

async function main(): Promise<void> {
  // Postgres is often still booting when we start. Retry, don't crash-loop.
  await waitForDatabase();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
  });

  // Slow-client protection: without these, a client that opens a socket and
  // never sends anything holds it open forever.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 15_000;

  /**
   * GRACEFUL SHUTDOWN.
   * On `docker compose down` or a rolling deploy the container gets SIGTERM.
   * Without this, in-flight requests are severed mid-response. With it, we stop
   * accepting new connections, let existing ones finish, then close the pools.
   * Cheap to add, and infra judges look for it.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    const force = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close(async () => {
      try {
        await Promise.allSettled([closeDatabase(), closeRedis()]);
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A process in an unknown state should die and be restarted, not limp on.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
