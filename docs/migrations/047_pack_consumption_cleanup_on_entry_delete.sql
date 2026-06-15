-- Migration 047: Clean up member_pack_consumptions when accounting entry is deleted
--
-- When an accounting entry is deleted (Draft or reversal), any member_pack_consumptions
-- row referencing it via accounting_entry_uuid must also be deleted, and the
-- validated_flights.has_discount flag must be reset.
--
-- This extends the existing fn_unlink_flights_on_entry_delete function.

CREATE OR REPLACE FUNCTION fn_unlink_flights_on_entry_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. Reset validated_flights that reference this entry
    UPDATE validated_flights
    SET
        accounting_entry_uuid = NULL,
        billing_quote_state = 'pending',
        erp_status = CASE
            WHEN erp_status = 1 THEN 2  -- was transferred → modified_after_transfer
            ELSE erp_status
        END,
        has_discount = false
    WHERE accounting_entry_uuid = OLD.uuid;

    -- 2. Delete member_pack_consumptions rows referencing this entry
    --    Also reset has_discount on any flights that had consumptions deleted
    WITH deleted_consumptions AS (
        DELETE FROM member_pack_consumptions
        WHERE accounting_entry_uuid = OLD.uuid
        RETURNING flight_uuid
    )
    UPDATE validated_flights vf
    SET has_discount = (
        SELECT EXISTS (
            SELECT 1 FROM member_pack_consumptions mpc
            WHERE mpc.flight_uuid = vf.uuid
        )
    )
    WHERE vf.uuid IN (SELECT flight_uuid FROM deleted_consumptions);

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_unlink_flights_on_entry_delete IS
    'When an accounting entry is deleted: (1) reset any validated_flights that reference it, '
    '(2) delete member_pack_consumptions rows linked to that entry, (3) update has_discount on affected flights.';
