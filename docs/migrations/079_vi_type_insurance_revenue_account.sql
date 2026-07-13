-- Migration 079: add insurance_revenue_account_uuid to vi_type_catalog
-- When set alongside insurance_expense_account (e.g. 6169) and insurance_account (401),
-- the realization entry (Step 2a) posts:
--   C revenue_account          (flight_portion = amount_ttc - insurance_amount)
--   C insurance_revenue_account (insurance_amount)  e.g. 7069
-- instead of crediting the full amount_ttc to revenue_account alone.

ALTER TABLE vi_type_catalog
    ADD COLUMN IF NOT EXISTS insurance_revenue_account_uuid UUID
        REFERENCES accounting_accounts(uuid) ON DELETE SET NULL;
