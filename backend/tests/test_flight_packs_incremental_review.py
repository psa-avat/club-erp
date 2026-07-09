"""
    ERP-CLUB - ERP pour Club de vol a voile
    - Tests for the incremental pack discount review planner
"""

from datetime import date
import sys
import types
from decimal import Decimal
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

if "httpx" not in sys.modules:
    httpx_stub = types.ModuleType("httpx")
    httpx_stub.AsyncClient = object
    httpx_stub.Response = object
    httpx_stub.TimeoutException = TimeoutError
    httpx_stub.NetworkError = OSError
    httpx_stub.RequestError = OSError
    httpx_stub.Auth = object
    sys.modules["httpx"] = httpx_stub

if "aioboto3" not in sys.modules:
    sys.modules["aioboto3"] = types.ModuleType("aioboto3")

from models import MemberPackConsumption, PackApplicability, PackDefinition, ValidatedFlight
from services.flight_packs import _IncrementalPlan, _PackSlot, _plan_incremental_review, list_consumptions_for_member


class _FakeResult:
    """Mimics the subset of SQLAlchemy's Result API used by _plan_incremental_review."""

    def __init__(self, rows=None, one=None):
        self._rows = rows or []
        self._one = one

    def one(self):
        return self._one

    def unique(self):
        return self

    def scalars(self):
        return self

    def all(self):
        return self._rows


def _flight(jour: date, erp_status: int = 1) -> ValidatedFlight:
    return ValidatedFlight(
        uuid=uuid4(),
        planche_uuid=f"planche-{uuid4()}",
        jour=jour,
        asset_code="F-CABC",
        pilot_erp_id="M001",
        type_of_flight=1,
        launch_method=0,
        takeoff_time="10:00",
        landing_time="11:00",
        landing_count=1,
        validated_by="test",
        accounting_entry_uuid=uuid4(),
        erp_status=erp_status,
    )


def _pack_slot(pack_def_uuid=None, activated_at=date(2026, 1, 1), remaining=Decimal("25")) -> _PackSlot:
    pack_def = PackDefinition(
        uuid=pack_def_uuid or uuid4(),
        code="PACK25",
        name="Pack 25h",
        pack_type="flight_hours",
        quantity_allowance=Decimal("25"),
        quantity_unit="hours",
    )
    return _PackSlot(
        pack_def=pack_def,
        applicability=[],
        activated_at=activated_at,
        remaining=remaining,
        purchase_entry_uuid=uuid4(),
    )


