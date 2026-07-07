"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - accounting health tests: aggregate cockpit/close-readiness counts and the
      MANAGE_ACCOUNTING_SETTINGS vs MANAGE_SYSTEM_SETTINGS guard split
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
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock

from api.routes.accounting import router
from constants import CAP_MANAGE_ACCOUNTING_SETTINGS, CAP_MANAGE_SYSTEM_SETTINGS, CAP_VIEW_FINANCIALS
from services.scheduled_entries import _due_template_conditions, count_due_entry_templates


# ---------------------------------------------------------------------------
# count_due_entry_templates — read-only, no side effects
# ---------------------------------------------------------------------------


class CountDueEntryTemplatesTests(IsolatedAsyncioTestCase):
    async def test_returns_scalar_count(self):
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=4)

        result = await count_due_entry_templates(db)

        self.assertEqual(result, 4)
        db.scalar.assert_awaited_once()

    async def test_returns_zero_when_scalar_is_none(self):
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=None)

        result = await count_due_entry_templates(db)

        self.assertEqual(result, 0)

    def test_conditions_shape_is_stable(self):
        today = date(2026, 7, 7)
        conditions = _due_template_conditions(today)
        self.assertEqual(len(conditions), 4)


# ---------------------------------------------------------------------------
# Route guards — capability introspection, mirrors test_accounting_route_guards.py
# ---------------------------------------------------------------------------


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == f"/api/v1/accounting{path}" and method in getattr(route, "methods", set()):
            return route
    return None


def _required_capability(route) -> str | None:
    """Extract the capability code closed over by require_capability()'s guard."""
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


class AccountingSettingsGuardSplitTests(TestCase):
    """Fiscal years, PCG seed, and entry-model templates should require the
    accounting-specific capability, matching the frontend's gating — not the
    broader system-settings capability."""

    def test_health_endpoint_requires_view_financials(self):
        route = _route("/health", "GET")
        self.assertIsNotNone(route, "Missing route GET /health")
        self.assertEqual(_required_capability(route), CAP_VIEW_FINANCIALS)

    def test_accounting_domain_settings_require_accounting_capability(self):
        accounting_settings_routes = [
            ("/fiscal-years", "POST"),
            ("/accounts/seed-pcg", "POST"),
            ("/accounts/pcg-seed", "GET"),
            ("/accounts/pcg-seed", "PUT"),
            ("/entry-models", "POST"),
            ("/entry-models/{template_uuid}", "PATCH"),
            ("/entry-models/{template_uuid}", "DELETE"),
        ]
        for path, method in accounting_settings_routes:
            route = _route(path, method)
            self.assertIsNotNone(route, f"Missing route {method} {path}")
            self.assertEqual(
                _required_capability(route),
                CAP_MANAGE_ACCOUNTING_SETTINGS,
                f"{method} {path} should require MANAGE_ACCOUNTING_SETTINGS",
            )

    def test_generic_module_settings_still_require_system_capability(self):
        """Regression guard: only the accounting-domain routes above should have
        moved — the generic, multi-module /settings endpoints must stay on
        MANAGE_SYSTEM_SETTINGS."""
        generic_settings_routes = [
            ("/settings", "GET"),
            ("/settings/{module_name}", "GET"),
            ("/settings/{module_name}", "PUT"),
        ]
        for path, method in generic_settings_routes:
            route = _route(path, method)
            self.assertIsNotNone(route, f"Missing route {method} {path}")
            self.assertEqual(_required_capability(route), CAP_MANAGE_SYSTEM_SETTINGS)
