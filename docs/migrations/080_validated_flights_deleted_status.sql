-- Migration 080: add erp_status=3 (deleted) to validated_flights
-- A Planche flight with landing_count = 0 and takeoff_time == landing_time is a
-- stub/cancelled flight (no real landings, no elapsed time) rather than a real
-- flight, and is now marked erp_status=3 (deleted) on import instead of
-- validated/transferred/modified. landing_count is allowed to be 0 only for
-- deleted flights; all other flights still require landing_count >= 1.

ALTER TABLE validated_flights
    DROP CONSTRAINT IF EXISTS chk_vf_erp_status;

ALTER TABLE validated_flights
    ADD CONSTRAINT chk_vf_erp_status CHECK (erp_status IN (0, 1, 2, 3));

ALTER TABLE validated_flights
    DROP CONSTRAINT IF EXISTS chk_vf_landing_count;

ALTER TABLE validated_flights
    ADD CONSTRAINT chk_vf_landing_count CHECK (
        (erp_status = 3 AND landing_count >= 0) OR (erp_status != 3 AND landing_count >= 1)
    );
