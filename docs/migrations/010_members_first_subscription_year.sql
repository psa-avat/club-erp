-- ERP-CLUB - ERP pour Club de vol à voile
-- Migration 010: rename seniority → first_subscription_year
--
-- Rationale: `seniority` stored a relative integer (number of years as member,
-- e.g. 5). `first_subscription_year` stores the absolute year of first
-- subscription (e.g. 2021), enabling "Member since 2021" display in the UI.
--
-- Data migration strategy (best-effort):
--   first_subscription_year = EXTRACT(YEAR FROM NOW())::SMALLINT - seniority
-- A member with seniority=5 in 2026 becomes first_subscription_year=2021.
-- Values that would fall outside [1950, 9999] are set to NULL.
-- Members where seniority IS NULL retain NULL.
--
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

-- Step 1: Add the new column (nullable, no constraint yet)
ALTER TABLE members
    ADD COLUMN IF NOT EXISTS first_subscription_year SMALLINT;

-- Step 2+3: Migrate existing seniority values then drop old column (if present)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'members'
          AND column_name = 'seniority'
    ) THEN
        EXECUTE '
            UPDATE members
            SET first_subscription_year = (EXTRACT(YEAR FROM NOW())::SMALLINT - seniority)
            WHERE seniority IS NOT NULL
              AND (EXTRACT(YEAR FROM NOW())::SMALLINT - seniority) BETWEEN 1950 AND 9999
        ';

        EXECUTE 'ALTER TABLE members DROP COLUMN IF EXISTS seniority';
    END IF;
END $$;

-- Step 4: Add the range check constraint on the new column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_members_first_subscription_year'
    ) THEN
        EXECUTE '
            ALTER TABLE members
            ADD CONSTRAINT chk_members_first_subscription_year
            CHECK (first_subscription_year IS NULL OR first_subscription_year BETWEEN 1950 AND 9999)
        ';
    END IF;
END $$;

-- Step 5: Create an index (drop old one by name if it existed)
DROP INDEX IF EXISTS idx_members_seniority;

CREATE INDEX IF NOT EXISTS idx_members_first_subscription_year
    ON members (first_subscription_year);

COMMIT;
