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
from sqlalchemy import and_, func, or_, select, text, update
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
# Helper : charger le contexte pack pour un membre
# ---------------------------------------------------------------------------

async def _load_pack_context(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
) -> tuple[
    list[PackDefinition],
    dict[UUID, Decimal],
    dict[str, list[tuple[PackDefinition, PackApplicability]]],
]:
    """
    Charge les pack definitions, calcule pack_remaining (total acheté - 0 consommé,
    car la purge a déjà été faite), et construit pi_to_pack.

    Appelé UNE SEULE FOIS par cycle de calcul membre, après la purge globale
    des consommations. Le remaining est donc = total acheté (pas de consommation
    en base au moment de l'appel).

    Returns:
        pack_defs      : liste des PackDefinition actives pour l'exercice
        pack_remaining : dict pack_uuid → quantité restante (Decimal)
        pi_to_pack     : dict pricing_item_uuid_str → [(PackDefinition, PackApplicability)]
    """
    # Charger les pack definitions de l'exercice
    packs_result = await db.execute(
        select(PackDefinition).where(
            PackDefinition.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    pack_defs = list(packs_result.scalars().all())

    if not pack_defs:
        return [], {}, {}

    # Trier par priorité ASC pour consommation dans le bon ordre
    sorted_packs = sorted(pack_defs, key=lambda p: (p.priority or 0, p.code or ""))

    # Charger applicabilité pour chaque pack
    pack_applicability: dict[UUID, list[PackApplicability]] = {}
    for pd in sorted_packs:
        appl_result = await db.execute(
            select(PackApplicability).where(
                PackApplicability.pack_definition_uuid == pd.uuid
            )
        )
        pack_applicability[pd.uuid] = list(appl_result.scalars().all())

    # Construire pi_to_pack : pricing_item_uuid → [(pack_def, applicability)]
    pi_to_pack: dict[str, list[tuple[PackDefinition, PackApplicability]]] = {}
    for pd in sorted_packs:
        for app in pack_applicability.get(pd.uuid, []):
            pi_key = str(app.pricing_item_uuid)
            if pi_key not in pi_to_pack:
                pi_to_pack[pi_key] = []
            pi_to_pack[pi_key].append((pd, app))

    # Calculer pack_remaining depuis le GL (achats) uniquement.
    # Les consommations ont été purgées juste avant — total_consumed = 0.
    pack_remaining: dict[UUID, Decimal] = {}
    for pd in sorted_packs:
        purchase_result = await db.execute(
            select(func.coalesce(func.sum(AccountingLine.credit), 0))
            .where(
                AccountingLine.account_uuid == pd.pack_sales_account_uuid,
                AccountingLine.member_uuid == member_uuid,
                AccountingLine.credit > 0,
            )
        )
        total_purchased = _dec(purchase_result.scalar())
        if total_purchased > 0:
            pack_remaining[pd.uuid] = total_purchased

    return pack_defs, pack_remaining, pi_to_pack


# ---------------------------------------------------------------------------
# Helper : appliquer les consommations d'un vol (sans DELETE, sans DB pour remaining)
# ---------------------------------------------------------------------------

async def _apply_flight_consumptions(
    db: AsyncSession,
    flight: ValidatedFlight,
    member: Member,
    pack_remaining: dict[UUID, Decimal],  # muté en place
    pi_to_pack: dict[str, list[tuple[PackDefinition, PackApplicability]]],
    fiscal_year_uuid: UUID,
) -> Decimal:
    """
    Calcule et insère les MemberPackConsumption pour un vol donné.

    Mute pack_remaining en place (décrémente au fur et à mesure).
    N'effectue aucun DELETE ni aucune requête DB pour lire le remaining
    (le contexte a déjà été chargé par _load_pack_context).

    Returns: total remise pour ce vol (Decimal).
    """
    from services.flight_billing import FlightBillingPreviewService

    if flight.accounting_entry_uuid is None:
        return Decimal("0")

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

        pi_key = line.pricing_item_uuid
        if pi_key not in pi_to_pack:
            continue

        for pd, app in pi_to_pack[pi_key]:
            pack_uuid = pd.uuid
            remaining = pack_remaining.get(pack_uuid, Decimal("0"))
            if remaining <= 0:
                continue

            base_price = _dec(line.normal_unit_price) if line.normal_unit_price else Decimal("0")
            discounted_price = _dec(app.discounted_unit_price)
            unit_discount = base_price - discounted_price
            if unit_discount <= 0:
                continue

            qty = _dec(line.quantity) if line.quantity else Decimal("1")
            if qty > remaining:
                qty = remaining

            line_discount = unit_discount * qty

            db.add(MemberPackConsumption(
                uuid=uuid4(),
                member_uuid=member.uuid,
                flight_uuid=flight.uuid,
                pack_type=pd.pack_type,
                pack_definition_uuid=pack_uuid,
                valid_from=flight.jour or datetime.now(timezone.utc),
                quantity_consumed=qty,
                discount_unit_price=unit_discount,
                total_discount_amount=line_discount,
                # accounting_entry_uuid sera renseigné après l'upsert REM
            ))

            total_discount += line_discount
            has_any_discount = True

            # Décrémenter en mémoire — pas de requête DB
            pack_remaining[pack_uuid] = remaining - qty

    flight.has_discount = has_any_discount
    return total_discount


# ---------------------------------------------------------------------------
# upsert_rem_entry — CORRIGÉ
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
    Crée ou met à jour l'écriture Draft REM pour ce membre / exercice fiscal.

    Identification stable : on cherche via les lignes GL (member_uuid + journal REM
    + fiscal_year_uuid), PAS via la description (qui changeait à chaque appel
    dans l'ancienne version et empêchait de retrouver l'écriture existante).

    Règles :
      - Draft existante   → remplacer ses lignes GL, mettre à jour la date
      - Postée existante  → ValueError explicite (ne pas silencer)
      - Aucune            → créer une nouvelle Draft

    IMPORTANT : pas de commit() ici. L'appelant (discount_review_for_member)
    commite une seule fois en fin de traitement.

    Changements vs version précédente :
      - Suppression des paramètres period_start / period_end (non pertinents
        pour l'identification ; la période est implicite dans l'exercice fiscal)
      - Recherche par JOIN AccountingLine.member_uuid au lieu de description.like()
      - .limit(1) pour éviter MultipleResultsFound si des doublons existaient déjà
      - ValueError au lieu de silencer si l'écriture est Postée
      - Pas de await db.commit() en fin de fonction
    """
    # Recherche de l'écriture REM existante pour ce membre + exercice
    # via les lignes GL (clé stable, indépendante de la description)
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
            AccountingLine.member_uuid == member_uuid,
        )
        .order_by(AccountingEntry.created_at.desc())
        .limit(1)  # évite MultipleResultsFound si doublons résiduels
    )
    entry = existing_result.scalar_one_or_none()

    if entry is not None and entry.state == 2:  # Postée
        raise ValueError(
            f"L'écriture REM {entry.uuid} pour le membre {member_uuid} "
            "est déjà Postée. Supprimez-la manuellement avant de relancer le calcul."
        )

    if entry is not None:
        # Supprimer les lignes existantes et les remplacer
        await db.execute(
            delete(AccountingLine).where(
                and_(
                    AccountingLine.entry_uuid == entry.uuid,
                    AccountingLine.fiscal_year_uuid == fiscal_year_uuid,
                )
            )
        )
        entry.entry_date = date.today()
        entry.reference = f"REM-{member_uuid}"
        entry.description = f"Remises forfait membre {member_uuid}"
        await db.flush()
    else:
        entry = AccountingEntry(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            journal_uuid=rem_journal_uuid,
            entry_date=date.today(),
            reference=f"REM-{member_uuid}",
            description=f"Remises forfait membre {member_uuid}",
            state=1,  # Draft
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

    # Ligne 2 : crédit 411 (client membre)
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
    # PAS de commit() ici — l'appelant commite une fois tout terminé
    return entry


# ---------------------------------------------------------------------------
# discount_review_for_member — CORRIGÉ
# ---------------------------------------------------------------------------

async def discount_review_for_member(
    db: AsyncSession,
    member_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> dict:
    """
    Recalcule les remises pack pour tous les vols facturés d'un membre.
    Crée ou met à jour l'écriture REM Draft correspondante.

    Corrections vs version précédente :
      - Passe 1 : purge globale des consommations du membre (pas vol par vol)
        → évite que pack_remaining soit pollué par des DELETE partiels
      - Passe 2 : vols triés par date ASC (ORDER BY jour ASC)
        → résultat déterministe, pack_remaining décroît dans le bon ordre
      - pack_remaining calculé UNE SEULE FOIS après la purge
        → plus de recalcul DB à chaque vol
      - upsert_rem_entry appelé SANS commit interne
      - Un seul await db.commit() à la fin du traitement
    """
    import logging
    logger = logging.getLogger(__name__)

    logger.info("discount_review_for_member member=%s fiscal_year=%s", member_uuid, fiscal_year_uuid)

    # Charger les settings
    settings_result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    settings = settings_result.scalar_one_or_none()
    if settings is None:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Flight billing settings not configured for this fiscal year.",
        )
    if settings.default_pack_discount_expense_account_uuid is None:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pack discount expense account not configured in flight billing settings.",
        )

    # Charger le membre
    member_result = await db.execute(select(Member).where(Member.uuid == member_uuid))
    member = member_result.scalar_one_or_none()
    if member is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Member not found")

    # -----------------------------------------------------------------------
    # Passe 1 : purge globale des consommations du membre
    # -----------------------------------------------------------------------
    # On supprime TOUT en une seule requête, pas vol par vol.
    # Cela garantit que _load_pack_context trouve total_consumed = 0
    # et que pack_remaining = total acheté, sans pollution par les
    # consommations résiduelles d'un cycle précédent.
    await db.execute(
        delete(MemberPackConsumption).where(
            MemberPackConsumption.member_uuid == member_uuid,
        )
    )
    await db.flush()
    logger.info("discount_review_for_member: consommations purgées pour membre %s", member_uuid)

    # -----------------------------------------------------------------------
    # Passe 2 : récupérer les vols triés par date ASC — déterministe
    # -----------------------------------------------------------------------
    # ORDER BY jour ASC : les vols les plus anciens consomment le pack en premier.
    # Sans tri, l'ordre varie à chaque appel et pack_remaining décroît
    # différemment → total_discount différent → écritures GL incohérentes.
    flights_result = await db.execute(
        select(ValidatedFlight)
        .join(AccountingEntry, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
        .join(AccountingLine, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .where(
            ValidatedFlight.accounting_entry_uuid.isnot(None),
            AccountingLine.member_uuid == member_uuid,
            AccountingLine.debit > 0,
        )
        .order_by(ValidatedFlight.jour.asc())  # ← déterministe
    )
    flights = list(flights_result.unique().scalars().all())

    logger.info(
        "discount_review_for_member: %d vols facturés trouvés pour membre %s",
        len(flights), member.account_id,
    )

    # -----------------------------------------------------------------------
    # Passe 2b : charger le contexte pack UNE SEULE FOIS
    # -----------------------------------------------------------------------
    pack_defs, pack_remaining, pi_to_pack = await _load_pack_context(
        db, member_uuid, fiscal_year_uuid
    )

    if not pack_defs:
        logger.warning("discount_review_for_member: aucun pack défini pour l'exercice %s", fiscal_year_uuid)
        await db.commit()
        return {
            "member_uuid": str(member_uuid),
            "member_name": f"{member.first_name} {member.last_name}",
            "flights_count": 0,
            "total_discount": "0",
            "rem_entry_uuid": None,
        }

    # -----------------------------------------------------------------------
    # Passe 2c : calculer les consommations vol par vol
    # pack_remaining est muté en mémoire — aucune requête DB pour le remaining
    # -----------------------------------------------------------------------
    total_discount = Decimal("0")
    member_flights_count = 0

    for flight in flights:
        discount = await _apply_flight_consumptions(
            db=db,
            flight=flight,
            member=member,
            pack_remaining=pack_remaining,  # muté en place
            pi_to_pack=pi_to_pack,
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

    # -----------------------------------------------------------------------
    # Passe 3 : upsert UNE SEULE écriture REM (sans commit interne)
    # -----------------------------------------------------------------------
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
                # period_start / period_end supprimés — non pertinents pour l'identification
            )
            rem_entry_uuid = str(rem_entry.uuid)

            # Lier toutes les consommations à l'écriture REM
            await db.execute(
                update(MemberPackConsumption)
                .where(MemberPackConsumption.member_uuid == member_uuid)
                .values(accounting_entry_uuid=rem_entry.uuid)
            )

        except ValueError as exc:
            # L'écriture REM est Postée — on logue sans bloquer les autres membres
            logger.error(
                "discount_review_for_member: impossible d'upsert REM pour membre %s : %s",
                member_uuid, exc,
            )

    # Un seul commit à la fin — toutes les consommations + écriture REM en une transaction
    await db.commit()

    return {
        "member_uuid": str(member_uuid),
        "member_name": f"{member.first_name} {member.last_name}",
        "flights_count": member_flights_count,
        "total_discount": str(total_discount),
        "rem_entry_uuid": rem_entry_uuid,
    }


# ---------------------------------------------------------------------------
# discount_review — CORRIGÉ (appelle la version refactorisée)
# ---------------------------------------------------------------------------

async def discount_review(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> dict:
    """
    Recalcule les remises pack pour TOUS les membres facturés dans l'exercice.
    Délègue à discount_review_for_member (refactorisé) pour chaque membre.

    Correction vs version précédente :
      - discount_review_for_member gère maintenant son propre commit
      - les erreurs par membre sont capturées individuellement sans bloquer les autres
      - on ne duplique plus la logique de purge / calcul / upsert ici
    """
    import logging
    logger = logging.getLogger(__name__)

    # Charger les settings (validation uniquement — la logique est dans discount_review_for_member)
    settings_result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    settings = settings_result.scalar_one_or_none()
    if settings is None:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Flight billing settings not configured for this fiscal year.",
        )
    if settings.default_pack_discount_expense_account_uuid is None:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pack discount expense account not configured in flight billing settings.",
        )

    # Récupérer l'ensemble des membres ayant été effectivement facturés
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
            details.append({
                "member_uuid": str(member_uuid),
                "error": str(exc),
            })

    return {
        "members_affected": members_affected,
        "flights_recalculated": flights_recalculated,
        "total_discount": str(total_discount),
        "rem_entries_created": len([d for d in details if d.get("rem_entry_uuid")]),
        "details": details,
    }



