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
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AuditLog, FederalSyncLog, Member, ValidatedFlight

logger = logging.getLogger(__name__)


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
                    for flight in new_flights:
                        await self._write_log(db, flight.uuid, status=3)
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
                    await self._write_log(db, flight.uuid, status=3, external_id=ext_id)
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

        # Build ffvp_id map: pilot_erp_id (member UUID str) → str(ffvp_id)
        pilot_uuids_str = list({f.pilot_erp_id for f in flights if f.pilot_erp_id})
        if pilot_uuids_str:
            try:
                pilot_uuids = [UUID(u) for u in pilot_uuids_str]
                mr = await db.execute(
                    select(Member.uuid, Member.ffvp_id).where(Member.uuid.in_(pilot_uuids))
                )
                self._ffvp_map = {
                    str(row.uuid): str(row.ffvp_id)
                    for row in mr.all()
                    if row.ffvp_id is not None
                }
            except Exception:
                self._ffvp_map = {}
        else:
            self._ffvp_map = {}

        # Pre-reject flights whose pilot has no ffvp_id
        rejected_count = 0
        valid_uuids: list[UUID] = []
        for f in flights:
            pilot_id = str(f.pilot_erp_id) if f.pilot_erp_id else ""
            if not self._ffvp_map.get(pilot_id):
                await self._write_log(db, f.uuid, status=3)
                rejected_count += 1
                logger.warning(
                    "gesasso_sync: flight %s rejected — pilot %s has no ffvp_id",
                    f.uuid,
                    pilot_id,
                )
            else:
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
        """Map a ValidatedFlight to a GesAsso POST /flights-collection.json payload."""
        launching_mode_map = {
            0: "AUTONOMOUS",
            1: "WINCH",
            2: "AIRCRAFT_TOWING",
            3: "CAR_TOWING",
        }
        is_instruction = flight.type_of_flight in (0, 5, 6)
        payload: dict[str, Any] = {
            "date": flight.jour.isoformat() if flight.jour else None,
            "association_code": self.association_code,
            "instruction_flight": is_instruction,
            "takeoff_count": flight.landing_count or 1,
        }

        pilot_id = str(flight.pilot_erp_id) if flight.pilot_erp_id else ""
        ffvp_id = self._ffvp_map.get(pilot_id)
        if ffvp_id:
            payload["person_one_licence_number"] = ffvp_id

        if flight.asset_code:
            payload["aircraft_registration"] = flight.asset_code
        if flight.takeoff_time:
            payload["takeoff_time"] = flight.takeoff_time
        if flight.landing_time:
            payload["landing_time"] = flight.landing_time
        if flight.launch_method is not None:
            payload["launching_mode"] = launching_mode_map.get(flight.launch_method, "AUTONOMOUS")
        if flight.engine_time is not None:
            payload["engine_duration"] = int(flight.engine_time)
        if flight.launch_asset_code:
            payload["tow_aircraft_registration"] = flight.launch_asset_code
        if flight.takeoff_location:
            payload["takeoff_oaci_code"] = flight.takeoff_location
        if flight.landed_location:
            payload["landing_oaci_code"] = flight.landed_location
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
