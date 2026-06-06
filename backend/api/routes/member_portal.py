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
    MemberPortalAccountEntriesResponse,
    MemberPortalAccountSummary,
    MemberPortalDepositRequest,
    MemberPortalDepositResponse,
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
from services.member_portal import (
    authenticate_member,
    declare_expense,
    get_account_summary,
    get_flight_billing_detail,
    get_member_profile,
    list_account_entries,
    list_expenses,
    list_member_flights,
    list_member_packs,
    list_tax_expenses,
    record_deposit,
)

router = APIRouter(prefix="/api/v1/member-portal", tags=["member-portal"])


# ── Auth ───────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=MemberPortalLoginResponse)
async def member_portal_login(
    body: MemberPortalLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate a member using their identifier + expense access token."""
    member = await authenticate_member(
        db=db,
        member_identifier=body.member_identifier,
        expense_access_token=body.expense_access_token,
    )
    if member is None:
        raise HTTPException(
            status_code=401,
            detail="Identifiant ou code d'accès invalide",
        )

    token = create_member_portal_token(str(member.uuid))
    profile = await get_member_profile(member)

    return MemberPortalLoginResponse(
        access_token=token,
        expires_at="",  # JWT expiry handling
        member=profile,
    )


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


# ── Account ────────────────────────────────────────────────────────────────────

@router.get("/account", response_model=MemberPortalAccountSummary)
async def member_portal_account_summary(
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Account summary: balance, active packs."""
    return await get_account_summary(db=db, member_uuid=member.uuid)


@router.get("/account/entries", response_model=MemberPortalAccountEntriesResponse)
async def member_portal_account_entries(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """List accounting entries where the member appears."""
    items, total = await list_account_entries(
        db=db, member_uuid=member.uuid, limit=limit, offset=offset,
    )
    return MemberPortalAccountEntriesResponse(items=items, total=total)


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


# ── Deposits ───────────────────────────────────────────────────────────────────

@router.post("/deposit", response_model=MemberPortalDepositResponse)
async def member_portal_deposit(
    body: MemberPortalDepositRequest,
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """Record a deposit on the member's account."""
    result = await record_deposit(
        db=db,
        member_uuid=member.uuid,
        amount=body.amount,
        payment_method=body.payment_method,
    )
    return MemberPortalDepositResponse(**result)


# ── Tax Expenses ───────────────────────────────────────────────────────────────

@router.get("/tax-expenses", response_model=MemberPortalTaxExpenseListResponse)
async def member_portal_tax_expenses(
    member: Member = Depends(get_member_portal_member),
    db: AsyncSession = Depends(get_db),
):
    """List volunteer expenses for tax declaration purposes."""
    items = await list_tax_expenses(db=db, member_uuid=member.uuid)
    return MemberPortalTaxExpenseListResponse(items=items)
