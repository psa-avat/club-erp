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
    httpx_stub.Auth = object  # services.gesasso_client.WsseAuth subclasses this
    sys.modules["httpx"] = httpx_stub

if "aioboto3" not in sys.modules:
    sys.modules["aioboto3"] = types.ModuleType("aioboto3")


from api.routes.flights import router
from models import AccountingAccount, Asset, FlightBillingCategory, FlightTypeBillingAccount, Member, PricingItem, PricingItemTier, PricingVersion, ValidatedFlight
from services.flight_billing import FlightBillingPreviewService, _Payer, _PricedMachine

TYPE_OF_FLIGHT_ESSAI = 7


class _FakeScalarResult:
    def __init__(self, values):
        self._values = values

    def unique(self):
        return self

    def all(self):
        return self._values


class _FakeExecuteResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return _FakeScalarResult(self._values)


class FlightBillingPreviewServiceTests(IsolatedAsyncioTestCase):
    def _objects(self):
        member = Member(
            uuid=uuid4(),
            first_name="Jean",
            last_name="Dupont",
            account_id="M001",
            member_category=1,
        )
        asset = Asset(
            uuid=uuid4(),
            asset_family_uuid=uuid4(),
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

    def _club_billed_flight(self, type_of_flight: int, charge_to_erp_id: str | None = None) -> ValidatedFlight:
        return ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="planche-club",
            jour=date(2026, 5, 1),
            asset_code="F-CABC",
            pilot_erp_id="M001",
            charge_to_erp_id=charge_to_erp_id,
            type_of_flight=type_of_flight,
            launch_method=0,
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )

    def _category_row(
        self, category: int, cost_code: str, reflection_code: str = "902", member: Member | None = None
    ) -> FlightTypeBillingAccount:
        cost_account = AccountingAccount(uuid=uuid4(), code=cost_code, name=f"Cout {cost_code}", type=9)
        reflection_account = AccountingAccount(uuid=uuid4(), code=reflection_code, name="Reflet", type=9)
        row = FlightTypeBillingAccount(
            uuid=uuid4(),
            billing_category=category,
            member_uuid=member.uuid if member else None,
            analytical_cost_account_uuid=cost_account.uuid,
            analytical_reflection_account_uuid=reflection_account.uuid,
        )
        row.member = member
        row.analytical_cost_account = cost_account
        row.analytical_reflection_account = reflection_account
        return row

    async def test_resolve_club_billing_applies_essai_row_via_its_own_sentinel(self):
        essai_member = Member(uuid=uuid4(), first_name="Essai", last_name="ERP", account_id="ESSAI", member_category=1)
        essai_row = self._category_row(FlightBillingCategory.ESSAI, "923", member=essai_member)

        service = FlightBillingPreviewService(AsyncMock())
        service._type_billing_accounts = {FlightBillingCategory.ESSAI: essai_row}
        service._billing_settings = types.SimpleNamespace(default_initiation_charge_account_uuid=None)
        flight = self._club_billed_flight(TYPE_OF_FLIGHT_ESSAI, charge_to_erp_id="ESSAI")

        club_info = await service._resolve_club_billing(flight)

        self.assertTrue(club_info.is_club_billed)
        self.assertEqual(club_info.charge_account_uuid, essai_row.analytical_cost_account_uuid)
        self.assertIs(club_info.analytical_credit_account, essai_row.analytical_reflection_account)

    async def test_resolve_club_billing_uses_entrainement_row_for_training_sentinel_non_essai(self):
        training_member = Member(uuid=uuid4(), first_name="Entrainement", last_name="ERP", account_id="TRAIN", member_category=1)
        entrainement_row = self._category_row(FlightBillingCategory.ENTRAINEMENT, "922", member=training_member)

        service = FlightBillingPreviewService(AsyncMock())
        service._type_billing_accounts = {FlightBillingCategory.ENTRAINEMENT: entrainement_row}
        service._billing_settings = types.SimpleNamespace(default_initiation_charge_account_uuid=None)
        flight = self._club_billed_flight(1, charge_to_erp_id="TRAIN")  # solo flight, billed to training sentinel

        club_info = await service._resolve_club_billing(flight)

        self.assertTrue(club_info.is_club_billed)
        self.assertEqual(club_info.charge_account_uuid, entrainement_row.analytical_cost_account_uuid)
        self.assertIs(club_info.analytical_credit_account, entrainement_row.analytical_reflection_account)

    async def test_resolve_club_billing_uses_club_row_for_club_sentinel_non_essai(self):
        club_member = Member(uuid=uuid4(), first_name="Club", last_name="ERP", account_id="CLUB", member_category=1)
        club_row = self._category_row(FlightBillingCategory.CLUB, "924", member=club_member)

        service = FlightBillingPreviewService(AsyncMock())
        service._type_billing_accounts = {FlightBillingCategory.CLUB: club_row}
        service._billing_settings = types.SimpleNamespace(default_initiation_charge_account_uuid=None)
        flight = self._club_billed_flight(1, charge_to_erp_id="CLUB")

        club_info = await service._resolve_club_billing(flight)

        self.assertTrue(club_info.is_club_billed)
        self.assertEqual(club_info.charge_account_uuid, club_row.analytical_cost_account_uuid)
        self.assertIs(club_info.analytical_credit_account, club_row.analytical_reflection_account)

    async def test_resolve_club_billing_has_no_class_6_fallback_when_row_not_fully_configured(self):
        # No class-6 fallback for club/entrainement/essai: a row whose sentinel matches
        # but whose analytical accounts aren't set must surface as a missing charge
        # account, not silently post elsewhere.
        club_member = Member(uuid=uuid4(), first_name="Club", last_name="ERP", account_id="CLUB", member_category=1)
        incomplete_row = FlightTypeBillingAccount(
            uuid=uuid4(),
            billing_category=FlightBillingCategory.CLUB,
            member_uuid=club_member.uuid,
        )
        incomplete_row.member = club_member
        incomplete_row.analytical_cost_account = None
        incomplete_row.analytical_reflection_account = None

        service = FlightBillingPreviewService(AsyncMock())
        service._type_billing_accounts = {FlightBillingCategory.CLUB: incomplete_row}
        service._billing_settings = types.SimpleNamespace(
            default_initiation_charge_account_uuid=uuid4()  # present, but must NOT be used here
        )
        flight = self._club_billed_flight(1, charge_to_erp_id="CLUB")

        club_info = await service._resolve_club_billing(flight)

        self.assertTrue(club_info.is_club_billed)
        self.assertIsNone(club_info.charge_account_uuid)
        self.assertIsNone(club_info.analytical_credit_account)

    async def test_resolve_club_billing_not_club_billed_when_charge_to_matches_no_sentinel(self):
        club_member = Member(uuid=uuid4(), first_name="Club", last_name="ERP", account_id="CLUB", member_category=1)
        club_row = self._category_row(FlightBillingCategory.CLUB, "924", member=club_member)

        service = FlightBillingPreviewService(AsyncMock())
        service._type_billing_accounts = {FlightBillingCategory.CLUB: club_row}
        service._billing_settings = types.SimpleNamespace(default_initiation_charge_account_uuid=None)
        flight = self._club_billed_flight(1, charge_to_erp_id="M002")  # a real member, not a sentinel

        club_info = await service._resolve_club_billing(flight)

        self.assertFalse(club_info.is_club_billed)

    async def test_preview_uses_pack_price_without_persisting_pack_state(self):
        member, asset, debit, _credit, version, item, flight = self._objects()
        service = FlightBillingPreviewService(AsyncMock())
        service._get_receivable_account = AsyncMock(return_value=debit)
        service._resolve_payers = AsyncMock(return_value=[_Payer(member, "pilot", Decimal("1"), "solo")])
        service._resolve_machine = AsyncMock(return_value=_PricedMachine("flight", asset, version, [item]))
        pack_balances: dict[tuple[UUID, str], Decimal] = {}
        item_packs: dict[UUID, list[tuple[str, Decimal, int]]] = {}

        preview = await service._preview_one(flight, pack_balances, item_packs)

        self.assertTrue(preview.can_apply)
        # Without any pack applicability, normal price applies
        self.assertEqual(preview.total_amount, Decimal("100.0000"))
        self.assertEqual(len(preview.applied_lines), 1)
        self.assertIsNone(preview.applied_lines[0].discount_reason)

    async def test_preview_splits_partial_pack_hours(self):
        # Member has only 0.5h left in a "flight_hours" pack against a 1h flight: the
        # first 0.5h is tagged as pack-consumed (for the later REM adjustment), the
        # remaining 0.5h is unaffected. Pack usage never changes the billed amount —
        # billing stays gross at the normal price; the discount is applied separately
        # via the REM journal.
        member, asset, debit, _credit, version, item, flight = self._objects()
        service = FlightBillingPreviewService(AsyncMock())
        service._get_receivable_account = AsyncMock(return_value=debit)
        service._resolve_payers = AsyncMock(return_value=[_Payer(member, "pilot", Decimal("1"), "solo")])
        service._resolve_machine = AsyncMock(return_value=_PricedMachine("flight", asset, version, [item]))
        pack_balances: dict[tuple[UUID, str], Decimal] = {(member.uuid, "flight_hours"): Decimal("0.5")}
        item_packs: dict[UUID, list[tuple[str, Decimal, int]]] = {
            item.uuid: [("flight_hours", Decimal("50.0000"), 1)],
        }

        preview = await service._preview_one(flight, pack_balances, item_packs)

        self.assertTrue(preview.can_apply)
        self.assertEqual(preview.total_amount, Decimal("100.0000"))
        self.assertEqual(len(preview.applied_lines), 2)
        self.assertEqual(preview.applied_lines[0].quantity, Decimal("0.5"))
        self.assertEqual(preview.applied_lines[0].discount_reason, "pack")
        self.assertEqual(preview.applied_lines[1].quantity, Decimal("0.5"))
        self.assertIsNone(preview.applied_lines[1].discount_reason)
        self.assertEqual(pack_balances[(member.uuid, "flight_hours")], Decimal("0"))

    async def test_progressive_shared_flight_uses_full_quantity_before_split(self):
        member, asset, debit, credit, version, item, flight = self._objects()
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
            PricingItemTier(from_qty=Decimal("0.7500"), price=Decimal("50.0000"), sort_order=1),
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

        pack_balances: dict[tuple[UUID, str], Decimal] = {}
        item_packs: dict[UUID, list[tuple[str, Decimal, int]]] = {}
        preview = await service._preview_one(flight, pack_balances, item_packs)

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

    async def test_resolve_machine_does_not_fallback_to_global_pricing_for_flight(self):
        _member, asset, _debit, _credit, _version, _item, flight = self._objects()
        asset.ownership = 1

        service = FlightBillingPreviewService(AsyncMock())
        service._resolve_asset = AsyncMock(return_value=asset)
        service.db.execute = AsyncMock(return_value=_FakeExecuteResult([]))

        errors = []
        warnings = []
        machine = await service._resolve_machine("flight", asset.code, flight, errors, warnings)

        self.assertIsNone(machine.version)
        self.assertEqual(len(machine.items), 0)
        self.assertTrue(any(err.code == "pricing_version_missing" for err in errors))
        self.assertFalse(any(warn.code == "pricing_global_fallback" for warn in warnings))
        service.db.execute.assert_awaited_once()

    async def test_resolve_asset_query_filters_non_bookable(self):
        _member, asset, *_ = self._objects()
        service = FlightBillingPreviewService(AsyncMock())
        captured = {}

        async def fake_execute(stmt):
            captured["stmt"] = stmt
            return types.SimpleNamespace(scalars=lambda: types.SimpleNamespace(first=lambda: None))

        service.db.execute = fake_execute

        result = await service._resolve_asset(asset.code)

        # A non-bookable sub-component (trailer, refit) must never resolve here — the
        # query itself must filter on is_bookable, so this asserts the filter is present
        # regardless of what the (mocked) database would actually return.
        self.assertIsNone(result)
        self.assertIn("is_bookable", str(captured["stmt"]))


class FlightBillingPreviewRouteTests(TestCase):
    def test_billing_preview_routes_are_registered(self):
        paths = {(route.path, tuple(sorted(getattr(route, "methods", set())))) for route in router.routes}

        self.assertIn(("/api/v1/flights/{flight_uuid}/billing-preview", ("POST",)), paths)
        self.assertIn(("/api/v1/flights/billing-preview", ("POST",)), paths)
