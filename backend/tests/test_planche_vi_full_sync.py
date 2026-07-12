"""
    ERP-CLUB - ERP pour Club de vol a voile
    - planche VI full sync tests: eligibility query filters + two-phase sequencing
"""

import sys
import types
from datetime import date
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock

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

from services.planche_integration import PlancheIntegrationService


def _service() -> PlancheIntegrationService:
    return PlancheIntegrationService(
        base_url="https://planche.example.test",
        connection_id="club",
        token="token",
        user="user",
        password="password",
    )


def _entitlement(uuid, code, status, is_generic, vi_type_code="VI"):
    entitlement = types.SimpleNamespace(
        uuid=uuid,
        code=code,
        status=status,
        is_generic=is_generic,
        scheduled_date=None,
        validity_date=None,
        origin_type=1,
        notes=None,
        description=None,
        partner_code=None,
    )
    vi_type = types.SimpleNamespace(code=vi_type_code)
    return entitlement, vi_type


class PlancheViFullSyncQueryTests(IsolatedAsyncioTestCase):
    async def test_eligibility_and_generic_queries_filter_correctly(self):
        service = _service()
        db = AsyncMock()
        db.add = Mock()
        captured_stmts = []

        async def fake_execute(stmt):
            captured_stmts.append(stmt)
            return types.SimpleNamespace(all=lambda: [])

        db.execute = fake_execute
        service._perform_request = AsyncMock(return_value=types.SimpleNamespace(status_code=200, text=""))

        result = await service.sync_vi_entitlements_full(db, triggered_by="tester")

        self.assertEqual(result["generic_count"], 0)
        self.assertEqual(result["eligible_count"], 0)
        # First two captured statements are the generic-only select and the eligible select.
        generic_stmt_str = str(captured_stmts[0])
        eligible_stmt_str = str(captured_stmts[1])
        self.assertIn("is_generic", generic_stmt_str)
        self.assertIn("is_generic", eligible_stmt_str)
        self.assertIn("status", eligible_stmt_str)


class PlancheViFullSyncSequencingTests(IsolatedAsyncioTestCase):
    async def _run_with_rows(self, service, db, generic_rows, eligible_rows):
        call_count = {"n": 0}

        async def fake_execute(stmt):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return types.SimpleNamespace(all=lambda: generic_rows)
            if call_count["n"] == 2:
                return types.SimpleNamespace(all=lambda: eligible_rows)
            return types.SimpleNamespace(all=lambda: [])

        db.execute = fake_execute
        return await service.sync_vi_entitlements_full(db, triggered_by="tester")

    async def test_generic_pushed_regardless_of_status_then_eligible_restored(self):
        service = _service()
        db = AsyncMock()
        db.add = Mock()

        generic_realized = _entitlement("uuid-g1", "VI-GEN-1", status=3, is_generic=True)  # REALIZED
        eligible = _entitlement("uuid-e1", "VI-0001", status=1, is_generic=False)  # LOADED

        pushed_payloads = []

        async def fake_perform_request(method, endpoint, json=None, params=None):
            pushed_payloads.append(json)
            return types.SimpleNamespace(status_code=200, text="")

        service._perform_request = fake_perform_request

        result = await self._run_with_rows(service, db, [generic_realized], [eligible])

        self.assertTrue(result["success"])
        self.assertFalse(result["phase2"]["skipped"])
        self.assertEqual(len(pushed_payloads), 2)

        phase1_payload, phase2_payload = pushed_payloads
        self.assertEqual(phase1_payload["mode"], "replace")
        self.assertIn("VI-GEN-1", [item["entitlement_code"] for item in phase1_payload["items"]])
        self.assertEqual(phase2_payload["mode"], "update")
        self.assertIn("VI-0001", [item["entitlement_code"] for item in phase2_payload["items"]])

    async def test_phase2_skipped_when_phase1_fails(self):
        service = _service()
        db = AsyncMock()
        db.add = Mock()

        generic = _entitlement("uuid-g1", "VI-GEN-1", status=1, is_generic=True)
        eligible = _entitlement("uuid-e1", "VI-0001", status=1, is_generic=False)

        call_log = []

        async def fake_perform_request(method, endpoint, json=None, params=None):
            call_log.append(json)
            return types.SimpleNamespace(status_code=500, text="server error")

        service._perform_request = fake_perform_request

        result = await self._run_with_rows(service, db, [generic], [eligible])

        self.assertFalse(result["success"])
        self.assertTrue(result["phase2"]["skipped"])
        # Phase 2's POST must never be attempted once phase 1 fails.
        self.assertEqual(len(call_log), 1)

    async def test_phase1_exception_is_caught_and_phase2_skipped(self):
        service = _service()
        db = AsyncMock()
        db.add = Mock()

        generic = _entitlement("uuid-g1", "VI-GEN-1", status=1, is_generic=True)
        eligible = _entitlement("uuid-e1", "VI-0001", status=1, is_generic=False)

        async def fake_perform_request(method, endpoint, json=None, params=None):
            raise ConnectionError("boom")

        service._perform_request = fake_perform_request

        result = await self._run_with_rows(service, db, [generic], [eligible])

        self.assertFalse(result["success"])
        self.assertTrue(result["phase2"]["skipped"])
        self.assertTrue(any("Chunk exception" in err for err in result["errors"]))


