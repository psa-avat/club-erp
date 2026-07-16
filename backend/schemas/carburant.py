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
    type_carburant: int = Field(..., ge=1, le=2)
    actif: bool = True
    capacite_cuve_l: Optional[Decimal] = Field(default=None, gt=0, decimal_places=2)
    index_initial: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    index_initial_date: Optional[date] = None


class PompeUpdateRequest(BaseModel):
    nom: Optional[str] = Field(default=None, min_length=1, max_length=100)
    type_carburant: Optional[int] = Field(default=None, ge=1, le=2)
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


# ---------------------------------------------------------------------------
# Admin: validation queue (/api/v1/admin/carburant/mouvements) — MANAGE_CARBURANT
# ---------------------------------------------------------------------------

class MouvementCarburantResponse(BaseModel):
    uuid: UUID
    pompe_uuid: UUID
    pompe_nom: str
    asset_uuid: UUID
    asset_registration: Optional[str] = None
    asset_name: str
    quantite_l: Decimal
    index_compteur: Optional[Decimal] = None
    membre_declarant: str
    date_saisie: datetime
    statut: int
    ip_source: Optional[str] = None
    flag_anomalie: bool
    commentaire_validation: Optional[str] = None
    validated_at: Optional[datetime] = None


class MouvementCarburantListResponse(BaseModel):
    items: list[MouvementCarburantResponse]


class MouvementCarburantValidateRequest(BaseModel):
    commentaire_validation: Optional[str] = Field(default=None, max_length=500)


class MouvementCarburantRejectRequest(BaseModel):
    commentaire_validation: str = Field(..., min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# Admin: ravitaillements (/api/v1/admin/carburant/ravitaillements) — MANAGE_CARBURANT
# ---------------------------------------------------------------------------

class RavitaillementCreateRequest(BaseModel):
    pompe_uuid: UUID
    quantite_l: Decimal = Field(..., gt=0, decimal_places=2)
    date_ravitaillement: date
    note: Optional[str] = Field(default=None, max_length=500)


class RavitaillementResponse(BaseModel):
    uuid: UUID
    pompe_uuid: UUID
    pompe_nom: str
    quantite_l: Decimal
    date_ravitaillement: date
    note: Optional[str] = None
    created_at: datetime


class RavitaillementListResponse(BaseModel):
    items: list[RavitaillementResponse]


# ---------------------------------------------------------------------------
# Admin: stock (/api/v1/admin/carburant/stock) — MANAGE_CARBURANT
# ---------------------------------------------------------------------------

class StockCarburantEntry(BaseModel):
    pompe_uuid: UUID
    pompe_nom: str
    type_carburant: int
    actif: bool
    total_ravitaillements_l: Decimal
    total_consommation_l: Decimal
    stock_l: Decimal
    derniere_activite: Optional[datetime] = None


class StockCarburantResponse(BaseModel):
    items: list[StockCarburantEntry]
