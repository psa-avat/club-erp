"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - helloasso: FastAPI routes for HelloAsso integration settings
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

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_ACCOUNTING_SETTINGS
from models import User
from schemas.accounting import SystemSettingUpdateRequest
from schemas.helloasso import (
    HELLOASSO_SETTINGS_MODULE,
    HelloAssoConnectionTestResponse,
    HelloAssoSettingsPayload,
    HelloAssoSettingsResponse,
)
from services.accounting import get_system_setting, upsert_system_setting

router = APIRouter(prefix="/api/v1/helloasso", tags=["helloasso"])
logger = logging.getLogger(__name__)

settings_guard = Depends(require_capability(CAP_MANAGE_ACCOUNTING_SETTINGS))

DEFAULT_HELLOASSO_SETTINGS: dict[str, Any] = {
    "client_id": "",
    "client_secret": "",
    "environment": "production",
}

HELLOASSO_AUTH_URL = "https://api.helloasso.com/oauth2/token"
HELLOASSO_ORGANIZATIONS_URL = "https://api.helloasso.com/v5/users/me/organizations"


def _settings_payload_from_dict(settings: dict[str, Any]) -> dict[str, Any]:
    allowed_keys = HelloAssoSettingsPayload.model_fields.keys()
    return DEFAULT_HELLOASSO_SETTINGS | {
        key: value
        for key, value in settings.items()
        if key in allowed_keys and isinstance(value, str)
    }


def _response_from_setting(
    module_name: str,
    settings: dict[str, Any],
    updated_at: datetime,
    updated_by: int | None,
) -> HelloAssoSettingsResponse:
    return HelloAssoSettingsResponse(
        module_name=module_name,
        settings=_settings_payload_from_dict(settings),
        updated_at=updated_at,
        updated_by=updated_by,
    )


def _perform_form_request(
    url: str,
    payload: dict[str, str],
    timeout: float = 15.0,
) -> tuple[int, dict[str, Any]]:
    encoded = urllib_parse.urlencode(payload).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "python-requests/2.31.0",
    }
    request = urllib_request.Request(url, data=encoded, headers=headers, method="POST")

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


def _perform_json_get(
    url: str,
    headers: dict[str, str],
    timeout: float = 15.0,
) -> tuple[int, Any]:
    request_headers = {"Accept": "application/json", "User-Agent": "python-requests/2.31.0"}
    request_headers.update(headers)
    request = urllib_request.Request(url, data=None, headers=request_headers, method="GET")

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


@router.get("/settings", response_model=HelloAssoSettingsResponse)
async def get_helloasso_settings_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Return the stored HelloAsso integration settings, or defaults when missing."""
    try:
        setting = await get_system_setting(db, HELLOASSO_SETTINGS_MODULE)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        return HelloAssoSettingsResponse(
            module_name=HELLOASSO_SETTINGS_MODULE,
            settings=DEFAULT_HELLOASSO_SETTINGS,
            updated_at=datetime.fromtimestamp(0, tz=UTC),
            updated_by=None,
        )

    return _response_from_setting(
        setting.module_name,
        setting.settings if isinstance(setting.settings, dict) else {},
        setting.updated_at,
        setting.updated_by,
    )


@router.put("/settings", response_model=HelloAssoSettingsResponse)
async def update_helloasso_settings_endpoint(
    request: HelloAssoSettingsPayload,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Create or update the stored HelloAsso integration settings."""
    setting = await upsert_system_setting(
        db,
        HELLOASSO_SETTINGS_MODULE,
        SystemSettingUpdateRequest(settings=request.model_dump()),
        current_user.id,
    )
    return _response_from_setting(setting.module_name, setting.settings, setting.updated_at, setting.updated_by)


@router.post("/settings/test-connection", response_model=HelloAssoConnectionTestResponse)
async def test_helloasso_connection_endpoint(
    request: HelloAssoSettingsPayload,
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Validate HelloAsso API credentials and retrieve organization access."""
    logger.debug("Testing HelloAsso connection for user_id=%s", current_user.id)

    token_status_code, token_payload = await _run_in_thread(
        _perform_form_request,
        HELLOASSO_AUTH_URL,
        {
            "client_id": request.client_id,
            "client_secret": request.client_secret,
            "grant_type": "client_credentials",
        },
    )

    access_token = token_payload.get("access_token") if isinstance(token_payload, dict) else None
    if not (200 <= token_status_code < 300 and isinstance(access_token, str) and access_token):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Unable to authenticate with HelloAsso using the provided credentials",
                "status_code": token_status_code,
                "details": token_payload if isinstance(token_payload, dict) else {"raw": str(token_payload)},
            },
        )

    org_status_code, organizations_payload = await _run_in_thread(
        _perform_json_get,
        HELLOASSO_ORGANIZATIONS_URL,
        {"Authorization": f"Bearer {access_token}"},
    )

    if not 200 <= org_status_code < 300:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Connected to HelloAsso but failed to fetch organizations",
                "status_code": org_status_code,
                "details": organizations_payload if isinstance(organizations_payload, dict) else {"raw": str(organizations_payload)},
            },
        )

    organizations = organizations_payload if isinstance(organizations_payload, list) else []
    first_org = organizations[0] if organizations else {}
    first_slug = first_org.get("organizationSlug") if isinstance(first_org, dict) else None

    return HelloAssoConnectionTestResponse(
        success=True,
        message="Connection successful",
        status_code=org_status_code,
        organizations_count=len(organizations),
        organization_slug=first_slug if isinstance(first_slug, str) else None,
        details={"organizations": organizations},
    )
