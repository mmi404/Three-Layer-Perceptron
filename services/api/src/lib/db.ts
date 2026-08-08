import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Postgres connection pool.
 *
 * Pool size matters under load: max 10 per replica x 3 replicas = 30 connections
 * against Postgres' default max_connections of 100. Know this number — it is the
 * honest answer to "what breaks first if traffic multiplies?".
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle postgres client');
});

/** Parameterised query helper. NEVER build SQL by string concatenation. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const started = Date.now();
  const res = await pool.query<T>(text, params as never[]);
  const durationMs = Date.now() - started;
  if (durationMs > 200) {
    logger.warn({ durationMs, text }, 'Slow query');
  }
  return res.rows;
}

/** Run several statements atomically. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Postgres is often still starting when the API boots. Retry instead of
 * crash-looping — this is why the stack comes up cleanly with one command.
 */
export async function waitForDatabase(retries = 15, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      logger.info('Database connection established');
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      logger.warn({ attempt, retries }, 'Database not ready, retrying');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
