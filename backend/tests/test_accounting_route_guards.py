"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - accounting route guard tests: ensure privileged endpoints enforce capability checks
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

from unittest import TestCase

from api.routes.accounting import router


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == f"/api/v1/accounting{path}" and method in getattr(route, "methods", set()):
            return route
    return None


class AccountingRouteGuardTests(TestCase):
    def test_privileged_routes_include_capability_guard_dependency(self):
        privileged = [
            ("/fiscal-years/{fiscal_year_uuid}/close", "PATCH"),
            ("/fiscal-years/{fiscal_year_uuid}/reopen", "PATCH"),
            ("/entries/{entry_uuid}/post", "PATCH"),
            ("/entries/{entry_uuid}/reverse", "POST"),
            ("/settings", "GET"),
            ("/settings/{module_name}", "GET"),
            ("/settings/{module_name}", "PUT"),
            ("/pricing/versions", "POST"),
            ("/pricing/versions", "GET"),
            ("/pricing/versions/{version_uuid}", "GET"),
            ("/pricing/versions/{version_uuid}", "PATCH"),
            ("/pricing/versions/{version_uuid}", "DELETE"),
        ]

        for path, method in privileged:
            route = _route(path, method)
            self.assertIsNotNone(route, f"Missing route {method} {path}")

            dependency_names = [
                dependency.call.__name__
                for dependency in route.dependant.dependencies
                if getattr(dependency, "call", None) is not None
            ]
            self.assertIn(
                "_capability_guard",
                dependency_names,
                f"Capability guard dependency missing on {method} {path}",
            )
