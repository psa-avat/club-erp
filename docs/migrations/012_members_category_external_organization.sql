-- Migration 012: extend member_category to allow value 7 (External Organization)
-- Applies to both PostgreSQL (production) and SQLite (local dev).
--
-- PostgreSQL: constraints are named; drop the old one, add the new one.
-- SQLite:     CHECK constraints cannot be altered in place; the table is recreated
--             automatically when SQLAlchemy creates the schema from scratch.

-- ── PostgreSQL ──────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_members_category'
          AND table_name = 'members'
    ) THEN
        ALTER TABLE members DROP CONSTRAINT chk_members_category;
    END IF;
END $$;

ALTER TABLE members
    ADD CONSTRAINT chk_members_category
    CHECK (member_category BETWEEN 1 AND 7);
