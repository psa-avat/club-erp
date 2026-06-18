-- Migration 050: Decouple pricing versions and pack definitions from fiscal years
--
-- pricing_versions: validity is already defined by from_date / to_date.
--   fiscal_year_uuid becomes optional (nullable).
--
-- pack_definitions: packs are a permanent catalog; no fiscal year scoping needed.
--   fiscal_year_uuid column is dropped entirely.
--
-- vw_member_pack_balances references pd.fiscal_year_uuid in its JOIN (added in
-- migration 041). Recreate the view without that condition before dropping the
-- column. The correct join is by pack_sales_account_uuid alone.

-- 1. pricing_versions: make fiscal_year_uuid nullable
ALTER TABLE pricing_versions ALTER COLUMN fiscal_year_uuid DROP NOT NULL;

-- 2. Recreate vw_member_pack_balances without the fiscal_year_uuid join condition
CREATE OR REPLACE VIEW vw_member_pack_balances AS
WITH pack_purchases AS (
    SELECT
        al.member_uuid,
        p_def.pack_type,
        SUM(p_def.quantity_allowance) AS total_purchased_units
    FROM accounting_lines al
    JOIN accounting_entries ae ON al.entry_uuid = ae.uuid
    JOIN pack_definitions p_def ON al.account_uuid = p_def.pack_sales_account_uuid
    WHERE ae.state = 2
      AND al.member_uuid IS NOT NULL
    GROUP BY al.member_uuid, p_def.pack_type
),
pack_consumptions AS (
    SELECT
        member_uuid,
        pack_type,
        SUM(quantity_consumed) AS total_consumed_units
    FROM member_pack_consumptions
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

COMMENT ON VIEW vw_member_pack_balances IS 'Live pack balance: GL purchases (validated entries) minus consumptions per member per pack type';

-- 3. pack_definitions: drop fiscal_year_uuid (view no longer depends on it)
ALTER TABLE pack_definitions DROP COLUMN fiscal_year_uuid;
