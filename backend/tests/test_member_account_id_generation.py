"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members tests: category-specific account-id generation
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

from datetime import date as real_date
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from schemas.members import MemberCreateRequest
from services.members import create_member


class _ScalarResult:
    def __init__(self, values: list[str]):
        self._values = values

    def all(self):
        return list(self._values)


class _ExecuteResult:
    def __init__(self, values: list[str]):
        self._values = values

    def scalars(self):
        return _ScalarResult(self._values)


class _FakeDb:
    def __init__(self, existing_account_ids: list[str]):
        self._existing_account_ids = existing_account_ids
        self.added = None
        self.committed = False
        self.refreshed = False

    async def execute(self, *_args, **_kwargs):
        return _ExecuteResult(self._existing_account_ids)

    def add(self, member):
        self.added = member

    async def commit(self):
        self.committed = True

    async def refresh(self, *_args, **_kwargs):
        self.refreshed = True


class MemberAccountIdGenerationTests(IsolatedAsyncioTestCase):
    async def test_create_member_generates_me_prefix_for_internal_members(self):
        db = _FakeDb(["ME2026-0001", "ME2026-0007"])

        with (
            patch("services.members.date") as mock_date,
            patch("services.members._ensure_unique_member_fields", new=AsyncMock()),
        ):
            mock_date.today.return_value = real_date(2026, 5, 10)
            member = await create_member(
                db,
                MemberCreateRequest(first_name="Jean", last_name="Dupont", member_category=1),
                updated_by_user_id=42,
            )

        self.assertEqual(member.account_id, "ME2026-0008")
        self.assertTrue(db.committed)
        self.assertTrue(db.refreshed)

    async def test_create_member_generates_ext_prefix_for_external_pilots(self):
        db = _FakeDb(["EXT-0001", "EXT-0003"])

        with patch("services.members._ensure_unique_member_fields", new=AsyncMock()):
            member = await create_member(
                db,
                MemberCreateRequest(first_name="Alice", last_name="Martin", member_category=5),
                updated_by_user_id=42,
            )

        self.assertEqual(member.account_id, "EXT-0004")

    async def test_create_member_generates_fo_prefix_for_suppliers(self):
        db = _FakeDb(["FO-0002"])

        with patch("services.members._ensure_unique_member_fields", new=AsyncMock()):
            member = await create_member(
                db,
                MemberCreateRequest(first_name="Supplier", last_name="Contact", member_category=8),
                updated_by_user_id=42,
            )

        self.assertEqual(member.account_id, "FO-0003")