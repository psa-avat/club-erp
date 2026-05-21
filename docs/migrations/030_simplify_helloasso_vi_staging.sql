-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 030: Simplify helloasso_vi_staging — item_id as sole unique key,
--   drop order_id, payment_id, campaign_type, payment_state, item_state
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

-- 1. Drop the old composite unique constraint
ALTER TABLE helloasso_vi_staging
    DROP CONSTRAINT IF EXISTS uq_helloasso_vi_staging_order_item_payment;

-- 2. Add the new simple unique constraint on item_id
ALTER TABLE helloasso_vi_staging
    ADD CONSTRAINT uq_helloasso_vi_staging_item_id UNIQUE (item_id);

-- 3. Drop obsolete indexes
DROP INDEX IF EXISTS idx_helloasso_vi_staging_order_id;
DROP INDEX IF EXISTS idx_helloasso_vi_staging_payment_id;
DROP INDEX IF EXISTS idx_helloasso_vi_staging_campaign_type;

-- 4. Drop obsolete columns
ALTER TABLE helloasso_vi_staging
    DROP COLUMN IF EXISTS order_id,
    DROP COLUMN IF EXISTS payment_id,
    DROP COLUMN IF EXISTS campaign_type,
    DROP COLUMN IF EXISTS payment_state,
    DROP COLUMN IF EXISTS item_state;

-- 5. Ensure item_id index exists (it was already created in 029, but re-assert)
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_item_id
    ON helloasso_vi_staging(item_id);

COMMIT;
