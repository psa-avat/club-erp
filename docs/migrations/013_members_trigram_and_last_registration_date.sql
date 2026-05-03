-- Migration 013: replace last_registration_year with last_registration_date and add trigram
-- Applies to PostgreSQL (production). SQLite handled by schema recreation.

-- ── PostgreSQL ──────────────────────────────────────────────────────────────

-- 1. Drop the old year-based check constraint
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_members_last_registration_year'
          AND table_name = 'members'
    ) THEN
        ALTER TABLE members DROP CONSTRAINT chk_members_last_registration_year;
    END IF;
END $$;

-- 2. Derive last_registration_date from the old integer year before dropping it
--    (keeps data: year 2025 → 2025-12-31)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'members' AND column_name = 'last_registration_year'
    ) THEN
        ALTER TABLE members ADD COLUMN IF NOT EXISTS last_registration_date DATE;
        UPDATE members
           SET last_registration_date = make_date(last_registration_year, 12, 31)
         WHERE last_registration_year IS NOT NULL;
        DROP INDEX IF EXISTS ix_members_last_registration_year;
        ALTER TABLE members DROP COLUMN last_registration_year;
    END IF;
END $$;

-- 3. Index on the new date column
CREATE INDEX IF NOT EXISTS ix_members_last_registration_date ON members (last_registration_date);

-- 4. Add trigram column (max 3 chars, uppercase convention enforced at app layer)
ALTER TABLE members ADD COLUMN IF NOT EXISTS trigram VARCHAR(3);
