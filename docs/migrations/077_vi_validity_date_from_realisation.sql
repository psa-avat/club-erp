-- Migration 077: Align VI entitlement validity_date with the actual flight date(s)
--
-- Business rule: for a realized VI entitlement (status = REALIZED, i.e. a flight
-- has been archived against it), the "valid until" date must reflect the date the
-- flight(s) actually took place — sourced from vi_flight_links -> validated_
-- flights.jour, taking the latest (MAX) flight date when an entitlement covers
-- several flights (see vi_type_catalog.max_flights: multi-flight VI/JD/stage
-- packages). It must NOT be derived from realisation_date: that field can hold
-- an unrelated date (e.g. the date an admin clicked "Archiver le bon", which
-- defaults to today, or a ledger/accounting posting date), not the flight date.
--
-- This is a one-time backfill for entitlements already marked REALIZED before
-- the application logic (backend/services/vi.py, backend/services/
-- planche_integration.py) started keeping validity_date in sync going forward.
-- Entitlements with no linked flight fall back to realisation_date.

WITH max_flight_dates AS (
  SELECT vfl.entitlement_uuid, MAX(vf.jour) AS max_jour
  FROM vi_flight_links vfl
  JOIN validated_flights vf ON vf.uuid = vfl.flight_uuid
  WHERE vfl.flight_uuid IS NOT NULL
  GROUP BY vfl.entitlement_uuid
)
UPDATE vi_entitlements ve
SET validity_date = mfd.max_jour
FROM max_flight_dates mfd
WHERE ve.status = 3 -- ViEntitlementStatus.REALIZED
  AND ve.uuid = mfd.entitlement_uuid
  AND ve.validity_date IS DISTINCT FROM mfd.max_jour;

-- Realized entitlements with no flight link at all: fall back to realisation_date.
UPDATE vi_entitlements ve
SET validity_date = ve.realisation_date
WHERE ve.status = 3
  AND ve.realisation_date IS NOT NULL
  AND ve.validity_date IS DISTINCT FROM ve.realisation_date
  AND NOT EXISTS (
    SELECT 1 FROM vi_flight_links vfl
    WHERE vfl.entitlement_uuid = ve.uuid AND vfl.flight_uuid IS NOT NULL
  );
