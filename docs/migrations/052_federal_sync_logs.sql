-- ============================================================================
-- MIGRATION 052 : Federal sync logs table
-- ============================================================================

-- 1. Nouvelle table de logs de synchronisation fédérale
CREATE TABLE public.federal_sync_logs (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    validated_flight_uuid UUID NOT NULL REFERENCES public.validated_flights(uuid) ON DELETE CASCADE,
    platform VARCHAR(16) NOT NULL,
    status SMALLINT NOT NULL DEFAULT 0,
    external_id VARCHAR(64),
    attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT chk_fsl_platform CHECK (platform IN ('gesasso', 'osrt')),
    CONSTRAINT chk_fsl_status CHECK (status IN (0, 1, 2, 3, 4))
);

COMMENT ON TABLE public.federal_sync_logs IS 'Historique des tentatives de synchronisation fédérale (GesAsso, OSRT, …)';
COMMENT ON COLUMN public.federal_sync_logs.status IS '0=pas envoyé, 1=en attente, 2=succès, 3=échec, 4=exclu';
COMMENT ON COLUMN public.federal_sync_logs.external_id IS 'ID du vol côté plateforme (gesasso_id / osrt_id)';

-- 2. Index pour le dashboard (vols en attente ou en échec par plateforme)
CREATE INDEX idx_fsl_sync_queue
    ON public.federal_sync_logs (platform, status)
    WHERE status IN (1, 3);

-- 3. Index pour retrouver rapidement le dernier statut d'un vol sur une plateforme
CREATE INDEX idx_fsl_flight_platform_attempt
    ON public.federal_sync_logs (validated_flight_uuid, platform, attempt_at DESC);

-- 4. Vue pratique : dernier statut connu par vol × plateforme
CREATE VIEW public.federal_sync_status AS
SELECT DISTINCT ON (validated_flight_uuid, platform)
    validated_flight_uuid,
    platform,
    status,
    external_id,
    attempt_at AS last_attempt_at
FROM public.federal_sync_logs
ORDER BY validated_flight_uuid, platform, attempt_at DESC;

COMMENT ON VIEW public.federal_sync_status IS 'Dernier statut de synchronisation par vol et par plateforme (utilisé par le dashboard)';
