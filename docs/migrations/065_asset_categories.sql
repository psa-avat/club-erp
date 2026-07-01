-- Migration 065: configurable asset categories with accounting-account mappings
-- Replaces the hardcoded asset_families.category SMALLINT enum (1-5) with a FK to a new,
-- open-ended asset_categories catalog. Each category carries 4 optional account references
-- (acquisition, depreciation/accumulated-depreciation, charge, revenue) for future
-- depreciation/cost-provisioning features. Configuration only — nothing consumes these
-- accounts programmatically yet.

CREATE TABLE IF NOT EXISTS asset_categories (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    acquisition_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    depreciation_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    charge_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    revenue_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_asset_categories_code UNIQUE (code)
);

-- Seed the 5 categories that today's hardcoded enum represents (French-first club data).
INSERT INTO asset_categories (code, name, is_active) VALUES
    ('AIRCRAFT', 'Aéronef', true),
    ('LAUNCH_EQUIPMENT', 'Équipement de lancement', true),
    ('SUPPORT', 'Support', true),
    ('CONSUMABLE', 'Consommable', true),
    ('SERVICE', 'Service', true)
ON CONFLICT (code) DO NOTHING;

-- Add nullable FK column to asset_families, backfill from the legacy integer, then enforce NOT NULL.
ALTER TABLE asset_families
    ADD COLUMN IF NOT EXISTS category_uuid UUID REFERENCES asset_categories(uuid);

UPDATE asset_families SET category_uuid = (
    SELECT uuid FROM asset_categories WHERE code = CASE asset_families.category
        WHEN 1 THEN 'AIRCRAFT'
        WHEN 2 THEN 'LAUNCH_EQUIPMENT'
        WHEN 3 THEN 'SUPPORT'
        WHEN 4 THEN 'CONSUMABLE'
        WHEN 5 THEN 'SERVICE'
    END
) WHERE category_uuid IS NULL;

ALTER TABLE asset_families
    ALTER COLUMN category_uuid SET NOT NULL;

-- Drop the old enum column, its CHECK constraint, and its index; add index on the new FK.
ALTER TABLE asset_families DROP CONSTRAINT IF EXISTS chk_asset_families_category;
DROP INDEX IF EXISTS ix_asset_families_category;
ALTER TABLE asset_families DROP COLUMN IF EXISTS category;
CREATE INDEX IF NOT EXISTS ix_asset_families_category_uuid ON asset_families (category_uuid);
