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
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import require_capability
from constants import CAP_FEDERAL_SYNC, CAP_MANAGE_SYSTEM_SETTINGS
from models import FederalSyncLog, Member, SystemSetting, User, ValidatedFlight
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


class SyncCandidateIssue(BaseModel):
    code: str
    blocking: bool


class SyncCandidateItem(BaseModel):
    flight_uuid: str
    jour: str | None
    pilot_name: str | None
    second_pilot_name: str | None
    asset_code: str | None
    type_of_flight: int
    status: int
    external_id: str | None
    last_attempt_at: str | None
    issues: list[SyncCandidateIssue]


class SyncCandidatesSummary(BaseModel):
    pending: int
    sent: int
    failed: int
    blocked: int


class SyncCandidatesResponse(BaseModel):
    items: list[SyncCandidateItem]
    total: int
    page: int
    page_size: int
    total_pages: int
    summary: SyncCandidatesSummary


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


@router.get("/sync-candidates", response_model=SyncCandidatesResponse)
async def list_sync_candidates(
    platform: str = Query("gesasso", description="Platform: currently only 'gesasso' is supported"),
    date_from: date | None = Query(None, description="Flight date >= date_from"),
    date_to: date | None = Query(None, description="Flight date <= date_to"),
    status_filter: str | None = Query(
        None, description="Filter: 'pending', 'sent', 'failed' or 'blocked'"
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = federal_sync_guard,
):
    """Return validated flights eligible for federal sync in a date range, with the
    latest known status per flight (0 when never attempted) and any blocking issues
    (e.g. pilot/instructor/winch operator missing an FFVP licence number) computed
    live from GesassoSyncService.check_flight_issues — so the UI reflects exactly
    what a real sync attempt would accept or reject, without needing to attempt it.
    """
    if platform != "gesasso":
        raise HTTPException(status_code=400, detail="Only 'gesasso' is supported for now.")

    # Note: source_status carries whatever raw status string Planche sent for the
    # change (e.g. "created", "corrected"), not an active/deleted flag — it is
    # not filtered here, matching list_validated_flights in api/routes/flights.py.
    filters: list = []
    if date_from is not None:
        filters.append(ValidatedFlight.jour >= date_from)
    if date_to is not None:
        filters.append(ValidatedFlight.jour <= date_to)

    flights_result = await db.execute(
        select(ValidatedFlight).where(*filters).order_by(ValidatedFlight.jour.desc())
    )
    flights = flights_result.scalars().all()

    if not flights:
        return SyncCandidatesResponse(
            items=[], total=0, page=page, page_size=page_size, total_pages=0,
            summary=SyncCandidatesSummary(pending=0, sent=0, failed=0, blocked=0),
        )

    flight_uuids = [f.uuid for f in flights]

    # Latest log per flight for this platform
    subq = (
        select(
            FederalSyncLog.validated_flight_uuid,
            FederalSyncLog.status,
            FederalSyncLog.external_id,
            FederalSyncLog.attempt_at,
        )
        .distinct(FederalSyncLog.validated_flight_uuid)
        .where(
            FederalSyncLog.platform == platform,
            FederalSyncLog.validated_flight_uuid.in_(flight_uuids),
        )
        .order_by(FederalSyncLog.validated_flight_uuid, FederalSyncLog.attempt_at.desc())
        .subquery()
    )
    log_rows = await db.execute(select(subq))
    log_map = {
        row.validated_flight_uuid: row for row in log_rows.all()
    }

    # Pilot/second-pilot display names
    member_uuids = {f.pilot_erp_id for f in flights if f.pilot_erp_id} | \
                   {f.second_pilot_erp_id for f in flights if f.second_pilot_erp_id}
    member_map: dict[str, str] = {}
    if member_uuids:
        member_rows = await db.execute(
            select(Member.account_id, Member.first_name, Member.last_name).where(
                Member.account_id.in_(member_uuids)
            )
        )
        for row in member_rows.all():
            if row.first_name and row.last_name:
                member_map[str(row.account_id)] = f"{row.first_name} {row.last_name}"

    ffvp_map = await GesassoSyncService.build_ffvp_map(db, flights)

    items: list[SyncCandidateItem] = []
    summary = SyncCandidatesSummary(pending=0, sent=0, failed=0, blocked=0)
    for f in flights:
        log_row = log_map.get(f.uuid)
        db_status = log_row.status if log_row else 0
        issues = GesassoSyncService.check_flight_issues(f, ffvp_map)
        has_blocking_issue = any(i["blocking"] for i in issues)

        if has_blocking_issue:
            bucket = "blocked"
        elif db_status == 2:
            bucket = "sent"
        elif db_status == 3:
            bucket = "failed"
        else:
            bucket = "pending"

        setattr(summary, bucket, getattr(summary, bucket) + 1)

        if status_filter is not None and bucket != status_filter:
            continue

        items.append(SyncCandidateItem(
            flight_uuid=str(f.uuid),
            jour=f.jour.isoformat() if f.jour else None,
            pilot_name=member_map.get(f.pilot_erp_id),
            second_pilot_name=member_map.get(f.second_pilot_erp_id) if f.second_pilot_erp_id else None,
            asset_code=f.asset_code,
            type_of_flight=f.type_of_flight,
            status=db_status or 0,
            external_id=log_row.external_id if log_row else None,
            last_attempt_at=log_row.attempt_at.isoformat() if log_row and log_row.attempt_at else None,
            issues=issues,
        ))

    total = len(items)
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0
    offset = (page - 1) * page_size
    page_items = items[offset:offset + page_size]

    return SyncCandidatesResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        summary=summary,
    )


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
