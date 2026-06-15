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
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    AccountingAccount,
    AccountingEntry,
    AccountingLine,
    AccountingJournal,
    FlightBillingSettings,
    PackApplicability,
    PackDefinition,
    Member,
    MemberPackConsumption,
    PricingItem,
    ValidatedFlight,
)
from schemas.flight_packs import (
    ApplicableItemCreate,
    ApplicableItemResponse,
    PackDefinitionCreate,
    PackDefinitionUpdate,
    MemberPackConsumptionCreate,
)
from schemas.accounting import AccountingLineCreateRequest, AccountingEntryCreateRequest
from services.flight_billing import _dec

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
        pack_sales_account_uuid=request.pack_sales_account_uuid,
        pack_discount_expense_account_uuid=request.pack_discount_expense_account_uuid,
        priority=request.priority,
    )
    db.add(pack)
    await db.flush()

    for item in request.applicable_items:
        await _add_applicability(db, pack.uuid, item)

    await db.commit()
    # Re-fetch with eager-loaded applicability for serialization
    result = await db.execute(
        select(PackDefinition)
        .where(PackDefinition.uuid == pack.uuid)
        .options(selectinload(PackDefinition.applicability))
    )
    pack = result.scalar_one()
    logger.info("Created pack definition code=%s uuid=%s", pack.code, pack.uuid)
    return pack


