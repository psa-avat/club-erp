"""Business logic helpers for the members module."""

from __future__ import annotations

import csv
import io
import logging
import secrets
from datetime import date
from hashlib import sha256
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Select, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AccountingEntryTemplate, Committee, CommitteeMember, Member, MemberAccountCounter, MemberRegistration, MemberSheet, SystemSetting
from schemas.members import (
    AnonymizationResultResponse,
    CommitteeCreateRequest,
    CommitteeMembershipResponse,
    CommitteeMembershipReplaceRequest,
    CommitteeResponse,
    CommitteeUpdateRequest,
    ExpenseAccessResponse,
    ImportResultResponse,
    ImportRowError,
    MemberCreateRequest,
    MemberDetailResponse,
    MemberListFilters,
    MemberRegistrationCreateRequest,
    MemberRegistrationResponse,
    MemberRegistrationUpdateRequest,
    MemberSheetResponse,
    MemberSheetUpsertRequest,
    MemberSummaryResponse,
    MemberUpdateRequest,
    RegistrationCompletionRequest,
)

logger = logging.getLogger(__name__)

ACTIVE_REGISTRATION_STATUS = 1
ANONYMIZED_MEMBER_STATUS = 4
DEFAULT_ANONYMIZE_AFTER_YEARS = 5


def _hash_token(raw_token: str) -> str:
    return sha256(raw_token.encode("utf-8")).hexdigest()


def _validate_role_flags(
    *,
    is_employee: bool,
    is_executive: bool,
    is_board_member: bool,
) -> None:
    if is_employee and is_executive:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Employee and executive flags cannot be enabled together",
        )

    if is_employee and is_board_member:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Employee and board member flags cannot be enabled together",
        )


def _validate_registration_dates(start_date: date, end_date: date) -> None:
    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration end date must be on or after the start date",
        )


def _year_bounds(year: int) -> tuple[date, date]:
    return date(year, 1, 1), date(year, 12, 31)


def _registration_overlaps_year_predicate(year: int):
    start, end = _year_bounds(year)
    return (
        (MemberRegistration.status == ACTIVE_REGISTRATION_STATUS)
        & (MemberRegistration.start_date <= end)
        & (MemberRegistration.end_date >= start)
    )


async def generate_member_account_id(db: AsyncSession, *, year: Optional[int] = None) -> str:
    """Allocate the next unique member account id."""

    target_year = year or await db.scalar(select(func.extract("year", func.current_date())))
    target_year = int(target_year)

    counter = await db.get(MemberAccountCounter, target_year)
    if counter is None:
        counter = MemberAccountCounter(year=target_year, next_value=2)
        allocated_value = 1
        db.add(counter)
    else:
        allocated_value = counter.next_value
        counter.next_value += 1

    return f"ME{target_year}-{allocated_value:04d}"


async def _ensure_unique_member_fields(
    db: AsyncSession,
    *,
    account_id: str,
    email: Optional[str] = None,
    ffvp_id: Optional[int] = None,
    exclude_member_uuid: Optional[UUID] = None,
) -> None:
    account_query = select(Member).where(Member.account_id == account_id)
    if exclude_member_uuid is not None:
        account_query = account_query.where(Member.uuid != exclude_member_uuid)
    existing_account = await db.scalar(account_query)
    if existing_account is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account ID already exists")

    if email:
        email_query = select(Member).where(Member.email == email)
        if exclude_member_uuid is not None:
            email_query = email_query.where(Member.uuid != exclude_member_uuid)
        existing_email = await db.scalar(email_query)
        if existing_email is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")

    if ffvp_id is not None:
        ffvp_query = select(Member).where(Member.ffvp_id == ffvp_id)
        if exclude_member_uuid is not None:
            ffvp_query = ffvp_query.where(Member.uuid != exclude_member_uuid)
        existing_ffvp = await db.scalar(ffvp_query)
        if existing_ffvp is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="FFVP id already exists")


async def get_member_or_404(db: AsyncSession, member_uuid: UUID) -> Member:
    """Fetch a member or raise 404."""

    member = await db.get(Member, member_uuid)
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return member


async def get_committee_or_404(db: AsyncSession, committee_uuid: UUID) -> Committee:
    """Fetch a committee or raise 404."""

    committee = await db.get(Committee, committee_uuid)
    if committee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    return committee


async def _ensure_manager_exists(db: AsyncSession, manager_member_uuid: Optional[UUID]) -> None:
    if manager_member_uuid is None:
        return

    manager = await db.get(Member, manager_member_uuid)
    if manager is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Committee manager member not found")


