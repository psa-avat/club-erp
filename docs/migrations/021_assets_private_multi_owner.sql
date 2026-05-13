-- ERP-CLUB - ERP pour Club de vol à voile
-- Logiciel libre de gestion d'un club de vol à voile
-- assets: add current multi-owner support for private assets
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

CREATE TABLE IF NOT EXISTS asset_private_owners (
    asset_uuid UUID NOT NULL REFERENCES assets(uuid) ON DELETE CASCADE,
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT pk_asset_private_owners PRIMARY KEY (asset_uuid, member_uuid)
);

CREATE INDEX IF NOT EXISTS ix_asset_private_owners_member_uuid
    ON asset_private_owners(member_uuid);

INSERT INTO asset_private_owners (asset_uuid, member_uuid)
SELECT assets.uuid, assets.owner_member_uuid
FROM assets
WHERE assets.ownership = 2
  AND assets.owner_member_uuid IS NOT NULL
ON CONFLICT (asset_uuid, member_uuid) DO NOTHING;

COMMIT;