async def get_pack_definition(db: AsyncSession, pack_uuid: UUID) -> PackDefinition:
    """Get one pack definition by UUID."""
    result = await db.execute(
        select(PackDefinition)
        .where(PackDefinition.uuid == pack_uuid)
        .options(selectinload(PackDefinition.applicability))
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
    stmt = select(PackDefinition).options(selectinload(PackDefinition.applicability))
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
    # Re-fetch with eager-loaded applicability for serialization
    result = await db.execute(
        select(PackDefinition)
        .where(PackDefinition.uuid == pack.uuid)
        .options(selectinload(PackDefinition.applicability))
    )
    pack = result.scalar_one()
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
        valid_from=request.valid_from,
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
# Discount Review — Recalculate pack discounts for all billed flights
# ---------------------------------------------------------------------------

async def recalculate_pack_consumptions(
    db: AsyncSession,
    flight_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> Decimal:
    """
    Delete existing consumptions for this flight and re-run discount eligibility.
    Uses the preview service to get pricing lines, then matches against pack applicability.
    Returns the total discount amount for this flight.
    """
    from services.flight_billing import FlightBillingPreviewService

    # Delete existing consumptions for this flight
    existing_result = await db.execute(
        select(MemberPackConsumption).where(
            MemberPackConsumption.flight_uuid == flight_uuid
        )
    )
    existing_consumptions = list(existing_result.scalars().all())
    for ec in existing_consumptions:
        await db.delete(ec)
    await db.flush()

    # Get the flight
    flight_result = await db.execute(
        select(ValidatedFlight).where(ValidatedFlight.uuid == flight_uuid)
    )
    flight = flight_result.scalar_one_or_none()
    if flight is None or flight.accounting_entry_uuid is None:
        await db.flush()
        return Decimal("0")

    # Check that the linked accounting entry exists.
    # Pack discount adjustments are tracked via the REM entry (separate from the FL entry),
    # so recalculation works regardless of whether the FL entry is Draft or Posted.
    entry_result = await db.execute(
        select(AccountingEntry).where(AccountingEntry.uuid == flight.accounting_entry_uuid)
    )
    entry = entry_result.scalar_one_or_none()
    if entry is None:
        # Orphaned link — no entry exists
        await db.flush()
        return Decimal("0")

    # Get billing settings
    settings_result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    settings = settings_result.scalar_one_or_none()
    if settings is None:
        return Decimal("0")

    # Run preview to get pricing lines with pack info
    preview_service = FlightBillingPreviewService(db)
    preview = await preview_service.preview_flight(flight_uuid, fiscal_year_uuid=fiscal_year_uuid)
    if not preview.can_apply:
        flight.has_discount = False
        await db.flush()
        return Decimal("0")

    # Get all active pack definitions for this FY with their applicability
    packs_result = await db.execute(
        select(PackDefinition).where(
            PackDefinition.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    pack_defs = list(packs_result.scalars().all())
    if not pack_defs:
        flight.has_discount = False
        await db.flush()
        return Decimal("0")

    # Look up the member from flight pilot_erp_id
    member_account_id = flight.pilot_erp_id
    if not member_account_id:
        flight.has_discount = False
        await db.flush()
        return Decimal("0")

    member_result = await db.execute(
        select(Member).where(Member.account_id == member_account_id)
    )
    member = member_result.scalar_one_or_none()
    if member is None:
        flight.has_discount = False
        await db.flush()
        return Decimal("0")

    # Load member pack balances for all types
    member_balances = await get_member_pack_balance(db, member.uuid, fiscal_year_uuid)
    if not member_balances:
        flight.has_discount = False
        await db.flush()
        return Decimal("0")

    # Pre-load applicability for all pack defs
    pack_applicability: dict[UUID, list[PackApplicability]] = {}
    for pd in pack_defs:
        appl_result = await db.execute(
            select(PackApplicability).where(
                PackApplicability.pack_definition_uuid == pd.uuid
            )
        )
        pack_applicability[pd.uuid] = list(appl_result.scalars().all())

    total_discount = Decimal("0")
    has_any_discount = False

    # Build a map of pricing_item_uuid → (pack_def, applicability)
    # so we can quickly look up any matching pack for each preview line
    pi_to_pack: dict[str, list[tuple[PackDefinition, PackApplicability]]] = {}
    for pd in pack_defs:
        for app in pack_applicability.get(pd.uuid, []):
            pi_key = str(app.pricing_item_uuid)
            if pi_key not in pi_to_pack:
                pi_to_pack[pi_key] = []
            pi_to_pack[pi_key].append((pd, app))

    # Build a quick balance lookup: pack_type → remaining
    balance_map: dict[str, Decimal] = {
        b["pack_type"]: b["units_remaining"] for b in member_balances
    }

    for line in preview.applied_lines:
        if not line.pricing_item_uuid:
            continue
        pi_key = line.pricing_item_uuid
        if pi_key not in pi_to_pack:
            continue

        for pd, app in pi_to_pack[pi_key]:
            remaining = balance_map.get(pd.pack_type, Decimal("0"))
            if remaining <= 0:
                continue

            # Unit discount = normal_unit_price - discounted_unit_price
            base_price = _dec(line.normal_unit_price) if line.normal_unit_price else Decimal("0")
            discounted_price = _dec(app.discounted_unit_price)
            unit_discount = base_price - discounted_price
            if unit_discount <= 0:
                continue

            qty = _dec(line.quantity) if line.quantity else Decimal("1")
            # Can't consume more than remaining
            if qty > remaining:
                qty = remaining

            line_discount = unit_discount * qty

            consumption = MemberPackConsumption(
                uuid=uuid4(),
                member_uuid=member.uuid,
                flight_uuid=flight_uuid,
                pack_type=pd.pack_type,
                valid_from=flight.jour or datetime.now(timezone.utc),
                quantity_consumed=qty,
                discount_unit_price=unit_discount,
                total_discount_amount=line_discount,
            )
            db.add(consumption)
            total_discount += line_discount
            has_any_discount = True
            balance_map[pd.pack_type] = remaining - qty

    flight.has_discount = has_any_discount
    await db.flush()
    return total_discount


async def discount_review(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> dict:
    """
    Recalculate pack discounts for ALL billed flights in a fiscal year.
    Creates/updates REM accounting entries per member.

    Returns summary dict with members_affected, flights_recalculated, total_discount.
    """
    # Load billing settings for REM journal info
    settings_result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    settings = settings_result.scalar_one_or_none()
    if settings is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Flight billing settings not configured for this fiscal year.",
        )

    if settings.default_pack_discount_expense_account_uuid is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pack discount expense account not configured in flight billing settings. "
                   "Set a default pack discount expense account (class 6) first.",
        )

    # Find all billed flights in this FY. Pack discount adjustments are tracked
    # via the REM entry (separate from the FL entry), so recalculation works
    # regardless of whether the FL entry is Draft or Posted.
    flights_result = await db.execute(
        select(ValidatedFlight)
        .join(AccountingEntry, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
        )
    )
    flights = list(flights_result.scalars().all())

    # Group by member to track per-member totals
    member_flights: dict[str, list[ValidatedFlight]] = {}
    for flight in flights:
        pid = flight.pilot_erp_id
        if pid:
            member_flights.setdefault(pid, []).append(flight)

    members_affected = 0
    flights_recalculated = 0
    total_discount = Decimal("0")
    details: list[dict] = []

    for pilot_erp_id, pilot_flights in member_flights.items():
        # Find the member
        member_result = await db.execute(
            select(Member).where(Member.account_id == pilot_erp_id)
        )
        member = member_result.scalar_one_or_none()
        if member is None:
            continue

        member_total_discount = Decimal("0")
        member_flights_count = 0

        for flight in pilot_flights:
            discount = await recalculate_pack_consumptions(
                db, flight.uuid, fiscal_year_uuid, user_id
            )
            if discount > 0:
                member_total_discount += discount
                member_flights_count += 1
                flights_recalculated += 1

        if member_flights_count > 0:
            members_affected += 1
            # Upsert REM entry for this member
            try:
                rem_entry = await upsert_rem_entry(
                    db=db,
                    member_uuid=member.uuid,
                    fiscal_year_uuid=fiscal_year_uuid,
                    rem_journal_uuid=settings.rem_journal_uuid,
                    discount_account_uuid=settings.default_pack_discount_expense_account_uuid,
                    total_discount=member_total_discount,
                    period_start=datetime.now(timezone.utc).replace(day=1),
                    period_end=datetime.now(timezone.utc),
                    user_id=user_id,
                )
                total_discount += member_total_discount
                details.append({
                    "member_uuid": str(member.uuid),
                    "member_name": f"{member.first_name} {member.last_name}",
                    "flights_count": member_flights_count,
                    "total_discount": str(member_total_discount),
                    "rem_entry_uuid": str(rem_entry.uuid),
                })
            except Exception as exc:
                logger.error("Failed to upsert REM entry for member %s: %s", member.uuid, exc)
                details.append({
                    "member_uuid": str(member.uuid),
                    "member_name": f"{member.first_name} {member.last_name}",
                    "flights_count": member_flights_count,
                    "total_discount": str(member_total_discount),
                    "error": str(exc),
                })

    await db.commit()

    return {
        "members_affected": members_affected,
        "flights_recalculated": flights_recalculated,
        "total_discount": total_discount,
        "rem_entries_created": len(details),
        "details": details,
    }


async def discount_review_for_member(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> dict:
    """
    Recalculate pack discounts for a single member's billed flights.
    Creates/updates the REM accounting entry for this member.
    """
    # Load billing settings
    settings_result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    settings = settings_result.scalar_one_or_none()
    if settings is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Flight billing settings not configured for this fiscal year.",
        )

    if settings.default_pack_discount_expense_account_uuid is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pack discount expense account not configured in flight billing settings.",
        )

    # Find the member
    member_result = await db.execute(select(Member).where(Member.uuid == member_uuid))
    member = member_result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")

    # Find all flights for this member. Pack discount adjustments are tracked
    # via the REM entry (separate from the FL entry), so recalculation works
    # regardless of whether the FL entry is Draft or Posted.
    flights_result = await db.execute(
        select(ValidatedFlight)
        .join(AccountingEntry, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
            ValidatedFlight.pilot_erp_id == member.account_id,
        )
    )
    flights = list(flights_result.scalars().all())

    member_total_discount = Decimal("0")
    member_flights_count = 0

    for flight in flights:
        discount = await recalculate_pack_consumptions(
            db, flight.uuid, fiscal_year_uuid, user_id
        )
        if discount > 0:
            member_total_discount += discount
            member_flights_count += 1

    rem_entry_uuid = None
    if member_flights_count > 0:
        try:
            rem_entry = await upsert_rem_entry(
                db=db,
                member_uuid=member.uuid,
                fiscal_year_uuid=fiscal_year_uuid,
                rem_journal_uuid=settings.rem_journal_uuid,
                discount_account_uuid=settings.default_pack_discount_expense_account_uuid,
                total_discount=member_total_discount,
                period_start=datetime.now(timezone.utc).replace(day=1),
                period_end=datetime.now(timezone.utc),
                user_id=user_id,
            )
            rem_entry_uuid = str(rem_entry.uuid)
        except Exception as exc:
            logger.error("Failed to upsert REM entry for member %s: %s", member.uuid, exc)

    await db.commit()

    return {
        "member_uuid": str(member.uuid),
        "member_name": f"{member.first_name} {member.last_name}",
        "flights_count": member_flights_count,
        "total_discount": str(member_total_discount),
        "rem_entry_uuid": rem_entry_uuid,
    }


# ---------------------------------------------------------------------------
# Pack Purchase Accounting
# ---------------------------------------------------------------------------

async def create_pack_purchase_entry(
    db: AsyncSession,
    member_uuid: UUID,
    pack_definition: PackDefinition,
    amount: Decimal,
    user_id: int,
) -> AccountingEntry:
    """
    Create a **posted** accounting entry for a pack purchase.

    Debit 411 (member receivable) for the total amount,
    Credit the pack's sales account.

    The entry is posted immediately — the GL is the source of truth
    for pack balances.
    """
    from services.accounting import get_journal, get_account

    # Find VT journal
    result = await db.execute(
        select(AccountingJournal).where(AccountingJournal.code == "VT")
    )
    vt_journal = result.scalar_one_or_none()
    if vt_journal is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="VT journal (Ventes) not found. Check journal configuration.",
        )

    # Find 411 receivable account
    receivable = await get_account_by_code(db, "411")
    if receivable is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Receivable account 411 not found.",
        )

    # Find the pack sales account
    sales_account = await get_account(db, pack_definition.pack_sales_account_uuid)

    entry_uuid = uuid4()

    # Create as Draft first (state=1) so the DB trigger allows line inserts
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=pack_definition.fiscal_year_uuid,
        journal_uuid=vt_journal.uuid,
        entry_date=datetime.now(timezone.utc),
        reference=f"PACK-{pack_definition.code}",
        description=f"Achat forfait {pack_definition.code} — {pack_definition.name}",
        state=1,  # Draft initially — lines must be added before posting
        created_by=user_id,
    )
    db.add(entry)
    await db.flush()

    # Line 1: Debit 411
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=pack_definition.fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=receivable.uuid,
        member_uuid=member_uuid,
        debit=amount,
    ))

    # Line 2: Credit sales account
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=pack_definition.fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=sales_account.uuid,
        member_uuid=member_uuid,
        credit=amount,
    ))

    # Entry stays Draft — posting is a separate explicit step
    await db.commit()
    await db.refresh(entry)
    return entry


