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
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_ACCOUNTING_SETTINGS
from models import User
from schemas.accounting import SystemSettingUpdateRequest
from schemas.planche import PLANCHE_SETTINGS_MODULE, PlancheConnectionTestResponse, PlancheLoginTestResponse, PlancheSettingsPayload, PlancheSettingsResponse
from services.planche_integration import PlancheIntegrationService

# --- Phase 2: Outbound Sync Endpoints ---
from fastapi.responses import JSONResponse

from services.accounting import get_system_setting, upsert_system_setting

router = APIRouter(prefix="/api/v1/planche", tags=["planche"])
logger = logging.getLogger(__name__)

settings_guard = Depends(require_capability(CAP_MANAGE_ACCOUNTING_SETTINGS))



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
    )

@router.post("/pilots/push")
async def push_pilots_to_planche(
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Manually push eligible pilots to Planche."""
    service = await _get_planche_service(db)
    result = await service.batch_push_pilots(db, triggered_by=str(current_user.id))
    return JSONResponse({
        "success": result["failure"] == 0,
        "pushed_count": result["success"],
        "failed_count": result["failure"],
        "errors": result["error_details"],
        "last_synced_at": datetime.now(UTC).isoformat(),
    })

@router.post("/machines/push")
async def push_machines_to_planche(
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
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

DEFAULT_PLANCHE_SETTINGS: dict[str, Any] = {
    "base_url": "",
    "connection_id": "",
    "token": "",
    "user": "",
    "password": "",
    "environment": "test",
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
    _: User = settings_guard,
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
    _: User = settings_guard,
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
    _: User = settings_guard,
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
    _: User = settings_guard,
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
