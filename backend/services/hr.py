"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - hr: Business logic for the HR module — employee profiles, working time calendars
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
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    HrCalendarPhase,
    HrEmployeeCalendarAssignment,
    HrEmployeeProfile,
    HrPhaseDayRule,
    HrWorkingTimeCalendar,
    Member,
)
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


def _build_assignment_response(
    assignment: HrEmployeeCalendarAssignment,
) -> HrEmployeeCalendarAssignmentResponse:
    return HrEmployeeCalendarAssignmentResponse(
        uuid=assignment.uuid,
        member_uuid=assignment.member_uuid,
        calendar_uuid=assignment.calendar_uuid,
        effective_from=assignment.effective_from,
        effective_to=assignment.effective_to,
        created_at=assignment.created_at,
        updated_at=assignment.updated_at,
        member_first_name=assignment.member.first_name if assignment.member else None,
        member_last_name=assignment.member.last_name if assignment.member else None,
        member_account_id=assignment.member.account_id if assignment.member else None,
        calendar_name=assignment.calendar.name if assignment.calendar else None,
    )


def _week_of_month(d: date) -> int:
    """Return 1..5 — which occurrence of this weekday in the month (5 = last)."""
    week_num = (d.day - 1) // 7 + 1
    if d.month == 12:
        last_day = date(d.year + 1, 1, 1) - timedelta(days=1)
    else:
        last_day = date(d.year, d.month + 1, 1) - timedelta(days=1)
    max_weeks = (last_day.day - 1) // 7 + 1
    return 5 if week_num >= max_weeks else week_num


def _phase_covers_date(phase: HrCalendarPhase, d: date) -> bool:
    """Return True if the phase's annual recurring range covers date d (MM-DD comparison)."""
    current = (d.month, d.day)
    start = (phase.start_month, phase.start_day)
    end = (phase.end_month, phase.end_day)
    if start <= end:
        return start <= current <= end
    # Wrap-around phase (e.g. Dec-01 → Jan-31); not common but handled
    return current >= start or current <= end


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
    member_result = await db.execute(select(Member).where(Member.uuid == data.member_uuid))
    member = member_result.scalars().first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membre introuvable.")
    if not member.is_employee:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ce membre n'est pas marqué comme employé (is_employee=False).",
        )

    existing = await db.execute(
        select(HrEmployeeProfile).where(HrEmployeeProfile.member_uuid == data.member_uuid)
    )
    if existing.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Un profil employé existe déjà pour ce membre.",
        )

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

    if profile.termination_date and profile.termination_date < profile.hire_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date de fin ne peut pas être antérieure à la date d'embauche.",
        )

    await db.flush()
    return _build_profile_response(profile)


# ---------------------------------------------------------------------------
# Working time calendars
# ---------------------------------------------------------------------------

def _calendar_eager_options():
    return selectinload(HrWorkingTimeCalendar.phases).selectinload(HrCalendarPhase.day_rules)


async def list_calendars(db: AsyncSession) -> list[HrWorkingTimeCalendarResponse]:
    stmt = (
        select(HrWorkingTimeCalendar)
        .options(_calendar_eager_options())
        .order_by(HrWorkingTimeCalendar.name)
    )
    result = await db.execute(stmt)
    calendars = result.scalars().all()
    return [HrWorkingTimeCalendarResponse.model_validate(c) for c in calendars]


async def get_calendar(
    db: AsyncSession,
    calendar_uuid: UUID,
) -> HrWorkingTimeCalendarResponse:
    stmt = (
        select(HrWorkingTimeCalendar)
        .where(HrWorkingTimeCalendar.uuid == calendar_uuid)
        .options(_calendar_eager_options())
    )
    result = await db.execute(stmt)
    calendar = result.scalars().first()
    if not calendar:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")
    return HrWorkingTimeCalendarResponse.model_validate(calendar)


async def create_calendar(
    db: AsyncSession,
    data: HrWorkingTimeCalendarCreate,
) -> HrWorkingTimeCalendarResponse:
    calendar = HrWorkingTimeCalendar(name=data.name, description=data.description)
    db.add(calendar)
    await db.flush()
    await db.refresh(calendar, ["phases"])
    return HrWorkingTimeCalendarResponse.model_validate(calendar)


async def update_calendar(
    db: AsyncSession,
    calendar_uuid: UUID,
    data: HrWorkingTimeCalendarUpdate,
) -> HrWorkingTimeCalendarResponse:
    stmt = (
        select(HrWorkingTimeCalendar)
        .where(HrWorkingTimeCalendar.uuid == calendar_uuid)
        .options(_calendar_eager_options())
    )
    result = await db.execute(stmt)
    calendar = result.scalars().first()
    if not calendar:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(calendar, field, value)
    calendar.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return HrWorkingTimeCalendarResponse.model_validate(calendar)


