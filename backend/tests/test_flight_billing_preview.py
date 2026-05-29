"""
    ERP-CLUB - ERP pour Club de vol a voile
    - flight billing preview tests
"""

from datetime import date
import sys
import types
from decimal import Decimal
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock
from uuid import uuid4

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


from api.routes.flights import router
from models import AccountingAccount, Asset, Member, PricingItem, PricingItemTier, PricingVersion, ValidatedFlight
from services.flight_billing import FlightBillingPreviewService, _Payer, _PricedMachine


class FlightBillingPreviewServiceTests(IsolatedAsyncioTestCase):
    def _objects(self, *, pack_price=Decimal("50.0000")):
        member = Member(
            uuid=uuid4(),
            first_name="Jean",
            last_name="Dupont",
            account_id="M001",
            member_category=1,
        )
        asset = Asset(
            uuid=uuid4(),
            asset_type_uuid=uuid4(),
            code="F-CABC",
            registration="F-CABC",
            name="Club glider",
        )
        debit = AccountingAccount(
            uuid=uuid4(),
            code="411",
            name="Members",
            type=1,
            normal_balance=1,
        )
        credit = AccountingAccount(
            uuid=uuid4(),
            code="7062",
            name="Flights",
            type=5,
            normal_balance=2,
        )
        version = PricingVersion(
            uuid=uuid4(),
            fiscal_year_uuid=uuid4(),
            name="Glider 2026",
            from_date=date(2026, 1, 1),
            status=2,
            use_pack=True,
        )
        item = PricingItem(
            uuid=uuid4(),
            pricing_version_uuid=version.uuid,
            name="Flight hour",
            unit=1,
            base_price=Decimal("100.0000"),
            pack_price=pack_price,
            gl_account_credit_uuid=credit.uuid,
        )
        item.gl_account_credit = credit
        item.tiers = []
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="planche-1",
            jour=date(2026, 5, 1),
            asset_code="F-CABC",
            pilot_erp_id="M001",
            type_of_flight=1,
            launch_method=0,
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )
        return member, asset, debit, credit, version, item, flight

    async def test_preview_uses_pack_price_without_persisting_pack_state(self):
        member, asset, debit, _credit, version, item, flight = self._objects()
        service = FlightBillingPreviewService(AsyncMock())
        service._get_receivable_account = AsyncMock(return_value=debit)
        service._resolve_payers = AsyncMock(return_value=[_Payer(member, "pilot", Decimal("1"), "solo")])
        service._resolve_machine = AsyncMock(return_value=_PricedMachine("flight", asset, version, [item]))
        pack_balances = {(member.uuid, 2026): Decimal("2.00")}

        preview = await service._preview_one(flight, pack_balances)

        self.assertTrue(preview.can_apply)
        self.assertEqual(preview.total_amount, Decimal("50.0000"))
        self.assertEqual(len(preview.applied_lines), 1)
        self.assertEqual(preview.applied_lines[0].discount_reason, "pack")
        self.assertEqual(preview.applied_lines[0].pack_hours_used, Decimal("1.0000"))
        self.assertEqual(pack_balances[(member.uuid, 2026)], Decimal("1.0000"))
        self.assertEqual(len(preview.accounting_lines), 2)
        self.assertEqual(preview.accounting_lines[0].account_code, "411")
        self.assertEqual(preview.accounting_lines[1].account_code, "7062")

    async def test_preview_splits_partial_pack_hours(self):
        member, asset, debit, _credit, version, item, flight = self._objects()
        service = FlightBillingPreviewService(AsyncMock())
        service._get_receivable_account = AsyncMock(return_value=debit)
        service._resolve_payers = AsyncMock(return_value=[_Payer(member, "pilot", Decimal("1"), "solo")])
        service._resolve_machine = AsyncMock(return_value=_PricedMachine("flight", asset, version, [item]))
        pack_balances = {(member.uuid, 2026): Decimal("0.50")}

        preview = await service._preview_one(flight, pack_balances)

        self.assertTrue(preview.can_apply)
        self.assertEqual(preview.total_amount, Decimal("75.0000"))
        self.assertEqual(len(preview.applied_lines), 2)
        self.assertEqual(preview.applied_lines[0].quantity, Decimal("0.50"))
        self.assertEqual(preview.applied_lines[0].discount_reason, "pack")
        self.assertEqual(preview.applied_lines[1].quantity, Decimal("0.5000"))
        self.assertIsNone(preview.applied_lines[1].discount_reason)
        self.assertEqual(pack_balances[(member.uuid, 2026)], Decimal("0.00"))

    async def test_progressive_shared_flight_uses_full_quantity_before_split(self):
        member, asset, debit, credit, version, item, flight = self._objects(pack_price=None)
        second_member = Member(
            uuid=uuid4(),
            first_name="Claire",
            last_name="Martin",
            account_id="M002",
            member_category=1,
        )
        item.base_price = Decimal("100.0000")
        item.is_progressive = True
        item.tiers = [
            PricingItemTier(from_qty=Decimal("0.7500"), price=Decimal("50.0000"), pack_price=None, sort_order=1),
        ]
        item.gl_account_credit = credit

        service = FlightBillingPreviewService(AsyncMock())
        service._get_receivable_account = AsyncMock(return_value=debit)
        service._resolve_payers = AsyncMock(
            return_value=[
                _Payer(member, "pilot", Decimal("0.5"), "shared"),
                _Payer(second_member, "second_pilot", Decimal("0.5"), "shared"),
            ]
        )
        service._resolve_machine = AsyncMock(return_value=_PricedMachine("flight", asset, version, [item]))

        preview = await service._preview_one(flight, {})

        self.assertTrue(preview.can_apply)
        self.assertEqual(preview.total_amount, Decimal("87.5000"))
        self.assertEqual(len(preview.applied_lines), 2)
        self.assertEqual(preview.applied_lines[0].quantity, Decimal("0.5000"))
        self.assertEqual(preview.applied_lines[0].amount, Decimal("43.7500"))
        self.assertEqual(preview.applied_lines[1].quantity, Decimal("0.5000"))
        self.assertEqual(preview.applied_lines[1].amount, Decimal("43.7500"))

    def test_launch_tow_without_launch_type_uses_rmq_code(self):
        service = FlightBillingPreviewService(AsyncMock())
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="planche-rmq",
            jour=date(2026, 5, 1),
            asset_code="PLA-005",
            pilot_erp_id="M001",
            type_of_flight=3,
            launch_method=2,
            launch_type=None,
            takeoff_time="10:00",
            landing_time="10:30",
            landing_count=1,
            validated_by="test",
        )

        self.assertIn("RMQ", service._flight_type_codes_for_machine("launch", flight))

        flight.launch_type = 0
        self.assertIn("RMQ", service._flight_type_codes_for_machine("launch", flight))

    def test_main_machine_keeps_main_flight_type(self):
        service = FlightBillingPreviewService(AsyncMock())
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="planche-partage",
            jour=date(2026, 5, 1),
            asset_code="PLA-005",
            pilot_erp_id="M001",
            type_of_flight=3,
            launch_method=2,
            launch_type=None,
            takeoff_time="10:00",
            landing_time="10:30",
            landing_count=1,
            validated_by="test",
        )

        codes = service._flight_type_codes_for_machine("flight", flight)

        self.assertIn("partage", codes)
        self.assertNotIn("RMQ", codes)



class FlightBillingPreviewRouteTests(TestCase):
    def test_billing_preview_routes_are_registered(self):
        paths = {(route.path, tuple(sorted(getattr(route, "methods", set())))) for route in router.routes}

        self.assertIn(("/api/v1/flights/{flight_uuid}/billing-preview", ("POST",)), paths)
        self.assertIn(("/api/v1/flights/billing-preview", ("POST",)), paths)
