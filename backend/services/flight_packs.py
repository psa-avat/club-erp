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
from sqlalchemy import and_, func, or_, select, text, update , delete
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
    pack_type: str | None = None,
) -> list[PackDefinition]:
    """List all pack definitions, optionally filtered by type."""
    stmt = select(PackDefinition).options(selectinload(PackDefinition.applicability))
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
        tiers_uuid=request.tiers_uuid,
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
    pack_definition_uuid: UUID | None = None,
    purchase_entry_uuid: UUID | None = None,
) -> list[MemberPackConsumption]:
    """
    List pack consumptions for a given member.

    `pack_type` filters broadly (e.g. for a member-wide summary).
    `pack_definition_uuid` narrows to one pack template, but members
    routinely buy the same pack template several times in a row (e.g. two
    consecutive 25h packs) — pack_definition_uuid alone still mixes those
    purchases' consumed flights together. Pass `purchase_entry_uuid` when
    the caller means "the flights consumed by THIS specific purchase" —
    it disambiguates down to the exact VT accounting entry.
    """
    stmt = select(MemberPackConsumption).where(
        MemberPackConsumption.tiers_uuid == member_uuid
    )
    if pack_type is not None:
        stmt = stmt.where(MemberPackConsumption.pack_type == pack_type)
    if pack_definition_uuid is not None:
        stmt = stmt.where(MemberPackConsumption.pack_definition_uuid == pack_definition_uuid)
    if purchase_entry_uuid is not None:
        stmt = stmt.where(MemberPackConsumption.purchase_entry_uuid == purchase_entry_uuid)
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
                "member_uuid": UUID(str(row[0])),
                "pack_type": row[1],
                "total_purchased": Decimal(str(row[2])),
                "total_consumed": Decimal(str(row[3])),
                "units_remaining": Decimal(str(row[4])),
            }
            for row in rows
        ]
    except Exception as exc:
        logger.warning("get_member_pack_balance: view query failed for member %s: %s", member_uuid, exc)
        return []




# ---------------------------------------------------------------------------
# Pack Purchase Accounting
# ---------------------------------------------------------------------------

async def _resolve_fiscal_year_for_date(db: AsyncSession, ref_date: date) -> "AccountingFiscalYear":
    """Return the open fiscal year that contains ref_date, or raise 422."""
    from models import AccountingFiscalYear as FY
    result = await db.execute(
        select(FY).where(
            FY.start_date <= ref_date,
            FY.end_date >= ref_date,
            FY.state == 1,  # OPEN
        )
    )
    fy = result.scalar_one_or_none()
    if fy is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No open fiscal year found for date {ref_date}.",
        )
    return fy


async def create_pack_purchase_entry(
    db: AsyncSession,
    member_uuid: UUID,
    pack_definition: PackDefinition,
    amount: Decimal,
    user_id: int,
    valid_from: date | None = None,
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
    ref_date = valid_from or date.today()
    fy = await _resolve_fiscal_year_for_date(db, ref_date)

    # Create as Draft first (state=1) so the DB trigger allows line inserts
    description = f"Achat forfait {pack_definition.code} — {pack_definition.name}"
    if valid_from:
        description += f" | VALID_FROM:{valid_from.isoformat()}"
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=fy.uuid,
        journal_uuid=vt_journal.uuid,
        entry_date=datetime.now(timezone.utc),
        reference=f"PACK-{pack_definition.code}",
        description=description,
        state=1,  # Draft initially — lines must be added before posting
        created_by=user_id,
    )
    db.add(entry)
    await db.flush()

    # Line 1: Debit 411
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fy.uuid,
        entry_uuid=entry_uuid,
        account_uuid=receivable.uuid,
        tiers_uuid=member_uuid,
        debit=amount,
    ))

    # Line 2: Credit sales account (club revenue — not tagged to a member)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fy.uuid,
        entry_uuid=entry_uuid,
        account_uuid=sales_account.uuid,
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
    return await create_pack_purchase_entry(db, member_uuid, pack, price, user_id, valid_from=valid_from)


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
    valid_from: date,
    user_id: int,
) -> AccountingEntry:
    """
    Update the valid_from (activation date) of a pack purchase entry.
    The price cannot be changed because it is already recorded in accounting.
    """
    result = await db.execute(
        select(AccountingEntry).where(AccountingEntry.uuid == entry_uuid)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Pack purchase entry not found")

    # Update the VALID_FROM in the description
    base = entry.description or ""
    # Remove any existing VALID_FROM marker
    import re
    base = re.sub(r'\s*\|\s*VALID_FROM:\d{4}-\d{2}-\d{2}', '', base)
    new_desc = f"{base} | VALID_FROM:{valid_from.isoformat()}"
    entry.description = new_desc

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


# ---------------------------------------------------------------------------
# REM Adjustment (inchangé)
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
            MemberPackConsumption.tiers_uuid == member_uuid,
            MemberPackConsumption.created_at >= period_start,
            MemberPackConsumption.created_at < period_end,
        )
    )
    return _dec(result.scalar())


