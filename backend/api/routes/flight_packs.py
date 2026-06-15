"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - flight_packs: API routes for pack definitions, applicability, and consumption
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

import logging
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_PRICES, CAP_POST_ACCOUNTING_ENTRIES, CAP_VIEW_FINANCIALS
from models import AccountingEntry, AccountingLine, PackDefinition, User, ValidatedFlight
from schemas.flight_packs import (
    ApplicableItemResponse,
    ConsumptionValidFromUpdate,
    DiscountReviewRequest,
    DiscountReviewResponse,
    MemberPackBalanceResponse,
    MemberPackConsumptionCreate,
    MemberPackConsumptionResponse,
    MemberPackPurchaseRequest,
    MemberPackPurchaseResponse,
    PackDefinitionCreate,
    PackPurchaseListResponse,
    PackPurchaseLine,
    PackPurchaseUpdate,
    PackDefinitionResponse,
    PackDefinitionUpdate,
)
from services.flight_packs import (
    buy_pack,
    create_pack_definition,
    discount_review,
    discount_review_for_member,
    get_pack_definition,
    list_applicable_items,
    list_consumptions_for_flight,
    list_consumptions_for_member,
    list_pack_definitions,
    get_member_pack_balance,
    record_consumption,
    update_consumption_valid_from,
    update_pack_definition,
    update_pack_purchase,
    delete_pack_definition,
)

router = APIRouter(prefix="/api/v1/packs", tags=["flight_packs"])
logger = logging.getLogger(__name__)

prices_guard = Depends(require_capability(CAP_MANAGE_PRICES))
view_guard = Depends(require_capability(CAP_VIEW_FINANCIALS))
post_guard = Depends(require_capability(CAP_POST_ACCOUNTING_ENTRIES))


# ---------------------------------------------------------------------------
# Pack Definitions
# ---------------------------------------------------------------------------

