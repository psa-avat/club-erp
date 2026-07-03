"""
    ERP-CLUB - ERP pour Club de vol à voile
    - gesasso flight sync tests: pre-check issue detection and sync-candidates listing
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

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

import httpx

from api.routes.federal_sync import list_sync_candidates
from models import ValidatedFlight
from services.federal_sync import GesassoSyncService, _normalize_trigram


def _flight(**overrides) -> SimpleNamespace:
    defaults = dict(
        uuid=uuid4(),
        type_of_flight=1,  # solo
        pilot_erp_id="M1",
        second_pilot_erp_id=None,
        launch_method=3,  # autonome — no launch machine/operator to check by default
        launch_asset_code=None,
        launch_pilot_trigram=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class CheckFlightIssuesTests(IsolatedAsyncioTestCase):
    """check_flight_issues is a pure function — no db access needed."""

    async def test_no_issues_when_pilot_has_ffvp_id(self):
        flight = _flight(pilot_erp_id="M1")
        issues = GesassoSyncService.check_flight_issues(flight, {"M1": "1234"})
        self.assertEqual(issues, [])

    async def test_solo_flight_blocks_on_missing_pilot_ffvp_id(self):
        flight = _flight(pilot_erp_id="M1")
        issues = GesassoSyncService.check_flight_issues(flight, {})
        self.assertEqual(
            issues,
            [{"code": GesassoSyncService.ISSUE_PERSON_ONE_MISSING_FFVP_ID, "blocking": True}],
        )

    async def test_instruction_flight_checks_instructor_not_student(self):
        # type_of_flight 0 = instruction: person_one is the instructor (second_pilot_erp_id)
        flight = _flight(type_of_flight=0, pilot_erp_id="STUDENT", second_pilot_erp_id="INSTRUCTOR")
        # Student has no ffvp_id but instructor does -> should be accepted
        issues = GesassoSyncService.check_flight_issues(flight, {"INSTRUCTOR": "999"})
        self.assertEqual(issues, [])

        # Instructor missing ffvp_id -> blocked, even though student has one
        issues = GesassoSyncService.check_flight_issues(flight, {"STUDENT": "111"})
        self.assertEqual(
            issues,
            [{"code": GesassoSyncService.ISSUE_PERSON_ONE_MISSING_FFVP_ID, "blocking": True}],
        )

    async def test_winch_operator_missing_ffvp_id_is_non_blocking(self):
        # GesAsso accepts a winch_person_external fallback, so this must not block sending.
        flight = _flight(
            pilot_erp_id="M1", launch_method=1, launch_asset_code="TREUIL", launch_pilot_trigram="ABC",
        )
        issues = GesassoSyncService.check_flight_issues(flight, {"M1": "1234"})
        self.assertEqual(
            issues,
            [{"code": GesassoSyncService.ISSUE_WINCH_OPERATOR_MISSING_FFVP_ID, "blocking": False}],
        )

        issues = GesassoSyncService.check_flight_issues(flight, {"M1": "1234", "ABC": "5678"})
        self.assertEqual(issues, [])

    async def test_tow_operator_missing_ffvp_id_is_non_blocking(self):
        flight = _flight(
            pilot_erp_id="M1", launch_method=2, launch_asset_code="F-REMO", launch_pilot_trigram="XYZ",
        )
        issues = GesassoSyncService.check_flight_issues(flight, {"M1": "1234"})
        self.assertEqual(
            issues,
            [{"code": GesassoSyncService.ISSUE_TOW_OPERATOR_MISSING_FFVP_ID, "blocking": False}],
        )

    async def test_no_launch_asset_code_skips_operator_check(self):
        # Autonomous / no recorded launch machine -> nothing to check on the operator side.
        flight = _flight(pilot_erp_id="M1", launch_method=1, launch_asset_code=None, launch_pilot_trigram=None)
        issues = GesassoSyncService.check_flight_issues(flight, {"M1": "1234"})
        self.assertEqual(issues, [])

    async def test_malformed_trigram_with_embedded_code_resolves_via_ffvp_map(self):
        # Planche sometimes stores "Prénom Nom (ABC)" instead of just "ABC" —
        # the ffvp_map is keyed by the normalized code, so this must still match.
        flight = _flight(
            pilot_erp_id="M1", launch_method=1, launch_asset_code="TREUIL",
            launch_pilot_trigram="Baptiste Keller (KLR)",
        )
        issues = GesassoSyncService.check_flight_issues(flight, {"M1": "1234", "KLR": "5678"})
        self.assertEqual(issues, [])


class NormalizeTrigramTests(IsolatedAsyncioTestCase):
    async def test_plain_three_letter_code_is_uppercased(self):
        self.assertEqual(_normalize_trigram("klr"), "KLR")

    async def test_extracts_parenthesized_code_from_full_name(self):
        self.assertEqual(_normalize_trigram("Baptiste Keller (KLR)"), "KLR")

    async def test_returns_raw_value_unchanged_when_no_code_found(self):
        self.assertEqual(_normalize_trigram("Unknown Person"), "Unknown Person")


class MapFlightExternalFallbackTests(IsolatedAsyncioTestCase):
    """map_flight must fall back to GesAsso's *_external fields when the winch/tow
    operator has no known ffvp_id, instead of silently omitting a required field."""

    def _service(self):
        return GesassoSyncService(
            base_url="https://api.gesasso.example",
            username="user",
            password="secret",
            association_code="CODE",
        )

    def test_winch_operator_without_ffvp_id_uses_external_fields(self):
        service = self._service()
        service._ffvp_map = {"M1": "1234"}  # no entry for the winch trigram
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="p1",
            jour=None,
            asset_code="F-CABC",
            pilot_erp_id="M1",
            type_of_flight=1,
            launch_method=1,
            launch_asset_code="TREUIL",
            launch_pilot_trigram="EJT",
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )
        payload = service.map_flight(flight)
        self.assertNotIn("winch_person_licence_number", payload)
        self.assertTrue(payload["winch_person_external"])
        self.assertEqual(payload["winch_person_external_information"], "EJT")

    def test_winch_operator_with_ffvp_id_uses_licence_number(self):
        service = self._service()
        service._ffvp_map = {"M1": "1234", "EJT": "5678"}
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="p1",
            jour=None,
            asset_code="F-CABC",
            pilot_erp_id="M1",
            type_of_flight=1,
            launch_method=1,
            launch_asset_code="TREUIL",
            launch_pilot_trigram="EJT",
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )
        payload = service.map_flight(flight)
        self.assertEqual(payload["winch_person_licence_number"], "5678")
        self.assertNotIn("winch_person_external", payload)

    def test_winch_operator_with_malformed_trigram_still_resolves(self):
        # Planche-side data entry slip: full name typed into the trigram field.
        # ffvp_map is keyed by the normalized "KLR", so the lookup must still hit.
        service = self._service()
        service._ffvp_map = {"M1": "1234", "KLR": "3209"}
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="p1",
            jour=None,
            asset_code="F-CABC",
            pilot_erp_id="M1",
            type_of_flight=1,
            launch_method=1,
            launch_asset_code="TREUIL",
            launch_pilot_trigram="Baptiste Keller (KLR)",
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )
        payload = service.map_flight(flight)
        self.assertEqual(payload["winch_person_licence_number"], "3209")
        self.assertNotIn("winch_person_external", payload)

    def test_tow_operator_without_ffvp_id_uses_external_fields(self):
        service = self._service()
        service._ffvp_map = {"M1": "1234"}
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="p1",
            jour=None,
            asset_code="F-CABC",
            pilot_erp_id="M1",
            type_of_flight=1,
            launch_method=2,
            launch_asset_code="F-REMO",
            launch_pilot_trigram="SBT",
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )
        payload = service.map_flight(flight)
        self.assertNotIn("tow_person_one_licence_number", payload)
        self.assertTrue(payload["tow_person_one_external"])
        self.assertEqual(payload["tow_person_one_external_information"], "SBT")

    def test_external_tow_with_no_local_data_still_declares_required_fields(self):
        # launch_method=0 ("extérieur"): the flight was towed by another
        # club/airfield, so Planche records neither a launch_asset_code nor a
        # launch_pilot_trigram — but GesAsso still requires tow_aircraft_* and
        # tow_person_one_* whenever launching_mode is AIRCRAFT_TOWING.
        service = self._service()
        service._ffvp_map = {"M1": "1234", "M2": "5678"}
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="p1",
            jour=None,
            asset_code="F-CHBC",
            pilot_erp_id="M1",
            second_pilot_erp_id="M2",
            type_of_flight=1,
            launch_method=0,
            launch_asset_code=None,
            launch_pilot_trigram=None,
            takeoff_time="13:47",
            landing_time="17:16",
            landing_count=1,
            validated_by="test",
        )
        payload = service.map_flight(flight)
        self.assertEqual(payload["launching_mode"], "AIRCRAFT_TOWING")
        self.assertTrue(payload["tow_aircraft_external"])
        self.assertEqual(payload["tow_aircraft_external_information"], "Remorqueur non identifié")
        self.assertEqual(payload["tow_aircraft_external_type"], GesassoSyncService.TOW_AIRCRAFT_EXTERNAL_TYPE)
        # tow_aircraft_registration is rejected by GesAsso when the aircraft is
        # declared external ("not allowed for externals") — must be absent.
        self.assertNotIn("tow_aircraft_registration", payload)
        self.assertTrue(payload["tow_person_one_external"])
        self.assertEqual(payload["tow_person_one_external_information"], "Non identifié")

    def test_known_tow_registration_is_sent_without_external_declaration(self):
        service = self._service()
        service._ffvp_map = {"M1": "1234"}
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="p1",
            jour=None,
            asset_code="F-CABC",
            pilot_erp_id="M1",
            type_of_flight=1,
            launch_method=2,
            launch_asset_code="F-REMO",
            launch_pilot_trigram=None,
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )
        payload = service.map_flight(flight)
        self.assertEqual(payload["tow_aircraft_registration"], "F-REMO")
        self.assertNotIn("tow_aircraft_external", payload)
        self.assertNotIn("tow_aircraft_external_information", payload)
        self.assertNotIn("tow_aircraft_external_type", payload)


class _FakeResult:
    """Mimics an SQLAlchemy result: supports .scalars().all() and plain .all()."""

    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _FakeDb:
    def __init__(self, execute_results):
        self.execute_results = list(execute_results)
        self.added = []
        self.committed = False

    async def execute(self, *_args, **_kwargs):
        return self.execute_results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True


class BuildFfvpMapTests(IsolatedAsyncioTestCase):
    async def test_merges_member_and_trigram_lookups(self):
        flights = [
            _flight(pilot_erp_id="M1", second_pilot_erp_id=None),
            _flight(pilot_erp_id="M2", launch_method=1, launch_pilot_trigram="ABC"),
        ]
        db = _FakeDb(execute_results=[
            _FakeResult([SimpleNamespace(account_id="M1", ffvp_id=111), SimpleNamespace(account_id="M2", ffvp_id=222)]),
            _FakeResult([SimpleNamespace(trigram="ABC", ffvp_id=333)]),
        ])
        ffvp_map = await GesassoSyncService.build_ffvp_map(db, flights)
        self.assertEqual(ffvp_map, {"M1": "111", "M2": "222", "ABC": "333"})

    async def test_normalizes_malformed_trigram_before_querying_members(self):
        flights = [
            _flight(pilot_erp_id="M1", launch_method=1, launch_pilot_trigram="Baptiste Keller (KLR)"),
        ]
        db = _FakeDb(execute_results=[
            _FakeResult([SimpleNamespace(account_id="M1", ffvp_id=111)]),
            _FakeResult([SimpleNamespace(trigram="KLR", ffvp_id=3209)]),
        ])
        ffvp_map = await GesassoSyncService.build_ffvp_map(db, flights)
        self.assertEqual(ffvp_map, {"M1": "111", "KLR": "3209"})


class BatchSyncFlightsRegressionTests(IsolatedAsyncioTestCase):
    """Verify the refactor into check_flight_issues/build_ffvp_map preserved
    the pre-existing rejection behavior of batch_sync_flights for blocking issues."""

    async def test_rejects_flight_with_no_matching_member(self):
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="planche-1",
            jour=None,
            asset_code="F-CABC",
            pilot_erp_id="UNKNOWN",
            type_of_flight=1,
            launch_method=2,
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )
        db = _FakeDb(execute_results=[
            _FakeResult([flight]),   # select(ValidatedFlight)...
            _FakeResult([]),         # build_ffvp_map: member account_id/ffvp_id lookup — no match
        ])
        service = GesassoSyncService(
            base_url="https://api.gesasso.example",
            username="user",
            password="secret",
            association_code="CODE",
        )
        result = await service.batch_sync_flights(db, [flight.uuid], triggered_by="tester")

        self.assertEqual(result["synced"], 0)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["already_transferred"], 0)
        # One FederalSyncLog(status=3) + one AuditLog were queued for persistence
        self.assertEqual(len(db.added), 2)
        self.assertTrue(db.committed)


class SyncCandidatesEndpointTests(IsolatedAsyncioTestCase):
    async def test_lists_pending_sent_and_blocked_flights(self):
        f_pending = _flight(uuid=uuid4(), pilot_erp_id="M1")   # never attempted, has ffvp_id
        f_sent = _flight(uuid=uuid4(), pilot_erp_id="M2")      # has a successful log
        f_blocked = _flight(uuid=uuid4(), pilot_erp_id="M3")   # pilot has no ffvp_id

        log_row = SimpleNamespace(
            validated_flight_uuid=f_sent.uuid,
            status=2,
            external_id="ext-42",
            attempt_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        )

        # Route needs jour/asset_code for response construction
        for f in (f_pending, f_sent, f_blocked):
            f.jour = None
            f.asset_code = "F-CABC"

        db = _FakeDb(execute_results=[
            _FakeResult([f_pending, f_sent, f_blocked]),  # flights in date range
            _FakeResult([log_row]),                        # latest log per flight
            _FakeResult([                                   # pilot/second-pilot names
                SimpleNamespace(account_id="M1", first_name="Alice", last_name="A"),
                SimpleNamespace(account_id="M2", first_name="Bob", last_name="B"),
                SimpleNamespace(account_id="M3", first_name="Carla", last_name="C"),
            ]),
            _FakeResult([                                   # build_ffvp_map: account_id -> ffvp_id
                SimpleNamespace(account_id="M1", ffvp_id=111),
                SimpleNamespace(account_id="M2", ffvp_id=222),
                # M3 intentionally missing -> no ffvp_id -> blocked
            ]),
        ])

        response = await list_sync_candidates(
            platform="gesasso",
            date_from=None,
            date_to=None,
            status_filter=None,
            page=1,
            page_size=50,
            db=db,
            _=None,
        )

        by_uuid = {item.flight_uuid: item for item in response.items}

        pending_item = by_uuid[str(f_pending.uuid)]
        self.assertEqual(pending_item.status, 0)
        self.assertEqual(pending_item.issues, [])
        self.assertEqual(pending_item.pilot_name, "Alice A")

        sent_item = by_uuid[str(f_sent.uuid)]
        self.assertEqual(sent_item.status, 2)
        self.assertEqual(sent_item.external_id, "ext-42")
        self.assertEqual(sent_item.issues, [])

        blocked_item = by_uuid[str(f_blocked.uuid)]
        self.assertEqual(len(blocked_item.issues), 1)
        self.assertEqual(blocked_item.issues[0].code, GesassoSyncService.ISSUE_PERSON_ONE_MISSING_FFVP_ID)
        self.assertTrue(blocked_item.issues[0].blocking)

        self.assertEqual(response.summary.pending, 1)
        self.assertEqual(response.summary.sent, 1)
        self.assertEqual(response.summary.blocked, 1)
        self.assertEqual(response.summary.failed, 0)

    async def test_status_filter_narrows_results_but_not_summary(self):
        f_pending = _flight(uuid=uuid4(), pilot_erp_id="M1", jour=None, asset_code="F-CABC")
        f_blocked = _flight(uuid=uuid4(), pilot_erp_id="M3", jour=None, asset_code="F-CABC")

        db = _FakeDb(execute_results=[
            _FakeResult([f_pending, f_blocked]),
            _FakeResult([]),  # no logs at all
            _FakeResult([
                SimpleNamespace(account_id="M1", first_name="Alice", last_name="A"),
                SimpleNamespace(account_id="M3", first_name="Carla", last_name="C"),
            ]),
            _FakeResult([SimpleNamespace(account_id="M1", ffvp_id=111)]),
        ])

        response = await list_sync_candidates(
            platform="gesasso",
            date_from=None,
            date_to=None,
            status_filter="blocked",
            page=1,
            page_size=50,
            db=db,
            _=None,
        )

        self.assertEqual(len(response.items), 1)
        self.assertEqual(response.items[0].flight_uuid, str(f_blocked.uuid))
        # Summary reflects the full unfiltered set, not just the filtered page
        self.assertEqual(response.summary.pending, 1)
        self.assertEqual(response.summary.blocked, 1)

    async def test_winch_operator_missing_ffvp_id_is_pending_not_blocked(self):
        # Core regression: a winch launch whose operator has no ERP/ffvp match must
        # NOT be blocked — GesAsso accepts it via the external fallback in map_flight.
        f_winch = _flight(
            uuid=uuid4(), pilot_erp_id="M1", launch_method=1,
            launch_asset_code="TREUIL", launch_pilot_trigram="EJT",
            jour=None, asset_code="F-CABC",
        )

        db = _FakeDb(execute_results=[
            _FakeResult([f_winch]),
            _FakeResult([]),  # no logs
            _FakeResult([SimpleNamespace(account_id="M1", first_name="Alice", last_name="A")]),
            _FakeResult([SimpleNamespace(account_id="M1", ffvp_id=111)]),  # no entry for trigram EJT
        ])

        response = await list_sync_candidates(
            platform="gesasso",
            date_from=None,
            date_to=None,
            status_filter=None,
            page=1,
            page_size=50,
            db=db,
            _=None,
        )

        item = response.items[0]
        self.assertEqual(item.status, 0)
        self.assertEqual(len(item.issues), 1)
        self.assertEqual(item.issues[0].code, GesassoSyncService.ISSUE_WINCH_OPERATOR_MISSING_FFVP_ID)
        self.assertFalse(item.issues[0].blocking)
        self.assertEqual(response.summary.pending, 1)
        self.assertEqual(response.summary.blocked, 0)


def _gesasso_http_error(status_code: int, body) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://api.gesasso.example/flights-collection.json")
    response = httpx.Response(status_code, json=body, request=request)
    return httpx.HTTPStatusError("error", request=request, response=response)


class ClassifyErrorTests(IsolatedAsyncioTestCase):
    """GesAsso's 'flight already exists' validation error must be treated as
    already-transferred (status=2), not a plain failure — otherwise the flight
    fails identically on every future retry."""

    def _service(self):
        return GesassoSyncService(
            base_url="https://api.gesasso.example", username="u", password="p", association_code="C",
        )

    def test_batch_duplicate_error_marks_only_that_flight_transferred(self):
        service = self._service()
        flights = [SimpleNamespace(uuid=uuid4()), SimpleNamespace(uuid=uuid4())]
        exc = _gesasso_http_error(400, [
            {"property_path": "flightCollection[0].winchPersonLicenceNumber", "message": "Ce champ est requis."},
            {"property_path": "flightCollection[0]", "message": "Un vol avec les mêmes informations existe déjà."},
        ])
        status_map = service._classify_batch_error(exc, flights)
        self.assertEqual(status_map[flights[0].uuid], 2)
        self.assertEqual(status_map[flights[1].uuid], 3)

    def test_batch_non_duplicate_error_marks_failed(self):
        service = self._service()
        flights = [SimpleNamespace(uuid=uuid4())]
        exc = _gesasso_http_error(400, [
            {"property_path": "flightCollection[0].winchPersonLicenceNumber", "message": "Ce champ est requis."},
        ])
        status_map = service._classify_batch_error(exc, flights)
        self.assertEqual(status_map[flights[0].uuid], 3)

    def test_single_put_duplicate_error_marks_transferred(self):
        service = self._service()
        exc = _gesasso_http_error(400, {"message": "Un vol avec les mêmes informations existe déjà."})
        self.assertEqual(service._classify_single_error(exc), 2)

    def test_single_put_other_error_marks_failed(self):
        service = self._service()
        exc = _gesasso_http_error(400, {"message": "Some other validation error."})
        self.assertEqual(service._classify_single_error(exc), 3)


class BatchSyncDuplicateErrorIntegrationTests(IsolatedAsyncioTestCase):
    async def test_duplicate_error_during_post_marks_flight_synced_not_failed(self):
        flight = ValidatedFlight(
            uuid=uuid4(),
            planche_uuid="p1",
            jour=None,
            asset_code="F-CABC",
            pilot_erp_id="M1",
            type_of_flight=1,
            launch_method=2,
            takeoff_time="10:00",
            landing_time="11:00",
            landing_count=1,
            validated_by="test",
        )
        db = _FakeDb(execute_results=[
            _FakeResult([flight]),                                       # select(ValidatedFlight) [precheck]
            _FakeResult([SimpleNamespace(account_id="M1", ffvp_id=111)]),  # build_ffvp_map
            _FakeResult([flight]),                                       # select(ValidatedFlight) [base class]
            _FakeResult([]),                                             # get_latest_log -> None
        ])
        service = GesassoSyncService(
            base_url="https://api.gesasso.example", username="u", password="p", association_code="CODE",
        )

        error = _gesasso_http_error(400, [
            {"property_path": "flightCollection[0]", "message": "Un vol avec les mêmes informations existe déjà."},
        ])

        async def _raise(*_args, **_kwargs):
            raise error

        service.post_flight_collection = _raise

        result = await service.batch_sync_flights(db, [flight.uuid], triggered_by="tester")

        self.assertEqual(result["synced"], 1)
        self.assertEqual(result["failed"], 0)
        sync_logs = [o for o in db.added if type(o).__name__ == "FederalSyncLog"]
        self.assertEqual(len(sync_logs), 1)
        self.assertEqual(sync_logs[0].status, 2)
