-- ============================================================================
-- MIGRATION 054 : Add osrt_sync_enabled flag to assets
-- ============================================================================

ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS osrt_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.assets.osrt_sync_enabled IS 'Opt-in pour la déclaration des activités machine vers OSRT. FALSE par défaut (aucun envoi).';