class PlanIncrementalReviewTests(IsolatedAsyncioTestCase):
    async def test_member_never_reviewed_falls_back_to_full(self):
        db = AsyncMock()
        db.execute.side_effect = [_FakeResult(one=(None, False))]

        plan = await _plan_incremental_review(db, uuid4(), uuid4())

        self.assertIsNone(plan)

    async def test_previously_reviewed_flight_modified_after_transfer_falls_back(self):
        db = AsyncMock()
        db.execute.side_effect = [_FakeResult(one=(date(2026, 5, 1), True))]

        plan = await _plan_incremental_review(db, uuid4(), uuid4())

        self.assertIsNone(plan)

    async def test_no_new_flights_returns_noop_plan_without_loading_pack_context(self):
        db = AsyncMock()
        db.execute.side_effect = [
            _FakeResult(one=(date(2026, 5, 1), False)),
            _FakeResult(rows=[]),
        ]

        plan = await _plan_incremental_review(db, uuid4(), uuid4())

        self.assertEqual(plan, _IncrementalPlan(new_flights=[], pack_slots=[], pi_to_slots={}))
        self.assertEqual(db.execute.await_count, 2)

    async def test_backdated_new_flight_falls_back_to_full(self):
        boundary = date(2026, 5, 10)
        backdated_flight = _flight(jour=date(2026, 5, 5))  # before boundary
        db = AsyncMock()
        db.execute.side_effect = [
            _FakeResult(one=(boundary, False)),
            _FakeResult(rows=[backdated_flight]),
        ]

        plan = await _plan_incremental_review(db, uuid4(), uuid4())

        self.assertIsNone(plan)

    async def test_flight_on_boundary_day_falls_back_to_full(self):
        boundary = date(2026, 5, 10)
        same_day_flight = _flight(jour=boundary)
        db = AsyncMock()
        db.execute.side_effect = [
            _FakeResult(one=(boundary, False)),
            _FakeResult(rows=[same_day_flight]),
        ]

        plan = await _plan_incremental_review(db, uuid4(), uuid4())

        self.assertIsNone(plan)

    async def test_pack_slot_activated_before_boundary_with_no_known_consumption_falls_back(self):
        boundary = date(2026, 5, 1)
        new_flight = _flight(jour=date(2026, 6, 1))
        # Slot activated well before the reviewed boundary, but never consumed
        # under its own purchase_entry_uuid — looks like a purchase entered or
        # backdated after the last review (or unmigrated legacy data).
        suspicious_slot = _pack_slot(activated_at=date(2026, 1, 1))
        db = AsyncMock()
        db.execute.side_effect = [
            _FakeResult(one=(boundary, False)),
            _FakeResult(rows=[new_flight]),
            _FakeResult(rows=[]),  # known_purchases_result: no consumption known for this purchase
        ]

        with patch(
            "services.flight_packs._load_pack_context",
            AsyncMock(return_value=([suspicious_slot], {})),
        ):
            plan = await _plan_incremental_review(db, uuid4(), uuid4())

        self.assertIsNone(plan)

    async def test_happy_path_reconstructs_remaining_from_persisted_consumptions(self):
        boundary = date(2026, 5, 1)
        new_flight = _flight(jour=date(2026, 6, 1))
        slot = _pack_slot(activated_at=date(2026, 1, 1), remaining=Decimal("25"))
        db = AsyncMock()
        db.execute.side_effect = [
            _FakeResult(one=(boundary, False)),
            _FakeResult(rows=[new_flight]),
            _FakeResult(rows=[(slot.purchase_entry_uuid,)]),  # known_purchases_result
            _FakeResult(rows=[(slot.purchase_entry_uuid, Decimal("7.5"))]),  # consumed_result
        ]

        with patch(
            "services.flight_packs._load_pack_context",
            AsyncMock(return_value=([slot], {"pi-key": [slot]})),
        ):
            plan = await _plan_incremental_review(db, uuid4(), uuid4())

        self.assertIsNotNone(plan)
        self.assertEqual(plan.new_flights, [new_flight])
        self.assertEqual(plan.pack_slots[0].remaining, Decimal("17.5"))  # 25 - 7.5

    async def test_consecutive_purchases_of_same_pack_definition_are_handled_independently(self):
        """The most common real-world case: a member buys the same pack
        template twice in a row (e.g. two consecutive 25h packs). Each
        purchase has its own purchase_entry_uuid, so its remaining balance
        is reconstructed independently — no fallback to full recompute."""
        boundary = date(2026, 5, 1)
        new_flight = _flight(jour=date(2026, 6, 1))
        shared_def_uuid = uuid4()
        slot_1 = _pack_slot(pack_def_uuid=shared_def_uuid, activated_at=date(2026, 1, 1), remaining=Decimal("25"))
        slot_2 = _pack_slot(pack_def_uuid=shared_def_uuid, activated_at=date(2026, 3, 1), remaining=Decimal("25"))
        db = AsyncMock()
        db.execute.side_effect = [
            _FakeResult(one=(boundary, False)),
            _FakeResult(rows=[new_flight]),
            _FakeResult(rows=[(slot_1.purchase_entry_uuid,), (slot_2.purchase_entry_uuid,)]),
            _FakeResult(rows=[
                (slot_1.purchase_entry_uuid, Decimal("25")),  # slot 1 fully consumed
                (slot_2.purchase_entry_uuid, Decimal("3")),   # slot 2 partially consumed
            ]),
        ]

        with patch(
            "services.flight_packs._load_pack_context",
            AsyncMock(return_value=([slot_1, slot_2], {})),
        ):
            plan = await _plan_incremental_review(db, uuid4(), uuid4())

        self.assertIsNotNone(plan)
        self.assertEqual(plan.pack_slots[0].remaining, Decimal("0"))
        self.assertEqual(plan.pack_slots[1].remaining, Decimal("22"))


class ListConsumptionsForMemberTests(IsolatedAsyncioTestCase):
    async def test_filters_by_pack_definition_uuid_when_provided(self):
        member_uuid = uuid4()
        pack_def_uuid = uuid4()
        db = AsyncMock()
        captured_stmt = {}

        async def fake_execute(stmt):
            captured_stmt["stmt"] = stmt
            return _FakeResult(rows=[])

        db.execute.side_effect = fake_execute

        await list_consumptions_for_member(db, member_uuid, "flight_hours", pack_definition_uuid=pack_def_uuid)

        compiled = str(captured_stmt["stmt"])
        self.assertIn("pack_definition_uuid", compiled)

    async def test_filters_by_purchase_entry_uuid_when_provided(self):
        member_uuid = uuid4()
        purchase_entry_uuid = uuid4()
        db = AsyncMock()
        captured_stmt = {}

        async def fake_execute(stmt):
            captured_stmt["stmt"] = stmt
            return _FakeResult(rows=[])

        db.execute.side_effect = fake_execute

        await list_consumptions_for_member(
            db, member_uuid, "flight_hours", purchase_entry_uuid=purchase_entry_uuid,
        )

        compiled = str(captured_stmt["stmt"])
        self.assertIn("purchase_entry_uuid", compiled)
