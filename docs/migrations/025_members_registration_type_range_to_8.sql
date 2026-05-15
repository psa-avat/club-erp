-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 025: Extend member_registrations.registration_type range to 1..8
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Context:
-- - member_category supports values 1..8.
-- - registration_type snapshots member_category in historical rows.
-- - Constraint from migration 015 still limits registration_type to 1..7.

BEGIN;

ALTER TABLE member_registrations
  DROP CONSTRAINT IF EXISTS chk_member_registrations_type;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_member_registrations_type'
    ) THEN
        ALTER TABLE member_registrations
          ADD CONSTRAINT chk_member_registrations_type
          CHECK (registration_type BETWEEN 1 AND 8);
    END IF;
END $$;

COMMIT;
