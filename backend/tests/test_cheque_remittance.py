"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - cheque remittance tests: settings fallback, candidate listing, deposit generation
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

from models import AccountingAccount, AccountingEntry, AccountingJournal, AccountingLine
from schemas.cheque_remittance import ChequeRemittanceCreateRequest
from services.cheque_remittance import (
    _get_cheque_settings,
    create_cheque_remittance,
    list_cheque_candidates,
)


def _account(**overrides):
    defaults = dict(uuid=uuid4(), code="5112", name="Chèques à encaisser", type=1, require_id=0)
    defaults.update(overrides)
    return AccountingAccount(**defaults)


def _cheque_entry(pending_account_uuid, other_account, amount, *, fiscal_year_uuid=None,
                   entry_date=date(2026, 6, 3), state=1, description="Chèque Dupont"):
    fiscal_year_uuid = fiscal_year_uuid or uuid4()
    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid, fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(),
        entry_date=entry_date, description=description, state=state,
    )
    pending_line = AccountingLine(
        uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
        account_uuid=pending_account_uuid, debit=amount, credit=Decimal("0"),
    )
    pending_line.account = _account(uuid=pending_account_uuid)
    other_line = AccountingLine(
        uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
        account_uuid=other_account.uuid, debit=Decimal("0"), credit=amount, tiers_uuid=uuid4(),
    )
    other_line.account = other_account
    other_line.tiers_display_ref = "ME2026-0001"
    other_line.tiers_display_name = "Dupont Jean"
    entry.lines = [pending_line, other_line]
    return entry


class GetChequeSettingsTests(IsolatedAsyncioTestCase):
    async def test_falls_back_to_defaults_when_not_configured(self):
        db = AsyncMock()
        with patch("services.cheque_remittance.get_system_setting", new=AsyncMock(side_effect=HTTPException(status_code=404))):
            settings = await _get_cheque_settings(db)
        self.assertIsNone(settings["pending_account_uuid"])
        self.assertIsNone(settings["bank_account_uuid"])

    async def test_merges_stored_settings_over_defaults(self):
        db = AsyncMock()
        stored = SimpleNamespace(settings={"pending_account_uuid": "abc", "bank_account_uuid": "def"})
        with patch("services.cheque_remittance.get_system_setting", new=AsyncMock(return_value=stored)):
            settings = await _get_cheque_settings(db)
        self.assertEqual(settings["pending_account_uuid"], "abc")
        self.assertEqual(settings["bank_account_uuid"], "def")


