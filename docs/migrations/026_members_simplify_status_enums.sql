-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 026: Simplify members status enums (status: 1..3, registration_status: 1..2)
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Mapping applied on existing data:
-- members.status:
--   1 -> 1 (Active)
--   2 -> 2 (Suspended)
--   3 -> 3 (Resigned -> Anonymized)
--   4 -> 3 (Anonymized)
-- members.registration_status:
--   1 -> 1 (Pending)
--   2 -> 1 (Pending)
--   3 -> 2 (Completed)
--   4 -> 1 (Pending)

BEGIN;

-- Normalize data first so new constraints can be applied safely.
UPDATE members
SET status = CASE
    WHEN status = 1 THEN 1
    WHEN status = 2 THEN 2
    WHEN status IN (3, 4) THEN 3
    ELSE 3
END
WHERE status IS DISTINCT FROM CASE
    WHEN status = 1 THEN 1
    WHEN status = 2 THEN 2
    WHEN status IN (3, 4) THEN 3
    ELSE 3
END;

UPDATE members
SET registration_status = CASE
    WHEN registration_status = 3 THEN 2
    WHEN registration_status IN (1, 2, 4) THEN 1
    ELSE 1
END
WHERE registration_status IS DISTINCT FROM CASE
    WHEN registration_status = 3 THEN 2
    WHEN registration_status IN (1, 2, 4) THEN 1
    ELSE 1
END;

-- Rebuild constraints.
ALTER TABLE members
  DROP CONSTRAINT IF EXISTS chk_members_status;

ALTER TABLE members
  ADD CONSTRAINT chk_members_status
  CHECK (status BETWEEN 1 AND 3);

ALTER TABLE members
  DROP CONSTRAINT IF EXISTS chk_members_registration_status;

ALTER TABLE members
  ADD CONSTRAINT chk_members_registration_status
  CHECK (registration_status BETWEEN 1 AND 2);

COMMIT;
