"""Business logic helpers for the members module."""

from __future__ import annotations

import csv
import io
import logging
import secrets
from hashlib import sha256
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Committee, CommitteeMember, Member, MemberAccountCounter, MemberSheet
from schemas.members import (
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
    MemberSheetResponse,
    MemberSheetUpsertRequest,
    MemberSummaryResponse,
    MemberUpdateRequest,
)

logger = logging.getLogger(__name__)


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

    return MemberDetailResponse(
        uuid=member.uuid,
        genre=member.genre,
        first_name=member.first_name,
        last_name=member.last_name,
        date_of_birth=member.date_of_birth,
        email=member.email,
        phone=member.phone,
        member_category=member.member_category,
        seniority=member.seniority,
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


async def complete_member_registration(
    db: AsyncSession,
    member_uuid: UUID,
    year: int,
    *,
    updated_by_user_id: Optional[int] = None,
) -> Member:
    """Mark a member registration as completed after committee validation."""

    member = await get_member_or_404(db, member_uuid)
    committee_count = await db.scalar(
        select(func.count()).select_from(CommitteeMember).where(
            CommitteeMember.member_uuid == member_uuid,
            CommitteeMember.membership_year == year,
        )
    )
    if not committee_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one committee membership is required before completing registration",
        )

    member.registration_status = 3
    member.status = 1
    member.is_active = True
    member.last_registration_year = year
    member.updated_by = updated_by_user_id
    await db.commit()
    await db.refresh(member)
    return member


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
    updated_by_user_id: Optional[int] = None,
) -> ImportResultResponse:
    """Parse a CSV file and bulk-create members, collecting per-row errors.

    Rows with validation errors are skipped; valid rows are committed
    individually so that one bad row does not roll back good ones.
    """
    errors: list[ImportRowError] = []
    created = 0
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

        raw_status = row.get("status", "1").lower()
        member_status = _STATUS_MAP.get(raw_status, 1)
        if member_status is None:
            errors.append(ImportRowError(row=row_index, field="status", message=f"Unknown value {raw_status!r}"))
            skipped += 1
            continue

        raw_reg_status = row.get("registration_status", "1").lower()
        reg_status = _REGISTRATION_STATUS_MAP.get(raw_reg_status, 1)

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

        seniority = None
        raw_seniority = row.get("seniority", "")
        if raw_seniority:
            try:
                seniority = int(raw_seniority)
                if seniority < 0:
                    raise ValueError
            except ValueError:
                errors.append(ImportRowError(row=row_index, field="seniority", message="Must be a non-negative integer"))
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

        payload = MemberCreateRequest(
            genre=genre,
            first_name=first_name,
            last_name=last_name,
            date_of_birth=date_of_birth,
            email=email_raw,  # type: ignore[arg-type]
            phone=phone,
            member_category=_MEMBER_CATEGORY_MAP[raw_category],
            seniority=seniority,
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

        try:
            await create_member(db=db, payload=payload, updated_by_user_id=updated_by_user_id)
            created += 1
        except HTTPException as exc:
            errors.append(ImportRowError(row=row_index, field=None, message=exc.detail))
            skipped += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("members_csv_import row=%d error=%s", row_index, exc)
            errors.append(ImportRowError(row=row_index, field=None, message="Unexpected error — row skipped"))
            skipped += 1

    return ImportResultResponse(created=created, skipped=skipped, errors=errors)
