-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 034: Drop last_updated from validated_flights
--
-- The last_updated column stored the Planche source timestamp (lastUpdated),
-- but this information is already preserved in the linked
-- planche_flight_snapshots.updated_at_source. The column was redundant and
-- caused confusion with updated_at (the ERP's own row-level audit timestamp).
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

ALTER TABLE validated_flights DROP COLUMN IF EXISTS last_updated;

COMMIT;