async def _serialize_member_summary(
    db: AsyncSession,
    member: Member,
    *,
    year: Optional[int] = None,
) -> MemberSummaryResponse:
    committee_count_query = select(func.count()).select_from(CommitteeMember).where(CommitteeMember.member_uuid == member.uuid)
    if year is not None:
        committee_count_query = committee_count_query.where(CommitteeMember.membership_year == year)
    committee_count = int((await db.scalar(committee_count_query)) or 0)

    member_sheet_query = select(func.count()).select_from(MemberSheet).where(MemberSheet.member_uuid == member.uuid)
    if year is not None:
        member_sheet_query = member_sheet_query.where(MemberSheet.year == year)
    has_member_sheet = ((await db.scalar(member_sheet_query)) or 0) > 0
    is_registered = False
    if year is not None:
        registration_query = select(func.count()).select_from(MemberRegistration).where(
            MemberRegistration.member_uuid == member.uuid,
            _registration_overlaps_year_predicate(year),
        )
        is_registered = ((await db.scalar(registration_query)) or 0) > 0

    return MemberSummaryResponse(
        uuid=member.uuid,
        account_id=member.account_id,
        first_name=member.first_name,
        last_name=member.last_name,
        email=member.email,
        member_category=member.member_category,
        is_active=member.is_active,
        status=member.status,
        registration_status=member.registration_status,
        can_fly=member.can_fly,
        is_instructor=member.is_instructor,
        is_employee=member.is_employee,
        is_executive=member.is_executive,
        is_board_member=member.is_board_member,
        committee_count=committee_count,
        has_member_sheet_for_year=has_member_sheet,
        is_registered_for_year=is_registered,
    )


async def serialize_member_detail(db: AsyncSession, member: Member) -> MemberDetailResponse:
    """Serialize a member with yearly memberships and sheets."""

    memberships_result = await db.execute(
        select(CommitteeMember)
        .where(CommitteeMember.member_uuid == member.uuid)
        .order_by(CommitteeMember.membership_year.desc())
    )
    sheets_result = await db.execute(
        select(MemberSheet)
        .where(MemberSheet.member_uuid == member.uuid)
        .order_by(MemberSheet.year.desc())
    )
    registrations_result = await db.execute(
        select(MemberRegistration)
        .where(MemberRegistration.member_uuid == member.uuid)
        .order_by(MemberRegistration.start_date.desc(), MemberRegistration.registered_at.desc())
    )

    return MemberDetailResponse(
        uuid=member.uuid,
        genre=member.genre,
        first_name=member.first_name,
        last_name=member.last_name,
        date_of_birth=member.date_of_birth,
        email=member.email,
        phone=member.phone,
        member_category=member.member_category,
        first_subscription_year=member.first_subscription_year,
        ffvp_id=member.ffvp_id,
        account_id=member.account_id,
        photo_url=member.photo_url,
        is_active=member.is_active,
        status=member.status,
        registration_status=member.registration_status,
        is_instructor=member.is_instructor,
        is_employee=member.is_employee,
        is_executive=member.is_executive,
        is_board_member=member.is_board_member,
        can_fly=member.can_fly,
        external_auth_enabled=member.external_auth_enabled,
        last_registration_year=member.last_registration_year,
        notes=member.notes,
        created_at=member.created_at,
        updated_at=member.updated_at,
        committees=[
            committee for committee in (
                CommitteeMembershipResponse.model_validate(membership)
                for membership in memberships_result.scalars().all()
            )
        ],
        member_sheets=[MemberSheetResponse.model_validate(sheet) for sheet in sheets_result.scalars().all()],
        registrations=[
            MemberRegistrationResponse.model_validate(registration)
            for registration in registrations_result.scalars().all()
        ],
    )


def _apply_member_updates(member: Member, payload: MemberUpdateRequest) -> None:
    updates = payload.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        setattr(member, field_name, value)


