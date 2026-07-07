"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - general ledger tests: route guard and input-validation error paths.
      The core running-balance/opening-balance/pagination-invariant logic was
      verified against a real Postgres instance in a rolled-back transaction
      (too many joined tables/window-style aggregation to usefully mock).
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

from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from api.routes.accounting import router
from constants import CAP_VIEW_FINANCIALS
from services.accounting import get_general_ledger


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


class GeneralLedgerRouteGuardTests(TestCase):
    def test_requires_view_financials(self):
        route = _route("/reports/general-ledger", "GET")
        self.assertIsNotNone(route, "Missing route GET /reports/general-ledger")
        self.assertEqual(_required_capability(route), CAP_VIEW_FINANCIALS)


class GeneralLedgerValidationTests(IsolatedAsyncioTestCase):
    async def test_raises_400_when_no_account_identifier_given(self):
        db = AsyncMock()
        with self.assertRaises(HTTPException) as ctx:
            await get_general_ledger(db, fiscal_year_uuid=uuid4())
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_raises_404_when_account_code_not_found(self):
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=None)
        with self.assertRaises(HTTPException) as ctx:
            await get_general_ledger(db, fiscal_year_uuid=uuid4(), account_code="9999")
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_raises_404_when_account_uuid_not_found(self):
        db = AsyncMock()
        with patch("services.accounting.get_account", new=AsyncMock(side_effect=HTTPException(status_code=404))):
            with self.assertRaises(HTTPException) as ctx:
                await get_general_ledger(db, fiscal_year_uuid=uuid4(), account_uuid=uuid4())
            self.assertEqual(ctx.exception.status_code, 404)
