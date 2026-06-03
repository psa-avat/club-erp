-- =============================================================================
-- Migration 041: Flight Billing — Packs, Settings & Accounting Integration
--
-- Implements Phase 1 of flight billing finalization:
--   A. ALTER pack_definitions      — add missing columns (eligible_asset, flights_journal, updated_at)
--   B. pack_applicability          — already exists, no changes needed
--   C. CREATE member_pack_consumptions — operational discount tracking per flight
--   D. CREATE vw_member_pack_balances  — live pack balance view
--   E. ALTER validated_flights     — add billing_quote_state (accounting_entry_uuid already exists)
--   F. Seed REM journal            — ensure REM/DISC journal exists
--   G. CREATE flight_billing_settings — typed config table (journal–account pairs per FY)
-- =============================================================================

BEGIN;

-- =========================================================================
-- A. ALTER pack_definitions — add columns that may be missing
-- =========================================================================

-- eligible_asset_type_uuid (restricts pack to specific asset types)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pack_definitions' AND column_name = 'eligible_asset_type_uuid'
    ) THEN
        ALTER TABLE pack_definitions
            ADD COLUMN eligible_asset_type_uuid UUID REFERENCES asset_types(uuid) ON DELETE SET NULL;
    END IF;
END $$;

-- flights_journal_uuid (per-pack override of FL journal)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pack_definitions' AND column_name = 'flights_journal_uuid'
    ) THEN
        ALTER TABLE pack_definitions
            ADD COLUMN flights_journal_uuid UUID REFERENCES accounting_journals(uuid) ON DELETE SET NULL;
    END IF;
END $$;

-- updated_at (for row-level concurrency tracking)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pack_definitions' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE pack_definitions
            ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
END $$;

-- Rename rem_discount_account_uuid → pack_discount_expense_account_uuid if needed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pack_definitions' AND column_name = 'rem_discount_account_uuid'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pack_definitions' AND column_name = 'pack_discount_expense_account_uuid'
    ) THEN
        ALTER TABLE pack_definitions
            RENAME COLUMN rem_discount_account_uuid TO pack_discount_expense_account_uuid;
    END IF;
END $$;

-- Add pack_type CHECK constraint if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints cc
        JOIN information_schema.constraint_column_usage ccu ON cc.constraint_name = ccu.constraint_name
        WHERE ccu.table_name = 'pack_definitions' AND cc.check_clause LIKE '%pack_type%'
    ) THEN
        ALTER TABLE pack_definitions
            ADD CONSTRAINT chk_pack_definitions_type CHECK (pack_type IN ('flight_hours','winch_launches','tow_launches','engine_time'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pack_definitions_pack_type ON pack_definitions(pack_type);

-- =========================================================================
-- B. pack_applicability — already exists with correct columns, skip
-- =========================================================================
-- No changes needed.

-- =========================================================================
-- C. ALTER member_pack_consumptions — add / remove columns as needed
--    Table already exists. Only adjust columns that differ.
-- =========================================================================

-- Add valid_from if missing (used to check pack eligibility date)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'member_pack_consumptions' AND column_name = 'valid_from'
    ) THEN
        ALTER TABLE member_pack_consumptions
            ADD COLUMN valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
END $$;

-- Add quantity_consumed if missing (legacy schema may have different name)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'member_pack_consumptions' AND column_name = 'quantity_consumed'
    ) THEN
        ALTER TABLE member_pack_consumptions
            ADD COLUMN quantity_consumed NUMERIC(10,2) NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Drop frozen columns if they still exist (removed from model)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'member_pack_consumptions' AND column_name = 'is_frozen'
    ) THEN
        ALTER TABLE member_pack_consumptions DROP COLUMN is_frozen;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'member_pack_consumptions' AND column_name = 'frozen_at'
    ) THEN
        ALTER TABLE member_pack_consumptions DROP COLUMN frozen_at;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'member_pack_consumptions' AND column_name = 'frozen_reason'
    ) THEN
        ALTER TABLE member_pack_consumptions DROP COLUMN frozen_reason;
    END IF;
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_mpc_member_pack ON member_pack_consumptions(member_uuid, pack_type);
CREATE INDEX IF NOT EXISTS idx_mpc_flight ON member_pack_consumptions(flight_uuid);
CREATE INDEX IF NOT EXISTS idx_mpc_accounting_entry ON member_pack_consumptions(accounting_entry_uuid);

-- =========================================================================
-- D. CREATE vw_member_pack_balances — live pack balance view
--
-- Crosses GL pack purchases (accounting_lines × pack_definitions.pack_sales_account_uuid)
-- with member_pack_consumptions to compute remaining units per pack type.
-- =========================================================================
CREATE OR REPLACE VIEW vw_member_pack_balances AS
WITH pack_purchases AS (
    SELECT
        al.member_uuid,
        pd.pack_type,
        SUM(al.credit) AS total_purchased
    FROM accounting_lines al
    JOIN pack_definitions pd ON al.account_uuid = pd.pack_sales_account_uuid
        AND pd.fiscal_year_uuid = al.fiscal_year_uuid
    WHERE al.credit > 0
      AND al.member_uuid IS NOT NULL
    GROUP BY al.member_uuid, pd.pack_type
),
pack_consumptions AS (
    SELECT
        mpc.member_uuid,
        mpc.pack_type,
        SUM(mpc.quantity_consumed) AS total_consumed
    FROM member_pack_consumptions mpc
    GROUP BY mpc.member_uuid, mpc.pack_type
)
SELECT
    COALESCE(pp.member_uuid, pc.member_uuid) AS member_uuid,
    COALESCE(pp.pack_type, pc.pack_type) AS pack_type,
    COALESCE(pp.total_purchased, 0) AS total_purchased,
    COALESCE(pc.total_consumed, 0) AS total_consumed,
    GREATEST(COALESCE(pp.total_purchased, 0) - COALESCE(pc.total_consumed, 0), 0) AS units_remaining
