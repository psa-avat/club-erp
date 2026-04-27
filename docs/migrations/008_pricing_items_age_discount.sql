-- Migration 008: Add age_discount_percent to pricing_items
-- Adds a percentage discount applied when the member is under 25 on January 1
-- of the active fiscal year.  Default 0 means no discount.

ALTER TABLE pricing_items
    ADD COLUMN IF NOT EXISTS age_discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE pricing_items
    ADD CONSTRAINT chk_pricing_items_age_discount
    CHECK (age_discount_percent >= 0 AND age_discount_percent <= 100);
