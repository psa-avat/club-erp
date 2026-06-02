-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 038: Drop eligible_asset_type_uuid from pack_definitions
--
-- The eligible asset type filter is redundant — pack applicability is now
-- determined solely by the pricing items linked via pack_applicability.
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

ALTER TABLE pack_definitions
    DROP COLUMN IF EXISTS eligible_asset_type_uuid;

ALTER TABLE pack_definitions
    DROP CONSTRAINT IF EXISTS pack_definitions_eligible_asset_type_uuid_fkey;

COMMIT;
