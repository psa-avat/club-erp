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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import require_capability
from constants import CAP_MANAGE_USERS, CAP_MANAGE_SYSTEM_SETTINGS
from models import Member, User
from schemas.accounting import SystemSettingUpdateRequest
from schemas.gesasso import (
    GESASSO_SETTINGS_MODULE,
    GesAssoSettingsPayload,
    GesAssoSettingsResponse,
    GesAssoPilotLookupResponse,
)
from services.accounting import get_system_setting, upsert_system_setting
from services.gesasso_client import GesAssoClient

router = APIRouter(prefix="/api/v1/gesasso", tags=["gesasso"])
logger = logging.getLogger(__name__)

manage_guard = Depends(require_capability(CAP_MANAGE_USERS))
settings_guard = Depends(require_capability(CAP_MANAGE_SYSTEM_SETTINGS))

DEFAULT_GESASSO_SETTINGS: dict[str, Any] = {
    "base_url": "https://api.gesasso.ffvp.fr",
    "username": "",
    "secret": "",
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
