-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 039: Add valid_from to member_pack_consumptions
--
-- The valid_from date determines when a pack consumption becomes applicable.
-- Only flights on or after this date are eligible for the pack discount.
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

ALTER TABLE member_pack_consumptions
    ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN member_pack_consumptions.valid_from IS 'Pack is applicable only to flights on or after this date';

COMMIT;
