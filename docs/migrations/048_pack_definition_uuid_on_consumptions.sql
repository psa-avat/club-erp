-- Migration 048: Add pack_definition_uuid to member_pack_consumptions
--
-- Allows tracking which specific pack definition each consumption line
-- belongs to, enabling multi-pack sequencing (use first pack, then second, etc.).

ALTER TABLE member_pack_consumptions
    ADD COLUMN IF NOT EXISTS pack_definition_uuid UUID
        REFERENCES pack_definitions(uuid) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mpc_pack_definition
    ON member_pack_consumptions(pack_definition_uuid);

COMMENT ON COLUMN member_pack_consumptions.pack_definition_uuid IS
    'Which pack definition this consumption was applied to. NULL for legacy rows.';
