-- Migration 004: Redesign pricing item unit enum
--
-- Old values:  1=Hour, 2=Minute, 3=Launch, 4=Flight, 5=Fixed
-- New values:  1=FlightTime(h), 2=EngineTimeMinute, 3=EngineTime1/100h,
--              4=FlightDuration, 5=PerFlight, 6=Fixed
--
-- WARNING: existing rows must be remapped manually or via the UPDATE statements
-- below before the constraint is replaced.  Review the mapping carefully.
--
-- Suggested remapping from old to new:
--   old 1 (Hour)      -> new 1 (FlightTime)
--   old 2 (Minute)    -> new 2 (EngineTimeMinute)  -- or 4 (FlightDuration) — review per item
--   old 3 (Launch)    -> new 5 (PerFlight)          -- winch launches collapse into PerFlight
--   old 4 (Flight)    -> new 5 (PerFlight)
--   old 5 (Fixed)     -> new 6 (Fixed)
--
-- Adjust the UPDATE statements below to match your actual data.

BEGIN;

-- 1. Temporarily drop the old check constraint
ALTER TABLE pricing_items
    DROP CONSTRAINT IF EXISTS chk_pricing_items_unit;

-- 2. Remap existing rows (adjust as needed)
UPDATE pricing_items SET unit = 1 WHERE unit = 1;  -- Hour -> FlightTime (no-op, same value)
UPDATE pricing_items SET unit = 2 WHERE unit = 2;  -- Minute -> EngineTimeMinute (no-op)
UPDATE pricing_items SET unit = 5 WHERE unit = 3;  -- Launch -> PerFlight
UPDATE pricing_items SET unit = 5 WHERE unit = 4;  -- old Flight -> PerFlight (same value after shift)
UPDATE pricing_items SET unit = 6 WHERE unit = 5;  -- Fixed -> 6

-- 3. Add new check constraint accepting 1–6
ALTER TABLE pricing_items
    ADD CONSTRAINT chk_pricing_items_unit CHECK (unit IN (1, 2, 3, 4, 5, 6));

COMMIT;
