-- Migration 068: Add planche_synced_at to vi_entitlements
-- Tracks the last successful push to Planche. Once set, the entitlement's
-- `code` is locked in the API since it is the join key sent to Planche
-- (erp_id) — changing it after a push would desync the ERP and Planche records.

ALTER TABLE vi_entitlements
    ADD COLUMN IF NOT EXISTS planche_synced_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN vi_entitlements.planche_synced_at IS
    'Timestamp of the last successful push to Planche. Once set, code is locked (it is the Planche join key).';
