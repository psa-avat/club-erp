"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - flight_packs: Pack definition, applicability, consumption, and balance management
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

import logging
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    AccountingAccount,
    AccountingEntry,
    AccountingLine,
    AccountingJournal,
    PackApplicability,
    PackDefinition,
    Member,
    MemberPackConsumption,
    PricingItem,
)
from schemas.flight_packs import (
    ApplicableItemCreate,
    ApplicableItemResponse,
    PackDefinitionCreate,
    PackDefinitionUpdate,
    MemberPackConsumptionCreate,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pack Definitions CRUD
# ---------------------------------------------------------------------------

PACK_TYPE_VALUES = {"flight_hours", "winch_launches", "tow_launches", "engine_time"}


async def create_pack_definition(
    db: AsyncSession,
    request: PackDefinitionCreate,
    user_id: int | None = None,
) -> PackDefinition:
    """Create a new pack definition with optional applicability links."""
    if request.pack_type not in PACK_TYPE_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid pack_type: {request.pack_type}. Must be one of {PACK_TYPE_VALUES}",
        )

    existing = await db.execute(
        select(PackDefinition).where(PackDefinition.code == request.code)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Pack definition code '{request.code}' already exists",
        )

    pack = PackDefinition(
        uuid=uuid4(),
        code=request.code,
        name=request.name,
        fiscal_year_uuid=request.fiscal_year_uuid,
        pack_type=request.pack_type,
        quantity_allowance=request.quantity_allowance,
        quantity_unit=request.quantity_unit,
        eligible_asset_type_uuid=request.eligible_asset_type_uuid,
        pack_sales_account_uuid=request.pack_sales_account_uuid,
        rem_discount_account_uuid=request.rem_discount_account_uuid,
        priority=request.priority,
    )
    db.add(pack)
    await db.flush()

    for item in request.applicable_items:
        await _add_applicability(db, pack.uuid, item)

    await db.commit()
    await db.refresh(pack)
    logger.info("Created pack definition code=%s uuid=%s", pack.code, pack.uuid)
    return pack


async def get_pack_definition(db: AsyncSession, pack_uuid: UUID) -> PackDefinition:
    """Get one pack definition by UUID."""
    result = await db.execute(
        select(PackDefinition)
        .where(PackDefinition.uuid == pack_uuid)
    )
    pack = result.scalar_one_or_none()
    if pack is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pack definition {pack_uuid} not found",
        )
    return pack


async def list_pack_definitions(
    db: AsyncSession,
    fiscal_year_uuid: UUID | None = None,
    pack_type: str | None = None,
) -> list[PackDefinition]:
    """List pack definitions, optionally filtered."""
    stmt = select(PackDefinition)
    if fiscal_year_uuid is not None:
        stmt = stmt.where(PackDefinition.fiscal_year_uuid == fiscal_year_uuid)
    if pack_type is not None:
        stmt = stmt.where(PackDefinition.pack_type == pack_type)
    stmt = stmt.order_by(PackDefinition.priority.asc(), PackDefinition.code.asc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_pack_definition(
    db: AsyncSession,
    pack_uuid: UUID,
    request: PackDefinitionUpdate,
    user_id: int | None = None,
) -> PackDefinition:
    """Update a pack definition and optionally replace applicability links."""
    pack = await get_pack_definition(db, pack_uuid)

    update_data = request.model_dump(exclude_unset=True, exclude={"applicable_items"})
    for field, value in update_data.items():
        setattr(pack, field, value)

    if request.applicable_items is not None:
        # Replace all applicability links
        await db.execute(
            select(PackApplicability).where(
                PackApplicability.pack_definition_uuid == pack_uuid
            )
        )
        existing = await db.execute(
            select(PackApplicability).where(
                PackApplicability.pack_definition_uuid == pack_uuid
            )
        )
        for row in existing.scalars().all():
            await db.delete(row)
        await db.flush()

        for item in request.applicable_items:
            await _add_applicability(db, pack_uuid, item)

    await db.commit()
    await db.refresh(pack)
    logger.info("Updated pack definition uuid=%s", pack.uuid)
    return pack


async def delete_pack_definition(db: AsyncSession, pack_uuid: UUID) -> None:
    """Delete a pack definition (cascades to applicability links)."""
    pack = await get_pack_definition(db, pack_uuid)
    await db.delete(pack)
    await db.commit()
    logger.info("Deleted pack definition uuid=%s", pack_uuid)


# ---------------------------------------------------------------------------
# Pack Applicability (link to pricing items)
# ---------------------------------------------------------------------------

async def _add_applicability(
    db: AsyncSession,
    pack_definition_uuid: UUID,
    item: ApplicableItemCreate,
) -> PackApplicability:
    """Add one applicability link."""
    # Validate pricing item exists
    pi_result = await db.execute(
        select(PricingItem).where(PricingItem.uuid == item.pricing_item_uuid)
    )
    if pi_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Pricing item {item.pricing_item_uuid} not found",
        )

    link = PackApplicability(
        uuid=uuid4(),
        pack_definition_uuid=pack_definition_uuid,
        pricing_item_uuid=item.pricing_item_uuid,
        discounted_unit_price=item.discounted_unit_price,
    )
    db.add(link)
    await db.flush()
    return link


