"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - fiscal year close readiness tests: close_fiscal_year() must refuse to
      close while drafts/unreconciled lines/discrepancies remain, and the
      close-readiness endpoint must report the same checks.
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
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from api.routes.accounting import get_fiscal_year_close_readiness_endpoint, router
from constants import CAP_POST_ACCOUNTING_ENTRIES, CAP_VIEW_FINANCIALS
from services.accounting import close_fiscal_year


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == f"/api/v1/accounting{path}" and method in getattr(route, "methods", set()):
            return route
    return None


def _required_capability(route) -> str | None:
    for dependency in route.dependant.dependencies:
        call = getattr(dependency, "call", None)
        if call is None or call.__name__ != "_capability_guard":
            continue
        freevars = call.__code__.co_freevars
        if "capability_code" not in freevars:
            continue
        index = freevars.index("capability_code")
        return call.__closure__[index].cell_contents
    return None


ZERO_COUNTS = {
    "draft_entries_count": 0,
    "unreconciled_bank_lines_count": 0,
    "reconciliation_discrepancies_count": 0,
    "missing_required_tiers_count": 0,
    "due_recurring_entries_count": 0,
}


class CloseFiscalYearBlockingTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.fy = SimpleNamespace(uuid=uuid4(), code="FY2026", state=1)
        self.db = AsyncMock()

    async def _run_close(self, counts: dict, reports_balanced: bool = True):
        with patch(
            "services.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=self.fy)
        ), patch(
            "services.bank_reconciliation.get_accounting_health_counts", new=AsyncMock(return_value=counts)
        ), patch(
            "services.accounting.accounting_reports_are_balanced", new=AsyncMock(return_value=reports_balanced)
        ):
            return await close_fiscal_year(self.db, self.fy.uuid, user_id=1)

    async def test_close_blocked_by_draft_entries(self):
        counts = {**ZERO_COUNTS, "draft_entries_count": 2}
        with self.assertRaises(HTTPException) as ctx:
            await self._run_close(counts)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail["unposted_entries_count"], 2)

    async def test_close_blocked_by_unreconciled_line(self):
        counts = {**ZERO_COUNTS, "unreconciled_bank_lines_count": 3}
        with self.assertRaises(HTTPException) as ctx:
            await self._run_close(counts)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail["unreconciled_bank_lines_count"], 3)

    async def test_close_blocked_by_discrepancy(self):
        counts = {**ZERO_COUNTS, "reconciliation_discrepancies_count": 1}
        with self.assertRaises(HTTPException) as ctx:
            await self._run_close(counts)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail["discrepancy_count"], 1)

    async def test_close_blocked_when_reports_not_balanced(self):
        with self.assertRaises(HTTPException) as ctx:
            await self._run_close(ZERO_COUNTS, reports_balanced=False)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertFalse(ctx.exception.detail["reports_balanced"])

    async def test_close_allowed_when_all_checks_pass(self):
        result = await self._run_close(ZERO_COUNTS)
        self.assertEqual(result, self.fy)
        self.db.commit.assert_awaited_once()

    async def test_close_blocked_when_already_closed_before_checking_counts(self):
        self.fy.state = 2
        counts_mock = AsyncMock(return_value=ZERO_COUNTS)
        with patch(
            "services.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=self.fy)
        ), patch("services.bank_reconciliation.get_accounting_health_counts", new=counts_mock):
            with self.assertRaises(HTTPException) as ctx:
                await close_fiscal_year(self.db, self.fy.uuid, user_id=1)
        self.assertEqual(ctx.exception.status_code, 409)
        counts_mock.assert_not_awaited()


class CloseReadinessEndpointTests(IsolatedAsyncioTestCase):
    async def test_can_close_true_when_all_checks_pass(self):
        fy = SimpleNamespace(uuid=uuid4(), code="FY2026", state=1)
        db = AsyncMock()
        with patch(
            "api.routes.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=fy)
        ), patch(
            "api.routes.accounting.get_accounting_health_counts", new=AsyncMock(return_value=ZERO_COUNTS)
        ), patch(
            "api.routes.accounting.accounting_reports_are_balanced", new=AsyncMock(return_value=True)
        ):
            result = await get_fiscal_year_close_readiness_endpoint(fy.uuid, db=db)
        self.assertTrue(result.can_close)
        self.assertFalse(result.has_unposted_entries)
        self.assertFalse(result.has_unreconciled_bank_lines)
        self.assertFalse(result.has_reconciliation_discrepancies)

    async def test_can_close_false_when_discrepancies_remain(self):
        fy = SimpleNamespace(uuid=uuid4(), code="FY2026", state=1)
        db = AsyncMock()
        counts = {**ZERO_COUNTS, "reconciliation_discrepancies_count": 4}
        with patch(
            "api.routes.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=fy)
        ), patch(
            "api.routes.accounting.get_accounting_health_counts", new=AsyncMock(return_value=counts)
        ), patch(
            "api.routes.accounting.accounting_reports_are_balanced", new=AsyncMock(return_value=True)
        ):
            result = await get_fiscal_year_close_readiness_endpoint(fy.uuid, db=db)
        self.assertFalse(result.can_close)
        self.assertTrue(result.has_reconciliation_discrepancies)
        self.assertEqual(result.discrepancy_count, 4)


class PermissionsUnchangedTests(TestCase):
    def test_close_readiness_requires_view_financials_not_post(self):
        route = _route("/fiscal-years/{fiscal_year_uuid}/close-readiness", "GET")
        self.assertIsNotNone(route, "Missing route GET .../close-readiness")
        self.assertEqual(_required_capability(route), CAP_VIEW_FINANCIALS)

    def test_close_and_reopen_still_require_post_accounting_entries(self):
        for path in ["/fiscal-years/{fiscal_year_uuid}/close", "/fiscal-years/{fiscal_year_uuid}/reopen"]:
            route = _route(path, "PATCH")
            self.assertIsNotNone(route, f"Missing route PATCH {path}")
            self.assertEqual(_required_capability(route), CAP_POST_ACCOUNTING_ENTRIES)
