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
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

from fastapi import HTTPException

from schemas.vi import ViEntitlementUpdateRequest
from services.vi import patch_vi_realisation_date, patch_vi_scheduled_date, update_vi_entitlement


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


def _fake_entitlement(
    *,
    code="VI2026-0001",
    planche_synced_at=None,
    status=2,
    scheduled_date=None,
    realisation_date=None,
    validity_date=None,
):
    return SimpleNamespace(
        uuid=uuid4(),
        code=code,
        vi_type_uuid=uuid4(),
        vi_type=None,
        description=None,
        scheduled_date=scheduled_date,
        realisation_date=realisation_date,
        validity_date=validity_date,
        planche_synced_at=planche_synced_at,
        status=status,
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


class ViEntitlementRescheduleLockTests(IsolatedAsyncioTestCase):
    async def test_generic_patch_rejects_reschedule_once_realized(self):
        row = _fake_entitlement(status=3, scheduled_date=date(2026, 7, 1))
        db = _FakeDb(execute_results=[_FakeResult(row)])
        payload = ViEntitlementUpdateRequest(scheduled_date=date(2026, 7, 15))

        with self.assertRaises(HTTPException) as ctx:
            await update_vi_entitlement(db, row.uuid, payload, user_id=None)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(row.scheduled_date, date(2026, 7, 1))

    async def test_generic_patch_allows_same_date_once_realized(self):
        row = _fake_entitlement(status=3, scheduled_date=date(2026, 7, 1))
        db = _FakeDb(execute_results=[_FakeResult(row)])
        payload = ViEntitlementUpdateRequest(scheduled_date=date(2026, 7, 1))

        result = await update_vi_entitlement(db, row.uuid, payload, user_id=None)
        self.assertEqual(result.scheduled_date, date(2026, 7, 1))

    async def test_generic_patch_allows_reschedule_when_not_realized(self):
        row = _fake_entitlement(status=2, scheduled_date=date(2026, 7, 1))
        db = _FakeDb(execute_results=[_FakeResult(row)])
        payload = ViEntitlementUpdateRequest(scheduled_date=date(2026, 7, 15))

        result = await update_vi_entitlement(db, row.uuid, payload, user_id=None)
        self.assertEqual(result.scheduled_date, date(2026, 7, 15))

    async def test_dedicated_scheduled_date_endpoint_rejects_once_realized(self):
        row = _fake_entitlement(status=3, scheduled_date=date(2026, 7, 1))
        db = _FakeDb(execute_results=[_FakeResult(row)])

        with self.assertRaises(HTTPException) as ctx:
            await patch_vi_scheduled_date(db, row.uuid, date(2026, 7, 20), user_id=None)
        self.assertEqual(ctx.exception.status_code, 409)


class ViEntitlementArchiveValidityDateTests(IsolatedAsyncioTestCase):
    async def test_archiving_uses_linked_flight_date_not_archiving_date(self):
        # Archived today (2026-07-01, the date passed by the "Archiver le bon" button)
        # but the actual flight took place on 2026-06-15 — validity_date must follow the flight.
        row = _fake_entitlement(status=2, scheduled_date=date(2026, 5, 1))
        db = _FakeDb(execute_results=[_FakeResult(row), _FakeResult(date(2026, 6, 15))])

        result = await patch_vi_realisation_date(db, row.uuid, date(2026, 7, 1), user_id=None)
        self.assertEqual(result.status, 3)
        self.assertEqual(result.realisation_date, date(2026, 7, 1))
        self.assertEqual(result.validity_date, date(2026, 6, 15))

    async def test_archiving_without_flight_link_falls_back_to_realisation_date(self):
        row = _fake_entitlement(
            status=2,
            scheduled_date=date(2026, 7, 1),
            validity_date=date(2027, 1, 1),
        )
        db = _FakeDb(execute_results=[_FakeResult(row), _FakeResult(None)])

        result = await patch_vi_realisation_date(db, row.uuid, date(2026, 7, 1), user_id=None)
        self.assertEqual(result.status, 3)
        self.assertEqual(result.validity_date, date(2026, 7, 1))

    async def test_clearing_realisation_date_leaves_validity_date_untouched(self):
        row = _fake_entitlement(
            status=3,
            scheduled_date=date(2026, 7, 1),
            realisation_date=date(2026, 7, 1),
            validity_date=date(2026, 6, 15),
        )
        db = _FakeDb(execute_results=[_FakeResult(row)])

        result = await patch_vi_realisation_date(db, row.uuid, None, user_id=None)
        self.assertEqual(result.status, 2)
        self.assertEqual(result.validity_date, date(2026, 6, 15))