async def delete_calendar(db: AsyncSession, calendar_uuid: UUID) -> None:
    result = await db.execute(
        select(HrWorkingTimeCalendar).where(HrWorkingTimeCalendar.uuid == calendar_uuid)
    )
    calendar = result.scalars().first()
    if not calendar:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")

    count_result = await db.execute(
        select(func.count()).select_from(HrEmployeeCalendarAssignment).where(
            HrEmployeeCalendarAssignment.calendar_uuid == calendar_uuid
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
# Phases
# ---------------------------------------------------------------------------

async def get_phase(db: AsyncSession, phase_uuid: UUID) -> HrCalendarPhaseResponse:
    stmt = (
        select(HrCalendarPhase)
        .where(HrCalendarPhase.uuid == phase_uuid)
        .options(selectinload(HrCalendarPhase.day_rules))
    )
    result = await db.execute(stmt)
    phase = result.scalars().first()
    if not phase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase introuvable.")
    return HrCalendarPhaseResponse.model_validate(phase)


async def create_phase(
    db: AsyncSession,
    calendar_uuid: UUID,
    data: HrCalendarPhaseCreate,
) -> HrCalendarPhaseResponse:
    # Verify calendar exists
    cal_result = await db.execute(
        select(HrWorkingTimeCalendar).where(HrWorkingTimeCalendar.uuid == calendar_uuid)
    )
    if not cal_result.scalars().first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")

    phase = HrCalendarPhase(
        calendar_uuid=calendar_uuid,
        name=data.name,
        start_month=data.start_month,
        start_day=data.start_day,
        end_month=data.end_month,
        end_day=data.end_day,
    )
    db.add(phase)
    await db.flush()

    for rule_data in data.day_rules:
        rule = HrPhaseDayRule(
            phase_uuid=phase.uuid,
            day_of_week=rule_data.day_of_week,
            is_working=rule_data.is_working,
            expected_hours=rule_data.expected_hours,
            start_time=rule_data.start_time,
            end_time=rule_data.end_time,
            apply_on_week=rule_data.apply_on_week,
        )
        db.add(rule)

    await db.flush()
    await db.refresh(phase, ["day_rules"])
    return HrCalendarPhaseResponse.model_validate(phase)


async def update_phase(
    db: AsyncSession,
    calendar_uuid: UUID,
    phase_uuid: UUID,
    data: HrCalendarPhaseUpdate,
) -> HrCalendarPhaseResponse:
    stmt = (
        select(HrCalendarPhase)
        .where(
            and_(
                HrCalendarPhase.uuid == phase_uuid,
                HrCalendarPhase.calendar_uuid == calendar_uuid,
            )
        )
        .options(selectinload(HrCalendarPhase.day_rules))
    )
    result = await db.execute(stmt)
    phase = result.scalars().first()
    if not phase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase introuvable.")

    scalar_fields = {"name", "start_month", "start_day", "end_month", "end_day"}
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field in scalar_fields:
            setattr(phase, field, value)
    phase.updated_at = datetime.now(timezone.utc)

    if data.day_rules is not None:
        for rule in list(phase.day_rules):
            await db.delete(rule)
        await db.flush()
        for rule_data in data.day_rules:
            rule = HrPhaseDayRule(
                phase_uuid=phase.uuid,
                day_of_week=rule_data.day_of_week,
                is_working=rule_data.is_working,
                expected_hours=rule_data.expected_hours,
                start_time=rule_data.start_time,
                end_time=rule_data.end_time,
                apply_on_week=rule_data.apply_on_week,
            )
            db.add(rule)

    await db.flush()
    await db.refresh(phase, ["day_rules"])
    return HrCalendarPhaseResponse.model_validate(phase)


async def delete_phase(
    db: AsyncSession,
    calendar_uuid: UUID,
    phase_uuid: UUID,
) -> None:
    result = await db.execute(
        select(HrCalendarPhase).where(
            and_(
                HrCalendarPhase.uuid == phase_uuid,
                HrCalendarPhase.calendar_uuid == calendar_uuid,
            )
        )
    )
    phase = result.scalars().first()
    if not phase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase introuvable.")
    await db.delete(phase)
    await db.flush()


# ---------------------------------------------------------------------------
# Employee calendar assignments
# ---------------------------------------------------------------------------

async def list_assignments(
    db: AsyncSession,
    member_uuid: Optional[UUID] = None,
) -> list[HrEmployeeCalendarAssignmentResponse]:
    stmt = (
        select(HrEmployeeCalendarAssignment)
        .options(
            selectinload(HrEmployeeCalendarAssignment.member),
            selectinload(HrEmployeeCalendarAssignment.calendar),
        )
        .order_by(
            HrEmployeeCalendarAssignment.member_uuid,
            HrEmployeeCalendarAssignment.effective_from.desc(),
        )
    )
    if member_uuid is not None:
        stmt = stmt.where(HrEmployeeCalendarAssignment.member_uuid == member_uuid)
    result = await db.execute(stmt)
    assignments = result.scalars().all()
    return [_build_assignment_response(a) for a in assignments]


async def get_assignment(
    db: AsyncSession,
    assignment_uuid: UUID,
) -> HrEmployeeCalendarAssignmentResponse:
    stmt = (
        select(HrEmployeeCalendarAssignment)
        .where(HrEmployeeCalendarAssignment.uuid == assignment_uuid)
        .options(
            selectinload(HrEmployeeCalendarAssignment.member),
            selectinload(HrEmployeeCalendarAssignment.calendar),
        )
    )
    result = await db.execute(stmt)
    assignment = result.scalars().first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Affectation introuvable.")
    return _build_assignment_response(assignment)


async def create_assignment(
    db: AsyncSession,
    data: HrEmployeeCalendarAssignmentCreate,
) -> HrEmployeeCalendarAssignmentResponse:
    if data.effective_to and data.effective_to <= data.effective_from:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date de fin doit être postérieure à la date de début.",
        )

    cal_result = await db.execute(
        select(HrWorkingTimeCalendar).where(HrWorkingTimeCalendar.uuid == data.calendar_uuid)
    )
    if not cal_result.scalars().first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")

    assignment = HrEmployeeCalendarAssignment(
        member_uuid=data.member_uuid,
        calendar_uuid=data.calendar_uuid,
        effective_from=data.effective_from,
        effective_to=data.effective_to,
    )
    db.add(assignment)
    await db.flush()
    await db.refresh(assignment, ["member", "calendar"])
    return _build_assignment_response(assignment)


async def update_assignment(
    db: AsyncSession,
    assignment_uuid: UUID,
    data: HrEmployeeCalendarAssignmentUpdate,
) -> HrEmployeeCalendarAssignmentResponse:
    stmt = (
        select(HrEmployeeCalendarAssignment)
        .where(HrEmployeeCalendarAssignment.uuid == assignment_uuid)
        .options(
            selectinload(HrEmployeeCalendarAssignment.member),
            selectinload(HrEmployeeCalendarAssignment.calendar),
        )
    )
    result = await db.execute(stmt)
    assignment = result.scalars().first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Affectation introuvable.")

    if data.calendar_uuid is not None:
        cal_result = await db.execute(
            select(HrWorkingTimeCalendar).where(HrWorkingTimeCalendar.uuid == data.calendar_uuid)
        )
        if not cal_result.scalars().first():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendrier introuvable.")
        assignment.calendar_uuid = data.calendar_uuid

    if data.effective_from is not None:
        assignment.effective_from = data.effective_from
    if data.effective_to is not None:
        assignment.effective_to = data.effective_to

    if assignment.effective_to and assignment.effective_to <= assignment.effective_from:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date de fin doit être postérieure à la date de début.",
        )

    assignment.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(assignment, ["calendar"])
    return _build_assignment_response(assignment)


