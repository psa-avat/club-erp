-- Migration 064: Add insurance_amount_override to vi_entitlements
-- Allows per-entitlement override of vi_type.insurance_amount for realization entries.

ALTER TABLE vi_entitlements
    ADD COLUMN IF NOT EXISTS insurance_amount_override NUMERIC(10, 4) NULL;

COMMENT ON COLUMN vi_entitlements.insurance_amount_override IS
    'Per-entitlement insurance override. When set, supersedes vi_type.insurance_amount for realization.';
