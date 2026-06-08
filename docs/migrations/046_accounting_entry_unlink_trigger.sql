-- Migration 046: Auto-unlink validated_flights when accounting_entry is deleted
--
-- When an accounting entry is deleted (Draft or reversal), any validated_flights
-- row referencing it via accounting_entry_uuid must be reset to pending state.
-- Since there is no FK constraint (accounting_entry_uuid is a plain UUID with
-- a UNIQUE constraint), we use a trigger on accounting_entries DELETE.

CREATE OR REPLACE FUNCTION fn_unlink_flights_on_entry_delete()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE validated_flights
    SET
        accounting_entry_uuid = NULL,
        billing_quote_state = 'pending',
        erp_status = CASE
            WHEN erp_status = 1 THEN 2  -- was transferred → modified_after_transfer
            ELSE erp_status
        END
    WHERE accounting_entry_uuid = OLD.uuid;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_unlink_flights_on_entry_delete ON accounting_entries;

CREATE TRIGGER trg_unlink_flights_on_entry_delete
    BEFORE DELETE ON accounting_entries
    FOR EACH ROW
    EXECUTE FUNCTION fn_unlink_flights_on_entry_delete();

COMMENT ON FUNCTION fn_unlink_flights_on_entry_delete IS
    'When an accounting entry is deleted, reset any validated_flights that reference it: '
    'NULLify accounting_entry_uuid, set billing_quote_state to pending, and mark erp_status as modified_after_transfer if it was transferred.';

COMMENT ON TRIGGER trg_unlink_flights_on_entry_delete ON accounting_entries IS
    'Automatically reset validated_flights rows linked to a deleted accounting entry.';
