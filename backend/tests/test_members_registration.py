"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members tests: registration completion activation behavior
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
from datetime import date

from schemas.members import RegistrationCompletionRequest
from services.members import complete_member_registration


class _FakeDb:
    def __init__(self, committee_count: int):
        self._committee_count = committee_count
        self.committed = False

    async def scalar(self, *_args, **_kwargs):
        return self._committee_count

    async def commit(self):
        self.committed = True

    async def refresh(self, *_args, **_kwargs):
        return None


class MemberRegistrationTests(IsolatedAsyncioTestCase):
    async def test_complete_registration_activates_member(self):
        db = _FakeDb(committee_count=1)
        member = SimpleNamespace(
            uuid=uuid4(),
            registration_status=1,
            status=2,
            is_active=False,
            last_registration_year=None,
            updated_by=None,
        )

        with (
            patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)),
            patch("services.members.create_member_registration", new=AsyncMock()),
        ):
            updated = await complete_member_registration(
                db=db,
                member_uuid=member.uuid,
                payload=RegistrationCompletionRequest(
                    year=2026,
                    start_date=date(2026, 1, 1),
                    end_date=date(2026, 12, 31),
                ),
                updated_by_user_id=42,
            )

        self.assertEqual(updated.uuid, member.uuid)
