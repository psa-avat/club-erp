-- =============================================================================
-- Migration 049: Recurring Entries Scheduling & Formula Types
--
-- Extends accounting_entry_templates with scheduling fields and
-- accounting_entry_template_lines with formula types for dynamic calculation.
--
-- Changes:
--   1. Add scheduling columns to accounting_entry_templates
--      (valid_from, valid_until, next_scheduled_date, last_generated_at,
--       last_generated_entry_uuid)
--   2. Add formula columns to accounting_entry_template_lines
--      (formula_type, formula_params)
--   3. Create scheduler_locks table for concurrency guard
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Scheduling columns on accounting_entry_templates
-- =============================================================================

ALTER TABLE accounting_entry_templates
    ADD COLUMN IF NOT EXISTS valid_from             DATE,
    ADD COLUMN IF NOT EXISTS valid_until            DATE,
    ADD COLUMN IF NOT EXISTS next_scheduled_date    DATE,
    ADD COLUMN IF NOT EXISTS last_generated_at      TIMESTAMPTZ,
    -- Référence applicative — pas de FK DB car PK composite sur accounting_entries
    ADD COLUMN IF NOT EXISTS last_generated_entry_uuid UUID;

CREATE INDEX IF NOT EXISTS idx_entry_templates_scheduled
    ON accounting_entry_templates(next_scheduled_date)
    WHERE is_active = true AND next_scheduled_date IS NOT NULL;

COMMENT ON COLUMN accounting_entry_templates.valid_from
    IS 'Date à partir de laquelle le modèle est applicable (inclusive)';
COMMENT ON COLUMN accounting_entry_templates.valid_until
    IS 'Date jusqu''à laquelle le modèle est applicable (inclusive)';
COMMENT ON COLUMN accounting_entry_templates.next_scheduled_date
    IS 'Prochaine date d''échéance calculée après la dernière génération';
COMMENT ON COLUMN accounting_entry_templates.last_generated_at
    IS 'Horodatage de la dernière génération';
COMMENT ON COLUMN accounting_entry_templates.last_generated_entry_uuid
    IS 'UUID de la dernière écriture générée (référence applicative, pas de FK)';

-- =============================================================================
-- 2. Formula columns on accounting_entry_template_lines
-- =============================================================================

ALTER TABLE accounting_entry_template_lines
    ADD COLUMN IF NOT EXISTS formula_type   VARCHAR(16) NOT NULL DEFAULT 'fixed',
    ADD COLUMN IF NOT EXISTS formula_params JSONB;

-- Drop existing check constraint if it exists before recreating it
ALTER TABLE accounting_entry_template_lines
    DROP CONSTRAINT IF EXISTS chk_template_line_formula_type;

ALTER TABLE accounting_entry_template_lines
    ADD CONSTRAINT chk_template_line_formula_type
    CHECK (formula_type IN ('fixed', 'percentage', 'previous_period', 'rounding_adjustment'));

-- Assouplir la contrainte de montant (calculé au runtime pour rounding_adjustment)
ALTER TABLE accounting_entry_template_lines
    DROP CONSTRAINT IF EXISTS chk_entry_template_line_at_least_one_amount;

ALTER TABLE accounting_entry_template_lines
    ADD CONSTRAINT chk_entry_template_line_at_least_one_amount
    CHECK (formula_type = 'rounding_adjustment' OR debit > 0 OR credit > 0);

COMMENT ON COLUMN accounting_entry_template_lines.formula_type
    IS 'Type de calcul : fixed, percentage, previous_period, rounding_adjustment';
COMMENT ON COLUMN accounting_entry_template_lines.formula_params
    IS 'Paramètres JSON pour le calcul (ex: {"percentage": 20, "source_line_index": 0})';

-- =============================================================================
-- 3. Lock distribué pour éviter les doublons de génération
-- =============================================================================

CREATE TABLE IF NOT EXISTS scheduler_locks (
    job_id    VARCHAR(64) PRIMARY KEY,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by VARCHAR(128)   -- hostname du process ou identifiant applicatif
);

COMMENT ON TABLE scheduler_locks
    IS 'Verrou distribué pour protéger la génération manuelle contre les doubles-clics';

COMMIT;
