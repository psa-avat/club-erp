-- 058: Add is_generic flag to vi_entitlements and create dedicated VI journal
-- is_generic marks catch-all placeholder vouchers that bypass reconciliation accounting.
-- The VI journal collects all VI accounting entries (Steps 1–4) in one auditable journal.

ALTER TABLE vi_entitlements
  ADD COLUMN is_generic BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN vi_entitlements.is_generic IS
  'When TRUE this voucher is a generic/placeholder; flights may reference it via vi_erp_id '
  'but it bypasses the individual flight-link and realization accounting workflow.';

INSERT INTO accounting_journals (uuid, code, name, type, is_active)
VALUES (gen_random_uuid(), 'VI', 'Journal des bons VI', 7, TRUE)
ON CONFLICT (code) DO NOTHING;
