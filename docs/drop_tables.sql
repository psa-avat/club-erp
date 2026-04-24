BEGIN;

-- MEMBERS (data + helper tables)
DROP TABLE IF EXISTS member_sheets CASCADE;
DROP TABLE IF EXISTS committee_members CASCADE;
DROP TABLE IF EXISTS committees CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS member_account_counters CASCADE;

-- ASSETS
DROP TABLE IF EXISTS asset_stock_entries CASCADE;
DROP TABLE IF EXISTS asset_stock_items CASCADE;
DROP TABLE IF EXISTS asset_products CASCADE;
DROP TABLE IF EXISTS cost_accrual_staging CASCADE;
DROP TABLE IF EXISTS cost_provision_rules CASCADE;
DROP TABLE IF EXISTS asset_depreciation_schedules CASCADE;
DROP TABLE IF EXISTS asset_account_snapshots CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS asset_flight_types CASCADE;
DROP TABLE IF EXISTS asset_types CASCADE;

-- ACCOUNTING
DROP TABLE IF EXISTS accounting_lines_default CASCADE;
DROP TABLE IF EXISTS accounting_entries_default CASCADE;
DROP TABLE IF EXISTS accounting_lines CASCADE;
DROP TABLE IF EXISTS accounting_entries CASCADE;
DROP TABLE IF EXISTS pricing_items CASCADE;
DROP TABLE IF EXISTS pricing_versions CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS accounting_journals CASCADE;
DROP TABLE IF EXISTS accounting_accounts CASCADE;
DROP TABLE IF EXISTS accounting_fiscal_years CASCADE;

-- Optional: if these helper functions already exist from members schema
DROP FUNCTION IF EXISTS generate_member_account_id() CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

COMMIT;