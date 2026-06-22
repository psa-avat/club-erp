"""
    ERP-CLUB - ERP pour Club de vol à voile
    - federal_sync: Routes de synchronisation fédérale (GesAsso / OSRT)
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
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import require_capability
from constants import CAP_FEDERAL_SYNC, CAP_MANAGE_SYSTEM_SETTINGS
from models import FederalSyncLog, SystemSetting, User
from schemas.gesasso import GESASSO_SETTINGS_MODULE
from services.federal_sync import GesassoSyncService

router = APIRouter(prefix="/api/v1/flights", tags=["flights", "federal-sync"])
logger = logging.getLogger(__name__)

federal_sync_guard = Depends(require_capability(CAP_FEDERAL_SYNC))
settings_guard = Depends(require_capability(CAP_MANAGE_SYSTEM_SETTINGS))

OSRT_SETTINGS_MODULE = "osrt"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SyncRequest(BaseModel):
    flight_uuids: list[UUID]
    force: bool = False


class SyncStatusItem(BaseModel):
    flight_uuid: str
    platform: str
    status: int
    external_id: str | None
    last_attempt_at: str | None


class PlatformConfig(BaseModel):
    url: str = ""
    user: str = ""
    secret: str = ""
    association_code: str | None = None


class FederalSyncConfigResponse(BaseModel):
    gesasso: PlatformConfig | None
    osrt: PlatformConfig | None


class UpdatePlatformConfigRequest(BaseModel):
    platform: str
    config: PlatformConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_gesasso_service(db: AsyncSession) -> GesassoSyncService:
    """Instantiate GesassoSyncService from stored system settings."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.module_name == GESASSO_SETTINGS_MODULE)
    )
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GesAsso settings not configured. Go to Admin → Integrations → GesAsso.",
        )
    cfg = setting.settings or {}
    username = cfg.get("username", "")
    secret = cfg.get("secret", "")
    if not username or not secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GesAsso credentials (username / secret) are not configured.",
        )
    return GesassoSyncService(
        base_url=cfg.get("base_url", "https://api.gesasso.ffvp.fr"),
        username=username,
        password=secret,
        association_code=cfg.get("association_code", ""),
    )


def _build_platform_config(setting: SystemSetting | None) -> PlatformConfig | None:
    if not setting:
        return None
    cfg = setting.settings or {}
    return PlatformConfig(
        url=cfg.get("base_url") or cfg.get("url", ""),
        user=cfg.get("username") or cfg.get("user", ""),
        secret="********" if (cfg.get("secret") or cfg.get("password")) else "",
        association_code=cfg.get("association_code"),
    )


# ---------------------------------------------------------------------------
# Sync endpoints
# ---------------------------------------------------------------------------

@router.post("/sync-gesasso")
async def trigger_gesasso_sync(
    payload: SyncRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = federal_sync_guard,
):
    """Trigger manual synchronisation of selected flights to GesAsso."""
    service = await _get_gesasso_service(db)
    return await service.batch_sync_flights(
        db=db,
        flight_uuids=payload.flight_uuids,
        triggered_by=current_user.email or str(current_user.id),
        force=payload.force,
    )


@router.get("/sync-status", response_model=list[SyncStatusItem])
async def list_sync_status(
    platform: str = Query(..., description="Platform: 'gesasso' or 'osrt'"),
    status_filter: int | None = Query(None, description="Filter by status (0-4)"),
    db: AsyncSession = Depends(get_db),
    _: User = federal_sync_guard,
):
    """Return the latest sync status for all flights on a given platform."""
    # DISTINCT ON via subquery to get latest log per (flight, platform)
    subq = (
        select(
            FederalSyncLog.validated_flight_uuid,
            FederalSyncLog.platform,
            FederalSyncLog.status,
            FederalSyncLog.external_id,
            FederalSyncLog.attempt_at,
        )
        .distinct(FederalSyncLog.validated_flight_uuid, FederalSyncLog.platform)
        .where(FederalSyncLog.platform == platform)
        .order_by(
            FederalSyncLog.validated_flight_uuid,
            FederalSyncLog.platform,
            FederalSyncLog.attempt_at.desc(),
        )
        .subquery()
    )

    query = select(subq)
    if status_filter is not None:
        query = query.where(subq.c.status == status_filter)
    query = query.order_by(subq.c.attempt_at.desc()).limit(200)

    result = await db.execute(query)
    rows = result.all()

    return [
        SyncStatusItem(
            flight_uuid=str(r.validated_flight_uuid),
            platform=r.platform,
            status=r.status or 0,
            external_id=r.external_id,
            last_attempt_at=r.attempt_at.isoformat() if r.attempt_at else None,
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Configuration endpoints
# ---------------------------------------------------------------------------

@router.get("/federal-sync/config", response_model=FederalSyncConfigResponse, tags=["admin"])
async def get_federal_sync_config(
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
):
    """Return stored configuration for all federal sync platforms."""
    result = await db.execute(
        select(SystemSetting).where(
            SystemSetting.module_name.in_([GESASSO_SETTINGS_MODULE, OSRT_SETTINGS_MODULE])
        )
    )
    settings_map = {row.module_name: row for row in result.scalars().all()}
    return FederalSyncConfigResponse(
        gesasso=_build_platform_config(settings_map.get(GESASSO_SETTINGS_MODULE)),
        osrt=_build_platform_config(settings_map.get(OSRT_SETTINGS_MODULE)),
    )


@router.put("/federal-sync/config", tags=["admin"])
async def update_federal_sync_config(
    payload: UpdatePlatformConfigRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = settings_guard,
):
    """Update credentials for one federal sync platform."""
    if payload.platform not in ("gesasso", "osrt"):
        raise HTTPException(status_code=400, detail="Invalid platform. Use 'gesasso' or 'osrt'.")

    module_name = payload.platform  # "gesasso" or "osrt"
    config_dict: dict = {}

    if payload.platform == "gesasso":
        # Map PlatformConfig fields to the gesasso module schema
        config_dict = {
            "base_url": payload.config.url or "https://api.gesasso.ffvp.fr",
            "username": payload.config.user,
        }
        if payload.config.association_code is not None:
            config_dict["association_code"] = payload.config.association_code
    else:
        config_dict = {
            "url": payload.config.url,
            "user": payload.config.user,
        }
        if payload.config.association_code is not None:
            config_dict["association_code"] = payload.config.association_code

    # Handle secret: preserve existing value when frontend sends "********"
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.module_name == module_name)
    )
    existing = result.scalar_one_or_none()

    new_secret = payload.config.secret
    if new_secret == "********" and existing:
        existing_secret = existing.settings.get("secret") or existing.settings.get("password", "")
        config_dict["secret"] = existing_secret
    else:
        config_dict["secret"] = new_secret

    if existing:
        # Merge: preserve fields not included in PlatformConfig (e.g. other keys)
        merged = {**existing.settings, **config_dict}
        existing.settings = merged
        existing.updated_by = current_user.id
    else:
        db.add(SystemSetting(
            module_name=module_name,
            settings=config_dict,
            updated_by=current_user.id,
        ))

    await db.commit()
    return {"status": "ok", "platform": payload.platform}
