"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - accounting tests: verify state rules, validation guards, partitions, and PCG seed behavior
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
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from schemas.accounting import AccountingEntryUpdateRequest, AccountingLineCreateRequest
from services.accounting import (
    PCG_ASSOCIATION_SEED,
    _normal_balance_for_account_type,
    create_accounting_entry,
    create_reversal_entry,
    ensure_fiscal_year_partitions,
    get_active_fiscal_year,
    post_accounting_entries_batch,
    post_accounting_entry,
    seed_association_pcg_accounts,
    update_accounting_entry,
    validate_entry_balance,
    validate_entry_date_in_fy,
)


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def scalar(self):
        if not self._rows:
            return None
        return self._rows[0]


class _FakeDialect:
    def __init__(self, name: str):
        self.name = name


class _FakeBind:
    def __init__(self, name: str):
        self.dialect = _FakeDialect(name)


class _FakeDb:
    def __init__(self, dialect_name: str = "sqlite", existing_accounts=None):
        self._bind = _FakeBind(dialect_name)
        self._existing_accounts = existing_accounts or []
        self.executed = []
        self.added = []
        self.committed = False

    def get_bind(self):
        return self._bind

    async def execute(self, *_args, **_kwargs):
        self.executed.append((_args, _kwargs))
        return _FakeResult(self._existing_accounts)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    async def refresh(self, *_args, **_kwargs):
        return None

    async def commit(self):
        self.committed = True


