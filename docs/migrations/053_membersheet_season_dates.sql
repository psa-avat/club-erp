-- ============================================================================
-- MIGRATION 053 : Add season_start_date and season_end_date to member_sheets
-- ============================================================================

ALTER TABLE public.member_sheets
    ADD COLUMN IF NOT EXISTS season_start_date DATE,
    ADD COLUMN IF NOT EXISTS season_end_date DATE;

COMMENT ON COLUMN public.member_sheets.season_start_date IS 'Début de validité de la licence GesAsso (seasonStartDate)';
COMMENT ON COLUMN public.member_sheets.season_end_date IS 'Fin de validité de la licence GesAsso (seasonEndDate) — badge Expirée si < aujourd''hui';
