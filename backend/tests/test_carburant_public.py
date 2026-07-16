"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant tests: public pump lookup, declared fill-up creation, rate limiting
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
from decimal import Decimal
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

from fastapi import HTTPException

from schemas.carburant import MouvementCarburantCreateRequest
from services.carburant import create_mouvement, get_pompe_by_token


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeDb:
    def __init__(self, execute_results=None):
        self.execute_results = list(execute_results or [])
        self.added = []
        self.committed = False

    async def execute(self, *_args, **_kwargs):
        if not self.execute_results:
            return _FakeResult([])
        return self.execute_results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True

    async def refresh(self, obj):
        obj.uuid = obj.uuid or uuid4()


def _fake_pompe(*, actif=True, capacite_cuve_l=None):
    return SimpleNamespace(
        uuid=uuid4(),
        nom="Cuve 100LL Test",
        type_carburant=1,
        token="tok-123",
        actif=actif,
        capacite_cuve_l=capacite_cuve_l,
    )


def _fake_asset():
    return SimpleNamespace(uuid=uuid4(), registration="F-TEST", name="TEST", is_active=True)


class GetPompeByTokenTests(IsolatedAsyncioTestCase):
    async def test_missing_token_raises_404(self):
        db = _FakeDb(execute_results=[_FakeResult([])])
        with self.assertRaises(HTTPException) as ctx:
            await get_pompe_by_token(db, "unknown")
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_inactive_pompe_raises_404(self):
        pompe = _fake_pompe(actif=False)
        db = _FakeDb(execute_results=[_FakeResult([pompe])])
        with self.assertRaises(HTTPException) as ctx:
            await get_pompe_by_token(db, pompe.token)
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_active_pompe_returned(self):
        pompe = _fake_pompe()
        db = _FakeDb(execute_results=[_FakeResult([pompe])])
        result = await get_pompe_by_token(db, pompe.token)
        self.assertIs(result, pompe)


class CreateMouvementTests(IsolatedAsyncioTestCase):
    async def test_rate_limited_when_recent_submission_from_same_ip(self):
        pompe = _fake_pompe()
        db = _FakeDb(
            execute_results=[
                _FakeResult([pompe]),  # get_pompe_by_token
                _FakeResult([uuid4()]),  # _recent_submission_exists -> found
            ]
        )
        request = MouvementCarburantCreateRequest(
            asset_uuid=uuid4(), quantite_l=Decimal("20"), membre_declarant="Jean"
        )
        with self.assertRaises(HTTPException) as ctx:
            await create_mouvement(db, pompe.token, request, ip_source="1.2.3.4", user_agent="ua")
        self.assertEqual(ctx.exception.status_code, 429)

    async def test_invalid_asset_raises_400(self):
        pompe = _fake_pompe()
        db = _FakeDb(
            execute_results=[
                _FakeResult([pompe]),  # get_pompe_by_token
                _FakeResult([]),  # _recent_submission_exists -> none
                _FakeResult([]),  # asset lookup -> none
            ]
        )
        request = MouvementCarburantCreateRequest(
            asset_uuid=uuid4(), quantite_l=Decimal("20"), membre_declarant="Jean"
        )
        with self.assertRaises(HTTPException) as ctx:
            await create_mouvement(db, pompe.token, request, ip_source="1.2.3.4", user_agent="ua")
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_flags_anomalie_when_over_capacity(self):
        pompe = _fake_pompe(capacite_cuve_l=Decimal("50"))
        asset = _fake_asset()
        db = _FakeDb(
            execute_results=[
                _FakeResult([pompe]),  # get_pompe_by_token
                _FakeResult([]),  # _recent_submission_exists -> none
                _FakeResult([asset]),  # asset lookup -> found
            ]
        )
        request = MouvementCarburantCreateRequest(
            asset_uuid=asset.uuid, quantite_l=Decimal("9999"), membre_declarant="Jean"
        )
        mouvement = await create_mouvement(db, pompe.token, request, ip_source="1.2.3.4", user_agent="ua")
        self.assertTrue(mouvement.flag_anomalie)
        self.assertEqual(mouvement.statut, 1)
        self.assertTrue(db.committed)

    async def test_no_anomalie_within_capacity(self):
        pompe = _fake_pompe(capacite_cuve_l=Decimal("500"))
        asset = _fake_asset()
        db = _FakeDb(
            execute_results=[
                _FakeResult([pompe]),
                _FakeResult([]),
                _FakeResult([asset]),
            ]
        )
        request = MouvementCarburantCreateRequest(
            asset_uuid=asset.uuid, quantite_l=Decimal("20"), membre_declarant="Jean"
        )
        mouvement = await create_mouvement(db, pompe.token, request, ip_source="1.2.3.4", user_agent="ua")
        self.assertFalse(mouvement.flag_anomalie)
