-- Migration 005: Base price becomes the implicit threshold 0
--
-- Progressive tiers must now start strictly above 0.
-- Any existing tier at from_qty = 0 is folded back into pricing_items.base_price,
-- then removed before the stricter check constraint is applied.

BEGIN;

-- 1. Copy the zero-threshold tier price into base_price when present.
UPDATE pricing_items AS item
SET base_price = zero_tier.price
FROM (
    SELECT pricing_item_uuid, price
    FROM pricing_item_tiers
    WHERE from_qty = 0
) AS zero_tier
WHERE item.uuid = zero_tier.pricing_item_uuid;

-- 2. Remove explicit threshold-0 tiers; base_price now covers that bracket.
DELETE FROM pricing_item_tiers
WHERE from_qty = 0;

-- 3. Replace the old check constraint with a strict positive threshold rule.
ALTER TABLE pricing_item_tiers
    DROP CONSTRAINT IF EXISTS chk_pricing_item_tiers_from_qty;

ALTER TABLE pricing_item_tiers
    ADD CONSTRAINT chk_pricing_item_tiers_from_qty CHECK (from_qty > 0);

COMMIT;