async def delete_assignment(db: AsyncSession, assignment_uuid: UUID) -> None:
    result = await db.execute(
        select(HrEmployeeCalendarAssignment).where(
            HrEmployeeCalendarAssignment.uuid == assignment_uuid
        )
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
    Resolves: active assignment → calendar → phase covering date → day rule.
    Returns is_working=False, expected_hours=0 if no assignment/phase/rule applies.
    """
    # Find the active assignment for this date (most recent effective_from wins if multiple overlap)
    assign_stmt = (
        select(HrEmployeeCalendarAssignment)
        .where(
            and_(
                HrEmployeeCalendarAssignment.member_uuid == member_uuid,
                HrEmployeeCalendarAssignment.effective_from <= target_date,
                or_(
                    HrEmployeeCalendarAssignment.effective_to.is_(None),
                    HrEmployeeCalendarAssignment.effective_to >= target_date,
                ),
            )
        )
        .options(
            selectinload(HrEmployeeCalendarAssignment.calendar)
            .selectinload(HrWorkingTimeCalendar.phases)
            .selectinload(HrCalendarPhase.day_rules)
        )
        .order_by(HrEmployeeCalendarAssignment.effective_from.desc())
    )
    assign_result = await db.execute(assign_stmt)
    assignment = assign_result.scalars().first()
    if not assignment:
        return ExpectedHoursResult(date=target_date, is_working=False, expected_hours=Decimal("0"))

    calendar = assignment.calendar

    # Find the phase whose annual date range covers the target date
    matching_phase = None
    for phase in calendar.phases:
        if _phase_covers_date(phase, target_date):
            matching_phase = phase
            break

    if not matching_phase:
        return ExpectedHoursResult(
            date=target_date,
            is_working=False,
            expected_hours=Decimal("0"),
            calendar_name=calendar.name,
        )

    # Find matching day rule (specific week takes priority over apply_on_week=0)
    iso_dow = target_date.isoweekday()
    week_num = _week_of_month(target_date)
    day_rule = None
    for r in matching_phase.day_rules:
        if r.day_of_week == iso_dow:
            if r.apply_on_week == week_num:
                day_rule = r
                break
            elif r.apply_on_week == 0:
                day_rule = r  # fallback; keep scanning for specific match

    if not day_rule or not day_rule.is_working:
        return ExpectedHoursResult(
            date=target_date,
            is_working=False,
            expected_hours=Decimal("0"),
            phase_uuid=matching_phase.uuid,
            phase_name=matching_phase.name,
            calendar_name=calendar.name,
        )

    return ExpectedHoursResult(
        date=target_date,
        is_working=True,
        expected_hours=day_rule.expected_hours,
        phase_uuid=matching_phase.uuid,
        phase_name=matching_phase.name,
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
