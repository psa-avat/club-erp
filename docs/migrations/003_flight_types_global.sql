-- Migration 003: Make flight types global (remove asset_type_uuid FK)
--
-- Flight types are no longer tied to a specific asset type.
-- They are now a global catalog shared across all asset types.
--
-- Run this migration ONCE against your existing database.
-- WARNING: if duplicate `code` values exist across asset types, resolve them first.

BEGIN;

-- 1. Drop the old per-type unique constraint
ALTER TABLE asset_flight_types
    DROP CONSTRAINT IF EXISTS uq_asset_flight_types_code_per_type;

-- 2. Add new global unique constraint on code alone
ALTER TABLE asset_flight_types
    ADD CONSTRAINT uq_asset_flight_types_code UNIQUE (code);

-- 3. Drop the FK column
ALTER TABLE asset_flight_types
    DROP COLUMN IF EXISTS asset_type_uuid;

COMMIT;
