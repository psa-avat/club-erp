"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi route guard tests: ensure VI privileged endpoints include capability guard dependency
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
"""

from unittest import TestCase

from api.routes.vi import router


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == f"/api/v1/vi{path}" and method in getattr(route, "methods", set()):
            return route
    return None


class ViRouteGuardTests(TestCase):
    def test_privileged_routes_include_capability_guard_dependency(self):
        privileged = [
            ("/types", "GET"),
            ("/types", "POST"),
            ("/types/{type_uuid}", "PATCH"),
            ("/entitlements", "GET"),
            ("/entitlements", "POST"),
            ("/entitlements/{entitlement_uuid}/notes", "PATCH"),
            ("/planning/bulk-schedule", "POST"),
            ("/staging", "GET"),
            ("/staging/promote", "POST"),
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