# ---------------------------------------------------------------------------
# Dataclass interne : slot de pack acheté avec date d'activation
# ---------------------------------------------------------------------------

from dataclasses import dataclass, field as dc_field

@dataclass
class _PackSlot:
    """
    Un pack acheté par un membre, avec sa date d'activation et son solde restant.

    Un membre peut avoir acheté le même type de pack plusieurs fois (ex. 2 x 25h).
    Chaque achat est un _PackSlot distinct, consommé dans l'ordre FIFO (activated_at ASC).

    La date d'activation est lue depuis la description de l'écriture GL VT :
    pattern "VALID_FROM:YYYY-MM-DD". Si absente, on utilise entry_date.
    """
    pack_def: PackDefinition
    applicability: list[PackApplicability]
    activated_at: date
    remaining: Decimal          # quantité restante (heures ou unités)
    purchase_entry_uuid: UUID   # écriture GL VT correspondante


# Préfixe de référence pour distinguer remises et achats dans le journal REM
# Achats pack  → journal VT, reference PACK-{code}
# Remises pack → journal REM, reference REM-DISCOUNT-{member_uuid}
REM_DISCOUNT_REF_PREFIX = "REM-DISCOUNT-"


def _parse_valid_from(description: str | None, entry_date: datetime | date) -> date:
    """
    Extrait la date d'activation depuis la description d'une écriture d'achat.
    Format attendu : '... | VALID_FROM:YYYY-MM-DD'
    Si absent, retourne entry_date (compatibilité avec les achats sans VALID_FROM).
    """
    import re
    if description:
        m = re.search(r'VALID_FROM:(\d{4}-\d{2}-\d{2})', description)
        if m:
            return date.fromisoformat(m.group(1))
    if isinstance(entry_date, datetime):
        return entry_date.date()
    return entry_date


# ---------------------------------------------------------------------------
# Helper : charger le contexte pack pour un membre (v2 — slots avec activated_at)
# ---------------------------------------------------------------------------

async def _load_pack_context(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
) -> tuple[
    list[_PackSlot],
    dict[str, list[_PackSlot]],
]:
    """
    Charge les packs achetés par le membre dans l'exercice, sous forme de slots
    ordonnés par date d'activation (FIFO).

    Changements vs v1 :
      - Retourne list[_PackSlot] au lieu de (pack_defs, pack_remaining, pi_to_pack)
      - Chaque slot porte sa date d'activation (lue depuis la description GL VT)
      - Plusieurs slots du même type de pack sont possibles (packs consécutifs 2x25h)
      - pack_remaining = montant crédité sur le compte pack (journal VT), par slot
      - Les consommations de vols ont déjà été purgées → remaining = total acheté

    Returns:
        pack_slots  : liste de _PackSlot triée par activated_at ASC
        pi_to_slots : dict pricing_item_uuid_str → [_PackSlot]
    """
    # Charger toutes les pack definitions (plus de filtre par exercice)
    packs_result = await db.execute(select(PackDefinition))
    pack_defs = list(packs_result.scalars().all())

    if not pack_defs:
        return [], {}

    pack_def_by_sales_account: dict[UUID, PackDefinition] = {
        pd.pack_sales_account_uuid: pd for pd in pack_defs
    }

    # Charger les applicabilités
    pack_applicability: dict[UUID, list[PackApplicability]] = {}
    for pd in pack_defs:
        appl_result = await db.execute(
            select(PackApplicability).where(
                PackApplicability.pack_definition_uuid == pd.uuid
            )
        )
        pack_applicability[pd.uuid] = list(appl_result.scalars().all())

    # Charger les écritures d'achat de pack depuis le journal VT
    # Une écriture VT avec reference LIKE 'PACK-%' et une ligne au crédit
    # sur le compte pack du membre = un achat de pack.
    purchases_result = await db.execute(
        select(AccountingEntry, AccountingLine)
        .join(
            AccountingLine,
            and_(
                AccountingLine.entry_uuid == AccountingEntry.uuid,
                AccountingLine.fiscal_year_uuid == AccountingEntry.fiscal_year_uuid,
            ),
        )
        .join(
            PackDefinition,
            AccountingLine.account_uuid == PackDefinition.pack_sales_account_uuid,
        )
        .where(
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
            AccountingEntry.reference.like("PACK-%"),
            AccountingLine.credit > 0,          # ligne crédit = achat pack
            # La ligne crédit n'a plus member_uuid, on vérifie via la ligne débit 411
            AccountingEntry.uuid.in_(
                select(AccountingLine.entry_uuid).where(
                    AccountingLine.fiscal_year_uuid == fiscal_year_uuid,
                    AccountingLine.tiers_uuid == member_uuid,
                    AccountingLine.debit > 0,
                )
            ),
        )
        .order_by(AccountingEntry.entry_date.asc())
    )
    rows = purchases_result.all()

    pack_slots: list[_PackSlot] = []
    for entry, line in rows:
        pd = pack_def_by_sales_account.get(line.account_uuid)
        if pd is None:
            continue

        activated_at = _parse_valid_from(entry.description, entry.entry_date)
        # remaining is in the pack's own units (hours, launches…), NOT the monetary
        # credit on the accounting line.  Using line.credit (euros) was wrong: it
        # prevented depletion and broke FIFO switching between multiple packs.
        remaining = _dec(pd.quantity_allowance)

        pack_slots.append(_PackSlot(
            pack_def=pd,
            applicability=pack_applicability.get(pd.uuid, []),
            activated_at=activated_at,
            remaining=remaining,
            purchase_entry_uuid=entry.uuid,
        ))

    # Trier par activated_at ASC → consommation FIFO
    pack_slots.sort(key=lambda s: s.activated_at)

    logger.info(
        "_load_pack_context: %d slot(s) de pack pour membre %s",
        len(pack_slots), member_uuid,
    )

    # Construire pi_to_slots : pricing_item_uuid → [_PackSlot]
    pi_to_slots: dict[str, list[_PackSlot]] = {}
    for slot in pack_slots:
        for app in slot.applicability:
            pi_key = str(app.pricing_item_uuid)
            if pi_key not in pi_to_slots:
                pi_to_slots[pi_key] = []
            pi_to_slots[pi_key].append(slot)

    return pack_slots, pi_to_slots


