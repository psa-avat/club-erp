-- Migration 064: rename AssetType -> AssetFamily (pure metadata rename, no data migration)
-- Clarifies the future hierarchy Category -> Family -> Asset (see migration 065, which adds
-- the configurable AssetCategory catalog on top of AssetFamily). ALTER TABLE/COLUMN RENAME
-- preserves data, constraints, indexes, and FK relationships automatically in Postgres.

ALTER TABLE asset_types RENAME TO asset_families;
ALTER TABLE asset_families RENAME CONSTRAINT chk_asset_types_category TO chk_asset_families_category;
ALTER TABLE asset_families RENAME CONSTRAINT chk_asset_types_pricing_strategy TO chk_asset_families_pricing_strategy;

ALTER TABLE assets RENAME COLUMN asset_type_uuid TO asset_family_uuid;
ALTER TABLE pricing_versions RENAME COLUMN asset_type_uuid TO asset_family_uuid;
ALTER TABLE cost_provision_rules RENAME COLUMN asset_type_uuid TO asset_family_uuid;

-- Index renames (names as created by docs/migrations/upgrade_2026_04_28_full_schema.sql).
-- Guard each with a catalog check since some deployments may have created these indexes
-- with different auto-generated names (e.g. from an ADD COLUMN without an explicit index).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_assets_asset_type_uuid') THEN
        ALTER INDEX idx_assets_asset_type_uuid RENAME TO idx_assets_asset_family_uuid;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_pricing_versions_asset_type') THEN
        ALTER INDEX ix_pricing_versions_asset_type RENAME TO ix_pricing_versions_asset_family;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_cost_provision_rules_asset_type') THEN
        ALTER INDEX ix_cost_provision_rules_asset_type RENAME TO ix_cost_provision_rules_asset_family;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_asset_types_category') THEN
        ALTER INDEX ix_asset_types_category RENAME TO ix_asset_families_category;
    END IF;
END $$;
