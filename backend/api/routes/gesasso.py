"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - gesasso: FastAPI routes for GesAsso (FFVP) pilot data lookup and settings
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
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
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import require_capability
from constants import CAP_MANAGE_USERS, CAP_MANAGE_SYSTEM_SETTINGS
from models import Member, User, ValidatedFlight
from schemas.accounting import SystemSettingUpdateRequest
from schemas.gesasso import (
    GESASSO_SETTINGS_MODULE,
    GesAssoSettingsPayload,
    GesAssoSettingsResponse,
    GesAssoPilotLookupResponse,
)
from services.accounting import get_system_setting, upsert_system_setting
from services.federal_sync import GesassoSyncService
from services.gesasso_client import GesAssoClient

router = APIRouter(prefix="/api/v1/gesasso", tags=["gesasso"])
logger = logging.getLogger(__name__)

manage_guard = Depends(require_capability(CAP_MANAGE_USERS))
settings_guard = Depends(require_capability(CAP_MANAGE_SYSTEM_SETTINGS))

DEFAULT_GESASSO_SETTINGS: dict[str, Any] = {
    "base_url": "https://api.gesasso.ffvp.fr",
    "username": "",
    "secret": "",
    "association_code": "",
}


def _get_gesasso_settings(settings: dict[str, Any]) -> dict[str, Any]:
    return {key: settings.get(key, DEFAULT_GESASSO_SETTINGS.get(key)) for key in DEFAULT_GESASSO_SETTINGS}


async def _get_gesasso_client(db: AsyncSession) -> GesAssoClient:
    setting = await get_system_setting(db, GESASSO_SETTINGS_MODULE)
    cfg = _get_gesasso_settings(setting.settings if setting else {})
    if not cfg.get("username") or not cfg.get("secret"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GesAsso credentials not configured. Configure them in admin settings.",
        )
    return GesAssoClient(
        base_url=cfg["base_url"],
        username=cfg["username"],
        secret=cfg["secret"],
    )


# ---------------------------------------------------------------------------
# Settings endpoints
# ---------------------------------------------------------------------------

@router.get("/settings", response_model=GesAssoSettingsResponse)
async def get_gesasso_settings(
    _: User = settings_guard,
    db: AsyncSession = Depends(get_db),
):
    setting = await get_system_setting(db, GESASSO_SETTINGS_MODULE)
    cfg = _get_gesasso_settings(setting.settings if setting else {})
    return GesAssoSettingsResponse(
        module_name=GESASSO_SETTINGS_MODULE,
        settings=cfg,
        updated_at=setting.updated_at if setting else None,
        updated_by=setting.updated_by if setting else None,
    )


@router.put("/settings", response_model=GesAssoSettingsResponse)
async def update_gesasso_settings(
    payload: GesAssoSettingsPayload,
    current_user: User = settings_guard,
    db: AsyncSession = Depends(get_db),
):
    setting = await upsert_system_setting(
        db,
        module_name=GESASSO_SETTINGS_MODULE,
        request=SystemSettingUpdateRequest(settings=payload.model_dump()),
        user_id=current_user.id,
    )
    await db.commit()
    await db.refresh(setting)
    return GesAssoSettingsResponse(
        module_name=setting.module_name,
        settings=_get_gesasso_settings(setting.settings),
        updated_at=setting.updated_at,
        updated_by=setting.updated_by,
    )


# ---------------------------------------------------------------------------
# Pilot data lookup
# ---------------------------------------------------------------------------

@router.get("/pilot/{ffvp_id}", response_model=GesAssoPilotLookupResponse)
async def lookup_pilot_by_ffvp_id(
    ffvp_id: int,
    _: User = manage_guard,
    db: AsyncSession = Depends(get_db),
):
    """Fetch personal info for a pilot from GesAsso by FFVP ID."""
    client = await _get_gesasso_client(db)
    try:
        personal_info = await client.get_pilot_personal_info(ffvp_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Pilot with FFVP ID {ffvp_id} not found on GesAsso.",
            )
        logger.error("GesAsso API error for ffvp_id=%s: %s", ffvp_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GesAsso API returned status {exc.response.status_code}.",
        )
    except httpx.RequestError as exc:
        logger.error("GesAsso connection error for ffvp_id=%s: %s", ffvp_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach GesAsso API. Check connectivity and settings.",
        )
    return GesAssoPilotLookupResponse(ffvp_id=ffvp_id, personal_info=personal_info)


@router.get("/members/{member_uuid}/pilot-data", response_model=GesAssoPilotLookupResponse)
async def lookup_member_pilot_data(
    member_uuid: UUID,
    _: User = manage_guard,
    db: AsyncSession = Depends(get_db),
):
    """Fetch GesAsso personal info for an ERP member, resolved via their stored ffvp_id."""
    result = await db.execute(select(Member).where(Member.uuid == member_uuid))
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")
    if member.ffvp_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This member has no FFVP ID recorded in the ERP.",
        )

    client = await _get_gesasso_client(db)
    try:
        personal_info = await client.get_pilot_personal_info(member.ffvp_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Pilot with FFVP ID {member.ffvp_id} not found on GesAsso.",
            )
        logger.error("GesAsso API error for member=%s ffvp_id=%s: %s", member_uuid, member.ffvp_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GesAsso API returned status {exc.response.status_code}.",
        )
    except httpx.RequestError as exc:
        logger.error("GesAsso connection error for member=%s ffvp_id=%s: %s", member_uuid, member.ffvp_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach GesAsso API. Check connectivity and settings.",
        )
    return GesAssoPilotLookupResponse(ffvp_id=member.ffvp_id, personal_info=personal_info)


# ---------------------------------------------------------------------------
# Test flight push
# ---------------------------------------------------------------------------

