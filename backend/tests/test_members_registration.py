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

from fastapi import HTTPException

from schemas.members import RegistrationCompletionRequest
from schemas.members import MemberRegistrationCreateRequest
from schemas.members import MemberRegistrationUpdateRequest
from services.members import (
    PERMANENT_MEMBER_REGISTRATION_ERROR,
    _serialize_member_summary,
    complete_member_registration,
    create_member_registration,
    update_member_registration,
)


class _FakeDb:
    def __init__(self, scalar_values: list[object]):
        self._scalar_values = scalar_values
        self.committed = False
        self.rolled_back = False

    def add(self, *_args, **_kwargs):
        return None

    async def scalar(self, *_args, **_kwargs):
        if not self._scalar_values:
            return None
        return self._scalar_values.pop(0)

    async def commit(self):
        self.committed = True

    async def rollback(self):
        self.rolled_back = True

    async def refresh(self, *_args, **_kwargs):
        return None


class _FakeExecuteResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class MemberRegistrationTests(IsolatedAsyncioTestCase):
    async def test_create_registration_rejects_permanent_member_category(self):
        db = _FakeDb(scalar_values=[])
        member = SimpleNamespace(
            uuid=uuid4(),
            member_category=5,
            can_fly=False,
            registration_status=1,
            status=1,
            last_registration_date=None,
            updated_by=None,
        )

        with patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)):
            with self.assertRaises(HTTPException) as ctx:
                await create_member_registration(
                    db=db,
                    member_uuid=member.uuid,
                    payload=MemberRegistrationCreateRequest(
                        start_date=date(2026, 1, 1),
                        end_date=date(2026, 12, 31),
                        registered_for_year=2026,
                        status=1,
                    ),
                    registered_by_user_id=42,
                )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, PERMANENT_MEMBER_REGISTRATION_ERROR)
        self.assertFalse(db.committed)

    async def test_complete_registration_rejects_permanent_member_category(self):
        db = _FakeDb(scalar_values=[])
        member = SimpleNamespace(
            uuid=uuid4(),
            member_category=7,
            registration_status=1,
            status=1,
            last_registration_year=None,
            updated_by=None,
        )

        with patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)):
            with self.assertRaises(HTTPException) as ctx:
                await complete_member_registration(
                    db=db,
                    member_uuid=member.uuid,
                    payload=RegistrationCompletionRequest(
                        year=2026,
                        start_date=date(2026, 1, 1),
                        end_date=date(2026, 12, 31),
                    ),
                    updated_by_user_id=42,
                )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, PERMANENT_MEMBER_REGISTRATION_ERROR)
        self.assertFalse(db.committed)

    async def test_serialize_member_summary_marks_permanent_member_registered(self):
        db = SimpleNamespace(scalar=AsyncMock(side_effect=[0, 0]))
        member = SimpleNamespace(
            uuid=uuid4(),
            account_id="EXT-0001",
            ffvp_id=None,
            first_name="Ext",
            last_name="Pilot",
            email=None,
            member_category=5,
            status=1,
            registration_status=1,
            can_fly=False,
            is_instructor=False,
            is_employee=False,
            is_executive=False,
            is_board_member=False,
        )

        summary = await _serialize_member_summary(db=db, member=member, year=2026)

        self.assertTrue(summary.is_registered_for_year)
        self.assertEqual(db.scalar.await_count, 2)

    async def test_complete_registration_activates_member(self):
        db = _FakeDb(scalar_values=[1, None])
        member = SimpleNamespace(
            uuid=uuid4(),
            member_category=1,
            registration_status=1,
            status=2,
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

    async def test_complete_registration_creates_accounting_entry_for_selected_prices(self):
        db = _FakeDb(scalar_values=[1, None])
        member = SimpleNamespace(
            uuid=uuid4(),
            member_category=1,
            registration_status=1,
            status=2,
            last_registration_year=None,
            updated_by=None,
        )
        pricing_item_uuid = uuid4()

        with (
            patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)),
            patch("services.members.create_member_registration", new=AsyncMock()),
            patch("services.members._create_registration_accounting_entry", new=AsyncMock()) as create_entry_mock,
        ):
            updated = await complete_member_registration(
                db=db,
                member_uuid=member.uuid,
                payload=RegistrationCompletionRequest(
                    year=2026,
                    start_date=date(2026, 1, 1),
                    end_date=date(2026, 12, 31),
                    pricing_item_uuids=[pricing_item_uuid],
                    accounting_entry_date=date(2026, 5, 6),
                ),
                updated_by_user_id=42,
            )

        self.assertEqual(updated.uuid, member.uuid)
        create_entry_mock.assert_awaited_once()
        self.assertEqual(create_entry_mock.await_args.kwargs["member"], member)
        self.assertEqual(create_entry_mock.await_args.kwargs["user_id"], 42)

    async def test_complete_registration_rejects_unknown_template(self):
        db = _FakeDb(scalar_values=[1, None, False])
        member = SimpleNamespace(
            uuid=uuid4(),
            member_category=1,
            registration_status=1,
            status=2,
            last_registration_year=None,
            updated_by=None,
        )

        with (
            patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)),
            patch("services.members.create_member_registration", new=AsyncMock()),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await complete_member_registration(
                    db=db,
                    member_uuid=member.uuid,
                    payload=RegistrationCompletionRequest(
                        year=2026,
                        start_date=date(2026, 1, 1),
                        end_date=date(2026, 12, 31),
                        accounting_template_uuid=uuid4(),
                    ),
                    updated_by_user_id=42,
                )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "Selected accounting template does not exist or is inactive")

    async def test_complete_registration_rejects_duplicate_year(self):
        db = _FakeDb(scalar_values=[1, uuid4()])
        member = SimpleNamespace(
            uuid=uuid4(),
            member_category=1,
            registration_status=1,
            status=2,
            last_registration_year=None,
            updated_by=None,
        )

        with (
            patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)),
            patch("services.members.create_member_registration", new=AsyncMock()),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await complete_member_registration(
                    db=db,
                    member_uuid=member.uuid,
                    payload=RegistrationCompletionRequest(
                        year=2026,
                        start_date=date(2026, 1, 1),
                        end_date=date(2026, 12, 31),
                    ),
                    updated_by_user_id=42,
                )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "Member is already registered for year 2026")

    async def test_create_registration_rejects_duplicate_period(self):
        db = _FakeDb(scalar_values=[uuid4()])
        member = SimpleNamespace(
            uuid=uuid4(),
            member_category=1,
            can_fly=False,
            registration_status=1,
            status=2,
            last_registration_date=None,
            updated_by=None,
        )

        with patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)):
            with self.assertRaises(HTTPException) as ctx:
                await create_member_registration(
                    db=db,
                    member_uuid=member.uuid,
                    payload=MemberRegistrationCreateRequest(
                        start_date=date(2026, 1, 1),
                        end_date=date(2026, 12, 31),
                        registered_for_year=2026,
                        status=1,
                    ),
                    registered_by_user_id=42,
                )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "Member is already registered for this period")
        self.assertFalse(db.committed)

    async def test_update_registration_cancel_archives_member_year_status(self):
        registration = SimpleNamespace(
            uuid=uuid4(),
            member_uuid=uuid4(),
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            registered_for_year=2026,
            status=1,
        )
        member = SimpleNamespace(
            uuid=registration.member_uuid,
            registration_status=2,
            updated_by=None,
        )
        db = SimpleNamespace(
            execute=AsyncMock(return_value=_FakeExecuteResult(registration)),
            scalar=AsyncMock(side_effect=[None, uuid4()]),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )

        with patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)):
            updated = await update_member_registration(
                db=db,
                member_uuid=registration.member_uuid,
                registration_uuid=registration.uuid,
                payload=MemberRegistrationUpdateRequest(status=2),
                updated_by_user_id=42,
            )

        self.assertEqual(updated.status, 2)
        self.assertEqual(member.registration_status, 1)
        self.assertEqual(member.updated_by, 42)

    async def test_update_registration_reactivate_marks_member_completed_for_year(self):
        registration = SimpleNamespace(
            uuid=uuid4(),
            member_uuid=uuid4(),
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            registered_for_year=2026,
            status=2,
        )
        member = SimpleNamespace(
            uuid=registration.member_uuid,
            registration_status=1,
            updated_by=None,
        )
        db = SimpleNamespace(
            execute=AsyncMock(return_value=_FakeExecuteResult(registration)),
            scalar=AsyncMock(side_effect=[uuid4()]),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )

        with patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)):
            updated = await update_member_registration(
                db=db,
                member_uuid=registration.member_uuid,
                registration_uuid=registration.uuid,
                payload=MemberRegistrationUpdateRequest(status=1),
                updated_by_user_id=42,
            )

        self.assertEqual(updated.status, 1)
        self.assertEqual(member.registration_status, 2)
        self.assertEqual(member.updated_by, 42)