async def create_member(
    db: AsyncSession,
    payload: MemberCreateRequest,
    *,
    updated_by_user_id: Optional[int] = None,
) -> Member:
    """Create a member after applying business rules."""

    account_id = payload.account_id or await generate_member_account_id(db)
    _validate_role_flags(
        is_employee=payload.is_employee,
        is_executive=payload.is_executive,
        is_board_member=payload.is_board_member,
    )
    await _ensure_unique_member_fields(
        db,
        account_id=account_id,
        email=str(payload.email) if payload.email is not None else None,
        ffvp_id=payload.ffvp_id,
    )

    member = Member(
        **payload.model_dump(exclude={"account_id", "email"}),
        email=str(payload.email) if payload.email is not None else None,
        account_id=account_id,
        updated_by=updated_by_user_id,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


async def list_members(
    db: AsyncSession,
    *,
    filters: Optional[MemberListFilters] = None,
) -> list[MemberSummaryResponse]:
    """List members with optional filters."""

    filters = filters or MemberListFilters()
    query: Select[tuple[Member]] = select(Member).order_by(Member.last_name.asc(), Member.first_name.asc())

    if filters.search:
        term = f"%{filters.search.strip()}%"
        query = query.where(
            or_(
                Member.first_name.ilike(term),
                Member.last_name.ilike(term),
                Member.account_id.ilike(term),
                Member.email.ilike(term),
            )
        )

    if filters.status is not None:
        query = query.where(Member.status == filters.status)
    if filters.member_category is not None:
        query = query.where(Member.member_category == filters.member_category)
    if filters.registration_status is not None:
        query = query.where(Member.registration_status == filters.registration_status)
    if filters.can_fly is not None:
        query = query.where(Member.can_fly == filters.can_fly)
    if filters.is_instructor is not None:
        query = query.where(Member.is_instructor == filters.is_instructor)
    if filters.is_employee is not None:
        query = query.where(Member.is_employee == filters.is_employee)
    if filters.is_executive is not None:
        query = query.where(Member.is_executive == filters.is_executive)
    if filters.is_board_member is not None:
        query = query.where(Member.is_board_member == filters.is_board_member)
    if filters.is_active is not None:
        query = query.where(Member.is_active == filters.is_active)
    if filters.registration_state is not None:
        if filters.year is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A year is required when filtering by registration state",
            )
        registration_exists = exists().where(
            MemberRegistration.member_uuid == Member.uuid,
            _registration_overlaps_year_predicate(filters.year),
        )
        query = query.where(registration_exists if filters.registration_state == "registered" else ~registration_exists)
    if filters.committee_uuid is not None:
        year = filters.year
        query = query.join(CommitteeMember, CommitteeMember.member_uuid == Member.uuid).where(
            CommitteeMember.committee_uuid == filters.committee_uuid
        )
        if year is not None:
            query = query.where(CommitteeMember.membership_year == year)

    result = await db.execute(query)
    members = result.scalars().unique().all()
    return [await _serialize_member_summary(db, member, year=filters.year) for member in members]


async def update_member(
    db: AsyncSession,
    member_uuid: UUID,
    payload: MemberUpdateRequest,
    *,
    updated_by_user_id: Optional[int] = None,
) -> Member:
    """Update a member after re-validating business rules."""

    member = await get_member_or_404(db, member_uuid)
    preview = payload.model_dump(exclude_unset=True)
    is_employee = preview.get("is_employee", member.is_employee)
    is_executive = preview.get("is_executive", member.is_executive)
    is_board_member = preview.get("is_board_member", member.is_board_member)
    _validate_role_flags(
        is_employee=is_employee,
        is_executive=is_executive,
        is_board_member=is_board_member,
    )

    account_id = preview.get("account_id", member.account_id)
    email = preview.get("email", member.email)
    ffvp_id = preview.get("ffvp_id", member.ffvp_id)
    await _ensure_unique_member_fields(
        db,
        account_id=account_id,
        email=str(email) if email is not None else None,
        ffvp_id=ffvp_id,
        exclude_member_uuid=member.uuid,
    )

    _apply_member_updates(member, payload)
    if payload.email is not None:
        member.email = str(payload.email)
    member.updated_by = updated_by_user_id

    await db.commit()
    await db.refresh(member)
    return member


async def list_committees(db: AsyncSession, *, active_only: Optional[bool] = None) -> list[CommitteeResponse]:
    """List committees."""

    query = select(Committee).order_by(Committee.code.asc())
    if active_only is not None:
        query = query.where(Committee.is_active == active_only)

    result = await db.execute(query)
    return [CommitteeResponse.model_validate(committee) for committee in result.scalars().all()]


async def create_committee(
    db: AsyncSession,
    payload: CommitteeCreateRequest,
    *,
    updated_by_user_id: Optional[int] = None,
) -> Committee:
    """Create a committee."""

    await _ensure_manager_exists(db, payload.manager_member_uuid)
    existing = await db.scalar(select(Committee).where(Committee.code == payload.code))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Committee code already exists")

    committee = Committee(
        **payload.model_dump(),
        updated_by=updated_by_user_id,
    )
    db.add(committee)
    await db.commit()
    await db.refresh(committee)
    return committee


