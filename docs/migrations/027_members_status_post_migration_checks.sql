-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 027: Post-migration verification checks for members status simplification
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Purpose:
-- - Validate that members.status only uses 1..3.
-- - Validate that members.registration_status only uses 1..2.
-- - Validate that permanent categories (5,7,8) have no member_registrations rows.
--
-- This script is read-only and raises an exception if any check fails.

BEGIN;

DO $$
DECLARE
    invalid_member_status_count INTEGER;
    invalid_registration_status_count INTEGER;
    permanent_registration_rows_count INTEGER;
BEGIN
    SELECT COUNT(*)
      INTO invalid_member_status_count
      FROM members
     WHERE status NOT BETWEEN 1 AND 3;

    IF invalid_member_status_count > 0 THEN
        RAISE EXCEPTION
            'Verification failed: % members rows have invalid status values (expected 1..3)',
            invalid_member_status_count
            USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*)
      INTO invalid_registration_status_count
      FROM members
     WHERE registration_status NOT BETWEEN 1 AND 2;

    IF invalid_registration_status_count > 0 THEN
        RAISE EXCEPTION
            'Verification failed: % members rows have invalid registration_status values (expected 1..2)',
            invalid_registration_status_count
            USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*)
      INTO permanent_registration_rows_count
      FROM member_registrations mr
      JOIN members m ON m.uuid = mr.member_uuid
     WHERE m.member_category IN (5, 7, 8);

    IF permanent_registration_rows_count > 0 THEN
        RAISE EXCEPTION
            'Verification failed: % member_registrations rows still exist for permanent categories (5,7,8)',
            permanent_registration_rows_count
            USING ERRCODE = '23514';
    END IF;
END $$;

-- Human-readable summary for deployment logs.
SELECT
    (SELECT COUNT(*) FROM members) AS members_total,
    (SELECT COUNT(*) FROM members WHERE status BETWEEN 1 AND 3) AS members_valid_status,
    (SELECT COUNT(*) FROM members WHERE registration_status BETWEEN 1 AND 2) AS members_valid_registration_status,
    (SELECT COUNT(*)
       FROM member_registrations mr
       JOIN members m ON m.uuid = mr.member_uuid
      WHERE m.member_category IN (5, 7, 8)) AS permanent_category_registration_rows;

COMMIT;