# ---------------------------------------------------------------------------
# Helper : appliquer les consommations d'un vol (v2 — slots + activated_at)
# ---------------------------------------------------------------------------

async def _apply_flight_consumptions(
    db: AsyncSession,
    flight: ValidatedFlight,
    member: Member,
    pack_slots: list[_PackSlot],  # muté en place (remaining décrémenté FIFO)
    pi_to_slots: dict[str, list[_PackSlot]],
    fiscal_year_uuid: UUID,
) -> Decimal:
    """
    Calcule et insère les MemberPackConsumption pour un vol donné.

    Changements vs v1 :
      - Accepte list[_PackSlot] au lieu de (pack_remaining, pi_to_pack)
      - Filtre les slots non encore activés à la date du vol (activated_at > flight.jour)
      - Consommation FIFO : slot avec activated_at le plus ancien en premier
      - pack_slots[i].remaining muté en mémoire — aucune requête DB

    Returns: total remise pour ce vol (Decimal).
    """
    from services.flight_billing import FlightBillingPreviewService

    if flight.accounting_entry_uuid is None:
        return Decimal("0")

    flight_date: date = (
        flight.jour.date() if isinstance(flight.jour, datetime) else flight.jour
    ) if flight.jour else date.today()

    preview_service = FlightBillingPreviewService(db)
    preview = await preview_service.preview_flight(
        flight.uuid, fiscal_year_uuid=fiscal_year_uuid
    )

    if not preview.can_apply:
        flight.has_discount = False
        return Decimal("0")

    total_discount = Decimal("0")
    has_any_discount = False

    member_uuid_str = str(member.uuid)
    for line in preview.applied_lines:
        if not line.pricing_item_uuid:
            continue

        # Only apply pack discounts to billing lines charged to this specific member.
        # Shared flights produce one line per payer; without this guard, lines
        # belonging to the other pilot would also consume from Marion's pack.
        if line.payer_member_uuid and line.payer_member_uuid != member_uuid_str:
            continue

        pi_key = str(line.pricing_item_uuid)
        if pi_key not in pi_to_slots:
            continue

        base_price = _dec(line.normal_unit_price) if line.normal_unit_price else Decimal("0")
        qty_to_consume = _dec(line.quantity) if line.quantity else Decimal("1")

        # Consommer les slots FIFO (déjà triés par activated_at ASC)
        for slot in pi_to_slots[pi_key]:
            if qty_to_consume <= 0:
                break

            # Ne consommer que les packs activés avant ou à la date du vol
            if flight_date < slot.activated_at:
                logger.debug(
                    "_apply_flight_consumptions: vol %s (%s) antérieur à l'activation "
                    "du pack %s (%s) — slot ignoré",
                    flight.uuid, flight_date, slot.pack_def.code, slot.activated_at,
                )
                continue

            if slot.remaining <= 0:
                continue

            app = next(
                (a for a in slot.applicability if str(a.pricing_item_uuid) == pi_key),
                None,
            )
            if app is None:
                continue

            discounted_price = _dec(app.discounted_unit_price)
            unit_discount = base_price - discounted_price
            if unit_discount <= 0:
                continue

            qty = min(qty_to_consume, slot.remaining)
            line_discount = unit_discount * qty

            db.add(MemberPackConsumption(
                uuid=uuid4(),
                tiers_uuid=member.uuid,
                flight_uuid=flight.uuid,
                pack_type=slot.pack_def.pack_type,
                pack_definition_uuid=slot.pack_def.uuid,
                purchase_entry_uuid=slot.purchase_entry_uuid,
                valid_from=flight.jour or datetime.now(timezone.utc),
                quantity_consumed=qty,
                discount_unit_price=unit_discount,
                total_discount_amount=line_discount,
                # accounting_entry_uuid renseigné après upsert_rem_entry
            ))

            total_discount += line_discount
            has_any_discount = True

            # Décrémenter en mémoire — FIFO
            slot.remaining -= qty
            qty_to_consume -= qty

    flight.has_discount = has_any_discount
    return total_discount