class PlancheViPushRegressionTests(IsolatedAsyncioTestCase):
    async def test_push_vi_entitlements_return_shape_unchanged(self):
        service = _service()
        db = AsyncMock()
        db.add = Mock()

        entitlement, vi_type = _entitlement("uuid-e1", "VI-0001", status=1, is_generic=False)

        async def fake_execute(stmt):
            return types.SimpleNamespace(all=lambda: [(entitlement, vi_type)])

        db.execute = fake_execute
        service._perform_request = AsyncMock(return_value=types.SimpleNamespace(status_code=200, text=""))

        result = await service.push_vi_entitlements(db, entitlement_uuids=["uuid-e1"], triggered_by="tester")

        self.assertEqual(
            set(result.keys()),
            {"selected_count", "success", "failure", "error_details"},
        )
        self.assertEqual(result["selected_count"], 1)
        self.assertEqual(result["success"], 1)
        self.assertEqual(result["failure"], 0)

    async def test_push_vi_entitlements_catches_chunk_exception(self):
        service = _service()
        db = AsyncMock()
        db.add = Mock()

        entitlement, vi_type = _entitlement("uuid-e1", "VI-0001", status=1, is_generic=False)

        async def fake_execute(stmt):
            return types.SimpleNamespace(all=lambda: [(entitlement, vi_type)])

        db.execute = fake_execute

        async def fake_perform_request(method, endpoint, json=None, params=None):
            raise ConnectionError("boom")

        service._perform_request = fake_perform_request

        result = await service.push_vi_entitlements(db, entitlement_uuids=["uuid-e1"], triggered_by="tester")

        self.assertEqual(result["failure"], 1)
        self.assertTrue(any("Chunk exception" in err for err in result["error_details"]))


class PlancheViReconcileValidityDateTests(IsolatedAsyncioTestCase):
    async def _run_reconcile(self, flights):
        service = _service()
        db = AsyncMock()
        db.add = Mock()

        entitlement = types.SimpleNamespace(
            uuid="ent-1",
            code="VI2026-0001",
            status=2,  # SCHEDULED
            realisation_date=None,
            validity_date=None,
        )

        async def fake_execute(stmt):
            if "validated_flights" in str(stmt).lower():
                return types.SimpleNamespace(scalars=lambda: types.SimpleNamespace(all=lambda: flights))
            return types.SimpleNamespace(scalars=lambda: types.SimpleNamespace(all=lambda: [entitlement]))

        db.execute = fake_execute

        result = await service.reconcile_vi_realisation_from_validated_flights(db, triggered_by="tester")
        return entitlement, result

    async def test_reconcile_keeps_latest_flight_date_regardless_of_processing_order(self):
        early = types.SimpleNamespace(vi_erp_id="VI2026-0001", jour=date(2026, 5, 1))
        late = types.SimpleNamespace(vi_erp_id="VI2026-0001", jour=date(2026, 6, 20))

        entitlement, result = await self._run_reconcile([early, late])
        self.assertEqual(result["updated"], 2)
        self.assertEqual(entitlement.status, 3)
        self.assertEqual(entitlement.validity_date, date(2026, 6, 20))

    async def test_reconcile_does_not_regress_validity_date_when_late_flight_processed_first(self):
        early = types.SimpleNamespace(vi_erp_id="VI2026-0001", jour=date(2026, 5, 1))
        late = types.SimpleNamespace(vi_erp_id="VI2026-0001", jour=date(2026, 6, 20))

        entitlement, result = await self._run_reconcile([late, early])
        self.assertEqual(result["updated"], 2)
        self.assertEqual(entitlement.validity_date, date(2026, 6, 20))
