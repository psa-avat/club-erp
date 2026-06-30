"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - hr: Business logic for the HR module — employee profiles, seasons, work calendars
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

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    HrCalendarAssignment,
    HrEmployeeProfile,
    HrSeason,
    HrWorkCalendar,
    HrWorkCalendarDay,
    Member,
)
from schemas.hr import (
    ExpectedHoursResult,
    HrCalendarAssignmentCreate,
    HrCalendarAssignmentResponse,
    HrCalendarAssignmentUpdate,
    HrEmployeeProfileCreate,
    HrEmployeeProfileResponse,
    HrEmployeeProfileUpdate,
    HrSeasonCreate,
    HrSeasonResponse,
    HrSeasonUpdate,
    HrWorkCalendarCreate,
    HrWorkCalendarResponse,
    HrWorkCalendarUpdate,
    WorkSummaryResponse,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_profile_response(profile: HrEmployeeProfile) -> HrEmployeeProfileResponse:
    return HrEmployeeProfileResponse(
        member_uuid=profile.member_uuid,
        user_id=profile.user_id,
        contract_type=profile.contract_type,
        hire_date=profile.hire_date,
        termination_date=profile.termination_date,
        weekly_hours=profile.weekly_hours,
        annual_work_hours=profile.annual_work_hours,
        current_leave_balance=profile.current_leave_balance,
        last_leave_balance_update=profile.last_leave_balance_update,
        is_active=profile.is_active,
        notes=profile.notes,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
        member_first_name=profile.member.first_name if profile.member else None,
        member_last_name=profile.member.last_name if profile.member else None,
        member_account_id=profile.member.account_id if profile.member else None,
        member_trigram=profile.member.trigram if profile.member else None,
    )


def _build_assignment_response(assignment: HrCalendarAssignment) -> HrCalendarAssignmentResponse:
    return HrCalendarAssignmentResponse(
        uuid=assignment.uuid,
        member_uuid=assignment.member_uuid,
        season_uuid=assignment.season_uuid,
        calendar_uuid=assignment.calendar_uuid,
        created_at=assignment.created_at,
        member_first_name=assignment.member.first_name if assignment.member else None,
        member_last_name=assignment.member.last_name if assignment.member else None,
        member_account_id=assignment.member.account_id if assignment.member else None,
        season_name=assignment.season.name if assignment.season else None,
        calendar_name=assignment.calendar.name if assignment.calendar else None,
    )


def _week_of_month(d: date) -> int:
    """Return 1..5 — which occurrence of this weekday in the month (5 = last)."""
    week_num = (d.day - 1) // 7 + 1
    # Find last day of month
    if d.month == 12:
        last_day = date(d.year + 1, 1, 1) - timedelta(days=1)
    else:
        last_day = date(d.year, d.month + 1, 1) - timedelta(days=1)
    max_weeks = (last_day.day - 1) // 7 + 1
    return 5 if week_num >= max_weeks else week_num


# ---------------------------------------------------------------------------
# Employee profiles
# ---------------------------------------------------------------------------

async def list_employee_profiles(
    db: AsyncSession,
    active_only: bool = True,
) -> list[HrEmployeeProfileResponse]:
    stmt = select(HrEmployeeProfile).options(selectinload(HrEmployeeProfile.member))
    if active_only:
        stmt = stmt.where(HrEmployeeProfile.is_active == True)  # noqa: E712
    stmt = stmt.order_by(HrEmployeeProfile.member_uuid)
    result = await db.execute(stmt)
    profiles = result.scalars().all()
    return [_build_profile_response(p) for p in profiles]


async def get_employee_profile(
    db: AsyncSession,
    member_uuid: UUID,
) -> HrEmployeeProfileResponse:
    stmt = (
        select(HrEmployeeProfile)
        .where(HrEmployeeProfile.member_uuid == member_uuid)
        .options(selectinload(HrEmployeeProfile.member))
    )
    result = await db.execute(stmt)
    profile = result.scalars().first()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profil employé introuvable.")
    return _build_profile_response(profile)


async def create_employee_profile(
    db: AsyncSession,
    data: HrEmployeeProfileCreate,
    created_by_user_id: int,
) -> HrEmployeeProfileResponse:
    # Verify member exists
    member_result = await db.execute(select(Member).where(Member.uuid == data.member_uuid))
    member = member_result.scalars().first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membre introuvable.")
    if not member.is_employee:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ce membre n'est pas marqué comme employé (is_employee=False).",
        )

    # Check for duplicate
    existing = await db.execute(
        select(HrEmployeeProfile).where(HrEmployeeProfile.member_uuid == data.member_uuid)
    )
    if existing.scalars().first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Un profil employé existe déjà pour ce membre.")

    # Validate dates
    if data.termination_date and data.termination_date < data.hire_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date de fin ne peut pas être antérieure à la date d'embauche.",
        )

    profile = HrEmployeeProfile(
        member_uuid=data.member_uuid,
        user_id=data.user_id,
        contract_type=data.contract_type,
        hire_date=data.hire_date,
        termination_date=data.termination_date,
        weekly_hours=data.weekly_hours,
        annual_work_hours=data.annual_work_hours,
        current_leave_balance=data.current_leave_balance,
        last_leave_balance_update=data.last_leave_balance_update,
        is_active=data.is_active,
        notes=data.notes,
        updated_by=created_by_user_id,
    )
    db.add(profile)
    await db.flush()
    await db.refresh(profile, ["member"])
    return _build_profile_response(profile)


