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

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


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

    # Club billing
    default_club_contra_account_uuid: Optional[UUID] = None

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

    # Club billing
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


