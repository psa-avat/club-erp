-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 036: Pack definitions, applicability, consumption tracking
--
-- Creates the pack management schema: catalog definitions (pack_definitions),
-- links to pricing items with discounted prices (pack_applicability),
-- operational consumption tracking (member_pack_consumptions),
-- and a balance view (vw_member_pack_balances).
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

-- -------------------------------------------------------------------------
-- 1. pack_definitions : catalog of reusable pack templates
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pack_definitions (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    fiscal_year_uuid UUID NOT NULL REFERENCES accounting_fiscal_years(uuid) ON DELETE CASCADE,
    pack_type VARCHAR(32) NOT NULL,
    quantity_allowance NUMERIC(10,2) NOT NULL,
    quantity_unit VARCHAR(32) NOT NULL DEFAULT 'hours',
    eligible_asset_type_uuid UUID NULL REFERENCES asset_types(uuid) ON DELETE SET NULL,
    pack_sales_account_uuid UUID NULL REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    pack_discount_expense_account_uuid UUID NULL REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pack_definitions_code ON pack_definitions(code);
CREATE INDEX IF NOT EXISTS ix_pack_definitions_fiscal_year ON pack_definitions(fiscal_year_uuid);
CREATE INDEX IF NOT EXISTS ix_pack_definitions_type ON pack_definitions(pack_type);

ALTER TABLE pack_definitions
    ADD CONSTRAINT chk_pack_definitions_type
    CHECK (pack_type IN ('flight_hours', 'winch_launches', 'tow_launches', 'engine_time'));

COMMENT ON TABLE pack_definitions IS 'Pack catalog template: defines type, quantity allowance, and accounts';
COMMENT ON COLUMN pack_definitions.pack_type IS 'flight_hours | winch_launches | tow_launches | engine_time';
COMMENT ON COLUMN pack_definitions.quantity_allowance IS 'Base quantity included in one pack purchase (e.g. 25.00 hours)';
COMMENT ON COLUMN pack_definitions.quantity_unit IS 'hours | launches | centihours';
COMMENT ON COLUMN pack_definitions.pack_sales_account_uuid IS 'Credit account for pack purchase revenue, normally class 7 (overrides default)';
COMMENT ON COLUMN pack_definitions.pack_discount_expense_account_uuid IS 'Debit account for REM pack discount expense, normally class 6 (overrides default)';

-- -------------------------------------------------------------------------
-- 2. pack_applicability : links a pack to a pricing_item with a discounted price
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pack_applicability (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_definition_uuid UUID NOT NULL REFERENCES pack_definitions(uuid) ON DELETE CASCADE,
    pricing_item_uuid UUID NOT NULL REFERENCES pricing_items(uuid) ON DELETE CASCADE,
    discounted_unit_price NUMERIC(10,4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pack_applicability_item
    ON pack_applicability(pack_definition_uuid, pricing_item_uuid);
CREATE INDEX IF NOT EXISTS ix_pack_applicability_pack
    ON pack_applicability(pack_definition_uuid);
CREATE INDEX IF NOT EXISTS ix_pack_applicability_item
    ON pack_applicability(pricing_item_uuid);

COMMENT ON TABLE pack_applicability IS 'Links a pack definition to a pricing item with a discounted unit price';
COMMENT ON COLUMN pack_applicability.discounted_unit_price IS 'Unit price when billed under this pack (e.g. 20.0000 instead of 100.0000)';

-- -------------------------------------------------------------------------
-- 3. member_pack_consumptions : operational discount tracking per flight line
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_pack_consumptions (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    flight_uuid UUID NOT NULL REFERENCES validated_flights(uuid) ON DELETE CASCADE,
    pack_type VARCHAR(32) NOT NULL,
    quantity_consumed NUMERIC(10,2) NOT NULL,
    discount_unit_price NUMERIC(10,2) NOT NULL,
    total_discount_amount NUMERIC(10,2) NOT NULL,
    accounting_entry_uuid UUID NULL,  -- Link to GL entry (app-level integrity, no FK)
    is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
    frozen_at TIMESTAMPTZ NULL,
    frozen_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_mpc_member_pack_type ON member_pack_consumptions(member_uuid, pack_type);
CREATE INDEX IF NOT EXISTS ix_mpc_flight ON member_pack_consumptions(flight_uuid);
CREATE INDEX IF NOT EXISTS ix_mpc_accounting_entry ON member_pack_consumptions(accounting_entry_uuid);

COMMENT ON TABLE member_pack_consumptions IS 'Operational discount tracking: one row per flight line consuming pack units';
COMMENT ON COLUMN member_pack_consumptions.pack_type IS 'flight_hours | winch_launches | tow_launches | engine_time';
COMMENT ON COLUMN member_pack_consumptions.discount_unit_price IS 'base_price − pack_price';
COMMENT ON COLUMN member_pack_consumptions.total_discount_amount IS 'quantity_consumed × discount_unit_price';
COMMENT ON COLUMN member_pack_consumptions.is_frozen IS 'If true, excluded from REM adjustment calculation';

-- -------------------------------------------------------------------------
-- 4. vw_member_pack_balances : live balance view crossing GL with consumptions
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_member_pack_balances AS
WITH pack_purchases AS (
    SELECT
        al.member_uuid,
        p_def.pack_type,
        SUM(p_def.quantity_allowance) AS total_purchased_units
    FROM accounting_lines al
    JOIN accounting_entries ae ON al.entry_uuid = ae.uuid
    JOIN pack_definitions p_def ON al.account_uuid = p_def.pack_sales_account_uuid
    WHERE ae.state = 2  -- posted
    GROUP BY al.member_uuid, p_def.pack_type
),
pack_consumptions AS (
    SELECT
        member_uuid,
        pack_type,
        SUM(quantity_consumed) AS total_consumed_units
    FROM member_pack_consumptions
    WHERE is_frozen = FALSE
    GROUP BY member_uuid, pack_type
)
SELECT
    p.member_uuid,
    p.pack_type,
    COALESCE(p.total_purchased_units, 0) AS total_purchased,
    COALESCE(c.total_consumed_units, 0) AS total_consumed,
    (COALESCE(p.total_purchased_units, 0) - COALESCE(c.total_consumed_units, 0)) AS units_remaining
FROM pack_purchases p
LEFT JOIN pack_consumptions c ON p.member_uuid = c.member_uuid AND p.pack_type = c.pack_type;

COMMENT ON VIEW vw_member_pack_balances IS 'Live pack balance: crosses GL pack purchases with member_pack_consumptions';

-- -------------------------------------------------------------------------
-- 5. Ensure REM / DISC journal exists in accounting_journals
-- -------------------------------------------------------------------------
INSERT INTO accounting_journals (uuid, code, name, type, is_active)
SELECT gen_random_uuid(), 'REM', 'Journal des remises', 5, TRUE
WHERE NOT EXISTS (SELECT 1 FROM accounting_journals WHERE code IN ('REM', 'DISC'));

-- -------------------------------------------------------------------------
-- 6. Add accounting_entry_uuid to validated_flights if not present
-- -------------------------------------------------------------------------
ALTER TABLE validated_flights
    ADD COLUMN IF NOT EXISTS accounting_entry_uuid UUID NULL,
    ADD COLUMN IF NOT EXISTS billing_quote_state VARCHAR(32) NULL;

CREATE INDEX IF NOT EXISTS ix_validated_flights_accounting_entry
    ON validated_flights(accounting_entry_uuid);

COMMENT ON COLUMN validated_flights.accounting_entry_uuid IS 'Link to the FL journal accounting entry (gross billing)';
COMMENT ON COLUMN validated_flights.billing_quote_state IS 'quoted | applied | superseded | corrected | NULL';

COMMIT;
