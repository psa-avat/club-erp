-- 070_cheque_remittances.sql
-- Cheque receipt + "remise de chèque" (deposit batch) tracking.
-- accounting_lines/accounting_entries are NOT modified — which cheque-receipt
-- entries were consumed by a deposit lives entirely in cheque_remittance_lines,
-- same pattern as bank_statement_lines (posted-entry immutability, no
-- composite-FK juggling against accounting_entries' composite PK).

-- ============================================================
-- 1. Remittances (deposit batches)
-- ============================================================
CREATE TABLE cheque_remittances (
    uuid               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fiscal_year_uuid   UUID NOT NULL REFERENCES accounting_fiscal_years(uuid) ON DELETE CASCADE,
    remittance_date    DATE NOT NULL,
    -- The generated deposit entry (debit bank / credit pending cheques account).
    -- No DB FK — accounting_entries has a composite PK (uuid, fiscal_year_uuid),
    -- same pattern as reversal_of_entry_uuid / matched_entry_uuid elsewhere.
    deposit_entry_uuid UUID NOT NULL,
    total_amount       NUMERIC(10,4) NOT NULL,
    created_by         INTEGER NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cheque_remittances_fy ON cheque_remittances(fiscal_year_uuid);
CREATE INDEX idx_cheque_remittances_deposit_entry ON cheque_remittances(deposit_entry_uuid);

-- ============================================================
-- 2. Remittance lines — one row per cheque-receipt entry consumed
-- (entry-granularity, not line-granularity: each cheque is its own
-- 2-line accounting entry, so "picking a cheque" means picking an entry)
-- ============================================================
CREATE TABLE cheque_remittance_lines (
    uuid                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remittance_uuid          UUID NOT NULL REFERENCES cheque_remittances(uuid) ON DELETE CASCADE,
    source_entry_uuid        UUID NOT NULL,  -- no DB FK, see cheque_remittances.deposit_entry_uuid
    source_fiscal_year_uuid  UUID NOT NULL,
    amount                   NUMERIC(10,4) NOT NULL
);

CREATE INDEX idx_cheque_remittance_lines_remittance ON cheque_remittance_lines(remittance_uuid);
CREATE INDEX idx_cheque_remittance_lines_source_entry ON cheque_remittance_lines(source_entry_uuid);

-- Invariant: a cheque-receipt entry can be included in at most one remittance.
CREATE UNIQUE INDEX uq_cheque_remittance_lines_source_entry
    ON cheque_remittance_lines(source_entry_uuid, source_fiscal_year_uuid);