async def update_committee(
    db: AsyncSession,
    committee_uuid: UUID,
    payload: CommitteeUpdateRequest,
    *,
    updated_by_user_id: Optional[int] = None,
) -> Committee:
    """Update a committee."""

    committee = await get_committee_or_404(db, committee_uuid)
    updates = payload.model_dump(exclude_unset=True)

    if "manager_member_uuid" in updates:
        await _ensure_manager_exists(db, updates["manager_member_uuid"])

    if "code" in updates and updates["code"] != committee.code:
        existing = await db.scalar(select(Committee).where(Committee.code == updates["code"], Committee.uuid != committee.uuid))
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Committee code already exists")

    for field_name, value in updates.items():
        setattr(committee, field_name, value)
    committee.updated_by = updated_by_user_id

    await db.commit()
    await db.refresh(committee)
    return committee


async def replace_committee_members(
    db: AsyncSession,
    committee_uuid: UUID,
    membership_year: int,
    payload: CommitteeMembershipReplaceRequest,
    *,
    assigned_by_user_id: Optional[int] = None,
) -> list[CommitteeMember]:
    """Replace all members assigned to a committee for a given year."""

    await get_committee_or_404(db, committee_uuid)

    members_result = await db.execute(select(Member.uuid).where(Member.uuid.in_(payload.member_uuids)))
    existing_member_uuids = set(members_result.scalars().all())
    missing_members = sorted(str(member_uuid) for member_uuid in set(payload.member_uuids) - existing_member_uuids)
    if missing_members:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown member UUIDs: {', '.join(missing_members)}",
        )

    existing_result = await db.execute(
        select(CommitteeMember).where(
            CommitteeMember.committee_uuid == committee_uuid,
            CommitteeMember.membership_year == membership_year,
        )
    )
    existing_assignments = existing_result.scalars().all()
    existing_by_member_uuid = {assignment.member_uuid: assignment for assignment in existing_assignments}

    target_member_uuids = set(payload.member_uuids)
    for assignment in existing_assignments:
        if assignment.member_uuid not in target_member_uuids:
            await db.delete(assignment)

    for member_uuid in payload.member_uuids:
        if member_uuid not in existing_by_member_uuid:
            db.add(
                CommitteeMember(
                    committee_uuid=committee_uuid,
                    member_uuid=member_uuid,
                    membership_year=membership_year,
                    assigned_by=assigned_by_user_id,
                )
            )

    await db.commit()
    refreshed_result = await db.execute(
        select(CommitteeMember)
        .where(
            CommitteeMember.committee_uuid == committee_uuid,
            CommitteeMember.membership_year == membership_year,
        )
        .order_by(CommitteeMember.member_uuid.asc())
    )
    return refreshed_result.scalars().all()


async def list_member_sheets(db: AsyncSession, member_uuid: UUID) -> list[MemberSheetResponse]:
    """List yearly member sheets for one member."""

    await get_member_or_404(db, member_uuid)
    result = await db.execute(select(MemberSheet).where(MemberSheet.member_uuid == member_uuid).order_by(MemberSheet.year.desc()))
    return [MemberSheetResponse.model_validate(sheet) for sheet in result.scalars().all()]


async def get_member_sheet_or_404(db: AsyncSession, member_uuid: UUID, year: int) -> MemberSheet:
    """Fetch a yearly member sheet or raise 404."""

    result = await db.execute(select(MemberSheet).where(MemberSheet.member_uuid == member_uuid, MemberSheet.year == year))
    sheet = result.scalar_one_or_none()
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member sheet not found")
    return sheet


async def upsert_member_sheet(
    db: AsyncSession,
    member_uuid: UUID,
    year: int,
    payload: MemberSheetUpsertRequest,
    *,
    updated_by_user_id: Optional[int] = None,
) -> MemberSheet:
    """Create or update a yearly member sheet."""

    member = await get_member_or_404(db, member_uuid)
    if not member.can_fly:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Member is not eligible for a member sheet")

    result = await db.execute(select(MemberSheet).where(MemberSheet.member_uuid == member_uuid, MemberSheet.year == year))
    sheet = result.scalar_one_or_none()

    if sheet is None:
        sheet = MemberSheet(
            member_uuid=member_uuid,
            year=year,
            updated_by=updated_by_user_id,
            **payload.model_dump(),
        )
        db.add(sheet)
    else:
        for field_name, value in payload.model_dump().items():
            setattr(sheet, field_name, value)
        sheet.updated_by = updated_by_user_id

    await db.commit()
    await db.refresh(sheet)
    return sheet


