-- =============================================================================
-- ERP-CLUB — Migration: Replace threshold pair with pricing_item_tiers table
-- Run AFTER migrate_pricing_items_cleanup.sql
-- =============================================================================

BEGIN;

-- 1. Drop old threshold constraints (if still present)
ALTER TABLE pricing_items
    DROP CONSTRAINT IF EXISTS chk_pricing_items_threshold_pair,
    DROP CONSTRAINT IF EXISTS chk_pricing_items_threshold_count;

-- 2. Drop old threshold columns (if still present)
ALTER TABLE pricing_items
    DROP COLUMN IF EXISTS threshold_unit_count,
    DROP COLUMN IF EXISTS threshold_price;

-- 3. Add pack_price (if not already added by migrate_pricing_items_cleanup.sql)
ALTER TABLE pricing_items
    ADD COLUMN IF NOT EXISTS pack_price NUMERIC(10, 4) NULL;

ALTER TABLE pricing_items
    DROP CONSTRAINT IF EXISTS chk_pricing_items_pack_price;

ALTER TABLE pricing_items
    ADD CONSTRAINT chk_pricing_items_pack_price
        CHECK (pack_price IS NULL OR pack_price >= 0);

-- 4. Create pricing_item_tiers table
CREATE TABLE IF NOT EXISTS pricing_item_tiers (
    uuid              UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    pricing_item_uuid UUID         NOT NULL
        REFERENCES pricing_items (uuid) ON DELETE CASCADE,
    from_qty          NUMERIC(10, 4) NOT NULL,
    price             NUMERIC(10, 4) NOT NULL,
    sort_order        SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT chk_pricing_item_tiers_from_qty CHECK (from_qty >= 0),
    CONSTRAINT chk_pricing_item_tiers_price    CHECK (price >= 0)
);

-- 5. Index for fast lookup by item
CREATE INDEX IF NOT EXISTS idx_pricing_item_tiers_item
    ON pricing_item_tiers (pricing_item_uuid);

COMMIT;
