-- Migration 078: Track the specific AccountingLine a BankStatementLine is matched to.
--
-- Bug: the bank reconciliation matching engine (services/bank_reconciliation.py) treated
-- a whole AccountingEntry as the matchable unit. An entry with several lines on the
-- reconciled account (e.g. a payroll entry posting multiple distinct 512 "Banque"
-- withdrawals: several acomptes + a complement) could only ever be matched to ONE bank
-- statement line — the other real bank movements belonging to the same entry could never
-- find a match, leaving the statement permanently unbalanced.
--
-- Fix: matching now operates per AccountingLine instead of per AccountingEntry.
-- bank_statement_lines.matched_line_uuid records exactly which line of the matched entry
-- was reconciled, so an entry with N lines on the statement's account can satisfy N
-- different statement lines. No DB FK: accounting_lines has a composite primary key
-- (uuid, fiscal_year_uuid) — same reasoning as the existing matched_entry_uuid column.

ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS matched_line_uuid UUID NULL;
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_matched_line_uuid ON bank_statement_lines (matched_line_uuid);

-- Backfill: for statement lines already locked (auto_matched/manually_matched) against
-- an entry before this migration, pick a deterministic line of that entry on the
-- statement's account (the old code always matched using the first 512 line it found).
-- For the common case of a single 512 line per entry this is exact; for the rare
-- already-affected multi-line case it is a best-effort assignment of one specific line.
UPDATE bank_statement_lines bsl
SET matched_line_uuid = al.uuid
FROM accounting_lines al
JOIN bank_statements bs ON bs.uuid = bsl.statement_uuid
WHERE bsl.matched_entry_uuid = al.entry_uuid
  AND bsl.matched_fiscal_year_uuid = al.fiscal_year_uuid
  AND al.account_uuid = bs.account_uuid
  AND bsl.matched_line_uuid IS NULL
  AND bsl.match_status IN ('auto_matched', 'manually_matched')
  AND al.uuid = (
    SELECT al2.uuid FROM accounting_lines al2
    WHERE al2.entry_uuid = al.entry_uuid AND al2.fiscal_year_uuid = al.fiscal_year_uuid
      AND al2.account_uuid = bs.account_uuid
    ORDER BY al2.uuid
    LIMIT 1
  );
