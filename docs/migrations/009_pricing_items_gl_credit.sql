-- Migration 009: Add gl_account_credit_uuid to pricing_items
-- Revenue account (class 7) credited when the pricing item is billed.
ALTER TABLE pricing_items
    ADD COLUMN IF NOT EXISTS gl_account_credit_uuid UUID
        REFERENCES accounting_accounts(uuid) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pricing_items_gl_account_credit
    ON pricing_items(gl_account_credit_uuid);
