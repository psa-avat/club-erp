"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - test_pcg_seed: tests for PCG seed JSON read/write endpoints and semantic validation
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

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.routes.accounting import router
from services.accounting import (
    export_pcg_seed,
    import_pcg_seed,
    validate_pcg_seed_items,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_SEED = [
    {"code": "4", "name": "Comptes de tiers", "type": 1, "is_posting_allowed": False, "is_reconcilable": False},
    {"code": "41", "name": "Clients", "type": 1, "is_posting_allowed": False, "is_reconcilable": False},
    {"code": "411", "name": "Membres", "type": 1, "is_posting_allowed": True, "is_reconcilable": True},
]


# ---------------------------------------------------------------------------
# validate_pcg_seed_items – pure logic, no I/O
# ---------------------------------------------------------------------------

class ValidatePcgSeedItemsTests(TestCase):
    def test_valid_list_returns_no_errors(self):
        errors = validate_pcg_seed_items(_VALID_SEED)
        self.assertEqual(errors, [])

    def test_duplicate_codes_are_reported(self):
        items = [
            {"code": "4", "name": "A", "type": 1, "is_posting_allowed": True, "is_reconcilable": False},
            {"code": "4", "name": "B", "type": 1, "is_posting_allowed": True, "is_reconcilable": False},
        ]
        errors = validate_pcg_seed_items(items)
        self.assertTrue(any("Duplicate code" in e for e in errors), errors)

    def test_missing_parent_is_reported(self):
        # Code "411" with no "41" or "4" parent in the list
        items = [
            {"code": "411", "name": "Membres", "type": 1, "is_posting_allowed": True, "is_reconcilable": True},
        ]
        errors = validate_pcg_seed_items(items)
        self.assertTrue(any("411" in e for e in errors), errors)

    def test_root_codes_need_no_parent(self):
        items = [
            {"code": "6", "name": "Charges", "type": 4, "is_posting_allowed": False, "is_reconcilable": False},
        ]
        errors = validate_pcg_seed_items(items)
        self.assertEqual(errors, [])

    def test_invalid_type_is_reported(self):
        items = [
            {"code": "4", "name": "Comptes de tiers", "type": 99, "is_posting_allowed": True, "is_reconcilable": False},
        ]
        errors = validate_pcg_seed_items(items)
        self.assertTrue(any("type" in e.lower() for e in errors), errors)

    def test_empty_code_is_reported(self):
        items = [
            {"code": "", "name": "No code", "type": 1, "is_posting_allowed": True, "is_reconcilable": False},
        ]
        errors = validate_pcg_seed_items(items)
        self.assertTrue(any("empty" in e.lower() for e in errors), errors)


# ---------------------------------------------------------------------------
# export_pcg_seed / import_pcg_seed – disk I/O tested with a temp file
# ---------------------------------------------------------------------------

class PcgSeedDiskTests(TestCase):
    def _make_temp_seed(self, data: list[dict]) -> Path:
        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        )
        json.dump(data, tmp, ensure_ascii=False, indent=2)
        tmp.flush()
        return Path(tmp.name)

    def test_export_returns_file_contents(self):
        tmp_path = self._make_temp_seed(_VALID_SEED)
        with patch("services.accounting._PCG_SEED_PATH", tmp_path):
            result = export_pcg_seed()
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["code"], "4")
        tmp_path.unlink(missing_ok=True)

    def test_export_returns_empty_list_when_file_missing(self):
        missing = Path("/nonexistent/path/pcg_seed.json")
        with patch("services.accounting._PCG_SEED_PATH", missing):
            result = export_pcg_seed()
        self.assertEqual(result, [])

    def test_import_writes_new_content_to_disk(self):
        tmp_path = self._make_temp_seed(_VALID_SEED)
        new_data = [{"code": "7", "name": "Produits", "type": 5, "is_posting_allowed": False, "is_reconcilable": False}]
        with patch("services.accounting._PCG_SEED_PATH", tmp_path):
            import_pcg_seed(new_data)
            result = export_pcg_seed()
        self.assertEqual(result, new_data)
        tmp_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Route guard: pcg-seed endpoints must carry the capability guard
