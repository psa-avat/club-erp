"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - member_portal: Pydantic schemas for member self-service portal
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

from pydantic import BaseModel, Field


# ── Authentication ────────────────────────────────────────────────────────────

class MemberPortalLoginRequest(BaseModel):
    member_identifier: str = Field(..., description="Member account_id or UUID")
    password: str = Field(..., min_length=1)


class MemberPortalLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str
    member: "MemberPortalProfile"


class MemberPortalChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=1)


class MemberPortalProfile(BaseModel):
    uuid: str
    account_id: str
    first_name: str
    last_name: str
    email: str | None = None
    member_category: int


# ── Flights ────────────────────────────────────────────────────────────────────

class MemberPortalFlightItem(BaseModel):
    uuid: str
    jour: date | None = None
    type_of_flight: int | None = None
    type_label: str | None = None
    asset_code: str | None = None
    pilot_erp_id: str | None = None
    launch_method: int | None = None
    launch_asset_code: str | None = None
    takeoff_time: str | None = None
    landing_time: str | None = None
    billing_quote_state: str | None = None
    has_discount: bool = False
    total_amount: Decimal = Decimal("0")


class MemberPortalFlightListResponse(BaseModel):
    items: list[MemberPortalFlightItem] = Field(default_factory=list)
    total: int = 0


class MemberPortalBillingLine(BaseModel):
    source: str
    asset_code: str | None = None
    pricing_item_name: str | None = None
    quantity: Decimal
    applied_unit_price: Decimal
    amount: Decimal
    discount_reason: str | None = None


class MemberPortalConsumption(BaseModel):
    pack_type: str
    quantity_consumed: Decimal
    discount_unit_price: Decimal
    total_discount_amount: Decimal
    valid_from: datetime | None = None


class MemberPortalFlightBillingDetail(BaseModel):
    flight_uuid: str
    total_gross: Decimal = Decimal("0")
    total_discount: Decimal = Decimal("0")
    net_amount: Decimal = Decimal("0")
    billing_hash: str | None = None
    applied_lines: list[MemberPortalBillingLine] = Field(default_factory=list)
    consumptions: list[MemberPortalConsumption] = Field(default_factory=list)
    entry_state: int | None = None  # 1=Draft, 2=Posted, None=not billed


# ── Account ────────────────────────────────────────────────────────────────────

class MemberPortalAccountSummary(BaseModel):
    current_balance: Decimal = Decimal("0")  # 411 balance
    pending_entries_count: int = 0
    posted_entries_count: int = 0
    active_packs: list["MemberPortalPackBalance"] = Field(default_factory=list)


class MemberPortalPackBalance(BaseModel):
    pack_type: str
    pack_type_label: str
    total_purchased: Decimal = Decimal("0")
    total_consumed: Decimal = Decimal("0")
    units_remaining: Decimal = Decimal("0")


class MemberPortalAccountEntry(BaseModel):
    uuid: str
    journal_code: str | None = None
    reference: str | None = None
    description: str | None = None
    entry_date: date | None = None
    state: int  # 1=Draft, 2=Posted
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")


class MemberPortalAccountEntriesResponse(BaseModel):
    items: list[MemberPortalAccountEntry] = Field(default_factory=list)
    total: int = 0


# ── Expenses ───────────────────────────────────────────────────────────────────

class MemberPortalExpenseDeclaration(BaseModel):
    amount: Decimal = Field(..., gt=0)
    reason: str = Field(..., min_length=1, max_length=500)
    receipt_photo: str | None = None  # base64 or URL


class MemberPortalExpenseItem(BaseModel):
    uuid: str
    amount: Decimal
    reason: str
    status: str  # pending, approved, rejected
    created_at: datetime | None = None


class MemberPortalExpenseListResponse(BaseModel):
    items: list[MemberPortalExpenseItem] = Field(default_factory=list)
    total: int = 0


# ── Deposits ───────────────────────────────────────────────────────────────────

class MemberPortalDepositRequest(BaseModel):
    amount: Decimal = Field(..., gt=0)
    payment_method: str = Field(default="bank_transfer", pattern=r"^(bank_transfer|check|cash|card)$")


class MemberPortalDepositResponse(BaseModel):
    uuid: str
    amount: Decimal
    status: str  # pending, confirmed
    message: str


# ── Tax Expenses (Volunteer) ───────────────────────────────────────────────────

class MemberPortalTaxExpenseItem(BaseModel):
    mission_date: date | None = None
    description: str | None = None
    declarable_amount: Decimal = Decimal("0")
    status: str | None = None


class MemberPortalTaxExpenseListResponse(BaseModel):
    items: list[MemberPortalTaxExpenseItem] = Field(default_factory=list)
