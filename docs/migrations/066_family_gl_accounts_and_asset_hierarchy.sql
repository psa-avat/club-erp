-- Migration 066: collapse Category -> Family -> Asset into Family -> Asset, add asset hierarchy
--
-- Migration 065 introduced a configurable `asset_categories` catalog sitting between asset_families
-- and assets, mainly to carry 4 GL account defaults per category. In practice every family maps to
-- exactly one category, so the extra level adds a hop without adding flexibility. This migration
-- moves the 4 GL account columns directly onto asset_families (1:1 copy, no data loss) and drops
-- asset_categories entirely.
--
-- It also adds a self-referential parent_asset_uuid on assets so a "main machine" (e.g. a glider)
-- can have child assets (trailer, gelcoat/paint refit, engine swap) that are independent accounting
-- items with their own GL account and depreciation profile, while remaining grouped under the
-- parent for operational/reporting purposes. Depth is limited to 2 levels (root + direct children);
-- this is enforced at the service layer, not by the database.
--
-- Two new booleans make the "priced vs. accounting-only" distinction explicit and self-service:
--   - asset_families.is_priced: whether this family is expected to carry a flight tariff
--     (pricing_versions). Families like Trailers/Painting/Huge repairs/Parachutes/Engines/
--     Runway vehicles/Mower are typically NOT priced.
--   - assets.is_bookable: whether this individual asset can appear in flight selection and gets
--     pushed to Planche. Sub-components (trailers, refits) are typically NOT bookable.
-- All existing rows get is_priced=true / is_bookable=true via DEFAULT — no separate backfill needed.

-- 1. Add the 4 GL account columns to asset_families (same shape as asset_categories' columns).
ALTER TABLE asset_families
    ADD COLUMN IF NOT EXISTS acquisition_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS depreciation_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS charge_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS revenue_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL;

-- 2. Backfill from asset_categories via each family's category_uuid (1:1 copy — category_uuid is
--    NOT NULL today, so every family matches exactly one category).
UPDATE asset_families af
SET acquisition_account_uuid = ac.acquisition_account_uuid,
    depreciation_account_uuid = ac.depreciation_account_uuid,
    charge_account_uuid = ac.charge_account_uuid,
    revenue_account_uuid = ac.revenue_account_uuid
FROM asset_categories ac
WHERE af.category_uuid = ac.uuid;

-- 3. Explicit priced/unpriced flag per family.
ALTER TABLE asset_families
    ADD COLUMN IF NOT EXISTS is_priced BOOLEAN NOT NULL DEFAULT true;

-- 4. Drop the category FK, its index, and the asset_categories table.
DROP INDEX IF EXISTS ix_asset_families_category_uuid;
ALTER TABLE asset_families DROP COLUMN IF EXISTS category_uuid;
DROP TABLE IF EXISTS asset_categories;

-- 5. Self-referential parent/child relationship on assets (2-level depth enforced in the service
--    layer). Plain FK, no cascade, consistent with the existing asset_family_uuid FK on assets.
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS parent_asset_uuid UUID REFERENCES assets(uuid);
CREATE INDEX IF NOT EXISTS ix_assets_parent_asset_uuid ON assets (parent_asset_uuid);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_assets_no_self_parent'
    ) THEN
        ALTER TABLE assets
            ADD CONSTRAINT chk_assets_no_self_parent CHECK (parent_asset_uuid IS NULL OR parent_asset_uuid <> uuid);
    END IF;
END $$;

-- 6. Per-asset GL account overrides mirroring the existing acquisition_account_uuid override.
--    When null, the asset's family default applies.
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS depreciation_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS charge_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS revenue_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_assets_depreciation_account_uuid ON assets (depreciation_account_uuid);
CREATE INDEX IF NOT EXISTS ix_assets_charge_account_uuid ON assets (charge_account_uuid);
CREATE INDEX IF NOT EXISTS ix_assets_revenue_account_uuid ON assets (revenue_account_uuid);

-- 7. Bookable flag: excludes accounting-only sub-components from flight selection and Planche push.
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS is_bookable BOOLEAN NOT NULL DEFAULT true;
