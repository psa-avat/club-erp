"""
    ERP-CLUB - ERP pour Club de vol à voile
    - federal_sync: Service de synchronisation des vols vers les APIs fédérales (GesAsso, OSRT, …)
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

from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AuditLog, FederalSyncLog, Member, ValidatedFlight

logger = logging.getLogger(__name__)

_TRIGRAM_PAREN_PATTERN = re.compile(r"\(([A-Za-z]{3})\)")


def _normalize_trigram(raw: str) -> str:
    """Best-effort normalization of a Planche launch_pilot_trigram value.

    Usually a plain 3-letter code, returned as-is (uppercased). Occasionally a
    full name is entered in that field by mistake, e.g. "Prénom Nom (ABC)" —
    in that case extract the parenthesized code so the member lookup still
    matches instead of silently falling back to an "external" declaration.
    """
    value = raw.strip()
    if len(value) == 3:
        return value.upper()
    match = _TRIGRAM_PAREN_PATTERN.search(value)
    if match:
        return match.group(1).upper()
    return value


class FederalSyncService:
    """
    Base class for federal synchronisation services.

    One instance per platform (gesasso, osrt, …). Subclasses implement
    platform-specific mapping and API calls.
    """

    PLATFORM = "gesasso"

    def __init__(
        self,
        platform: str,
        base_url: str,
        association_code: str,
    ):
        self.platform = platform
        self.base_url = base_url.rstrip("/")
        self.association_code = association_code

    # ------------------------------------------------------------------
    # Helpers: last known status
    # ------------------------------------------------------------------

    async def get_latest_log(self, db: AsyncSession, flight_uuid: UUID) -> FederalSyncLog | None:
        result = await db.execute(
            select(FederalSyncLog)
            .where(
                FederalSyncLog.validated_flight_uuid == flight_uuid,
                FederalSyncLog.platform == self.platform,
            )
            .order_by(FederalSyncLog.attempt_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_external_id(self, db: AsyncSession, flight_uuid: UUID) -> str | None:
        log = await self.get_latest_log(db, flight_uuid)
        return log.external_id if log and log.external_id else None

    # ------------------------------------------------------------------
    # Log writing
    # ------------------------------------------------------------------

    async def _write_log(
        self,
        db: AsyncSession,
        flight_uuid: UUID,
        status: int,
        external_id: str | None = None,
    ) -> FederalSyncLog:
        log = FederalSyncLog(
            validated_flight_uuid=flight_uuid,
            platform=self.platform,
            status=status,
            external_id=external_id,
            attempt_at=datetime.now(timezone.utc),
        )
        db.add(log)
        return log

    # ------------------------------------------------------------------
    # Mapping ERP → Platform (override in subclasses)
    # ------------------------------------------------------------------

    def map_flight(self, flight: ValidatedFlight) -> dict[str, Any]:
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Error classification (override in subclasses)
    #
    # A platform's "flight already exists" validation error means the flight
    # really is present server-side — recording it as a plain failure would
    # make it fail forever on every retry. Subclasses that can parse their
    # platform's error payload should override these to map such errors to
    # status=2 (transferred) instead of status=3 (failed).
    # ------------------------------------------------------------------

    def _classify_batch_error(
        self, exc: httpx.HTTPStatusError, flights: list[ValidatedFlight]
    ) -> dict[UUID, int]:
        """Default: every flight in the failed batch is marked failed (status=3)."""
        return {f.uuid: 3 for f in flights}

    def _classify_single_error(self, exc: httpx.HTTPStatusError) -> int:
        """Default: any single-flight (PUT) error is marked failed (status=3)."""
        return 3

    # ------------------------------------------------------------------
    # API Calls (override in subclasses)
    # ------------------------------------------------------------------

    async def post_flight_collection(
        self, client: httpx.AsyncClient, flights: list[ValidatedFlight]
    ) -> dict[str, Any]:
        raise NotImplementedError

    async def put_flight(
        self, client: httpx.AsyncClient, external_id: str, flight: ValidatedFlight
    ) -> dict[str, Any]:
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Sync Orchestration
    # ------------------------------------------------------------------

    async def batch_sync_flights(
        self,
        db: AsyncSession,
        flight_uuids: list[UUID],
        triggered_by: str = "system",
        force: bool = False,
    ) -> dict[str, Any]:
        """
        Manually synchronise a list of flights.

        Strategy:
        1. Already-transferred flights (last log status=2) → skip unless force=True.
        2. Flights without known external_id → POST batch (create).
        3. Flights with external_id (forced resend) → PUT (update).
        4. Write one FederalSyncLog per attempt.
        """
        result = await db.execute(
            select(ValidatedFlight).where(ValidatedFlight.uuid.in_(flight_uuids))
        )
        flights = result.scalars().all()

        if not flights:
            return {
                "status": "error",
                "detail": "No flights found",
                "synced": 0,
                "failed": 0,
                "already_transferred": 0,
            }

        synced = 0
        failed = 0
        already_transferred = 0
        errors: list[str] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            new_flights: list[ValidatedFlight] = []
            update_flights: list[ValidatedFlight] = []

            for flight in flights:
                last_log = await self.get_latest_log(db, flight.uuid)
                if last_log and last_log.status == 2 and not force:
                    already_transferred += 1
                    continue
                ext_id = last_log.external_id if last_log else None
                if ext_id:
                    update_flights.append(flight)
                else:
                    new_flights.append(flight)

            # --- New flights: POST batch ---
            if new_flights:
                try:
                    resp_data = await self.post_flight_collection(client, new_flights)
                    for i, flight in enumerate(new_flights):
                        created_list = resp_data.get("flight_collection", [])
                        if i < len(created_list):
                            created = created_list[i]
                            await self._write_log(
                                db,
                                flight.uuid,
                                status=2,
                                external_id=str(created.get("id", "")),
                            )
                            synced += 1
                        else:
                            await self._write_log(db, flight.uuid, status=3)
                            failed += 1
                except httpx.HTTPStatusError as exc:
                    status_map = self._classify_batch_error(exc, new_flights)
                    for flight in new_flights:
                        flight_status = status_map.get(flight.uuid, 3)
                        await self._write_log(db, flight.uuid, status=flight_status)
                        if flight_status == 2:
                            synced += 1
                        else:
                            failed += 1
                    errors.append(f"POST batch failed: {exc.response.status_code}")
                except httpx.RequestError as exc:
                    for flight in new_flights:
                        await self._write_log(db, flight.uuid, status=3)
                        failed += 1
                    errors.append(f"Network error: {str(exc)[:200]}")

            # --- Updates: PUT ---
            for flight in update_flights:
                ext_id = await self.get_external_id(db, flight.uuid)
                try:
                    await self.put_flight(client, ext_id, flight)
                    await self._write_log(db, flight.uuid, status=2, external_id=ext_id)
                    synced += 1
                except httpx.HTTPStatusError as exc:
                    flight_status = self._classify_single_error(exc)
                    await self._write_log(db, flight.uuid, status=flight_status, external_id=ext_id)
                    if flight_status == 2:
                        synced += 1
                    else:
                        failed += 1
                        errors.append(f"PUT {ext_id} failed: {exc.response.status_code}")
                except httpx.RequestError as exc:
                    await self._write_log(db, flight.uuid, status=3, external_id=ext_id)
                    failed += 1

            await db.commit()

        audit = AuditLog(
            operation_type=f"{self.platform}_sync_push",
            status=1 if failed > 0 else 0,
            result_summary=f"synced={synced}, failed={failed}",
            total_records=len(flight_uuids),
            success_count=synced,
            failure_count=failed,
            error_message="; ".join(errors) if errors else None,
            triggered_by=triggered_by,
        )
        db.add(audit)
        await db.commit()

        return {
            "status": "complete",
            "platform": self.platform,
            "total": len(flight_uuids),
            "synced": synced,
            "failed": failed,
            "already_transferred": already_transferred,
            "errors": errors,
        }


# ---------------------------------------------------------------------------
# WSSE helpers
# ---------------------------------------------------------------------------

def _make_wsse_headers(username: str, secret: str) -> dict[str, str]:
    """
    Generate a WSSE UsernameToken header for the GesAsso API.

    Format: X-WSSE: UsernameToken Username="...", PasswordDigest="...", Nonce="...", Created="..."
    PasswordDigest = base64( SHA1( nonce_bytes + created_str.encode() + secret.encode() ) )
    """
    nonce_bytes = os.urandom(16)
    b64_nonce = base64.b64encode(nonce_bytes).decode()
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sha1_input = nonce_bytes + created.encode() + secret.encode()
    password_digest = base64.b64encode(hashlib.sha1(sha1_input).digest()).decode()
    return {
        "X-WSSE": (
            f'UsernameToken Username="{username}", '
            f'PasswordDigest="{password_digest}", '
            f'Nonce="{b64_nonce}", '
            f'Created="{created}"'
        )
    }


# ---------------------------------------------------------------------------
# GesAsso implementation
# ---------------------------------------------------------------------------

class GesassoSyncService(FederalSyncService):
    """Flight push service for the GesAsso (FFVP) platform — WSSE auth, REST/JSON."""

    PLATFORM = "gesasso"

    # Issue codes returned by check_flight_issues(). Shared between the actual
    # sync path (batch_sync_flights) and the read-only candidates listing, so the
    # UI can never show a flight as sendable when it would in fact be rejected.
    #
    # person_one (pilot, or instructor for instruction flights) has no GesAsso
    # "external" fallback as far as we know — missing their ffvp_id blocks the
    # send. Winch/tow operators DO have one (winch_person_external /
    # tow_person_one_external + *_information, sent by map_flight when no
    # ffvp_id is found) — so those issues are informational only, not blocking.
    ISSUE_PERSON_ONE_MISSING_FFVP_ID = "person_one_missing_ffvp_id"
    ISSUE_WINCH_OPERATOR_MISSING_FFVP_ID = "winch_operator_missing_ffvp_id"
    ISSUE_TOW_OPERATOR_MISSING_FFVP_ID = "tow_operator_missing_ffvp_id"
    BLOCKING_ISSUE_CODES = {ISSUE_PERSON_ONE_MISSING_FFVP_ID}

    # tow_aircraft_registration is validated against a real aircraft registry
    # and is rejected outright when tow_aircraft_external=true ("not allowed
    # for externals" / "cannot find this identifier") — the two are mutually
    # exclusive. AircraftTypeEnum accepted values: PLANE|GLIDER|ULM|TMG.
    TOW_AIRCRAFT_EXTERNAL_TYPE = "PLANE"

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        association_code: str,
    ):
        super().__init__(platform="gesasso", base_url=base_url, association_code=association_code)
        self._username = username
        self._password = password
        # Populated by batch_sync_flights before API calls: pilot_erp_id → str(ffvp_id)
        self._ffvp_map: dict[str, str] = {}

    def _wsse_headers(self) -> dict[str, str]:
        return _make_wsse_headers(self._username, self._password)

    # ------------------------------------------------------------------
    # Pre-check helpers — shared between batch_sync_flights (actual rejection)
    # and the read-only sync-candidates listing (UI preview of what would happen)
    # ------------------------------------------------------------------

    @staticmethod
    async def build_ffvp_map(db: AsyncSession, flights: list[ValidatedFlight]) -> dict[str, str]:
        """Build a lookup map (member account_id or trigram) → str(ffvp_id) for every
        pilot, second pilot/instructor, and winch/tow operator referenced by `flights`."""
        ffvp_map: dict[str, str] = {}

        all_erp_ids = {f.pilot_erp_id for f in flights if f.pilot_erp_id} | \
                      {f.second_pilot_erp_id for f in flights if f.second_pilot_erp_id}
        if all_erp_ids:
            try:
                mr = await db.execute(
                    select(Member.account_id, Member.ffvp_id).where(
                        Member.account_id.in_(all_erp_ids)
                    )
                )
                ffvp_map = {
                    str(row.account_id): str(row.ffvp_id)
                    for row in mr.all()
                    if row.ffvp_id is not None
                }
            except Exception:
                ffvp_map = {}

        # Extend map with trigram → ffvp_id for winch/tow persons
        all_trigrams = {
            _normalize_trigram(f.launch_pilot_trigram) for f in flights if f.launch_pilot_trigram
        }
        if all_trigrams:
            try:
                tr = await db.execute(
                    select(Member.trigram, Member.ffvp_id).where(
                        Member.trigram.in_(all_trigrams)
                    )
                )
                for row in tr.all():
                    if row.ffvp_id is not None:
                        ffvp_map[str(row.trigram)] = str(row.ffvp_id)
            except Exception:
                pass

        return ffvp_map

    @classmethod
    def check_flight_issues(cls, flight: ValidatedFlight, ffvp_map: dict[str, str]) -> list[dict[str, Any]]:
        """Return issues for `flight` given a pre-built ffvp_map, each as
        {"code": str, "blocking": bool}.

        An empty list, or a list containing only non-blocking issues, means the
        flight can be sent to GesAsso as-is.
        - Instruction flights (type_of_flight 0/5/6) require the instructor
          (second_pilot_erp_id) to have a known ffvp_id — blocking, no fallback.
        - Other flights require the pilot (pilot_erp_id) to have one — blocking.
        - WINCH/tow launches (launch_method 1/other) flag a missing operator
          ffvp_id, but map_flight falls back to GesAsso's *_external fields for
          them, so this is informational only (not blocking).
        """
        issues: list[dict[str, Any]] = []

        def _add(code: str) -> None:
            issues.append({"code": code, "blocking": code in cls.BLOCKING_ISSUE_CODES})

        is_instruction = flight.type_of_flight in (0, 5, 6)
        person_one_id = str(flight.second_pilot_erp_id) if is_instruction and flight.second_pilot_erp_id \
                        else str(flight.pilot_erp_id) if flight.pilot_erp_id else ""
        if not ffvp_map.get(person_one_id):
            _add(cls.ISSUE_PERSON_ONE_MISSING_FFVP_ID)

        if flight.launch_method == 1:  # WINCH — only checked when a machine was recorded
            if flight.launch_asset_code:
                trigram = str(flight.launch_pilot_trigram) if flight.launch_pilot_trigram else ""
                lookup_trigram = _normalize_trigram(trigram) if trigram else ""
                if not ffvp_map.get(lookup_trigram):
                    _add(cls.ISSUE_WINCH_OPERATOR_MISSING_FFVP_ID)
        elif flight.launch_method in (0, 2):  # AIRCRAFT_TOWING — always applies, even
            # when the tow happened outside the club's own roster (no launch_asset_code)
            trigram = str(flight.launch_pilot_trigram) if flight.launch_pilot_trigram else ""
            lookup_trigram = _normalize_trigram(trigram) if trigram else ""
            if not ffvp_map.get(lookup_trigram):
                _add(cls.ISSUE_TOW_OPERATOR_MISSING_FFVP_ID)

        return issues

    # ------------------------------------------------------------------
    # Override batch_sync_flights to add ffvp_id pre-check
    # ------------------------------------------------------------------

    async def batch_sync_flights(
        self,
        db: AsyncSession,
        flight_uuids: list[UUID],
        triggered_by: str = "system",
        force: bool = False,
    ) -> dict[str, Any]:
        result = await db.execute(
            select(ValidatedFlight).where(ValidatedFlight.uuid.in_(flight_uuids))
        )
        flights = result.scalars().all()

        if not flights:
            return {
                "status": "error",
                "detail": "No flights found",
                "synced": 0,
                "failed": 0,
                "already_transferred": 0,
            }

        self._ffvp_map = await self.build_ffvp_map(db, flights)

        # Pre-reject flights with blocking issues (missing ffvp_id on required persons).
        # Non-blocking issues (e.g. winch/tow operator without a licence) are sent
        # anyway — map_flight declares them "external" to GesAsso instead.
        rejected_count = 0
        valid_uuids: list[UUID] = []
        for f in flights:
            issues = self.check_flight_issues(f, self._ffvp_map)
            blocking_issues = [i for i in issues if i["blocking"]]
            if blocking_issues:
                await self._write_log(db, f.uuid, status=3)
                rejected_count += 1
                logger.warning(
                    "gesasso_sync: flight %s rejected — issues=%s", f.uuid, blocking_issues,
                )
                continue
            valid_uuids.append(f.uuid)

        if rejected_count:
            await db.commit()

        if not valid_uuids:
            audit = AuditLog(
                operation_type="gesasso_sync_push",
                status=1,
                result_summary=f"synced=0, failed={rejected_count}",
                total_records=len(flight_uuids),
                success_count=0,
                failure_count=rejected_count,
                error_message="All flights rejected: pilot has no ffvp_id",
                triggered_by=triggered_by,
            )
            db.add(audit)
            await db.commit()
            return {
                "status": "complete",
                "platform": self.platform,
                "total": len(flight_uuids),
                "synced": 0,
                "failed": rejected_count,
                "already_transferred": 0,
                "errors": ["All flights rejected: pilot has no ffvp_id"],
            }

        # Delegate to base class for the actual sync
        result_dict = await super().batch_sync_flights(db, valid_uuids, triggered_by, force)
        # Merge rejected count back into totals
        result_dict["failed"] = result_dict.get("failed", 0) + rejected_count
        result_dict["total"] = len(flight_uuids)
        return result_dict

    # ------------------------------------------------------------------
    # Flight mapping
    # ------------------------------------------------------------------

    def map_flight(self, flight: ValidatedFlight) -> dict[str, Any]:
        """Map a ValidatedFlight to a GesAsso POST /flights-collection.json payload.

        Person roles:
          - Instruction flight (type_of_flight 0/5/6):
              person_one = instructor (second_pilot_erp_id)
              person_two = student    (pilot_erp_id)
          - Other flights:
              person_one = pilot      (pilot_erp_id)
              person_two = second pilot if present (second_pilot_erp_id)
        """
        # ERP launch_method: 0=extérieur, 1=treuil, 2=remorqueur, 3=autonome
        launching_mode_map = {
            0: "AIRCRAFT_TOWING",   # extérieur — external/guest tow, best approximation
            1: "WINCH",             # treuil
            2: "AIRCRAFT_TOWING",   # remorqueur
            3: "AUTONOMOUS",        # autonome (self-launch / TMG)
        }
        is_instruction = flight.type_of_flight in (0, 5, 6)

        pilot_id = str(flight.pilot_erp_id) if flight.pilot_erp_id else ""
        second_id = str(flight.second_pilot_erp_id) if flight.second_pilot_erp_id else ""

        if is_instruction:
            person_one_id = second_id   # instructor
            person_two_id = pilot_id    # student
        else:
            person_one_id = pilot_id    # sole pilot or PIC
            person_two_id = second_id   # second pilot if any

        payload: dict[str, Any] = {
            "date": flight.jour.isoformat() if flight.jour else None,
            "association_code": self.association_code,
            "instruction_flight": is_instruction,
            "takeoff_count": flight.landing_count or 1,
        }

        p1_ffvp = self._ffvp_map.get(person_one_id)
        if p1_ffvp:
            payload["person_one_licence_number"] = p1_ffvp

        p2_ffvp = self._ffvp_map.get(person_two_id) if person_two_id else None
        if p2_ffvp:
            payload["person_two_licence_number"] = p2_ffvp

        if flight.asset_code:
            payload["aircraft_registration"] = flight.asset_code
        if flight.takeoff_time:
            payload["takeoff_time"] = flight.takeoff_time
        if flight.landing_time:
            payload["landing_time"] = flight.landing_time
        if flight.launch_method is not None:
            payload["launching_mode"] = launching_mode_map.get(flight.launch_method, "AUTONOMOUS")
        if flight.engine_time is not None:
            payload["engine_duration"] = int(flight.engine_time*100)
        if flight.launch_method == 1:  # treuil → WINCH
            if flight.launch_asset_code:
                payload["winch_registration"] = flight.launch_asset_code
            trigram = str(flight.launch_pilot_trigram) if flight.launch_pilot_trigram else None
            launch_ffvp = self._ffvp_map.get(_normalize_trigram(trigram)) if trigram else None
            if launch_ffvp:
                payload["winch_person_licence_number"] = launch_ffvp
            else:
                # GesAsso requires either a licence number or an explicit
                # "external" declaration — the operator has no matching ERP
                # member/ffvp_id (e.g. a substitute not yet registered), so
                # declare them external rather than omitting a required field.
                payload["winch_person_external"] = True
                payload["winch_person_external_information"] = trigram or "Non identifié"
        elif flight.launch_method in (0, 2):  # extérieur / remorqueur → AIRCRAFT_TOWING
            # GesAsso requires the tow aircraft/person to be identified one way
            # or the other whenever launching_mode is AIRCRAFT_TOWING, even when
            # the tow happened outside the club's own roster (e.g. an out-landing
            # towed back by another airfield) — so these are sent unconditionally,
            # not gated on launch_asset_code like the WINCH fields above.
            #
            # tow_aircraft_registration is validated against a real aircraft
            # registry and is rejected outright when tow_aircraft_external=true
            # — the two are mutually exclusive. Use the real registration when
            # we have one (a known club tow plane); otherwise declare external
            # with free-text info + an AircraftTypeEnum value, and omit
            # tow_aircraft_registration entirely.
            if flight.launch_asset_code:
                payload["tow_aircraft_registration"] = flight.launch_asset_code
            else:
                payload["tow_aircraft_external"] = True
                payload["tow_aircraft_external_information"] = "Remorqueur non identifié"
                payload["tow_aircraft_external_type"] = self.TOW_AIRCRAFT_EXTERNAL_TYPE

            trigram = str(flight.launch_pilot_trigram) if flight.launch_pilot_trigram else None
            launch_ffvp = self._ffvp_map.get(_normalize_trigram(trigram)) if trigram else None
            if launch_ffvp:
                payload["tow_person_one_licence_number"] = launch_ffvp
            else:
                payload["tow_person_one_external"] = True
                payload["tow_person_one_external_information"] = trigram or "Non identifié"
        takeoff_oaci = flight.takeoff_location or flight.aero
        landing_oaci = flight.landed_location or flight.aero
        if takeoff_oaci:
            payload["takeoff_oaci_code"] = takeoff_oaci
        if landing_oaci:
            payload["landing_oaci_code"] = landing_oaci
        if flight.observations:
            payload["comment"] = flight.observations
        return payload

    async def post_flight_collection(
        self, client: httpx.AsyncClient, flights: list[ValidatedFlight]
    ) -> dict[str, Any]:
        url = f"{self.base_url}/flights-collection.json"
        payloads = [self.map_flight(f) for f in flights]
        response = await client.post(
            url,
            json={"flight_collection": payloads},
            headers=self._wsse_headers(),
        )
        response.raise_for_status()
        return response.json()

    async def put_flight(
        self, client: httpx.AsyncClient, external_id: str, flight: ValidatedFlight
    ) -> dict[str, Any]:
        url = f"{self.base_url}/flights/{external_id}.json"
        response = await client.put(
            url,
            json=self.map_flight(flight),
            headers=self._wsse_headers(),
        )
        response.raise_for_status()
        return response.json()

    # ------------------------------------------------------------------
    # Error classification — GesAsso rejects an exact duplicate flight with a
    # 400 whose body includes a validation error on the flight itself (not a
    # specific field) saying it already exists. That flight IS present on
    # GesAsso, so it must be recorded as transferred (status=2), not failed,
    # or it would fail identically on every future retry.
    # ------------------------------------------------------------------

    _DUPLICATE_ERROR_MARKERS = ("existe déjà", "already exist")
    _FLIGHT_INDEX_PATTERN = re.compile(r"flightCollection\[(\d+)\]")

    @classmethod
    def _is_duplicate_error_message(cls, message: str) -> bool:
        lowered = (message or "").lower()
        return any(marker in lowered for marker in cls._DUPLICATE_ERROR_MARKERS)

    def _classify_batch_error(
        self, exc: httpx.HTTPStatusError, flights: list[ValidatedFlight]
    ) -> dict[UUID, int]:
        status_map = {f.uuid: 3 for f in flights}
        try:
            body = exc.response.json()
        except Exception:
            return status_map
        if not isinstance(body, list):
            return status_map

        for entry in body:
            if not isinstance(entry, dict):
                continue
            match = self._FLIGHT_INDEX_PATTERN.search(entry.get("property_path", ""))
            if not match:
                continue
            index = int(match.group(1))
            if 0 <= index < len(flights) and self._is_duplicate_error_message(entry.get("message", "")):
                status_map[flights[index].uuid] = 2

        return status_map

    def _classify_single_error(self, exc: httpx.HTTPStatusError) -> int:
        try:
            body = exc.response.json()
        except Exception:
            return 3

        entries = body if isinstance(body, list) else [body] if isinstance(body, dict) else []
        for entry in entries:
            if isinstance(entry, dict) and self._is_duplicate_error_message(entry.get("message", "")):
                return 2
        return 3