async def buy_pack(
    db: AsyncSession,
    member_uuid: UUID,
    pack_definition_uuid: UUID,
    price: Decimal,
    valid_from: date | None = None,
    user_id: int = 0,
) -> AccountingEntry:
    """
    Buy a pack for a member. Creates a posted VT entry for the pack purchase.
    The entry debits 411 (member receivable) and credits the pack's sales account.
    """
    result = await db.execute(
        select(PackDefinition).where(PackDefinition.uuid == pack_definition_uuid)
    )
    pack = result.scalar_one_or_none()
    if pack is None:
        raise HTTPException(status_code=404, detail="Pack definition not found")

    member_result = await db.execute(select(Member).where(Member.uuid == member_uuid))
    if member_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Member not found")

    # Use the provided price as amount
    return await create_pack_purchase_entry(db, member_uuid, pack, price, user_id)


async def update_consumption_valid_from(
    db: AsyncSession,
    consumption_uuid: UUID,
    valid_from: datetime,
) -> MemberPackConsumption:
    """Update the valid_from date on a pack consumption."""
    result = await db.execute(
        select(MemberPackConsumption).where(MemberPackConsumption.uuid == consumption_uuid)
    )
    consumption = result.scalar_one_or_none()
    if consumption is None:
        raise HTTPException(status_code=404, detail="Pack consumption not found")

    consumption.valid_from = valid_from
    await db.commit()
    await db.refresh(consumption)
    return consumption


