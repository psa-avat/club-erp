-- 069_bank_reconciliation.sql
-- Bank/cash statement import, matching, and reconciliation.
-- Scope: journals of type IN (3, 4) (Banque / Caisse) only.
-- accounting_lines is NOT modified — reconciliation state lives entirely in
-- bank_statement_lines (posted-entry immutability, no composite-FK juggling).

-- ============================================================
-- 1. Statements
-- ============================================================
CREATE TABLE bank_statements (
    uuid                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fiscal_year_uuid       UUID NOT NULL REFERENCES accounting_fiscal_years(uuid) ON DELETE CASCADE,
    -- journal_uuid must reference a journal of type 3 (Banque) or 4 (Caisse)
    -- account_uuid is the bank/cash GL account line to reconcile against
    journal_uuid           UUID NOT NULL REFERENCES accounting_journals(uuid),
    account_uuid           UUID NOT NULL REFERENCES accounting_accounts(uuid),
    import_date            TIMESTAMPTZ NOT NULL DEFAULT now(),
    statement_date         DATE NOT NULL,
    statement_period_start DATE,
    statement_period_end   DATE,
    source_format          VARCHAR(8) NOT NULL,  -- v1: 'ofx' | 'csv' ; v2: 'qif' | 'mt940'
    raw_filename           VARCHAR(255),
    raw_content_hash       VARCHAR(64),          -- SHA-256, de-duplication
    opening_balance        NUMERIC(10,4) DEFAULT 0,
    closing_balance        NUMERIC(10,4) DEFAULT 0,
    total_debits           NUMERIC(10,4) DEFAULT 0,
    total_credits          NUMERIC(10,4) DEFAULT 0,
    line_count             INTEGER DEFAULT 0,
    -- Statuses: imported | matching | reconciled | flagged
    -- 'flagged' is set automatically by detect_discrepancies()
    status                 VARCHAR(16) NOT NULL DEFAULT 'imported',
    reconciled_balance     NUMERIC(10,4),
    balance_difference     NUMERIC(10,4),
    reconciled_at          TIMESTAMPTZ,
    reconciled_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by             INTEGER NOT NULL REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_bank_statement_source_format CHECK (source_format IN ('ofx', 'qfx', 'csv', 'qif', 'mt940')),
    CONSTRAINT chk_bank_statement_status CHECK (status IN ('imported', 'matching', 'reconciled', 'flagged'))
);

CREATE INDEX idx_bank_statements_fy      ON bank_statements(fiscal_year_uuid);
CREATE INDEX idx_bank_statements_journal ON bank_statements(journal_uuid);
CREATE INDEX idx_bank_statements_account ON bank_statements(account_uuid);
CREATE INDEX idx_bank_statements_status  ON bank_statements(status);
CREATE INDEX idx_bank_statements_hash    ON bank_statements(raw_content_hash)
    WHERE raw_content_hash IS NOT NULL;

-- ============================================================
-- 2. Statement lines
-- ============================================================
-- Reconciliation state lives entirely here. accounting_lines is NOT touched:
--   - preserves immutability of posted entries
--   - avoids state duplication
--   - avoids a composite FK (accounting_entries has a composite PK)
-- Cardinality: 1-to-1 by default (sufficient for this club's flows)
-- ============================================================
CREATE TABLE bank_statement_lines (
    uuid                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_uuid           UUID NOT NULL REFERENCES bank_statements(uuid) ON DELETE CASCADE,
    line_index               INTEGER NOT NULL DEFAULT 0,
    line_date                DATE NOT NULL,
    description              TEXT,
    amount                   NUMERIC(10,4) NOT NULL,  -- positive = credit, negative = debit
    reference                VARCHAR(255),
    counterparty             VARCHAR(255),
    bank_raw_data            JSONB,                    -- raw OFX data (FITID, etc.)
    -- Statuses: unmatched | auto_matched | manually_matched | excluded | discrepancy
    match_status             VARCHAR(20) NOT NULL DEFAULT 'unmatched',
    -- Reference to the GL entry — no DB FK (accounting_entries has a composite PK)
    -- Same pattern as reversal_of_entry_uuid elsewhere in this project.
    matched_entry_uuid       UUID,
    matched_fiscal_year_uuid UUID,
    match_confidence         NUMERIC(4,3),
    discrepancy_type         VARCHAR(32),
    discrepancy_notes        TEXT,
    resolved_at              TIMESTAMPTZ,
    resolved_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_bank_lines_match_status CHECK (
        match_status IN ('unmatched', 'auto_matched', 'manually_matched', 'excluded', 'discrepancy')
    ),
    CONSTRAINT chk_bank_lines_discrepancy_type CHECK (
        discrepancy_type IS NULL
        OR discrepancy_type IN ('missing_entry', 'amount_variance', 'timing', 'duplicate')
    )
);

CREATE INDEX idx_bank_lines_statement     ON bank_statement_lines(statement_uuid);
CREATE INDEX idx_bank_lines_status        ON bank_statement_lines(match_status);
CREATE INDEX idx_bank_lines_matched_entry ON bank_statement_lines(matched_entry_uuid)
    WHERE matched_entry_uuid IS NOT NULL;
CREATE INDEX idx_bank_lines_date_amount   ON bank_statement_lines(line_date, amount);

-- Invariant v1: a posted GL entry can be reconciled at most once.
-- If n-to-m matching becomes a requirement, replace this index with a join table.
CREATE UNIQUE INDEX uq_bank_lines_one_match_per_entry
    ON bank_statement_lines(matched_entry_uuid, matched_fiscal_year_uuid)
    WHERE matched_entry_uuid IS NOT NULL
      AND match_status IN ('auto_matched', 'manually_matched');

-- ============================================================
-- 3. Per-user saved CSV column mappings
-- date_format is explicit: guards against day/month inversion (historical bug)
-- ============================================================
CREATE TABLE bank_csv_mappings (
    uuid           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(100) NOT NULL,
    created_by     INTEGER NOT NULL REFERENCES users(id),
    column_mapping JSONB NOT NULL,
    separator      VARCHAR(4),
    encoding       VARCHAR(16),
    date_format    VARCHAR(16) NOT NULL DEFAULT 'DD/MM/YYYY',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_csv_mappings_created_by ON bank_csv_mappings(created_by);
