-- =============================================================================
-- Migration 071: Allow incremental pack discount review
--
-- Makes validated_flights.has_discount nullable so it can distinguish
-- "never reviewed" (NULL) from "reviewed, no discount" (FALSE). This lets
-- flight_packs.discount_review_for_member() resume from the last reviewed
-- flight instead of always replaying every billed flight of the fiscal year.
--
-- Existing rows keep their current TRUE/FALSE value (they were genuinely
-- reviewed by a prior full recompute) — no backfill needed. Only newly
-- created/unlinked flights start at NULL going forward.
-- =============================================================================
BEGIN;

ALTER TABLE validated_flights
    ALTER COLUMN has_discount DROP NOT NULL,
    ALTER COLUMN has_discount DROP DEFAULT;

COMMENT ON COLUMN validated_flights.has_discount IS
  'Pack discount review outcome: NULL=never reviewed, False=reviewed without discount, True=reviewed with discount';

-- Keep the unlink-on-entry-delete trigger consistent: a flight leaving
-- billing scope must be treated as never-reviewed if/when it is re-billed,
-- not as "reviewed, no discount" (which would wrongly count as a settled
-- baseline for the incremental review's fallback checks).
CREATE OR REPLACE FUNCTION public.fn_unlink_flights_on_entry_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE validated_flights
    SET
        accounting_entry_uuid = NULL,
        billing_quote_state = 'pending',
        has_discount = NULL,
        erp_status = CASE
            WHEN erp_status = 1 THEN 2  -- was transferred → modified_after_transfer
            ELSE erp_status
        END
    WHERE accounting_entry_uuid = OLD.uuid;

    DELETE FROM member_pack_consumptions
    WHERE accounting_entry_uuid = OLD.uuid;

    RETURN OLD;
END;
$$;

COMMIT;
