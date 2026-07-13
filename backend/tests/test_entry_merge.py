"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - entry merge tests: validation and consolidated line construction
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

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from models import AccountingEntry, AccountingLine
from schemas.accounting import AccountingEntryMergeRequest
from services.accounting import merge_accounting_entries


def _entry(
    consolidation_account_uuid,
    other_account_uuid,
    amount,
    *,
    fiscal_year_uuid,
    journal_uuid=None,
    entry_date=date(2026, 6, 3),
    state=1,
    side="debit",
    description="Encaissement CB",
    consolidation_line_count=1,
):
    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid, fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid or uuid4(),
        entry_date=entry_date, description=description, state=state, sequence_number=None,
    )
    lines = []
    for _ in range(consolidation_line_count):
        debit = amount if side == "debit" else Decimal("0")
        credit = amount if side == "credit" else Decimal("0")
        lines.append(
            AccountingLine(
                uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
                account_uuid=consolidation_account_uuid, debit=debit, credit=credit,
            )
        )
    other_debit = Decimal("0") if side == "debit" else amount
    other_credit = amount if side == "debit" else Decimal("0")
    lines.append(
        AccountingLine(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
            account_uuid=other_account_uuid, debit=other_debit, credit=other_credit, tiers_uuid=uuid4(),
        )
    )
    entry.lines = lines
    return entry


def _db_returning(entries):
    db = AsyncMock()
    db.scalars = AsyncMock(return_value=SimpleNamespace(unique=lambda: SimpleNamespace(all=lambda: entries)))
    return db


def _request(fiscal_year_uuid, consolidation_account_uuid, entry_uuids, **overrides):
    defaults = dict(
        fiscal_year_uuid=fiscal_year_uuid,
        entry_date=date(2026, 6, 10),
        description="Fusion CB du 10/06/2026",
        reference=None,
        consolidation_account_uuid=consolidation_account_uuid,
        entry_uuids=entry_uuids,
    )
    defaults.update(overrides)
    return AccountingEntryMergeRequest(**defaults)


