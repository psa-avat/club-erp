"""
    ERP-CLUB - ERP pour Club de vol a voile
    - planche flight import tests: phase 0/1 source snapshots and field mapping
"""

from datetime import datetime, timezone
from unittest import TestCase
from uuid import uuid4

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
from models import PlancheFlightSnapshot, ValidatedFlight
from services.planche_integration import PlancheIntegrationService


class PlancheFlightImportTests(TestCase):
    def setUp(self):
        self.service = PlancheIntegrationService(
            base_url="https://planche.example.test",
            connection_id="club",
            token="token",
            user="user",
            password="password",
        )

    def test_extract_change_item_uses_revision_wrapper_and_flight_payload(self):
        raw = {
            "uuid": "flight-1",
            "revision": 3,
            "status": "updated",
            "updated_at": "2026-05-25T12:40:00Z",
            "corrected_at": "2026-05-25T12:39:00Z",
            "corrected_by": "jdupont",
            "correction_reason": "Landing corrected",
            "flight": {"jour": "2026-05-25", "glider_immat": "F-CABC"},
        }

        item = self.service._extract_change_item(raw)

        self.assertEqual(item["planche_uuid"], "flight-1")
        self.assertEqual(item["revision"], 3)
        self.assertEqual(item["status"], "updated")
        self.assertEqual(item["flight"]["uuid"], "flight-1")
        self.assertEqual(item["flight"]["revision"], 3)
        self.assertEqual(item["correction_reason"], "Landing corrected")

    def test_apply_planche_flight_data_maps_planche_registrations_to_snapshots(self):
        snapshot = PlancheFlightSnapshot(
            uuid=uuid4(),
            planche_uuid="flight-1",
            planche_revision=2,
            source_hash="hash-new",
            status="updated",
            payload_json={},
            updated_at_source=datetime(2026, 5, 25, 12, 40, tzinfo=timezone.utc),
            corrected_at=datetime(2026, 5, 25, 12, 39, tzinfo=timezone.utc),
            corrected_by="jdupont",
            correction_reason="Tow plane corrected",
        )
        flight = ValidatedFlight(erp_status=1, last_export_hash="hash-old")
        change_item = {"planche_uuid": "flight-1", "revision": 2, "status": "updated"}
        payload = {
            "aero": "LFXX",
            "jour": "2026-05-25",
            "glider_immat": "F-CABC",
            "pilot_erp_id": "M001",
            "pilot_compta_id": "411001",
            "second_pilot_erp_id": "M002",
            "second_pilot_id": "P002",
            "charge_to_erp_id": "M001",
            "charge_to_compta_id": "411001",
            "instruction_split": 0,
            "typeOfFlight": 1,
            "launchMethod": 2,
            "launch_machine_immat": "F-TOW",
            "takeoffTime": "10:00",
            "landingTime": "10:30",
            "landingCount": 1,
        }

        self.service._apply_planche_flight_data(
            flight_obj=flight,
            flight_data=payload,
            change_item=change_item,
            snapshot=snapshot,
            triggered_by="tester",
            existing_status=1,
            source_hash_changed=True,
        )

        self.assertEqual(flight.asset_code, "F-CABC")
        self.assertEqual(flight.launch_asset_code, "F-TOW")
        self.assertEqual(flight.pilot_compta_id, "411001")
        self.assertEqual(flight.charge_to_compta_id, "411001")
        self.assertEqual(flight.last_export_hash, "hash-new")
        self.assertEqual(flight.revision, 2)
        self.assertEqual(flight.erp_status, 2)
        self.assertEqual(flight.validated_by, "tester")

    def test_flights_pull_route_has_capability_guard(self):
        route = None
        for candidate in router.routes:
            if getattr(candidate, "path", None) == "/api/v1/planche/flights/pull" and "POST" in getattr(candidate, "methods", set()):
                route = candidate
                break

        self.assertIsNotNone(route)
        dependency_names = [
            dependency.call.__name__
            for dependency in route.dependant.dependencies
            if getattr(dependency, "call", None) is not None
        ]
        self.assertIn("_capability_guard", dependency_names)
