-- Migration 016: extend member_category and registration_type to allow value 8
-- 8 = Client / Supplier

ALTER TABLE members
  DROP CONSTRAINT IF EXISTS chk_members_category;

ALTER TABLE members
  ADD CONSTRAINT chk_members_category
    CHECK (member_category BETWEEN 1 AND 8);

ALTER TABLE member_registrations
  DROP CONSTRAINT IF EXISTS chk_member_registrations_type;

ALTER TABLE member_registrations
  ADD CONSTRAINT chk_member_registrations_type
    CHECK (registration_type BETWEEN 1 AND 8);