async def update_pack_purchase(
    db: AsyncSession,
    entry_uuid: UUID,
    price: Decimal,
    user_id: int,
) -> AccountingEntry:
    """
    Update the price of a Draft pack purchase entry.
    Replaces the debit/credit lines with the new amount.
    """
    result = await db.execute(
        select(AccountingEntry).where(AccountingEntry.uuid == entry_uuid)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Pack purchase entry not found")
    if entry.state != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot edit a pack purchase in state {entry.state} (Draft only)",
        )

    # Read existing lines before deleting them
    existing_lines_result = await db.execute(
        select(AccountingLine).where(AccountingLine.entry_uuid == entry_uuid)
    )
    existing_lines = list(existing_lines_result.scalars().all())
    member_uuid = None
    sales_account_uuid = None
    for line in existing_lines:
        if line.debit and line.debit > 0:
            member_uuid = line.member_uuid
        if line.credit and line.credit > 0:
            sales_account_uuid = line.account_uuid

    # Delete existing lines
    for line in existing_lines:
        await db.delete(line)
    await db.flush()

    # Re-create lines with new amount
    # Line 1: Debit 411
    receivable = await get_account_by_code(db, "411")
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=entry.fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=receivable.uuid,
        member_uuid=member_uuid,
        debit=price,
    ))

    # Line 2: Credit pack sales account
    if not sales_account_uuid:
        # Fallback: find the pack definition to get the sales account
        pack_defs = await db.execute(
            select(PackDefinition).where(
                PackDefinition.fiscal_year_uuid == entry.fiscal_year_uuid
            )
        )
        for pd in pack_defs.scalars().all():
            if pd.pack_sales_account_uuid:
                sales_account_uuid = pd.pack_sales_account_uuid
                break

    if sales_account_uuid:
        db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=entry.fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=sales_account_uuid,
            member_uuid=entry.lines[0].member_uuid if entry.lines else None,
            credit=price,
        ))

    await db.commit()
    await db.refresh(entry)
    return entry


