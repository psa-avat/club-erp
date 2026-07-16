"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant tests: validation queue state transitions, ravitaillements, stock aggregation
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
from decimal import Decimal
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

from fastapi import HTTPException

from schemas.carburant import RavitaillementCreateRequest
from services.carburant import (
    create_ravitaillement,
    get_stock_carburant,
    rejeter_mouvement,
    valider_mouvement,
)


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
        self.flushed = False

    async def execute(self, *_args, **_kwargs):
        if not self.execute_results:
            return _FakeResult([])
        return self.execute_results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushed = True
        for obj in self.added:
            obj.uuid = obj.uuid or uuid4()

    async def commit(self):
        self.committed = True

    async def refresh(self, obj):
        obj.uuid = obj.uuid or uuid4()


def _fake_mouvement(*, statut=1, **overrides):
    pompe = SimpleNamespace(uuid=uuid4(), nom="Cuve Test")
    asset = SimpleNamespace(uuid=uuid4(), registration="F-TEST", name="TEST")
    defaults = dict(
        uuid=uuid4(),
        pompe_uuid=pompe.uuid,
        pompe=pompe,
        asset_uuid=asset.uuid,
        asset=asset,
        quantite_l=Decimal("20"),
        index_compteur=None,
        membre_declarant="Jean",
        date_saisie=datetime.now(timezone.utc),
        statut=statut,
        ip_source="1.2.3.4",
        flag_anomalie=False,
        commentaire_validation=None,
        validated_by=None,
        validated_at=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _fake_pompe(**overrides):
    defaults = dict(uuid=uuid4(), nom="Cuve Test", type_carburant=1, actif=True)
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class ValiderMouvementTests(IsolatedAsyncioTestCase):
    async def test_brouillon_transitions_to_valide(self):
        mouvement = _fake_mouvement(statut=1)
        db = _FakeDb(execute_results=[_FakeResult([mouvement])])
        response = await valider_mouvement(db, mouvement.uuid, user_id=7)
        self.assertEqual(response.statut, 2)
        self.assertTrue(db.committed)

    async def test_already_validated_raises_409(self):
        mouvement = _fake_mouvement(statut=2)
        db = _FakeDb(execute_results=[_FakeResult([mouvement])])
        with self.assertRaises(HTTPException) as ctx:
            await valider_mouvement(db, mouvement.uuid, user_id=7)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_already_rejected_raises_409(self):
        mouvement = _fake_mouvement(statut=3)
        db = _FakeDb(execute_results=[_FakeResult([mouvement])])
        with self.assertRaises(HTTPException) as ctx:
            await valider_mouvement(db, mouvement.uuid, user_id=7)
        self.assertEqual(ctx.exception.status_code, 409)


class RejeterMouvementTests(IsolatedAsyncioTestCase):
    async def test_brouillon_transitions_to_rejete_with_comment(self):
        mouvement = _fake_mouvement(statut=1)
        db = _FakeDb(execute_results=[_FakeResult([mouvement])])
        response = await rejeter_mouvement(db, mouvement.uuid, user_id=7, commentaire="Doublon")
        self.assertEqual(response.statut, 3)
        self.assertEqual(response.commentaire_validation, "Doublon")


class CreateRavitaillementTests(IsolatedAsyncioTestCase):
    async def test_creates_and_returns_response_with_pompe_nom(self):
        pompe = _fake_pompe(nom="Cuve 100LL")
        db = _FakeDb(execute_results=[_FakeResult([pompe])])
        request = RavitaillementCreateRequest(
            pompe_uuid=pompe.uuid, quantite_l=Decimal("200"), date_ravitaillement="2026-01-01"
        )
        response = await create_ravitaillement(db, request, user_id=7)
        self.assertEqual(response.pompe_nom, "Cuve 100LL")
        self.assertEqual(response.quantite_l, Decimal("200"))
        self.assertTrue(db.committed)


class StockCarburantTests(IsolatedAsyncioTestCase):
    async def test_stock_is_ravitaillements_minus_validated_consommation(self):
        pompe = _fake_pompe(nom="Cuve Test")
        db = _FakeDb(
            execute_results=[
                _FakeResult([(pompe.uuid, Decimal("200"))]),  # ravitaillements totals
                _FakeResult([(pompe.uuid, Decimal("30"))]),  # consommation totals (valide only)
                _FakeResult([(pompe.uuid, None)]),  # derniere activite
                _FakeResult([pompe]),  # list_pompes
            ]
        )
        entries = await get_stock_carburant(db)
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry.total_ravitaillements_l, Decimal("200"))
        self.assertEqual(entry.total_consommation_l, Decimal("30"))
        self.assertEqual(entry.stock_l, Decimal("170"))

    async def test_pompe_with_no_activity_defaults_to_zero(self):
        pompe = _fake_pompe(nom="Cuve Vide")
        db = _FakeDb(
            execute_results=[
                _FakeResult([]),
                _FakeResult([]),
                _FakeResult([]),
                _FakeResult([pompe]),
            ]
        )
        entries = await get_stock_carburant(db)
        entry = entries[0]
        self.assertEqual(entry.stock_l, 0)
        self.assertIsNone(entry.derniere_activite)
