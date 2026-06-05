-- =============================================================================
-- Migration 043: Add has_discount column to validated_flights
--
-- Tracks whether a pack discount has been applied to the flight.
-- Set to true by apply_flight_billing when member_pack_consumptions rows exist.
-- =============================================================================
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'validated_flights' AND column_name = 'has_discount'
    ) THEN
        ALTER TABLE validated_flights
            ADD COLUMN has_discount BOOLEAN NOT NULL DEFAULT FALSE;

        COMMENT ON COLUMN validated_flights.has_discount IS
          'True when pack discount has been applied to this flight';
    END IF;
END $$;

COMMIT;
