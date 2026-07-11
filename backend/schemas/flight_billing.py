"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - flight_billing: Pydantic schemas for flight billing settings
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
# REM Adjustment
# ---------------------------------------------------------------------------

class RemAdjustmentPreviewRequest(BaseModel):
    """Preview REM adjustment for a member/period."""
    member_uuid: UUID
    fiscal_year_uuid: UUID
    period_start: date
    period_end: date


class RemAdjustmentLine(BaseModel):
    """One consumption line in a REM adjustment preview."""
    consumption_uuid: UUID
    flight_uuid: UUID
    flight_date: date | None = None
    pack_type: str
    quantity_consumed: Decimal
    discount_unit_price: Decimal
    total_discount_amount: Decimal
    is_frozen: bool = False


class RemAdjustmentPreviewResponse(BaseModel):
    """Preview of a REM adjustment for a member/period."""
    member_uuid: UUID
    fiscal_year_uuid: UUID
    period_start: date
    period_end: date
    total_discount: Decimal = Decimal("0")
    consumptions: list[RemAdjustmentLine] = []
    has_existing_draft: bool = False
    existing_draft_entry_uuid: UUID | None = None


class RemAdjustmentApplyRequest(BaseModel):
    """Create or update a REM Draft entry for a member/period."""
    member_uuid: UUID
    fiscal_year_uuid: UUID
    period_start: date
    period_end: date


class RemAdjustmentApplyResponse(BaseModel):
    """Result of applying a REM adjustment."""
    entry_uuid: UUID
    reference: str
    description: str
    state: int = 1  # Draft
    total_discount: Decimal = Decimal("0")


class CloseRemPeriodRequest(BaseModel):
    """Close a REM period — post all Drafts, open new ones."""
    fiscal_year_uuid: UUID
    period_end: date


class CloseRemPeriodResponse(BaseModel):
    """Result of closing a REM period."""
    posted_count: int = 0
    total_discount: Decimal = Decimal("0")
    entries: list[dict] = []


class FlightBillingSettingsResponse(BaseModel):
    """Flight billing settings for a fiscal year — typed, not a JSON blob."""

    id: int
    fiscal_year_uuid: UUID

    # Journal–account pairs
    fl_journal_uuid: UUID
    receivable_account_uuid: UUID
    vt_journal_uuid: UUID
    default_pack_sales_account_uuid: Optional[UUID] = None
    rem_journal_uuid: UUID
    default_pack_discount_expense_account_uuid: Optional[UUID] = None

    # Initiation fallback (club/entrainement/essai accounts live on flight_type_billing_accounts)
    default_initiation_charge_account_uuid: Optional[UUID] = None

    # Operational settings
    rem_period_days: int = 30
    allow_post_purchase_recalculation: bool = True
    max_days_for_post_purchase_discount: Optional[int] = 30
    require_approval_for_late_discount: bool = True

    # Metadata
    created_at: datetime
    updated_at: datetime
    updated_by: Optional[int] = None

    class Config:
        from_attributes = True


class FlightBillingSettingsUpdate(BaseModel):
    """Update/create payload for flight billing settings."""

    fiscal_year_uuid: UUID

    # Journal–account pairs (all required)
    fl_journal_uuid: UUID
    receivable_account_uuid: UUID
    vt_journal_uuid: UUID
    default_pack_sales_account_uuid: Optional[UUID] = None
    rem_journal_uuid: UUID
    default_pack_discount_expense_account_uuid: Optional[UUID] = None

    # Initiation fallback (club/entrainement/essai accounts live on flight_type_billing_accounts)
    default_initiation_charge_account_uuid: Optional[UUID] = None

    # Operational settings
    rem_period_days: int = Field(default=30, ge=1)
    allow_post_purchase_recalculation: bool = True
    max_days_for_post_purchase_discount: Optional[int] = Field(default=30, ge=1)
    require_approval_for_late_discount: bool = True


class FlightBillingSettingsDefaults(BaseModel):
    """Sensible defaults for a new fiscal year (UI pre-fill)."""

    fiscal_year_uuid: UUID
    fl_journal_uuid: Optional[UUID] = None
    receivable_account_uuid: Optional[UUID] = None
    vt_journal_uuid: Optional[UUID] = None
    default_pack_sales_account_uuid: Optional[UUID] = None
    rem_journal_uuid: Optional[UUID] = None
    default_pack_discount_expense_account_uuid: Optional[UUID] = None
    default_initiation_charge_account_uuid: Optional[UUID] = None

    rem_period_days: int = 30
    allow_post_purchase_recalculation: bool = True
    max_days_for_post_purchase_discount: int = 30
    require_approval_for_late_discount: bool = True


# ---------------------------------------------------------------------------
# Flight type billing accounts (club/entrainement/essai analytical override)
# ---------------------------------------------------------------------------

class FlightTypeBillingAccountUpsert(BaseModel):
    """One self-contained row to create/update. billing_category: 1=club, 2=entrainement, 3=essai."""

    billing_category: int = Field(ge=1, le=3)
    member_uuid: Optional[UUID] = None
    analytical_cost_account_uuid: Optional[UUID] = None
    analytical_reflection_account_uuid: Optional[UUID] = None


class FlightTypeBillingAccountResponse(BaseModel):
    """Flight-type billing account row, hydrated with account codes for display."""

    uuid: UUID
    fiscal_year_uuid: UUID
    billing_category: int
    billing_category_label: Optional[str] = None
    member_uuid: Optional[UUID] = None
    analytical_cost_account_uuid: Optional[UUID] = None
    analytical_cost_account_code: Optional[str] = None
    analytical_reflection_account_uuid: Optional[UUID] = None
    analytical_reflection_account_code: Optional[str] = None

    class Config:
        from_attributes = True


class FlightTypeBillingAccountsBulkUpsert(BaseModel):
    """Replace the set of flight-type billing account rows for a fiscal year."""

    fiscal_year_uuid: UUID
    accounts: list[FlightTypeBillingAccountUpsert] = []


