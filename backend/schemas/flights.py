"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - flights: Pydantic schemas for flight data and Planche flight fetch
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


class FlightFetchRequest(BaseModel):
    from_date: Optional[datetime] = None
    to_date: Optional[datetime] = None
    cursor: Optional[str] = None
    limit: int = Field(default=500, ge=1, le=5000)


class FlightFetchResponse(BaseModel):
    total: int
    created: int
    updated: int
    skipped: int
    idempotent: int = 0
    snapshots_created: int = 0
    modified_after_transfer: int = 0
    next_cursor: Optional[str] = None
    has_more: bool = False
    error_details: list[str] = Field(default_factory=list)
    failed_count: int = 0
    missing_required_field_count: int = 0
    constraint_violation_count: int = 0


class ValidatedFlightItem(BaseModel):
    """Lightweight validated flight row for the paginated listing."""

    uuid: str
    jour: str | None = None
    type_of_flight: int | None = None
    pilot_erp_id: str | None = None
    second_pilot_erp_id: str | None = None
    takeoff_time: str | None = None
    landing_time: str | None = None
    launch_method: int | None = None
    launch_asset_code: str | None = None
    launch_pilot_trigram: str | None = None
    charge_to_erp_id: str | None = None
    charge_comment: str | None = None
    asset_code: str | None = None
    glider_erp_id: str | None = None
    launch_machine_erp_id: str | None = None
    instruction_split: int | None = None
    aero: str | None = None
    pilot_name: str | None = None
    second_pilot_name: str | None = None
    second_pilot_trigram: str | None = None
    observations: str | None = None
    correction_reason: str | None = None
    vi_erp_id: str | None = None
    vi_linked: bool = False

    class Config:
        from_attributes = True


class ValidatedFlightListResponse(BaseModel):
    items: list[ValidatedFlightItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0
    error_details: list[str] = Field(default_factory=list)


class FlightBillingFieldsUpdate(BaseModel):
    """Update billable fields on a validated flight."""
    charge_to_erp_id: str | None = None
    charge_comment: str | None = None


class FlightStatsResponse(BaseModel):
    """Aggregated KPIs for the flight operations dashboard."""

    total_flights: int = 0
    by_status: dict[str, int] = Field(default_factory=lambda: {"validated": 0, "transferred": 0, "modified": 0})
    by_type: dict[str, int] = Field(default_factory=dict)
    by_launch_method: dict[str, int] = Field(default_factory=dict)
    unbilled_count: int = 0
    instruction_split_count: int = 0
    modified_after_transfer_count: int = 0
    last_fetch_at: str | None = None
    cursor: str | None = None
    pending_planche_count: int | None = None


class FlightBillingPreviewRequest(BaseModel):
    """Filters for calculating billing previews without applying accounting."""

    date_from: Optional[date] = None
    date_to: Optional[date] = None
    flight_uuids: list[str] = Field(default_factory=list)
    include_already_billed: bool = False


class FlightBillingError(BaseModel):
    code: str
    message: str
    scope: str = "flight"
    blocking: bool = True


class FlightBillingPayerPreview(BaseModel):
    member_uuid: str | None = None
    member_account_id: str | None = None
    member_name: str | None = None
    role: str
    share: Decimal
    reason: str


class FlightBillingAppliedLinePreview(BaseModel):
    source: str
    payer_member_uuid: str | None = None
    payer_member_account_id: str | None = None
    payer_role: str
    pricing_version_uuid: str | None = None
    pricing_item_uuid: str | None = None
    pricing_item_name: str | None = None
    asset_uuid: str | None = None
    asset_code: str | None = None
    quantity: Decimal
    unit: int | None = None  # PricingItem.unit: 1=flight_hours, 2=engine_min, 3=engine_1/100h, 4=duration, 5=per_flight, 6=fixed, 7=tranche
    normal_unit_price: Decimal
    applied_unit_price: Decimal
    discount_reason: str | None = None
    amount: Decimal
    debit_account_uuid: str | None = None
    debit_account_code: str | None = None
    credit_account_uuid: str | None = None
    credit_account_code: str | None = None
    pack_hours_before: Decimal | None = None
    pack_hours_used: Decimal = Decimal("0")
    pack_hours_after: Decimal | None = None


class FlightAccountingLinePreview(BaseModel):
    side: str
    account_uuid: str | None = None
    account_code: str | None = None
    tiers_uuid: str | None = None
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    description: str | None = None


class FlightBillingPreviewResponse(BaseModel):
    flight_uuid: str
    planche_uuid: str | None = None
    flight_date: date | None = None
    type_of_flight: int | None = None
    type_label: str | None = None
    total_amount: Decimal = Decimal("0")
    billing_hash: str | None = None
    payers: list[FlightBillingPayerPreview] = Field(default_factory=list)
    applied_lines: list[FlightBillingAppliedLinePreview] = Field(default_factory=list)
    accounting_lines: list[FlightAccountingLinePreview] = Field(default_factory=list)
    errors: list[FlightBillingError] = Field(default_factory=list)
    warnings: list[FlightBillingError] = Field(default_factory=list)
    can_apply: bool = False
    no_bill: bool = False


class FlightBillingBatchPreviewResponse(BaseModel):
    items: list[FlightBillingPreviewResponse] = Field(default_factory=list)
    total: int = 0
    billable_count: int = 0
    error_count: int = 0
    total_amount: Decimal = Decimal("0")


class FlightBillingPostRequest(BaseModel):
    """Request to apply/post billing for a single flight (uuid from path)."""

    fiscal_year_uuid: str


class FlightBillingApplyRequest(BaseModel):
    """Request to apply billing for multiple flights."""

    flight_uuids: list[str] = Field(..., min_length=1)
    fiscal_year_uuid: str


class FlightBillingApplyItem(BaseModel):
    """Result of applying billing for a single flight."""

    flight_uuid: str
    entry_uuid: str
    entry_state: int  # 1 = Draft, 2 = Posted
    reference: str
    description: str
    errors: list[str] = Field(default_factory=list)


class FlightBillingApplyResponse(BaseModel):
    """Result of applying billing for one flight."""

    entry_uuid: str
    reference: str
    description: str
    state: int  # 1 = Draft


class FlightBillingBatchApplyResponse(BaseModel):
    """Result of applying billing for multiple flights."""

    items: list[FlightBillingApplyItem] = Field(default_factory=list)
    total: int = 0
    success_count: int = 0
    error_count: int = 0
