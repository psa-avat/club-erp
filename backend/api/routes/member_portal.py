"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - member_portal: public token-authenticated endpoints for member self-service
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

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import (
    create_member_portal_token,
    get_member_portal_member,
)
from models import Member
from schemas.member_portal import (
    MemberPortalChangePasswordRequest,
    MemberPortalExpenseDeclaration,
    MemberPortalExpenseListResponse,
    MemberPortalFlightBillingDetail,
    MemberPortalFlightListResponse,
    MemberPortalLoginRequest,
    MemberPortalLoginResponse,
    MemberPortalPackBalance,
    MemberPortalProfile,
    MemberPortalTaxExpenseListResponse,
)
from schemas.members import (
    AccountEntriesResponse,
    AccountSummaryResponse,
    DepositRequest,
    DepositResponse,
    LogbookListResponse,
)
from services.member_portal import (
    authenticate_member,
    change_portal_password,
    declare_expense,
    get_flight_billing_detail,
    get_member_profile,
    list_expenses,
    list_member_flights,
    list_member_packs,
    list_tax_expenses,
)
from services.members import (
    create_member_deposit,
    get_member_account_summary,
    list_member_account_entries,
    list_member_logbook,
)
from schemas.accounting import FiscalYearResponse
from services.accounting import list_fiscal_years

router = APIRouter(prefix="/api/v1/member-portal", tags=["member-portal"])


# ── Auth ───────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=MemberPortalLoginResponse)
async def member_portal_login(
    body: MemberPortalLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate a member using their identifier + password."""
    member = await authenticate_member(
        db=db,
        member_identifier=body.member_identifier,
        password=body.password,
    )
    if member is None:
        raise HTTPException(
            status_code=401,
            detail="Identifiant ou mot de passe invalide",
        )

    token = create_member_portal_token(str(member.uuid))
    profile = await get_member_profile(member)

    return MemberPortalLoginResponse(
        access_token=token,
        expires_at="",  # JWT expiry handling
        member=profile,
    )


@router.patch("/password", status_code=204)
async def member_portal_change_password(
    body: MemberPortalChangePasswordRequest,
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Change the member's portal password."""
    success = await change_portal_password(
        db=db,
        member_uuid=member.uuid,
        current_password=body.current_password,
        new_password=body.new_password,
    )
    if not success:
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect")


# ── Fiscal Years ───────────────────────────────────────────────────────────────

@router.get("/fiscal-years", response_model=list[FiscalYearResponse])
async def member_portal_fiscal_years(
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Return all fiscal years (for the member to select the one to view)."""
    return await list_fiscal_years(db=db)


# ── Flights ────────────────────────────────────────────────────────────────────

@router.get("/flights", response_model=MemberPortalFlightListResponse)
async def member_portal_list_flights(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """List the member's flights with billing status."""
    items, total = await list_member_flights(
        db=db,
        member_uuid=member.uuid,
        limit=limit,
        offset=offset,
    )
    return MemberPortalFlightListResponse(items=items, total=total)


@router.get("/flights/{flight_uuid}/billing", response_model=MemberPortalFlightBillingDetail)
async def member_portal_flight_billing(
    flight_uuid: UUID,
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Get billing detail for a specific flight."""
    detail = await get_flight_billing_detail(
        db=db,
        flight_uuid=flight_uuid,
        member_uuid=member.uuid,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Vol introuvable")
    return detail


@router.get("/logbook", response_model=LogbookListResponse)
async def member_portal_logbook(
    year: int | None = Query(default=None, ge=2000, le=9999),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    group_by: str | None = Query(default=None, pattern="^(machine|type|launch)$"),
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Return paginated logbook entries for the authenticated member."""
    return await list_member_logbook(
        db=db,
        member_uuid=member.uuid,
        year=year,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
        group_by=group_by,
    )


# ── Account ────────────────────────────────────────────────────────────────────

@router.get("/account", response_model=AccountSummaryResponse)
async def member_portal_account_summary(
    fiscal_year_uuid: UUID | None = Query(default=None),
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Account summary: balance."""
    return await get_member_account_summary(
        db=db, member_uuid=member.uuid, fiscal_year_uuid=fiscal_year_uuid,
    )


@router.get("/account/entries", response_model=AccountEntriesResponse)
async def member_portal_account_entries(
    fiscal_year_uuid: UUID | None = Query(default=None),
    state: int | None = Query(default=None, ge=1, le=2),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """List accounting entries where the member appears."""
    return await list_member_account_entries(
        db=db, member_uuid=member.uuid,
        fiscal_year_uuid=fiscal_year_uuid, state=state,
        limit=limit, offset=offset,
    )


@router.post("/deposit", response_model=DepositResponse, status_code=201)
async def member_portal_deposit(
    body: DepositRequest,
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Record a deposit on the member's account."""
    from models import FlightBillingSettings
    from sqlalchemy import select

    settings_result = await db.execute(
        select(FlightBillingSettings).limit(1)
    )
    settings = settings_result.scalar_one_or_none()
    if not settings:
        raise HTTPException(status_code=400, detail="Aucune configuration de dépôt trouvée")

    return await create_member_deposit(
        db=db, member_uuid=member.uuid, payload=body,
        fiscal_year_uuid=settings.fiscal_year_uuid,
    )


@router.get("/account/packs", response_model=list[MemberPortalPackBalance])
async def member_portal_account_packs(
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """List active packs with remaining quantities."""
    return await list_member_packs(db=db, member_uuid=member.uuid)


# ── Expenses ───────────────────────────────────────────────────────────────────

@router.get("/expenses", response_model=MemberPortalExpenseListResponse)
async def member_portal_list_expenses(
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """List expense declarations for the member."""
    items = await list_expenses(db=db, member_uuid=member.uuid)
    return MemberPortalExpenseListResponse(items=items, total=len(items))


@router.post("/expenses", status_code=201)
async def member_portal_declare_expense(
    body: MemberPortalExpenseDeclaration,
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Declare an expense for the club."""
    await declare_expense(
        db=db,
        member_uuid=member.uuid,
        amount=body.amount,
        reason=body.reason,
        receipt_photo=body.receipt_photo,
    )
    return {"status": "ok", "message": "Dépense enregistrée"}




# ── Tax Expenses ───────────────────────────────────────────────────────────────

@router.get("/tax-expenses", response_model=MemberPortalTaxExpenseListResponse)
async def member_portal_tax_expenses(
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """List volunteer expenses for tax declaration purposes."""
    items = await list_tax_expenses(db=db, member_uuid=member.uuid)
    return MemberPortalTaxExpenseListResponse(items=items)