async def list_member_registrations(db: AsyncSession, member_uuid: UUID) -> list[MemberRegistrationResponse]:
    """List dated registration periods for one member."""

    await get_member_or_404(db, member_uuid)
    result = await db.execute(
        select(MemberRegistration)
        .where(MemberRegistration.member_uuid == member_uuid)
        .order_by(MemberRegistration.start_date.desc(), MemberRegistration.registered_at.desc())
    )
    return [MemberRegistrationResponse.model_validate(registration) for registration in result.scalars().all()]


async def create_member_registration(
    db: AsyncSession,
    member_uuid: UUID,
    payload: MemberRegistrationCreateRequest,
    *,
    registered_by_user_id: Optional[int] = None,
) -> MemberRegistration:
    """Create a dated member registration period and derived annual records."""

    member = await get_member_or_404(db, member_uuid)
    _validate_registration_dates(payload.start_date, payload.end_date)

    registration = MemberRegistration(
        member_uuid=member_uuid,
        start_date=payload.start_date,
        end_date=payload.end_date,
        registered_for_year=payload.registered_for_year,
        registration_type=payload.registration_type or member.member_category,
        status=payload.status,
        registered_by=registered_by_user_id,
        notes=payload.notes,
    )
    db.add(registration)

    if member.can_fly and payload.status == ACTIVE_REGISTRATION_STATUS:
        member.registration_status = 3
        member.status = 1
        member.is_active = True
        member.last_registration_year = max(member.last_registration_year or payload.registered_for_year, payload.registered_for_year)
        member.updated_by = registered_by_user_id

        existing_sheet = await db.scalar(
            select(MemberSheet).where(
                MemberSheet.member_uuid == member_uuid,
                MemberSheet.year == payload.registered_for_year,
            )
        )
        if existing_sheet is None:
            db.add(
                MemberSheet(
                    member_uuid=member_uuid,
                    year=payload.registered_for_year,
                    fare_type=1,
                    updated_by=registered_by_user_id,
                )
            )
    elif payload.status == ACTIVE_REGISTRATION_STATUS:
        member.registration_status = 3
        member.status = 1
        member.is_active = True
        member.last_registration_year = max(member.last_registration_year or payload.registered_for_year, payload.registered_for_year)
        member.updated_by = registered_by_user_id

    await db.commit()
    await db.refresh(registration)
    return registration


async def update_member_registration(
    db: AsyncSession,
    member_uuid: UUID,
    registration_uuid: UUID,
    payload: MemberRegistrationUpdateRequest,
) -> MemberRegistration:
    """Update a dated registration period."""

    result = await db.execute(
        select(MemberRegistration).where(
            MemberRegistration.uuid == registration_uuid,
            MemberRegistration.member_uuid == member_uuid,
        )
    )
    registration = result.scalar_one_or_none()
    if registration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member registration not found")

    updates = payload.model_dump(exclude_unset=True)
    start_date = updates.get("start_date", registration.start_date)
    end_date = updates.get("end_date", registration.end_date)
    _validate_registration_dates(start_date, end_date)

    for field_name, value in updates.items():
        setattr(registration, field_name, value)

    await db.commit()
    await db.refresh(registration)
    return registration


async def complete_member_registration(
    db: AsyncSession,
    member_uuid: UUID,
    payload: RegistrationCompletionRequest,
    *,
    updated_by_user_id: Optional[int] = None,
) -> Member:
    """Complete registration after committee validation and create a validity period."""

    member = await get_member_or_404(db, member_uuid)
    committee_count = await db.scalar(
        select(func.count()).select_from(CommitteeMember).where(
            CommitteeMember.member_uuid == member_uuid,
            CommitteeMember.membership_year == payload.year,
        )
    )
    if not committee_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one committee membership is required before completing registration",
        )

    if payload.accounting_template_uuid is not None:
        template_is_active = await db.scalar(
            select(
                exists().where(
                    AccountingEntryTemplate.uuid == payload.accounting_template_uuid,
                    AccountingEntryTemplate.is_active.is_(True),
                )
            )
        )
        if not template_is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected accounting template does not exist or is inactive",
            )

    registration_notes = payload.notes
    if payload.accounting_template_uuid is not None:
        template_trace = f"Registration template: {payload.accounting_template_uuid}"
        registration_notes = template_trace if not registration_notes else f"{registration_notes}\n{template_trace}"

    await create_member_registration(
        db=db,
        member_uuid=member_uuid,
        payload=MemberRegistrationCreateRequest(
            start_date=payload.start_date,
            end_date=payload.end_date,
            registered_for_year=payload.year,
            registration_type=payload.registration_type or member.member_category,
            status=payload.status,
            notes=registration_notes,
        ),
        registered_by_user_id=updated_by_user_id,
    )
    await db.refresh(member)
    return member


