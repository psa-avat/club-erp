"""
    ERP-CLUB - ERP pour Club de vol à voile
    - members: CRUD endpoints for members, committees, and member sheets
    Copyright (C) 2026  SAFORCADA Patrick
"""

from datetime import date
from typing import Optional
from uuid import UUID
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi import HTTPException, status as http_status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import require_capability
from constants import CAP_MANAGE_PRICES, CAP_MANAGE_USERS
from models import FlightBillingSettings, User
from schemas.members import (
    AccountEntriesResponse,
    AccountSummaryResponse,
    AnonymizationResultResponse,
    CommitteeCreateRequest,
    CommitteeMembershipReplaceRequest,
    CommitteeMembershipResponse,
    CommitteeResponse,
    CommitteeUpdateRequest,
    DepositRequest,
    DepositResponse,
    ExpenseAccessResponse,
    ImportResultResponse,
    LogbookListResponse,
    MemberCreateRequest,
    MemberDetailResponse,
    MemberListFilters,
    MemberOptionResponse,
    MemberRegistrationCreateRequest,
    MemberRegistrationResponse,
    MemberRegistrationUpdateRequest,
    MemberSheetResponse,
    MemberSheetUpsertRequest,
    MemberSummaryResponse,
    MemberUpdateRequest,
    RegistrationCompletionRequest,
)
from services.members import (
        count_members,
    anonymize_inactive_members,
    create_member_deposit,
    get_member_account_summary,
    list_member_account_entries,
    complete_member_registration,
    create_committee,
    create_member,
    create_member_registration,
    disable_member_sheet_expense_access,
    enable_member_sheet_expense_access,
    export_members_to_csv,
    get_committee_or_404,
    get_member_or_404,
    get_member_sheet_or_404,
    import_members_from_csv,
    list_committees,
    list_member_logbook,
    list_member_registrations,
    list_member_options,
    list_member_sheets,
    list_members,
    replace_committee_members,
    serialize_member_detail,
    update_committee,
    update_member,
    update_member_registration,
    upsert_member_sheet,
)

router = APIRouter()
members_guard = Depends(require_capability(CAP_MANAGE_USERS))


@router.get("", response_model=list[MemberSummaryResponse])
async def list_members_endpoint(
    search: Optional[str] = Query(default=None),
    status: Optional[int] = Query(default=None, ge=1, le=3),
    member_category: Optional[int] = Query(default=None, ge=1, le=8),
    member_categories: Optional[str] = Query(default=None),
    registration_status: Optional[int] = Query(default=None, ge=1, le=2),
    committee_uuid: Optional[UUID] = Query(default=None),
    can_fly: Optional[bool] = Query(default=None),
    is_instructor: Optional[bool] = Query(default=None),
    is_employee: Optional[bool] = Query(default=None),
    is_executive: Optional[bool] = Query(default=None),
    is_board_member: Optional[bool] = Query(default=None),
    last_registration_year: Optional[int] = Query(default=None, ge=2000, le=9999),
    year: Optional[int] = Query(default=None, ge=2000, le=9999),
    registration_state: Optional[str] = Query(default=None, pattern="^(registered|unregistered)$"),
    has_flown_since: Optional[date] = Query(default=None, description="Only members with a flight on or after this date"),
    balance_min: Optional[Decimal] = Query(default=None, description="Minimum account balance filter"),
    balance_max: Optional[Decimal] = Query(default=None, description="Maximum account balance filter"),
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    include_balance: bool = Query(default=False, description="Compute current account balance for each member"),
    include_last_flight: bool = Query(default=False, description="Include date of the member's last flight"),
    fiscal_year_uuid: Optional[UUID] = Query(default=None, description="Scope balance computation to this fiscal year"),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    parsed_member_categories: Optional[list[int]] = None
    if member_categories and member_categories.strip():
        try:
            parsed_member_categories = [int(raw.strip()) for raw in member_categories.split(',') if raw.strip()]
        except ValueError as exc:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="member_categories must be a comma-separated list of integers",
            ) from exc
        if any(category < 1 or category > 8 for category in parsed_member_categories):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="member_categories values must be between 1 and 8",
            )

    filters = MemberListFilters(
        search=search,
        status=status,
        member_category=member_category,
        member_categories=parsed_member_categories,
        registration_status=registration_status,
        committee_uuid=committee_uuid,
        can_fly=can_fly,
        is_instructor=is_instructor,
        is_employee=is_employee,
        is_executive=is_executive,
        is_board_member=is_board_member,
        last_registration_year=last_registration_year,
        year=year,
        registration_state=registration_state,
        has_flown_since=has_flown_since,
        balance_min=balance_min,
        balance_max=balance_max,
    )
    return await list_members(
        db=db, filters=filters, limit=limit, offset=offset,
        include_balance=include_balance,
        include_last_flight=include_last_flight,
        fiscal_year_uuid=fiscal_year_uuid,
    )


