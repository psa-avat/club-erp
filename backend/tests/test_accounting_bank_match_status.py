"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - accounting tests: bank-reconciliation status enrichment on journal entries
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
from unittest.mock import AsyncMock
from uuid import uuid4

from sqlalchemy import select

from models import AccountingEntry
from services.accounting import _apply_accounting_entry_filters, _enrich_bank_match_status


class _FakeRowsResult:
    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class EnrichBankMatchStatusTests(IsolatedAsyncioTestCase):
    async def test_sets_match_and_statement_status_for_matched_entry(self):
        entry = SimpleNamespace(uuid=uuid4(), fiscal_year_uuid=uuid4())
        db = AsyncMock()
        db.execute = AsyncMock(
            return_value=_FakeRowsResult([(entry.uuid, entry.fiscal_year_uuid, "auto_matched", "reconciled")])
        )

        await _enrich_bank_match_status(db, [entry])

        self.assertEqual(entry.bank_match_status, "auto_matched")
        self.assertEqual(entry.bank_statement_status, "reconciled")

    async def test_leaves_unmatched_entry_with_none_status(self):
        entry = SimpleNamespace(uuid=uuid4(), fiscal_year_uuid=uuid4())
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeRowsResult([]))

        await _enrich_bank_match_status(db, [entry])

        self.assertIsNone(entry.bank_match_status)
        self.assertIsNone(entry.bank_statement_status)

    async def test_skips_query_entirely_when_no_entries(self):
        db = AsyncMock()

        await _enrich_bank_match_status(db, [])

        db.execute.assert_not_called()

    async def test_maps_each_entry_independently_by_uuid_and_fiscal_year(self):
        entry_a = SimpleNamespace(uuid=uuid4(), fiscal_year_uuid=uuid4())
        entry_b = SimpleNamespace(uuid=uuid4(), fiscal_year_uuid=uuid4())
        db = AsyncMock()
        db.execute = AsyncMock(
            return_value=_FakeRowsResult(
                [(entry_a.uuid, entry_a.fiscal_year_uuid, "manually_matched", "matching")]
            )
        )

        await _enrich_bank_match_status(db, [entry_a, entry_b])

        self.assertEqual(entry_a.bank_match_status, "manually_matched")
        self.assertEqual(entry_a.bank_statement_status, "matching")
        self.assertIsNone(entry_b.bank_match_status)
        self.assertIsNone(entry_b.bank_statement_status)


class BankReconciliationStateFilterTests(IsolatedAsyncioTestCase):
    """_apply_accounting_entry_filters is synchronous (pure SQL construction) — verify
    the bank_reconciliation_state branch shapes the expected EXISTS/NOT EXISTS clause
    without needing a database, matching this file's existing SQL-string-assertion
    style used elsewhere in the reconciliation test suite."""

    def _filtered_sql(self, bank_reconciliation_state):
        stmt = _apply_accounting_entry_filters(select(AccountingEntry), bank_reconciliation_state=bank_reconciliation_state)
        return str(stmt)

    def test_no_filter_when_state_is_none(self):
        sql = self._filtered_sql(None)
        self.assertNotIn("bank_statement_lines", sql)

    def test_unreconciled_uses_not_exists(self):
        sql = self._filtered_sql("unreconciled")
        self.assertIn("NOT (EXISTS", sql)
        self.assertIn("bank_statement_lines", sql)

    def test_associated_excludes_reconciled_statements(self):
        sql = self._filtered_sql("associated")
        self.assertIn("EXISTS", sql)
        self.assertIn("bank_statements.status != ", sql)

    def test_reconciled_requires_reconciled_statement(self):
        sql = self._filtered_sql("reconciled")
        self.assertIn("EXISTS", sql)
        self.assertIn("bank_statements.status = ", sql)

    def test_discrepancy_filters_on_match_status(self):
        sql = self._filtered_sql("discrepancy")
        self.assertIn("EXISTS", sql)
        self.assertIn("match_status = ", sql)

    def test_unknown_value_is_ignored(self):
        sql = self._filtered_sql("not-a-real-state")
        self.assertNotIn("bank_statement_lines", sql)


class AccountSensFilterTests(IsolatedAsyncioTestCase):
    """account_sens (debit/credit/both) narrows the account_code EXISTS clause —
    verify the SQL shape without needing a database, matching this file's
    existing SQL-string-assertion style."""

    def _filtered_sql(self, account_code=None, account_sens=None):
        stmt = _apply_accounting_entry_filters(
            select(AccountingEntry), account_code=account_code, account_sens=account_sens
        )
        return str(stmt)

    def test_no_filter_when_both_are_none(self):
        sql = self._filtered_sql()
        self.assertNotIn("accounting_lines", sql)

    def test_account_code_alone_has_no_debit_credit_condition(self):
        sql = self._filtered_sql(account_code="512")
        self.assertIn("EXISTS", sql)
        self.assertIn("accounting_accounts.code", sql)
        self.assertNotIn("accounting_lines.debit >", sql)
        self.assertNotIn("accounting_lines.credit >", sql)

    def test_debit_adds_debit_condition(self):
        sql = self._filtered_sql(account_code="512", account_sens="debit")
        self.assertIn("EXISTS", sql)
        self.assertIn("accounting_lines.debit >", sql)
        self.assertNotIn("accounting_lines.credit >", sql)

    def test_credit_adds_credit_condition(self):
        sql = self._filtered_sql(account_code="512", account_sens="credit")
        self.assertIn("EXISTS", sql)
        self.assertIn("accounting_lines.credit >", sql)
        self.assertNotIn("accounting_lines.debit >", sql)

    def test_sens_alone_without_account_code_still_filters(self):
        sql = self._filtered_sql(account_sens="debit")
        self.assertIn("EXISTS", sql)
        self.assertIn("accounting_lines.debit >", sql)

    def test_unknown_sens_value_is_ignored(self):
        sql = self._filtered_sql(account_sens="sideways")
        self.assertNotIn("accounting_lines", sql)
