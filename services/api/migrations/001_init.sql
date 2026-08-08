-- =============================================================================
--  001_init — baseline schema
--  Replace `items` with the real domain once the problem statement is out.
--  Keep the patterns: UUID pks, timestamptz, CHECK constraints, real indexes.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  -- Enforce the state machine in the DB too, not only in application code.
  status      TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'active', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INDEXES: these exist because of specific queries, not by reflex.
--   Know which query each one serves — the panel may well ask.

-- Serves keyset pagination: ORDER BY created_at DESC, id DESC
CREATE INDEX IF NOT EXISTS items_created_at_id_idx
  ON items (created_at DESC, id DESC);

-- Serves the filtered list: WHERE status = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS items_status_created_at_idx
  ON items (status, created_at DESC);

-- Keep updated_at honest without remembering to set it in every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS items_set_updated_at ON items;
CREATE TRIGGER items_set_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
