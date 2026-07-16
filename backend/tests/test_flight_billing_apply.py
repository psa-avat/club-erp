"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - flight_billing_apply tests: deleted-flight billing reversal
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
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from models import AccountingEntry, ValidatedFlight
from services.flight_billing_apply import FlightBillingApplyService


def _result(scalar=None, scalars_list=None):
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    if scalars_list is not None:
        result.scalars.return_value.all.return_value = scalars_list
    return result


class ReverseFlightBillingForDeletionTests(IsolatedAsyncioTestCase):
    async def test_no_accounting_entry_is_a_noop(self):
        flight = ValidatedFlight(uuid=uuid4(), accounting_entry_uuid=None)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_result(scalar=flight))

        service = FlightBillingApplyService(db)
        outcome = await service.reverse_flight_billing_for_deletion(flight.uuid, user_id=1)

        self.assertEqual(outcome, "none")
        db.commit.assert_not_called()

    async def test_draft_entry_is_hard_deleted_and_flight_reset(self):
        entry_uuid = uuid4()
        fy_uuid = uuid4()
        flight = ValidatedFlight(
            uuid=uuid4(), accounting_entry_uuid=entry_uuid,
            billing_quote_state="applied", has_discount=False,
        )
        entry = AccountingEntry(
            uuid=entry_uuid, fiscal_year_uuid=fy_uuid, journal_uuid=uuid4(),
            entry_date=date(2026, 1, 1), state=1, created_by=1,
        )

        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[
            _result(scalar=flight),
            _result(scalar=entry),
            _result(scalars_list=[]),  # lines
            _result(scalars_list=[]),  # delete(MemberPackConsumption) statement result
        ])
        db.delete = AsyncMock()

        service = FlightBillingApplyService(db)
        outcome = await service.reverse_flight_billing_for_deletion(flight.uuid, user_id=1)

        self.assertEqual(outcome, "deleted_draft")
        self.assertIsNone(flight.accounting_entry_uuid)
        self.assertEqual(flight.billing_quote_state, "pending")
        self.assertIsNone(flight.has_discount)
        db.delete.assert_any_call(entry)
        db.commit.assert_awaited()

    async def test_posted_entry_creates_draft_reversal_without_posting(self):
        entry_uuid = uuid4()
        fy_uuid = uuid4()
        flight = ValidatedFlight(
            uuid=uuid4(), accounting_entry_uuid=entry_uuid,
            billing_quote_state="applied", planche_uuid="flight-9",
        )
        entry = AccountingEntry(
            uuid=entry_uuid, fiscal_year_uuid=fy_uuid, journal_uuid=uuid4(),
            entry_date=date(2026, 1, 1), state=2, created_by=1,
        )

        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[
            _result(scalar=flight),
            _result(scalar=entry),
        ])

        service = FlightBillingApplyService(db)
        with patch("services.accounting.create_reversal_entry", new=AsyncMock()) as mock_reverse:
            outcome = await service.reverse_flight_billing_for_deletion(flight.uuid, user_id=7)

        mock_reverse.assert_awaited_once()
        self.assertEqual(mock_reverse.await_args.args[1], entry_uuid)
        self.assertEqual(outcome, "reversal_created")
        self.assertEqual(flight.billing_quote_state, "reversed")
        # Posted entry is left untouched — audit trail stays intact.
        self.assertEqual(flight.accounting_entry_uuid, entry_uuid)

    async def test_posted_entry_without_numeric_user_is_skipped(self):
        entry_uuid = uuid4()
        flight = ValidatedFlight(uuid=uuid4(), accounting_entry_uuid=entry_uuid, billing_quote_state="applied")
        entry = AccountingEntry(
            uuid=entry_uuid, fiscal_year_uuid=uuid4(), journal_uuid=uuid4(),
            entry_date=date(2026, 1, 1), state=2, created_by=1,
        )

        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[
            _result(scalar=flight),
            _result(scalar=entry),
        ])

        service = FlightBillingApplyService(db)
        outcome = await service.reverse_flight_billing_for_deletion(flight.uuid, user_id=None)

        self.assertEqual(outcome, "skipped_no_user")
        self.assertEqual(flight.billing_quote_state, "applied")
        db.commit.assert_not_called()
