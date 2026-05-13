-- ERP-CLUB - ERP pour Club de vol à voile
-- Logiciel libre de gestion d'un club de vol à voile
-- assets: add status 5 (Sold) to assets and asset_status_history constraints
-- Copyright (C) 2026  SAFORCADA Patrick
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

BEGIN;

-- Expand allowed asset statuses to include 5=Sold.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS chk_asset_status;
ALTER TABLE assets DROP CONSTRAINT IF EXISTS chk_assets_status;
ALTER TABLE assets
    ADD CONSTRAINT chk_asset_status CHECK (status IN (1, 2, 3, 4, 5));

-- Expand status history constraint accordingly.
ALTER TABLE asset_status_history DROP CONSTRAINT IF EXISTS chk_asset_sh_status;
ALTER TABLE asset_status_history
    ADD CONSTRAINT chk_asset_sh_status CHECK (status IN (1, 2, 3, 4, 5));

COMMIT;
