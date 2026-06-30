"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - hr: Pydantic schemas for the HR module (employee profiles, working time calendars)
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

"""Pydantic schemas for the HR module."""

from datetime import date, datetime, time
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Employee profiles (unchanged)
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
    member_first_name: Optional[str] = None
    member_last_name: Optional[str] = None
    member_account_id: Optional[str] = None
    member_trigram: Optional[str] = None


# ---------------------------------------------------------------------------
# Working time calendars — phase day rules
# ---------------------------------------------------------------------------

class HrPhaseDayRuleInput(BaseModel):
    day_of_week: int = Field(..., ge=1, le=7)
    is_working: bool = True
    expected_hours: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    apply_on_week: int = Field(default=0, ge=0, le=5)


class HrPhaseDayRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    day_of_week: int
    is_working: bool
    expected_hours: Decimal
    start_time: Optional[time]
    end_time: Optional[time]
    apply_on_week: int


# ---------------------------------------------------------------------------
# Working time calendars — phases
# ---------------------------------------------------------------------------

class HrCalendarPhaseCreate(BaseModel):
    name: str = Field(..., max_length=100)
    start_month: int = Field(..., ge=1, le=12)
    start_day: int = Field(..., ge=1, le=31)
    end_month: int = Field(..., ge=1, le=12)
    end_day: int = Field(..., ge=1, le=31)
    day_rules: list[HrPhaseDayRuleInput] = []


class HrCalendarPhaseUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    start_month: Optional[int] = Field(default=None, ge=1, le=12)
    start_day: Optional[int] = Field(default=None, ge=1, le=31)
    end_month: Optional[int] = Field(default=None, ge=1, le=12)
    end_day: Optional[int] = Field(default=None, ge=1, le=31)
    day_rules: Optional[list[HrPhaseDayRuleInput]] = None


class HrCalendarPhaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    calendar_uuid: UUID
    name: str
    start_month: int
    start_day: int
    end_month: int
    end_day: int
    day_rules: list[HrPhaseDayRuleResponse]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Working time calendars — top level
# ---------------------------------------------------------------------------

class HrWorkingTimeCalendarCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None


class HrWorkingTimeCalendarUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None


class HrWorkingTimeCalendarResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    name: str
    description: Optional[str]
    phases: list[HrCalendarPhaseResponse]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Employee calendar assignments
# ---------------------------------------------------------------------------

class HrEmployeeCalendarAssignmentCreate(BaseModel):
    member_uuid: UUID
    calendar_uuid: UUID
    effective_from: date
    effective_to: Optional[date] = None


class HrEmployeeCalendarAssignmentUpdate(BaseModel):
    calendar_uuid: Optional[UUID] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class HrEmployeeCalendarAssignmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    member_uuid: UUID
    calendar_uuid: UUID
    effective_from: date
    effective_to: Optional[date]
    created_at: datetime
    updated_at: datetime
    member_first_name: Optional[str] = None
    member_last_name: Optional[str] = None
    member_account_id: Optional[str] = None
    calendar_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Calendar resolution
# ---------------------------------------------------------------------------

class ExpectedHoursResult(BaseModel):
    date: date
    is_working: bool
    expected_hours: Decimal
    phase_uuid: Optional[UUID] = None
    phase_name: Optional[str] = None
    calendar_name: Optional[str] = None


class WorkSummaryResponse(BaseModel):
    member_uuid: UUID
    start_date: date
    end_date: date
    total_expected_hours: Decimal
    worked_days: int
    days: list[ExpectedHoursResult]