async def anonymize_inactive_members(
    db: AsyncSession,
    *,
    reference_year: Optional[int] = None,
) -> AnonymizationResultResponse:
    """Anonymize members with no active registration for the configured number of full years."""

    settings = await db.scalar(select(SystemSetting).where(SystemSetting.module_name == "members"))
    anonymize_after_years = DEFAULT_ANONYMIZE_AFTER_YEARS
    if settings is not None:
        raw_value = settings.settings.get("anonymize_after_unregistered_years")
        if isinstance(raw_value, int) and raw_value > 0:
            anonymize_after_years = raw_value

    current_year = reference_year or date.today().year
    threshold_year = current_year - anonymize_after_years
    cutoff = date(threshold_year, 12, 31)

    registered_since_threshold = exists().where(
        MemberRegistration.member_uuid == Member.uuid,
        MemberRegistration.status == ACTIVE_REGISTRATION_STATUS,
        MemberRegistration.end_date > cutoff,
    )
    result = await db.execute(
        select(Member).where(
            Member.status != ANONYMIZED_MEMBER_STATUS,
            ~registered_since_threshold,
        )
    )
    members = result.scalars().all()
    for member in members:
        member.first_name = "Anonymized"
        member.last_name = f"Member {str(member.uuid)[:8]}"
        member.date_of_birth = None
        member.email = None
        member.phone = None
        member.photo_url = None
        member.ffvp_id = None
        member.notes = None
        member.status = ANONYMIZED_MEMBER_STATUS
        member.is_active = True
        member.external_auth_enabled = False

    await db.commit()
    return AnonymizationResultResponse(anonymized=len(members), threshold_year=threshold_year)


async def enable_member_sheet_expense_access(
    db: AsyncSession,
    member_uuid: UUID,
    year: int,
    *,
    updated_by_user_id: Optional[int] = None,
) -> ExpenseAccessResponse:
    """Enable token-based expense access and return the raw one-time token."""

    sheet = await get_member_sheet_or_404(db, member_uuid, year)
    raw_token = secrets.token_urlsafe(24)
    sheet.expense_access_token_hash = _hash_token(raw_token)
    sheet.expense_access_enabled = True
    sheet.updated_by = updated_by_user_id
    await db.commit()
    return ExpenseAccessResponse(
        member_uuid=member_uuid,
        year=year,
        expense_access_enabled=True,
        generated_token=raw_token,
    )


async def disable_member_sheet_expense_access(
    db: AsyncSession,
    member_uuid: UUID,
    year: int,
    *,
    updated_by_user_id: Optional[int] = None,
) -> ExpenseAccessResponse:
    """Disable token-based expense access for a yearly member sheet."""

    sheet = await get_member_sheet_or_404(db, member_uuid, year)
    sheet.expense_access_token_hash = None
    sheet.expense_access_enabled = False
    sheet.updated_by = updated_by_user_id
    await db.commit()
    return ExpenseAccessResponse(
        member_uuid=member_uuid,
        year=year,
        expense_access_enabled=False,
        generated_token=None,
    )


# ---------------------------------------------------------------------------
# CSV bulk import
# ---------------------------------------------------------------------------

# Mapping from human-readable CSV values to SMALLINT enum codes
_MEMBER_CATEGORY_MAP: dict[str, int] = {
    "1": 1, "full": 1, "membre_actif": 1,
    "2": 2, "temporary": 2, "temporaire": 2,
    "3": 3, "non_flying": 3, "non_volant": 3,
    "4": 4, "short_period": 4, "court_sejour": 4,
    "5": 5, "external_pilot": 5, "pilote_externe": 5,
    "6": 6, "volunteer": 6, "benevole": 6,
}