class AccountingServiceTests(IsolatedAsyncioTestCase):
    async def test_update_rejects_non_draft_entries(self):
        entry = SimpleNamespace(state=2)
        db = AsyncMock()
        request = AccountingEntryUpdateRequest(description="x")

        with patch("services.accounting.get_accounting_entry", new=AsyncMock(return_value=entry)):
            with self.assertRaises(HTTPException) as ctx:
                await update_accounting_entry(db, uuid4(), uuid4(), request, 1)

        self.assertEqual(ctx.exception.status_code, 409)

    async def test_post_rejects_non_draft_entries(self):
        entry = SimpleNamespace(state=2)
        db = AsyncMock()

        with patch("services.accounting.get_accounting_entry", new=AsyncMock(return_value=entry)):
            with self.assertRaises(HTTPException) as ctx:
                await post_accounting_entry(db, uuid4(), uuid4())

        self.assertEqual(ctx.exception.status_code, 409)

    async def test_post_batch_posts_entries_in_order_and_deduplicates(self):
        db = AsyncMock()
        fiscal_year_uuid = uuid4()
        first_uuid = uuid4()
        second_uuid = uuid4()
        first_posted = SimpleNamespace(uuid=first_uuid)
        second_posted = SimpleNamespace(uuid=second_uuid)

        with patch(
            "services.accounting.post_accounting_entry",
            new=AsyncMock(side_effect=[first_posted, second_posted]),
        ) as post_mock:
            result = await post_accounting_entries_batch(
                db=db,
                fiscal_year_uuid=fiscal_year_uuid,
                entry_uuids=[first_uuid, second_uuid, first_uuid],
            )

        self.assertEqual(result, [first_posted, second_posted])
        self.assertEqual(post_mock.await_count, 2)
        self.assertEqual(post_mock.await_args_list[0].kwargs["entry_uuid"], first_uuid)
        self.assertEqual(post_mock.await_args_list[1].kwargs["entry_uuid"], second_uuid)

    async def test_validate_entry_date_in_fiscal_year_boundaries(self):
        fy = SimpleNamespace(start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))

        await validate_entry_date_in_fy(date(2026, 6, 1), fy)

        with self.assertRaises(HTTPException) as ctx:
            await validate_entry_date_in_fy(date(2027, 1, 1), fy)

        self.assertEqual(ctx.exception.status_code, 400)

    async def test_validate_entry_balance(self):
        balanced = [
            AccountingLineCreateRequest(account_uuid=uuid4(), debit=Decimal("10.0000"), credit=Decimal("0.0000")),
            AccountingLineCreateRequest(account_uuid=uuid4(), debit=Decimal("0.0000"), credit=Decimal("10.0000")),
        ]
        await validate_entry_balance(balanced)

        unbalanced = [
            AccountingLineCreateRequest(account_uuid=uuid4(), debit=Decimal("10.0000"), credit=Decimal("0.0000")),
            AccountingLineCreateRequest(account_uuid=uuid4(), debit=Decimal("0.0000"), credit=Decimal("9.0000")),
        ]
        with self.assertRaises(HTTPException) as ctx:
            await validate_entry_balance(unbalanced)

        self.assertEqual(ctx.exception.status_code, 400)

    async def test_sql_has_boundary_and_balance_and_immutability_triggers(self):
        sql_path = Path(__file__).resolve().parents[2] / "docs" / "account.sql"
        sql_content = sql_path.read_text(encoding="utf-8")

        self.assertIn("check_entry_fiscal_year_boundary", sql_content)
        self.assertIn("check_accounting_entry_balance", sql_content)
        self.assertIn("prevent_posted_entry_modification", sql_content)
        self.assertIn("prevent_posted_line_modification", sql_content)

    async def test_partition_routine_noop_on_sqlite(self):
        db = _FakeDb(dialect_name="sqlite")

        await ensure_fiscal_year_partitions(db, uuid4(), "FY2026")

        self.assertEqual(len(db.executed), 0)

    async def test_partition_routine_executes_on_postgresql(self):
        db = _FakeDb(dialect_name="postgresql")

        await ensure_fiscal_year_partitions(db, uuid4(), "FY2026")

        self.assertEqual(len(db.executed), 4)

    async def test_seed_loader_inserts_association_pcg_subset(self):
        db = _FakeDb(dialect_name="sqlite", existing_accounts=[])

        result = await seed_association_pcg_accounts(db)

        self.assertEqual(result["inserted"], len(PCG_ASSOCIATION_SEED))
        self.assertTrue(db.committed)

        created_codes = {account.code for account in db.added}
        for required in {"411", "512", "530", "7061", "7062", "7063", "194", "689", "789"}:
            self.assertIn(required, created_codes)

    async def test_seed_loader_sets_expected_postability_flags(self):
        db = _FakeDb(dialect_name="sqlite", existing_accounts=[])

        await seed_association_pcg_accounts(db)

        by_code = {account.code: account for account in db.added}
        self.assertFalse(by_code["1"].is_posting_allowed)
        self.assertFalse(by_code["4"].is_posting_allowed)
        self.assertFalse(by_code["6"].is_posting_allowed)
        self.assertFalse(by_code["7"].is_posting_allowed)
        self.assertTrue(by_code["411"].is_posting_allowed)
        self.assertTrue(by_code["7062"].is_posting_allowed)
        self.assertTrue(by_code["789"].is_posting_allowed)

    async def test_default_normal_balance_mapping(self):
        self.assertEqual(_normal_balance_for_account_type(1), 1)
        self.assertEqual(_normal_balance_for_account_type(4), 1)
        self.assertEqual(_normal_balance_for_account_type(2), 2)
        self.assertEqual(_normal_balance_for_account_type(3), 2)
        self.assertEqual(_normal_balance_for_account_type(5), 2)

    async def test_service_flow_create_update_post_reverse(self):
        db = _FakeDb(dialect_name="sqlite", existing_accounts=[])
        fiscal_year_uuid = uuid4()
        journal_uuid = uuid4()
        account_debit_uuid = uuid4()
        account_credit_uuid = uuid4()

        fy = SimpleNamespace(
            uuid=fiscal_year_uuid,
            code="FY2026",
            state=1,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        journal = SimpleNamespace(uuid=journal_uuid)

        create_request = SimpleNamespace(
            fiscal_year_uuid=fiscal_year_uuid,
            journal_uuid=journal_uuid,
            entry_date=date(2026, 6, 1),
            reference="REF-1",
            description="Initial draft",
            source_system=None,
            external_id=None,
            import_batch_id=None,
            lines=[
                AccountingLineCreateRequest(
                    account_uuid=account_debit_uuid,
                    debit=Decimal("25.0000"),
                    credit=Decimal("0.0000"),
                ),
                AccountingLineCreateRequest(
                    account_uuid=account_credit_uuid,
                    debit=Decimal("0.0000"),
                    credit=Decimal("25.0000"),
                ),
            ],
        )

        with patch("services.accounting.validate_fiscal_year_open", new=AsyncMock(return_value=fy)), patch(
            "services.accounting.get_journal", new=AsyncMock(return_value=journal)
        ), patch("services.accounting.get_account", new=AsyncMock(return_value=SimpleNamespace())):
            entry = await create_accounting_entry(db, create_request, user_id=7)

        self.assertEqual(entry.state, 1)
        self.assertEqual(entry.description, "Initial draft")
        self.assertEqual(len(entry.lines), 2)

        update_request = AccountingEntryUpdateRequest(
            description="Updated draft",
            lines=[
                AccountingLineCreateRequest(
                    account_uuid=account_debit_uuid,
                    debit=Decimal("30.0000"),
                    credit=Decimal("0.0000"),
                ),
                AccountingLineCreateRequest(
                    account_uuid=account_credit_uuid,
                    debit=Decimal("0.0000"),
                    credit=Decimal("30.0000"),
                ),
            ],
        )

        with patch("services.accounting.get_accounting_entry", new=AsyncMock(return_value=entry)), patch(
            "services.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=fy)
        ), patch(
            "services.accounting.get_account", new=AsyncMock(return_value=SimpleNamespace())
        ):
            updated = await update_accounting_entry(db, entry.uuid, fiscal_year_uuid, update_request, user_id=7)

        self.assertEqual(updated.state, 1)
        self.assertEqual(updated.description, "Updated draft")
        self.assertEqual(len(updated.lines), 2)
        self.assertEqual(updated.lines[0].debit, Decimal("30.0000"))

        with patch("services.accounting.get_accounting_entry", new=AsyncMock(return_value=updated)), patch(
            "services.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=fy)
        ):
            posted = await post_accounting_entry(db, updated.uuid, fiscal_year_uuid)

        self.assertEqual(posted.state, 2)
        self.assertTrue(posted.sequence_number.startswith("FY2026-"))
        self.assertEqual(len(posted.entry_hash), 64)

        with patch("services.accounting.get_accounting_entry", new=AsyncMock(return_value=posted)), patch(
            "services.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=fy)
        ):
            reversal = await create_reversal_entry(
                db=db,
                entry_uuid=posted.uuid,
                fiscal_year_uuid=fiscal_year_uuid,
                reversal_reason="Correction",
                user_id=7,
                entry_date=posted.entry_date,
            )

        self.assertEqual(reversal.state, 1)
        self.assertEqual(reversal.reversal_of_entry_uuid, posted.uuid)
        self.assertEqual(len(reversal.lines), len(posted.lines))
        self.assertEqual(reversal.lines[0].debit, posted.lines[0].credit)
        self.assertEqual(reversal.lines[0].credit, posted.lines[0].debit)


class TestAccountingImportHelpers(unittest.TestCase):
    """Unit tests for the pure CSV parsing and grouping helpers (no DB required)."""

    def test_parse_csv_rows_basic(self):
        from services.accounting import _parse_csv_rows
        csv_bytes = (
            b"date,label,account_code,member_account_id,debit,credit\n"
            b"01/01/2026,Test 411,411,ME2026-0001,100.00,0.00\n"
            b"01/01/2026,Test 110,110,,0.00,100.00\n"
        )
        rows = _parse_csv_rows(csv_bytes)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["account_code"], "411")
        self.assertEqual(rows[0]["member_account_id"], "ME2026-0001")
        self.assertEqual(rows[1]["account_code"], "110")

    def test_parse_csv_rows_strips_bom(self):
        from services.accounting import _parse_csv_rows
        csv_bytes = (
            b"\xef\xbb\xbf"  # UTF-8 BOM
            b"date,label,account_code,member_account_id,debit,credit\n"
            b"01/01/2026,X,110,,50.00,50.00\n"
        )
        rows = _parse_csv_rows(csv_bytes)
        self.assertEqual(len(rows), 1)
        self.assertIn("date", rows[0])

    def test_group_two_balanced_entries(self):
        from services.accounting import _group_into_entries
        rows = [
            {"debit": "100.00", "credit": "0.00"},
            {"debit": "0.00",   "credit": "100.00"},
            {"debit": "50.00",  "credit": "0.00"},
            {"debit": "0.00",   "credit": "50.00"},
        ]
        groups = _group_into_entries(rows)
        self.assertEqual(len(groups), 2)
        self.assertEqual(len(groups[0]), 2)
        self.assertEqual(len(groups[1]), 2)

    def test_unbalanced_tail_is_own_group(self):
        from services.accounting import _group_into_entries
        rows = [
            {"debit": "100.00", "credit": "0.00"},
            {"debit": "0.00",   "credit": "100.00"},
            {"debit": "75.00",  "credit": "0.00"},  # no matching credit
        ]
        groups = _group_into_entries(rows)
        self.assertEqual(len(groups), 2)
        self.assertEqual(len(groups[1]), 1)

    def test_multi_line_balanced_entry(self):
        from services.accounting import _group_into_entries
        rows = [
            {"debit": "100.00", "credit": "0.00"},
            {"debit": "50.00",  "credit": "0.00"},
            {"debit": "0.00",   "credit": "150.00"},
        ]
        groups = _group_into_entries(rows)
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 3)

    def test_group_uses_reference_across_non_contiguous_rows(self):
        from services.accounting import _group_into_entries

        rows = [
            {"date": "25/04/2025", "journal": "AC", "label": "OVH DU 4/4 N°175", "debit": "30.05", "credit": "0.00"},
            {"date": "25/04/2025", "journal": "AC", "label": "OVH DU 4/4 N°175", "debit": "0.00", "credit": "124.95"},
            {"date": "25/04/2025", "journal": "AC", "label": "Batteries 12V 8Ah x6 N°117", "debit": "239.94", "credit": "0.00"},
            {"date": "25/04/2025", "journal": "AC", "label": "AMAZON N°117", "debit": "0.00", "credit": "239.94"},
            {"date": "25/04/2025", "journal": "AC", "label": "OVH Abont du 1/4/25 au 31/3/26 N°175", "debit": "94.90", "credit": "0.00"},
        ]

        groups = _group_into_entries(rows)

        self.assertEqual(len(groups), 2)
        self.assertEqual(len(groups[0]), 3)
        self.assertEqual([row["label"] for row in groups[0]], [
            "OVH DU 4/4 N°175",
            "OVH DU 4/4 N°175",
            "OVH Abont du 1/4/25 au 31/3/26 N°175",
        ])
        self.assertEqual(len(groups[1]), 2)

    def test_group_without_reference_splits_on_date_change(self):
        from services.accounting import _group_into_entries

        rows = [
            {"date": "25/04/2025", "journal": "AC", "label": "No ref debit", "debit": "30.05", "credit": "0.00"},
            {"date": "26/04/2025", "journal": "AC", "label": "No ref credit", "debit": "0.00", "credit": "30.05"},
        ]

        groups = _group_into_entries(rows)

        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0][0]["date"], "25/04/2025")
        self.assertEqual(groups[1][0]["date"], "26/04/2025")

    def test_entry_key_is_deterministic(self):
        from services.accounting import _make_entry_key
        rows = [
            {
                "date": "01/01/2026", "label": "Test", "account_code": "411",
                "member_account_id": "ME2026-0001", "debit": "100.00", "credit": "0.00",
            }
        ]
        self.assertEqual(_make_entry_key(rows), _make_entry_key(rows))

    def test_entry_key_differs_for_different_rows(self):
        from services.accounting import _make_entry_key
        rows_a = [{"date": "01/01/2026", "label": "A", "account_code": "411",
                   "member_account_id": "ME2026-0001", "debit": "100.00", "credit": "0.00"}]
        rows_b = [{"date": "01/01/2026", "label": "B", "account_code": "411",
                   "member_account_id": "ME2026-0002", "debit": "100.00", "credit": "0.00"}]
        self.assertNotEqual(_make_entry_key(rows_a), _make_entry_key(rows_b))

    def test_entry_key_differs_for_different_journals(self):
        from services.accounting import _make_entry_key
        rows_a = [{"date": "01/01/2026", "journal": "BQ", "label": "A", "account_code": "411",
                   "member_account_id": "ME2026-0001", "debit": "100.00", "credit": "0.00"}]
        rows_b = [{"date": "01/01/2026", "journal": "CA", "label": "A", "account_code": "411",
                   "member_account_id": "ME2026-0001", "debit": "100.00", "credit": "0.00"}]
        self.assertNotEqual(_make_entry_key(rows_a), _make_entry_key(rows_b))

    def test_group_closes_when_journal_changes(self):
        from services.accounting import _group_into_entries
        rows = [
            {"journal": "BQ", "debit": "100.00", "credit": "0.00"},
            {"journal": "CA", "debit": "0.00", "credit": "100.00"},
        ]
        groups = _group_into_entries(rows)
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0][0]["journal"], "BQ")
        self.assertEqual(groups[1][0]["journal"], "CA")

    def test_resolve_group_journal_code_prefers_csv_value(self):
        from services.accounting import _resolve_group_journal_code
        journal_code, errors = _resolve_group_journal_code(
            [{"journal": "BQ"}, {"journal": "BQ"}],
            "AN",
        )
        self.assertEqual(journal_code, "BQ")
        self.assertEqual(errors, [])

    def test_resolve_group_journal_code_falls_back_when_missing(self):
        from services.accounting import _resolve_group_journal_code
        journal_code, errors = _resolve_group_journal_code(
            [{"journal": ""}, {}],
            "AN",
        )
        self.assertEqual(journal_code, "AN")
        self.assertEqual(errors, [])

    def test_resolve_group_journal_code_rejects_multiple_journals(self):
        from services.accounting import _resolve_group_journal_code
        journal_code, errors = _resolve_group_journal_code(
            [{"journal": "BQ"}, {"journal": "CA"}],
            "AN",
        )
        self.assertIsNone(journal_code)
        self.assertEqual(errors, ["Entry spans multiple journals: BQ, CA"])

    def test_parse_date_ddmmYYYY(self):
        from services.accounting import _parse_accounting_import_date
        from datetime import date
        self.assertEqual(_parse_accounting_import_date("01/01/2026"), date(2026, 1, 1))
        self.assertEqual(_parse_accounting_import_date("31/12/2025"), date(2025, 12, 31))

    def test_parse_date_ddmmYY(self):
        from services.accounting import _parse_accounting_import_date
        from datetime import date
        self.assertEqual(_parse_accounting_import_date("01/01/26"), date(2026, 1, 1))

    def test_parse_date_invalid_raises(self):
        from services.accounting import _parse_accounting_import_date
        with self.assertRaises(ValueError):
            _parse_accounting_import_date("2026-01-01")
        with self.assertRaises(ValueError):
            _parse_accounting_import_date("not-a-date")


