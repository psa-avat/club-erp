-- =============================================================================
-- Migration 042: Add club_charge_account_uuid to flight_billing_settings
--
-- Distinguishes between:
--   - default_initiation_charge_account_uuid: for initiation flights (type=2)
--   - club_charge_account_uuid: for flights explicitly billed to the club
--     (charge_to_erp_id matches the club member's account_id)
-- =============================================================================
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'club_charge_account_uuid'
    ) THEN
        ALTER TABLE flight_billing_settings
            ADD COLUMN club_charge_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL;

        COMMENT ON COLUMN flight_billing_settings.club_charge_account_uuid IS
          'Charge account for flights explicitly billed to the club (charge_to_erp_id matches club member)';
    END IF;
END $$;

COMMIT;
