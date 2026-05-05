-- =========================
-- MEMBERS MODULE SCHEMA
-- PostgreSQL 18
-- =========================

-- =========================
-- EXTENSIONS
-- =========================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================
-- HELPERS
-- =========================

-- Keeps a yearly counter for generated member account identifiers.
CREATE TABLE IF NOT EXISTS member_account_counters (
  year SMALLINT PRIMARY KEY,
  next_value INTEGER NOT NULL CHECK (next_value >= 1)
);

-- Generates account ids like ME2026-0001.
CREATE OR REPLACE FUNCTION generate_member_account_id()
RETURNS VARCHAR(32)
LANGUAGE plpgsql
AS $$
DECLARE
  current_year SMALLINT := EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT;
  allocated_value INTEGER;
BEGIN
  INSERT INTO member_account_counters (year, next_value)
  VALUES (current_year, 2)
  ON CONFLICT (year)
  DO UPDATE
  SET next_value = member_account_counters.next_value + 1
  RETURNING next_value - 1 INTO allocated_value;

  RETURN format('ME%s-%s', current_year, lpad(allocated_value::TEXT, 4, '0'));
END;
$$;

-- Generic trigger for updated_at maintenance.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- =========================
-- CORE TABLES
-- =========================

CREATE TABLE IF NOT EXISTS members (
  uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  genre SMALLINT NOT NULL DEFAULT 0,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE,
  email VARCHAR(255),
  phone VARCHAR(50),
  member_category SMALLINT NOT NULL,
  seniority SMALLINT,
  ffvp_id BIGINT,
  account_id VARCHAR(32) NOT NULL DEFAULT generate_member_account_id(),
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  status SMALLINT NOT NULL DEFAULT 1,
  registration_status SMALLINT NOT NULL DEFAULT 1,
  is_instructor BOOLEAN NOT NULL DEFAULT FALSE,
  is_employee BOOLEAN NOT NULL DEFAULT FALSE,
  is_executive BOOLEAN NOT NULL DEFAULT FALSE,
  is_board_member BOOLEAN NOT NULL DEFAULT FALSE,
  can_fly BOOLEAN NOT NULL DEFAULT FALSE,
  external_auth_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_registration_year SMALLINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT chk_members_genre
    CHECK (genre BETWEEN 0 AND 3),
  CONSTRAINT chk_members_category
    CHECK (member_category BETWEEN 1 AND 6),
  CONSTRAINT chk_members_status
    CHECK (status BETWEEN 1 AND 4),
  CONSTRAINT chk_members_registration_status
    CHECK (registration_status BETWEEN 1 AND 4),
  CONSTRAINT chk_members_seniority
    CHECK (seniority IS NULL OR seniority >= 0),
  CONSTRAINT chk_members_last_registration_year
    CHECK (last_registration_year IS NULL OR last_registration_year BETWEEN 2000 AND 9999),
  CONSTRAINT chk_members_role_employee_executive
    CHECK (NOT (is_employee AND is_executive)),
  CONSTRAINT chk_members_role_employee_board
    CHECK (NOT (is_employee AND is_board_member)),
  CONSTRAINT chk_members_account_id_format
    CHECK (account_id ~ '^ME[0-9]{4}-[0-9]{4,}$')
);

CREATE TABLE IF NOT EXISTS committees (
  uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) NOT NULL,
  description VARCHAR(255) NOT NULL,
  budget_amount NUMERIC(12,2),
  last_meeting_date DATE,
  budget_status SMALLINT,
  manager_member_uuid UUID REFERENCES members(uuid) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT uq_committees_code UNIQUE (code),
  CONSTRAINT chk_committees_budget_amount
    CHECK (budget_amount IS NULL OR budget_amount >= 0),
  CONSTRAINT chk_committees_budget_status
    CHECK (budget_status IS NULL OR budget_status BETWEEN 1 AND 3)
);

CREATE TABLE IF NOT EXISTS committee_members (
  committee_uuid UUID NOT NULL REFERENCES committees(uuid) ON DELETE CASCADE,
  member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
  membership_year SMALLINT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,

  PRIMARY KEY (committee_uuid, member_uuid, membership_year),
  CONSTRAINT chk_committee_members_membership_year
    CHECK (membership_year BETWEEN 2000 AND 9999)
);

CREATE TABLE IF NOT EXISTS member_sheets (
  uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  licence_number VARCHAR(100),
  fare_type SMALLINT NOT NULL,
  hours_count NUMERIC(8,2) NOT NULL DEFAULT 0,
  packs_bought_count INTEGER NOT NULL DEFAULT 0,
  hours_done_in_pack NUMERIC(8,2) NOT NULL DEFAULT 0,
  remaining_hours_in_pack NUMERIC(8,2) NOT NULL DEFAULT 0,
  expense_access_token_hash VARCHAR(255),
  expense_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT uq_member_sheets_member_year UNIQUE (member_uuid, year),
  CONSTRAINT chk_member_sheets_year
    CHECK (year BETWEEN 2000 AND 9999),
  CONSTRAINT chk_member_sheets_fare_type
    CHECK (fare_type BETWEEN 1 AND 5),
  CONSTRAINT chk_member_sheets_hours_count
    CHECK (hours_count >= 0),
  CONSTRAINT chk_member_sheets_packs_bought_count
    CHECK (packs_bought_count >= 0),
  CONSTRAINT chk_member_sheets_hours_done_in_pack
    CHECK (hours_done_in_pack >= 0),
  CONSTRAINT chk_member_sheets_remaining_hours_in_pack
    CHECK (remaining_hours_in_pack >= 0)
);

