-- Check and fix VI entitlements marked REALIZED (status=3) with no linked flight.
--
-- Context: vi_flight_links rows with flight_uuid IS NOT NULL are the only ones that
-- count as "linked" (frontend ViEntitlementsPage.tsx / api/routes/vi.py linked_flight_count).
-- is_generic entitlements are exempt (catch-all vouchers bypass per-flight linking).
--
-- validated_flights.vi_erp_id can reference an entitlement by uuid (text) or by code
-- (see services/planche_integration.py reconcile_vi_realisation_from_validated_flights,
-- which sets status/realisation_date from vi_erp_id but does NOT create the vi_flight_links
-- row — that gap is what produces "realized without flight" entitlements).
--
-- Run the CHECK query first. Only run the FIX INSERT inside its own transaction, and only
-- after reviewing which rows are SAFE_TO_LINK vs need manual attention.

-- =====================================================================
-- 1) CHECK: classify every REALIZED, non-generic entitlement with no real flight link
-- =====================================================================
WITH orphan_realized AS (
    SELECT ve.uuid AS entitlement_uuid, ve.code, ve.realisation_date, ve.validity_date, ve.scheduled_date
    FROM vi_entitlements ve
    WHERE ve.status = 3            -- REALIZED
      AND ve.is_generic = FALSE
      AND NOT EXISTS (
          SELECT 1 FROM vi_flight_links fl
          WHERE fl.entitlement_uuid = ve.uuid AND fl.flight_uuid IS NOT NULL
      )
),
candidates AS (
    SELECT
        o.entitlement_uuid,
        o.code,
        o.realisation_date,
        vf.uuid AS flight_uuid,
        vf.jour AS flight_date,
        -- a candidate flight is unusable if some OTHER entitlement already claims it
        EXISTS (
            SELECT 1 FROM vi_flight_links x WHERE x.flight_uuid = vf.uuid
        ) AS flight_already_linked_elsewhere
    FROM orphan_realized o
    LEFT JOIN validated_flights vf
        ON vf.vi_erp_id = o.entitlement_uuid::text OR vf.vi_erp_id = o.code
)
SELECT
    entitlement_uuid,
    code,
    realisation_date,
    COUNT(flight_uuid) AS candidate_count,
    COUNT(flight_uuid) FILTER (WHERE NOT flight_already_linked_elsewhere) AS usable_candidate_count,
    CASE
        WHEN COUNT(flight_uuid) = 0 THEN 'NO_CANDIDATE'
        WHEN COUNT(flight_uuid) FILTER (WHERE NOT flight_already_linked_elsewhere) = 1 THEN 'SAFE_TO_LINK'
        ELSE 'AMBIGUOUS_NEEDS_REVIEW'
    END AS diagnosis,
    array_agg(flight_uuid) FILTER (WHERE flight_uuid IS NOT NULL) AS candidate_flight_uuids
FROM candidates
GROUP BY entitlement_uuid, code, realisation_date
ORDER BY diagnosis, code;

-- =====================================================================
-- 2) FIX: auto-link only the unambiguous case (exactly one unused candidate flight)
-- =====================================================================
BEGIN;