# ---------------------------------------------------------------------------

class PcgSeedRouteGuardTests(TestCase):
    def _find_route(self, path: str, method: str):
        for route in router.routes:
            if (
                getattr(route, "path", None) == f"/api/v1/accounting{path}"
                and method in getattr(route, "methods", set())
            ):
                return route
        return None

    def _dependency_names(self, route) -> list[str]:
        return [
            dep.call.__name__
            for dep in route.dependant.dependencies
            if getattr(dep, "call", None) is not None
        ]

    def test_get_pcg_seed_requires_capability_guard(self):
        route = self._find_route("/accounts/pcg-seed", "GET")
        self.assertIsNotNone(route)
        self.assertIn("_capability_guard", self._dependency_names(route))

    def test_put_pcg_seed_requires_capability_guard(self):
        route = self._find_route("/accounts/pcg-seed", "PUT")
        self.assertIsNotNone(route)
        self.assertIn("_capability_guard", self._dependency_names(route))


# ---------------------------------------------------------------------------
# HTTP integration: GET and PUT /accounts/pcg-seed
# ---------------------------------------------------------------------------

def _make_admin_user():
    return SimpleNamespace(
        id=1,
        role_id=1,
        capabilities=["CAP_MANAGE_ACCOUNTING_SETTINGS"],
    )


def _override_auth(user):
    """Return a dependency override dict that bypasses auth for TestClient."""
    from api.security import get_current_user, require_capability

    overrides = {}

    async def _fake_user():
        return user

    overrides[get_current_user] = _fake_user

    # Override every capability guard by returning the user unconditionally.
    for route in router.routes:
        for dep in getattr(getattr(route, "dependant", None), "dependencies", []):
            if getattr(getattr(dep, "call", None), "__name__", "") == "_capability_guard":
                overrides[dep.call] = _fake_user

    return overrides


class PcgSeedHttpTests(IsolatedAsyncioTestCase):
    def _client(self, seed_data: list[dict]):
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)
        user = _make_admin_user()
        app.dependency_overrides = _override_auth(user)
        return app, TestClient(app, raise_server_exceptions=True)

    def test_get_returns_seed_items(self):
        app, client = self._client(_VALID_SEED)
        with patch("services.accounting._PCG_SEED_PATH", _VALID_SEED) as _:
            with patch("api.routes.accounting.export_pcg_seed", return_value=_VALID_SEED):
                response = client.get("/api/v1/accounting/accounts/pcg-seed")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 3)
        self.assertEqual(len(body["items"]), 3)

    def test_put_rejects_duplicate_codes(self):
        app, client = self._client([])
        duplicate_payload = {
            "items": [
                {"code": "4", "name": "A", "type": 1, "is_posting_allowed": True, "is_reconcilable": False},
                {"code": "4", "name": "B", "type": 1, "is_posting_allowed": True, "is_reconcilable": False},
            ]
        }
        response = client.put("/api/v1/accounting/accounts/pcg-seed", json=duplicate_payload)
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertIn("errors", body.get("detail", {}))

    def test_put_rejects_missing_parent(self):
        app, client = self._client([])
        orphan_payload = {
            "items": [
                {"code": "411", "name": "Membres", "type": 1, "is_posting_allowed": True, "is_reconcilable": True},
            ]
        }
        response = client.put("/api/v1/accounting/accounts/pcg-seed", json=orphan_payload)
        self.assertEqual(response.status_code, 422)

    def test_put_valid_payload_writes_and_returns_items(self):
        app, client = self._client([])
        with (
            patch("api.routes.accounting.validate_pcg_seed_items", return_value=[]),
            patch("api.routes.accounting.import_pcg_seed"),
            patch("api.routes.accounting._log_accounting_audit"),
        ):
            response = client.put(
                "/api/v1/accounting/accounts/pcg-seed",
                json={"items": [item for item in _VALID_SEED]},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 3)
