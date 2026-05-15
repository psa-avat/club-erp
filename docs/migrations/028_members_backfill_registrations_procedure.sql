-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 028: Add reusable procedure to backfill member_registrations from members.last_registration_date
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Purpose:
-- - Provide a reusable stored procedure to create member_registrations periods
--   for eligible members based on last_registration_date.
-- - Set member_registrations.start_date from members.last_registration_date.
-- - Exclude permanent categories (5, 7, 8) to comply with business rules.
-- - Be safe on reruns via ON CONFLICT DO NOTHING.

BEGIN;

CREATE OR REPLACE PROCEDURE backfill_member_registrations_from_last_date(
    p_year SMALLINT,
    p_status SMALLINT DEFAULT 1,
    p_notes TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    inserted_count INTEGER;
    v_end_date DATE;
    v_threshold_date DATE;
BEGIN
    IF p_year < 2000 OR p_year > 9999 THEN
        RAISE EXCEPTION
            'Invalid year: % (expected 2000..9999)',
            p_year
            USING ERRCODE = '23514';
    END IF;

    IF p_status < 1 OR p_status > 3 THEN
        RAISE EXCEPTION
            'Invalid status: % (expected 1..3)',
            p_status
            USING ERRCODE = '23514';
    END IF;

    -- Validity rule for year YYYY:
    -- threshold = (YYYY - 1)-10-01, end = YYYY-12-31.
    -- start_date is each member last_registration_date.
    v_threshold_date := make_date(p_year - 1, 10, 1);
    v_end_date := make_date(p_year, 12, 31);

    INSERT INTO member_registrations (
        member_uuid,
        start_date,
        end_date,
        registered_for_year,
        registration_type,
        status,
        notes
    )
    SELECT
        m.uuid,
                m.last_registration_date,
                v_end_date,
                p_year,
        m.member_category,
        p_status,
        p_notes
    FROM members m
        WHERE m.last_registration_date IS NOT NULL
            AND m.last_registration_date > v_threshold_date
      AND m.member_category NOT IN (5, 7, 8)
    ON CONFLICT (member_uuid, start_date, end_date) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    RAISE NOTICE
        'backfill_member_registrations_from_last_date inserted % row(s) for year % (start=member.last_registration_date, end %, threshold: %)',
        inserted_count,
        p_year,
        v_end_date,
        v_threshold_date;
END;
$$;

-- Example usage for current campaign:
-- CALL backfill_member_registrations_from_last_date(
--     2026,
--     1,
--     'Backfill after import for year 2026'
-- );
--
-- Optional checks:
-- SELECT COUNT(*)
--   FROM members m
--  WHERE m.last_registration_date > DATE '2025-10-01'
--    AND m.member_category NOT IN (5, 7, 8);
--
-- SELECT COUNT(*)
--   FROM member_registrations mr
--  WHERE mr.start_date > DATE '2025-10-01'
--    AND mr.end_date = DATE '2026-12-31'
--    AND mr.registered_for_year = 2026;

COMMIT;
