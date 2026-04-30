"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members tests: CSV import create vs update behavior
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
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from services.members import import_members_from_csv


class _FakeDb:
    def __init__(self, scalar_values: list[object]):
        self._scalar_values = list(scalar_values)

    async def scalar(self, *_args, **_kwargs):
        if not self._scalar_values:
            return None
        return self._scalar_values.pop(0)


class MembersCsvImportTests(IsolatedAsyncioTestCase):
    async def test_import_updates_existing_member_when_option_enabled(self):
        existing = SimpleNamespace(
            uuid=uuid4(),
            account_id="ME2026-0001",
            is_active=True,
            status=1,
            registration_status=1,
            can_fly=False,
            is_instructor=False,
            is_employee=False,
            is_executive=False,
            is_board_member=False,
        )
        db = _FakeDb([existing])
        csv_content = (
            "first_name,last_name,member_category,account_id\\n"
            "Jean,Dupont,1,ME2026-0001\\n"
        ).encode("utf-8")

        with (
            patch("services.members.create_member", new=AsyncMock()) as create_mock,
            patch("services.members.update_member", new=AsyncMock(return_value=existing)) as update_mock,
        ):
            result = await import_members_from_csv(
                db=db,
                content=csv_content,
                update_existing=True,
                updated_by_user_id=42,
            )

        self.assertEqual(result.created, 0)
        self.assertEqual(result.updated, 1)
        self.assertEqual(result.skipped, 0)
        self.assertEqual(len(result.errors), 0)
        create_mock.assert_not_awaited()
        update_mock.assert_awaited_once()

    async def test_import_creates_member_when_update_option_disabled(self):
        db = _FakeDb([])
        csv_content = (
            "first_name,last_name,member_category\\n"
            "Marie,Martin,2\\n"
        ).encode("utf-8")

        with (
            patch("services.members.create_member", new=AsyncMock()) as create_mock,
            patch("services.members.update_member", new=AsyncMock()) as update_mock,
        ):
            result = await import_members_from_csv(
                db=db,
                content=csv_content,
                update_existing=False,
                updated_by_user_id=42,
            )

        self.assertEqual(result.created, 1)
        self.assertEqual(result.updated, 0)
        self.assertEqual(result.skipped, 0)
        self.assertEqual(len(result.errors), 0)
        create_mock.assert_awaited_once()
        update_mock.assert_not_awaited()