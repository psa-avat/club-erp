-- Migration 006: Add pack_price column to pricing_item_tiers
-- Each progressive bracket now carries an optional pack price in addition to the
-- standard price, mirroring the base_price / pack_price pair on pricing_items.

ALTER TABLE pricing_item_tiers
    ADD COLUMN IF NOT EXISTS pack_price NUMERIC(10, 4) NULL;

ALTER TABLE pricing_item_tiers
    DROP CONSTRAINT IF EXISTS chk_pricing_item_tiers_pack_price;

ALTER TABLE pricing_item_tiers
    ADD CONSTRAINT chk_pricing_item_tiers_pack_price
        CHECK (pack_price IS NULL OR pack_price >= 0);
