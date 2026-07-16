"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant: admin FastAPI routes for the fuel tracking module (pumps, QR codes)
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

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import require_capability
from constants import CAP_MANAGE_CARBURANT
from models import User
from schemas.carburant import (
    PompeCreateRequest,
    PompeListResponse,
    PompeResponse,
    PompeUpdateRequest,
)
from services.carburant import (
    create_pompe,
    generate_pompe_qrcode_svg,
    get_pompe,
    list_pompes,
    rotate_pompe_token,
    update_pompe,
)

router = APIRouter(prefix="/api/v1/admin/carburant", tags=["carburant"])

_carburant_guard = Depends(require_capability(CAP_MANAGE_CARBURANT))


@router.get("/pompes", response_model=PompeListResponse)
async def get_pompes(db: AsyncSession = Depends(get_db), _: User = _carburant_guard):
    pompes = await list_pompes(db)
    return PompeListResponse(items=[PompeResponse.model_validate(p, from_attributes=True) for p in pompes])


@router.post("/pompes", response_model=PompeResponse, status_code=201)
async def create_pompe_endpoint(
    body: PompeCreateRequest, db: AsyncSession = Depends(get_db), _: User = _carburant_guard
):
    pompe = await create_pompe(db, body)
    return PompeResponse.model_validate(pompe, from_attributes=True)


@router.get("/pompes/{pompe_uuid}", response_model=PompeResponse)
async def get_pompe_endpoint(pompe_uuid: UUID, db: AsyncSession = Depends(get_db), _: User = _carburant_guard):
    pompe = await get_pompe(db, pompe_uuid)
    return PompeResponse.model_validate(pompe, from_attributes=True)


@router.patch("/pompes/{pompe_uuid}", response_model=PompeResponse)
async def update_pompe_endpoint(
    pompe_uuid: UUID,
    body: PompeUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _carburant_guard,
):
    pompe = await update_pompe(db, pompe_uuid, body)
    return PompeResponse.model_validate(pompe, from_attributes=True)


@router.post("/pompes/{pompe_uuid}/rotate-token", response_model=PompeResponse)
async def rotate_pompe_token_endpoint(
    pompe_uuid: UUID, db: AsyncSession = Depends(get_db), _: User = _carburant_guard
):
    pompe = await rotate_pompe_token(db, pompe_uuid)
    return PompeResponse.model_validate(pompe, from_attributes=True)


@router.get("/pompes/{pompe_uuid}/qrcode")
async def get_pompe_qrcode(
    pompe_uuid: UUID, base_url: str, db: AsyncSession = Depends(get_db), _: User = _carburant_guard
):
    pompe = await get_pompe(db, pompe_uuid)
    svg = generate_pompe_qrcode_svg(pompe, base_url)
    return Response(content=svg, media_type="image/svg+xml")
