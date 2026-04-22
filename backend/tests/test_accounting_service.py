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