class TestGetActiveFiscalYear(IsolatedAsyncioTestCase):
    """Tests for get_active_fiscal_year service function."""

    def _make_fy(self, uuid=None, state=1, year=2026, end_date=None):
        from datetime import date as d
        return SimpleNamespace(
            uuid=uuid or uuid4(),
            state=state,
            year=year,
            end_date=end_date or d(year, 12, 31),
        )

    async def test_returns_open_fiscal_year(self):
        open_fy = self._make_fy(state=1, year=2026)

        class _Res:
            def __init__(self, row):
                self._row = row
            def scalar_one_or_none(self):
                return self._row

        db = AsyncMock()
        db.execute.return_value = _Res(open_fy)

        result = await get_active_fiscal_year(db)
        self.assertEqual(result.state, 1)
        self.assertEqual(result.year, 2026)

    async def test_returns_reopened_fiscal_year(self):
        reopened_fy = self._make_fy(state=3, year=2025)

        class _Res:
            def __init__(self, row):
                self._row = row
            def scalar_one_or_none(self):
                return self._row

        db = AsyncMock()
        db.execute.return_value = _Res(reopened_fy)

        result = await get_active_fiscal_year(db)
        self.assertEqual(result.state, 3)

    async def test_falls_back_to_latest_closed_when_no_open(self):
        closed_fy = self._make_fy(state=2, year=2024)

        call_count = 0

        class _Res:
            def __init__(self, row):
                self._row = row
            def scalar_one_or_none(self):
                return self._row

        async def _execute(*_a, **_kw):
            nonlocal call_count
            call_count += 1
            # First call (open query) returns None, second (fallback) returns closed FY
            return _Res(None if call_count == 1 else closed_fy)

        db = AsyncMock()
        db.execute.side_effect = _execute

        result = await get_active_fiscal_year(db)
        self.assertEqual(result.state, 2)
        self.assertEqual(result.year, 2024)

    async def test_raises_404_when_no_fiscal_years_exist(self):
        class _Res:
            def scalar_one_or_none(self):
                return None

        db = AsyncMock()
        db.execute.return_value = _Res()

        with self.assertRaises(HTTPException) as ctx:
            await get_active_fiscal_year(db)
        self.assertEqual(ctx.exception.status_code, 404)
