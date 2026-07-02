-- Migration 067: remove per-asset GL account overrides — accounts live on asset_families only
--
-- Migration 066 added acquisition/depreciation/charge/revenue account overrides on assets so a
-- child asset (e.g. a trailer) could post to a different PCG account than its parent. In practice,
-- children are simply assigned to a different asset_family (e.g. "Trailers" vs "Aircrafts"), each
-- with its own family-level GL accounts — so per-asset overrides duplicated configuration that the
-- family level already covers. Assets now carry only price/depreciation inputs (purchase_price,
-- depreciation_start_date, depreciation_years, residual_value); GL accounts are configured once,
-- on the family.

ALTER TABLE assets
    DROP COLUMN IF EXISTS acquisition_account_uuid,
    DROP COLUMN IF EXISTS depreciation_account_uuid,
    DROP COLUMN IF EXISTS charge_account_uuid,
    DROP COLUMN IF EXISTS revenue_account_uuid,
    DROP COLUMN IF EXISTS accounting_account_code_snapshot;
