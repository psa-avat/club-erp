-- ERP-CLUB - ERP pour Club de vol à voile
-- Migration 033: Add glider_erp_id and launch_machine_erp_id to validated_flights
--
-- The Planche API now returns ERP asset UUIDs alongside the registration
-- strings (glider_immat / launch_machine_immat). Keep both: immat for
-- display/reference, erp_id for direct ERP asset linking.
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

ALTER TABLE validated_flights
    ADD COLUMN IF NOT EXISTS glider_erp_id VARCHAR,
    ADD COLUMN IF NOT EXISTS launch_machine_erp_id VARCHAR;

CREATE INDEX IF NOT EXISTS idx_validated_flights_glider_erp_id ON validated_flights(glider_erp_id);
CREATE INDEX IF NOT EXISTS idx_validated_flights_launch_machine_erp_id ON validated_flights(launch_machine_erp_id);

COMMIT;
