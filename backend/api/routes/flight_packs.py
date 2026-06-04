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
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_PRICES, CAP_POST_ACCOUNTING_ENTRIES, CAP_VIEW_FINANCIALS
from models import User
from schemas.flight_packs import (
    ApplicableItemResponse,
    ConsumptionValidFromUpdate,
    MemberPackBalanceResponse,
    MemberPackConsumptionCreate,
    MemberPackConsumptionResponse,
    MemberPackPurchaseRequest,
    MemberPackPurchaseResponse,
    PackDefinitionCreate,
    PackDefinitionResponse,
    PackDefinitionUpdate,
)
from services.flight_packs import (
    buy_pack,
    create_pack_definition,
    get_pack_definition,
    list_applicable_items,
    list_consumptions_for_flight,
    list_consumptions_for_member,
    list_pack_definitions,
    get_member_pack_balance,
    record_consumption,
    update_consumption_valid_from,
    update_pack_definition,
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
    """Buy a pack for a member — creates a posted VT entry."""
    entry = await buy_pack(db, member_uuid, request.pack_definition_uuid, current_user.id)
    return MemberPackPurchaseResponse(
        entry_uuid=entry.uuid,
        reference=entry.reference or "",
        description=entry.description or "",
        amount=Decimal(str(entry.lines[0].debit)) if entry.lines else Decimal("0"),
        units_purchased=Decimal("0"),  # Will be refined when pricing is integrated
    )


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
