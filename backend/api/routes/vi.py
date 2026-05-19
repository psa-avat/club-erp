"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: FastAPI routes for VI type catalog, entitlements, planning, and staging promotion
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

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_VI, CAP_PLAN_VI
from models import User
from schemas.vi import (
    HelloAssoViStagingResponse,
    ViBulkScheduleRequest,
    ViEntitlementPayload,
    ViEntitlementResponse,
    ViEntitlementUpdateRequest,
    ViNotesPatchRequest,
    ViPlanningDatePatchRequest,
    ViPromotionRequest,
    ViPromotionResponse,
    ViTypeCatalogPayload,
    ViTypeCatalogResponse,
    ViTypeCatalogUpdateRequest,
)
from services.vi import (
    bulk_schedule_vi,
    create_vi_entitlement,
    create_vi_type,
    get_vi_entitlement,
    get_vi_type,
    list_vi_entitlements,
    list_vi_staging,
    list_vi_types,
    patch_vi_notes,
    patch_vi_realisation_date,
    patch_vi_scheduled_date,
    promote_staging_rows_to_entitlements,
    update_vi_entitlement,
    update_vi_type,
)

router = APIRouter(prefix="/api/v1/vi", tags=["vi"])

_manage_guard = Depends(require_capability(CAP_MANAGE_VI))
_plan_guard = Depends(require_capability(CAP_PLAN_VI))


@router.get("/types", response_model=list[ViTypeCatalogResponse])
async def list_vi_types_endpoint(
    active_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    return await list_vi_types(db=db, active_only=active_only)


@router.post("/types", response_model=ViTypeCatalogResponse, status_code=201)
async def create_vi_type_endpoint(
    request: ViTypeCatalogPayload,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await create_vi_type(db=db, payload=request, user_id=current_user.id)


@router.get("/types/{type_uuid}", response_model=ViTypeCatalogResponse)
async def get_vi_type_endpoint(
    type_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    return await get_vi_type(db=db, type_uuid=type_uuid)


@router.patch("/types/{type_uuid}", response_model=ViTypeCatalogResponse)
async def update_vi_type_endpoint(
    type_uuid: UUID,
    request: ViTypeCatalogUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await update_vi_type(db=db, type_uuid=type_uuid, payload=request, user_id=current_user.id)


@router.get("/entitlements", response_model=list[ViEntitlementResponse])
async def list_vi_entitlements_endpoint(
    status_filter: int | None = Query(default=None, alias="status", ge=1, le=5),
    vi_type_uuid: UUID | None = Query(default=None),
    scheduled_from: date | None = Query(default=None),
    scheduled_to: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    return await list_vi_entitlements(
        db=db,
        status_filter=status_filter,
        type_uuid=vi_type_uuid,
        scheduled_from=scheduled_from,
        scheduled_to=scheduled_to,
    )


@router.post("/entitlements", response_model=ViEntitlementResponse, status_code=201)
async def create_vi_entitlement_endpoint(
    request: ViEntitlementPayload,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await create_vi_entitlement(db=db, payload=request, user_id=current_user.id)


@router.get("/entitlements/{entitlement_uuid}", response_model=ViEntitlementResponse)
async def get_vi_entitlement_endpoint(
    entitlement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    return await get_vi_entitlement(db=db, entitlement_uuid=entitlement_uuid)


@router.patch("/entitlements/{entitlement_uuid}", response_model=ViEntitlementResponse)
async def update_vi_entitlement_endpoint(
    entitlement_uuid: UUID,
    request: ViEntitlementUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await update_vi_entitlement(
        db=db,
        entitlement_uuid=entitlement_uuid,
        payload=request,
        user_id=current_user.id,
    )


@router.patch("/entitlements/{entitlement_uuid}/scheduled-date", response_model=ViEntitlementResponse)
async def patch_vi_entitlement_scheduled_date_endpoint(
    entitlement_uuid: UUID,
    request: ViPlanningDatePatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    return await patch_vi_scheduled_date(
        db=db,
        entitlement_uuid=entitlement_uuid,
        scheduled_date=request.value,
        user_id=current_user.id,
    )


@router.patch("/entitlements/{entitlement_uuid}/realisation-date", response_model=ViEntitlementResponse)
async def patch_vi_entitlement_realisation_date_endpoint(
    entitlement_uuid: UUID,
    request: ViPlanningDatePatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    return await patch_vi_realisation_date(
        db=db,
        entitlement_uuid=entitlement_uuid,
        realisation_date=request.value,
        user_id=current_user.id,
    )


@router.patch("/entitlements/{entitlement_uuid}/notes", response_model=ViEntitlementResponse)
async def patch_vi_entitlement_notes_endpoint(
    entitlement_uuid: UUID,
    request: ViNotesPatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    return await patch_vi_notes(
        db=db,
        entitlement_uuid=entitlement_uuid,
        notes=request.notes,
        user_id=current_user.id,
    )


@router.post("/planning/bulk-schedule")
async def bulk_schedule_vi_endpoint(
    request: ViBulkScheduleRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    result = await bulk_schedule_vi(
        db=db,
        entitlement_uuids=request.entitlement_uuids,
        scheduled_date=request.scheduled_date,
        user_id=current_user.id,
    )
    return {"success": True, **result}


@router.get("/staging", response_model=list[HelloAssoViStagingResponse])
async def list_vi_staging_endpoint(
    status_filter: int | None = Query(default=None, alias="status", ge=1, le=3),
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    return await list_vi_staging(db=db, status_filter=status_filter)


@router.post("/staging/promote", response_model=ViPromotionResponse)
async def promote_vi_staging_endpoint(
    request: ViPromotionRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await promote_staging_rows_to_entitlements(
        db=db,
        staging_uuids=request.staging_uuids,
        vi_type_uuid=request.vi_type_uuid,
        user_id=current_user.id,
    )