# ---------------------------------------------------------------------------
# upsert_rem_entry (v2 — référence stable REM-DISCOUNT-, pas de commit interne)
# ---------------------------------------------------------------------------

async def upsert_rem_entry(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    rem_journal_uuid: UUID,
    discount_account_uuid: UUID,
    total_discount: Decimal,
    user_id: int,
) -> AccountingEntry:
    """
    Crée ou met à jour l'écriture Draft de REMISE pour ce membre / exercice fiscal.

    Changements vs v1 :
      - Référence stable : REM-DISCOUNT-{member_uuid} — unique par membre/exercice
        → distingue sans ambiguïté les remises des achats (journal VT, ref PACK-*)
      - Recherche par reference exacte + journal + exercice + member_uuid (ligne GL)
        → plus de description.like() instable ni de MultipleResultsFound
      - Pas de commit() — l'appelant commite une seule fois

    Règles :
      - Draft remise existante → remplacer les lignes GL
      - Postée                 → ValueError explicite
      - Aucune                 → créer une nouvelle Draft
    """
    reference = f"{REM_DISCOUNT_REF_PREFIX}{member_uuid}"

    existing_result = await db.execute(
        select(AccountingEntry)
        .join(
            AccountingLine,
            and_(
                AccountingLine.entry_uuid == AccountingEntry.uuid,
                AccountingLine.fiscal_year_uuid == AccountingEntry.fiscal_year_uuid,
            ),
        )
        .where(
            AccountingEntry.journal_uuid == rem_journal_uuid,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
            AccountingEntry.reference == reference,
            AccountingLine.tiers_uuid == member_uuid,
        )
        .order_by(AccountingEntry.created_at.desc())
        .limit(1)
    )
    entry = existing_result.scalar_one_or_none()

    if entry is not None and entry.state == 2:
        raise ValueError(
            f"L'écriture de remise {entry.uuid} pour le membre {member_uuid} "
            "est déjà Postée. Supprimez-la manuellement avant de relancer."
        )

    if entry is not None:
        await db.execute(
            delete(AccountingLine).where(
                and_(
                    AccountingLine.entry_uuid == entry.uuid,
                    AccountingLine.fiscal_year_uuid == fiscal_year_uuid,
                )
            )
        )
        entry.entry_date = date.today()
        entry.description = f"Remises forfait vols membre {member_uuid}"
        await db.flush()
    else:
        entry = AccountingEntry(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            journal_uuid=rem_journal_uuid,
            entry_date=date.today(),
            reference=reference,
            description=f"Remises forfait vols membre {member_uuid}",
            state=1,
            created_by=user_id,
        )
        db.add(entry)
        await db.flush()

    # Ligne 1 : débit compte charge remises (6xx — pas lié à un membre)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry.uuid,
        account_uuid=discount_account_uuid,
        debit=total_discount,
    ))

    # Ligne 2 : crédit 411
    receivable = await get_account_by_code(db, "411")
    if receivable is None:
        raise ValueError("Compte 411 introuvable — vérifier le plan comptable")

    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry.uuid,
        account_uuid=receivable.uuid,
        tiers_uuid=member_uuid,
        credit=total_discount,
    ))

    await db.flush()
    return entry


# ---------------------------------------------------------------------------
# discount_review_for_member — dispatch vers un recalcul incrémental ou complet
# ---------------------------------------------------------------------------

@dataclass
class _IncrementalPlan:
    """
    Plan de reprise incrémentale : uniquement les vols jamais passés en revue
    doivent traverser le FIFO — pack_slots.remaining est reconstruit à partir
    des consommations déjà persistées plutôt que rejoué depuis zéro.
    """
    new_flights: list[ValidatedFlight]
    pack_slots: list[_PackSlot]
    pi_to_slots: dict[str, list[_PackSlot]]


