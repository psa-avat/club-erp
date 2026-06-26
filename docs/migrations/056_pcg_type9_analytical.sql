-- Migration 056: Allow PCG account type 9 (Comptes de comptabilité analytique)
--
-- The chk_account_type constraint previously allowed types 1–5 only
-- (Asset, Liability, Equity, Expense, Revenue).  Class 9 accounts
-- (comptabilité analytique / coûts de revient) are now supported.

ALTER TABLE accounting_accounts
    DROP CONSTRAINT chk_account_type,
    ADD CONSTRAINT chk_account_type CHECK (type IN (1, 2, 3, 4, 5, 9));
