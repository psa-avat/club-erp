-- Migration 059: add CONVERTED (6) to vi_entitlements status check constraint
ALTER TABLE vi_entitlements
  DROP CONSTRAINT chk_vi_entitlements_status,
  ADD CONSTRAINT chk_vi_entitlements_status CHECK (status BETWEEN 1 AND 6);
