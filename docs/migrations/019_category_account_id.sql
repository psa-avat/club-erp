-- ERP-CLUB - ERP pour Club de vol à voile 
-- Migration 019: Category-aware member account_id generation
-- Copyright (C) 2026  SAFORCADA Patrick
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This migration updates the member account_id generation to use category-specific prefixes (MEYYYY-XXXX, EXT-XXXX, FO-XXXX),
-- and ensures the trigger and constraints are in place.

BEGIN;

-- 1. Create or update the member_account_counters table
CREATE TABLE IF NOT EXISTS member_account_counters (
  counter_key VARCHAR(16) PRIMARY KEY,
  account_prefix VARCHAR(8) NOT NULL,
  account_year SMALLINT,
  next_value INTEGER NOT NULL CHECK (next_value >= 1)
);

-- 2. Replace the account id generator function
CREATE OR REPLACE FUNCTION generate_member_account_id(member_category SMALLINT)
RETURNS VARCHAR(32)
LANGUAGE plpgsql
AS $$
DECLARE
  current_year SMALLINT := EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT;
  counter_key VARCHAR(16);
  account_prefix VARCHAR(8);
  counter_year SMALLINT;
  allocated_value INTEGER;
BEGIN
  IF member_category IN (5, 7) THEN
    account_prefix := 'EXT-';
    counter_year := NULL;
    counter_key := 'EXT';
  ELSIF member_category = 8 THEN
    account_prefix := 'FO-';
    counter_year := NULL;
    counter_key := 'FO';
  ELSE
    account_prefix := format('ME%s-', current_year);
    counter_year := current_year;
    counter_key := format('ME-%s', current_year);
  END IF;

  INSERT INTO member_account_counters (counter_key, account_prefix, account_year, next_value)
  VALUES (counter_key, account_prefix, counter_year, 2)
  ON CONFLICT (counter_key)
  DO UPDATE
  SET next_value = member_account_counters.next_value + 1
  RETURNING next_value - 1 INTO allocated_value;

  RETURN format('%s%s', account_prefix, lpad(allocated_value::TEXT, 4, '0'));
END;
$$;

-- 3. Replace the trigger function for account_id assignment
CREATE OR REPLACE FUNCTION set_member_account_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id IS NULL OR btrim(NEW.account_id) = '' THEN
    NEW.account_id := generate_member_account_id(NEW.member_category);
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Update the constraint on members.account_id (format)
ALTER TABLE members
  DROP CONSTRAINT IF EXISTS chk_members_account_id_format;
ALTER TABLE members
  ADD CONSTRAINT chk_members_account_id_format
    CHECK (account_id ~ '^(ME[0-9]{4}-[0-9]{4}|EXT-[0-9]{4}|FO-[0-9]{4})$');

-- 5. Drop and recreate the trigger for account_id assignment
DROP TRIGGER IF EXISTS trg_members_set_account_id ON members;
CREATE TRIGGER trg_members_set_account_id
BEFORE INSERT ON members
FOR EACH ROW
EXECUTE FUNCTION set_member_account_id();

COMMIT;
