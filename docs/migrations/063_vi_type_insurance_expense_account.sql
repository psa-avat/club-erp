-- Migration 063: add insurance_expense_account_uuid to vi_type_catalog
-- When set alongside insurance_account (401), the realization entry (Step 2b) posts:
--   D insurance_expense_account (e.g. 616) / C insurance_account (e.g. 401)
-- and D 419xxx is reduced to flight_portion only (insurance_amount moves to the 616 debit).

ALTER TABLE vi_type_catalog
    ADD COLUMN IF NOT EXISTS insurance_expense_account_uuid UUID
        REFERENCES accounting_accounts(uuid) ON DELETE SET NULL;