_GENRE_MAP: dict[str, int] = {
    "0": 0, "unknown": 0, "inconnu": 0, "": 0,
    "1": 1, "m": 1, "male": 1, "homme": 1,
    "2": 2, "f": 2, "female": 2, "femme": 2,
    "3": 3, "other": 3, "autre": 3,
}

_STATUS_MAP: dict[str, int] = {
    "1": 1, "active": 1, "actif": 1,
    "2": 2, "inactive": 2, "inactif": 2,
    "3": 3, "suspended": 3, "suspendu": 3,
    "4": 4, "deceased": 4, "décédé": 4, "decede": 4,
}

_REGISTRATION_STATUS_MAP: dict[str, int] = {
    "1": 1, "draft": 1, "brouillon": 1,
    "2": 2, "pending": 2, "en_attente": 2,
    "3": 3, "complete": 3, "complet": 3,
    "4": 4, "expired": 4, "expiré": 4, "expire": 4,
}


def _parse_bool_cell(value: str, default: bool = False) -> bool:
    v = value.strip().lower()
    if v in ("1", "true", "yes", "oui", "vrai"):
        return True
    if v in ("0", "false", "no", "non", "faux", ""):
        return False
    return default


async def import_members_from_csv(
    db: AsyncSession,
    content: bytes,
    *,
    update_existing: bool = False,
    updated_by_user_id: Optional[int] = None,
) -> ImportResultResponse:
    """Parse a CSV file and bulk-create members, collecting per-row errors.

    Rows with validation errors are skipped; valid rows are committed
    individually so that one bad row does not roll back good ones.
    """
    errors: list[ImportRowError] = []
    created = 0
    updated = 0
    skipped = 0

    try:
        text = content.decode("utf-8-sig")  # strip BOM if present
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    required_columns = {"first_name", "last_name", "member_category"}
    if reader.fieldnames:
        missing = required_columns - {c.strip().lower() for c in reader.fieldnames}
        if missing:
            return ImportResultResponse(
                created=0,
                skipped=0,
                errors=[ImportRowError(row=0, field=None, message=f"Missing required columns: {', '.join(sorted(missing))}")],
            )

    for row_index, raw in enumerate(reader, start=2):  # row 1 = header
        row = {k.strip().lower(): (v or "").strip() for k, v in raw.items()}

        # --- required fields ---
        first_name = row.get("first_name", "")
        last_name = row.get("last_name", "")
        raw_category = row.get("member_category", "").lower()

        if not first_name:
            errors.append(ImportRowError(row=row_index, field="first_name", message="Required"))
            skipped += 1
            continue
        if not last_name:
            errors.append(ImportRowError(row=row_index, field="last_name", message="Required"))
            skipped += 1
            continue
        if raw_category not in _MEMBER_CATEGORY_MAP:
            errors.append(ImportRowError(row=row_index, field="member_category", message=f"Unknown value {raw_category!r}. Expected 1-6 or label."))
            skipped += 1
            continue

        # --- optional fields ---
        raw_genre = row.get("genre", "0").lower()
        genre = _GENRE_MAP.get(raw_genre, 0)

        email_raw = row.get("email", "") or None
        phone = row.get("phone", "") or None
        account_id = row.get("account_id", "") or None
        notes = row.get("notes", "") or None

        date_of_birth = None
        raw_dob = row.get("date_of_birth", "")
        if raw_dob:
            from datetime import date as _date
            try:
                date_of_birth = _date.fromisoformat(raw_dob)
            except ValueError:
                errors.append(ImportRowError(row=row_index, field="date_of_birth", message=f"Invalid date {raw_dob!r}. Use YYYY-MM-DD."))
                skipped += 1
                continue

        first_subscription_year = None
        raw_first_sub_year = row.get("first_subscription_year", "")
        if raw_first_sub_year:
            try:
                first_subscription_year = int(raw_first_sub_year)
                if not (1950 <= first_subscription_year <= 9999):
                    raise ValueError
            except ValueError:
                errors.append(ImportRowError(row=row_index, field="first_subscription_year", message="Must be a year between 1950 and 9999"))
                skipped += 1
                continue

        ffvp_id = None
        raw_ffvp = row.get("ffvp_id", "")
        if raw_ffvp:
            try:
                ffvp_id = int(raw_ffvp)
                if ffvp_id < 1:
                    raise ValueError
            except ValueError:
                errors.append(ImportRowError(row=row_index, field="ffvp_id", message="Must be a positive integer"))
                skipped += 1
                continue

        existing_member: Optional[Member] = None
        if update_existing:
            if ffvp_id is not None:
                existing_member = await db.scalar(select(Member).where(Member.ffvp_id == ffvp_id))
            if existing_member is None and account_id:
                existing_member = await db.scalar(select(Member).where(Member.account_id == account_id))
            if existing_member is None and email_raw:
                existing_member = await db.scalar(select(Member).where(Member.email == email_raw))

        raw_status = row.get("status", "").lower()
        if raw_status:
            member_status = _STATUS_MAP.get(raw_status)
            if member_status is None:
                errors.append(ImportRowError(row=row_index, field="status", message=f"Unknown value {raw_status!r}"))
                skipped += 1
                continue
        else:
            member_status = existing_member.status if existing_member is not None else 1

        raw_reg_status = row.get("registration_status", "").lower()
        if raw_reg_status:
            reg_status = _REGISTRATION_STATUS_MAP.get(raw_reg_status)
            if reg_status is None:
                errors.append(ImportRowError(row=row_index, field="registration_status", message=f"Unknown value {raw_reg_status!r}"))
                skipped += 1
                continue
        else:
            reg_status = existing_member.registration_status if existing_member is not None else 1

        last_reg_year = None
        raw_year = row.get("last_registration_year", "")
        if raw_year:
            try:
                last_reg_year = int(raw_year)
                if not (2000 <= last_reg_year <= 9999):
                    raise ValueError
            except ValueError:
                errors.append(ImportRowError(row=row_index, field="last_registration_year", message="Must be a year between 2000 and 9999"))
                skipped += 1
                continue

        try:
            if existing_member is not None:
                payload = MemberUpdateRequest(
                    genre=genre,
                    first_name=first_name,
                    last_name=last_name,
                    date_of_birth=date_of_birth,
                    email=email_raw,  # type: ignore[arg-type]
                    phone=phone,
                    member_category=_MEMBER_CATEGORY_MAP[raw_category],
                    first_subscription_year=first_subscription_year,
                    ffvp_id=ffvp_id,
                    account_id=account_id or existing_member.account_id,
                    is_active=_parse_bool_cell(row.get("is_active", ""), default=existing_member.is_active),
                    status=member_status,
                    registration_status=reg_status,
                    can_fly=_parse_bool_cell(row.get("can_fly", ""), default=existing_member.can_fly),
                    is_instructor=_parse_bool_cell(row.get("is_instructor", ""), default=existing_member.is_instructor),
                    is_employee=_parse_bool_cell(row.get("is_employee", ""), default=existing_member.is_employee),
                    is_executive=_parse_bool_cell(row.get("is_executive", ""), default=existing_member.is_executive),
                    is_board_member=_parse_bool_cell(row.get("is_board_member", ""), default=existing_member.is_board_member),
                    last_registration_year=last_reg_year,
                    notes=notes,
                )
                await update_member(
                    db=db,
                    member_uuid=existing_member.uuid,
                    payload=payload,
                    updated_by_user_id=updated_by_user_id,
                )
                updated += 1
            else:
                payload = MemberCreateRequest(
                    genre=genre,
                    first_name=first_name,
                    last_name=last_name,
                    date_of_birth=date_of_birth,
                    email=email_raw,  # type: ignore[arg-type]
                    phone=phone,
                    member_category=_MEMBER_CATEGORY_MAP[raw_category],
                    first_subscription_year=first_subscription_year,
                    ffvp_id=ffvp_id,
                    account_id=account_id,
                    is_active=_parse_bool_cell(row.get("is_active", "true"), default=True),
                    status=member_status,
                    registration_status=reg_status,
                    can_fly=_parse_bool_cell(row.get("can_fly", "false")),
                    is_instructor=_parse_bool_cell(row.get("is_instructor", "false")),
                    is_employee=_parse_bool_cell(row.get("is_employee", "false")),
                    is_executive=_parse_bool_cell(row.get("is_executive", "false")),
                    is_board_member=_parse_bool_cell(row.get("is_board_member", "false")),
                    last_registration_year=last_reg_year,
                    notes=notes,
                )
                await create_member(db=db, payload=payload, updated_by_user_id=updated_by_user_id)
                created += 1
        except HTTPException as exc:
            errors.append(ImportRowError(row=row_index, field=None, message=exc.detail))
            skipped += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("members_csv_import row=%d error=%s", row_index, exc)
            errors.append(ImportRowError(row=row_index, field=None, message="Unexpected error — row skipped"))
            skipped += 1

    return ImportResultResponse(created=created, updated=updated, skipped=skipped, errors=errors)
