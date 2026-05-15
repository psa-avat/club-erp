"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members tests: member update invariants around immutable accounting identifiers
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

from fastapi import HTTPException

from schemas.members import MemberUpdateRequest
from services.members import update_member


class _FakeDb:
    def __init__(self):
        self.committed = False
        self.refreshed = False

    async def commit(self):
        self.committed = True

    async def refresh(self, *_args, **_kwargs):
        self.refreshed = True


class MemberUpdateTests(IsolatedAsyncioTestCase):
    async def test_update_member_updates_registration_status(self):
        db = _FakeDb()
        member = SimpleNamespace(
            uuid=uuid4(),
            account_id="EXT-0002",
            legacy_account_id=None,
            email="external@example.com",
            ffvp_id=None,
            registration_status=1,
            is_employee=False,
            is_executive=False,
            is_board_member=False,
            updated_by=None,
        )

        with (
            patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)),
            patch("services.members._ensure_unique_member_fields", new=AsyncMock()),
        ):
            updated = await update_member(
                db=db,
                member_uuid=member.uuid,
                payload=MemberUpdateRequest(registration_status=2),
                updated_by_user_id=42,
            )

        self.assertEqual(updated.registration_status, 2)
        self.assertEqual(updated.updated_by, 42)
        self.assertTrue(db.committed)
        self.assertTrue(db.refreshed)

    async def test_update_member_rejects_account_id_change(self):
        db = _FakeDb()
        member = SimpleNamespace(
            uuid=uuid4(),
            account_id="ME2026-0002",
            email="pilot@example.com",
            ffvp_id=123,
            is_employee=False,
            is_executive=False,
            is_board_member=False,
            updated_by=None,
        )

        with (
            patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)),
            patch("services.members._ensure_unique_member_fields", new=AsyncMock()) as ensure_unique,
        ):
            with self.assertRaises(HTTPException) as ctx:
                await update_member(
                    db=db,
                    member_uuid=member.uuid,
                    payload=MemberUpdateRequest(account_id="ME2026-9999"),
                    updated_by_user_id=42,
                )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "account_id cannot be modified once created")
        ensure_unique.assert_not_awaited()
        self.assertFalse(db.committed)

    async def test_update_member_keeps_existing_account_id(self):
        db = _FakeDb()
        member = SimpleNamespace(
            uuid=uuid4(),
            account_id="ME2026-0002",
            legacy_account_id="42",
            email="pilot@example.com",
            ffvp_id=123,
            first_name="Old",
            is_employee=False,
            is_executive=False,
            is_board_member=False,
            updated_by=None,
        )

        with (
            patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)),
            patch("services.members._ensure_unique_member_fields", new=AsyncMock()),
        ):
            updated = await update_member(
                db=db,
                member_uuid=member.uuid,
                payload=MemberUpdateRequest(first_name="New", account_id="ME2026-0002"),
                updated_by_user_id=42,
            )

        self.assertEqual(updated.first_name, "New")
        self.assertEqual(updated.account_id, "ME2026-0002")
        self.assertEqual(updated.updated_by, 42)
        self.assertTrue(db.committed)
        self.assertTrue(db.refreshed)

    async def test_update_member_passes_legacy_account_id_to_uniqueness_check(self):
        db = _FakeDb()
        member = SimpleNamespace(
            uuid=uuid4(),
            account_id="ME2026-0002",
            legacy_account_id="42",
            email="pilot@example.com",
            ffvp_id=123,
            first_name="Old",
            is_employee=False,
            is_executive=False,
            is_board_member=False,
            updated_by=None,
        )

        with (
            patch("services.members.get_member_or_404", new=AsyncMock(return_value=member)),
            patch("services.members._ensure_unique_member_fields", new=AsyncMock()) as ensure_unique,
        ):
            await update_member(
                db=db,
                member_uuid=member.uuid,
                payload=MemberUpdateRequest(first_name="New", legacy_account_id="77"),
                updated_by_user_id=42,
            )

        ensure_unique.assert_awaited_once_with(
            db,
            account_id="ME2026-0002",
            email="pilot@example.com",
            ffvp_id=123,
            legacy_account_id="77",
            exclude_member_uuid=member.uuid,
        )