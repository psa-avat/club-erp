-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 032: Rename validated_flights camelCase columns to snake_case
-- 
-- The original model used camelCase column names (typeOfFlight, launchMethod,
-- takeoffTime, etc.) which PostgreSQL folds to lowercase, creating an
-- inconsistent naming style vs the rest of the schema. This migration drops
-- and recreates the table with explicit snake_case column names.
--
-- WARNING: This drops the validated_flights table. Any data will be lost.
-- Run this only in development or after backing up production data.
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

-- ── 1. Drop validated_flights (FK depends on planche_flight_snapshots) ──────
DROP TABLE IF EXISTS validated_flights CASCADE;

-- ── 2. Recreate with snake_case column names ─────────────────────────────────
CREATE TABLE validated_flights (
    -- Identifiers
    uuid              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planche_uuid      VARCHAR NOT NULL,
    source_snapshot_uuid UUID NULL REFERENCES planche_flight_snapshots(uuid) ON DELETE SET NULL,

    -- Flight context
    aero              VARCHAR,
    jour              DATE NOT NULL,
    asset_code        VARCHAR NOT NULL,

    -- Pilots (ERP member IDs)
    pilot_erp_id         VARCHAR NOT NULL,
    pilot_compta_id      VARCHAR,
    second_pilot_erp_id  VARCHAR,
    second_pilot_id      VARCHAR,
    charge_to_erp_id     VARCHAR,
    charge_to_compta_id  VARCHAR,
    instruction_split    INTEGER NOT NULL DEFAULT 0,

    vi_erp_id            VARCHAR,

    -- Flight details (enum values stored as SMALLINT)
    type_of_flight       INTEGER NOT NULL,
    launch_method        INTEGER NOT NULL,
    launch_type          INTEGER,

    -- Tow / Winch details
    launch_asset_code        VARCHAR,
    launch_pilot_trigram     VARCHAR,
    launch_instructor_trigram VARCHAR,

    -- Timing & indices
    takeoff_time   VARCHAR NOT NULL,
    landing_time   VARCHAR NOT NULL,
    start_index    DOUBLE PRECISION,
    stop_index     DOUBLE PRECISION,
    engine_time    DOUBLE PRECISION,
    landing_count  INTEGER NOT NULL DEFAULT 1,

    -- Flight metrics
    flight_km        DOUBLE PRECISION,
    takeoff_location VARCHAR,
    landed_location  VARCHAR,
    observations     TEXT,

    -- ERP status & audit
    erp_status       INTEGER NOT NULL DEFAULT 0,
    validated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    validated_by     VARCHAR NOT NULL,
    transferred_at   TIMESTAMPTZ,
    transferred_by   VARCHAR,
    last_export_hash VARCHAR,
    revision         INTEGER NOT NULL DEFAULT 1,
    source_status    VARCHAR(32) NOT NULL DEFAULT 'active',
    corrected_at     TIMESTAMPTZ,
    corrected_by     VARCHAR,
    correction_reason TEXT,

    -- Accounting linkage
    accounting_entry_uuid UUID NULL,

    -- Timestamps
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_validated_flights_uuid UNIQUE (uuid),
    CONSTRAINT uq_validated_flights_planche_uuid UNIQUE (planche_uuid),
    CONSTRAINT chk_vf_type_of_flight CHECK (type_of_flight BETWEEN 0 AND 7),
    CONSTRAINT chk_vf_launch_method CHECK (launch_method BETWEEN 0 AND 3),
    CONSTRAINT chk_vf_erp_status CHECK (erp_status IN (0, 1, 2)),
    CONSTRAINT chk_vf_landing_count CHECK (landing_count >= 1)
);

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX idx_validated_flights_planche_uuid ON validated_flights(planche_uuid);
CREATE INDEX idx_validated_flights_source_snapshot_uuid ON validated_flights(source_snapshot_uuid);
CREATE INDEX idx_validated_flights_erp_status ON validated_flights(erp_status);
CREATE INDEX idx_validated_flights_accounting_entry_uuid ON validated_flights(accounting_entry_uuid);
CREATE INDEX idx_validated_flights_created_at ON validated_flights(created_at);
CREATE INDEX idx_validated_flights_updated_at ON validated_flights(updated_at);

COMMIT;
