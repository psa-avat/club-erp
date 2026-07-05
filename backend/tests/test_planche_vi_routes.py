"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - planche vi route tests: ensure VI push/reconcile endpoints include capability guard dependency
    Copyright (C) 2026  SAFORCADA Patrick
"""

from unittest import TestCase

import sys
import types


if "httpx" not in sys.modules:
    httpx_stub = types.ModuleType("httpx")
    httpx_stub.AsyncClient = object
    httpx_stub.Response = object
    httpx_stub.TimeoutException = TimeoutError
    httpx_stub.NetworkError = OSError
    httpx_stub.RequestError = OSError
    sys.modules["httpx"] = httpx_stub

if "aioboto3" not in sys.modules:
    sys.modules["aioboto3"] = types.ModuleType("aioboto3")

from api.routes.planche import router


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == f"/api/v1/planche{path}" and method in getattr(route, "methods", set()):
            return route
    return None


class PlancheViRouteGuardTests(TestCase):
    def test_vi_sync_routes_include_capability_guard_dependency(self):
        privileged = [
            ("/vi/push", "POST"),
            ("/vi/reconcile", "POST"),
            ("/vi/full-sync", "POST"),
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