async def update_employee_profile(
    db: AsyncSession,
    member_uuid: UUID,
    data: HrEmployeeProfileUpdate,
    updated_by_user_id: int,
) -> HrEmployeeProfileResponse:
    stmt = (
        select(HrEmployeeProfile)
        .where(HrEmployeeProfile.member_uuid == member_uuid)
        .options(selectinload(HrEmployeeProfile.member))
    )
    result = await db.execute(stmt)
    profile = result.scalars().first()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profil employé introuvable.")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(profile, field, value)
    profile.updated_by = updated_by_user_id
    profile.updated_at = datetime.now(timezone.utc)

    # Validate dates after update
    effective_hire = profile.hire_date
    effective_term = profile.termination_date
    if effective_term and effective_term < effective_hire:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date de fin ne peut pas être antérieure à la date d'embauche.",
        )

    await db.flush()
    return _build_profile_response(profile)


# ---------------------------------------------------------------------------
# Seasons
# ---------------------------------------------------------------------------

async def list_seasons(db: AsyncSession) -> list[HrSeasonResponse]:
    stmt = select(HrSeason).order_by(HrSeason.start_date.desc())
    result = await db.execute(stmt)
    seasons = result.scalars().all()
    return [HrSeasonResponse.model_validate(s) for s in seasons]


async def get_season(db: AsyncSession, season_uuid: UUID) -> HrSeasonResponse:
    result = await db.execute(select(HrSeason).where(HrSeason.uuid == season_uuid))
    season = result.scalars().first()
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saison introuvable.")
    return HrSeasonResponse.model_validate(season)


async def create_season(db: AsyncSession, data: HrSeasonCreate) -> HrSeasonResponse:
    if data.end_date < data.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date de fin doit être postérieure ou égale à la date de début.",
        )
    season = HrSeason(
        name=data.name,
        start_date=data.start_date,
        end_date=data.end_date,
        description=data.description,
    )
    db.add(season)
    await db.flush()
    await db.refresh(season)
    return HrSeasonResponse.model_validate(season)


