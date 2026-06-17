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

    # Create as Draft first (state=1) so the DB trigger allows line inserts
    description = f"Achat forfait {pack_definition.code} — {pack_definition.name}"
    if valid_from:
        description += f" | VALID_FROM:{valid_from.isoformat()}"
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=pack_definition.fiscal_year_uuid,
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
            MemberPackConsumption.member_uuid == member_uuid,
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
    # Charger les pack definitions de l'exercice
    packs_result = await db.execute(
        select(PackDefinition).where(
            PackDefinition.fiscal_year_uuid == fiscal_year_uuid
        )
    )
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
            AccountingLine.member_uuid == member_uuid,
            AccountingLine.credit > 0,          # ligne crédit = achat pack
            PackDefinition.fiscal_year_uuid == fiscal_year_uuid,
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
        remaining = _dec(line.credit)

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

    for line in preview.applied_lines:
        if not line.pricing_item_uuid:
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
                member_uuid=member.uuid,
                flight_uuid=flight.uuid,
                pack_type=slot.pack_def.pack_type,
                pack_definition_uuid=slot.pack_def.uuid,
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
            AccountingLine.member_uuid == member_uuid,
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

    # Ligne 1 : débit compte charge remises (6xx)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry.uuid,
        account_uuid=discount_account_uuid,
        member_uuid=member_uuid,
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
        member_uuid=member_uuid,
        credit=total_discount,
    ))

    await db.flush()
    return entry


# ---------------------------------------------------------------------------
# discount_review_for_member (v2 — purge vols uniquement, slots FIFO)
# ---------------------------------------------------------------------------

async def discount_review_for_member(
    db: AsyncSession,
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
    logger.info(
        "discount_review_for_member member=%s fiscal_year=%s",
        member_uuid, fiscal_year_uuid,
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

    # -------------------------------------------------------------------
    # Passe 1 : purge des consommations de VOLS uniquement
    # flight_uuid IS NOT NULL → lignes de remise vol
    # flight_uuid IS NULL     → lignes d'achat de pack, préservées
    # -------------------------------------------------------------------
    await db.execute(
        delete(MemberPackConsumption).where(
            MemberPackConsumption.member_uuid == member_uuid,
            MemberPackConsumption.flight_uuid.isnot(None),
        )
    )
    await db.flush()
    logger.info(
        "discount_review_for_member: consommations vols purgées pour membre %s",
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
            AccountingLine.member_uuid == member_uuid,
            AccountingLine.debit > 0,
        )
        .order_by(ValidatedFlight.jour.asc())
    )
    flights = list(flights_result.unique().scalars().all())

    logger.info(
        "discount_review_for_member: %d vols facturés pour membre %s",
        len(flights), member_uuid,
    )

    # -------------------------------------------------------------------
    # Passe 2b : charger les slots de pack (post-purge vols)
    # -------------------------------------------------------------------
    pack_slots, pi_to_slots = await _load_pack_context(db, member_uuid, fiscal_year_uuid)

    if not pack_slots:
        logger.warning(
            "discount_review_for_member: aucun pack acheté pour membre %s exercice %s",
            member_uuid, fiscal_year_uuid,
        )
        await db.commit()
        return {
            "member_uuid": str(member_uuid),
            "member_name": f"{member.first_name} {member.last_name}",
            "flights_count": 0,
            "total_discount": "0",
            "rem_entry_uuid": None,
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
        "discount_review_for_member: total_discount=%s sur %d vols pour membre %s",
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
                    MemberPackConsumption.member_uuid == member_uuid,
                    MemberPackConsumption.flight_uuid.isnot(None),
                )
                .values(accounting_entry_uuid=rem_entry.uuid)
            )
        except ValueError as exc:
            logger.error(
                "discount_review_for_member: upsert REM échoué pour membre %s : %s",
                member_uuid, exc,
            )

    await db.commit()

    return {
        "member_uuid": str(member_uuid),
        "member_name": f"{member.first_name} {member.last_name}",
        "flights_count": member_flights_count,
        "total_discount": str(total_discount),
        "rem_entry_uuid": rem_entry_uuid,
    }


# ---------------------------------------------------------------------------
# discount_review (inchangé dans la logique)
# ---------------------------------------------------------------------------

async def discount_review(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> dict:
    """
    Recalcule les remises pack pour TOUS les membres facturés dans l'exercice.
    Délègue à discount_review_for_member pour chaque membre.
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
        select(AccountingLine.member_uuid)
        .join(AccountingEntry, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .join(ValidatedFlight, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
            AccountingLine.member_uuid.isnot(None),
            AccountingLine.debit > 0,
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
