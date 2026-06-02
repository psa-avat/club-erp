-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 037: Drop pack_price from pricing_items and pricing_item_tiers
--
-- Pack pricing is now managed exclusively through pack_definitions and
-- pack_applicability (discounted_unit_price). The old pack_price columns
-- on individual pricing items/tiers are no longer used by the billing engine.
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

-- -------------------------------------------------------------------------
-- 1. Drop pack_price from pricing_item_tiers
-- -------------------------------------------------------------------------
ALTER TABLE pricing_item_tiers
    DROP COLUMN IF EXISTS pack_price;

-- Drop the associated check constraint (PostgreSQL auto-drops it with the column,
-- but we ensure it's removed by name in case the column was already dropped)
ALTER TABLE pricing_item_tiers
    DROP CONSTRAINT IF EXISTS chk_pricing_item_tiers_pack_price;

-- -------------------------------------------------------------------------
-- 2. Drop pack_price from pricing_items
-- -------------------------------------------------------------------------
ALTER TABLE pricing_items
    DROP COLUMN IF EXISTS pack_price;

ALTER TABLE pricing_items
    DROP CONSTRAINT IF EXISTS chk_pricing_items_pack_price;

COMMIT;
