"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - hr: FastAPI routes for HR employee profiles, working time calendars, and assignments
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

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_HR
from models import User
from schemas.hr import (
    ExpectedHoursResult,
    HrCalendarPhaseCreate,
    HrCalendarPhaseResponse,
    HrCalendarPhaseUpdate,
    HrEmployeeCalendarAssignmentCreate,
    HrEmployeeCalendarAssignmentResponse,
    HrEmployeeCalendarAssignmentUpdate,
    HrEmployeeProfileCreate,
    HrEmployeeProfileResponse,
    HrEmployeeProfileUpdate,
    HrWorkingTimeCalendarCreate,
    HrWorkingTimeCalendarResponse,
    HrWorkingTimeCalendarUpdate,
    WorkSummaryResponse,
)
from services.hr import (
    compute_expected_hours,
    create_assignment,
    create_calendar,
    create_employee_profile,
    create_phase,
    delete_assignment,
    delete_calendar,
    delete_phase,
    get_assignment,
    get_calendar,
    get_employee_profile,
    get_phase,
    get_work_summary,
    list_assignments,
    list_calendars,
    list_employee_profiles,
    update_assignment,
    update_calendar,
    update_employee_profile,
    update_phase,
)

router = APIRouter(prefix="/api/v1/hr", tags=["hr"])

_manage_guard = Depends(require_capability(CAP_MANAGE_HR))


# ---------------------------------------------------------------------------
# Employee profiles
# ---------------------------------------------------------------------------

@router.get("/profiles", response_model=list[HrEmployeeProfileResponse])
async def list_profiles_endpoint(
    active_only: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await list_employee_profiles(db, active_only=active_only)


@router.post("/profiles", response_model=HrEmployeeProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_profile_endpoint(
    data: HrEmployeeProfileCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = _manage_guard,
):
    result = await create_employee_profile(db, data, current_user.id)
    await db.commit()
    return result


@router.get("/profiles/{member_uuid}", response_model=HrEmployeeProfileResponse)
async def get_profile_endpoint(
    member_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await get_employee_profile(db, member_uuid)


@router.patch("/profiles/{member_uuid}", response_model=HrEmployeeProfileResponse)
async def update_profile_endpoint(
    member_uuid: UUID,
    data: HrEmployeeProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = _manage_guard,
):
    result = await update_employee_profile(db, member_uuid, data, current_user.id)
    await db.commit()
    return result


# ---------------------------------------------------------------------------
# Working time calendars
# ---------------------------------------------------------------------------

@router.get("/calendars", response_model=list[HrWorkingTimeCalendarResponse])
async def list_calendars_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await list_calendars(db)


@router.post("/calendars", response_model=HrWorkingTimeCalendarResponse, status_code=status.HTTP_201_CREATED)
async def create_calendar_endpoint(
    data: HrWorkingTimeCalendarCreate,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    result = await create_calendar(db, data)
    await db.commit()
    return result


@router.get("/calendars/{calendar_uuid}", response_model=HrWorkingTimeCalendarResponse)
async def get_calendar_endpoint(
    calendar_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await get_calendar(db, calendar_uuid)


@router.patch("/calendars/{calendar_uuid}", response_model=HrWorkingTimeCalendarResponse)
async def update_calendar_endpoint(
    calendar_uuid: UUID,
    data: HrWorkingTimeCalendarUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    result = await update_calendar(db, calendar_uuid, data)
    await db.commit()
    return result


@router.delete("/calendars/{calendar_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_calendar_endpoint(
    calendar_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    await delete_calendar(db, calendar_uuid)
    await db.commit()


# ---------------------------------------------------------------------------
# Phases (nested under a calendar)
# ---------------------------------------------------------------------------

@router.get("/calendars/{calendar_uuid}/phases/{phase_uuid}", response_model=HrCalendarPhaseResponse)
async def get_phase_endpoint(
    calendar_uuid: UUID,
    phase_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await get_phase(db, phase_uuid)


@router.post(
    "/calendars/{calendar_uuid}/phases",
    response_model=HrCalendarPhaseResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_phase_endpoint(
    calendar_uuid: UUID,
    data: HrCalendarPhaseCreate,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    result = await create_phase(db, calendar_uuid, data)
    await db.commit()
    return result


@router.patch(
    "/calendars/{calendar_uuid}/phases/{phase_uuid}",
    response_model=HrCalendarPhaseResponse,
)
async def update_phase_endpoint(
    calendar_uuid: UUID,
    phase_uuid: UUID,
    data: HrCalendarPhaseUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    result = await update_phase(db, calendar_uuid, phase_uuid, data)
    await db.commit()
    return result


@router.delete(
    "/calendars/{calendar_uuid}/phases/{phase_uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_phase_endpoint(
    calendar_uuid: UUID,
    phase_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    await delete_phase(db, calendar_uuid, phase_uuid)
    await db.commit()


# ---------------------------------------------------------------------------
# Employee calendar assignments
# ---------------------------------------------------------------------------

@router.get("/calendar-assignments", response_model=list[HrEmployeeCalendarAssignmentResponse])
async def list_assignments_endpoint(
    member_uuid: Optional[UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await list_assignments(db, member_uuid=member_uuid)


@router.post(
    "/calendar-assignments",
    response_model=HrEmployeeCalendarAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_assignment_endpoint(
    data: HrEmployeeCalendarAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    result = await create_assignment(db, data)
    await db.commit()
    return result


@router.patch(
    "/calendar-assignments/{assignment_uuid}",
    response_model=HrEmployeeCalendarAssignmentResponse,
)
async def update_assignment_endpoint(
    assignment_uuid: UUID,
    data: HrEmployeeCalendarAssignmentUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    result = await update_assignment(db, assignment_uuid, data)
    await db.commit()
    return result


@router.delete("/calendar-assignments/{assignment_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment_endpoint(
    assignment_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    await delete_assignment(db, assignment_uuid)
    await db.commit()


# ---------------------------------------------------------------------------
# Calendar resolution
# ---------------------------------------------------------------------------

@router.get("/calendar/expected-hours", response_model=ExpectedHoursResult)
async def expected_hours_endpoint(
    member_uuid: UUID = Query(...),
    date: date = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await compute_expected_hours(db, member_uuid, date)


@router.get("/calendar/work-summary", response_model=WorkSummaryResponse)
async def work_summary_endpoint(
    member_uuid: UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if (end_date - start_date).days > 366:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La plage de dates ne peut pas dépasser 366 jours.",
        )
    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date de fin doit être postérieure ou égale à la date de début.",
        )
    return await get_work_summary(db, member_uuid, start_date, end_date)
