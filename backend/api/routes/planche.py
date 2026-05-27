"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - planche: FastAPI routes for Planche de vol integration settings
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

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_PLANCHE, CAP_MANAGE_SYSTEM_SETTINGS
from models import Member, User, ValidatedFlight
from schemas.accounting import SystemSettingUpdateRequest
from schemas.planche import (
    PLANCHE_SETTINGS_MODULE,
    FlightPullRequest,
    FlightPullResponse,
    PlancheConnectionTestResponse,
    PlancheLoginTestResponse,
    PlancheSettingsPayload,
    PlancheSettingsResponse,
    ValidatedFlightItem,
    ValidatedFlightListResponse,
)
from services.planche_integration import PlancheIntegrationService

# --- Phase 2: Outbound Sync Endpoints ---
from fastapi.responses import JSONResponse

from services.accounting import get_system_setting, upsert_system_setting

router = APIRouter(prefix="/api/v1/planche", tags=["planche"])
logger = logging.getLogger(__name__)

configuration_guard = Depends(require_capability(CAP_MANAGE_SYSTEM_SETTINGS))
planche_guard = Depends(require_capability(CAP_MANAGE_PLANCHE))


class PilotPushRequest(BaseModel):
    dry_run: bool = False


class ViPushRequest(BaseModel):
    entitlement_uuids: list[UUID]
    replace: bool = False


class ViReconcileRequest(BaseModel):
    from_date: datetime | None = None
    to_date: datetime | None = None



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


def _pilot_push_errors(error_details: list[Any]) -> list[dict[str, str]]:
    """Normalize service errors to a stable API shape for frontend rendering."""
    normalized: list[dict[str, str]] = []
    for detail in error_details:
        if isinstance(detail, dict):
            normalized.append(
                {
                    "pilot_id": str(detail.get("pilot_id") or ""),
                    "error_msg": str(detail.get("error_msg") or "Unexpected error"),
                }
            )
            continue

        text = str(detail)
        prefix = "Member "
        if text.startswith(prefix) and ":" in text:
            pilot_id, error_msg = text[len(prefix):].split(":", 1)
            normalized.append({"pilot_id": pilot_id.strip(), "error_msg": error_msg.strip()})
        else:
            normalized.append({"pilot_id": "", "error_msg": text})
    return normalized


@router.get("/pilots/push/preview")
async def preview_pilot_push_to_planche(
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
):
    """Return pilot push eligibility/exclusion counters for confirmation UI."""
    service = await _get_planche_service(db)
    result = await service.get_pilot_push_preview(db)
    return JSONResponse(result)

@router.get("/pilots/missing-erp-id")
async def get_pilots_missing_erp_id(
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
):
    """Retrieve Planche pilots missing erp_id (need repair/migration)."""
    service = await _get_planche_service(db)
    pilots = await service.get_pilots_missing_erp_id()
    return JSONResponse({"pilots": pilots, "count": len(pilots)})

@router.get("/pilots/orphaned")
async def get_orphaned_pilots_on_planche(
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
):
    """Retrieve Planche pilots not found in ERP (orphaned)."""
    service = await _get_planche_service(db)
    pilots = await service.get_orphaned_pilots_on_planche(db)
    return JSONResponse({"pilots": pilots, "count": len(pilots)})

@router.post("/pilots/push")
async def push_pilots_to_planche(
    request: PilotPushRequest | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
    current_user: User = Depends(get_current_user),
):
    """Manually push eligible pilots to Planche."""
    service = await _get_planche_service(db)

    if request and request.dry_run:
        preview = await service.get_pilot_push_preview(db)
        return JSONResponse(
            {
                "success": True,
                "pushed_count": 0,
                "failed_count": 0,
                "errors": [],
                "last_synced_at": preview.get("last_synced_at"),
                "sync_year": preview.get("sync_year"),
                "dry_run": True,
                "dry_run_eligible_count": preview.get("eligible_count", 0),
                "dry_run_excluded_count": preview.get("excluded_count", 0),
            }
        )

    result = await service.batch_push_pilots(db, triggered_by=str(current_user.id))
    normalized_errors = _pilot_push_errors(result.get("error_details", []))
    return JSONResponse({
        "success": result["failure"] == 0,
        "pushed_count": result["success"],
        "failed_count": result["failure"],
        "errors": normalized_errors,
        "last_synced_at": datetime.now(UTC).isoformat(),
        "sync_year": result.get("sync_year"),
        "created_count": result.get("created_count"),
        "updated_count": result.get("updated_count"),
        "repaired_erp_id_count": result.get("repaired_erp_id_count"),
        "skipped_unchanged_count": result.get("skipped_unchanged_count"),
        "processed_count": result.get("processed_count"),
        "chunk_size": result.get("chunk_size"),
        "total_chunks": result.get("total_chunks"),
        "processed_chunks": result.get("processed_chunks"),
        "dry_run": False,
    })