class ListChequeCandidatesTests(IsolatedAsyncioTestCase):
    async def test_raises_400_when_pending_account_not_configured(self):
        db = AsyncMock()
        with patch(
            "services.cheque_remittance._get_cheque_settings",
            new=AsyncMock(return_value={"pending_account_uuid": None, "bank_account_uuid": None}),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await list_cheque_candidates(db, uuid4())
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_builds_candidate_from_the_non_pending_line(self):
        pending_account_uuid = uuid4()
        other_account = _account(code="411", name="Membres", require_id=1)
        entry = _cheque_entry(pending_account_uuid, other_account, Decimal("150.00"))
        db = AsyncMock()

        with patch(
            "services.cheque_remittance._get_cheque_settings",
            new=AsyncMock(return_value={"pending_account_uuid": str(pending_account_uuid), "bank_account_uuid": str(uuid4())}),
        ), patch(
            "services.cheque_remittance._load_cheque_candidate_entries", new=AsyncMock(return_value=[entry]),
        ), patch(
            "services.cheque_remittance._enrich_lines_tiers", new=AsyncMock(),
        ):
            result = await list_cheque_candidates(db, entry.fiscal_year_uuid)

        self.assertEqual(len(result), 1)
        candidate = result[0]
        self.assertEqual(candidate.entry_uuid, entry.uuid)
        self.assertEqual(candidate.amount, Decimal("150.00"))
        self.assertEqual(candidate.account_code, "411")
        self.assertEqual(candidate.tiers_display_name, "Dupont Jean")
        self.assertEqual(candidate.state, 1)


class CreateChequeRemittanceTests(IsolatedAsyncioTestCase):
    async def test_raises_400_when_settings_missing(self):
        db = AsyncMock()
        request = ChequeRemittanceCreateRequest(
            fiscal_year_uuid=uuid4(), remittance_date=date(2026, 6, 10), entry_uuids=[uuid4()],
        )
        with patch(
            "services.cheque_remittance._get_cheque_settings",
            new=AsyncMock(return_value={"pending_account_uuid": None, "bank_account_uuid": None}),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await create_cheque_remittance(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_raises_409_when_an_entry_is_no_longer_a_candidate(self):
        pending_account_uuid = uuid4()
        bank_account_uuid = uuid4()
        db = AsyncMock()
        request = ChequeRemittanceCreateRequest(
            fiscal_year_uuid=uuid4(), remittance_date=date(2026, 6, 10), entry_uuids=[uuid4()],
        )
        with patch(
            "services.cheque_remittance._get_cheque_settings",
            new=AsyncMock(return_value={
                "pending_account_uuid": str(pending_account_uuid),
                "bank_account_uuid": str(bank_account_uuid),
            }),
        ), patch(
            "services.cheque_remittance._load_cheque_candidate_entries", new=AsyncMock(return_value=[]),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await create_cheque_remittance(db, request, user_id=1)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_generates_balanced_deposit_entry_and_persists_remittance_lines(self):
        pending_account_uuid = uuid4()
        bank_account_uuid = uuid4()
        other_account = _account(code="411", require_id=1)
        fiscal_year_uuid = uuid4()
        entry1 = _cheque_entry(pending_account_uuid, other_account, Decimal("100.00"), fiscal_year_uuid=fiscal_year_uuid)
        entry2 = _cheque_entry(pending_account_uuid, other_account, Decimal("50.00"), fiscal_year_uuid=fiscal_year_uuid)

        deposit_entry = AccountingEntry(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(),
            entry_date=date(2026, 6, 10), description="Remise de chèques du 2026-06-10", state=1,
        )
        bq_journal = AccountingJournal(uuid=uuid4(), code="BQ", name="Banque", type=3, is_active=True)

        db = AsyncMock()
        request = ChequeRemittanceCreateRequest(
            fiscal_year_uuid=fiscal_year_uuid, remittance_date=date(2026, 6, 10),
            entry_uuids=[entry1.uuid, entry2.uuid],
        )

        with patch(
            "services.cheque_remittance._get_cheque_settings",
            new=AsyncMock(return_value={
                "pending_account_uuid": str(pending_account_uuid),
                "bank_account_uuid": str(bank_account_uuid),
            }),
        ), patch(
            "services.cheque_remittance._load_cheque_candidate_entries", new=AsyncMock(return_value=[entry1, entry2]),
        ), patch(
            "services.cheque_remittance._get_bq_journal", new=AsyncMock(return_value=bq_journal),
        ), patch(
            "services.cheque_remittance.create_accounting_entry", new=AsyncMock(return_value=deposit_entry),
        ) as mock_create:
            remittance = await create_cheque_remittance(db, request, user_id=7)

        self.assertEqual(remittance.total_amount, Decimal("150.00"))
        self.assertEqual(remittance.deposit_entry_uuid, deposit_entry.uuid)
        self.assertEqual(remittance.created_by, 7)
        self.assertEqual(len(remittance.lines), 2)
        self.assertEqual({line.source_entry_uuid for line in remittance.lines}, {entry1.uuid, entry2.uuid})
        self.assertEqual(
            {line.source_entry_uuid: line.amount for line in remittance.lines},
            {entry1.uuid: Decimal("100.00"), entry2.uuid: Decimal("50.00")},
        )

        created_request = mock_create.call_args[0][1]
        self.assertEqual(created_request.journal_uuid, bq_journal.uuid)
        self.assertEqual(len(created_request.lines), 2)
        bank_line = next(line for line in created_request.lines if line.account_uuid == bank_account_uuid)
        pending_line_req = next(line for line in created_request.lines if line.account_uuid == pending_account_uuid)
        self.assertEqual(bank_line.debit, Decimal("150.00"))
        self.assertEqual(bank_line.credit, Decimal("0"))
        self.assertEqual(pending_line_req.credit, Decimal("150.00"))
        self.assertEqual(pending_line_req.debit, Decimal("0"))
