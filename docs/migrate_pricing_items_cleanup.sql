-- ERP-CLUB - ERP pour Club de vol à voile
-- - Logiciel libre de gestion d'un club de vol à voile
-- - pricing: remove pack pricing and insurance/fuel columns from pricing_items
-- Copyright (C) 2026  SAFORCADA Patrick
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

-- migrate_pricing_items_cleanup.sql
-- Idempotent migration: removes pack pricing and insurance/fuel fields from
-- pricing_items. Safe to re-run on an already-migrated database.
--
-- Changes:
--   DROP CONSTRAINT  chk_pricing_items_pack_pair   (pack pair integrity check)
--   DROP CONSTRAINT  chk_pricing_items_pack_count  (pack count > 0 check)
--   DROP COLUMN      pack_price
--   DROP COLUMN      pack_unit_count
--   DROP COLUMN      include_insurance
--   DROP COLUMN      include_fuel

BEGIN;

DO $$
BEGIN
    -- ── Drop pack-pair check constraint ──────────────────────────────────────
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_pricing_items_pack_pair'
          AND conrelid = 'pricing_items'::regclass
    ) THEN
        ALTER TABLE pricing_items
            DROP CONSTRAINT chk_pricing_items_pack_pair;
        RAISE NOTICE 'Dropped constraint chk_pricing_items_pack_pair';
    ELSE
        RAISE NOTICE 'Constraint chk_pricing_items_pack_pair not found, skipping';
    END IF;

    -- ── Drop pack-count check constraint ─────────────────────────────────────
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_pricing_items_pack_count'
          AND conrelid = 'pricing_items'::regclass
    ) THEN
        ALTER TABLE pricing_items
            DROP CONSTRAINT chk_pricing_items_pack_count;
        RAISE NOTICE 'Dropped constraint chk_pricing_items_pack_count';
    ELSE
        RAISE NOTICE 'Constraint chk_pricing_items_pack_count not found, skipping';
    END IF;

    -- ── Drop pack_price column ────────────────────────────────────────────────
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'pricing_items'
          AND column_name  = 'pack_price'
    ) THEN
        ALTER TABLE pricing_items DROP COLUMN pack_price;
        RAISE NOTICE 'Dropped column pricing_items.pack_price';
    ELSE
        RAISE NOTICE 'Column pricing_items.pack_price not found, skipping';
    END IF;

    -- ── Drop pack_unit_count column ───────────────────────────────────────────
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'pricing_items'
          AND column_name  = 'pack_unit_count'
    ) THEN
        ALTER TABLE pricing_items DROP COLUMN pack_unit_count;
        RAISE NOTICE 'Dropped column pricing_items.pack_unit_count';
    ELSE
        RAISE NOTICE 'Column pricing_items.pack_unit_count not found, skipping';
    END IF;

    -- ── Drop include_insurance column ─────────────────────────────────────────
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'pricing_items'
          AND column_name  = 'include_insurance'
    ) THEN
        ALTER TABLE pricing_items DROP COLUMN include_insurance;
        RAISE NOTICE 'Dropped column pricing_items.include_insurance';
    ELSE
        RAISE NOTICE 'Column pricing_items.include_insurance not found, skipping';
    END IF;

    -- ── Drop include_fuel column ──────────────────────────────────────────────
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'pricing_items'
          AND column_name  = 'include_fuel'
    ) THEN
        ALTER TABLE pricing_items DROP COLUMN include_fuel;
        RAISE NOTICE 'Dropped column pricing_items.include_fuel';
    ELSE
        RAISE NOTICE 'Column pricing_items.include_fuel not found, skipping';
    END IF;
END $$;

COMMIT;
