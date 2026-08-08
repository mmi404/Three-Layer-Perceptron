import { pool } from '../lib/db';
import { logger } from '../lib/logger';

/**
 * Demo seed data.
 *
 * Run this after deploying. A judge who opens your live URL and sees an empty
 * screen has to take your word that it works; a judge who sees real data does
 * not. Idempotent, so it is safe to run twice.
 */
async function seed(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM items`);
  if (Number(rows[0]?.count ?? 0) > 0) {
    logger.info('Database already seeded, skipping');
    return;
  }

  await pool.query(
    `INSERT INTO items (title, description, status) VALUES
       ($1, $2, 'active'),
       ($3, $4, 'active'),
       ($5, $6, 'draft'),
       ($7, $8, 'archived')`,
    [
      'First demo item', 'Seeded so the live demo is never an empty screen.',
      'Second demo item', 'Replace all of this with data from the real problem.',
      'A draft item', 'Shows the draft state in the UI.',
      'An archived item', 'Terminal state — cannot be reactivated.',
    ],
  );

  logger.info('Seed complete');
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'Seed failed');
    process.exit(1);
  });