@router.get("/definitions", response_model=list[PackDefinitionResponse])
async def list_pack_definitions_endpoint(
    fiscal_year_uuid: UUID | None = None,
    pack_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """List all pack definitions, optionally filtered by fiscal year and/or pack type."""
    return await list_pack_definitions(db, fiscal_year_uuid=fiscal_year_uuid, pack_type=pack_type)


@router.post("/definitions", response_model=PackDefinitionResponse, status_code=status.HTTP_201_CREATED)
async def create_pack_definition_endpoint(
    request: PackDefinitionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Create a new pack definition (pricing catalog template)."""
    return await create_pack_definition(db, request, user_id=current_user.id)


@router.get("/definitions/{pack_uuid}", response_model=PackDefinitionResponse)
async def get_pack_definition_endpoint(
    pack_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """Get details of a specific pack definition."""
    return await get_pack_definition(db, pack_uuid)


@router.put("/definitions/{pack_uuid}", response_model=PackDefinitionResponse)
async def update_pack_definition_endpoint(
    pack_uuid: UUID,
    request: PackDefinitionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Update a pack definition and optionally replace its applicability links."""
    return await update_pack_definition(db, pack_uuid, request, user_id=current_user.id)


@router.delete("/definitions/{pack_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pack_definition_endpoint(
    pack_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
):
    """Delete a pack definition (cascades to applicability links)."""
    await delete_pack_definition(db, pack_uuid)


# ---------------------------------------------------------------------------
# Pack Applicability (link to pricing items)
# ---------------------------------------------------------------------------

@router.get(
    "/definitions/{pack_uuid}/applicable-items",
    response_model=list[ApplicableItemResponse],
)
async def list_applicable_items_endpoint(
    pack_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """List all pricing items linked to a pack definition with their discounted prices."""
    return await list_applicable_items(db, pack_uuid)


# ---------------------------------------------------------------------------
# Member Pack Consumption
# ---------------------------------------------------------------------------

@router.post("/consumptions", response_model=MemberPackConsumptionResponse, status_code=status.HTTP_201_CREATED)
async def record_consumption_endpoint(
    request: MemberPackConsumptionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
):
    """Record a pack consumption for a flight line."""
    return await record_consumption(db, request)


@router.get(
    "/consumptions/by-flight/{flight_uuid}",
    response_model=list[MemberPackConsumptionResponse],
)
async def list_consumptions_by_flight_endpoint(
    flight_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """List all pack consumptions for a given flight."""
    return await list_consumptions_for_flight(db, flight_uuid)


@router.get(
    "/consumptions/by-member/{member_uuid}",
    response_model=list[MemberPackConsumptionResponse],
)
async def list_consumptions_by_member_endpoint(
    member_uuid: UUID,
    pack_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """List all pack consumptions for a given member, optionally filtered by pack type."""
    return await list_consumptions_for_member(db, member_uuid, pack_type=pack_type)


# ---------------------------------------------------------------------------
# Member Pack Balance
# ---------------------------------------------------------------------------

@router.get(
    "/balances/{member_uuid}",
    response_model=list[MemberPackBalanceResponse],
)
async def get_member_pack_balance_endpoint(
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    pack_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """Get remaining pack balances for a member from vw_member_pack_balances."""
    return await get_member_pack_balance(db, member_uuid, fiscal_year_uuid, pack_type=pack_type)


# ---------------------------------------------------------------------------
# Pack Purchase
# ---------------------------------------------------------------------------

@router.post(
    "/purchase/{member_uuid}",
    response_model=MemberPackPurchaseResponse,
    status_code=status.HTTP_201_CREATED,
)
async def buy_pack_endpoint(
    member_uuid: UUID,
    request: MemberPackPurchaseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = post_guard,
):
    """Buy a pack for a member — creates a posted VT entry with custom price."""
    entry = await buy_pack(
        db, member_uuid, request.pack_definition_uuid,
        price=request.price, valid_from=request.valid_from,
        user_id=current_user.id,
    )
    return MemberPackPurchaseResponse(
        entry_uuid=entry.uuid,
        reference=entry.reference or "",
        description=entry.description or "",
        amount=request.price,
        units_purchased=Decimal(str(request.quantity)),
    )


@router.get(
    "/purchases",
    response_model=PackPurchaseListResponse,
)
async def list_pack_purchases(
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """
    List all pack purchases for a fiscal year, grouped by pack definition.
    Returns each purchase entry with member info, amounts, and consumption details.
    """
    # Find all pack sales accounts from active pack definitions
    pack_defs_result = await db.execute(
        select(PackDefinition).where(
            PackDefinition.fiscal_year_uuid == fiscal_year_uuid,
            PackDefinition.pack_sales_account_uuid.isnot(None),
        )
    )
    pack_defs = list(pack_defs_result.scalars().all())
    sales_account_uuids = [pd.pack_sales_account_uuid for pd in pack_defs if pd.pack_sales_account_uuid]

    if not sales_account_uuids:
        return PackPurchaseListResponse(items=[])

    # Find accounting lines with those accounts → these are pack purchases
    from sqlalchemy.orm import joinedload
    lines_result = await db.execute(
        select(AccountingLine)
        .join(AccountingEntry, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .options(
            joinedload(AccountingLine.entry),
            joinedload(AccountingLine.account),
            joinedload(AccountingLine.member),
        )
        .where(
            AccountingLine.account_uuid.in_(sales_account_uuids),
            AccountingLine.fiscal_year_uuid == fiscal_year_uuid,
            AccountingLine.credit > 0,  # Credit lines = revenue
        )
        .order_by(AccountingEntry.entry_date.desc(), AccountingLine.uuid.asc())
    )
    lines = list(lines_result.unique().scalars().all())

    items: list[PackPurchaseLine] = []
    entry_map: dict[UUID, int] = {}  # entry_uuid → index in items

    for al in lines:
        entry = al.entry
        if not entry:
            continue

        # Find which pack def matches
        pack_def = next((pd for pd in pack_defs if pd.pack_sales_account_uuid == al.account_uuid), None)
        if not pack_def:
            continue

        # Get consumptions for this member + pack_type
        consumptions = await list_consumptions_for_member(db, al.member_uuid, pack_def.pack_type)
        total_consumed = sum(c.total_discount_amount for c in consumptions)
        units_consumed = sum(c.quantity_consumed for c in consumptions)

        # Build consumption detail
        consumption_detail = []
        for c in consumptions:
            flight_result = await db.execute(
                select(ValidatedFlight).where(ValidatedFlight.uuid == c.flight_uuid)
            )
            flight = flight_result.scalar_one_or_none()
            consumption_detail.append({
                "consumption_uuid": str(c.uuid),
                "flight_uuid": str(c.flight_uuid),
                "flight_date": str(flight.jour) if flight else None,
                "asset_code": flight.asset_code if flight else None,
                "quantity_consumed": str(c.quantity_consumed),
                "discount_unit_price": str(c.discount_unit_price),
                "total_discount_amount": str(c.total_discount_amount),
                "valid_from": str(c.valid_from.date()) if c.valid_from else None,
            })

        member_name = f"{al.member.first_name} {al.member.last_name}" if al.member else None

        items.append(PackPurchaseLine(
            entry_uuid=entry.uuid,
            reference=entry.reference or "",
            description=entry.description or "",
            entry_date=entry.entry_date if hasattr(entry, 'entry_date') else entry.created_at.date(),
            member_uuid=al.member_uuid,
            member_name=member_name,
            pack_code=pack_def.code,
            pack_type=pack_def.pack_type,
            amount=al.credit or Decimal("0"),
            units_purchased=pack_def.quantity_allowance,
            units_consumed=units_consumed,
            units_remaining=pack_def.quantity_allowance - units_consumed,
            consumptions=consumption_detail,
        ))

    total_amount = sum(item.amount for item in items)
    return PackPurchaseListResponse(items=items, total=total_amount)


# ---------------------------------------------------------------------------
# Consumption valid_from
# ---------------------------------------------------------------------------

@router.patch(
    "/consumptions/{consumption_uuid}/valid-from",
    response_model=MemberPackConsumptionResponse,
)
async def update_consumption_valid_from_endpoint(
    consumption_uuid: UUID,
    request: ConsumptionValidFromUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
):
    """Update the valid_from date on a pack consumption (replaces freeze)."""
    return await update_consumption_valid_from(db, consumption_uuid, request.valid_from)


# ---------------------------------------------------------------------------
# Pack Purchase Update (edit a sold pack)
# ---------------------------------------------------------------------------

@router.patch(
    "/purchases/{entry_uuid}",
    response_model=MemberPackPurchaseResponse,
)
async def update_pack_purchase_endpoint(
    entry_uuid: UUID,
    request: PackPurchaseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = prices_guard,
):
    """Update the price of a Draft pack purchase entry."""
    entry = await update_pack_purchase(db, entry_uuid, request.price, user_id=current_user.id)
    # Find the pack definition for the response
    pack_result = await db.execute(
        select(PackDefinition).where(
            PackDefinition.fiscal_year_uuid == entry.fiscal_year_uuid,
            PackDefinition.pack_sales_account_uuid.isnot(None),
        )
    )
    pack_defs = list(pack_result.scalars().all())
    # Get total debit for amount
    lines_result = await db.execute(
        select(func.coalesce(func.sum(AccountingLine.debit), 0)).where(
            AccountingLine.entry_uuid == entry.uuid
        )
    )
    amount = lines_result.scalar() or Decimal("0")
    return MemberPackPurchaseResponse(
        entry_uuid=entry.uuid,
        reference=entry.reference or "",
        description=entry.description or "",
        amount=amount,
        units_purchased=pack_defs[0].quantity_allowance if pack_defs else Decimal("0"),
    )


# ---------------------------------------------------------------------------
# Discount Review
# ---------------------------------------------------------------------------

@router.post(
    "/discount-review",
    response_model=DiscountReviewResponse,
)
async def discount_review_endpoint(
    request: DiscountReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = post_guard,
):
    """
    Recalculate pack discounts for ALL billed flights in a fiscal year.
    Records consumptions and creates/updates REM accounting entries.
    """
    result = await discount_review(
        db=db,
        fiscal_year_uuid=request.fiscal_year_uuid,
        user_id=current_user.id,
    )
    return DiscountReviewResponse(
        members_affected=result["members_affected"],
        flights_recalculated=result["flights_recalculated"],
        total_discount=result["total_discount"],
        rem_entries_created=result["rem_entries_created"],
        details=result["details"],
    )


@router.post(
    "/discount-review/{member_uuid}",
    response_model=DiscountReviewResponse,
)
async def discount_review_member_endpoint(
    member_uuid: UUID,
    request: DiscountReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = post_guard,
):
    """
    Recalculate pack discounts for a single member's billed flights.
    Records consumptions and creates/updates the REM accounting entry.
    """
    result = await discount_review_for_member(
        db=db,
        member_uuid=member_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        user_id=current_user.id,
    )
    return DiscountReviewResponse(
        members_affected=1 if result["flights_count"] > 0 else 0,
        flights_recalculated=result["flights_count"],
        total_discount=Decimal(result["total_discount"]),
        rem_entries_created=1 if result["rem_entry_uuid"] else 0,
        details=[result],
    )