class MergeAccountingEntriesTests(IsolatedAsyncioTestCase):
    async def test_raises_400_when_fewer_than_two_distinct_entries(self):
        entry_uuid = uuid4()
        db = _db_returning([])
        request = _request(uuid4(), uuid4(), [entry_uuid, entry_uuid])
        with self.assertRaises(HTTPException) as ctx:
            await merge_accounting_entries(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_raises_404_when_an_entry_is_missing(self):
        fiscal_year_uuid = uuid4()
        bank_account_uuid = uuid4()
        entry1 = _entry(bank_account_uuid, uuid4(), Decimal("100.00"), fiscal_year_uuid=fiscal_year_uuid)
        db = _db_returning([entry1])
        request = _request(fiscal_year_uuid, bank_account_uuid, [entry1.uuid, uuid4()])
        with self.assertRaises(HTTPException) as ctx:
            await merge_accounting_entries(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_raises_409_when_an_entry_is_not_draft(self):
        fiscal_year_uuid = uuid4()
        bank_account_uuid = uuid4()
        entry1 = _entry(bank_account_uuid, uuid4(), Decimal("100.00"), fiscal_year_uuid=fiscal_year_uuid, state=1)
        entry2 = _entry(bank_account_uuid, uuid4(), Decimal("50.00"), fiscal_year_uuid=fiscal_year_uuid, state=2)
        db = _db_returning([entry1, entry2])
        request = _request(fiscal_year_uuid, bank_account_uuid, [entry1.uuid, entry2.uuid])
        with self.assertRaises(HTTPException) as ctx:
            await merge_accounting_entries(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_raises_409_when_journals_differ(self):
        fiscal_year_uuid = uuid4()
        bank_account_uuid = uuid4()
        entry1 = _entry(bank_account_uuid, uuid4(), Decimal("100.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4())
        entry2 = _entry(bank_account_uuid, uuid4(), Decimal("50.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4())
        db = _db_returning([entry1, entry2])
        request = _request(fiscal_year_uuid, bank_account_uuid, [entry1.uuid, entry2.uuid])
        with self.assertRaises(HTTPException) as ctx:
            await merge_accounting_entries(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_raises_400_when_consolidation_account_missing_from_an_entry(self):
        fiscal_year_uuid = uuid4()
        journal_uuid = uuid4()
        bank_account_uuid = uuid4()
        other_bank_account_uuid = uuid4()
        entry1 = _entry(bank_account_uuid, uuid4(), Decimal("100.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid)
        entry2 = _entry(other_bank_account_uuid, uuid4(), Decimal("50.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid)
        db = _db_returning([entry1, entry2])
        request = _request(fiscal_year_uuid, bank_account_uuid, [entry1.uuid, entry2.uuid])
        with self.assertRaises(HTTPException) as ctx:
            await merge_accounting_entries(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_raises_400_when_consolidation_account_duplicated_on_an_entry(self):
        fiscal_year_uuid = uuid4()
        journal_uuid = uuid4()
        bank_account_uuid = uuid4()
        entry1 = _entry(
            bank_account_uuid, uuid4(), Decimal("100.00"), fiscal_year_uuid=fiscal_year_uuid,
            journal_uuid=journal_uuid, consolidation_line_count=2,
        )
        entry2 = _entry(bank_account_uuid, uuid4(), Decimal("50.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid)
        db = _db_returning([entry1, entry2])
        request = _request(fiscal_year_uuid, bank_account_uuid, [entry1.uuid, entry2.uuid])
        with self.assertRaises(HTTPException) as ctx:
            await merge_accounting_entries(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_raises_400_when_sides_are_inconsistent(self):
        fiscal_year_uuid = uuid4()
        journal_uuid = uuid4()
        bank_account_uuid = uuid4()
        entry1 = _entry(bank_account_uuid, uuid4(), Decimal("100.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, side="debit")
        entry2 = _entry(bank_account_uuid, uuid4(), Decimal("50.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, side="credit")
        db = _db_returning([entry1, entry2])
        request = _request(fiscal_year_uuid, bank_account_uuid, [entry1.uuid, entry2.uuid])
        with self.assertRaises(HTTPException) as ctx:
            await merge_accounting_entries(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_merges_lines_into_one_entry_and_deletes_sources(self):
        fiscal_year_uuid = uuid4()
        journal_uuid = uuid4()
        bank_account_uuid = uuid4()
        member1_account_uuid = uuid4()
        member2_account_uuid = uuid4()
        entry1 = _entry(bank_account_uuid, member1_account_uuid, Decimal("100.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid)
        entry2 = _entry(bank_account_uuid, member2_account_uuid, Decimal("50.00"), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid)
        db = _db_returning([entry1, entry2])

        merged_entry = AccountingEntry(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid,
            entry_date=date(2026, 6, 10), description="Fusion CB du 10/06/2026", state=1,
        )

        request = _request(fiscal_year_uuid, bank_account_uuid, [entry1.uuid, entry2.uuid])

        with patch(
            "services.accounting.create_accounting_entry", new=AsyncMock(return_value=merged_entry),
        ) as mock_create, patch(
            "services.accounting.delete_accounting_entry", new=AsyncMock(),
        ) as mock_delete:
            result = await merge_accounting_entries(db, request, user_id=7)

        self.assertIs(result, merged_entry)

        created_request = mock_create.call_args[0][1]
        self.assertEqual(created_request.journal_uuid, journal_uuid)
        self.assertEqual(created_request.fiscal_year_uuid, fiscal_year_uuid)
        self.assertEqual(len(created_request.lines), 3)

        bank_line = next(line for line in created_request.lines if line.account_uuid == bank_account_uuid)
        self.assertEqual(bank_line.debit, Decimal("150.00"))
        self.assertEqual(bank_line.credit, Decimal("0"))

        member_lines = {line.account_uuid: line.credit for line in created_request.lines if line.account_uuid != bank_account_uuid}
        self.assertEqual(member_lines, {member1_account_uuid: Decimal("100.00"), member2_account_uuid: Decimal("50.00")})

        self.assertEqual(mock_delete.await_count, 2)
        deleted_uuids = {call.args[1] for call in mock_delete.await_args_list}
        self.assertEqual(deleted_uuids, {entry1.uuid, entry2.uuid})
