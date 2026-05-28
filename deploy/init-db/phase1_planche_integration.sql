-- Migration: Phase 1 - Planche Integration Schema Extensions
-- Date: 2026-01-XX
-- Description:
--   1. Create validated_flights table for imported flights from Planche
--   2. Create flight_charges table for per-flight charging with proper accounting precision
--   3. Create planche_audit_log table for operation audit trail
--
-- NOTE: Pilot/Machine sync does NOT require schema changes to members/assets tables.
-- Planche sends member_id and asset_code for sync key; no caching of Planche IDs needed.

-- Create immutable Planche flight source snapshots
CREATE TABLE planche_flight_snapshots (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planche_uuid VARCHAR NOT NULL,
    planche_revision INTEGER DEFAULT 1 NOT NULL,
    source_hash VARCHAR(64) NOT NULL,
    status VARCHAR(32) DEFAULT 'active' NOT NULL,
    payload_json JSONB DEFAULT '{}'::jsonb NOT NULL,
    updated_at_source TIMESTAMP WITH TIME ZONE,
    corrected_at TIMESTAMP WITH TIME ZONE,
    corrected_by VARCHAR,
    correction_reason TEXT,
    ack_status VARCHAR(32) DEFAULT 'not_acknowledged' NOT NULL,
    ack_at TIMESTAMP WITH TIME ZONE,
    ack_error TEXT,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_planche_flight_snapshot_revision UNIQUE (planche_uuid, planche_revision)
);

CREATE INDEX idx_planche_flight_snapshots_planche_uuid ON planche_flight_snapshots(planche_uuid);
CREATE INDEX idx_planche_flight_snapshots_source_hash ON planche_flight_snapshots(source_hash);
CREATE INDEX idx_planche_flight_snapshots_status ON planche_flight_snapshots(status);
CREATE INDEX idx_planche_flight_snapshots_updated_at_source ON planche_flight_snapshots(updated_at_source);
CREATE INDEX idx_planche_flight_snapshots_ack_status ON planche_flight_snapshots(ack_status);
CREATE INDEX idx_planche_flight_snapshots_received_at ON planche_flight_snapshots(received_at);

-- Create validated_flights table
CREATE TABLE validated_flights (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planche_uuid VARCHAR NOT NULL UNIQUE,
    source_snapshot_uuid UUID REFERENCES planche_flight_snapshots(uuid) ON DELETE SET NULL,
    aero VARCHAR,
    jour DATE NOT NULL,
    asset_code VARCHAR NOT NULL,
    pilot_erp_id VARCHAR NOT NULL,
    pilot_compta_id VARCHAR,
    second_pilot_erp_id VARCHAR,
    second_pilot_id VARCHAR,
    charge_to_erp_id VARCHAR,
    charge_to_compta_id VARCHAR,
    instruction_split INTEGER DEFAULT 0 NOT NULL,
    vi_erp_id VARCHAR,
    typeOfFlight SMALLINT NOT NULL,
    launchMethod SMALLINT NOT NULL,
    launchType SMALLINT,
    launch_asset_code VARCHAR,
    launch_pilot_trigram VARCHAR,
    launch_instructor_trigram VARCHAR,
    takeoffTime VARCHAR NOT NULL,
    landingTime VARCHAR NOT NULL,
    startIndex FLOAT8,
    stopIndex FLOAT8,
    engineTime FLOAT8,
    landingCount INTEGER DEFAULT 1 NOT NULL,
    flightKm FLOAT8,
    takeoffLocation VARCHAR,
    landedLocation VARCHAR,
    observations TEXT,
    erp_status SMALLINT DEFAULT 0 NOT NULL,
    validated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    validated_by VARCHAR NOT NULL,
    transferred_at TIMESTAMP WITH TIME ZONE,
    transferred_by VARCHAR,
    last_export_hash VARCHAR,
    revision INTEGER DEFAULT 1 NOT NULL,
    source_status VARCHAR(32) DEFAULT 'active' NOT NULL,
    corrected_at TIMESTAMP WITH TIME ZONE,
    corrected_by VARCHAR,
    correction_reason TEXT,
    accounting_entry_uuid UUID UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_vf_typeOfFlight CHECK (typeOfFlight BETWEEN 0 AND 7),
    CONSTRAINT chk_vf_launchMethod CHECK (launchMethod BETWEEN 0 AND 3),
    CONSTRAINT chk_vf_erp_status CHECK (erp_status IN (0, 1, 2)),
    CONSTRAINT chk_vf_landingCount CHECK (landingCount >= 1)
);

CREATE INDEX idx_validated_flights_planche_uuid ON validated_flights(planche_uuid);
CREATE INDEX idx_validated_flights_source_snapshot_uuid ON validated_flights(source_snapshot_uuid);
CREATE INDEX idx_validated_flights_jour ON validated_flights(jour);
CREATE INDEX idx_validated_flights_erp_status ON validated_flights(erp_status);
CREATE INDEX idx_validated_flights_accounting_entry_uuid ON validated_flights(accounting_entry_uuid);

-- Create planche_audit_log table
CREATE TABLE planche_audit_log (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_type VARCHAR NOT NULL,
    affected_record_id VARCHAR,
    status SMALLINT DEFAULT 0 NOT NULL,
    result_summary VARCHAR,
    error_message TEXT,
    total_records INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    triggered_by VARCHAR,
    audit_metadata TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_planche_audit_log_operation_type ON planche_audit_log(operation_type);
CREATE INDEX idx_planche_audit_log_affected_record_id ON planche_audit_log(affected_record_id);
CREATE INDEX idx_planche_audit_log_created_at ON planche_audit_log(created_at);