@router.get("/count")
async def count_members_endpoint(
    search: Optional[str] = Query(default=None),
    status: Optional[int] = Query(default=None, ge=1, le=3),
    member_category: Optional[int] = Query(default=None, ge=1, le=8),
    member_categories: Optional[str] = Query(default=None),
    registration_status: Optional[int] = Query(default=None, ge=1, le=2),
    committee_uuid: Optional[UUID] = Query(default=None),
    can_fly: Optional[bool] = Query(default=None),
    is_instructor: Optional[bool] = Query(default=None),
    is_employee: Optional[bool] = Query(default=None),
    is_executive: Optional[bool] = Query(default=None),
    is_board_member: Optional[bool] = Query(default=None),
    last_registration_year: Optional[int] = Query(default=None, ge=2000, le=9999),
    year: Optional[int] = Query(default=None, ge=2000, le=9999),
    registration_state: Optional[str] = Query(default=None, pattern="^(registered|unregistered)$"),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    parsed_member_categories: Optional[list[int]] = None
    if member_categories and member_categories.strip():
        try:
            parsed_member_categories = [int(raw.strip()) for raw in member_categories.split(',') if raw.strip()]
        except ValueError as exc:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="member_categories must be a comma-separated list of integers",
            ) from exc
        if any(category < 1 or category > 8 for category in parsed_member_categories):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="member_categories values must be between 1 and 8",
            )

    filters = MemberListFilters(
        search=search,
        status=status,
        member_category=member_category,
        member_categories=parsed_member_categories,
        registration_status=registration_status,
        committee_uuid=committee_uuid,
        can_fly=can_fly,
        is_instructor=is_instructor,
        is_employee=is_employee,
        is_executive=is_executive,
        is_board_member=is_board_member,
        last_registration_year=last_registration_year,
        year=year,
        registration_state=registration_state,
    )
    total = await count_members(db=db, filters=filters)
    return {"total": total}


@router.get("/options", response_model=list[MemberOptionResponse])
async def list_member_options_endpoint(
    search: Optional[str] = Query(default=None),
    member_categories: Optional[str] = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    parsed_member_categories: Optional[list[int]] = None
    if member_categories and member_categories.strip():
        try:
            parsed_member_categories = [int(raw.strip()) for raw in member_categories.split(',') if raw.strip()]
        except ValueError as exc:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="member_categories must be a comma-separated list of integers",
            ) from exc
        if any(category < 1 or category > 8 for category in parsed_member_categories):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="member_categories values must be between 1 and 8",
            )

    return await list_member_options(
        db=db,
        search=search,
        member_categories=parsed_member_categories,
        limit=limit,
    )


