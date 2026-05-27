"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - flights: FastAPI routes for validated flight listing and Planche flight fetch
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

import logging
from datetime import UTC, date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_EDIT_FLIGHTS, CAP_MANAGE_PLANCHE
from models import Member, User, ValidatedFlight
from schemas.flights import (
    FlightFetchRequest,
    FlightFetchResponse,
    ValidatedFlightItem,
    ValidatedFlightListResponse,
)
from schemas.accounting import SystemSettingUpdateRequest
from schemas.planche import PLANCHE_SETTINGS_MODULE, PlancheSettingsPayload
from services.accounting import get_system_setting, upsert_system_setting
from services.planche_integration import PlancheIntegrationService

router = APIRouter(prefix="/api/v1/flights", tags=["flights"])
logger = logging.getLogger(__name__)

flights_guard = Depends(require_capability(CAP_EDIT_FLIGHTS))
planche_guard = Depends(require_capability(CAP_MANAGE_PLANCHE))

DEFAULT_PLANCHE_SETTINGS: dict[str, Any] = {
    "base_url": "",
    "connection_id": "",
    "token": "",
    "user": "",
    "password": "",
    "environment": "test",
    "retry_max_attempts": 3,
    "retry_backoff_ms": 1000,
    "chunk_size": 10,
    "sync_cursor_flights": None,
    "sync_cursor_pilots": None,
    "sync_cursor_machines": None,
}


