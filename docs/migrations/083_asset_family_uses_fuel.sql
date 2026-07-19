-- 083_asset_family_uses_fuel.sql
-- Add uses_fuel flag on asset_families: marks families whose assets consume fuel
-- (tow planes, ULMs, …). Used to scope the Carburant module's asset picker to
-- fuel-consuming equipment only. Defaults to false; toggle per family in the
-- Asset Families admin screen.

ALTER TABLE asset_families
    ADD COLUMN uses_fuel BOOLEAN NOT NULL DEFAULT false;
