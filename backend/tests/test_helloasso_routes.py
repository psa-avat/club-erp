"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - helloasso route tests: verify capability guard coverage and connection workflow
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

from fastapi import HTTPException

from api.routes.helloasso import (
    list_helloasso_purchases_endpoint,
    router,
    test_helloasso_connection_endpoint,
)
from schemas.helloasso import HelloAssoSettingsPayload


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == f"/api/v1/helloasso{path}" and method in getattr(route, "methods", set()):
            return route
    return None


class HelloAssoRouteGuardTests(TestCase):
    def test_privileged_routes_include_capability_guard_dependency(self):
        privileged = [
            ("/settings", "GET"),
            ("/settings", "PUT"),
            ("/settings/test-connection", "POST"),
            ("/purchases", "GET"),
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


class HelloAssoConnectionTests(IsolatedAsyncioTestCase):
    async def test_connection_returns_first_organization_slug(self):
        payload = HelloAssoSettingsPayload(
            client_id="abc",
            client_secret="xyz",
            environment="production",
        )
        user = SimpleNamespace(id=42)

        with patch(
            "api.routes.helloasso._run_in_thread",
            new=AsyncMock(
                side_effect=[
                    (200, {"access_token": "token-123"}),
                    (200, [{"organizationSlug": "club-test"}]),
                ]
            ),
        ):
            response = await test_helloasso_connection_endpoint(payload, None, user)

        self.assertTrue(response.success)
        self.assertEqual(response.organization_slug, "club-test")
        self.assertEqual(response.organizations_count, 1)

    async def test_connection_raises_when_credentials_are_invalid(self):
        payload = HelloAssoSettingsPayload(
            client_id="bad",
            client_secret="creds",
            environment="production",
        )
        user = SimpleNamespace(id=7)

        with patch(
            "api.routes.helloasso._run_in_thread",
            new=AsyncMock(return_value=(401, {"error": "invalid_client"})),
        ):
            with self.assertRaises(HTTPException) as context:
                await test_helloasso_connection_endpoint(payload, None, user)

        self.assertEqual(context.exception.status_code, 502)


class HelloAssoPurchasesTests(IsolatedAsyncioTestCase):
    async def test_purchases_items_active(self):
        db = AsyncMock()
        user = SimpleNamespace(id=99)
        setting = SimpleNamespace(
            settings={
                "client_id": "cid",
                "client_secret": "sec",
            }
        )

        with patch(
            "api.routes.helloasso.get_system_setting",
            new=AsyncMock(return_value=setting),
        ), patch(
            "api.routes.helloasso._run_in_thread",
            new=AsyncMock(
                side_effect=[
                    (200, {"access_token": "token-123"}),
                    (200, [{"organizationSlug": "club-test"}]),
                    (
                        200,
                        {
                            "data": [
                                {
                                    "id": 321,
                                    "state": "Processed",
                                    "amount": 2500,
                                    "payer": {
                                        "firstName": "Alice",
                                        "lastName": "Martin",
                                        "email": "alice@example.org",
                                    },
                                    "order": {
                                        "id": 123,
                                        "date": "2026-05-15T09:30:00Z",
                                    },
                                    "payments": [
                                        {
                                            "id": 999,
                                            "state": "Authorized",
                                            "date": "2026-05-15T09:31:00Z",
                                        }
                                    ],
                                }
                            ]
                        },
                    ),
                ]
            ),
        ):
            response = await list_helloasso_purchases_endpoint("active", "items", None, 100, db, None, user)

        self.assertEqual(response.organization_slug, "club-test")
        self.assertEqual(response.count, 1)
        self.assertEqual(response.purchases[0].id, 321)
        self.assertEqual(response.purchases[0].order_id, 123)
        self.assertEqual(response.purchases[0].email, "alice@example.org")
