"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - flight_packs: Pydantic schemas for pack definitions, applicability, and consumption
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
# Pack Applicability (link to pricing item)
# ---------------------------------------------------------------------------

class ApplicableItemCreate(BaseModel):
    """Link a pricing item to a pack definition with a discounted price."""
    pricing_item_uuid: UUID
    discounted_unit_price: Decimal = Field(ge=0, decimal_places=4)


class ApplicableItemResponse(BaseModel):
    """Response for a pack ↔ pricing item link."""
    model_config = {"from_attributes": True}

    uuid: UUID
    pack_definition_uuid: UUID
    pricing_item_uuid: UUID
    discounted_unit_price: Decimal
    created_at: datetime


# ---------------------------------------------------------------------------
# Pack Definitions
# ---------------------------------------------------------------------------

class PackDefinitionCreate(BaseModel):
    """Create a new pack definition (catalog template)."""
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    fiscal_year_uuid: UUID
    pack_type: str = Field(pattern=r"^(flight_hours|winch_launches|tow_launches|engine_time)$")
    quantity_allowance: Decimal = Field(gt=0, decimal_places=2)
    quantity_unit: str = Field(default="hours", pattern=r"^(hours|launches|centihours)$")
    eligible_asset_type_uuid: Optional[UUID] = None
    pack_sales_account_uuid: Optional[UUID] = None
    rem_discount_account_uuid: Optional[UUID] = None
    priority: int = Field(default=0, ge=0)
    applicable_items: list[ApplicableItemCreate] = []


class PackDefinitionUpdate(BaseModel):
    """Update an existing pack definition."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    quantity_allowance: Optional[Decimal] = Field(default=None, gt=0, decimal_places=2)
    eligible_asset_type_uuid: Optional[UUID] = None
    pack_sales_account_uuid: Optional[UUID] = None
    rem_discount_account_uuid: Optional[UUID] = None
    priority: Optional[int] = Field(default=None, ge=0)
    applicable_items: Optional[list[ApplicableItemCreate]] = None


class PackDefinitionResponse(BaseModel):
    """Response for a pack definition."""
    model_config = {"from_attributes": True}

    uuid: UUID
    code: str
    name: str
    fiscal_year_uuid: UUID
    pack_type: str
    quantity_allowance: Decimal
    quantity_unit: str
    eligible_asset_type_uuid: Optional[UUID] = None
    pack_sales_account_uuid: Optional[UUID] = None
    rem_discount_account_uuid: Optional[UUID] = None
    priority: int
    created_at: datetime
    applicability: list[ApplicableItemResponse] = []


# ---------------------------------------------------------------------------
# Member Pack Consumptions
# ---------------------------------------------------------------------------

class MemberPackConsumptionCreate(BaseModel):
    """Record a pack consumption for a flight line."""
    member_uuid: UUID
    flight_uuid: UUID
    pack_type: str
    quantity_consumed: Decimal = Field(gt=0, decimal_places=2)
    discount_unit_price: Decimal = Field(ge=0, decimal_places=2)
    total_discount_amount: Decimal = Field(ge=0, decimal_places=2)
    accounting_entry_uuid: Optional[UUID] = None


class MemberPackConsumptionResponse(BaseModel):
    """Response for a pack consumption row."""
    model_config = {"from_attributes": True}

    uuid: UUID
    member_uuid: UUID
    flight_uuid: UUID
    pack_type: str
    quantity_consumed: Decimal
    discount_unit_price: Decimal
    total_discount_amount: Decimal
    accounting_entry_uuid: Optional[UUID] = None
    is_frozen: bool
    frozen_at: Optional[datetime] = None
    frozen_reason: Optional[str] = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Member Pack Balance (from view)
# ---------------------------------------------------------------------------

class MemberPackBalanceResponse(BaseModel):
    """Remaining pack balance for a member, derived from vw_member_pack_balances."""
    member_uuid: UUID
    pack_type: str
    total_purchased: Decimal
    total_consumed: Decimal
    units_remaining: Decimal


# ---------------------------------------------------------------------------
# Freeze / Unfreeze
# ---------------------------------------------------------------------------

class FreezeConsumptionRequest(BaseModel):
    """Request to freeze or unfreeze a pack consumption."""
    reason: Optional[str] = None
