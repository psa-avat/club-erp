-- Migration 015: extend registration_type check constraint to 1-7
-- registration_type mirrors member_category which was extended to 7
-- in migration 012 (external organization category), but the corresponding
-- constraint on member_registrations was not updated at the time.

ALTER TABLE member_registrations
  DROP CONSTRAINT IF EXISTS chk_member_registrations_type;

ALTER TABLE member_registrations
  ADD CONSTRAINT chk_member_registrations_type
    CHECK (registration_type BETWEEN 1 AND 7);