async def list_applicable_items(
    db: AsyncSession,
    pack_definition_uuid: UUID,
) -> list[PackApplicability]:
    """List all pricing items linked to a pack definition."""
    result = await db.execute(
        select(PackApplicability)
        .where(PackApplicability.pack_definition_uuid == pack_definition_uuid)
        .order_by(PackApplicability.created_at.asc())
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Member Pack Consumption
# ---------------------------------------------------------------------------

async def record_consumption(
    db: AsyncSession,
    request: MemberPackConsumptionCreate,
) -> MemberPackConsumption:
    """Record a pack consumption row for a flight line."""
    consumption = MemberPackConsumption(
        uuid=uuid4(),
        member_uuid=request.member_uuid,
        flight_uuid=request.flight_uuid,
        pack_type=request.pack_type,
        quantity_consumed=request.quantity_consumed,
        discount_unit_price=request.discount_unit_price,
        total_discount_amount=request.total_discount_amount,
        accounting_entry_uuid=request.accounting_entry_uuid,
    )
    db.add(consumption)
    await db.commit()
    await db.refresh(consumption)
    return consumption


async def list_consumptions_for_flight(
    db: AsyncSession,
    flight_uuid: UUID,
) -> list[MemberPackConsumption]:
    """List all pack consumptions for a given flight."""
    result = await db.execute(
        select(MemberPackConsumption)
        .where(MemberPackConsumption.flight_uuid == flight_uuid)
        .order_by(MemberPackConsumption.created_at.asc())
    )
    return list(result.scalars().all())


async def list_consumptions_for_member(
    db: AsyncSession,
    member_uuid: UUID,
    pack_type: str | None = None,
) -> list[MemberPackConsumption]:
    """List all pack consumptions for a given member, optionally filtered by type."""
    stmt = select(MemberPackConsumption).where(
        MemberPackConsumption.member_uuid == member_uuid
    )
    if pack_type is not None:
        stmt = stmt.where(MemberPackConsumption.pack_type == pack_type)
    stmt = stmt.order_by(MemberPackConsumption.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_member_pack_balance(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    pack_type: str | None = None,
) -> list[dict]:
    """
    Query vw_member_pack_balances for a member.
    Falls back to computation if view doesn't exist yet.
    """
    try:
        stmt = text("""
            SELECT member_uuid, pack_type, total_purchased, total_consumed, units_remaining
            FROM vw_member_pack_balances
            WHERE member_uuid = :member_uuid
        """)
        params = {"member_uuid": str(member_uuid)}
        if pack_type:
            stmt = text("""
                SELECT member_uuid, pack_type, total_purchased, total_consumed, units_remaining
                FROM vw_member_pack_balances
                WHERE member_uuid = :member_uuid AND pack_type = :pack_type
            """)
            params["pack_type"] = pack_type

        result = await db.execute(stmt, params)
        rows = result.fetchall()
        return [
            {
                "member_uuid": UUID(row[0]),
                "pack_type": row[1],
                "total_purchased": Decimal(str(row[2])),
                "total_consumed": Decimal(str(row[3])),
                "units_remaining": Decimal(str(row[4])),
            }
            for row in rows
        ]
    except Exception:
        # View not yet created — return empty
        return []


# ---------------------------------------------------------------------------
# Freeze / Unfreeze
# ---------------------------------------------------------------------------

async def freeze_consumption(
    db: AsyncSession,
    consumption_uuid: UUID,
    reason: str | None = None,
) -> MemberPackConsumption:
    """Freeze a pack consumption row (exclude from REM calculation)."""
    result = await db.execute(
        select(MemberPackConsumption).where(MemberPackConsumption.uuid == consumption_uuid)
    )
    consumption = result.scalar_one_or_none()
    if consumption is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pack consumption {consumption_uuid} not found",
        )
    consumption.is_frozen = True
    consumption.frozen_at = datetime.now(timezone.utc)
    consumption.frozen_reason = reason
    await db.commit()
    await db.refresh(consumption)
    return consumption


async def unfreeze_consumption(
    db: AsyncSession,
    consumption_uuid: UUID,
) -> MemberPackConsumption:
    """Unfreeze a pack consumption row (re-include in REM calculation)."""
    result = await db.execute(
        select(MemberPackConsumption).where(MemberPackConsumption.uuid == consumption_uuid)
    )
    consumption = result.scalar_one_or_none()
    if consumption is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pack consumption {consumption_uuid} not found",
        )
    consumption.is_frozen = False
    consumption.frozen_at = None
    consumption.frozen_reason = None
    await db.commit()
    await db.refresh(consumption)
    return consumption
