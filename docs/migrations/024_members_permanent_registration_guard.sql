-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 024: Prevent dated registrations for permanent member categories (5, 7, 8)
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Business rule:
-- - Categories 5, 7, 8 are permanent members.
-- - They are managed through members.status and members.registration_status,
--   without member_registrations periods.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_permanent_member_registrations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    current_category SMALLINT;
BEGIN
    SELECT member_category
      INTO current_category
      FROM members
     WHERE uuid = NEW.member_uuid;

    IF current_category IN (5, 7, 8) THEN
        RAISE EXCEPTION
            'Permanent members (categories 5, 7, 8) are managed from the edit screen and do not use annual registration periods'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_registrations_reject_permanent_categories ON member_registrations;

CREATE TRIGGER trg_member_registrations_reject_permanent_categories
BEFORE INSERT OR UPDATE OF member_uuid, registration_type
ON member_registrations
FOR EACH ROW
EXECUTE FUNCTION prevent_permanent_member_registrations();

COMMIT;
