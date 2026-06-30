-- 060_hr_planning.sql
-- HR employee profiles, seasons, work calendars, and calendar assignments

-- ==========================================================================
-- HR employee profiles
-- ==========================================================================
CREATE TABLE hr_employee_profiles (
    member_uuid UUID PRIMARY KEY REFERENCES members(uuid) ON DELETE RESTRICT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    contract_type VARCHAR(16) NOT NULL,
    hire_date DATE NOT NULL,
    termination_date DATE,
    weekly_hours NUMERIC(5,2) NOT NULL DEFAULT 35.00,
    annual_work_hours NUMERIC(6,2) NOT NULL DEFAULT 1607.00,
    current_leave_balance NUMERIC(5,2) NOT NULL DEFAULT 0,
    last_leave_balance_update DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_hr_contract_type CHECK (contract_type IN ('CDI', 'CDD', 'SAISONNIER', 'VACATAIRE', 'BENEVOLE')),
    CONSTRAINT chk_hr_profile_dates CHECK (termination_date IS NULL OR termination_date >= hire_date),
    CONSTRAINT chk_hr_weekly_hours CHECK (weekly_hours >= 0),
    CONSTRAINT chk_hr_annual_hours CHECK (annual_work_hours >= 0),
    CONSTRAINT chk_hr_leave_balance CHECK (current_leave_balance >= 0)
);

COMMENT ON COLUMN hr_employee_profiles.annual_work_hours IS 'Durée annuelle de référence (ex: 1607h pour un temps plein)';
COMMENT ON COLUMN hr_employee_profiles.current_leave_balance IS 'Solde actuel de jours de congés disponibles';
COMMENT ON COLUMN hr_employee_profiles.last_leave_balance_update IS 'Date de dernière mise à jour du solde';

CREATE INDEX idx_hr_employee_profiles_user ON hr_employee_profiles(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_hr_employee_profiles_active ON hr_employee_profiles(is_active);

-- ==========================================================================
-- Seasons (global club resources, shared across employees)
-- ==========================================================================
CREATE TABLE hr_seasons (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_hr_season_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_hr_seasons_dates ON hr_seasons(start_date, end_date);

-- ==========================================================================
-- Work calendars (weekly patterns, reusable)
-- ==========================================================================
CREATE TABLE hr_work_calendars (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hr_work_calendar_days (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_uuid UUID NOT NULL REFERENCES hr_work_calendars(uuid) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    is_working BOOLEAN NOT NULL DEFAULT TRUE,
    expected_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
    start_time TIME,
    end_time TIME,
    apply_on_week SMALLINT NOT NULL DEFAULT 0 CHECK (apply_on_week BETWEEN 0 AND 5),
    CONSTRAINT chk_hr_calendar_day_hours CHECK (expected_hours >= 0),
    UNIQUE (calendar_uuid, day_of_week, apply_on_week)
);

COMMENT ON COLUMN hr_work_calendar_days.day_of_week IS '1=Lundi … 7=Dimanche';
COMMENT ON COLUMN hr_work_calendar_days.apply_on_week IS '0=toutes les semaines, 1..5=Nième semaine du mois (5=dernière)';

CREATE INDEX idx_hr_calendar_days_calendar ON hr_work_calendar_days(calendar_uuid);

-- ==========================================================================
-- Calendar assignments (employee → season → calendar)
-- ==========================================================================
CREATE TABLE hr_calendar_assignments (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    season_uuid UUID NOT NULL REFERENCES hr_seasons(uuid) ON DELETE CASCADE,
    calendar_uuid UUID NOT NULL REFERENCES hr_work_calendars(uuid) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (member_uuid, season_uuid)
);

CREATE INDEX idx_hr_calendar_assignments_member ON hr_calendar_assignments(member_uuid);
CREATE INDEX idx_hr_calendar_assignments_season ON hr_calendar_assignments(season_uuid);