FROM pack_purchases pp
FULL OUTER JOIN pack_consumptions pc
    ON pp.member_uuid = pc.member_uuid AND pp.pack_type = pc.pack_type;

-- =========================================================================
-- E. ALTER validated_flights — add billing_quote_state
--    (accounting_entry_uuid already exists in the model)
-- =========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'validated_flights' AND column_name = 'billing_quote_state'
    ) THEN
        ALTER TABLE validated_flights
            ADD COLUMN billing_quote_state VARCHAR(16) DEFAULT 'pending'
                CHECK (billing_quote_state IN ('pending', 'applied', 'posted'));
    END IF;
END $$;

-- Ensure index on accounting_entry_uuid exists
CREATE INDEX IF NOT EXISTS idx_vf_accounting_entry ON validated_flights(accounting_entry_uuid);

-- =========================================================================
-- F. Seed REM journal — ensure REM/DISC journal exists
-- =========================================================================
DO $$
DECLARE
    rem_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO rem_count FROM accounting_journals WHERE code IN ('REM', 'DISC');
    IF rem_count = 0 THEN
        INSERT INTO accounting_journals (uuid, code, name, type, is_active)
        VALUES (gen_random_uuid(), 'REM', 'Remises forfaits', 3, TRUE);
    END IF;
END $$;

-- =========================================================================
-- G. ALTER flight_billing_settings — add columns that may be missing
--    Table already exists. Only add/alter columns that differ.
-- =========================================================================

-- default_initiation_charge_account_uuid (club billing fallback)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'default_initiation_charge_account_uuid'
    ) THEN
        ALTER TABLE flight_billing_settings
            ADD COLUMN default_initiation_charge_account_uuid UUID REFERENCES accounting_accounts(uuid);
    END IF;
END $$;

-- club_member_uuid (the member record representing the club for club-billed flights)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'club_member_uuid'
    ) THEN
        ALTER TABLE flight_billing_settings
            ADD COLUMN club_member_uuid UUID REFERENCES members(uuid) ON DELETE SET NULL;
    END IF;
END $$;

-- rem_period_days (may be missing in legacy schema)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'rem_period_days'
    ) THEN
        ALTER TABLE flight_billing_settings
            ADD COLUMN rem_period_days INTEGER NOT NULL DEFAULT 30;
    END IF;
END $$;

-- allow_post_purchase_recalculation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'allow_post_purchase_recalculation'
    ) THEN
        ALTER TABLE flight_billing_settings
            ADD COLUMN allow_post_purchase_recalculation BOOLEAN NOT NULL DEFAULT TRUE;
    END IF;
END $$;

-- max_days_for_post_purchase_discount
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'max_days_for_post_purchase_discount'
    ) THEN
        ALTER TABLE flight_billing_settings
            ADD COLUMN max_days_for_post_purchase_discount INTEGER DEFAULT 30;
    END IF;
END $$;

-- require_approval_for_late_discount
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'require_approval_for_late_discount'
    ) THEN
        ALTER TABLE flight_billing_settings
            ADD COLUMN require_approval_for_late_discount BOOLEAN NOT NULL DEFAULT TRUE;
    END IF;
END $$;

-- updated_by (may be missing in legacy schema)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'flight_billing_settings' AND column_name = 'updated_by'
    ) THEN
        ALTER TABLE flight_billing_settings
            ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fbs_fiscal_year ON flight_billing_settings(fiscal_year_uuid);

-- =========================================================================
-- H. Add charge_account_uuid to vi_type_catalog
-- =========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vi_type_catalog' AND column_name = 'charge_account_uuid'
    ) THEN
        ALTER TABLE vi_type_catalog
            ADD COLUMN charge_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL;
    END IF;
END $$;

-- =========================================================================
-- I. Add charge_comment to validated_flights
-- =========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'validated_flights' AND column_name = 'charge_comment'
    ) THEN
        ALTER TABLE validated_flights
            ADD COLUMN charge_comment TEXT;
    END IF;
END $$;

-- =========================================================================
-- Comments
-- =========================================================================
COMMENT ON TABLE member_pack_consumptions IS 'Operational tracking of pack units consumed per flight per member';
COMMENT ON VIEW vw_member_pack_balances IS 'Live pack balance: GL purchases minus consumptions per member per pack type';
COMMENT ON TABLE flight_billing_settings IS 'Typed flight billing configuration per fiscal year — journals paired with accounts';

COMMIT;
