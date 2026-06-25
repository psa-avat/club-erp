-- Migration 055: rename member_pack_consumptions.member_uuid → tiers_uuid
-- Aligns the column name with the tiers_uuid convention used on accounting_lines.
-- The view vw_member_pack_balances is recreated to reference the renamed column;
-- its output column is kept as "member_uuid" to avoid changing service queries.

-- 1. Rename the physical column
ALTER TABLE member_pack_consumptions
    RENAME COLUMN member_uuid TO tiers_uuid;

-- 2. Rename indexes that embed the old column name
ALTER INDEX IF EXISTS idx_mpc_member_pack     RENAME TO idx_mpc_tiers_pack;
ALTER INDEX IF EXISTS ix_mpc_member_pack_type RENAME TO ix_mpc_tiers_pack_type;

-- 3. Recreate vw_member_pack_balances: update the pack_consumptions CTE
--    to read from the renamed column (tiers_uuid).
--    The output column "member_uuid" is preserved so service queries need no change.
DROP VIEW IF EXISTS vw_member_pack_balances;

CREATE VIEW vw_member_pack_balances AS
WITH pack_purchases AS (
    SELECT al.tiers_uuid AS member_uuid,
           p_def.pack_type,
           SUM(p_def.quantity_allowance) AS total_purchased_units
      FROM accounting_lines al
      JOIN accounting_entries ae ON al.entry_uuid = ae.uuid
      JOIN pack_definitions p_def ON al.account_uuid = p_def.pack_sales_account_uuid
     WHERE ae.state = 2
       AND al.tiers_uuid IS NOT NULL
     GROUP BY al.tiers_uuid, p_def.pack_type
),
pack_consumptions AS (
    SELECT tiers_uuid AS member_uuid,
           pack_type,
           SUM(quantity_consumed) AS total_consumed_units
      FROM member_pack_consumptions
     GROUP BY tiers_uuid, pack_type
)
SELECT p.member_uuid,
       p.pack_type,
       COALESCE(p.total_purchased_units, 0) AS total_purchased,
       COALESCE(c.total_consumed_units,  0) AS total_consumed,
       COALESCE(p.total_purchased_units, 0) - COALESCE(c.total_consumed_units, 0) AS units_remaining
  FROM pack_purchases p
  LEFT JOIN pack_consumptions c ON p.member_uuid = c.member_uuid
                                AND p.pack_type = c.pack_type;

COMMENT ON VIEW vw_member_pack_balances IS
    'Live pack balance: GL purchases (validated entries) minus consumptions per member per pack type';
