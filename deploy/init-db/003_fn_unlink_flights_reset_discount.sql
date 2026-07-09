-- Migration: 003 - Reset has_discount on entry delete + cleanup orphaned pack consumptions
-- Date: 2026-06-18
-- Description:
--   Update fn_unlink_flights_on_entry_delete trigger function to also:
--     1. Reset has_discount = FALSE on validated_flights when their accounting entry is deleted
--     2. Delete orphaned member_pack_consumptions linked to the deleted entry
--   This ensures that removing a REM accounting entry (manually or via cascade)
--   properly resets all discount-related flags and data.

CREATE OR REPLACE FUNCTION public.fn_unlink_flights_on_entry_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- 1) Reset has_discount sur les vols liés à cette écriture
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

    -- 2) Nettoyer les consommations de pack liées à cette écriture REM
    DELETE FROM member_pack_consumptions
    WHERE accounting_entry_uuid = OLD.uuid;

    RETURN OLD;
END;
$$;
