"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - storage: REST endpoints for S3-compatible object storage configuration
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

import logging
from datetime import datetime, timezone
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_SYSTEM_SETTINGS
from models import User
from schemas.accounting import SystemSettingUpdateRequest
from schemas.storage import (
    MASKED_VALUE,
    STORAGE_SETTINGS_MODULE,
    StorageConnectionTestResponse,
    StorageSettingsPayload,
    StorageSettingsResponse,
)
from services.accounting import get_system_setting, upsert_system_setting
from services.storage import test_storage_connection, test_storage_connection_from_config

router = APIRouter(prefix="/api/v1/storage", tags=["storage"])
logger = logging.getLogger(__name__)

UTC = timezone.utc

settings_guard = Depends(require_capability(CAP_MANAGE_SYSTEM_SETTINGS))

_DEFAULT_SETTINGS: dict = StorageSettingsPayload().model_dump()

# Secret fields that are write-only; they are masked in all read responses.
_SECRET_FIELDS = ("access_key", "secret_key")


def _mask_secrets(settings: dict) -> dict:
    """Replace secret field values with the masked sentinel for API responses."""
    masked = dict(settings)
    for field in _SECRET_FIELDS:
        if masked.get(field):
            masked[field] = MASKED_VALUE
    return masked


def _build_response(module_name: str, settings: dict, updated_at: datetime, updated_by: int | None) -> StorageSettingsResponse:
    return StorageSettingsResponse(
        module_name=module_name,
        settings=_mask_secrets({**_DEFAULT_SETTINGS, **settings}),
        updated_at=updated_at,
        updated_by=updated_by,
    )


@router.get("/settings", response_model=StorageSettingsResponse)
async def get_storage_settings(
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
):
    """Return current S3 storage settings.  Secret fields are masked (``***``)."""
    try:
        setting = await get_system_setting(db, STORAGE_SETTINGS_MODULE)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        return StorageSettingsResponse(
            module_name=STORAGE_SETTINGS_MODULE,
            settings=_mask_secrets(_DEFAULT_SETTINGS),
            updated_at=datetime.fromtimestamp(0, tz=UTC),
            updated_by=None,
        )

    stored = setting.settings if isinstance(setting.settings, dict) else {}
    return _build_response(
        cast(str, setting.module_name),
        stored,
        cast(datetime, setting.updated_at),
        cast(int | None, setting.updated_by),
    )


@router.put("/settings", response_model=StorageSettingsResponse)
async def update_storage_settings(
    payload: StorageSettingsPayload,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Update S3 storage settings.

    Pass ``***`` (or omit) for secret fields to keep existing values unchanged.
    """
    # Load existing stored settings so we can preserve secrets when sentinel is sent
    try:
        existing_setting = await get_system_setting(db, STORAGE_SETTINGS_MODULE)
        existing: dict = existing_setting.settings if isinstance(existing_setting.settings, dict) else {}
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        existing = {}

    new_settings = payload.model_dump()

    # Keep existing secret value when caller sends the masked sentinel
    for field in _SECRET_FIELDS:
        if new_settings.get(field) == MASKED_VALUE:
            new_settings[field] = existing.get(field, "")

    setting = await upsert_system_setting(
        db,
        STORAGE_SETTINGS_MODULE,
        SystemSettingUpdateRequest(settings=new_settings),
        cast(int, current_user.id),
    )

    stored = setting.settings if isinstance(setting.settings, dict) else {}
    return _build_response(
        cast(str, setting.module_name),
        stored,
        cast(datetime, setting.updated_at),
        cast(int | None, setting.updated_by),
    )


@router.post("/test-connection", response_model=StorageConnectionTestResponse)
async def test_connection(
    payload: StorageSettingsPayload | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
):
    """Probe the configured S3 endpoint and verify bucket accessibility."""
    if payload is None:
        result = await test_storage_connection(db)
        return StorageConnectionTestResponse(**result)

    try:
        existing_setting = await get_system_setting(db, STORAGE_SETTINGS_MODULE)
        existing: dict = existing_setting.settings if isinstance(existing_setting.settings, dict) else {}
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        existing = {}

    test_config = payload.model_dump()
    for field in ("access_key", "secret_key"):
        if test_config.get(field) == MASKED_VALUE:
            test_config[field] = existing.get(field, "")

    result = await test_storage_connection_from_config(test_config, bucket_name=test_config.get("bucket_name") or "")
    return StorageConnectionTestResponse(**result)
