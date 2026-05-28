-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 031: Planche flight source snapshots and normalized flight fields
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

CREATE TABLE IF NOT EXISTS planche_flight_snapshots (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planche_uuid VARCHAR NOT NULL,
    planche_revision INTEGER NOT NULL DEFAULT 1,
    source_hash VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at_source TIMESTAMPTZ,
    corrected_at TIMESTAMPTZ,
    corrected_by VARCHAR,
    correction_reason TEXT,
    ack_status VARCHAR(32) NOT NULL DEFAULT 'not_acknowledged',
    ack_at TIMESTAMPTZ,
    ack_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_planche_flight_snapshot_revision UNIQUE (planche_uuid, planche_revision)
);

CREATE INDEX IF NOT EXISTS idx_planche_flight_snapshots_planche_uuid ON planche_flight_snapshots(planche_uuid);
CREATE INDEX IF NOT EXISTS idx_planche_flight_snapshots_source_hash ON planche_flight_snapshots(source_hash);
CREATE INDEX IF NOT EXISTS idx_planche_flight_snapshots_status ON planche_flight_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_planche_flight_snapshots_updated_at_source ON planche_flight_snapshots(updated_at_source);
CREATE INDEX IF NOT EXISTS idx_planche_flight_snapshots_ack_status ON planche_flight_snapshots(ack_status);
CREATE INDEX IF NOT EXISTS idx_planche_flight_snapshots_received_at ON planche_flight_snapshots(received_at);

ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS source_snapshot_uuid UUID NULL REFERENCES planche_flight_snapshots(uuid) ON DELETE SET NULL;
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS aero VARCHAR;
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS pilot_compta_id VARCHAR;
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS second_pilot_id VARCHAR;
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS charge_to_compta_id VARCHAR;
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS source_status VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS corrected_by VARCHAR;
ALTER TABLE validated_flights ADD COLUMN IF NOT EXISTS correction_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_validated_flights_source_snapshot_uuid ON validated_flights(source_snapshot_uuid);

COMMIT;
