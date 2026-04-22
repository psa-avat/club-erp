"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - accounting audit logging tests: ensure privileged actions emit audit log entries
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
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from api.routes import accounting
from schemas.accounting import (
    AccountingEntryPostRequest,
    AccountingEntryReverseRequest,
    PricingVersionCreateRequest,
    SystemSettingUpdateRequest,
)


class AccountingAuditLoggingTests(IsolatedAsyncioTestCase):
    async def test_close_fiscal_year_logs_audit(self):
        db = AsyncMock()
        user = SimpleNamespace(id=101)
        fy = SimpleNamespace(uuid=uuid4(), code="FY2026", state=2)

        with patch("api.routes.accounting.close_fiscal_year", new=AsyncMock(return_value=fy)), patch(
            "api.routes.accounting.logger"
        ) as logger_mock:
            await accounting.close_fiscal_year_endpoint(fy.uuid, db=db, current_user=user)

        logger_mock.info.assert_called_once()
        self.assertIn("close_fiscal_year", logger_mock.info.call_args.args)

    async def test_reopen_fiscal_year_logs_audit(self):
        db = AsyncMock()
        user = SimpleNamespace(id=102)
        fy = SimpleNamespace(uuid=uuid4(), code="FY2026", state=3)

        with patch("api.routes.accounting.reopen_fiscal_year", new=AsyncMock(return_value=fy)), patch(
            "api.routes.accounting.logger"
        ) as logger_mock:
            await accounting.reopen_fiscal_year_endpoint(fy.uuid, db=db, current_user=user)

        logger_mock.info.assert_called_once()
        self.assertIn("reopen_fiscal_year", logger_mock.info.call_args.args)

    async def test_post_entry_logs_audit(self):
        db = AsyncMock()
        user = SimpleNamespace(id=103)
        entry = SimpleNamespace(
            uuid=uuid4(),
            fiscal_year_uuid=uuid4(),
            sequence_number="FY2026-001",
            state=2,
        )

        with patch("api.routes.accounting.post_accounting_entry", new=AsyncMock(return_value=entry)), patch(
            "api.routes.accounting.logger"
        ) as logger_mock:
            await accounting.post_entry_endpoint(
                entry.uuid,
                entry.fiscal_year_uuid,
                request=AccountingEntryPostRequest(),
                db=db,
                current_user=user,
            )

        logger_mock.info.assert_called_once()
        self.assertIn("post_entry", logger_mock.info.call_args.args)

    async def test_reverse_entry_logs_audit(self):
        db = AsyncMock()
        user = SimpleNamespace(id=104)
        reversal = SimpleNamespace(
            uuid=uuid4(),
            fiscal_year_uuid=uuid4(),
            reversal_of_entry_uuid=uuid4(),
        )

        request = AccountingEntryReverseRequest(
            fiscal_year_uuid=reversal.fiscal_year_uuid,
            reversal_reason="Correction",
        )

        with patch("api.routes.accounting.create_reversal_entry", new=AsyncMock(return_value=reversal)), patch(
            "api.routes.accounting.logger"
        ) as logger_mock:
            await accounting.reverse_entry_endpoint(
                entry_uuid=uuid4(),
                request=request,
                db=db,
                current_user=user,
            )

        logger_mock.info.assert_called_once()
        self.assertIn("reverse_entry", logger_mock.info.call_args.args)

    async def test_upsert_system_setting_logs_audit(self):
        db = AsyncMock()
        user = SimpleNamespace(id=105)
        setting = SimpleNamespace(module_name="accounting")

        with patch("api.routes.accounting.upsert_system_setting", new=AsyncMock(return_value=setting)), patch(
            "api.routes.accounting.logger"
        ) as logger_mock:
            await accounting.update_system_setting_endpoint(
                module_name="accounting",
                request=SystemSettingUpdateRequest(settings={"posting": {"strict": True}}),
                db=db,
                current_user=user,
            )

        logger_mock.info.assert_called_once()
        self.assertIn("upsert_system_setting", logger_mock.info.call_args.args)

    async def test_create_pricing_version_logs_audit(self):
        db = AsyncMock()
        user = SimpleNamespace(id=106)
        version = SimpleNamespace(uuid=uuid4(), fiscal_year_uuid=uuid4())

        with patch("api.routes.accounting.create_pricing_version", new=AsyncMock(return_value=version)), patch(
            "api.routes.accounting.logger"
        ) as logger_mock:
            await accounting.create_pricing_version_endpoint(
                request=PricingVersionCreateRequest(
                    fiscal_year_uuid=version.fiscal_year_uuid,
                    name="Pricing 2026",
                    from_date=date(2026, 1, 1),
                    to_date=date(2026, 12, 31),
                    status=1,
                ),
                db=db,
                current_user=user,
            )

        logger_mock.info.assert_called_once()
        self.assertIn("create_pricing_version", logger_mock.info.call_args.args)

    async def test_update_pricing_version_logs_audit(self):
        db = AsyncMock()
        user = SimpleNamespace(id=107)
        version = SimpleNamespace(uuid=uuid4(), fiscal_year_uuid=uuid4())

        with patch("api.routes.accounting.update_pricing_version", new=AsyncMock(return_value=version)), patch(
            "api.routes.accounting.logger"
        ) as logger_mock:
            await accounting.update_pricing_version_endpoint(
                version_uuid=version.uuid,
                request=accounting.PricingVersionUpdateRequest(name="Updated pricing"),
                db=db,
                current_user=user,
            )

        logger_mock.info.assert_called_once()
        self.assertIn("update_pricing_version", logger_mock.info.call_args.args)

    async def test_delete_pricing_version_logs_audit(self):
        db = AsyncMock()
        user = SimpleNamespace(id=108)
        version_uuid = uuid4()

        with patch("api.routes.accounting.delete_pricing_version", new=AsyncMock(return_value=None)), patch(
            "api.routes.accounting.logger"
        ) as logger_mock:
            await accounting.delete_pricing_version_endpoint(
                version_uuid=version_uuid,
                db=db,
                current_user=user,
            )

        logger_mock.info.assert_called_once()
        self.assertIn("delete_pricing_version", logger_mock.info.call_args.args)
