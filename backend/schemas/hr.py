"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - hr: Pydantic schemas for the HR module (employee profiles, seasons, calendars)
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

"""Pydantic schemas for the HR module (employee profiles, seasons, calendars)."""

from datetime import date, datetime, time
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Employee profiles
# ---------------------------------------------------------------------------

class HrEmployeeProfileCreate(BaseModel):
    member_uuid: UUID
    user_id: Optional[int] = None
    contract_type: str = Field(..., pattern="^(CDI|CDD|SAISONNIER|VACATAIRE|BENEVOLE)$")
    hire_date: date
    termination_date: Optional[date] = None
    weekly_hours: Decimal = Field(default=Decimal("35.00"), ge=0, decimal_places=2)
    annual_work_hours: Decimal = Field(default=Decimal("1607.00"), ge=0, decimal_places=2)
    current_leave_balance: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    last_leave_balance_update: Optional[date] = None
    is_active: bool = True
    notes: Optional[str] = None


class HrEmployeeProfileUpdate(BaseModel):
    user_id: Optional[int] = None
    contract_type: Optional[str] = Field(default=None, pattern="^(CDI|CDD|SAISONNIER|VACATAIRE|BENEVOLE)$")
    hire_date: Optional[date] = None
    termination_date: Optional[date] = None
    weekly_hours: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    annual_work_hours: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    current_leave_balance: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    last_leave_balance_update: Optional[date] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class HrEmployeeProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    member_uuid: UUID
    user_id: Optional[int]
    contract_type: str
    hire_date: date
    termination_date: Optional[date]
    weekly_hours: Decimal
    annual_work_hours: Decimal
    current_leave_balance: Decimal
    last_leave_balance_update: Optional[date]
    is_active: bool
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    # Nested member info for display
    member_first_name: Optional[str] = None
    member_last_name: Optional[str] = None
    member_account_id: Optional[str] = None
    member_trigram: Optional[str] = None


# ---------------------------------------------------------------------------
# Seasons
# ---------------------------------------------------------------------------

class HrSeasonCreate(BaseModel):
    name: str = Field(..., max_length=100)
    start_date: date
    end_date: date
    description: Optional[str] = None


class HrSeasonUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None


class HrSeasonResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    name: str
    start_date: date
    end_date: date
    description: Optional[str]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Work calendars
# ---------------------------------------------------------------------------

class HrWorkCalendarDayCreate(BaseModel):
    day_of_week: int = Field(..., ge=1, le=7)
    is_working: bool = True
    expected_hours: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    apply_on_week: int = Field(default=0, ge=0, le=5)


class HrWorkCalendarDayResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    day_of_week: int
    is_working: bool
    expected_hours: Decimal
    start_time: Optional[time]
    end_time: Optional[time]
    apply_on_week: int


class HrWorkCalendarCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None
    days: list[HrWorkCalendarDayCreate] = []


class HrWorkCalendarUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None
    days: Optional[list[HrWorkCalendarDayCreate]] = None


class HrWorkCalendarResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    name: str
    description: Optional[str]
    days: list[HrWorkCalendarDayResponse]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Calendar assignments
# ---------------------------------------------------------------------------

class HrCalendarAssignmentCreate(BaseModel):
    member_uuid: UUID
    season_uuid: UUID
    calendar_uuid: UUID


class HrCalendarAssignmentUpdate(BaseModel):
    calendar_uuid: UUID


class HrCalendarAssignmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    member_uuid: UUID
    season_uuid: UUID
    calendar_uuid: UUID
    created_at: datetime
    # Nested for display
    member_first_name: Optional[str] = None
    member_last_name: Optional[str] = None
    member_account_id: Optional[str] = None
    season_name: Optional[str] = None
    calendar_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Calendar resolution
# ---------------------------------------------------------------------------

class ExpectedHoursResult(BaseModel):
    date: date
    is_working: bool
    expected_hours: Decimal
    season_uuid: Optional[UUID] = None
    season_name: Optional[str] = None
    calendar_name: Optional[str] = None


class WorkSummaryResponse(BaseModel):
    member_uuid: UUID
    start_date: date
    end_date: date
    total_expected_hours: Decimal
    worked_days: int
    days: list[ExpectedHoursResult]