@router.post("/machines/push")
async def push_machines_to_planche(
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
    current_user: User = Depends(get_current_user),
):
    """Manually push eligible machines to Planche."""
    service = await _get_planche_service(db)
    result = await service.batch_push_machines(db, triggered_by=str(current_user.id))
    return JSONResponse({
        "success": result["failure"] == 0,
        "pushed_count": result["success"],
        "failed_count": result["failure"],
        "errors": result["error_details"],
        "last_synced_at": datetime.now(UTC).isoformat(),
    })


@router.get("/machines/push/preview")
async def preview_machine_push_to_planche(
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
):
    """Return machine push eligibility counters for confirmation UI."""
    service = await _get_planche_service(db)
    result = await service.get_machine_push_preview(db)
    return JSONResponse(result)


@router.post("/vi/push")
async def push_vi_entitlements_to_planche(
    request: ViPushRequest,
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
    current_user: User = Depends(get_current_user),
):
    """Push selected VI entitlements to Planche operational schedule."""
    service = await _get_planche_service(db)
    result = await service.push_vi_entitlements(
        db=db,
        entitlement_uuids=[str(value) for value in request.entitlement_uuids],
        triggered_by=str(current_user.id),
        replace=request.replace,
    )
    return JSONResponse(
        {
            "success": result.get("failure", 0) == 0,
            "selected_count": result.get("selected_count", 0),
            "pushed_count": result.get("success", 0),
            "failed_count": result.get("failure", 0),
            "errors": result.get("error_details", []),
            "last_synced_at": datetime.now(UTC).isoformat(),
        }
    )


@router.post("/vi/reconcile")
async def reconcile_vi_from_validated_flights(
    request: ViReconcileRequest,
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
    current_user: User = Depends(get_current_user),
):
    """Reconcile VI realization status from validated flights vi_erp_id references."""
    service = await _get_planche_service(db)
    result = await service.reconcile_vi_realisation_from_validated_flights(
        db=db,
        from_date=request.from_date,
        to_date=request.to_date,
        triggered_by=str(current_user.id),
    )
    return JSONResponse(result)


@router.post("/flights/pull", response_model=FlightPullResponse)
async def pull_validated_flights_from_planche(
    request: FlightPullRequest | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
    current_user: User = Depends(get_current_user),
):
    """Pull Planche validated flight revisions into ERP current flight storage."""
    payload = request or FlightPullRequest()
    service = await _get_planche_service(db)
    result = await service.pull_validated_flights(
        db=db,
        from_date=payload.from_date,
        to_date=payload.to_date,
        cursor=payload.cursor,
        limit=payload.limit,
        triggered_by=str(current_user.id),
    )
    return result


@router.get("/flights", response_model=ValidatedFlightListResponse)
async def list_validated_flights(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
):
    """Return a paginated list of validated flights for the UI table view."""
    # Count total
    count_q = select(func.count(ValidatedFlight.uuid))
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    # Fetch page
    offset = (page - 1) * page_size
    query = (
        select(ValidatedFlight)
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

    member_map: dict[str, tuple[str | None, str | None]] = {}  # uuid -> (full_name, trigram)
    if member_uuids:
        member_result = await db.execute(
            select(Member.uuid, Member.first_name, Member.last_name, Member.trigram).where(
                Member.uuid.in_([UUID(u) for u in member_uuids if u])
            )
        )
        for row in member_result.all():
            uid = str(row.uuid)
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


def _settings_payload_from_dict(settings: dict[str, Any]) -> PlancheSettingsPayload:
    allowed_keys = PlancheSettingsPayload.model_fields.keys()
    merged = DEFAULT_PLANCHE_SETTINGS | {key: value for key, value in settings.items() if key in allowed_keys}
    return merged


def _response_from_setting(
    module_name: str,
    settings: dict[str, Any],
    updated_at: datetime,
    updated_by: int | None,
) -> PlancheSettingsResponse:
    return PlancheSettingsResponse(
        module_name=module_name,
        settings=_settings_payload_from_dict(settings),
        updated_at=updated_at,
        updated_by=updated_by,
    )


def _normalize_base_url(value: str) -> str:
    return value.strip().rstrip("/")


def _build_planche_url(base_url: str, path: str) -> str:
    return urljoin(_normalize_base_url(base_url) + "/", path.lstrip("/"))


def _perform_json_request(
    url: str,
    method: str,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: float = 15.0,
) -> tuple[int, dict[str, Any]]:
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)

    data = None
    if payload is not None:
        request_headers.setdefault("Content-Type", "application/json")
        data = json.dumps(payload).encode("utf-8")

    request = urllib_request.Request(url, data=data, headers=request_headers, method=method)

    try:
        with urllib_request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            parsed = json.loads(body) if body.strip() else {}
            return response.status, parsed
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            parsed = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return exc.code, parsed


