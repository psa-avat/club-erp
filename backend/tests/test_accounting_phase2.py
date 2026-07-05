"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - accounting phase 2 tests: system settings and pricing version constraints
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
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from schemas.accounting import PricingVersionCreateRequest, SystemSettingUpdateRequest
from schemas.accounting import PricingVersionUpdateRequest
from services.accounting import (
    DEFAULT_SYSTEM_SETTINGS,
    PRICING_STATUS_ACTIVE,
    PRICING_STATUS_ARCHIVED,
    PRICING_STATUS_DRAFT,
    _validate_pricing_status_transition,
    create_pricing_version,
    ensure_default_system_settings,
    update_pricing_version,
    upsert_system_setting,
)


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalar_one_or_none(self):
        if not self._rows:
            return None
        return self._rows[0]

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeDb:
    def __init__(self, execute_results=None):
        self.execute_results = list(execute_results or [])
        self.added = []
        self.committed = False

    async def execute(self, *_args, **_kwargs):
        if not self.execute_results:
            return _FakeResult([])
        return self.execute_results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True

    async def refresh(self, *_args, **_kwargs):
        return None


class _FakeVersion:
    def __init__(self, *, fiscal_year_uuid, status=PRICING_STATUS_ACTIVE, to_date=None):
        self.uuid = uuid4()
        self.fiscal_year_uuid = fiscal_year_uuid
        self.asset_family_uuid = None
        self.name = "Active pricing"
        self.from_date = date(2026, 1, 1)
        self.to_date = to_date
        self.status = status
        self.is_locked = False
        self.use_pack = True


class AccountingPhase2ServiceTests(IsolatedAsyncioTestCase):
    def test_validate_pricing_status_transition_allows_active_to_draft(self):
        _validate_pricing_status_transition(PRICING_STATUS_ACTIVE, PRICING_STATUS_DRAFT)

    async def test_default_settings_initializer_inserts_missing_modules(self):
        existing = SimpleNamespace(module_name="accounting")
        db = _FakeDb(execute_results=[_FakeResult([existing])])

        result = await ensure_default_system_settings(db)

        expected_total = len(DEFAULT_SYSTEM_SETTINGS)
        self.assertEqual(result["inserted"], expected_total - 1)
        self.assertEqual(result["total_defaults"], expected_total)
        self.assertEqual(len(db.added), expected_total - 1)
        self.assertTrue(db.committed)

    async def test_default_settings_initializer_noop_when_all_exist(self):
        existing_modules = [
            SimpleNamespace(module_name=module_name) for module_name in DEFAULT_SYSTEM_SETTINGS
        ]
        db = _FakeDb(execute_results=[_FakeResult(existing_modules)])

        result = await ensure_default_system_settings(db)

        self.assertEqual(result["inserted"], 0)
        self.assertEqual(len(db.added), 0)

    async def test_upsert_system_setting_creates_row(self):
        db = _FakeDb(execute_results=[_FakeResult([])])

        setting = await upsert_system_setting(
            db,
            module_name="Accounting",
            request=SystemSettingUpdateRequest(settings={"numbering": {"prefix": "FY"}}),
            user_id=42,
        )

        self.assertEqual(setting.module_name, "accounting")
        self.assertEqual(setting.settings["numbering"]["prefix"], "FY")
        self.assertEqual(setting.updated_by, 42)
        self.assertTrue(db.committed)
        self.assertEqual(len(db.added), 1)

    async def test_upsert_system_setting_updates_existing_row(self):
        existing = SimpleNamespace(module_name="accounting", settings={"old": True}, updated_by=1)
        db = _FakeDb(execute_results=[_FakeResult([existing])])

        setting = await upsert_system_setting(
            db,
            module_name="accounting",
            request=SystemSettingUpdateRequest(settings={"old": False, "new": True}),
            user_id=99,
        )

        self.assertEqual(setting.settings["new"], True)
        self.assertEqual(setting.updated_by, 99)
        self.assertEqual(len(db.added), 0)

    async def test_create_pricing_version_rejects_overlap(self):
        fiscal_year_uuid = uuid4()
        fy = SimpleNamespace(
            uuid=fiscal_year_uuid,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        existing = SimpleNamespace(
            uuid=uuid4(),
            from_date=date(2026, 1, 1),
            to_date=date(2026, 6, 30),
        )
        db = _FakeDb(execute_results=[_FakeResult([existing])])

        request = PricingVersionCreateRequest(
            fiscal_year_uuid=fiscal_year_uuid,
            name="Summer pricing",
            from_date=date(2026, 6, 15),
            to_date=date(2026, 12, 31),
            status=1,
        )

        with patch("services.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=fy)):
            with self.assertRaises(HTTPException) as cm:
                await create_pricing_version(db, request, user_id=7, asset_family_uuid=None)

        self.assertEqual(cm.exception.status_code, 409)

    async def test_create_pricing_version_success(self):
        fiscal_year_uuid = uuid4()
        fy = SimpleNamespace(
            uuid=fiscal_year_uuid,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        db = _FakeDb(execute_results=[_FakeResult([])])

        request = PricingVersionCreateRequest(
            fiscal_year_uuid=fiscal_year_uuid,
            name="Pricing 2026",
            from_date=date(2026, 1, 1),
            to_date=date(2026, 12, 31),
            status=PRICING_STATUS_DRAFT,
        )

        with patch("services.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=fy)):
            version = await create_pricing_version(db, request, user_id=7, asset_family_uuid=None)

        self.assertEqual(version.name, "Pricing 2026")
        self.assertEqual(version.status, PRICING_STATUS_DRAFT)
        self.assertTrue(db.committed)
        self.assertEqual(len(db.added), 1)

    async def test_update_pricing_version_archive_defaults_end_date_to_today(self):
        fiscal_year_uuid = uuid4()
        fy = SimpleNamespace(
            uuid=fiscal_year_uuid,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        version = _FakeVersion(fiscal_year_uuid=fiscal_year_uuid, status=PRICING_STATUS_ACTIVE)
        db = _FakeDb(execute_results=[_FakeResult([])])

        request = PricingVersionUpdateRequest(status=PRICING_STATUS_ARCHIVED)

        with patch("services.accounting.get_pricing_version", new=AsyncMock(return_value=version)), patch(
            "services.accounting.get_or_create_fiscal_year", new=AsyncMock(return_value=fy)
        ):
            updated = await update_pricing_version(db, version.uuid, request)

        self.assertEqual(updated.status, PRICING_STATUS_ARCHIVED)
        self.assertEqual(updated.to_date, date.today())

    async def test_sql_contains_phase2_tables(self):
        sql_path = Path(__file__).resolve().parents[2] / "docs" / "account.sql"
        sql_content = sql_path.read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE system_settings", sql_content)
        self.assertIn("CREATE TABLE pricing_versions", sql_content)
        self.assertIn("chk_pricing_version_dates", sql_content)