def _get_planche_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Helper to extract Planche settings dict with defaults."""
    allowed_keys = PlancheSettingsPayload.model_fields.keys()
    return {key: settings.get(key, DEFAULT_PLANCHE_SETTINGS.get(key)) for key in allowed_keys}


async def _get_planche_service(db: AsyncSession) -> PlancheIntegrationService:
    setting = await get_system_setting(db, PLANCHE_SETTINGS_MODULE)
    settings = _get_planche_settings(setting.settings if setting else {})
    return PlancheIntegrationService(
        base_url=settings["base_url"],
        connection_id=settings["connection_id"],
        token=settings["token"],
        user=settings["user"],
        password=settings["password"],
        retry_max_attempts=settings.get("retry_max_attempts", 3),
        retry_backoff_ms=settings.get("retry_backoff_ms", 1000),
        chunk_size=settings.get("chunk_size", 10),
    )


@router.get("", response_model=ValidatedFlightListResponse)
async def list_validated_flights(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    # Filters
    date_from: Optional[date] = Query(default=None, description="Filter: flight date >= date_from"),
    date_to: Optional[date] = Query(default=None, description="Filter: flight date <= date_to"),
    type_of_flight: Optional[int] = Query(default=None, ge=0, le=7, description="Filter: type_of_flight (0-7)"),
    launch_method: Optional[int] = Query(default=None, ge=0, le=3, description="Filter: launch_method (0-3)"),
    pilot_query: Optional[str] = Query(default=None, min_length=2, description="Search pilot by name or trigram"),
    asset_code: Optional[str] = Query(default=None, min_length=1, description="Filter: glider registration (partial match)"),
    erp_status: Optional[int] = Query(default=None, ge=0, le=2, description="Filter: erp_status (0=validated, 1=transferred, 2=modified)"),
    db: AsyncSession = Depends(get_db),
    _: User = flights_guard,
):
    """Return a paginated list of validated flights for the UI table view."""
    # Build dynamic filters
    filters: list = []

    if date_from is not None:
        filters.append(ValidatedFlight.jour >= date_from)
    if date_to is not None:
        filters.append(ValidatedFlight.jour <= date_to)
    if type_of_flight is not None:
        filters.append(ValidatedFlight.type_of_flight == type_of_flight)
    if launch_method is not None:
        filters.append(ValidatedFlight.launch_method == launch_method)
    if asset_code is not None:
        filters.append(ValidatedFlight.asset_code.ilike(f"%{asset_code}%"))
    if erp_status is not None:
        filters.append(ValidatedFlight.erp_status == erp_status)

    # Pilot search: resolve member UUIDs first, then filter by pilot_erp_id OR second_pilot_erp_id
    pilot_member_uuids: list[str] = []
    if pilot_query is not None and pilot_query.strip():
        search = f"%{pilot_query.strip()}%"
        member_rows = await db.execute(
            select(Member.account_id).where(
                or_(
                    Member.first_name.ilike(search),
                    Member.last_name.ilike(search),
                    Member.trigram.ilike(search),
                )
            )
        )
        pilot_member_uuids = [str(row[0]) for row in member_rows.all()]
        if pilot_member_uuids:
            filters.append(
                or_(
                    ValidatedFlight.pilot_erp_id.in_(pilot_member_uuids),
                    ValidatedFlight.second_pilot_erp_id.in_(pilot_member_uuids),
                )
            )
        else:
            # No matching members → return empty result
            return ValidatedFlightListResponse(
                items=[],
                total=0,
                page=page,
                page_size=page_size,
                total_pages=0,
            )

    # Count total (with filters)
    count_q = select(func.count(ValidatedFlight.uuid))
    if filters:
        count_q = count_q.where(*filters)
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    # Fetch page (with filters)
    offset = (page - 1) * page_size
    query = (
        select(ValidatedFlight)
        .where(*filters)
        .order_by(ValidatedFlight.jour.desc(), ValidatedFlight.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    rows_result = await db.execute(query)
    rows = rows_result.scalars().all()

    # Batch-fetch member names for pilot/second/charge_to columns
    member_uuids: set[str] = set()
    for r in rows:
        if r.pilot_erp_id:
            member_uuids.add(r.pilot_erp_id)
        if r.second_pilot_erp_id:
            member_uuids.add(r.second_pilot_erp_id)
        if r.charge_to_erp_id:
            member_uuids.add(r.charge_to_erp_id)

    member_map: dict[str, tuple[str | None, str | None]] = {}  # account_id -> (full_name, trigram)
    if member_uuids:
        member_result = await db.execute(
            select(Member.account_id, Member.first_name, Member.last_name, Member.trigram).where(
                Member.account_id.in_(list(member_uuids))
            )
        )
        for row in member_result.all():
            uid = str(row.account_id)
            name = f"{row.first_name} {row.last_name}" if row.first_name and row.last_name else None
            member_map[uid] = (name, row.trigram)

    items = []
    for r in rows:
        pilot_name = member_map.get(r.pilot_erp_id, (None, None))[0] if r.pilot_erp_id else None
        second_name = member_map.get(r.second_pilot_erp_id, (None, None))[0] if r.second_pilot_erp_id else None
        second_trigram = member_map.get(r.second_pilot_erp_id, (None, None))[1] if r.second_pilot_erp_id else None
        items.append(ValidatedFlightItem(
            uuid=str(r.uuid),
            jour=r.jour.isoformat() if r.jour else None,
            type_of_flight=r.type_of_flight,
            pilot_erp_id=r.pilot_erp_id,
            second_pilot_erp_id=r.second_pilot_erp_id,
            pilot_name=pilot_name,
            second_pilot_name=second_name,
            second_pilot_trigram=second_trigram,
            takeoff_time=r.takeoff_time,
            landing_time=r.landing_time,
            launch_method=r.launch_method,
            launch_asset_code=r.launch_asset_code,
            launch_pilot_trigram=r.launch_pilot_trigram,
            charge_to_erp_id=r.charge_to_erp_id,
            asset_code=r.asset_code,
            glider_erp_id=r.glider_erp_id,
            launch_machine_erp_id=r.launch_machine_erp_id,
            instruction_split=r.instruction_split,
            aero=r.aero,
        ))
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return ValidatedFlightListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post("/fetch", response_model=FlightFetchResponse)
async def fetch_validated_flights_from_planche(
    request: FlightFetchRequest | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
    current_user: User = Depends(get_current_user),
):
    """Fetch Planche validated flight revisions into ERP current flight storage."""
    payload = request or FlightFetchRequest()
    service = await _get_planche_service(db)
    result = await service.pull_validated_flights(
        db=db,
        from_date=payload.from_date,
        to_date=payload.to_date,
        cursor=payload.cursor,
        limit=payload.limit,
        triggered_by=str(current_user.id),
    )

    # Persist next_cursor + timestamp into Planche settings so they survive page reload
    try:
        current_setting = await get_system_setting(db, PLANCHE_SETTINGS_MODULE)
        current_settings = dict(current_setting.settings) if isinstance(current_setting.settings, dict) else {}
        next_cursor = result.get("next_cursor")
        if next_cursor is not None:
            current_settings["sync_cursor_flights"] = next_cursor
        current_settings["last_fetch_at"] = datetime.now(UTC).isoformat()
        await upsert_system_setting(
            db,
            PLANCHE_SETTINGS_MODULE,
            SystemSettingUpdateRequest(settings=current_settings),
            current_user.id,
        )
    except HTTPException:
        # Settings may not exist yet — that's acceptable
        pass

    return result
