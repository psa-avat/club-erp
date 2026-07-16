"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant: Pydantic schemas for the fuel tracking module (pumps, declared fill-ups, refills)
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

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Public declaration flow (GET/POST /api/v1/carburant/plein/{token}) — no auth
# ---------------------------------------------------------------------------

class PompePublicResponse(BaseModel):
    uuid: UUID
    nom: str
    type_carburant: int


class AssetPublicOption(BaseModel):
    uuid: UUID
    registration: Optional[str] = None
    name: str


class AssetPublicListResponse(BaseModel):
    items: list[AssetPublicOption]


class MouvementCarburantCreateRequest(BaseModel):
    asset_uuid: UUID
    quantite_l: Decimal = Field(..., gt=0, decimal_places=2)
    index_compteur: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    membre_declarant: str = Field(..., min_length=1, max_length=150)


class MouvementCarburantCreateResponse(BaseModel):
    uuid: UUID
    statut: int
    flag_anomalie: bool


# ---------------------------------------------------------------------------
# Admin: pompes (/api/v1/admin/carburant/pompes) — MANAGE_CARBURANT
# ---------------------------------------------------------------------------

class PompeCreateRequest(BaseModel):
    nom: str = Field(..., min_length=1, max_length=100)
    type_carburant: int = Field(..., ge=1, le=3)
    actif: bool = True
    capacite_cuve_l: Optional[Decimal] = Field(default=None, gt=0, decimal_places=2)
    index_initial: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    index_initial_date: Optional[date] = None


class PompeUpdateRequest(BaseModel):
    nom: Optional[str] = Field(default=None, min_length=1, max_length=100)
    type_carburant: Optional[int] = Field(default=None, ge=1, le=3)
    actif: Optional[bool] = None
    capacite_cuve_l: Optional[Decimal] = Field(default=None, gt=0, decimal_places=2)
    index_initial: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    index_initial_date: Optional[date] = None


class PompeResponse(BaseModel):
    uuid: UUID
    nom: str
    type_carburant: int
    token: str
    actif: bool
    capacite_cuve_l: Optional[Decimal] = None
    index_initial: Optional[Decimal] = None
    index_initial_date: Optional[date] = None
    created_at: datetime
    updated_at: datetime


class PompeListResponse(BaseModel):
    items: list[PompeResponse]
