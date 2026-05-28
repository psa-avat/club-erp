-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 035: Add is_progressive to pricing_items, allow unit=7
--
-- Adds a boolean flag to switch between "last bracket wins" (default) and
-- "progressive bracket" pricing. Also widens the unit CHECK constraint to
-- accept 7 (UNIT_FIXED_DURATION_TRANCHE).
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

ALTER TABLE pricing_items
    ADD COLUMN IF NOT EXISTS is_progressive BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE pricing_items
    DROP CONSTRAINT IF EXISTS chk_pricing_items_unit;

ALTER TABLE pricing_items
    ADD CONSTRAINT chk_pricing_items_unit
    CHECK (unit IN (1, 2, 3, 4, 5, 6, 7));

COMMIT;
