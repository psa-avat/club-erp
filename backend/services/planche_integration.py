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

from datetime import date, datetime, timezone
from typing import Any, Optional
import asyncio
import json
import logging

import httpx
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Member, MemberRegistration, Asset, ValidatedFlight, AuditLog

logger = logging.getLogger(__name__)

ACTIVE_MEMBER_STATUS = 1
ACTIVE_REGISTRATION_STATUS = 1

"""
    Service for syncing Member, Asset, and Flight data with Planche backend.

    Handles batch operations for pushing pilots/machines and pulling validated flights.
    Includes retry logic, error normalization, and audit trail logging.
"""

class PlancheIntegrationService:
    _login_token: str | None = None
    _login_token_expiry: float | None = None

    def __init__(
        self,
        base_url: str,
        connection_id: str,
        token: str,
        user: str,
        password: str,
        retry_max_attempts: int = 3,
        retry_backoff_ms: int = 1000,
        chunk_size: int = 10,
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
            chunk_size: Batch size for pilot/machine push
        """
        self.base_url = base_url
        self.connection_id = connection_id
        self.token = token
        self.user = user
        self.password = password
        self.retry_max_attempts = retry_max_attempts
        self.retry_backoff_ms = retry_backoff_ms
        self.chunk_size = chunk_size

    async def _get_login_token(self) -> str:
        """Fetch and cache the Planche login_token using user/password/API key."""
        import time
        # If token is cached and not expired, use it
        if self._login_token and self._login_token_expiry and self._login_token_expiry > time.time():
            return self._login_token

        url = f"{self.base_url}/auth/login"
        headers = {"LOGBOOK-API-KEY": self.token, "Content-Type": "application/json"}
        payload = {"username": self.user, "password": self.password}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                raise Exception(f"Planche login failed: {resp.status_code} {resp.text}")
            data = resp.json()
            token = data.get("login_token")
            if not token:
                raise Exception("No login_token in Planche login response")
            # Write to class-level so the cache survives across instances
            PlancheIntegrationService._login_token = token
            PlancheIntegrationService._login_token_expiry = time.time() + 600
            return token

    async def get_pilot_push_preview(self, db: AsyncSession) -> dict[str, Any]:
        """Return pilot push eligibility counters and Planche reconciliation data."""
        sync_year = date.today().year
        total_active_stmt = select(func.count()).select_from(Member).where(Member.status == ACTIVE_MEMBER_STATUS)
        eligible_stmt = (
            select(func.count())
            .select_from(Member)
            .join(MemberRegistration, MemberRegistration.member_uuid == Member.uuid)
            .where(
                Member.status == ACTIVE_MEMBER_STATUS,
                MemberRegistration.status == ACTIVE_REGISTRATION_STATUS,
                MemberRegistration.registered_for_year == sync_year,
            )
        )
        can_fly_true_stmt = (
            select(func.count())
            .select_from(Member)
            .join(MemberRegistration, MemberRegistration.member_uuid == Member.uuid)
            .where(
                Member.status == ACTIVE_MEMBER_STATUS,
                MemberRegistration.status == ACTIVE_REGISTRATION_STATUS,
                MemberRegistration.registered_for_year == sync_year,
                Member.can_fly.is_(True),
            )
        )
        can_fly_false_stmt = (
            select(func.count())
            .select_from(Member)
            .join(MemberRegistration, MemberRegistration.member_uuid == Member.uuid)
            .where(
                Member.status == ACTIVE_MEMBER_STATUS,
                MemberRegistration.status == ACTIVE_REGISTRATION_STATUS,
                MemberRegistration.registered_for_year == sync_year,
                Member.can_fly.is_(False),
            )
        )
        excluded_inactive_stmt = (
            select(func.count())
            .select_from(Member)
            .join(MemberRegistration, MemberRegistration.member_uuid == Member.uuid)
            .where(
                Member.status != ACTIVE_MEMBER_STATUS,
                MemberRegistration.status == ACTIVE_REGISTRATION_STATUS,
                MemberRegistration.registered_for_year == sync_year,
            )
        )
        last_push_stmt = (
            select(AuditLog.created_at)
            .where(AuditLog.operation_type == "pilot_push")
            .order_by(desc(AuditLog.created_at))
            .limit(1)
        )

        total_count = int((await db.execute(total_active_stmt)).scalar_one() or 0)
        eligible_count = int((await db.execute(eligible_stmt)).scalar_one() or 0)
        can_fly_true_count = int((await db.execute(can_fly_true_stmt)).scalar_one() or 0)
        can_fly_false_count = int((await db.execute(can_fly_false_stmt)).scalar_one() or 0)
        excluded_inactive_count = int((await db.execute(excluded_inactive_stmt)).scalar_one() or 0)
        excluded_not_registered_count = max(total_count - eligible_count, 0)
        last_push_at = (await db.execute(last_push_stmt)).scalar_one_or_none()

        # Fetch Planche pilots and compute reconciliation stats
        planche_pilots = await self._read_planche_pilots()
        total_planche_pilots = len(planche_pilots)
        planche_pilots_with_erp_id = sum(1 for p in planche_pilots if p.get("erp_id"))
        planche_pilots_missing_erp_id = total_planche_pilots - planche_pilots_with_erp_id

        # Build ERP member sets used by sync logic
        registered_members = await self._registered_members_for_sync_year(db, sync_year)
        active_members = await self._active_members(db)
        registered_member_uuids = {member.uuid for member in registered_members}

        # Build matching indexes
        by_erp_id: dict[str, Member] = {self._member_erp_id(m): m for m in active_members}
        by_account_id: dict[str, Member] = {}
        by_ffvp_and_names: dict[str, Member] = {}
        for member in active_members:
            legacy_compta_id = self._legacy_compta_id(member)
            if legacy_compta_id:
                by_account_id[legacy_compta_id] = member
            if member.ffvp_id and member.last_name and member.first_name:
                key = f"{int(member.ffvp_id)}:{self._normalize_name(member.last_name)}:{self._normalize_name(member.first_name)}"
                by_ffvp_and_names[key] = member

        # Count matched and unmatched
        erp_pilots_found_on_planche = 0
        planche_pilots_orphaned = 0  # On Planche but not in ERP
        unregistered_present_count = 0
        matched_member_ids: set[str] = set()
        for pilot in planche_pilots:
            matched_member: Member | None = None
            pilot_erp_id = pilot.get("erp_id")
            if pilot_erp_id and pilot_erp_id in by_erp_id:
                matched_member = by_erp_id[pilot_erp_id]
            else:
                pilot_compta = pilot.get("id_compta")
                if pilot_compta and pilot_compta in by_account_id:
                    matched_member = by_account_id[pilot_compta]
                elif pilot.get("ffvp") and pilot.get("nom") and pilot.get("prenom"):
                    try:
                        pilot_ffvp = int(pilot["ffvp"])
                    except (TypeError, ValueError):
                        pilot_ffvp = None
                    if pilot_ffvp is not None:
                        key = f"{pilot_ffvp}:{self._normalize_name(pilot['nom'])}:{self._normalize_name(pilot['prenom'])}"
                        matched_member = by_ffvp_and_names.get(key)

            if matched_member is not None:
                member_erp_id = self._member_erp_id(matched_member)
                if member_erp_id not in matched_member_ids:
                    matched_member_ids.add(member_erp_id)
                    erp_pilots_found_on_planche += 1
                    if matched_member.uuid not in registered_member_uuids:
                        unregistered_present_count += 1
            else:
                planche_pilots_orphaned += 1

        sync_target_count = eligible_count + unregistered_present_count
        excluded_after_reconciliation_count = max(total_count - sync_target_count, 0)
        erp_pilots_not_on_planche = max(sync_target_count - erp_pilots_found_on_planche, 0)

        return {
            "sync_year": sync_year,
            "eligible_count": sync_target_count,
            "eligible_registered_count": eligible_count,
            "eligible_present_on_planche_unregistered_count": unregistered_present_count,
            "excluded_count": excluded_after_reconciliation_count,
            "excluded_not_registered_count": excluded_not_registered_count,
            "excluded_after_reconciliation_count": excluded_after_reconciliation_count,
            "excluded_inactive_count": excluded_inactive_count,
            "can_fly_true_count": can_fly_true_count,
            "can_fly_false_count": can_fly_false_count,
            "total_members_count": total_count,
            "last_synced_at": last_push_at.isoformat() if last_push_at else None,
            # Planche reconciliation stats
            "planche_total_pilots": total_planche_pilots,
            "planche_pilots_with_erp_id": planche_pilots_with_erp_id,
            "planche_pilots_missing_erp_id": planche_pilots_missing_erp_id,
            "erp_pilots_found_on_planche": erp_pilots_found_on_planche,
            "erp_pilots_not_on_planche": erp_pilots_not_on_planche,
            "planche_pilots_orphaned": planche_pilots_orphaned,
        }

    async def _registered_members_for_sync_year(self, db: AsyncSession, sync_year: int) -> list[Member]:
        stmt = (
            select(Member)
            .join(MemberRegistration, MemberRegistration.member_uuid == Member.uuid)
            .where(
                Member.status == ACTIVE_MEMBER_STATUS,
                MemberRegistration.status == ACTIVE_REGISTRATION_STATUS,
                MemberRegistration.registered_for_year == sync_year,
            )
            .order_by(Member.last_name, Member.first_name)
            .distinct()
        )
        result = await db.execute(stmt)
        return result.scalars().all()

    def _chunk_members(
        self,
        members: list[tuple[Member, dict[str, Any] | None]],
        chunk_size: int,
    ) -> list[list[tuple[Member, dict[str, Any] | None]]]:
        if chunk_size <= 0:
            return [members]
        return [members[i : i + chunk_size] for i in range(0, len(members), chunk_size)]

    async def _active_members(self, db: AsyncSession) -> list[Member]:
        stmt = (
            select(Member)
            .where(Member.status == ACTIVE_MEMBER_STATUS)
            .order_by(Member.last_name, Member.first_name)
        )
        result = await db.execute(stmt)
        return result.scalars().all()

    async def _read_planche_pilots(self) -> list[dict[str, Any]]:
        response = await self._perform_request(
            method="GET",
            endpoint="/erp/pilots",
        )

        # Some Planche accounts may not have ERP endpoint permissions yet.
        # Fallback to the legacy pilots endpoint to keep synchronization operational.
        if response.status_code in (403, 404):
            logger.warning(
                "[Planche] ERP pilots endpoint unavailable (HTTP %s), falling back to /pilotes",
                response.status_code,
            )
            response = await self._perform_request(
                method="GET",
                endpoint="/pilotes",
                params={"active_only": False},
            )

        if response.status_code != 200:
            raise ValueError(f"Unable to fetch pilots from Planche: HTTP {response.status_code}")

        payload = response.json()
        pilots: list[dict[str, Any]] = []
        if isinstance(payload, list):
            pilots = payload
        elif isinstance(payload, dict):
            data = payload.get("data", [])
            if isinstance(data, list):
                pilots = data

        # Keep compatibility with existing matching/reconciliation logic.
        normalized: list[dict[str, Any]] = []
        for pilot in pilots:
            if not isinstance(pilot, dict):
                continue
            item = dict(pilot)
            if "id_compta" not in item and isinstance(item.get("legacy_account_id"), str):
                item["id_compta"] = item.get("legacy_account_id")
            normalized.append(item)

        logger.debug(f"[Planche] Read {len(normalized)} pilots from Planche")
        return normalized

    def _normalize_name(self, name: str | None) -> str:
        """Normalize name for comparison: lowercase, strip whitespace."""
        return (name or "").lower().strip()

    def _member_erp_id(self, member: Member) -> str:
        """Planche erp_id uses ERP member_id (account_id), not UUID."""
        return str(member.account_id)

    def _member_can_fly(self, member: Member) -> bool:
        """Get ERP member's can_fly status."""
        return bool(member.can_fly)

    def _legacy_compta_id(self, member: Member) -> str:
        """Legacy compta identifier remains stable when available."""
        if member.legacy_account_id:
            return str(member.legacy_account_id)
        return str(member.account_id)

    def _build_planche_pilot_indexes(
        self,
        planche_pilots: list[dict[str, Any]],
    ) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        by_erp_id: dict[str, dict[str, Any]] = {}
        by_account_id: dict[str, dict[str, Any]] = {}
        by_ffvp_and_names: dict[str, dict[str, Any]] = {}

        for pilot in planche_pilots:
            pilot_erp_id = pilot.get("erp_id")
            pilot_account_id = pilot.get("id_compta")
            pilot_ffvp = pilot.get("ffvp")
            pilot_nom = pilot.get("nom")
            pilot_prenom = pilot.get("prenom")

            if isinstance(pilot_erp_id, str) and pilot_erp_id:
                by_erp_id[pilot_erp_id] = pilot

            if isinstance(pilot_account_id, str) and pilot_account_id:
                by_account_id[pilot_account_id] = pilot

            try:
                ffvp_value = int(pilot_ffvp) if pilot_ffvp is not None else None
            except (TypeError, ValueError):
                ffvp_value = None
            if ffvp_value is not None and pilot_nom and pilot_prenom:
                key = f"{ffvp_value}:{self._normalize_name(pilot_nom)}:{self._normalize_name(pilot_prenom)}"
                by_ffvp_and_names[key] = pilot

        return by_erp_id, by_account_id, by_ffvp_and_names

    def _find_existing_pilot(
        self,
        member: Member,
        by_erp_id: dict[str, dict[str, Any]],
        by_account_id: dict[str, dict[str, Any]],
        by_ffvp_and_names: dict[str, dict[str, Any]],
    ) -> dict[str, Any] | None:
        """Find existing Planche pilot using multi-field matching strategy.
        
        1. Match by erp_id (best, already synced)
        2. Match by ffvp_id + names (robust, no erp_id yet)
        3. Match by account_id (fallback)
        4. None if no match
        """
        erp_id = self._member_erp_id(member)
        if erp_id in by_erp_id:
            return by_erp_id[erp_id]

        if member.ffvp_id is not None and member.last_name and member.first_name:
            key = f"{int(member.ffvp_id)}:{self._normalize_name(member.last_name)}:{self._normalize_name(member.first_name)}"
            if key in by_ffvp_and_names:
                return by_ffvp_and_names[key]

        if member.account_id and member.account_id in by_account_id:
            return by_account_id[member.account_id]

        return None

    def _build_pilot_payload(self, member: Member, existing_pilot: dict[str, Any] | None) -> dict[str, Any]:
        payload = {
            "nom": member.last_name,
            "prenom": member.first_name,
            "ffvp": int(member.ffvp_id) if member.ffvp_id is not None else None,
            "legacy_account_id": self._legacy_compta_id(member),
            "can_fly": self._member_can_fly(member),
        }

        existing_erp_id = existing_pilot.get("erp_id") if isinstance(existing_pilot, dict) else None
        member_erp_id = self._member_erp_id(member)
        # Only send erp_id when creating or repairing/migrating existing pilot mapping.
        if not isinstance(existing_erp_id, str) or existing_erp_id != member_erp_id:
            payload["erp_id"] = member_erp_id

        return payload

    def _extract_erp_sync_counters(self, payload: Any) -> dict[str, int]:
        """Extract useful numeric counters from ERP sync responses for logging."""
        if not isinstance(payload, dict):
            return {}

        wanted_keys = {
            "total",
            "processed",
            "success",
            "created",
            "updated",
            "skipped",
            "failed",
            "rejected",
        }

        counters: dict[str, int] = {}

        def _collect(d: dict[str, Any]) -> None:
            for key, value in d.items():
                lowered = str(key).lower()
                if lowered in wanted_keys and isinstance(value, int):
                    counters[lowered] = value
                elif isinstance(value, dict):
                    _collect(value)

        _collect(payload)
        return counters

    async def batch_push_pilots(
        self, db: AsyncSession, triggered_by: str = "system"
    ) -> dict[str, Any]:
        """
        Push pilots to Planche.

        Business rules:
        - Member must be active in ERP.
        - Members registered for current year are always synced.
        - Members not registered for current year are also synced when already present on Planche.
        - Member is synced even when can_fly = False.
        - erp_id uses ERP member_id (account_id), not UUID.
        - id_compta is legacy and remains unchanged for existing Planche pilots.

        Returns:
            {
                "total": int,
                "success": int,
                "failure": int,
                "error_details": [str],
            }
        """
        try:
            sync_year = date.today().year
            registered_members = await self._registered_members_for_sync_year(db, sync_year)
            active_members = await self._active_members(db)
            registered_member_uuids = {member.uuid for member in registered_members}
            planche_pilots = await self._read_planche_pilots()
            by_erp_id, by_account_id, by_ffvp_and_names = self._build_planche_pilot_indexes(planche_pilots)

            members_to_sync: list[tuple[Member, dict[str, Any] | None]] = []
            synchronized_unregistered_present_count = 0
            for member in active_members:
                existing = self._find_existing_pilot(
                    member,
                    by_erp_id,
                    by_account_id,
                    by_ffvp_and_names,
                )
                should_sync = member.uuid in registered_member_uuids or existing is not None
                if should_sync:
                    members_to_sync.append((member, existing))
                    if member.uuid not in registered_member_uuids and existing is not None:
                        synchronized_unregistered_present_count += 1

            chunked_members = self._chunk_members(members_to_sync, self.chunk_size)

            success_count = 0
            failure_count = 0
            error_details = []
            repaired_erp_id_count = 0
            created_count = 0
            updated_count = 0
            processed_chunks = 0
            skipped_unchanged_count = 0

            for member_chunk in chunked_members:
                chunk_payload: list[dict[str, Any]] = []
                chunk_items: list[tuple[Member, dict[str, Any] | None]] = []
                
                for member, existing in member_chunk:
                    if isinstance(existing, dict):
                        member_erp_id = self._member_erp_id(member)
                        existing_erp_id = existing.get("erp_id")
                        needs_erp_id_repair = not isinstance(existing_erp_id, str) or existing_erp_id != member_erp_id
                        if needs_erp_id_repair:
                            repaired_erp_id_count += 1

                        # Check if can_fly needs updating
                        existing_can_fly = existing.get("can_fly")
                        desired_can_fly = self._member_can_fly(member)
                        needs_can_fly_update = existing_can_fly != desired_can_fly

                        # Skip API call for unchanged pilots.
                        if not needs_erp_id_repair and not needs_can_fly_update:
                            skipped_unchanged_count += 1
                            continue

                        updated_count += 1
                    else:
                        created_count += 1
                    
                    chunk_payload.append(self._build_pilot_payload(member, existing))
                    chunk_items.append((member, existing))


                if len(chunk_payload) == 0:
                    processed_chunks += 1
                    continue

                try:
                    response = await self._perform_request(
                        method="POST",
                        endpoint="/erp/pilots/sync",
                        json={"dry_run": False, "items": chunk_payload},
                    )
                    response_payload: Any = None
                    try:
                        response_payload = response.json()
                    except Exception:
                        response_payload = None

                    if response.status_code in (200, 201):
                        sync_counters = self._extract_erp_sync_counters(response_payload)
                        if sync_counters:
                            logger.info(
                                "Pilot ERP sync chunk ok: size=%s counters=%s",
                                len(chunk_items),
                                sync_counters,
                            )
                        else:
                            logger.info("Pilot ERP sync chunk ok: size=%s", len(chunk_items))
                        success_count += len(chunk_items)
                    else:
                        logger.warning(
                            "Pilot ERP sync chunk HTTP %s: %s",
                            response.status_code,
                            response.text[:300],
                        )
                        # Fallback to single-member retries for clearer error reporting.
                        for member, existing in chunk_items:
                            single_payload = [self._build_pilot_payload(member, existing)]
                            single_response = await self._perform_request(
                                method="POST",
                                endpoint="/erp/pilots/sync",
                                json={"dry_run": False, "items": single_payload},
                            )
                            if single_response.status_code in (200, 201):
                                success_count += 1
                            else:
                                error_details.append(
                                    f"Member {self._member_erp_id(member)}: HTTP {single_response.status_code}"
                                )
                                failure_count += 1
                except Exception as e:
                    # If chunk call fails at transport/runtime level, fallback per member.
                    for member, existing in chunk_items:
                        try:
                            single_payload = [self._build_pilot_payload(member, existing)]
                            single_response = await self._perform_request(
                                method="POST",
                                endpoint="/erp/pilots/sync",
                                json={"dry_run": False, "items": single_payload},
                            )
                            if single_response.status_code in (200, 201):
                                success_count += 1
                            else:
                                error_details.append(
                                    f"Member {self._member_erp_id(member)}: HTTP {single_response.status_code}"
                                )
                                failure_count += 1
                        except Exception as single_error:
                            error_details.append(
                                f"Member {self._member_erp_id(member)}: {str(single_error)}"
                            )
                            failure_count += 1
                    logger.warning("Pilot chunk push failed, used per-member fallback: %s", str(e))

                processed_chunks += 1

            # Commit changes
            await db.commit()

            # Log audit trail
            await self._log_audit(
                db=db,
                operation_type="pilot_push",
                status=0 if failure_count == 0 else (2 if success_count > 0 else 1),
                total_records=len(members_to_sync),
                success_count=success_count,
                failure_count=failure_count,
                error_message="\n".join(error_details) if error_details else None,
                triggered_by=triggered_by,
                metadata=json.dumps(
                    {
                        "sync_year": sync_year,
                        "chunk_size": self.chunk_size,
                        "total_chunks": len(chunked_members),
                        "processed_chunks": processed_chunks,
                        "registered_members_count": len(registered_members),
                        "synchronized_unregistered_present_count": synchronized_unregistered_present_count,
                        "created_count": created_count,
                        "updated_count": updated_count,
                        "repaired_erp_id_count": repaired_erp_id_count,
                        "skipped_unchanged_count": skipped_unchanged_count,
                    }
                ),
            )

            return {
                "sync_year": sync_year,
                "total": len(members_to_sync),
                "success": success_count,
                "failure": failure_count,
                "error_details": error_details,
                "chunk_size": self.chunk_size,
                "total_chunks": len(chunked_members),
                "processed_chunks": processed_chunks,
                "processed_count": success_count + failure_count,
                "registered_members_count": len(registered_members),
                "synchronized_unregistered_present_count": synchronized_unregistered_present_count,
                "created_count": created_count,
                "updated_count": updated_count,
                "repaired_erp_id_count": repaired_erp_id_count,
                "skipped_unchanged_count": skipped_unchanged_count,
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

    async def get_pilots_missing_erp_id(self) -> list[dict[str, Any]]:
        """Retrieve Planche pilots that are missing erp_id (need repair)."""
        planche_pilots = await self._read_planche_pilots()
        missing_erp_id = [
            {
                "no": pilot.get("no"),
                "nom": pilot.get("nom"),
                "prenom": pilot.get("prenom"),
                "ffvp": pilot.get("ffvp"),
                "id_compta": pilot.get("id_compta"),
                "erp_id": pilot.get("erp_id"),
                "isActif": pilot.get("isActif"),
            }
            for pilot in planche_pilots
            if not pilot.get("erp_id")
        ]
        return missing_erp_id

    async def get_orphaned_pilots_on_planche(self, db: AsyncSession) -> list[dict[str, Any]]:
        """Retrieve Planche pilots that are not found in ERP (orphaned)."""
        active_members = await self._active_members(db)
        planche_pilots = await self._read_planche_pilots()

        by_member_erp_id = {
            self._member_erp_id(m): m
            for m in active_members
        }
        by_member_legacy_compta_id = {
            self._legacy_compta_id(m): m
            for m in active_members
        }
        by_member_ffvp_and_names: dict[str, Member] = {}
        for member in active_members:
            if member.ffvp_id is not None and member.last_name and member.first_name:
                key = (
                    f"{int(member.ffvp_id)}:"
                    f"{self._normalize_name(member.last_name)}:"
                    f"{self._normalize_name(member.first_name)}"
                )
                by_member_ffvp_and_names[key] = member

        orphaned = []
        for pilot in planche_pilots:
            matched_member: Member | None = None
            pilot_erp_id = pilot.get("erp_id")
            if pilot_erp_id and pilot_erp_id in by_member_erp_id:
                matched_member = by_member_erp_id[pilot_erp_id]
            else:
                pilot_compta = pilot.get("id_compta")
                if pilot_compta and pilot_compta in by_member_legacy_compta_id:
                    matched_member = by_member_legacy_compta_id[pilot_compta]
                elif pilot.get("ffvp") and pilot.get("nom") and pilot.get("prenom"):
                    try:
                        pilot_ffvp = int(pilot["ffvp"])
                    except (TypeError, ValueError):
                        pilot_ffvp = None
                    if pilot_ffvp is not None:
                        key = f"{pilot_ffvp}:{self._normalize_name(pilot['nom'])}:{self._normalize_name(pilot['prenom'])}"
                        matched_member = by_member_ffvp_and_names.get(key)

            if matched_member is None:
                orphaned.append(
                    {
                        "no": pilot.get("no"),
                        "nom": pilot.get("nom"),
                        "prenom": pilot.get("prenom"),
                        "ffvp": pilot.get("ffvp"),
                        "id_compta": pilot.get("id_compta"),
                        "erp_id": pilot.get("erp_id"),
                        "isActif": pilot.get("isActif"),
                    }
                )

        return orphaned

    async def batch_push_machines(
        self, db: AsyncSession, triggered_by: str = "system"
    ) -> dict[str, Any]:
        """
        Push eligible machines (active assets) to Planche using ERP endpoint.

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

            assets_chunks = [
                eligible_assets[i : i + self.chunk_size]
                for i in range(0, len(eligible_assets), self.chunk_size)
            ]

            success_count = 0
            failure_count = 0
            error_details = []

            for chunk in assets_chunks:
                chunk_items: list[tuple[Asset, dict[str, Any]]] = []
                for asset in chunk:
                    erp_id = (asset.code or "").strip() or str(asset.uuid)
                    immat = (asset.registration or "").strip() or (asset.code or "").strip()
                    if not immat:
                        error_details.append(
                            f"Asset {asset.uuid}: missing required immat (registration/code)"
                        )
                        failure_count += 1
                        continue

                    chunk_items.append(
                        (
                            asset,
                            {
                                "erp_id": erp_id,
                                "immat": immat,
                                "modele": asset.model,
                                "private": 1 if asset.ownership == 2 else 0,
                                "arretee": 0 if asset.status == 1 else 1,
                                "asset_absent": not bool(asset.is_active),
                            },
                        )
                    )

                if not chunk_items:
                    continue

                chunk_payload = [payload for _, payload in chunk_items]
                try:
                    response = await self._perform_request(
                        method="POST",
                        endpoint="/erp/machines/sync",
                        json={"items": chunk_payload, "dry_run": False},
                    )
                    if response.status_code in (200, 201):
                        success_count += len(chunk_items)
                    else:
                        # Fallback to per-item retries for better partial-success behavior.
                        for asset, payload in chunk_items:
                            single_response = await self._perform_request(
                                method="POST",
                                endpoint="/erp/machines/sync",
                                json={"items": [payload], "dry_run": False},
                            )
                            if single_response.status_code in (200, 201):
                                success_count += 1
                            else:
                                error_details.append(
                                    f"Asset {asset.code or asset.uuid}: HTTP {single_response.status_code}"
                                )
                                failure_count += 1
                except Exception as e:
                    error_details.append(f"Chunk exception: {str(e)}")
                    failure_count += len(chunk_items)

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

    async def get_machine_push_preview(self, db: AsyncSession) -> dict[str, Any]:
        """Return machine push eligibility counters for confirmation UI."""
        eligible_stmt = select(func.count()).select_from(Asset).where(
            (Asset.is_active == True) & (Asset.status == 1)
        )
        last_push_stmt = (
            select(AuditLog.created_at)
            .where(AuditLog.operation_type == "machine_push")
            .order_by(desc(AuditLog.created_at))
            .limit(1)
        )

        eligible_count = int((await db.execute(eligible_stmt)).scalar_one() or 0)
        last_push_at = (await db.execute(last_push_stmt)).scalar_one_or_none()

        return {
            "eligible_count": eligible_count,
            "last_synced_at": last_push_at.isoformat() if last_push_at else None,
        }

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
        json: Optional[Any] = None,
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
        for attempt in range(self.retry_max_attempts):
            try:
                login_token = await self._get_login_token()
                headers = {
                    "Authorization": f"Bearer {login_token}",
                    "LOGBOOK-API-KEY": self.token,
                    "X-PLANCHE-CONNECTION-ID": self.connection_id,
                    "Content-Type": "application/json",
                    "X-User-Agent": "PlancheDeVol/1.0",
                }
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.request(
                        method=method,
                        url=url,
                        headers=headers,
                        json=json,
                        params=params,
                    )
                    # If 401, clear token and retry once
                    if response.status_code == 401 and attempt == 0:
                        self._login_token = None
                        self._login_token_expiry = None
                        continue
                    if response.status_code < 500:
                        return response
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
            audit_metadata=metadata,
        )
        db.add(audit_log)
        await db.commit()
