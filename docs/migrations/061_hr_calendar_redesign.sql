-- 061_hr_calendar_redesign.sql
-- HR calendar model redesign.
-- Phases are now owned BY a working time calendar (not global).
-- Employees are assigned to a working time calendar (not to individual seasons).
--
-- New model:
--   hr_working_time_calendars  ← top-level, assigned to employees
--     └── hr_calendar_phases   ← annual recurring date ranges (MM-DD) per calendar
--           └── hr_phase_day_rules  ← weekly schedule per phase
--   hr_employee_calendar_assignments  ← employee → calendar (with effective dates)

BEGIN;

-- Drop old tables from migration 060 (IF EXISTS guards idempotency)
DROP TABLE IF EXISTS hr_calendar_assignments;
DROP TABLE IF EXISTS hr_work_calendar_days;
DROP TABLE IF EXISTS hr_work_calendars;
DROP TABLE IF EXISTS hr_seasons;

-- Top-level: a complete annual work-time definition assigned to employees
CREATE TABLE hr_working_time_calendars (
    uuid           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(100) NOT NULL,
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phases: annual recurring date ranges owned by a calendar.
-- start/end expressed as (month, day); phases should cover the full year without gaps/overlaps.
-- Enforcement of non-overlap is done in the service layer.
CREATE TABLE hr_calendar_phases (
    uuid           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_uuid  UUID NOT NULL REFERENCES hr_working_time_calendars(uuid) ON DELETE CASCADE,
    name           VARCHAR(100) NOT NULL,
    start_month    SMALLINT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
    start_day      SMALLINT NOT NULL CHECK (start_day BETWEEN 1 AND 31),
    end_month      SMALLINT NOT NULL CHECK (end_month BETWEEN 1 AND 12),
    end_day        SMALLINT NOT NULL CHECK (end_day BETWEEN 1 AND 31),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Weekly schedule: one row per (phase, day_of_week, apply_on_week).
-- apply_on_week=0 means every week; 1..5 means the Nth occurrence of that weekday in the month.
-- Specific-week entries take precedence over apply_on_week=0.
CREATE TABLE hr_phase_day_rules (
    uuid           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phase_uuid     UUID NOT NULL REFERENCES hr_calendar_phases(uuid) ON DELETE CASCADE,
    day_of_week    SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),  -- 1=Mon 7=Sun
    is_working     BOOLEAN NOT NULL DEFAULT TRUE,
    expected_hours NUMERIC(4,2) NOT NULL DEFAULT 0,
    start_time     TIME,
    end_time       TIME,
    apply_on_week  SMALLINT NOT NULL DEFAULT 0 CHECK (apply_on_week BETWEEN 0 AND 5),
    UNIQUE (phase_uuid, day_of_week, apply_on_week)
);

-- Employee → working time calendar assignment with optional effective date range.
-- Multiple rows allow tracking calendar changes over time.
-- The service layer resolves the active assignment for a given date.
CREATE TABLE hr_employee_calendar_assignments (
    uuid           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_uuid    UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    calendar_uuid  UUID NOT NULL REFERENCES hr_working_time_calendars(uuid) ON DELETE RESTRICT,
    effective_from DATE NOT NULL,
    effective_to   DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

COMMIT;
