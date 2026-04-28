"""
    ERP-CLUB - ERP pour Club de vol à voile
    - members: CRUD endpoints for members, committees, and member sheets
    Copyright (C) 2026  SAFORCADA Patrick
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import require_capability
from constants import CAP_MANAGE_USERS
from models import User
from schemas.members import (
    CommitteeCreateRequest,
    CommitteeMembershipReplaceRequest,
    CommitteeMembershipResponse,
    CommitteeResponse,
    CommitteeUpdateRequest,
    ExpenseAccessResponse,
    ImportResultResponse,
    MemberCreateRequest,
    MemberDetailResponse,
    MemberListFilters,
    MemberSheetResponse,
    MemberSheetUpsertRequest,
    MemberSummaryResponse,
    MemberUpdateRequest,
    RegistrationCompletionRequest,
)
from services.members import (
    complete_member_registration,
    create_committee,
    create_member,
    disable_member_sheet_expense_access,
    enable_member_sheet_expense_access,
    get_committee_or_404,
    get_member_or_404,
    get_member_sheet_or_404,
    import_members_from_csv,
    list_committees,
    list_member_sheets,
    list_members,
    replace_committee_members,
    serialize_member_detail,
    update_committee,
    update_member,
    upsert_member_sheet,
)

router = APIRouter()
members_guard = Depends(require_capability(CAP_MANAGE_USERS))


@router.get("", response_model=list[MemberSummaryResponse])
async def list_members_endpoint(
    search: Optional[str] = Query(default=None),
    status: Optional[int] = Query(default=None, ge=1, le=4),
    member_category: Optional[int] = Query(default=None, ge=1, le=6),
    registration_status: Optional[int] = Query(default=None, ge=1, le=4),
    committee_uuid: Optional[UUID] = Query(default=None),
    can_fly: Optional[bool] = Query(default=None),
    is_instructor: Optional[bool] = Query(default=None),
    is_employee: Optional[bool] = Query(default=None),
    is_executive: Optional[bool] = Query(default=None),
    is_board_member: Optional[bool] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    year: Optional[int] = Query(default=None, ge=2000, le=9999),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    filters = MemberListFilters(
        search=search,
        status=status,
        member_category=member_category,
        registration_status=registration_status,
        committee_uuid=committee_uuid,
        can_fly=can_fly,
        is_instructor=is_instructor,
        is_employee=is_employee,
        is_executive=is_executive,
        is_board_member=is_board_member,
        is_active=is_active,
        year=year,
    )
    return await list_members(db=db, filters=filters)


@router.post("", response_model=MemberDetailResponse)
async def create_member_endpoint(
    payload: MemberCreateRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    member = await create_member(db=db, payload=payload, updated_by_user_id=current_user.id)
    return await serialize_member_detail(db=db, member=member)


@router.get("/committees", response_model=list[CommitteeResponse])
async def list_committees_endpoint(
    active_only: Optional[bool] = Query(default=None),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    return await list_committees(db=db, active_only=active_only)


@router.post("/committees", response_model=CommitteeResponse)
async def create_committee_endpoint(
    payload: CommitteeCreateRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    committee = await create_committee(db=db, payload=payload, updated_by_user_id=current_user.id)
    return CommitteeResponse.model_validate(committee)


@router.get("/committees/{committee_uuid}", response_model=CommitteeResponse)
async def get_committee_endpoint(
    committee_uuid: UUID,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    committee = await get_committee_or_404(db=db, committee_uuid=committee_uuid)
    return CommitteeResponse.model_validate(committee)


@router.patch("/committees/{committee_uuid}", response_model=CommitteeResponse)
async def update_committee_endpoint(
    committee_uuid: UUID,
    payload: CommitteeUpdateRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    committee = await update_committee(
        db=db,
        committee_uuid=committee_uuid,
        payload=payload,
        updated_by_user_id=current_user.id,
    )
    return CommitteeResponse.model_validate(committee)


@router.put("/committees/{committee_uuid}/members/{year}", response_model=list[CommitteeMembershipResponse])
async def replace_committee_members_endpoint(
    committee_uuid: UUID,
    year: int,
    payload: CommitteeMembershipReplaceRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    memberships = await replace_committee_members(
        db=db,
        committee_uuid=committee_uuid,
        membership_year=year,
        payload=payload,
        assigned_by_user_id=current_user.id,
    )
    return [CommitteeMembershipResponse.model_validate(membership) for membership in memberships]


@router.get("/{member_uuid}", response_model=MemberDetailResponse)
async def get_member_endpoint(
    member_uuid: UUID,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    member = await get_member_or_404(db=db, member_uuid=member_uuid)
    return await serialize_member_detail(db=db, member=member)


@router.patch("/{member_uuid}", response_model=MemberDetailResponse)
async def update_member_endpoint(
    member_uuid: UUID,
    payload: MemberUpdateRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    member = await update_member(
        db=db,
        member_uuid=member_uuid,
        payload=payload,
        updated_by_user_id=current_user.id,
    )
    return await serialize_member_detail(db=db, member=member)


@router.post("/{member_uuid}/complete-registration", response_model=MemberDetailResponse)
async def complete_member_registration_endpoint(
    member_uuid: UUID,
    payload: RegistrationCompletionRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    member = await complete_member_registration(
        db=db,
        member_uuid=member_uuid,
        year=payload.year,
        updated_by_user_id=current_user.id,
    )
    return await serialize_member_detail(db=db, member=member)


@router.get("/{member_uuid}/sheets", response_model=list[MemberSheetResponse])
async def list_member_sheets_endpoint(
    member_uuid: UUID,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    return await list_member_sheets(db=db, member_uuid=member_uuid)


@router.get("/{member_uuid}/sheets/{year}", response_model=MemberSheetResponse)
async def get_member_sheet_endpoint(
    member_uuid: UUID,
    year: int,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    sheet = await get_member_sheet_or_404(db=db, member_uuid=member_uuid, year=year)
    return MemberSheetResponse.model_validate(sheet)


@router.put("/{member_uuid}/sheets/{year}", response_model=MemberSheetResponse)
async def upsert_member_sheet_endpoint(
    member_uuid: UUID,
    year: int,
    payload: MemberSheetUpsertRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    sheet = await upsert_member_sheet(
        db=db,
        member_uuid=member_uuid,
        year=year,
        payload=payload,
        updated_by_user_id=current_user.id,
    )
    return MemberSheetResponse.model_validate(sheet)


@router.post("/{member_uuid}/sheets/{year}/expense-access", response_model=ExpenseAccessResponse)
async def enable_member_sheet_expense_access_endpoint(
    member_uuid: UUID,
    year: int,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    return await enable_member_sheet_expense_access(
        db=db,
        member_uuid=member_uuid,
        year=year,
        updated_by_user_id=current_user.id,
    )


@router.delete("/{member_uuid}/sheets/{year}/expense-access", response_model=ExpenseAccessResponse)
async def disable_member_sheet_expense_access_endpoint(
    member_uuid: UUID,
    year: int,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    return await disable_member_sheet_expense_access(
        db=db,
        member_uuid=member_uuid,
        year=year,
        updated_by_user_id=current_user.id,
    )


# ---------------------------------------------------------------------------
# CSV bulk import
# ---------------------------------------------------------------------------

@router.post("/import", response_model=ImportResultResponse)
async def import_members_endpoint(
    file: UploadFile = File(..., description="UTF-8 (or latin-1) CSV file with member data"),
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    """Bulk-import members from a CSV file.

    Rows that pass validation are created immediately.
    Rows with errors are skipped and reported in the response.
    The endpoint always returns 200 with a summary — check the `errors` list.
    """
    content = await file.read()
    return await import_members_from_csv(
        db=db,
        content=content,
        updated_by_user_id=current_user.id,
    )