async def _plan_incremental_review(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
) -> "_IncrementalPlan | None":
    """
    Construit un plan pour reprendre la revue des remises là où elle s'est
    arrêtée, ou renvoie None quand un recalcul complet est nécessaire.

    Un vol est "passé en revue" dès que has_discount n'est plus NULL — ce
    champ est renseigné pour CHAQUE vol qui traverse _apply_flight_consumptions,
    qu'il obtienne une remise ou non (contrairement à member_pack_consumptions,
    qui ne trace que les vols effectivement remisés et se fige donc dès qu'un
    pack est épuisé).

    Chaque slot de pack (achat) est identifié par purchase_entry_uuid (l'écriture
    VT correspondante), ce qui permet de reconstruire le solde de CHAQUE achat
    individuellement même quand un membre a acheté le même pack plusieurs fois
    d'affilée (le cas le plus courant : ex. deux forfaits 25h consécutifs).

    Le mode incrémental n'est sûr que si rien n'a pu rebattre l'ordre FIFO ou
    les soldes des vols déjà passés en revue. On retombe donc sur un recalcul
    complet (retour None) si :
      - le membre n'a jamais été passé en revue (pas de base à reprendre) ;
      - un vol déjà revu a été modifié après transfert (erp_status=2) ;
      - un vol "nouveau" est daté avant ou le jour même du dernier vol revu
        (un vol rétrodaté devrait être inséré au milieu du FIFO déjà figé) ;
      - un slot de pack activé avant ou à la date pivot n'a aucune consommation
        enregistrée sous son propre purchase_entry_uuid — signe d'un achat
        rétrodaté après coup, ou de données historiques antérieures au suivi
        par purchase_entry_uuid, jamais vues par la revue précédente.
    """
    reviewed_result = await db.execute(
        select(
            func.max(ValidatedFlight.jour),
            func.bool_or(ValidatedFlight.erp_status == 2),
        )
        .join(AccountingEntry, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
        .join(AccountingLine, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
            ValidatedFlight.has_discount.isnot(None),
            AccountingLine.tiers_uuid == member_uuid,
            AccountingLine.debit > 0,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
        )
    )
    boundary_jour, any_modified_after_transfer = reviewed_result.one()
    if boundary_jour is None or any_modified_after_transfer:
        return None

    new_flights_result = await db.execute(
        select(ValidatedFlight)
        .join(AccountingEntry, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
        .join(AccountingLine, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
            ValidatedFlight.has_discount.is_(None),
            AccountingLine.tiers_uuid == member_uuid,
            AccountingLine.debit > 0,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
        )
        .order_by(ValidatedFlight.jour.asc(), ValidatedFlight.uuid.asc())
    )
    new_flights = list(new_flights_result.unique().scalars().all())

    if not new_flights:
        return _IncrementalPlan(new_flights=[], pack_slots=[], pi_to_slots={})

    if any(f.jour <= boundary_jour for f in new_flights):
        return None

    pack_slots, pi_to_slots = await _load_pack_context(db, member_uuid, fiscal_year_uuid)
    if not pack_slots:
        return None

    # purchase_entry_uuid identifies one specific purchase (VT accounting entry),
    # so it disambiguates consecutive purchases of the same pack_definition —
    # the common case (e.g. a member buying two 25h packs back to back) — with
    # no need to treat them as ambiguous.
    known_purchases_result = await db.execute(
        select(MemberPackConsumption.purchase_entry_uuid)
        .where(
            MemberPackConsumption.tiers_uuid == member_uuid,
            MemberPackConsumption.flight_uuid.isnot(None),
            MemberPackConsumption.purchase_entry_uuid.isnot(None),
        )
        .distinct()
    )
    known_purchases = {row[0] for row in known_purchases_result.all()}
    for slot in pack_slots:
        if slot.activated_at <= boundary_jour and slot.purchase_entry_uuid not in known_purchases:
            # Slot activated within the already-reviewed window but never
            # consumed under its own purchase_entry_uuid — either a purchase
            # backdated after the fact, or legacy data from before
            # purchase_entry_uuid was tracked. A full recompute is needed to
            # settle it correctly and backfill the field going forward.
            return None

    consumed_result = await db.execute(
        select(
            MemberPackConsumption.purchase_entry_uuid,
            func.sum(MemberPackConsumption.quantity_consumed),
        )
        .where(
            MemberPackConsumption.tiers_uuid == member_uuid,
            MemberPackConsumption.flight_uuid.isnot(None),
        )
        .group_by(MemberPackConsumption.purchase_entry_uuid)
    )
    consumed_by_purchase = {row[0]: row[1] for row in consumed_result.all()}
    for slot in pack_slots:
        slot.remaining -= consumed_by_purchase.get(slot.purchase_entry_uuid, Decimal("0"))

    return _IncrementalPlan(new_flights=new_flights, pack_slots=pack_slots, pi_to_slots=pi_to_slots)


async def _run_incremental_review(
    db: AsyncSession,
    member: Member,
    settings: FlightBillingSettings,
    fiscal_year_uuid: UUID,
    user_id: int,
    plan: "_IncrementalPlan",
) -> dict:
    """Traite uniquement les vols jamais revus, à partir de l'état FIFO reconstruit."""
    for flight in plan.new_flights:
        await _apply_flight_consumptions(
            db=db,
            flight=flight,
            member=member,
            pack_slots=plan.pack_slots,
            pi_to_slots=plan.pi_to_slots,
            fiscal_year_uuid=fiscal_year_uuid,
        )
    if plan.new_flights:
        await db.flush()

    total_result = await db.execute(
        select(func.coalesce(func.sum(MemberPackConsumption.total_discount_amount), 0))
        .where(
            MemberPackConsumption.tiers_uuid == member.uuid,
            MemberPackConsumption.flight_uuid.isnot(None),
        )
    )
    total_discount = _dec(total_result.scalar_one())

    flights_count_result = await db.execute(
        select(func.count(func.distinct(MemberPackConsumption.flight_uuid)))
        .where(
            MemberPackConsumption.tiers_uuid == member.uuid,
            MemberPackConsumption.flight_uuid.isnot(None),
        )
    )
    flights_count = flights_count_result.scalar_one()

    logger.info(
        "discount_review_for_member[incremental]: %d nouveau(x) vol(s) traité(s), "
        "total_discount=%s sur %d vols pour membre %s",
        len(plan.new_flights), total_discount, flights_count, member.uuid,
    )

    rem_entry_uuid = None
    if flights_count > 0:
        try:
            rem_entry = await upsert_rem_entry(
                db=db,
                member_uuid=member.uuid,
                fiscal_year_uuid=fiscal_year_uuid,
                rem_journal_uuid=settings.rem_journal_uuid,
                discount_account_uuid=settings.default_pack_discount_expense_account_uuid,
                total_discount=total_discount,
                user_id=user_id,
            )
            rem_entry_uuid = str(rem_entry.uuid)

            await db.execute(
                update(MemberPackConsumption)
                .where(
                    MemberPackConsumption.tiers_uuid == member.uuid,
                    MemberPackConsumption.flight_uuid.isnot(None),
                )
                .values(accounting_entry_uuid=rem_entry.uuid)
            )
        except ValueError as exc:
            logger.error(
                "discount_review_for_member[incremental]: upsert REM échoué pour membre %s : %s",
                member.uuid, exc,
            )

    await db.commit()

    return {
        "member_uuid": str(member.uuid),
        "member_name": f"{member.first_name} {member.last_name}",
        "flights_count": flights_count,
        "total_discount": str(total_discount),
        "rem_entry_uuid": rem_entry_uuid,
        "mode": "incremental",
        "flights_processed": len(plan.new_flights),
    }


async def _run_full_review(
    db: AsyncSession,
    member: Member,
    settings: FlightBillingSettings,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> dict:
    """
    Recalcule les remises pack pour tous les vols facturés d'un membre.

    Changements vs v1 :
      - Purge restreinte aux consommations de VOLS (flight_uuid IS NOT NULL)
        → les consommations d'achat (flight_uuid IS NULL) sont préservées
      - _load_pack_context retourne des _PackSlot avec activated_at
      - _apply_flight_consumptions filtre par activated_at et consomme FIFO
      - Liaison des consommations à l'écriture REM filtrée sur flight_uuid IS NOT NULL
      - Un seul commit() en fin
    """
    # -------------------------------------------------------------------
    # Passe 1 : purge des consommations de VOLS uniquement
    # flight_uuid IS NOT NULL → lignes de remise vol
    # flight_uuid IS NULL     → lignes d'achat de pack, préservées
    # -------------------------------------------------------------------
    await db.execute(
        delete(MemberPackConsumption).where(
            MemberPackConsumption.tiers_uuid == member_uuid,
            MemberPackConsumption.flight_uuid.isnot(None),
        )
    )
    # Reset has_discount flag — clean slate avant recalcul, même pour les vols
    # qui ne seraient plus dans le scope de facturation de l'exercice.
    # NULL (et non False) pour que le prochain appel puisse repartir en mode
    # incrémental dès que ce recalcul complet aura posé une nouvelle base.
    await db.execute(
        update(ValidatedFlight)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
            ValidatedFlight.accounting_entry_uuid.in_(
                select(AccountingEntry.uuid)
                .join(AccountingLine)
                .where(
                    AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
                    AccountingLine.tiers_uuid == member_uuid,
                    AccountingLine.debit > 0,
                )
            ),
        )
        .values(has_discount=None)
    )
    await db.flush()
    logger.info(
        "discount_review_for_member[full]: consommations vols purgées et has_discount reset pour membre %s",
        member_uuid,
    )

    # -------------------------------------------------------------------
    # Passe 2 : vols facturés triés par date ASC — déterministe
    # -------------------------------------------------------------------
    flights_result = await db.execute(
        select(ValidatedFlight)
        .join(AccountingEntry, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
        .join(AccountingLine, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
            AccountingLine.tiers_uuid == member_uuid,
            AccountingLine.debit > 0,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
        )
        .order_by(ValidatedFlight.jour.asc())
    )
    flights = list(flights_result.unique().scalars().all())

    logger.info(
        "discount_review_for_member[full]: %d vols facturés pour membre %s",
        len(flights), member_uuid,
    )

    # -------------------------------------------------------------------
    # Passe 2b : charger les slots de pack (post-purge vols)
    # -------------------------------------------------------------------
    pack_slots, pi_to_slots = await _load_pack_context(db, member_uuid, fiscal_year_uuid)

    if not pack_slots:
        logger.warning(
            "discount_review_for_member[full]: aucun pack acheté pour membre %s exercice %s",
            member_uuid, fiscal_year_uuid,
        )
        # No pack at all for this member: every scoped flight is genuinely
        # reviewed with zero discount. Mark them False (not left at the NULL
        # reset above), so future calls recognize this member as reviewed
        # and can go straight to incremental instead of retrying a full
        # recompute on every call.
        await db.execute(
            update(ValidatedFlight)
            .where(ValidatedFlight.uuid.in_([f.uuid for f in flights]))
            .values(has_discount=False)
        )
        await db.commit()
        return {
            "member_uuid": str(member_uuid),
            "member_name": f"{member.first_name} {member.last_name}",
            "flights_count": 0,
            "total_discount": "0",
            "rem_entry_uuid": None,
            "mode": "full",
        }

    # -------------------------------------------------------------------
    # Passe 2c : consommations vol par vol, FIFO par slot
    # -------------------------------------------------------------------
    total_discount = Decimal("0")
    member_flights_count = 0

    for flight in flights:
        discount = await _apply_flight_consumptions(
            db=db,
            flight=flight,
            member=member,
            pack_slots=pack_slots,
            pi_to_slots=pi_to_slots,
            fiscal_year_uuid=fiscal_year_uuid,
        )
        if discount > 0:
            total_discount += discount
            member_flights_count += 1

    await db.flush()
    logger.info(
        "discount_review_for_member[full]: total_discount=%s sur %d vols pour membre %s",
        total_discount, member_flights_count, member_uuid,
    )

    # -------------------------------------------------------------------
    # Passe 3 : upsert UNE SEULE écriture REM de remise
    # -------------------------------------------------------------------
    rem_entry_uuid = None
    if member_flights_count > 0:
        try:
            rem_entry = await upsert_rem_entry(
                db=db,
                member_uuid=member_uuid,
                fiscal_year_uuid=fiscal_year_uuid,
                rem_journal_uuid=settings.rem_journal_uuid,
                discount_account_uuid=settings.default_pack_discount_expense_account_uuid,
                total_discount=total_discount,
                user_id=user_id,
            )
            rem_entry_uuid = str(rem_entry.uuid)

            # Lier uniquement les consommations de vols à l'écriture REM
            await db.execute(
                update(MemberPackConsumption)
                .where(
                    MemberPackConsumption.tiers_uuid == member_uuid,
                    MemberPackConsumption.flight_uuid.isnot(None),
                )
                .values(accounting_entry_uuid=rem_entry.uuid)
            )
        except ValueError as exc:
            logger.error(
                "discount_review_for_member[full]: upsert REM échoué pour membre %s : %s",
                member_uuid, exc,
            )

    await db.commit()

    return {
        "member_uuid": str(member_uuid),
        "member_name": f"{member.first_name} {member.last_name}",
        "flights_count": member_flights_count,
        "total_discount": str(total_discount),
        "rem_entry_uuid": rem_entry_uuid,
        "mode": "full",
    }


async def discount_review_for_member(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
    *,
    force_full: bool = False,
) -> dict:
    """
    Recalcule les remises pack pour les vols facturés d'un membre.

    Passe en mode incrémental (ne rejoue que les vols jamais passés en revue)
    quand c'est prouvé sûr — voir _plan_incremental_review pour les conditions
    de repli. Sinon, ou si force_full=True (bouton "recalcul complet"), fait
    un recalcul FIFO complet sur tout l'exercice.
    """
    logger.info(
        "discount_review_for_member member=%s fiscal_year=%s force_full=%s",
        member_uuid, fiscal_year_uuid, force_full,
    )

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

    member_result = await db.execute(select(Member).where(Member.uuid == member_uuid))
    member = member_result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")

    plan = None if force_full else await _plan_incremental_review(db, member_uuid, fiscal_year_uuid)
    if plan is not None:
        return await _run_incremental_review(db, member, settings, fiscal_year_uuid, user_id, plan)

    return await _run_full_review(db, member, settings, member_uuid, fiscal_year_uuid, user_id)


# ---------------------------------------------------------------------------
# discount_review (inchangé dans la logique)
# ---------------------------------------------------------------------------

async def discount_review(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    user_id: int,
    *,
    force_full: bool = False,
) -> dict:
    """
    Recalcule les remises pack pour TOUS les membres facturés dans l'exercice.
    Délègue à discount_review_for_member pour chaque membre (mode incrémental
    par défaut, recalcul complet si force_full=True).
    """
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

    lines_result = await db.execute(
        select(AccountingLine.tiers_uuid)
        .join(AccountingEntry, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .join(ValidatedFlight, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
            AccountingLine.tiers_uuid.isnot(None),
            AccountingLine.debit > 0,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
        )
        .distinct()
    )
    member_uuids = [row[0] for row in lines_result.all()]

    members_affected = 0
    flights_recalculated = 0
    total_discount = Decimal("0")
    details: list[dict] = []

    for member_uuid in member_uuids:
        try:
            result = await discount_review_for_member(
                db=db,
                member_uuid=member_uuid,
                fiscal_year_uuid=fiscal_year_uuid,
                user_id=user_id,
                force_full=force_full,
            )
            if result["flights_count"] > 0:
                members_affected += 1
                flights_recalculated += result["flights_count"]
                total_discount += Decimal(result["total_discount"])
            details.append(result)
        except Exception as exc:
            logger.error("discount_review: erreur pour membre %s : %s", member_uuid, exc)
            details.append({"member_uuid": str(member_uuid), "error": str(exc)})

    return {
        "members_affected": members_affected,
        "flights_recalculated": flights_recalculated,
        "total_discount": str(total_discount),
        "rem_entries_created": len([d for d in details if d.get("rem_entry_uuid")]),
        "details": details,
    }


# ---------------------------------------------------------------------------
# Pack Purchase Listing (shared by admin and member portal)
# ---------------------------------------------------------------------------

async def list_pack_purchases_for_member(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    member_uuid: UUID,
    page: int = 1,
    page_size: int = 50,
) -> "PackPurchaseListResponse":
    """
    Return pack purchases for a specific member in a fiscal year.
    Used by both the admin route (with member_uuid filter) and the member portal.
    """
    import re
    from schemas.flight_packs import PackPurchaseListResponse, PackPurchaseLine
    from sqlalchemy.orm import joinedload

    # Find all pack sales accounts
    pack_defs_result = await db.execute(
        select(PackDefinition).where(PackDefinition.pack_sales_account_uuid.isnot(None))
    )
    pack_defs = list(pack_defs_result.scalars().all())
    sales_account_uuids = [pd.pack_sales_account_uuid for pd in pack_defs if pd.pack_sales_account_uuid]

    if not sales_account_uuids:
        return PackPurchaseListResponse(items=[])

    # Credit lines on pack sales accounts = pack purchases
    lines_result = await db.execute(
        select(AccountingLine)
        .join(AccountingEntry, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .options(joinedload(AccountingLine.entry), joinedload(AccountingLine.account))
        .where(
            AccountingLine.account_uuid.in_(sales_account_uuids),
            AccountingLine.fiscal_year_uuid == fiscal_year_uuid,
            AccountingLine.credit > 0,
        )
        .order_by(AccountingEntry.entry_date.desc(), AccountingLine.uuid.asc())
    )
    lines = list(lines_result.unique().scalars().all())

    # Member is on the debit (411 receivable) side of the entry
    member_by_entry: dict[UUID, tuple[UUID | None, object | None]] = {}
    if lines:
        entry_uuids = [al.entry_uuid for al in lines if al.entry]
        debit_lines_result = await db.execute(
            select(AccountingLine).where(
                AccountingLine.entry_uuid.in_(entry_uuids),
                AccountingLine.tiers_uuid == member_uuid,
                AccountingLine.debit > 0,
            )
        )
        for dl in debit_lines_result.unique().scalars().all():
            if dl.entry_uuid not in member_by_entry:
                member_by_entry[dl.entry_uuid] = (dl.tiers_uuid, None)

        if member_by_entry:
            members_result = await db.execute(select(Member).where(Member.uuid == member_uuid))
            member_obj = members_result.scalar_one_or_none()
            member_by_entry = {
                entry_uuid: (tiers_uuid, member_obj)
                for entry_uuid, (tiers_uuid, _) in member_by_entry.items()
            }

    # Keep only this member's purchase lines
    lines = [
        al for al in lines
        if al.entry and member_by_entry.get(al.entry.uuid, (None, None))[0] == member_uuid
    ]

    items: list[PackPurchaseLine] = []
    for al in lines:
        entry = al.entry
        if not entry:
            continue

        pack_def = next((pd for pd in pack_defs if pd.pack_sales_account_uuid == al.account_uuid), None)
        if not pack_def:
            continue

        entry_member_uuid, member_obj = member_by_entry.get(entry.uuid, (None, None))

        # Filter down to this exact purchase — members routinely buy the same
        # pack template several times in a row (e.g. two consecutive 25h packs),
        # so pack_definition_uuid alone would still mix those purchases together.
        consumptions = await list_consumptions_for_member(
            db, entry_member_uuid, pack_def.pack_type, purchase_entry_uuid=entry.uuid,
        )
        units_consumed = sum(c.quantity_consumed for c in consumptions)
        total_discount_eur = sum(c.total_discount_amount for c in consumptions)

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
                "pack_definition_uuid": str(c.pack_definition_uuid) if c.pack_definition_uuid else None,
            })

        member_name = f"{member_obj.first_name} {member_obj.last_name}" if member_obj else None

        valid_from = None
        desc = entry.description or ""
        vf_match = re.search(r'VALID_FROM:(\d{4}-\d{2}-\d{2})', desc)
        if vf_match:
            try:
                valid_from = date.fromisoformat(vf_match.group(1))
            except (ValueError, TypeError):
                pass

        items.append(PackPurchaseLine(
            entry_uuid=entry.uuid,
            reference=entry.reference or "",
            description=entry.description or "",
            entry_date=entry.entry_date if hasattr(entry, 'entry_date') else entry.created_at.date(),
            member_uuid=entry_member_uuid,
            member_name=member_name,
            pack_code=pack_def.code,
            pack_type=pack_def.pack_type,
            amount=al.credit or Decimal("0"),
            valid_from=valid_from,
            units_purchased=pack_def.quantity_allowance,
            units_consumed=units_consumed,
            units_remaining=pack_def.quantity_allowance - units_consumed,
            total_discount=total_discount_eur,
            consumptions=consumption_detail,
        ))

    items.sort(key=lambda x: ((x.member_name or "").lower(), -(x.entry_date.toordinal())))

    total_amount = sum(item.amount for item in items)
    total_count = len(items)
    total_pages = max(1, (total_count + page_size - 1) // page_size)
    offset = (page - 1) * page_size

    return PackPurchaseListResponse(
        items=items[offset: offset + page_size],
        total=total_amount,
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