async def update_season(
    db: AsyncSession,
    season_uuid: UUID,
    data: HrSeasonUpdate,
) -> HrSeasonResponse:
    result = await db.execute(select(HrSeason).where(HrSeason.uuid == season_uuid))
    season = result.scalars().first()
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saison introuvable.")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(season, field, value)
    season.updated_at = datetime.now(timezone.utc)

    effective_start = season.start_date
    effective_end = season.end_date
    if effective_end < effective_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date de fin doit être postérieure ou égale à la date de début.",
        )

    await db.flush()
    await db.refresh(season)
    return HrSeasonResponse.model_validate(season)


async def delete_season(db: AsyncSession, season_uuid: UUID) -> None:
    result = await db.execute(select(HrSeason).where(HrSeason.uuid == season_uuid))
    season = result.scalars().first()
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saison introuvable.")

    # Check for assignments
    count_result = await db.execute(
        select(func.count()).select_from(HrCalendarAssignment).where(
            HrCalendarAssignment.season_uuid == season_uuid
        )
    )
    count = count_result.scalar_one()
    if count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Impossible de supprimer : {count} affectation(s) référencent cette saison.",
        )

    await db.delete(season)
    await db.flush()


# ---------------------------------------------------------------------------
# Work calendars
# ---------------------------------------------------------------------------

async def list_calendars(db: AsyncSession) -> list[HrWorkCalendarResponse]:
    stmt = (
        select(HrWorkCalendar)
        .options(selectinload(HrWorkCalendar.days))
        .order_by(HrWorkCalendar.name)
    )
    result = await db.execute(stmt)
    calendars = result.scalars().all()
    return [HrWorkCalendarResponse.model_validate(c) for c in calendars]


async def get_calendar(db: AsyncSession, calendar_uuid: UUID) -> HrWorkCalendarResponse:
    stmt = (
        select(HrWorkCalendar)
        .where(HrWorkCalendar.uuid == calendar_uuid)
        .options(selectinload(HrWorkCalendar.days))
    )
    result = await db.execute(stmt)
    calendar = result.scalars().first()
    if not calendar:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")
    return HrWorkCalendarResponse.model_validate(calendar)


async def create_calendar(
    db: AsyncSession,
    data: HrWorkCalendarCreate,
) -> HrWorkCalendarResponse:
    calendar = HrWorkCalendar(
        name=data.name,
        description=data.description,
    )
    db.add(calendar)
    await db.flush()  # get calendar.uuid

    for day_data in data.days:
        day = HrWorkCalendarDay(
            calendar_uuid=calendar.uuid,
            day_of_week=day_data.day_of_week,
            is_working=day_data.is_working,
            expected_hours=day_data.expected_hours,
            start_time=day_data.start_time,
            end_time=day_data.end_time,
            apply_on_week=day_data.apply_on_week,
        )
        db.add(day)

    await db.flush()
    await db.refresh(calendar, ["days"])
    return HrWorkCalendarResponse.model_validate(calendar)


async def update_calendar(
    db: AsyncSession,
    calendar_uuid: UUID,
    data: HrWorkCalendarUpdate,
) -> HrWorkCalendarResponse:
    stmt = (
        select(HrWorkCalendar)
        .where(HrWorkCalendar.uuid == calendar_uuid)
        .options(selectinload(HrWorkCalendar.days))
    )
    result = await db.execute(stmt)
    calendar = result.scalars().first()
    if not calendar:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")

    if data.name is not None:
        calendar.name = data.name
    if data.description is not None:
        calendar.description = data.description
    calendar.updated_at = datetime.now(timezone.utc)

    if data.days is not None:
        # Delete all existing days and recreate
        for day in list(calendar.days):
            await db.delete(day)
        await db.flush()

        for day_data in data.days:
            day = HrWorkCalendarDay(
                calendar_uuid=calendar.uuid,
                day_of_week=day_data.day_of_week,
                is_working=day_data.is_working,
                expected_hours=day_data.expected_hours,
                start_time=day_data.start_time,
                end_time=day_data.end_time,
                apply_on_week=day_data.apply_on_week,
            )
            db.add(day)

    await db.flush()
    await db.refresh(calendar, ["days"])
    return HrWorkCalendarResponse.model_validate(calendar)