class TestFlightPushRequest(BaseModel):
    flight_uuid: UUID
    dry_run: bool = True


class TestFlightPushResponse(BaseModel):
    flight_uuid: str
    pilot_erp_id: str | None
    ffvp_id: str | None
    payload: dict[str, Any]
    dry_run: bool
    response_status: int | None = None
    response_body: Any = None
    error: str | None = None


@router.post("/test-flight-push", response_model=TestFlightPushResponse)
async def test_flight_push(
    req: TestFlightPushRequest,
    _: User = settings_guard,
    db: AsyncSession = Depends(get_db),
):
    """
    Build the GesAsso payload for a single flight and optionally send it.
    Use dry_run=true (default) to inspect the payload without sending.
    Use dry_run=false to actually POST to GesAsso and see the response.
    """
    # Load flight
    res = await db.execute(select(ValidatedFlight).where(ValidatedFlight.uuid == req.flight_uuid))
    flight = res.scalar_one_or_none()
    if flight is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flight not found.")

    # Resolve ffvp_id for the pilot via account_id (pilot_erp_id = Member.account_id)
    ffvp_id_str: str | None = None
    if flight.pilot_erp_id:
        try:
            mr = await db.execute(
                select(Member.ffvp_id).where(Member.account_id == str(flight.pilot_erp_id))
            )
            row = mr.scalar_one_or_none()
            if row is not None:
                ffvp_id_str = str(row)
        except Exception:
            pass

    # Load settings to build service
    setting = await get_system_setting(db, GESASSO_SETTINGS_MODULE)
    cfg = _get_gesasso_settings(setting.settings if setting else {})
    if not cfg.get("username") or not cfg.get("secret"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GesAsso credentials not configured.",
        )

    service = GesassoSyncService(
        base_url=cfg["base_url"],
        username=cfg["username"],
        password=cfg["secret"],
        association_code=cfg.get("association_code", ""),
    )
    service._ffvp_map = {str(flight.pilot_erp_id): ffvp_id_str} if ffvp_id_str else {}
    payload = service.map_flight(flight)

    if req.dry_run:
        return TestFlightPushResponse(
            flight_uuid=str(req.flight_uuid),
            pilot_erp_id=str(flight.pilot_erp_id) if flight.pilot_erp_id else None,
            ffvp_id=ffvp_id_str,
            payload=payload,
            dry_run=True,
        )

    # Actually send to GesAsso
    import httpx as _httpx
    from services.federal_sync import _make_wsse_headers
    headers = _make_wsse_headers(cfg["username"], cfg["secret"])
    url = f"{cfg['base_url'].rstrip('/')}/flights-collection.json"
    try:
        async with _httpx.AsyncClient(timeout=30.0, verify=False) as client:
            resp = await client.post(
                url,
                json={"flight_collection": [payload]},
                headers=headers,
            )
        return TestFlightPushResponse(
            flight_uuid=str(req.flight_uuid),
            pilot_erp_id=str(flight.pilot_erp_id) if flight.pilot_erp_id else None,
            ffvp_id=ffvp_id_str,
            payload=payload,
            dry_run=False,
            response_status=resp.status_code,
            response_body=resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text,
        )
    except _httpx.HTTPStatusError as exc:
        return TestFlightPushResponse(
            flight_uuid=str(req.flight_uuid),
            pilot_erp_id=str(flight.pilot_erp_id) if flight.pilot_erp_id else None,
            ffvp_id=ffvp_id_str,
            payload=payload,
            dry_run=False,
            response_status=exc.response.status_code,
            response_body=exc.response.text,
            error=f"HTTP {exc.response.status_code}",
        )
    except _httpx.RequestError as exc:
        return TestFlightPushResponse(
            flight_uuid=str(req.flight_uuid),
            pilot_erp_id=str(flight.pilot_erp_id) if flight.pilot_erp_id else None,
            ffvp_id=ffvp_id_str,
            payload=payload,
            dry_run=False,
            error=f"Network error: {str(exc)[:200]}",
        )


# ---------------------------------------------------------------------------
# Recent validated flights (for flight picker)
# ---------------------------------------------------------------------------

class RecentFlightItem(BaseModel):
    uuid: str
    jour: str
    asset_code: str
    takeoff_time: str
    landing_time: str
    pilot_name: str
    pilot_erp_id: str


@router.get("/recent-flights", response_model=list[RecentFlightItem])
async def list_recent_flights(
    limit: int = Query(default=30, ge=1, le=100),
    _: User = settings_guard,
    db: AsyncSession = Depends(get_db),
):
    """Return recent validated flights with pilot names for the flight test picker."""
    from sqlalchemy import desc
    from models import Member as _Member

    stmt = (
        select(
            ValidatedFlight.uuid,
            ValidatedFlight.jour,
            ValidatedFlight.asset_code,
            ValidatedFlight.takeoff_time,
            ValidatedFlight.landing_time,
            ValidatedFlight.pilot_erp_id,
            _Member.first_name,
            _Member.last_name,
        )
        .outerjoin(_Member, _Member.account_id == ValidatedFlight.pilot_erp_id)
        .order_by(desc(ValidatedFlight.jour), ValidatedFlight.takeoff_time)
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.all()
    return [
        RecentFlightItem(
            uuid=str(r.uuid),
            jour=r.jour.isoformat() if r.jour else "",
            asset_code=r.asset_code or "",
            takeoff_time=r.takeoff_time or "",
            landing_time=r.landing_time or "",
            pilot_erp_id=r.pilot_erp_id or "",
            pilot_name=f"{r.first_name or ''} {r.last_name or ''}".strip() or r.pilot_erp_id or "?",
        )
        for r in rows
    ]
