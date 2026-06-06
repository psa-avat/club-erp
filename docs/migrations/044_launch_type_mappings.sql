-- =============================================================================
-- Migration 044: Add launch_type column to asset_flight_types
--
-- Maps Planche launch_type integers to flight type codes for pricing.
-- Each flight type (RMQ, TREUIL, CONV, DEP…) can be linked to a Planche
-- launch_type value (0=remorquage, 1=dépannage, 2=convoyage…).
-- =============================================================================
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'asset_flight_types' AND column_name = 'launch_type'
    ) THEN
        ALTER TABLE asset_flight_types
            ADD COLUMN launch_type INTEGER UNIQUE;

        COMMENT ON COLUMN asset_flight_types.launch_type IS
          'Planche launch_type (tow: 0=remorquage, 1=dépannage, 2=convoyage; winch: 0=normal, 1=exercise, 2=cable break)';
    END IF;
END $$;

COMMIT;
