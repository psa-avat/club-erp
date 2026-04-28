-- ERP-CLUB - ERP pour Club de vol a voile
-- Logiciel libre de gestion d'un club de vol a voile
-- upgrade_2026_04_28_full_schema.sql: Upgrade auth-only schema to full backend schema
-- Copyright (C) 2026 SAFORCADA Patrick
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program. If not, see <https://www.gnu.org/licenses/>.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Compatibility fixes on existing auth schema
-- ---------------------------------------------------------------------------

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS can_change_password BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- Generic settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS system_settings (
    id BIGSERIAL PRIMARY KEY,
    module_name VARCHAR(64) NOT NULL UNIQUE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_system_settings_module_name ON system_settings(module_name);

-- ---------------------------------------------------------------------------
-- Members module
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS member_account_counters (
    year SMALLINT PRIMARY KEY,
    next_value INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS members (
    uuid UUID PRIMARY KEY,
    genre SMALLINT NOT NULL DEFAULT 0,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(50) NULL,
    member_category SMALLINT NOT NULL,
    seniority SMALLINT NULL,
    ffvp_id BIGINT NULL,
    account_id VARCHAR(32) NOT NULL,
    photo_url TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    status SMALLINT NOT NULL DEFAULT 1,
    registration_status SMALLINT NOT NULL DEFAULT 1,
    is_instructor BOOLEAN NOT NULL DEFAULT FALSE,
    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    is_executive BOOLEAN NOT NULL DEFAULT FALSE,
    is_board_member BOOLEAN NOT NULL DEFAULT FALSE,
    can_fly BOOLEAN NOT NULL DEFAULT FALSE,
    external_auth_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_registration_year SMALLINT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT chk_members_genre CHECK (genre BETWEEN 0 AND 3),
    CONSTRAINT chk_members_category CHECK (member_category BETWEEN 1 AND 6),
    CONSTRAINT chk_members_status CHECK (status BETWEEN 1 AND 4),
    CONSTRAINT chk_members_registration_status CHECK (registration_status BETWEEN 1 AND 4),
    CONSTRAINT chk_members_seniority CHECK (seniority IS NULL OR seniority >= 0),
    CONSTRAINT chk_members_last_registration_year CHECK (last_registration_year IS NULL OR last_registration_year BETWEEN 2000 AND 9999),
    CONSTRAINT chk_members_role_employee_executive CHECK (NOT (is_employee AND is_executive)),
    CONSTRAINT chk_members_role_employee_board CHECK (NOT (is_employee AND is_board_member))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_email_not_null ON members(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_ffvp_id_not_null ON members(ffvp_id) WHERE ffvp_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_account_id ON members(account_id);
CREATE INDEX IF NOT EXISTS idx_members_member_category ON members(member_category);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_members_registration_status ON members(registration_status);
CREATE INDEX IF NOT EXISTS idx_members_can_fly ON members(can_fly);
CREATE INDEX IF NOT EXISTS idx_members_last_registration_year ON members(last_registration_year);

CREATE TABLE IF NOT EXISTS committees (
    uuid UUID PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    budget_amount NUMERIC(12,2) NULL,
    manager_member_uuid UUID NULL REFERENCES members(uuid) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT chk_committees_budget_amount CHECK (budget_amount IS NULL OR budget_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_committees_manager_member_uuid ON committees(manager_member_uuid);

CREATE TABLE IF NOT EXISTS committee_members (
    committee_uuid UUID NOT NULL REFERENCES committees(uuid) ON DELETE CASCADE,
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    membership_year SMALLINT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT pk_committee_members PRIMARY KEY (committee_uuid, member_uuid, membership_year),
    CONSTRAINT chk_committee_members_membership_year CHECK (membership_year BETWEEN 2000 AND 9999)
);

CREATE INDEX IF NOT EXISTS idx_committee_members_member_year ON committee_members(member_uuid, membership_year);
CREATE INDEX IF NOT EXISTS idx_committee_members_committee_year ON committee_members(committee_uuid, membership_year);

CREATE TABLE IF NOT EXISTS member_sheets (
    uuid UUID PRIMARY KEY,
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    year SMALLINT NOT NULL,
    licence_number VARCHAR(100) NULL,
    fare_type SMALLINT NOT NULL,
    hours_count NUMERIC(8,2) NOT NULL DEFAULT 0,
    packs_bought_count INTEGER NOT NULL DEFAULT 0,
    hours_done_in_pack NUMERIC(8,2) NOT NULL DEFAULT 0,
    remaining_hours_in_pack NUMERIC(8,2) NOT NULL DEFAULT 0,
    expense_access_token_hash VARCHAR(255) NULL,
    expense_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT uq_member_sheets_member_year UNIQUE (member_uuid, year),
    CONSTRAINT chk_member_sheets_year CHECK (year BETWEEN 2000 AND 9999),
    CONSTRAINT chk_member_sheets_fare_type CHECK (fare_type BETWEEN 1 AND 5),
    CONSTRAINT chk_member_sheets_hours_count CHECK (hours_count >= 0),
    CONSTRAINT chk_member_sheets_packs_bought_count CHECK (packs_bought_count >= 0),
    CONSTRAINT chk_member_sheets_hours_done_in_pack CHECK (hours_done_in_pack >= 0),
    CONSTRAINT chk_member_sheets_remaining_hours_in_pack CHECK (remaining_hours_in_pack >= 0)
);

CREATE INDEX IF NOT EXISTS idx_member_sheets_member_uuid ON member_sheets(member_uuid);
CREATE INDEX IF NOT EXISTS idx_member_sheets_year ON member_sheets(year);

-- ---------------------------------------------------------------------------
-- Accounting module
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounting_fiscal_years (
    uuid UUID PRIMARY KEY,
    code VARCHAR(16) NOT NULL UNIQUE,
    label VARCHAR(64) NOT NULL,
    year SMALLINT NOT NULL UNIQUE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    state SMALLINT NOT NULL DEFAULT 1,
    closed_at TIMESTAMPTZ NULL,
    closed_by INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_fy_dates CHECK (end_date > start_date),
    CONSTRAINT chk_fy_state CHECK (state IN (1, 2, 3))
);

CREATE TABLE IF NOT EXISTS accounting_accounts (
    uuid UUID PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    type SMALLINT NOT NULL,
    parent_account_uuid UUID NULL REFERENCES accounting_accounts(uuid),
    is_posting_allowed BOOLEAN NOT NULL DEFAULT TRUE,
    normal_balance SMALLINT NOT NULL,
    is_reconcilable BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ NULL,
    replacement_account_uuid UUID NULL REFERENCES accounting_accounts(uuid),

    CONSTRAINT chk_account_type CHECK (type IN (1, 2, 3, 4, 5)),
    CONSTRAINT chk_account_normal_balance CHECK (normal_balance IN (1, 2))
);

CREATE TABLE IF NOT EXISTS accounting_journals (
    uuid UUID PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    type SMALLINT NOT NULL,
    default_account_uuid UUID NULL REFERENCES accounting_accounts(uuid),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_journal_type CHECK (type IN (1, 2, 3, 4, 5, 6))
);

CREATE TABLE IF NOT EXISTS accounting_entries (
    uuid UUID NOT NULL,
    fiscal_year_uuid UUID NOT NULL REFERENCES accounting_fiscal_years(uuid),
    journal_uuid UUID NOT NULL REFERENCES accounting_journals(uuid),
    entry_date DATE NOT NULL,
    sequence_number VARCHAR(64) NULL,
    reference VARCHAR(255) NULL,
    source_document_ref VARCHAR(255) NULL,
    source_document_date DATE NULL,
    description VARCHAR(255) NOT NULL,
    state SMALLINT NOT NULL DEFAULT 1,
    source_system VARCHAR(64) NULL,
    external_id VARCHAR(255) NULL,
    import_batch_id VARCHAR(64) NULL,
    original_created_at TIMESTAMPTZ NULL,
    original_posted_at TIMESTAMPTZ NULL,
    reversal_of_entry_uuid UUID NULL,
    reversal_reason VARCHAR(255) NULL,
    entry_hash VARCHAR(64) NULL,
    posted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER NOT NULL REFERENCES users(id),

    CONSTRAINT pk_accounting_entries PRIMARY KEY (uuid, fiscal_year_uuid),
    CONSTRAINT chk_entry_state CHECK (state IN (1, 2, 3)),
    CONSTRAINT uix_entry_sequence UNIQUE (fiscal_year_uuid, sequence_number)
);

CREATE INDEX IF NOT EXISTS ix_entries_import_batch ON accounting_entries(import_batch_id);
CREATE INDEX IF NOT EXISTS ix_entries_external_id ON accounting_entries(source_system, external_id);

CREATE TABLE IF NOT EXISTS accounting_lines (
    uuid UUID NOT NULL,
    fiscal_year_uuid UUID NOT NULL REFERENCES accounting_fiscal_years(uuid),
    entry_uuid UUID NOT NULL,
    account_uuid UUID NOT NULL REFERENCES accounting_accounts(uuid),
    member_uuid UUID NULL,
    member_account_id_snapshot VARCHAR(32) NULL,
    analytical_asset_uuid UUID NULL,
    debit NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
    credit NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
    description VARCHAR(255) NULL,
    tax_id UUID NULL,
    tax_code VARCHAR(64) NULL,
    tax_rate NUMERIC(10,4) NULL,
    tax_base NUMERIC(10,4) NULL,
    tax_amount NUMERIC(10,4) NULL,

    CONSTRAINT pk_accounting_lines PRIMARY KEY (uuid, fiscal_year_uuid),
    CONSTRAINT fk_lines_entry FOREIGN KEY (entry_uuid, fiscal_year_uuid)
        REFERENCES accounting_entries(uuid, fiscal_year_uuid)
        ON DELETE CASCADE,
    CONSTRAINT chk_line_amounts_positive CHECK (debit >= 0 AND credit >= 0),
    CONSTRAINT chk_line_at_least_one_amount CHECK (debit > 0 OR credit > 0)
);

CREATE INDEX IF NOT EXISTS ix_lines_entry ON accounting_lines(entry_uuid);
CREATE INDEX IF NOT EXISTS ix_lines_fiscal_year ON accounting_lines(fiscal_year_uuid);
CREATE INDEX IF NOT EXISTS ix_lines_account ON accounting_lines(account_uuid);
CREATE INDEX IF NOT EXISTS ix_lines_member ON accounting_lines(member_uuid);
CREATE INDEX IF NOT EXISTS ix_lines_asset ON accounting_lines(analytical_asset_uuid);

CREATE TABLE IF NOT EXISTS accounting_entry_templates (
    uuid UUID PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    journal_uuid UUID NOT NULL REFERENCES accounting_journals(uuid),
    description VARCHAR(255) NULL,
    default_reference VARCHAR(255) NULL,
    recurrence_type SMALLINT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER NOT NULL REFERENCES users(id),

    CONSTRAINT chk_entry_template_recurrence_type CHECK (recurrence_type IN (1, 2, 3, 4))
);

CREATE TABLE IF NOT EXISTS accounting_entry_template_lines (
    uuid UUID PRIMARY KEY,
    template_uuid UUID NOT NULL REFERENCES accounting_entry_templates(uuid) ON DELETE CASCADE,
    account_uuid UUID NOT NULL REFERENCES accounting_accounts(uuid),
    sort_order SMALLINT NOT NULL DEFAULT 1,
    member_uuid UUID NULL,
    analytical_asset_uuid UUID NULL,
    debit NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
    credit NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
    description VARCHAR(255) NULL,

    CONSTRAINT chk_entry_template_line_amounts_positive CHECK (debit >= 0 AND credit >= 0),
    CONSTRAINT chk_entry_template_line_at_least_one_amount CHECK (debit > 0 OR credit > 0)
);

CREATE INDEX IF NOT EXISTS ix_entry_tpl_lines_template_uuid ON accounting_entry_template_lines(template_uuid);
CREATE INDEX IF NOT EXISTS ix_entry_tpl_lines_account_uuid ON accounting_entry_template_lines(account_uuid);

-- ---------------------------------------------------------------------------
-- Assets and pricing
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_types (
    uuid UUID PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    category SMALLINT NOT NULL DEFAULT 1,
    pricing_strategy SMALLINT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_asset_types_category CHECK (category IN (1, 2, 3, 4, 5)),
    CONSTRAINT chk_asset_types_pricing_strategy CHECK (pricing_strategy IN (1, 2, 3, 4, 5, 6))
);

CREATE TABLE IF NOT EXISTS asset_flight_types (
    uuid UUID PRIMARY KEY,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_asset_flight_types_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS assets (
    uuid UUID PRIMARY KEY,
    asset_type_uuid UUID NOT NULL REFERENCES asset_types(uuid),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    registration VARCHAR(32) NULL UNIQUE,
    serial_number VARCHAR(100) NULL,
    manufacturer VARCHAR(100) NULL,
    model VARCHAR(100) NULL,
    year_of_manufacture SMALLINT NULL,
    ownership SMALLINT NOT NULL DEFAULT 1,
    owner_member_uuid UUID NULL REFERENCES members(uuid) ON DELETE SET NULL,
    status SMALLINT NOT NULL DEFAULT 1,
    acquisition_account_uuid UUID NULL REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    accounting_account_code_snapshot VARCHAR(32) NULL,
    purchase_date DATE NULL,
    purchase_price NUMERIC(10,4) NULL,
    depreciation_start_date DATE NULL,
    depreciation_years SMALLINT NULL,
    residual_value NUMERIC(10,4) NULL,
    useful_life_years SMALLINT NULL,
    notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT chk_asset_status CHECK (status IN (1, 2, 3, 4)),
    CONSTRAINT chk_asset_ownership CHECK (ownership IN (1, 2)),
    CONSTRAINT chk_asset_private_owner_required CHECK (ownership <> 2 OR owner_member_uuid IS NOT NULL),
    CONSTRAINT chk_assets_price_positive CHECK (purchase_price IS NULL OR purchase_price >= 0),
    CONSTRAINT chk_assets_residual_positive CHECK (residual_value IS NULL OR residual_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_assets_asset_type_uuid ON assets(asset_type_uuid);
CREATE INDEX IF NOT EXISTS idx_assets_owner_member_uuid ON assets(owner_member_uuid);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_acquisition_account_uuid ON assets(acquisition_account_uuid);

CREATE TABLE IF NOT EXISTS asset_status_history (
    uuid UUID PRIMARY KEY,
    asset_uuid UUID NOT NULL REFERENCES assets(uuid) ON DELETE CASCADE,
    status SMALLINT NOT NULL,
    reason VARCHAR(255) NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT chk_asset_sh_status CHECK (status IN (1, 2, 3, 4))
);

CREATE INDEX IF NOT EXISTS idx_asset_status_history_asset_uuid ON asset_status_history(asset_uuid);
CREATE INDEX IF NOT EXISTS idx_asset_status_history_changed_at ON asset_status_history(changed_at);

CREATE TABLE IF NOT EXISTS pricing_versions (
    uuid UUID PRIMARY KEY,
    fiscal_year_uuid UUID NOT NULL REFERENCES accounting_fiscal_years(uuid),
    asset_type_uuid UUID NULL REFERENCES asset_types(uuid) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NULL,
    status SMALLINT NOT NULL DEFAULT 1,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    use_pack BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT chk_pricing_version_status CHECK (status IN (1, 2, 3)),
    CONSTRAINT chk_pricing_version_dates CHECK (to_date IS NULL OR to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS ix_pricing_versions_fiscal_year ON pricing_versions(fiscal_year_uuid);
CREATE INDEX IF NOT EXISTS ix_pricing_versions_asset_type ON pricing_versions(asset_type_uuid);
CREATE INDEX IF NOT EXISTS ix_pricing_versions_dates ON pricing_versions(fiscal_year_uuid, from_date, to_date);

CREATE TABLE IF NOT EXISTS pricing_items (
    uuid UUID PRIMARY KEY,
    pricing_version_uuid UUID NOT NULL REFERENCES pricing_versions(uuid) ON DELETE CASCADE,
    flight_type_uuid UUID NULL REFERENCES asset_flight_types(uuid) ON DELETE SET NULL,
    name VARCHAR(120) NOT NULL,
    unit SMALLINT NOT NULL,
    base_price NUMERIC(10,4) NOT NULL,
    pack_price NUMERIC(10,4) NULL,
    age_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    gl_account_credit_uuid UUID NULL REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_pricing_items_unit CHECK (unit IN (1, 2, 3, 4, 5, 6)),
    CONSTRAINT chk_pricing_items_base_price CHECK (base_price >= 0),
    CONSTRAINT chk_pricing_items_pack_price CHECK (pack_price IS NULL OR pack_price >= 0),
    CONSTRAINT chk_pricing_items_age_discount CHECK (age_discount_percent >= 0 AND age_discount_percent <= 100)
);

CREATE INDEX IF NOT EXISTS ix_pricing_items_pricing_version ON pricing_items(pricing_version_uuid);
CREATE INDEX IF NOT EXISTS ix_pricing_items_flight_type ON pricing_items(flight_type_uuid);
CREATE INDEX IF NOT EXISTS ix_pricing_items_gl_account_credit ON pricing_items(gl_account_credit_uuid);

CREATE TABLE IF NOT EXISTS pricing_item_tiers (
    uuid UUID PRIMARY KEY,
    pricing_item_uuid UUID NOT NULL REFERENCES pricing_items(uuid) ON DELETE CASCADE,
    from_qty NUMERIC(10,4) NOT NULL,
    price NUMERIC(10,4) NOT NULL,
    pack_price NUMERIC(10,4) NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT chk_pricing_item_tiers_from_qty CHECK (from_qty > 0),
    CONSTRAINT chk_pricing_item_tiers_price CHECK (price >= 0),
    CONSTRAINT chk_pricing_item_tiers_pack_price CHECK (pack_price IS NULL OR pack_price >= 0)
);

CREATE INDEX IF NOT EXISTS ix_pricing_item_tiers_pricing_item ON pricing_item_tiers(pricing_item_uuid);
CREATE INDEX IF NOT EXISTS ix_pricing_item_tiers_sort_order ON pricing_item_tiers(pricing_item_uuid, sort_order);

CREATE TABLE IF NOT EXISTS cost_provision_rules (
    uuid UUID PRIMARY KEY,
    asset_type_uuid UUID NOT NULL REFERENCES asset_types(uuid) ON DELETE CASCADE,
    fiscal_year_uuid UUID NOT NULL REFERENCES accounting_fiscal_years(uuid) ON DELETE CASCADE,
    metric_name VARCHAR(32) NOT NULL,
    cost_per_unit NUMERIC(10,4) NOT NULL,
    gl_account_debit_uuid UUID NOT NULL REFERENCES accounting_accounts(uuid) ON DELETE RESTRICT,
    gl_account_credit_uuid UUID NOT NULL REFERENCES accounting_accounts(uuid) ON DELETE RESTRICT,
    accrual_method SMALLINT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT chk_cost_rules_metric CHECK (metric_name IN ('engine_hours','winch_launches','flight_hours','landings')),
    CONSTRAINT chk_cost_rules_cost_per_unit CHECK (cost_per_unit > 0),
    CONSTRAINT chk_cost_rules_accrual_method CHECK (accrual_method IN (1,2,3)),
    CONSTRAINT chk_cost_rules_distinct_gl CHECK (gl_account_debit_uuid <> gl_account_credit_uuid)
);

CREATE INDEX IF NOT EXISTS ix_cost_provision_rules_asset_type ON cost_provision_rules(asset_type_uuid);
CREATE INDEX IF NOT EXISTS ix_cost_provision_rules_fiscal_year ON cost_provision_rules(fiscal_year_uuid);

COMMIT;
