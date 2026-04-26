-- Migration 007: Add use_pack flag to pricing_versions
-- Controls whether pack prices are active for a given pricing version.
-- Default TRUE preserves backward-compatible behavior for existing rows.

ALTER TABLE pricing_versions
    ADD COLUMN IF NOT EXISTS use_pack BOOLEAN NOT NULL DEFAULT TRUE;
