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

/**
 * 40001 = serialization_failure, 40P01 = deadlock_detected. Both mean
 * Postgres aborted OUR transaction to break a conflict — not that anything
 * is broken. Retrying is safe here specifically because no network call ever
 * happens inside a transaction: `fn` re-executes as a clean, self-contained
 * unit with no external side effect to duplicate.
 */
const RETRYABLE_PG_CODES = new Set(['40001', '40P01']);
const MAX_TX_ATTEMPTS = 3;

/** Run several statements atomically, retrying on deadlock/serialization conflicts. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const code = (err as { code?: string }).code;
      const retryable = !!code && RETRYABLE_PG_CODES.has(code) && attempt < MAX_TX_ATTEMPTS;
      if (!retryable) throw err;
      logger.warn({ code, attempt }, 'Transaction aborted on conflict, retrying');
    } finally {
      client.release();
    }
    await new Promise((r) => setTimeout(r, 20 * attempt));
  }
  /* istanbul ignore next — unreachable: the loop always returns or throws */
  throw new Error('withTransaction: unreachable');
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
