"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - planche_integration: Phase 1 service for Planche API sync, import, and validation operations
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
from typing import Any, Optional
import asyncio
import json
import logging

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Member, Asset, ValidatedFlight, AuditLog

logger = logging.getLogger(__name__)


class PlancheIntegrationService:
    """
    Service for syncing Member, Asset, and Flight data with Planche backend.

    Handles batch operations for pushing pilots/machines and pulling validated flights.
    Includes retry logic, error normalization, and audit trail logging.
    """

    def __init__(
        self,
        base_url: str,
        connection_id: str,
        token: str,
        user: str,
        password: str,
        retry_max_attempts: int = 3,
        retry_backoff_ms: int = 1000,
    ):
        """
        Initialize the Planche integration service.

        Args:
            base_url: Base URL of Planche API
            connection_id: Connection identifier
            token: API token (LOGBOOK-API-KEY)
            user: User/device credential
            password: Password/credential
            retry_max_attempts: Max retry attempts for failed requests
            retry_backoff_ms: Backoff delay in milliseconds (exponential)
        """
        self.base_url = base_url
        self.connection_id = connection_id
        self.token = token
        self.user = user
        self.password = password
        self.retry_max_attempts = retry_max_attempts
        self.retry_backoff_ms = retry_backoff_ms

    async def batch_push_pilots(
        self, db: AsyncSession, triggered_by: str = "system"
    ) -> dict[str, Any]:
        """
        Push eligible pilots (active members with can_fly=true) to Planche.

        Returns:
            {
                "total": int,
                "success": int,
                "failure": int,
                "error_details": [str],
            }
        """
        try:
            # Query active members eligible for sync
            stmt = select(Member).where(
                (Member.can_fly == True) & (Member.status == 1)  # Active status
            )
            result = await db.execute(stmt)
            eligible_members = result.scalars().all()

            success_count = 0
            failure_count = 0
            error_details = []

            for member in eligible_members:
                try:
                    pilot_payload = {
                        "ffvp_id": member.ffvp_id,
                        "account_id": member.account_id,
                        "first_name": member.first_name,
                        "last_name": member.last_name,
                        "email": member.email,
                        "phone": member.phone,
                        "trigram": member.trigram,
                    }

                    response = await self._perform_request(
                        method="POST",
                        endpoint="/pilotes",
                        json=pilot_payload,
                    )

                    if response.status_code in (200, 201):
                        response_data = response.json()
                        # Planche successfully received the pilot
                        # (No need to cache Planche pilot ID - Planche provides member_id)
                        success_count += 1
                    else:
                        error_details.append(
                            f"Member {member.uuid}: HTTP {response.status_code}"
                        )
                        failure_count += 1
                except Exception as e:
                    error_details.append(f"Member {member.uuid}: {str(e)}")
                    failure_count += 1

            # Commit changes
            await db.commit()

            # Log audit trail
            await self._log_audit(
                db=db,
                operation_type="pilot_push",
                status=0 if failure_count == 0 else (2 if success_count > 0 else 1),
                total_records=len(eligible_members),
                success_count=success_count,
                failure_count=failure_count,
                error_message="\n".join(error_details) if error_details else None,
                triggered_by=triggered_by,
            )

            return {
                "total": len(eligible_members),
                "success": success_count,
                "failure": failure_count,
                "error_details": error_details,
            }

        except Exception as e:
            logger.exception("Error in batch_push_pilots")
            await self._log_audit(
                db=db,
                operation_type="pilot_push",
                status=1,  # error
                error_message=str(e),
                triggered_by=triggered_by,
            )
            raise

    async def batch_push_machines(
        self, db: AsyncSession, triggered_by: str = "system"
    ) -> dict[str, Any]:
        """
        Push eligible machines (active assets) to Planche.

        Returns:
            {
                "total": int,
                "success": int,
                "failure": int,
                "error_details": [str],
            }
        """
        try:
            # Query active assets
            stmt = select(Asset).where(
                (Asset.is_active == True) & (Asset.status == 1)  # Operational
            )
            result = await db.execute(stmt)
            eligible_assets = result.scalars().all()

            success_count = 0
            failure_count = 0
            error_details = []

            for asset in eligible_assets:
                try:
                    machine_payload = {
                        "code": asset.code,
                        "registration": asset.registration,
                        "model": asset.model,
                        "manufacturer": asset.manufacturer,
                        "year": asset.year_of_manufacture,
                    }

                    response = await self._perform_request(
                        method="POST",
                        endpoint="/machines",
                        json=machine_payload,
                    )

                    if response.status_code in (200, 201):
                        response_data = response.json()
                        # Planche successfully received the machine
                        # (No need to cache Planche machine ID - Planche provides asset_code)
                        success_count += 1
                    else:
                        error_details.append(
                            f"Asset {asset.uuid}: HTTP {response.status_code}"
                        )
                        failure_count += 1
                except Exception as e:
                    error_details.append(f"Asset {asset.uuid}: {str(e)}")
                    failure_count += 1

            # Commit changes
            await db.commit()

            # Log audit trail
            await self._log_audit(
                db=db,
                operation_type="machine_push",
                status=0 if failure_count == 0 else (2 if success_count > 0 else 1),
                total_records=len(eligible_assets),
                success_count=success_count,
                failure_count=failure_count,
                error_message="\n".join(error_details) if error_details else None,
                triggered_by=triggered_by,
            )

            return {
                "total": len(eligible_assets),
                "success": success_count,
                "failure": failure_count,
                "error_details": error_details,
            }

        except Exception as e:
            logger.exception("Error in batch_push_machines")
            await self._log_audit(
                db=db,
                operation_type="machine_push",
                status=1,  # error
                error_message=str(e),
                triggered_by=triggered_by,
            )
            raise

    async def pull_validated_flights(
        self,
        db: AsyncSession,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        triggered_by: str = "system",
    ) -> dict[str, Any]:
        """
        Pull validated flights from Planche and upsert into ERP.

        Args:
            db: AsyncSession for database operations
            from_date: Start date for flight query (optional)
            to_date: End date for flight query (optional)
            triggered_by: User/system identifier triggering the pull

        Returns:
            {
                "total": int,
                "created": int,
                "updated": int,
                "skipped": int,
                "error_details": [str],
            }
        """
        try:
            # Build query parameters
            params = {}
            if from_date:
                params["from_date"] = from_date.isoformat()
            if to_date:
                params["to_date"] = to_date.isoformat()

            # Pull flights from Planche
            response = await self._perform_request(
                method="GET",
                endpoint="/validated-flights",
                params=params,
            )

            if response.status_code != 200:
                raise ValueError(
                    f"Failed to pull flights: HTTP {response.status_code}"
                )

            flights_data = response.json()
            if not isinstance(flights_data, list):
                flights_data = flights_data.get("results", [])

            created_count = 0
            updated_count = 0
            skipped_count = 0
            error_details = []

            for flight_data in flights_data:
                try:
                    planche_uuid = flight_data.get("uuid")
                    if not planche_uuid:
                        skipped_count += 1
                        continue

                    # Check if flight already exists
                    stmt = select(ValidatedFlight).where(
                        ValidatedFlight.planche_uuid == planche_uuid
                    )
                    result = await db.execute(stmt)
                    existing_flight = result.scalar_one_or_none()

                    # Map Planche fields to ValidatedFlight model
                    flight_obj = existing_flight or ValidatedFlight()
                    flight_obj.planche_uuid = planche_uuid
                    flight_obj.aero = flight_data.get("aero", "")
                    flight_obj.jour = flight_data.get("jour")
                    flight_obj.glider_immat = flight_data.get("glider_immat", "")
                    flight_obj.pilot_erp_id = flight_data.get("pilot_erp_id", "")
                    flight_obj.second_pilot_erp_id = flight_data.get("second_pilot_erp_id")
                    flight_obj.charge_to_erp_id = flight_data.get("charge_to_erp_id")
                    flight_obj.instruction_split = flight_data.get("instruction_split", 0)
                    flight_obj.vi_erp_id = flight_data.get("vi_erp_id")
                    flight_obj.typeOfFlight = flight_data.get("typeOfFlight", 0)
                    flight_obj.launchMethod = flight_data.get("launchMethod", 0)
                    flight_obj.launchType = flight_data.get("launchType")
                    flight_obj.launch_machine_immat = flight_data.get(
                        "launch_machine_immat"
                    )
                    flight_obj.launch_pilot_trigram = flight_data.get(
                        "launch_pilot_trigram"
                    )
                    flight_obj.launch_instructor_trigram = flight_data.get(
                        "launch_instructor_trigram"
                    )
                    flight_obj.takeoffTime = flight_data.get("takeoffTime", "00:00")
                    flight_obj.landingTime = flight_data.get("landingTime", "00:00")
                    flight_obj.startIndex = flight_data.get("startIndex")
                    flight_obj.stopIndex = flight_data.get("stopIndex")
                    flight_obj.engineTime = flight_data.get("engineTime")
                    flight_obj.landingCount = flight_data.get("landingCount", 1)
                    flight_obj.flightKm = flight_data.get("flightKm")
                    flight_obj.takeoffLocation = flight_data.get("takeoffLocation")
                    flight_obj.landedLocation = flight_data.get("landedLocation")
                    flight_obj.observations = flight_data.get("observations")
                    # NOTE: Charges are stored separately in flight_charges table
                    # They will be imported/managed by Phase 2 charge reconciliation endpoints
                    flight_obj.erp_status = 0  # validated (draft)
                    flight_obj.validated_at = datetime.now(timezone.utc)
                    flight_obj.validated_by = triggered_by

                    if existing_flight:
                        # Mark as potentially modified if status was transferred
                        if flight_obj.erp_status == 1:
                            flight_obj.erp_status = 2  # modified_after_transfer
                        updated_count += 1
                    else:
                        db.add(flight_obj)
                        created_count += 1

                except Exception as e:
                    error_details.append(f"Flight {planche_uuid}: {str(e)}")

            # Commit all changes
            await db.commit()

            # Log audit trail
            await self._log_audit(
                db=db,
                operation_type="flights_pull",
                status=0 if not error_details else (2 if created_count + updated_count > 0 else 1),
                total_records=len(flights_data),
                success_count=created_count + updated_count,
                failure_count=len(error_details),
                error_message="\n".join(error_details) if error_details else None,
                triggered_by=triggered_by,
                metadata=json.dumps(
                    {
                        "created": created_count,
                        "updated": updated_count,
                        "skipped": skipped_count,
                    }
                ),
            )

            return {
                "total": len(flights_data),
                "created": created_count,
                "updated": updated_count,
                "skipped": skipped_count,
                "error_details": error_details,
            }

        except Exception as e:
            logger.exception("Error in pull_validated_flights")
            await self._log_audit(
                db=db,
                operation_type="flights_pull",
                status=1,  # error
                error_message=str(e),
                triggered_by=triggered_by,
            )
            raise

    async def _perform_request(
        self,
        method: str,
        endpoint: str,
        json: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> httpx.Response:
        """
        Perform HTTP request to Planche API with retry logic.

        Args:
            method: HTTP method (GET, POST, PATCH, etc.)
            endpoint: API endpoint (e.g., '/pilotes', '/machines', '/validated-flights')
            json: JSON payload (for POST/PATCH)
            params: Query parameters

        Returns:
            httpx.Response object

        Raises:
            httpx.HTTPError if all retries fail
        """
        url = f"{self.base_url}{endpoint}"
        headers = {
            "LOGBOOK-API-KEY": self.token,
            "Content-Type": "application/json",
        }

        for attempt in range(self.retry_max_attempts):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.request(
                        method=method,
                        url=url,
                        headers=headers,
                        json=json,
                        params=params,
                    )
                    # Return on success or client error (let caller handle)
                    if response.status_code < 500:
                        return response
                    # Retry on server error
                    if attempt < self.retry_max_attempts - 1:
                        backoff_ms = self.retry_backoff_ms * (2 ** attempt)
                        await asyncio.sleep(backoff_ms / 1000.0)
                        continue
                    return response

            except (httpx.TimeoutException, httpx.NetworkError) as e:
                if attempt < self.retry_max_attempts - 1:
                    backoff_ms = self.retry_backoff_ms * (2 ** attempt)
                    await asyncio.sleep(backoff_ms / 1000.0)
                    continue
                raise

        raise httpx.RequestError(f"Failed to connect to {url}")

    async def _log_audit(
        self,
        db: AsyncSession,
        operation_type: str,
        status: int,
        total_records: Optional[int] = None,
        success_count: Optional[int] = None,
        failure_count: Optional[int] = None,
        error_message: Optional[str] = None,
        triggered_by: Optional[str] = None,
        affected_record_id: Optional[str] = None,
        metadata: Optional[str] = None,
    ) -> None:
        """Log operation to audit trail."""
        audit_log = AuditLog(
            operation_type=operation_type,
            status=status,
            total_records=total_records,
            success_count=success_count,
            failure_count=failure_count,
            error_message=error_message,
            triggered_by=triggered_by,
            affected_record_id=affected_record_id,
            metadata=metadata,
        )
        db.add(audit_log)
        await db.commit()
