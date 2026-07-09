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
    pack_type: str = Field(pattern=r"^(flight_hours|winch_launches|tow_launches|engine_time)$")
    quantity_allowance: Decimal = Field(gt=0, decimal_places=2)
    quantity_unit: str = Field(default="hours", pattern=r"^(hours|launches|centihours)$")
    pack_sales_account_uuid: Optional[UUID] = None
    pack_discount_expense_account_uuid: Optional[UUID] = None
    priority: int = Field(default=0, ge=0)
    applicable_items: list[ApplicableItemCreate] = []


class PackDefinitionUpdate(BaseModel):
    """Update an existing pack definition."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    quantity_allowance: Optional[Decimal] = Field(default=None, gt=0, decimal_places=2)
    pack_sales_account_uuid: Optional[UUID] = None
    pack_discount_expense_account_uuid: Optional[UUID] = None
    priority: Optional[int] = Field(default=None, ge=0)
    applicable_items: Optional[list[ApplicableItemCreate]] = None


class PackDefinitionResponse(BaseModel):
    """Response for a pack definition."""
    model_config = {"from_attributes": True}

    uuid: UUID
    code: str
    name: str
    pack_type: str
    quantity_allowance: Decimal
    quantity_unit: str
    pack_sales_account_uuid: Optional[UUID] = None
    pack_discount_expense_account_uuid: Optional[UUID] = None
    priority: int
    created_at: datetime
    applicability: list[ApplicableItemResponse] = []


# ---------------------------------------------------------------------------
# Member Pack Consumptions
# ---------------------------------------------------------------------------

class MemberPackConsumptionCreate(BaseModel):
    """Record a pack consumption for a flight line."""
    tiers_uuid: UUID
    flight_uuid: UUID
    pack_type: str
    valid_from: datetime = Field(description="Pack is applicable only to flights on or after this date")
    quantity_consumed: Decimal = Field(gt=0, decimal_places=2)
    discount_unit_price: Decimal = Field(ge=0, decimal_places=2)
    total_discount_amount: Decimal = Field(ge=0, decimal_places=2)
    accounting_entry_uuid: Optional[UUID] = None


class MemberPackConsumptionResponse(BaseModel):
    """Response for a pack consumption row."""
    model_config = {"from_attributes": True}

    uuid: UUID
    tiers_uuid: UUID
    flight_uuid: UUID
    pack_type: str
    pack_definition_uuid: Optional[UUID] = None
    valid_from: datetime
    quantity_consumed: Decimal
    discount_unit_price: Decimal
    total_discount_amount: Decimal
    accounting_entry_uuid: Optional[UUID] = None
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
# Pack Purchase
# ---------------------------------------------------------------------------

class MemberPackPurchaseRequest(BaseModel):
    """Buy a pack for a member."""
    pack_definition_uuid: UUID
    price: Decimal = Field(gt=0, decimal_places=2, description="Sale price for the pack")
    valid_from: date = Field(description="Activation date (within fiscal year)")
    quantity: Decimal = Field(default=Decimal("1"), gt=0, decimal_places=2)


class MemberPackPurchaseResponse(BaseModel):
    """Result of a pack purchase."""
    entry_uuid: UUID
    reference: str
    description: str
    amount: Decimal
    units_purchased: Decimal


# ---------------------------------------------------------------------------
# Pack Purchase Listing
# ---------------------------------------------------------------------------

class PackPurchaseLine(BaseModel):
    """One purchased pack with its consumption details."""
    entry_uuid: UUID
    reference: str
    description: str
    entry_date: date
    member_uuid: UUID
    member_name: str | None = None
    pack_code: str | None = None
    pack_type: str | None = None
    amount: Decimal
    valid_from: date | None = None
    units_purchased: Decimal = Decimal("0")
    units_consumed: Decimal = Decimal("0")
    units_remaining: Decimal = Decimal("0")
    total_discount: Decimal = Decimal("0")
    consumptions: list[dict] = []


class PackPurchaseListResponse(BaseModel):
    """List of all pack purchases for a fiscal year."""
    items: list[PackPurchaseLine]
    total: Decimal = Decimal("0")
    total_count: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


# ---------------------------------------------------------------------------
# Consumption valid_from update
# ---------------------------------------------------------------------------

class ConsumptionValidFromUpdate(BaseModel):
    """Update the valid_from date on a pack consumption."""
    valid_from: datetime


# ---------------------------------------------------------------------------
# Pack Purchase Update (edit a sold pack)
# ---------------------------------------------------------------------------

class PackPurchaseUpdate(BaseModel):
    """Update the valid_from date of a pack purchase. Price cannot be changed once billed."""
    valid_from: date = Field(description="New activation date for the pack")


# ---------------------------------------------------------------------------
# Discount Review
# ---------------------------------------------------------------------------

class DiscountReviewRequest(BaseModel):
    """Trigger a discount review for all billed flights."""
    fiscal_year_uuid: UUID
    force_full: bool = Field(
        default=False,
        description="Force a full FIFO recompute instead of the default "
                    "incremental review (which only replays flights never "
                    "reviewed before).",
    )


class DiscountReviewResponse(BaseModel):
    """Result summary of a discount review."""
    members_affected: int = 0
    flights_recalculated: int = 0
    total_discount: Decimal = Decimal("0")
    rem_entries_created: int = 0
    details: list[dict] = []
