-- ERP-CLUB - ERP pour Club de vol à voile
-- Logiciel libre de gestion d'un club de vol à voile
-- assets: drop legacy single-owner column after multi-owner migration
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

DROP INDEX IF EXISTS ix_assets_owner_member;
DROP INDEX IF EXISTS idx_assets_owner_member_uuid;
ALTER TABLE assets DROP COLUMN IF EXISTS owner_member_uuid;

COMMIT;
