"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi service tests: code lock once an entitlement has been pushed to Planche
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 """
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

from fastapi import HTTPException

from schemas.vi import ViEntitlementUpdateRequest
from services.vi import update_vi_entitlement


class _FakeResult:
    def __init__(self, row=None):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class _FakeDb:
    def __init__(self, execute_results):
        self.execute_results = list(execute_results)

    async def execute(self, *_args, **_kwargs):
        return self.execute_results.pop(0)

    async def commit(self):
        pass

    async def refresh(self, *_args, **_kwargs):
        pass


def _fake_entitlement(*, code="VI2026-0001", planche_synced_at=None):
    return SimpleNamespace(
        uuid=uuid4(),
        code=code,
        vi_type_uuid=uuid4(),
        vi_type=None,
        description=None,
        scheduled_date=None,
        realisation_date=None,
        planche_synced_at=planche_synced_at,
    )


class ViEntitlementCodeLockTests(IsolatedAsyncioTestCase):
    async def test_code_change_rejected_once_synced_to_planche(self):
        row = _fake_entitlement(planche_synced_at=datetime.now(timezone.utc))
        db = _FakeDb(execute_results=[_FakeResult(row)])
        payload = ViEntitlementUpdateRequest(code="VI2026-9999")

        with self.assertRaises(HTTPException) as ctx:
            await update_vi_entitlement(db, row.uuid, payload, user_id=None)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(row.code, "VI2026-0001")

    async def test_unchanged_code_allowed_even_when_synced(self):
        row = _fake_entitlement(planche_synced_at=datetime.now(timezone.utc))
        db = _FakeDb(execute_results=[_FakeResult(row), _FakeResult(None)])
        payload = ViEntitlementUpdateRequest(code=row.code)

        result = await update_vi_entitlement(db, row.uuid, payload, user_id=None)
        self.assertEqual(result.code, row.code)

    async def test_code_change_allowed_when_not_synced(self):
        row = _fake_entitlement(planche_synced_at=None)
        db = _FakeDb(execute_results=[_FakeResult(row), _FakeResult(None)])
        payload = ViEntitlementUpdateRequest(code="VI2026-9999")

        result = await update_vi_entitlement(db, row.uuid, payload, user_id=None)
        self.assertEqual(result.code, "VI2026-9999")
