"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Schemas for VI type catalog, entitlements, and HelloAsso staging payloads
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


VI_SETTINGS_MODULE = "vi"


class ViTypeCatalogPayload(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool = True
    charge_account_uuid: UUID | None = Field(
        default=None,
        description="Charge account for club-billed flights (overrides settings.default_initiation_charge_account_uuid)",
    )


class ViTypeCatalogResponse(BaseModel):
    uuid: UUID
    code: str
    name: str
    description: str | None = None
    is_active: bool
    # FL billing charge account (D in FL entry for non-analytical flights)
    charge_account_uuid: UUID | None = None
    charge_account_code: str | None = None
    # Accounting configuration
    client_account_uuid: UUID | None = None
    client_account_code: str | None = None
    revenue_account_uuid: UUID | None = None
    revenue_account_code: str | None = None
    insurance_account_uuid: UUID | None = None
    insurance_account_code: str | None = None
    insurance_tiers_uuid: UUID | None = None
    insurance_amount: float | None = None
    max_flights: int = 1
    analytical_cost_account_uuid: UUID | None = None
    analytical_cost_account_code: str | None = None
    analytical_reflection_account_uuid: UUID | None = None
    analytical_reflection_account_code: str | None = None
    created_at: datetime
    updated_at: datetime
    updated_by: int | None = None

    class Config:
        from_attributes = True


class ViEntitlementPayload(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    vi_type_uuid: UUID
    description: str | None = None
    amount_ttc: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    validity_date: date | None = None
    scheduled_date: date | None = None
    realisation_date: date | None = None
    partner_code: str | None = Field(default=None, max_length=64)
    origin_type: int = Field(default=4, ge=1, le=5)
    origin_ref: str | None = Field(default=None, max_length=128)
    notes: str | None = None
    status: int = Field(default=1, ge=1, le=5)
    is_generic: bool = False


class ViEntitlementResponse(BaseModel):
    uuid: UUID
    code: str
    vi_type_uuid: UUID
    vi_type_code: str | None = None
    description: str | None = None
    validity_date: date | None = None
    scheduled_date: date | None = None
    realisation_date: date | None = None
    partner_code: str | None = None
    origin_type: int
    origin_ref: str | None = None
    notes: str | None = None
    status: int
    is_generic: bool = False
    amount_ttc: Decimal | None = None
    buyer_member_uuid: UUID | None = None
    registered_member_uuid: UUID | None = None
    purchase_entry_uuid: UUID | None = None
    realization_entry_uuid: UUID | None = None
    conversion_entry_uuid: UUID | None = None
    flight_link_count: int = 0
    created_at: datetime
    updated_at: datetime
    updated_by: int | None = None

    class Config:
        from_attributes = True


class HelloAssoViStagingResponse(BaseModel):
    uuid: UUID
    item_id: int
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    amount_cents: int | None = None
    form_slug: str | None = None
    purchased_at: datetime | None = None
    promoted_vi_uuid: UUID | None = None
    promoted_at: datetime | None = None
    status: int
    raw_payload: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ViTypeCatalogUpdateRequest(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    charge_account_uuid: UUID | None = None
    # Accounting configuration — None means "not provided" (skip); use model_fields_set to detect explicit null
    client_account_uuid: UUID | None = None
    revenue_account_uuid: UUID | None = None
    insurance_account_uuid: UUID | None = None
    insurance_tiers_uuid: UUID | None = None
    insurance_amount: float | None = None
    max_flights: int | None = Field(default=None, ge=1, le=99)
    analytical_cost_account_uuid: UUID | None = None
    analytical_reflection_account_uuid: UUID | None = None


class ViEntitlementUpdateRequest(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    vi_type_uuid: UUID | None = None
    description: str | None = None
    amount_ttc: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    validity_date: date | None = None
    scheduled_date: date | None = None
    realisation_date: date | None = None
    partner_code: str | None = Field(default=None, max_length=64)
    origin_type: int | None = Field(default=None, ge=1, le=5)
    origin_ref: str | None = Field(default=None, max_length=128)
    notes: str | None = None
    status: int | None = Field(default=None, ge=1, le=5)
    is_generic: bool | None = None


class ViPurchaseEntryRequest(BaseModel):
    fiscal_year_uuid: UUID
    bank_account_uuid: UUID
    entry_date: date | None = None
    amount_ttc: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    notes: str | None = None


class ViReimbursementEntryRequest(BaseModel):
    fiscal_year_uuid: UUID
    bank_account_uuid: UUID
    amount_ttc: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    notes: str | None = None


class ViPlanningDatePatchRequest(BaseModel):
    value: date | None = None


class ViNotesPatchRequest(BaseModel):
    notes: str | None = None


class ViBulkScheduleRequest(BaseModel):
    entitlement_uuids: list[UUID] = Field(default_factory=list)
    scheduled_date: date | None = None


class ViHelloAssoImportRequest(BaseModel):
    status: str = Field(default="active")
    source: str = Field(default="items")
    campaign_type: str | None = None
    page_size: int = Field(default=100, ge=1, le=500)
    purchased_from_year: int = Field(default=2025, ge=2000, le=2100)


class ViHelloAssoImportPreviewResponse(BaseModel):
    fetched_count: int
    net_new_count: int
    already_staged_count: int


class ViHelloAssoImportResponse(BaseModel):
    fetched_count: int
    created_count: int
    duplicate_count: int
    staging_total_count: int


class ViPromotionRequest(BaseModel):
    staging_uuids: list[UUID] = Field(default_factory=list)
    vi_type_uuid: UUID | None = None


class ViPromotionResponse(BaseModel):
    selected_count: int
    promoted_count: int
    already_promoted_count: int
    failed_count: int
    promoted_entitlement_uuids: list[UUID] = Field(default_factory=list)


# ── VI Flight Link schemas ─────────────────────────────────────────────────

class ViFlightLinkCreate(BaseModel):
    flight_uuid: UUID


class ViFlightLinkResponse(BaseModel):
    uuid: UUID
    entitlement_uuid: UUID
    flight_uuid: Optional[UUID] = None
    sequence: int
    analytical_entry_uuid: Optional[UUID] = None
    analytical_state: Optional[int] = None   # 1=Draft 2=Posted 3=Cancelled
    notes: Optional[str] = None
    # Denormalized from ValidatedFlight
    flight_date: Optional[date] = None
    aircraft_code: Optional[str] = None      # asset_code (registration)
    duration_minutes: Optional[int] = None   # computed from takeoff/landing HH:MM

    class Config:
        from_attributes = True


# ── VI Accounting schemas ──────────────────────────────────────────────────

class ViEntitlementAmountPatch(BaseModel):
    amount_ttc: Optional[Decimal] = None
    buyer_member_uuid: Optional[UUID] = None


class ViRealizationEntryRequest(BaseModel):
    fiscal_year_uuid: UUID
    entry_date: Optional[date] = None


class ViCancelRealizationRequest(BaseModel):
    fiscal_year_uuid: UUID


class ViConversionEntryRequest(BaseModel):
    fiscal_year_uuid: UUID
    registered_member_uuid: UUID


class ViAccountingEntryRef(BaseModel):
    entry_uuid: Optional[UUID] = None
    state: Optional[int] = None      # 1=Draft 2=Posted 3=Cancelled
    amount: Optional[Decimal] = None
    entry_date: Optional[date] = None


class ViAccountingSummaryResponse(BaseModel):
    entitlement_uuid: UUID
    entitlement_code: str
    vi_type_code: Optional[str]
    amount_ttc: Optional[Decimal]
    insurance_amount: Optional[Decimal]   # from vi_type
    flight_portion: Optional[Decimal]     # amount_ttc - insurance_amount
    buyer_member_uuid: Optional[UUID]
    buyer_member_name: Optional[str]
    registered_member_uuid: Optional[UUID] = None
    registered_member_name: Optional[str] = None
    is_generic: bool = False
    max_flights: int = 1
    flight_links: list[ViFlightLinkResponse] = Field(default_factory=list)
    realization: ViAccountingEntryRef
    conversion: ViAccountingEntryRef = Field(default_factory=ViAccountingEntryRef)

    class Config:
        from_attributes = True