async def get_account_by_code(db: AsyncSession, code: str) -> AccountingAccount | None:
    """Look up an accounting account by its code."""
    result = await db.execute(
        select(AccountingAccount).where(AccountingAccount.code == code)
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# REM Adjustment
# ---------------------------------------------------------------------------

async def compute_rem_adjustment(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    period_start: datetime,
    period_end: datetime,
) -> Decimal:
    """Sum total_discount_amount for non-frozen consumptions in the period."""
    result = await db.execute(
        select(func.coalesce(func.sum(MemberPackConsumption.total_discount_amount), 0))
        .where(
            MemberPackConsumption.member_uuid == member_uuid,
            MemberPackConsumption.created_at >= period_start,
            MemberPackConsumption.created_at < period_end,
        )
    )
    return _dec(result.scalar())


async def upsert_rem_entry(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    rem_journal_uuid: UUID,
    discount_account_uuid: UUID,
    total_discount: Decimal,
    period_start: datetime,
    period_end: datetime,
    user_id: int,
) -> AccountingEntry:
    """
    Create or update the single Draft REM entry for this pilot/period.
    If a Draft entry exists → update its lines.
    If a Posted entry exists with same member/period → create a new Draft.
    Otherwise → create a new Draft entry.
    Debit discount_account_uuid, Credit 411 (member).
    """
    # Check if a REM Draft entry already exists for this member/period
    existing = await db.execute(
        select(AccountingEntry).where(
            AccountingEntry.journal_uuid == rem_journal_uuid,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
            AccountingEntry.state == 1,  # Draft only
            AccountingEntry.description.like(f"REM % {member_uuid} %"),
        )
    )
    entry = existing.scalar_one_or_none()

    if entry:
        # Update existing Draft entry — replace lines safely
        # Use delete-all directly on the relation to avoid trigger issues
        existing_lines = await db.execute(
            select(AccountingLine).where(AccountingLine.entry_uuid == entry.uuid)
        )
        for line in existing_lines.scalars().all():
            await db.delete(line)
        await db.flush()
        entry.reference = f"REM-{period_start.date()}-{period_end.date()}"
        entry.description = f"REM {member_uuid} {period_start.date()} → {period_end.date()}"
    else:
        entry = AccountingEntry(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            journal_uuid=rem_journal_uuid,
            entry_date=period_end,
            reference=f"REM-{period_start.date()}-{period_end.date()}",
            description=f"REM {member_uuid} {period_start.date()} → {period_end.date()}",
            state=1,  # Draft
            created_by=user_id,
        )
        db.add(entry)
        await db.flush()

    # Line 1: Debit discount account (expense)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry.uuid,
        account_uuid=discount_account_uuid,
        member_uuid=member_uuid,
        debit=total_discount,
    ))

    # Line 2: Credit 411 (member receivable)
    receivable = await get_account_by_code(db, "411")
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry.uuid,
        account_uuid=receivable.uuid,
        member_uuid=member_uuid,
        credit=total_discount,
    ))

    await db.commit()
    await db.refresh(entry)
    return entry
