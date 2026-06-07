-- =============================================================================
-- Migration 045: Member Portal Login, Deposits & Sheet Cleanup
--
-- Implements Phases 3, 6, and 8 of members refactoring:
--   A. ALTER member_sheets        — add portal_password_hash for password-based portal auth
--   B. ALTER member_sheets        — DROP pack fields (redundant with vw_member_pack_balances)
--   C. ALTER flight_billing_settings — add deposit columns (journal, bank account, receivable)
-- =============================================================================

BEGIN;

-- =========================================================================
-- A. ALTER member_sheets — add portal_password_hash
-- =========================================================================

ALTER TABLE member_sheets
    ADD COLUMN IF NOT EXISTS portal_password_hash VARCHAR(255) NULL;

COMMENT ON COLUMN member_sheets.portal_password_hash
    IS 'SHA256 hash of portal password. If NULL, default password = {ffvp_id}_{YYYYMMDD} (date of birth)';

-- =========================================================================
-- B. ALTER member_sheets — DROP pack fields (moved to vw_member_pack_balances)
-- =========================================================================

ALTER TABLE member_sheets
    DROP COLUMN IF EXISTS packs_bought_count,
    DROP COLUMN IF EXISTS hours_done_in_pack,
    DROP COLUMN IF EXISTS remaining_hours_in_pack;

-- =========================================================================
-- C. ALTER flight_billing_settings — add deposit columns
-- =========================================================================

ALTER TABLE flight_billing_settings
    ADD COLUMN IF NOT EXISTS deposit_journal_uuid UUID NULL
        REFERENCES accounting_journals(uuid),
    ADD COLUMN IF NOT EXISTS deposit_bank_account_uuid UUID NULL
        REFERENCES accounting_accounts(uuid),
    ADD COLUMN IF NOT EXISTS deposit_receivable_account_uuid UUID NULL
        REFERENCES accounting_accounts(uuid);

COMMENT ON COLUMN flight_billing_settings.deposit_journal_uuid
    IS 'Journal for member deposits (e.g. BQ or CAISSE)';
COMMENT ON COLUMN flight_billing_settings.deposit_bank_account_uuid
    IS 'Bank/cash account debited on member deposit';
COMMENT ON COLUMN flight_billing_settings.deposit_receivable_account_uuid
    IS 'Member receivable account credited on deposit (e.g. 411)';

-- =========================================================================
-- Verify
-- =========================================================================

DO $$
BEGIN
    -- Check portal_password_hash exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'member_sheets' AND column_name = 'portal_password_hash'
    ) THEN
        RAISE EXCEPTION 'Migration 045 failed: member_sheets.portal_password_hash was not created';
    END IF;

    -- Check pack fields are gone
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'member_sheets' AND column_name = 'packs_bought_count'
    ) THEN
        RAISE EXCEPTION 'Migration 045 failed: member_sheets.packs_bought_count was not dropped';
    END IF;

    -- Check deposit columns exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'deposit_journal_uuid'
    ) THEN
        RAISE EXCEPTION 'Migration 045 failed: flight_billing_settings.deposit_journal_uuid was not created';
    END IF;
END $$;

COMMIT;