WITH orphan_realized AS (
    SELECT ve.uuid AS entitlement_uuid, ve.code
    FROM vi_entitlements ve
    WHERE ve.status = 3
      AND ve.is_generic = FALSE
      AND NOT EXISTS (
          SELECT 1 FROM vi_flight_links fl
          WHERE fl.entitlement_uuid = ve.uuid AND fl.flight_uuid IS NOT NULL
      )
),
candidates AS (
    SELECT
        o.entitlement_uuid,
        vf.uuid AS flight_uuid,
        COUNT(*) OVER (PARTITION BY o.entitlement_uuid) AS candidate_count
    FROM orphan_realized o
    JOIN validated_flights vf
        ON vf.vi_erp_id = o.entitlement_uuid::text OR vf.vi_erp_id = o.code
    WHERE NOT EXISTS (SELECT 1 FROM vi_flight_links x WHERE x.flight_uuid = vf.uuid)
),
safe_to_link AS (
    SELECT entitlement_uuid, flight_uuid
    FROM candidates
    WHERE candidate_count = 1
),
next_sequence AS (
    SELECT s.entitlement_uuid, s.flight_uuid,
           COALESCE((SELECT COUNT(*) FROM vi_flight_links fl WHERE fl.entitlement_uuid = s.entitlement_uuid), 0) + 1 AS sequence
    FROM safe_to_link s
)
INSERT INTO vi_flight_links (uuid, entitlement_uuid, flight_uuid, sequence, created_at)
SELECT gen_random_uuid(), entitlement_uuid, flight_uuid, sequence, now()
FROM next_sequence
RETURNING entitlement_uuid, flight_uuid, sequence;

-- Review the RETURNING rows above, then either:
COMMIT;
-- or, if something looks wrong:
-- ROLLBACK;

-- =====================================================================
-- 3) Remaining true orphans (NO_CANDIDATE) need a manual call — either a real flight
--    exists but validated_flights.vi_erp_id was never set (fix vi_erp_id, re-run),
--    or the realisation was set by mistake (revert status/realisation_date):
-- =====================================================================
-- UPDATE vi_entitlements
-- SET status = CASE WHEN scheduled_date IS NOT NULL THEN 2 ELSE 1 END,
--     realisation_date = NULL
-- WHERE uuid = '<entitlement_uuid>';


-- =====================================================================
-- 4) CHECK + FIX: initiation flights carrying a stale validated_flights.vi_erp_id
-- =====================================================================
-- validated_flights.vi_erp_id is a free-text join key, informational only once a
-- vi_flight_links row exists for the flight — vi_flight_links.entitlement_uuid is
-- the authoritative link used by accounting/realization. When a flight already has
-- a real vi_flight_links row, but vi_erp_id still names a DIFFERENT entitlement
-- (typically a generic/legacy placeholder code like a catch-all VI/JD code), that
-- text field is stale leftover data — not a real second link, no accounting impact,
-- but confusing on any screen/report that reads vi_erp_id directly.
--
-- CHECK: list initiation flights (type_of_flight=2) with a stale vi_erp_id
SELECT
    vf.uuid AS flight_uuid, vf.jour, vf.vi_erp_id AS stale_vi_erp_id,
    real_ve.code AS actually_linked_code, real_ve.status AS actually_linked_status
FROM validated_flights vf
JOIN vi_flight_links fl ON fl.flight_uuid = vf.uuid
JOIN vi_entitlements real_ve ON real_ve.uuid = fl.entitlement_uuid
WHERE vf.type_of_flight = 2
  AND vf.vi_erp_id IS NOT NULL
  AND vf.vi_erp_id <> real_ve.code
  AND vf.vi_erp_id <> real_ve.uuid::text
ORDER BY vf.jour;

-- FIX: clear the stale vi_erp_id (does not touch vi_flight_links / accounting)
BEGIN;

WITH stale AS (
    SELECT vf.uuid AS flight_uuid, vf.vi_erp_id AS old_value
    FROM validated_flights vf
    JOIN vi_flight_links fl ON fl.flight_uuid = vf.uuid
    JOIN vi_entitlements real_ve ON real_ve.uuid = fl.entitlement_uuid
    WHERE vf.type_of_flight = 2
      AND vf.vi_erp_id IS NOT NULL
      AND vf.vi_erp_id <> real_ve.code
      AND vf.vi_erp_id <> real_ve.uuid::text
)
UPDATE validated_flights vf
SET vi_erp_id = NULL
FROM stale s
WHERE vf.uuid = s.flight_uuid
RETURNING vf.uuid, s.old_value;

-- Review the RETURNING rows above, then either:
COMMIT;
-- or, if something looks wrong:
-- ROLLBACK;
