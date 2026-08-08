import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pool, waitForDatabase } from '../lib/db';
import { logger } from '../lib/logger';

/**
 * Versioned, forward-only SQL migrations — ~60 lines, zero dependencies.
 *
 * WHY NOT ORM SYNC/AUTO-MIGRATE:
 * `synchronize: true` silently rewrites production schema on boot and can drop
 * columns. Migrations are reviewable files in git that run as an explicit
 * deploy step. "Migrations are a deploy step, not a boot step" is a strong
 * answer to "how would you roll this out?".
 *
 * Each file runs inside a transaction: it either fully applies or not at all.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>(`SELECT name FROM _migrations`);
  return new Set(rows.map((r) => r.name));
}

async function run(): Promise<void> {
  await waitForDatabase();
  await ensureMigrationsTable();

  const applied = await appliedMigrations();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 001_, 002_, ... lexical sort IS the order. Zero-pad your numbers.

  const pending = files.filter((f) => !applied.has(f));

  if (!pending.length) {
    logger.info({ total: files.length }, 'No pending migrations');
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'Migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.fatal({ err, file }, 'Migration failed — rolled back');
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info({ count: pending.length }, 'Migrations complete');
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'Migration run failed');
    process.exit(1);
  });
