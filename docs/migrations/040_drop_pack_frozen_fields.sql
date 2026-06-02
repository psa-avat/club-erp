-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 040: Drop frozen fields from member_pack_consumptions + update view
--
-- The freeze/exclude mechanism is removed — all consumptions contribute
-- to the REM adjustment. The is_frozen/frozen_at/frozen_reason columns
-- are dropped, and vw_member_pack_balances no longer filters by is_frozen.
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

-- First recreate the view without the is_frozen filter (view depends on the column)
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

COMMIT;

BEGIN;
-- Now drop the columns (view no longer depends on is_frozen)
ALTER TABLE member_pack_consumptions
    DROP COLUMN IF EXISTS is_frozen,
    DROP COLUMN IF EXISTS frozen_at,
    DROP COLUMN IF EXISTS frozen_reason;

COMMIT;
