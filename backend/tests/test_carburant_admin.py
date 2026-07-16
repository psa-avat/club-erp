"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant tests: admin pump CRUD, token rotation, QR code generation
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
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

from fastapi import HTTPException

from schemas.carburant import PompeCreateRequest, PompeUpdateRequest
from services.carburant import (
    create_pompe,
    generate_pompe_qrcode_svg,
    get_pompe,
    rotate_pompe_token,
    update_pompe,
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


def _fake_pompe(**overrides):
    defaults = dict(uuid=uuid4(), nom="Cuve Test", type_carburant=1, token="old-token", actif=True)
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class GetPompeTests(IsolatedAsyncioTestCase):
    async def test_missing_pompe_raises_404(self):
        db = _FakeDb(execute_results=[_FakeResult([])])
        with self.assertRaises(HTTPException) as ctx:
            await get_pompe(db, uuid4())
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_inactive_pompe_still_returned_for_admin(self):
        pompe = _fake_pompe(actif=False)
        db = _FakeDb(execute_results=[_FakeResult([pompe])])
        result = await get_pompe(db, pompe.uuid)
        self.assertIs(result, pompe)


class CreatePompeTests(IsolatedAsyncioTestCase):
    async def test_generates_unique_token_and_commits(self):
        db = _FakeDb()
        request = PompeCreateRequest(nom="Cuve 100LL", type_carburant=1, actif=True)
        pompe = await create_pompe(db, request)
        self.assertTrue(pompe.token)
        self.assertEqual(pompe.nom, "Cuve 100LL")
        self.assertTrue(db.committed)
        self.assertEqual(len(db.added), 1)


class UpdatePompeTests(IsolatedAsyncioTestCase):
    async def test_only_updates_provided_fields(self):
        pompe = _fake_pompe(nom="Old name", actif=True)
        db = _FakeDb(execute_results=[_FakeResult([pompe])])
        updated = await update_pompe(db, pompe.uuid, PompeUpdateRequest(nom="New name"))
        self.assertEqual(updated.nom, "New name")
        self.assertTrue(updated.actif)  # untouched


class RotatePompeTokenTests(IsolatedAsyncioTestCase):
    async def test_issues_new_token(self):
        pompe = _fake_pompe(token="old-token")
        db = _FakeDb(execute_results=[_FakeResult([pompe])])
        rotated = await rotate_pompe_token(db, pompe.uuid)
        self.assertNotEqual(rotated.token, "old-token")


class QrCodeGenerationTests(IsolatedAsyncioTestCase):
    async def test_generates_svg_bytes(self):
        pompe = _fake_pompe(token="abc123")
        svg = generate_pompe_qrcode_svg(pompe, "https://club.example.org")
        self.assertTrue(svg.startswith(b"<?xml"))
        self.assertIn(b"<svg", svg)
