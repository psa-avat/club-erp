-- ERP-CLUB - ERP pour Club de vol à voile
-- Migration 011: committees add last_meeting_date and budget_status
--
-- Adds backend fields required by Members UX V2 committee admin table:
-- - last_meeting_date DATE NULL
-- - budget_status SMALLINT NULL (1=ON TRACK, 2=PENDING REV., 3=OVER BUDGET)
--
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

ALTER TABLE committees
    ADD COLUMN IF NOT EXISTS last_meeting_date DATE;

ALTER TABLE committees
    ADD COLUMN IF NOT EXISTS budget_status SMALLINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_committees_budget_status'
    ) THEN
        EXECUTE '
            ALTER TABLE committees
            ADD CONSTRAINT chk_committees_budget_status
            CHECK (budget_status IS NULL OR budget_status BETWEEN 1 AND 3)
        ';
    END IF;
END $$;

COMMIT;
