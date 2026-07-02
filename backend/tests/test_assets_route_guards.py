"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - assets route guard tests: category routes removed, /children endpoint guarded
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

from api.routes.assets import router


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == f"/api/v1/assets{path}" and method in getattr(route, "methods", set()):
            return route
    return None


class AssetsRouteGuardTests(TestCase):
    def test_category_routes_no_longer_registered(self):
        removed = [
            ("/categories", "GET"),
            ("/categories", "POST"),
            ("/categories/{category_uuid}", "GET"),
            ("/categories/{category_uuid}", "PATCH"),
            ("/categories/{category_uuid}", "DELETE"),
        ]
        for path, method in removed:
            self.assertIsNone(_route(path, method), f"Category route {method} {path} should have been removed")

    def test_children_endpoint_registered_with_view_guard(self):
        route = _route("/{asset_uuid}/children", "GET")
        self.assertIsNotNone(route, "Missing GET /{asset_uuid}/children route")

        dependency_names = [
            dependency.call.__name__
            for dependency in route.dependant.dependencies
            if getattr(dependency, "call", None) is not None
        ]
        self.assertIn(
            "_capability_guard",
            dependency_names,
            "Capability guard dependency missing on GET /{asset_uuid}/children",
        )

    def test_list_assets_endpoint_supports_new_filters(self):
        route = _route("", "GET")
        self.assertIsNotNone(route)
        param_names = {p.name for p in route.dependant.query_params}
        self.assertIn("parent_asset_uuid", param_names)
        self.assertIn("is_bookable", param_names)
        self.assertNotIn("category_uuid", param_names)