CREATE TABLE IF NOT EXISTS member_registrations (
  uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  registered_for_year SMALLINT NOT NULL,
  registration_type SMALLINT NOT NULL,
  status SMALLINT NOT NULL DEFAULT 1,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,

  CONSTRAINT uq_member_registrations_period UNIQUE (member_uuid, start_date, end_date),
  CONSTRAINT chk_member_registrations_year
    CHECK (registered_for_year BETWEEN 2000 AND 9999),
  CONSTRAINT chk_member_registrations_type
    CHECK (registration_type BETWEEN 1 AND 7),
  CONSTRAINT chk_member_registrations_status
    CHECK (status BETWEEN 1 AND 3),
  CONSTRAINT chk_member_registrations_date_range
    CHECK (end_date >= start_date)
);

-- =========================
-- INDEXES
-- =========================

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_account_id
ON members(account_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_email_not_null
ON members(email)
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_ffvp_id_not_null
ON members(ffvp_id)
WHERE ffvp_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_members_name
ON members(last_name, first_name);

CREATE INDEX IF NOT EXISTS idx_members_member_category
ON members(member_category);

CREATE INDEX IF NOT EXISTS idx_members_status
ON members(status);

CREATE INDEX IF NOT EXISTS idx_members_registration_status
ON members(registration_status);

CREATE INDEX IF NOT EXISTS idx_members_can_fly
ON members(can_fly);

CREATE INDEX IF NOT EXISTS idx_members_last_registration_year
ON members(last_registration_year);

CREATE INDEX IF NOT EXISTS idx_committees_manager_member_uuid
ON committees(manager_member_uuid);

CREATE INDEX IF NOT EXISTS idx_committee_members_member_year
ON committee_members(member_uuid, membership_year);

CREATE INDEX IF NOT EXISTS idx_committee_members_committee_year
ON committee_members(committee_uuid, membership_year);

CREATE INDEX IF NOT EXISTS idx_member_sheets_member_uuid
ON member_sheets(member_uuid);

CREATE INDEX IF NOT EXISTS idx_member_sheets_year
ON member_sheets(year);

CREATE INDEX IF NOT EXISTS idx_member_registrations_member_uuid
ON member_registrations(member_uuid);

CREATE INDEX IF NOT EXISTS idx_member_registrations_period
ON member_registrations(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_member_registrations_registered_for_year
ON member_registrations(registered_for_year);

CREATE INDEX IF NOT EXISTS idx_member_registrations_status
ON member_registrations(status);

-- =========================
-- TRIGGERS
-- =========================

DROP TRIGGER IF EXISTS trg_members_set_updated_at ON members;
CREATE TRIGGER trg_members_set_updated_at
BEFORE UPDATE ON members
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_committees_set_updated_at ON committees;
CREATE TRIGGER trg_committees_set_updated_at
BEFORE UPDATE ON committees
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_member_sheets_set_updated_at ON member_sheets;
CREATE TRIGGER trg_member_sheets_set_updated_at
BEFORE UPDATE ON member_sheets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================
-- COMMENTS
-- =========================

COMMENT ON TABLE members IS 'Club members with identity, category, operational flags, and lifecycle state.';
COMMENT ON COLUMN members.member_category IS '1=Full Member, 2=Temporary Member, 3=Non-Flying Member, 4=Short Period Member, 5=External Pilot, 6=Volunteer.';
COMMENT ON COLUMN members.status IS '1=Active, 2=Suspended, 3=Resigned, 4=Anonymized.';
COMMENT ON COLUMN members.registration_status IS '1=Draft, 2=In Progress, 3=Completed, 4=Archived.';
COMMENT ON COLUMN members.account_id IS 'Stable member and ledger identifier, formatted as ME<YEAR>-<SEQUENCE>.';
COMMENT ON TABLE committees IS 'Committees with optional manager and optional budget.';
COMMENT ON TABLE committee_members IS 'Yearly committee membership assignments for members.';
COMMENT ON TABLE member_sheets IS 'Yearly flying member summary and expense access controls.';
COMMENT ON COLUMN member_sheets.fare_type IS '1=Standard, 2=Student, 3=Discovery, 4=Pack, 5=Other.';
COMMENT ON TABLE member_registrations IS 'Dated member registration periods. A member is registered for a year when an active period overlaps that calendar year.';
COMMENT ON COLUMN member_registrations.registration_type IS 'Snapshot of member category at registration time: 1=Full, 2=Temporary, 3=Non-Flying, 4=Short Period, 5=External Pilot, 6=Volunteer.';
COMMENT ON COLUMN member_registrations.status IS '1=Active, 2=Cancelled, 3=Superseded.';
