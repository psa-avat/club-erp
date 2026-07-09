-- =============================================================================
-- Migration 072: Track which specific pack purchase a consumption came from
--
-- member_pack_consumptions.pack_definition_uuid identifies the pack TEMPLATE
-- a consumption was applied to, but members routinely buy the same template
-- several times in a row (e.g. two consecutive 25h packs) — pack_definition_uuid
-- alone cannot tell which of those purchases a given flight's consumption
-- belongs to. purchase_entry_uuid disambiguates down to the exact VT
-- accounting entry (one row per purchase), which is what
-- flight_packs.list_consumptions_for_member() and the incremental discount
-- review (_plan_incremental_review) need to reconstruct each purchase's
-- remaining balance independently instead of falling back to a full
-- recompute for this — the most common real-world case.
--
-- Existing rows are left with purchase_entry_uuid = NULL (no reliable way to
-- backfill which purchase they came from without replaying FIFO). The next
-- discount_review_for_member() run for each member — full or, once it has
-- run once, incremental — purges and recreates flight consumption rows, so
-- it naturally backfills this field going forward. Until then, the
-- incremental planner's "unknown purchase" guard safely forces a full
-- recompute rather than risk an incorrect balance.
-- =============================================================================
BEGIN;

ALTER TABLE member_pack_consumptions
    ADD COLUMN IF NOT EXISTS purchase_entry_uuid UUID;

COMMENT ON COLUMN member_pack_consumptions.purchase_entry_uuid IS
  'Which specific pack purchase (VT accounting entry) this consumption was drawn from — disambiguates consecutive purchases of the same pack_definition_uuid (e.g. 2x25h). NULL for legacy rows.';

CREATE INDEX IF NOT EXISTS idx_mpc_purchase_entry
    ON member_pack_consumptions USING btree (purchase_entry_uuid);

COMMIT;
