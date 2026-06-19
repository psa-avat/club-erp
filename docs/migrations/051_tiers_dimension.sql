-- 051_tiers_dimension.sql
-- Add require_id to accounting_accounts (declares what entity a line on this account must reference).
-- Replace member_uuid + member_account_id_snapshot + analytical_asset_uuid on accounting_lines
-- and accounting_entry_template_lines with a single generic tiers_uuid column.
--
-- require_id values: 0=none, 1=member, 2=asset, 3=supplier (category-8 member)
-- tiers_uuid semantics are determined by account.require_id at read time.

BEGIN;

-- ---------------------------------------------------------------
-- 1. Add require_id to accounting_accounts
-- ---------------------------------------------------------------

ALTER TABLE accounting_accounts
    ADD COLUMN require_id SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE accounting_accounts
    ADD CONSTRAINT chk_account_require_id CHECK (require_id IN (0, 1, 2, 3));

-- Backfill known accounts (codes may not yet be seeded in all envs — safe no-op if absent)
UPDATE accounting_accounts SET require_id = 1 WHERE code = '411';   -- member receivables
UPDATE accounting_accounts SET require_id = 3 WHERE code = '401';   -- supplier payables
UPDATE accounting_accounts SET require_id = 2 WHERE code IN ('7062', '7063', '7064'); -- flight revenues

-- ---------------------------------------------------------------
-- 2. Replace three columns on accounting_lines with tiers_uuid
--    (parent ALTER cascades to all partitions: _default, _fy2025, _fy2026)
-- ---------------------------------------------------------------

-- Drop dependent views first (recreated in section 3)
DROP VIEW IF EXISTS vw_member_pack_balances;

ALTER TABLE accounting_lines
    ADD COLUMN tiers_uuid UUID NULL;

-- Backfill: the two old columns are mutually exclusive per line
UPDATE accounting_lines
    SET tiers_uuid = COALESCE(member_uuid, analytical_asset_uuid);

-- Drop parent indexes first (cascades to all partition indexes automatically)
DROP INDEX IF EXISTS ix_lines_member;
DROP INDEX IF EXISTS ix_lines_asset;

-- Then clean up any orphaned partition indexes (safe no-ops if already dropped via cascade)
DROP INDEX IF EXISTS accounting_lines_default_member_uuid_idx;
DROP INDEX IF EXISTS accounting_lines_default_analytical_asset_uuid_idx;
DROP INDEX IF EXISTS accounting_lines_fy2025_member_uuid_idx;
DROP INDEX IF EXISTS accounting_lines_fy2025_analytical_asset_uuid_idx;
DROP INDEX IF EXISTS accounting_lines_fy2026_member_uuid_idx;
DROP INDEX IF EXISTS accounting_lines_fy2026_analytical_asset_uuid_idx;

ALTER TABLE accounting_lines
    DROP COLUMN member_uuid,
    DROP COLUMN member_account_id_snapshot,
    DROP COLUMN analytical_asset_uuid;

CREATE INDEX ix_lines_tiers ON accounting_lines(tiers_uuid) WHERE tiers_uuid IS NOT NULL;

-- ---------------------------------------------------------------
-- 3. Recreate vw_member_pack_balances using tiers_uuid
--    (previously grouped by al.member_uuid)
-- ---------------------------------------------------------------

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
    SELECT member_uuid,
           pack_type,
           SUM(quantity_consumed) AS total_consumed_units
      FROM member_pack_consumptions
     GROUP BY member_uuid, pack_type
)
SELECT p.member_uuid,
       p.pack_type,
       COALESCE(p.total_purchased_units, 0) AS total_purchased,
       COALESCE(c.total_consumed_units, 0)  AS total_consumed,
       COALESCE(p.total_purchased_units, 0) - COALESCE(c.total_consumed_units, 0) AS units_remaining
  FROM pack_purchases p
  LEFT JOIN pack_consumptions c ON p.member_uuid = c.member_uuid
                                AND p.pack_type = c.pack_type;

COMMENT ON VIEW vw_member_pack_balances IS
    'Live pack balance: GL purchases (validated entries) minus consumptions per member per pack type';

-- ---------------------------------------------------------------
-- 4. Same column consolidation on accounting_entry_template_lines
-- ---------------------------------------------------------------

ALTER TABLE accounting_entry_template_lines
    ADD COLUMN tiers_uuid UUID NULL;

UPDATE accounting_entry_template_lines
    SET tiers_uuid = COALESCE(member_uuid, analytical_asset_uuid);

ALTER TABLE accounting_entry_template_lines
    DROP COLUMN member_uuid,
    DROP COLUMN analytical_asset_uuid;

COMMIT;