async def _run_in_thread(func, *args, **kwargs):
    return await asyncio.to_thread(func, *args, **kwargs)


@router.get("/settings", response_model=PlancheSettingsResponse)
async def get_planche_settings_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = configuration_guard,
    current_user: User = Depends(get_current_user),
):
    """Return the stored Planche integration settings, or defaults when missing."""
    try:
        setting = await get_system_setting(db, PLANCHE_SETTINGS_MODULE)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        return PlancheSettingsResponse(
            module_name=PLANCHE_SETTINGS_MODULE,
            settings=DEFAULT_PLANCHE_SETTINGS,
            updated_at=datetime.fromtimestamp(0, tz=UTC),
            updated_by=None,
        )

    return _response_from_setting(
        setting.module_name,
        setting.settings if isinstance(setting.settings, dict) else {},
        setting.updated_at,
        setting.updated_by,
    )


@router.put("/settings", response_model=PlancheSettingsResponse)
async def update_planche_settings_endpoint(
    request: PlancheSettingsPayload,
    db: AsyncSession = Depends(get_db),
    _: User = configuration_guard,
    current_user: User = Depends(get_current_user),
):
    """Create or update the stored Planche integration settings."""
    setting = await upsert_system_setting(
        db,
        PLANCHE_SETTINGS_MODULE,
        SystemSettingUpdateRequest(settings=request.model_dump()),
        current_user.id,
    )
    return _response_from_setting(setting.module_name, setting.settings, setting.updated_at, setting.updated_by)


@router.post("/settings/test-connection", response_model=PlancheConnectionTestResponse)
async def test_planche_connection_endpoint(
    request: PlancheSettingsPayload,
    _: User = configuration_guard,
    current_user: User = Depends(get_current_user),
):
    """Validate the configured base URL and API token against a lightweight Planche endpoint."""
    logger.debug("Testing Planche connection for user_id=%s", current_user.id)
    base_url = _normalize_base_url(request.base_url)
    if not base_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="base_url must not be empty")

    url = _build_planche_url(base_url, "/heartbeat")
    headers = {"LOGBOOK-API-KEY": request.token}

    status_code, payload = await _run_in_thread(_perform_json_request, url, "GET", headers, None)
    if 200 <= status_code < 300:
        return PlancheConnectionTestResponse(
            success=True,
            message="Connection successful",
            status_code=status_code,
            details=payload,
        )

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={
            "message": "Unable to reach Planche with the provided connection credentials",
            "status_code": status_code,
            "details": payload,
        },
    )


@router.post("/settings/test-login", response_model=PlancheLoginTestResponse)
async def test_planche_login_endpoint(
    request: PlancheSettingsPayload,
    _: User = configuration_guard,
    current_user: User = Depends(get_current_user),
):
    """Validate the Planche username/password against the remote auth endpoint."""
    logger.debug("Testing Planche login for user_id=%s", current_user.id)
    base_url = _normalize_base_url(request.base_url)
    if not base_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="base_url must not be empty")

    url = _build_planche_url(base_url, "/auth/login")
    headers = {"LOGBOOK-API-KEY": request.token}
    status_code, payload = await _run_in_thread(
        _perform_json_request,
        url,
        "POST",
        headers,
        {"username": request.user, "password": request.password},
    )

    success = 200 <= status_code < 300 and bool(payload.get("success", True))
    if success:
        return PlancheLoginTestResponse(
            success=True,
            message="Login successful",
            status_code=status_code,
            user_id=payload.get("user_id"),
            roles=list(payload.get("roles") or []),
            login_token=payload.get("login_token"),
            details=payload,
        )

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={
            "message": "Unable to authenticate with Planche",
            "status_code": status_code,
            "details": payload,
        },
    )
