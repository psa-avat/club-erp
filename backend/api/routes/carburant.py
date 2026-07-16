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

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import require_capability
from constants import CAP_MANAGE_CARBURANT
from models import User
from schemas.carburant import (
    MouvementCarburantListResponse,
    MouvementCarburantRejectRequest,
    MouvementCarburantResponse,
    MouvementCarburantValidateRequest,
    PompeCreateRequest,
    PompeListResponse,
    PompeResponse,
    PompeUpdateRequest,
    RavitaillementCreateRequest,
    RavitaillementListResponse,
    RavitaillementResponse,
    StockCarburantResponse,
)
from services.carburant import (
    create_pompe,
    create_ravitaillement,
    generate_pompe_qrcode_svg,
    get_mouvement,
    get_pompe,
    get_stock_carburant,
    list_mouvements,
    list_pompes,
    list_ravitaillements,
    rejeter_mouvement,
    rotate_pompe_token,
    update_pompe,
    valider_mouvement,
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


@router.get("/mouvements", response_model=MouvementCarburantListResponse)
async def get_mouvements(
    statut: Optional[int] = Query(default=None),
    pompe_uuid: Optional[UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = _carburant_guard,
):
    items = await list_mouvements(db, statut=statut, pompe_uuid=pompe_uuid)
    return MouvementCarburantListResponse(items=items)


@router.get("/mouvements/{mouvement_uuid}", response_model=MouvementCarburantResponse)
async def get_mouvement_endpoint(
    mouvement_uuid: UUID, db: AsyncSession = Depends(get_db), _: User = _carburant_guard
):
    return await get_mouvement(db, mouvement_uuid)


@router.post("/mouvements/{mouvement_uuid}/valider", response_model=MouvementCarburantResponse)
async def valider_mouvement_endpoint(
    mouvement_uuid: UUID,
    body: MouvementCarburantValidateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = _carburant_guard,
):
    return await valider_mouvement(
        db, mouvement_uuid, current_user.id, commentaire=body.commentaire_validation
    )


@router.post("/mouvements/{mouvement_uuid}/rejeter", response_model=MouvementCarburantResponse)
async def rejeter_mouvement_endpoint(
    mouvement_uuid: UUID,
    body: MouvementCarburantRejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = _carburant_guard,
):
    return await rejeter_mouvement(
        db, mouvement_uuid, current_user.id, commentaire=body.commentaire_validation
    )


@router.get("/ravitaillements", response_model=RavitaillementListResponse)
async def get_ravitaillements(
    pompe_uuid: Optional[UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = _carburant_guard,
):
    items = await list_ravitaillements(db, pompe_uuid=pompe_uuid)
    return RavitaillementListResponse(items=items)


@router.post("/ravitaillements", response_model=RavitaillementResponse, status_code=201)
async def create_ravitaillement_endpoint(
    body: RavitaillementCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = _carburant_guard,
):
    return await create_ravitaillement(db, body, current_user.id)


@router.get("/stock", response_model=StockCarburantResponse)
async def get_stock(db: AsyncSession = Depends(get_db), _: User = _carburant_guard):
    items = await get_stock_carburant(db)
    return StockCarburantResponse(items=items)