async def delete_calendar(db: AsyncSession, calendar_uuid: UUID) -> None:
    result = await db.execute(select(HrWorkCalendar).where(HrWorkCalendar.uuid == calendar_uuid))
    calendar = result.scalars().first()
    if not calendar:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")

    count_result = await db.execute(
        select(func.count()).select_from(HrCalendarAssignment).where(
            HrCalendarAssignment.calendar_uuid == calendar_uuid
        )
    )
    count = count_result.scalar_one()
    if count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Impossible de supprimer : {count} affectation(s) utilisent ce calendrier.",
        )

    await db.delete(calendar)
    await db.flush()


# ---------------------------------------------------------------------------
# Calendar assignments
# ---------------------------------------------------------------------------

async def list_assignments(
    db: AsyncSession,
    member_uuid: Optional[UUID] = None,
) -> list[HrCalendarAssignmentResponse]:
    stmt = (
        select(HrCalendarAssignment)
        .options(
            selectinload(HrCalendarAssignment.member),
            selectinload(HrCalendarAssignment.season),
            selectinload(HrCalendarAssignment.calendar),
        )
    )
    if member_uuid is not None:
        stmt = stmt.where(HrCalendarAssignment.member_uuid == member_uuid)
    result = await db.execute(stmt)
    assignments = result.scalars().all()
    return [_build_assignment_response(a) for a in assignments]


async def get_assignment(
    db: AsyncSession,
    assignment_uuid: UUID,
) -> HrCalendarAssignmentResponse:
    stmt = (
        select(HrCalendarAssignment)
        .where(HrCalendarAssignment.uuid == assignment_uuid)
        .options(
            selectinload(HrCalendarAssignment.member),
            selectinload(HrCalendarAssignment.season),
            selectinload(HrCalendarAssignment.calendar),
        )
    )
    result = await db.execute(stmt)
    assignment = result.scalars().first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Affectation introuvable.")
    return _build_assignment_response(assignment)


async def create_assignment(
    db: AsyncSession,
    data: HrCalendarAssignmentCreate,
    created_by_user_id: int,
) -> HrCalendarAssignmentResponse:
    # Check for duplicate (member + season)
    existing = await db.execute(
        select(HrCalendarAssignment).where(
            and_(
                HrCalendarAssignment.member_uuid == data.member_uuid,
                HrCalendarAssignment.season_uuid == data.season_uuid,
            )
        )
    )
    if existing.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Une affectation existe déjà pour cet employé et cette saison.",
        )

    # Verify references exist
    season_result = await db.execute(select(HrSeason).where(HrSeason.uuid == data.season_uuid))
    if not season_result.scalars().first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saison introuvable.")

    cal_result = await db.execute(select(HrWorkCalendar).where(HrWorkCalendar.uuid == data.calendar_uuid))
    if not cal_result.scalars().first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")

    assignment = HrCalendarAssignment(
        member_uuid=data.member_uuid,
        season_uuid=data.season_uuid,
        calendar_uuid=data.calendar_uuid,
        created_by=created_by_user_id,
    )
    db.add(assignment)
    await db.flush()
    await db.refresh(assignment, ["member", "season", "calendar"])
    return _build_assignment_response(assignment)


async def update_assignment(
    db: AsyncSession,
    assignment_uuid: UUID,
    data: HrCalendarAssignmentUpdate,
) -> HrCalendarAssignmentResponse:
    stmt = (
        select(HrCalendarAssignment)
        .where(HrCalendarAssignment.uuid == assignment_uuid)
        .options(
            selectinload(HrCalendarAssignment.member),
            selectinload(HrCalendarAssignment.season),
            selectinload(HrCalendarAssignment.calendar),
        )
    )
    result = await db.execute(stmt)
    assignment = result.scalars().first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Affectation introuvable.")

    # Verify new calendar exists
    cal_result = await db.execute(select(HrWorkCalendar).where(HrWorkCalendar.uuid == data.calendar_uuid))
    if not cal_result.scalars().first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")

    assignment.calendar_uuid = data.calendar_uuid
    assignment.updated_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(assignment, ["calendar"])
    return _build_assignment_response(assignment)