@router.post("/anonymize-inactive", response_model=AnonymizationResultResponse)
async def anonymize_inactive_members_endpoint(
    reference_year: Optional[int] = Query(default=None, ge=2000, le=9999),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    return await anonymize_inactive_members(db=db, reference_year=reference_year)


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


@router.get("/committees/{committee_uuid:uuid}", response_model=CommitteeResponse)
async def get_committee_endpoint(
    committee_uuid: UUID,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    committee = await get_committee_or_404(db=db, committee_uuid=committee_uuid)
    return CommitteeResponse.model_validate(committee)


@router.patch("/committees/{committee_uuid:uuid}", response_model=CommitteeResponse)
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


@router.put("/committees/{committee_uuid:uuid}/members/{year}", response_model=list[CommitteeMembershipResponse])
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


# ---------------------------------------------------------------------------
# CSV bulk import / export
# ---------------------------------------------------------------------------

@router.post("/import", response_model=ImportResultResponse)
async def import_members_endpoint(
    file: UploadFile = File(..., description="UTF-8 (or latin-1) CSV file with member data"),
    update_existing: bool = Query(default=False, description="If true, update an existing member matched by ffvp_id, account_id, or email"),
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
        update_existing=update_existing,
        updated_by_user_id=current_user.id,
    )


@router.get("/export", response_class=StreamingResponse)
async def export_members_endpoint(
    status: Optional[int] = Query(default=None, ge=1, le=3),
    member_category: Optional[int] = Query(default=None, ge=1, le=8),
    search: Optional[str] = Query(default=None),
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    """Export filtered members to CSV file."""
    from datetime import datetime

    csv_content = await export_members_to_csv(
        db=db,
        status=status,
        member_category=member_category,
        search=search,
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"members_{timestamp}.csv"

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/{member_uuid:uuid}", response_model=MemberDetailResponse)
async def get_member_endpoint(
    member_uuid: UUID,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    member = await get_member_or_404(db=db, member_uuid=member_uuid)
    return await serialize_member_detail(db=db, member=member)


@router.patch("/{member_uuid:uuid}", response_model=MemberDetailResponse)
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


@router.post("/{member_uuid:uuid}/complete-registration", response_model=MemberDetailResponse)
async def complete_member_registration_endpoint(
    member_uuid: UUID,
    payload: RegistrationCompletionRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    member = await complete_member_registration(
        db=db,
        member_uuid=member_uuid,
        payload=payload,
        updated_by_user_id=current_user.id,
    )
    return await serialize_member_detail(db=db, member=member)


# ── Logbook ──────────────────────────────────────────────────────────────

@router.get("/{member_uuid:uuid}/logbook", response_model=LogbookListResponse)
async def list_member_logbook_endpoint(
    member_uuid: UUID,
    year: Optional[int] = Query(default=None, ge=2000, le=9999),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    group_by: Optional[str] = Query(default=None, pattern="^(machine|type|launch)$"),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    """Return paginated logbook entries for a member with summary KPIs and optional grouping.

    Group by: 'machine', 'type', or 'launch' — returns aggregated rows instead of flat list.
    """
    return await list_member_logbook(
        db=db,
        member_uuid=member_uuid,
        year=year,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
        group_by=group_by,
    )


# ── Account / Balance ─────────────────────────────────────────────────────

@router.get("/{member_uuid:uuid}/account-summary", response_model=AccountSummaryResponse)
async def get_member_account_summary_endpoint(
    member_uuid: UUID,
    fiscal_year_uuid: Optional[UUID] = Query(default=None),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    """Return the account balance summary for a member."""
    return await get_member_account_summary(
        db=db, member_uuid=member_uuid, fiscal_year_uuid=fiscal_year_uuid,
    )


@router.get("/{member_uuid:uuid}/account-entries", response_model=AccountEntriesResponse)
async def list_member_account_entries_endpoint(
    member_uuid: UUID,
    fiscal_year_uuid: Optional[UUID] = Query(default=None),
    state: Optional[int] = Query(default=None, ge=1, le=2),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    """Return paginated accounting entries for a member."""
    return await list_member_account_entries(
        db=db, member_uuid=member_uuid,
        fiscal_year_uuid=fiscal_year_uuid, state=state,
        limit=limit, offset=offset,
    )


@router.post("/{member_uuid:uuid}/deposit", response_model=DepositResponse, status_code=201)
async def create_member_deposit_endpoint(
    member_uuid: UUID,
    payload: DepositRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    """Record a deposit on a member's account (auto-posted)."""
    # Resolve the fiscal year from settings or use a default
    settings_result = await db.execute(
        select(FlightBillingSettings).limit(1)
    )
    settings = settings_result.scalar_one_or_none()
    if not settings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Aucune configuration de dépôt trouvée",
        )
    return await create_member_deposit(
        db=db, member_uuid=member_uuid, payload=payload,
        fiscal_year_uuid=settings.fiscal_year_uuid,
        created_by_user_id=current_user.id,
    )


@router.get("/{member_uuid:uuid}/registrations", response_model=list[MemberRegistrationResponse])
async def list_member_registrations_endpoint(
    member_uuid: UUID,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    return await list_member_registrations(db=db, member_uuid=member_uuid)


@router.post("/{member_uuid:uuid}/registrations", response_model=MemberRegistrationResponse)
async def create_member_registration_endpoint(
    member_uuid: UUID,
    payload: MemberRegistrationCreateRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    registration = await create_member_registration(
        db=db,
        member_uuid=member_uuid,
        payload=payload,
        registered_by_user_id=current_user.id,
    )
    return MemberRegistrationResponse.model_validate(registration)


@router.patch("/{member_uuid:uuid}/registrations/{registration_uuid:uuid}", response_model=MemberRegistrationResponse)
async def update_member_registration_endpoint(
    member_uuid: UUID,
    registration_uuid: UUID,
    payload: MemberRegistrationUpdateRequest,
    current_user: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    registration = await update_member_registration(
        db=db,
        member_uuid=member_uuid,
        registration_uuid=registration_uuid,
        payload=payload,
        updated_by_user_id=current_user.id,
    )
    return MemberRegistrationResponse.model_validate(registration)


@router.get("/{member_uuid:uuid}/sheets", response_model=list[MemberSheetResponse])
async def list_member_sheets_endpoint(
    member_uuid: UUID,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    return await list_member_sheets(db=db, member_uuid=member_uuid)


@router.get("/{member_uuid:uuid}/sheets/{year}", response_model=MemberSheetResponse)
async def get_member_sheet_endpoint(
    member_uuid: UUID,
    year: int,
    _: User = members_guard,
    db: AsyncSession = Depends(get_db),
):
    sheet = await get_member_sheet_or_404(db=db, member_uuid=member_uuid, year=year)
    return MemberSheetResponse.model_validate(sheet)


@router.put("/{member_uuid:uuid}/sheets/{year}", response_model=MemberSheetResponse)
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


@router.post("/{member_uuid:uuid}/sheets/{year}/expense-access", response_model=ExpenseAccessResponse)
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


@router.delete("/{member_uuid:uuid}/sheets/{year}/expense-access", response_model=ExpenseAccessResponse)
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


# ── Member Pack Purchase (Phase 4) ─────────────────────────────────────────

@router.post("/{member_uuid:uuid}/packs")
async def buy_pack_for_member(
    member_uuid: UUID,
    pack_uuid: UUID = Query(...),
    quantity: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_capability(CAP_MANAGE_PRICES)),
):
    """Buy a pack for a member — creates a posted VT entry."""
    from services.flight_packs import create_pack_purchase_entry, get_pack_definition

    pack = await get_pack_definition(db, pack_uuid)
    total = pack.quantity_allowance * quantity
    entry = await create_pack_purchase_entry(
        db=db,
        member_uuid=member_uuid,
        pack_definition=pack,
        amount=total,
        user_id=current_user.id,
    )
    return {"entry_uuid": str(entry.uuid), "total": str(total)}


@router.get("/{member_uuid:uuid}/packs")
async def list_member_packs(
    member_uuid: UUID,
    fiscal_year_uuid: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_capability(CAP_MANAGE_PRICES)),
):
    """List pack balances and consumption detail for a member."""
    from services.flight_packs import get_member_pack_balance, list_consumptions_for_member

    balances = await get_member_pack_balance(db, member_uuid, fiscal_year_uuid)
    return {"balances": balances}
