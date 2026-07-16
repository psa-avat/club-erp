"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant_public: unauthenticated fuel declaration endpoints, reached by scanning a
      per-pump QR code. No get_current_user / require_capability anywhere in this file —
      that is deliberate, not an oversight. Anti-abuse relies on the opaque per-pump token,
      a per-pump/IP rate limit, and a brouillon status that keeps declarations out of the
      official stock until an admin validates them (see services/carburant.py).
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

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.routes.auth import get_request_ip
from schemas.carburant import (
    AssetPublicListResponse,
    AssetPublicOption,
    MouvementCarburantCreateRequest,
    MouvementCarburantCreateResponse,
    PompePublicResponse,
)
from services.carburant import create_mouvement, get_pompe_by_token, list_active_assets

router = APIRouter(prefix="/api/v1/carburant/plein", tags=["carburant-public"])


@router.get("/{token}", response_model=PompePublicResponse)
async def get_pompe(token: str, db: AsyncSession = Depends(get_db)):
    pompe = await get_pompe_by_token(db, token)
    return PompePublicResponse(uuid=pompe.uuid, nom=pompe.nom, type_carburant=pompe.type_carburant)


@router.get("/{token}/avions", response_model=AssetPublicListResponse)
async def get_avions(token: str, db: AsyncSession = Depends(get_db)):
    await get_pompe_by_token(db, token)
    assets = await list_active_assets(db)
    return AssetPublicListResponse(
        items=[
            AssetPublicOption(uuid=asset.uuid, registration=asset.registration, name=asset.name)
            for asset in assets
        ]
    )


@router.post("/{token}", response_model=MouvementCarburantCreateResponse, status_code=201)
async def submit_plein(
    token: str,
    body: MouvementCarburantCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    mouvement = await create_mouvement(
        db=db,
        token=token,
        request=body,
        ip_source=get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return MouvementCarburantCreateResponse(
        uuid=mouvement.uuid,
        statut=mouvement.statut,
        flag_anomalie=mouvement.flag_anomalie,
    )