async def delete_assignment(db: AsyncSession, assignment_uuid: UUID) -> None:
    result = await db.execute(
        select(HrCalendarAssignment).where(HrCalendarAssignment.uuid == assignment_uuid)
    )
    assignment = result.scalars().first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Affectation introuvable.")
    await db.delete(assignment)
    await db.flush()


# ---------------------------------------------------------------------------
# Calendar resolution
# ---------------------------------------------------------------------------

async def compute_expected_hours(
    db: AsyncSession,
    member_uuid: UUID,
    target_date: date,
) -> ExpectedHoursResult:
    """
    Calculate expected hours for an employee on a given date.
    Returns is_working=False, expected_hours=0 if no season/assignment covers the date.
    """
    # 1. Find active season for this date
    season_stmt = select(HrSeason).where(
        and_(HrSeason.start_date <= target_date, HrSeason.end_date >= target_date)
    )
    season_result = await db.execute(season_stmt)
    season = season_result.scalars().first()
    if not season:
        return ExpectedHoursResult(date=target_date, is_working=False, expected_hours=Decimal("0"))

    # 2. Find assignment for member + season
    assign_stmt = (
        select(HrCalendarAssignment)
        .where(
            and_(
                HrCalendarAssignment.member_uuid == member_uuid,
                HrCalendarAssignment.season_uuid == season.uuid,
            )
        )
        .options(selectinload(HrCalendarAssignment.calendar).selectinload(HrWorkCalendar.days))
    )
    assign_result = await db.execute(assign_stmt)
    assignment = assign_result.scalars().first()
    if not assignment:
        return ExpectedHoursResult(
            date=target_date,
            is_working=False,
            expected_hours=Decimal("0"),
            season_uuid=season.uuid,
            season_name=season.name,
        )

    # 3. Resolve the calendar day
    iso_dow = target_date.isoweekday()  # 1=Monday … 7=Sunday
    week_num = _week_of_month(target_date)
    calendar = assignment.calendar

    # Find matching day entry: prefer apply_on_week=week_num, fallback to apply_on_week=0
    day_entry = None
    for d in calendar.days:
        if d.day_of_week == iso_dow:
            if d.apply_on_week == week_num:
                day_entry = d
                break
            elif d.apply_on_week == 0:
                day_entry = d  # keep as fallback, keep scanning for specific match

    if not day_entry or not day_entry.is_working:
        return ExpectedHoursResult(
            date=target_date,
            is_working=False,
            expected_hours=Decimal("0"),
            season_uuid=season.uuid,
            season_name=season.name,
            calendar_name=calendar.name,
        )

    return ExpectedHoursResult(
        date=target_date,
        is_working=True,
        expected_hours=day_entry.expected_hours,
        season_uuid=season.uuid,
        season_name=season.name,
        calendar_name=calendar.name,
    )


async def get_work_summary(
    db: AsyncSession,
    member_uuid: UUID,
    start_date: date,
    end_date: date,
) -> WorkSummaryResponse:
    """Compute expected work hours for each day in the range."""
    days = []
    current = start_date
    while current <= end_date:
        result = await compute_expected_hours(db, member_uuid, current)
        days.append(result)
        current += timedelta(days=1)

    total_hours = sum((d.expected_hours for d in days), Decimal("0"))
    worked_days = sum(1 for d in days if d.is_working)

    return WorkSummaryResponse(
        member_uuid=member_uuid,
        start_date=start_date,
        end_date=end_date,
        total_expected_hours=total_hours,
        worked_days=worked_days,
        days=days,
    )
