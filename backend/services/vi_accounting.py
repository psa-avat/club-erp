"""
    ERP-CLUB - ERP pour Club de vol a voile
    - Logiciel libre de gestion d'un club de vol a voile
    - vi_accounting: VI accounting workflow — Steps 2a+2b (realization) and Step 3 (analytical)
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
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import HTTPException, status
from sqlalchemy.orm import joinedload

from models import (
    AccountingAccount,
    AccountingEntry,
    AccountingJournal,
    AccountingLine,
    Asset,
    Member,
    PricingItem,
    PricingVersion,
    ValidatedFlight,
    ViEntitlement,
    ViEntitlementStatus,
    ViFlightLink,
    ViTypeCatalog,
)

logger = logging.getLogger(__name__)

JOURNAL_VI = "VI"  # Dedicated VI journal for all Steps 1–4 entries


async def _get_journal_by_code(db: AsyncSession, code: str) -> AccountingJournal | None:
    result = await db.execute(select(AccountingJournal).where(AccountingJournal.code == code))
    return result.scalar_one_or_none()


def _flight_duration_hours(flight: ValidatedFlight) -> Decimal | None:
    """Return flight duration in decimal hours from HH:MM strings, or None."""
    try:
        th, tm = flight.takeoff_time.split(":")
        lh, lm = flight.landing_time.split(":")
        start_min = int(th) * 60 + int(tm)
        end_min = int(lh) * 60 + int(lm)
        if end_min <= start_min:
            return None
        return Decimal(end_min - start_min) / Decimal(60)
    except (ValueError, TypeError, AttributeError):
        return None


async def _resolve_asset_family_uuid(db: AsyncSession, glider_erp_id: str) -> UUID | None:
    """Return the asset_family_uuid for the given asset UUID string, or None."""
    try:
        asset_uuid = UUID(glider_erp_id)
    except (ValueError, AttributeError):
        return None
    result = await db.execute(select(Asset.asset_family_uuid).where(Asset.uuid == asset_uuid))
    return result.scalar_one_or_none()


async def _resolve_hourly_rate(
    db: AsyncSession,
    asset_family_uuid: UUID,
    fiscal_year_uuid: UUID,
    flight_date,
) -> Decimal | None:
    """
    Return base_price for unit=1 (FlightTime hours) from the active PricingVersion
    covering flight_date for the given asset_family.
    """
    stmt = (
        select(PricingItem.base_price)
        .join(PricingVersion, PricingItem.pricing_version_uuid == PricingVersion.uuid)
        .where(
            PricingVersion.fiscal_year_uuid == fiscal_year_uuid,
            PricingVersion.asset_family_uuid == asset_family_uuid,
            PricingVersion.status == 2,  # Active
            PricingVersion.from_date <= flight_date,
            or_(PricingVersion.to_date.is_(None), PricingVersion.to_date >= flight_date),
            PricingItem.unit == 1,  # FlightTime(h)
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_vi_analytical_entry(
    db: AsyncSession,
    flight: ValidatedFlight,
    flight_link: ViFlightLink,
    vi_type: ViTypeCatalog,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> AccountingEntry | None:
    """
    Create a Draft OD analytical entry (D 921 / C 902) for one VI flight.

    Called during FL billing when the flight carries a vi_erp_id.
    Does NOT commit — the caller (apply_flight_billing) owns the transaction.

    Returns the created entry, or None if any required data is missing
    (misconfigured vi_type accounts, unknown glider, no matching pricing).
    In every None case a WARNING is logged; the FL entry is NOT rolled back.
    """
    cost_acc_uuid = vi_type.analytical_cost_account_uuid
    refl_acc_uuid = vi_type.analytical_reflection_account_uuid

    if not cost_acc_uuid or not refl_acc_uuid:
        logger.warning(
            "VI analytical: vi_type %s missing analytical account config — skipping",
            vi_type.code,
        )
        return None

    if flight_link.analytical_entry_uuid is not None:
        logger.info(
            "VI analytical: flight_link %s already has entry %s — skipping",
            flight_link.uuid,
            flight_link.analytical_entry_uuid,
        )
        return None

    vi_journal = await _get_journal_by_code(db, JOURNAL_VI)
    if vi_journal is None:
        logger.error("VI analytical: VI journal not found in DB — skipping")
        return None

    duration = _flight_duration_hours(flight)
    if not duration:
        logger.warning("VI analytical: zero/invalid duration for flight %s — skipping", flight.uuid)
        return None

    if not flight.glider_erp_id:
        logger.warning("VI analytical: flight %s has no glider_erp_id — skipping", flight.uuid)
        return None

    asset_family_uuid = await _resolve_asset_family_uuid(db, flight.glider_erp_id)
    if asset_family_uuid is None:
        logger.warning(
            "VI analytical: asset not found for glider_erp_id=%s — skipping",
            flight.glider_erp_id,
        )
        return None

    rate = await _resolve_hourly_rate(db, asset_family_uuid, fiscal_year_uuid, flight.jour)
    if rate is None:
        logger.warning(
            "VI analytical: no active FlightTime(h) pricing for asset_family=%s on %s — skipping",
            asset_family_uuid,
            flight.jour,
        )
        return None

    amount = (duration * rate).quantize(Decimal("0.0001"))

    entitlement_code = flight_link.entitlement.code if flight_link.entitlement else "?"
    entry_uuid = uuid4()

    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=vi_journal.uuid,
        entry_date=flight.jour,
        reference=f"VI-ANA-{entitlement_code}-{flight_link.sequence}",
        description=f"Analytique VI {entitlement_code} vol {flight_link.sequence}",
        state=1,  # Draft
        created_by=user_id,
    )
    db.add(entry)
    await db.flush()

    try:
        glider_uuid = UUID(flight.glider_erp_id)
    except (ValueError, TypeError):
        glider_uuid = None

    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=cost_acc_uuid,
        tiers_uuid=glider_uuid,
        debit=amount,
        credit=Decimal("0"),
    ))
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=refl_acc_uuid,
        tiers_uuid=None,
        debit=Decimal("0"),
        credit=amount,
    ))
    await db.flush()

    flight_link.analytical_entry_uuid = entry_uuid
    logger.info(
        "VI analytical: created OD entry %s for flight %s amount=%s",
        entry_uuid,
        flight.uuid,
        amount,
    )
    return entry


# ── Steps 2a + 2b: Realization (VT entry) ─────────────────────────────────

async def _load_entitlement_for_accounting(db: AsyncSession, entitlement_uuid: UUID) -> ViEntitlement:
    """Load a ViEntitlement with vi_type and its accounting accounts eagerly."""
    result = await db.execute(
        select(ViEntitlement)
        .options(
            joinedload(ViEntitlement.vi_type).options(
                joinedload(ViTypeCatalog.client_account),
                joinedload(ViTypeCatalog.revenue_account),
                joinedload(ViTypeCatalog.insurance_account),
                joinedload(ViTypeCatalog.insurance_expense_account),
                joinedload(ViTypeCatalog.insurance_revenue_account),
            )
        )
        .where(ViEntitlement.uuid == entitlement_uuid)
    )
    entitlement = result.unique().scalar_one_or_none()
    if entitlement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VI entitlement not found")
    return entitlement


async def create_vi_realization_entry(
    db: AsyncSession,
    entitlement_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
    entry_date=None,
) -> AccountingEntry:
    """
    Create the VT realization entry for Steps 2a + 2b.

    D client_advance (amount_ttc)       tiers=buyer_member
    D insurance_expense (insurance_amount)                  [if insurance_expense_account configured]
      C revenue          (flight_portion = amount_ttc - insurance_amount)
      C insurance_revenue (insurance_amount)                [if insurance_revenue_account configured]
      C insurance       (insurance_amount)  tiers=insurance_tiers  [if insurance configured]

    Sets entitlement.realization_entry_uuid on success.
    Does NOT commit — caller owns the transaction.
    """
    entitlement = await _load_entitlement_for_accounting(db, entitlement_uuid)

    if entitlement.realization_entry_uuid is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Realization entry already exists: {entitlement.realization_entry_uuid}",
        )

    if entitlement.amount_ttc is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="amount_ttc must be set on the entitlement before creating the realization entry",
        )

    vi_type = entitlement.vi_type
    if vi_type is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VI type not found")

    client_acc = vi_type.client_account
    revenue_acc = vi_type.revenue_account
    if client_acc is None or revenue_acc is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="VI type is missing client_account_uuid or revenue_account_uuid — configure in VI type settings",
        )

    amount_ttc = Decimal(str(entitlement.amount_ttc))
    # Per-entitlement override takes priority over vi_type insurance_amount
    if entitlement.insurance_amount_override is not None:
        insurance_amount = Decimal(str(entitlement.insurance_amount_override))
    elif vi_type.insurance_amount:
        insurance_amount = Decimal(str(vi_type.insurance_amount))
    else:
        insurance_amount = Decimal("0")
    flight_portion = amount_ttc - insurance_amount

    if flight_portion < Decimal("0"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"insurance_amount ({insurance_amount}) exceeds amount_ttc ({amount_ttc})",
        )

    vt_journal = await _get_journal_by_code(db, JOURNAL_VI)
    if vt_journal is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="VI journal not found in DB")

    eff_date = entry_date or entitlement.realisation_date
    if eff_date is None:
        from datetime import date as _date
        eff_date = _date.today()

    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=vt_journal.uuid,
        entry_date=eff_date,
        reference=f"VI-REAL-{entitlement.code}",
        description=f"Réalisation VI {entitlement.code}",
        state=1,  # Draft
        created_by=user_id,
    )
    db.add(entry)
    await db.flush()

    # D client_advance — always full amount_ttc
    expense_acc = vi_type.insurance_expense_account
    use_expense_line = expense_acc is not None and insurance_amount > Decimal("0")
    advance_debit = amount_ttc
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=client_acc.uuid,
        tiers_uuid=entitlement.buyer_member_uuid,
        debit=advance_debit,
        credit=Decimal("0"),
        description=f"Avances VI {entitlement.code}",
    ))

    # D insurance_expense_account (insurance_amount) — only when configured
    if use_expense_line:
        db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=expense_acc.uuid,
            tiers_uuid=vi_type.insurance_tiers_uuid,
            debit=insurance_amount,
            credit=Decimal("0"),
            description=f"Charge assurance VI {entitlement.code}",
        ))

    # C revenue — reduced to flight_portion only when insurance_revenue_account is
    # configured (its credit line below then carries the insurance_amount); otherwise
    # falls back to crediting the full amount_ttc, same as before this account existed.
    insurance_revenue_acc = vi_type.insurance_revenue_account
    use_insurance_revenue_line = insurance_amount > Decimal("0") and insurance_revenue_acc is not None
    revenue_credit = flight_portion if use_insurance_revenue_line else amount_ttc
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=revenue_acc.uuid,
        tiers_uuid=None,
        debit=Decimal("0"),
        credit=revenue_credit,
        description=f"Prestations VI {entitlement.code}",
    ))

    # C insurance_revenue_account (insurance_amount) — only when configured
    if use_insurance_revenue_line:
        db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=insurance_revenue_acc.uuid,
            tiers_uuid=None,
            debit=Decimal("0"),
            credit=insurance_amount,
            description=f"Assurance VI {entitlement.code}",
        ))

    # C insurance (insurance_amount) — only if configured and non-zero
    if insurance_amount > Decimal("0") and vi_type.insurance_account is not None:
        db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=vi_type.insurance_account.uuid,
            tiers_uuid=vi_type.insurance_tiers_uuid,
            debit=Decimal("0"),
            credit=insurance_amount,
            description=f"Assurance VI {entitlement.code}",
        ))
    elif insurance_amount > Decimal("0") and vi_type.insurance_account is None:
        logger.warning(
            "VI realization %s: insurance_amount=%s but no insurance_account configured — "
            "insurance line omitted, entry may be unbalanced",
            entitlement.code,
            insurance_amount,
        )

    await db.flush()

    entitlement.realization_entry_uuid = entry_uuid
    logger.info(
        "VI realization: created VT entry %s for entitlement %s amount_ttc=%s",
        entry_uuid,
        entitlement.code,
        amount_ttc,
    )
    return entry


async def create_vi_reimbursement_entry(
    db: AsyncSession,
    entitlement_uuid: UUID,
    fiscal_year_uuid: UUID,
    bank_account_uuid: UUID,
    amount_override: Decimal | None,
    notes: str | None,
    user_id: int,
) -> AccountingEntry:
    """
    Create a reimbursement entry in the VI journal:
      D client_advance (419xxx)  amount
      C bank account  (512xxx)   amount

    Sets entitlement.status = 5 (Annulé).
    Does NOT commit — caller owns the transaction.
    """
    from datetime import date as _date

    entitlement = await _load_entitlement_for_accounting(db, entitlement_uuid)

    if entitlement.status == 5:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ce bon est déjà annulé")

    vi_type = entitlement.vi_type
    if vi_type is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Type VI introuvable")

    client_acc = vi_type.client_account
    if client_acc is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compte avances (419xxx) non configuré sur le type VI",
        )

    amount = amount_override if amount_override is not None else (
        Decimal(str(entitlement.amount_ttc)) if entitlement.amount_ttc is not None else None
    )
    if amount is None or amount <= Decimal("0"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Montant TTC requis pour créer l'écriture de remboursement",
        )

    bank_acc_result = await db.execute(
        select(AccountingAccount).where(AccountingAccount.uuid == bank_account_uuid)
    )
    if bank_acc_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Compte bancaire introuvable")

    vi_journal = await _get_journal_by_code(db, JOURNAL_VI)
    if vi_journal is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Journal VI introuvable")

    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=vi_journal.uuid,
        entry_date=_date.today(),
        reference=f"VI-REMB-{entitlement.code}",
        description=notes or f"Remboursement bon VI {entitlement.code}",
        state=1,  # Draft
        created_by=user_id,
    )
    db.add(entry)
    await db.flush()

    # D client_advance (419xxx)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=client_acc.uuid,
        tiers_uuid=entitlement.buyer_member_uuid,
        debit=amount,
        credit=Decimal("0"),
        description=f"Remboursement VI {entitlement.code}",
    ))

    # C bank (512xxx)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=bank_account_uuid,
        tiers_uuid=None,
        debit=Decimal("0"),
        credit=amount,
        description=f"Remboursement VI {entitlement.code}",
    ))

    await db.flush()

    entitlement.status = 5
    entitlement.updated_by = user_id

    logger.info(
        "VI reimbursement: created draft entry %s for entitlement %s amount=%s",
        entry_uuid, entitlement.code, amount,
    )
    return entry


async def create_vi_purchase_entry(
    db: AsyncSession,
    entitlement_uuid: UUID,
    fiscal_year_uuid: UUID,
    bank_account_uuid: UUID,
    entry_date,
    amount_override: Decimal | None,
    notes: str | None,
    user_id: int,
) -> AccountingEntry:
    """
    Create a purchase/encaissement entry in the VI journal (Step 1):
      D bank/caisse (5xx)       amount
      C client_advance (419xxx) amount

    Sets entitlement.purchase_entry_uuid.
    Does NOT commit — caller owns the transaction.
    """
    from datetime import date as _date

    entitlement = await _load_entitlement_for_accounting(db, entitlement_uuid)

    if entitlement.purchase_entry_uuid is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Une écriture d'encaissement existe déjà pour ce bon",
        )

    vi_type = entitlement.vi_type
    if vi_type is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Type VI introuvable")

    client_acc = vi_type.client_account
    if client_acc is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compte avances (419xxx) non configuré sur le type VI",
        )

    amount = amount_override if amount_override is not None else (
        Decimal(str(entitlement.amount_ttc)) if entitlement.amount_ttc is not None else None
    )
    if amount is None or amount <= Decimal("0"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Montant TTC requis pour créer l'écriture d'encaissement",
        )

    bank_acc_result = await db.execute(
        select(AccountingAccount).where(AccountingAccount.uuid == bank_account_uuid)
    )
    bank_acc = bank_acc_result.scalar_one_or_none()
    if bank_acc is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Compte bancaire/caisse introuvable")

    vi_journal = await _get_journal_by_code(db, JOURNAL_VI)
    if vi_journal is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Journal VI introuvable")

    eff_date = entry_date or _date.today()

    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=vi_journal.uuid,
        entry_date=eff_date,
        reference=f"VI-ENC-{entitlement.code}",
        description=notes or f"Encaissement bon VI {entitlement.code}",
        state=1,  # Draft
        created_by=user_id,
    )
    db.add(entry)
    await db.flush()

    # D bank/caisse (5xx)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=bank_account_uuid,
        tiers_uuid=None,
        debit=amount,
        credit=Decimal("0"),
        description=f"Encaissement VI {entitlement.code}",
    ))

    # C client_advance (419xxx)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=client_acc.uuid,
        tiers_uuid=entitlement.buyer_member_uuid,
        debit=Decimal("0"),
        credit=amount,
        description=f"Encaissement VI {entitlement.code}",
    ))

    await db.flush()

    entitlement.purchase_entry_uuid = entry_uuid
    entitlement.updated_by = user_id

    logger.info(
        "VI purchase entry: created draft entry %s for entitlement %s amount=%s",
        entry_uuid, entitlement.code, amount,
    )
    return entry


async def cancel_vi_realization_entry(
    db: AsyncSession,
    entitlement_uuid: UUID,
    fiscal_year_uuid: UUID | None,
    user_id: int,
) -> None:
    """
    Cancel the realization entry for an entitlement.

    Draft (state=1): deleted from the database entirely.
    Posted (state=2): not supported via this endpoint — use the accounting module reversal flow.

    Clears entitlement.realization_entry_uuid so a new entry can be created.
    Does NOT commit — caller owns the transaction.
    """
    entitlement = await _load_entitlement_for_accounting(db, entitlement_uuid)

    if entitlement.realization_entry_uuid is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No realization entry to cancel",
        )

    result = await db.execute(
        select(AccountingEntry).where(AccountingEntry.uuid == entitlement.realization_entry_uuid)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        # Entry was deleted externally — just clear the reference
        entitlement.realization_entry_uuid = None
        return

    if entry.state == 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Posted entries cannot be cancelled here — use the accounting reversal flow in the finance module",
        )

    # Draft entries are deleted outright; posted entries are rejected above
    entry_uuid = entry.uuid
    await db.delete(entry)
    entitlement.realization_entry_uuid = None
    await db.flush()
    logger.info(
        "VI realization: deleted draft entry %s for entitlement %s",
        entry_uuid,
        entitlement.code,
    )


# ── Step 4: Member conversion ──────────────────────────────────────────────

async def create_vi_conversion_entry(
    db: AsyncSession,
    entitlement_uuid: UUID,
    registered_member_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> tuple[AccountingEntry, list[UUID]]:
    """
    Step 4 – Member conversion (rebill_to_member).

    Creates a Draft OD entry that nullifies the realization revenue recognition
    and establishes the member receivable:
      D revenue_account    (flight_portion)   — reverses C 7067 from realization
      D insurance_revenue  (insurance_amount) — reverses C 7069 from realization [if any]
      D insurance_account  (insurance_amount) — reverses C 401 from realization [if any]
      C insurance_expense  (insurance_amount) — reverses D 616 from realization [if any]
      C 411                (amount_ttc)  tiers=registered_member

    Returns (entry, flights_to_rebill) where flights_to_rebill is the list of
    flight UUIDs from vi_flight_links that are currently in 'applied' state.
    The caller is responsible for unbilling each, updating charge_to_erp_id,
    and re-billing them.

    Does NOT commit — caller owns the transaction.
    """
    from datetime import date as _date
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(ViEntitlement)
        .options(
            joinedload(ViEntitlement.vi_type).options(
                joinedload(ViTypeCatalog.client_account),
                joinedload(ViTypeCatalog.revenue_account),
                joinedload(ViTypeCatalog.insurance_account),
                joinedload(ViTypeCatalog.insurance_expense_account),
                joinedload(ViTypeCatalog.insurance_revenue_account),
            ),
            selectinload(ViEntitlement.flight_links).joinedload(ViFlightLink.flight),
        )
        .where(ViEntitlement.uuid == entitlement_uuid)
    )
    entitlement = result.unique().scalar_one_or_none()
    if entitlement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VI entitlement not found")

    if entitlement.conversion_entry_uuid is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Conversion entry already exists: {entitlement.conversion_entry_uuid}",
        )

    if entitlement.realization_entry_uuid is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Realization entry must exist before creating a conversion entry",
        )

    if entitlement.amount_ttc is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="amount_ttc must be set on the entitlement",
        )

    vi_type = entitlement.vi_type
    if vi_type is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VI type not found")

    revenue_acc = vi_type.revenue_account
    if revenue_acc is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="VI type is missing revenue_account_uuid — configure in VI type settings",
        )

    member_result = await db.execute(select(Member).where(Member.uuid == registered_member_uuid))
    registered_member = member_result.scalar_one_or_none()
    if registered_member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registered member not found")

    receivable_result = await db.execute(
        select(AccountingAccount).where(AccountingAccount.code == "411")
    )
    receivable_acc = receivable_result.scalar_one_or_none()
    if receivable_acc is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Compte 411 introuvable — vérifier le plan comptable",
        )

    vi_journal = await _get_journal_by_code(db, JOURNAL_VI)
    if vi_journal is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Journal VI introuvable")

    amount_ttc = Decimal(str(entitlement.amount_ttc))
    insurance_amount = Decimal(str(vi_type.insurance_amount)) if vi_type.insurance_amount else Decimal("0")
    flight_portion = amount_ttc - insurance_amount

    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=vi_journal.uuid,
        entry_date=_date.today(),
        reference=f"VI-CONV-{entitlement.code}",
        description=f"Conversion membre VI {entitlement.code}",
        state=1,  # Draft
        created_by=user_id,
    )
    db.add(entry)
    await db.flush()

    # D revenue_account — nullifies the C revenue_account credit from realization.
    # Mirrors the same insurance_revenue_account condition used at realization time:
    # flight_portion only when insurance_revenue_account is configured, else full amount_ttc.
    insurance_revenue_acc = vi_type.insurance_revenue_account
    use_insurance_revenue_line = insurance_amount > Decimal("0") and insurance_revenue_acc is not None
    revenue_debit = flight_portion if use_insurance_revenue_line else amount_ttc
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=revenue_acc.uuid,
        tiers_uuid=None,
        debit=revenue_debit,
        credit=Decimal("0"),
        description=f"Annulation produit VI {entitlement.code}",
    ))

    # D insurance_revenue_account — nullifies the C insurance_revenue_account credit
    # from realization [if configured]
    if use_insurance_revenue_line:
        db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=insurance_revenue_acc.uuid,
            tiers_uuid=None,
            debit=insurance_amount,
            credit=Decimal("0"),
            description=f"Annulation assurance VI {entitlement.code}",
        ))

    # D insurance_account (401) — nullifies C 401 credit from realization [if any]
    if insurance_amount > Decimal("0") and vi_type.insurance_account is not None:
        db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=vi_type.insurance_account.uuid,
            tiers_uuid=vi_type.insurance_tiers_uuid,
            debit=insurance_amount,
            credit=Decimal("0"),
            description=f"Annulation assurance VI {entitlement.code}",
        ))
    elif insurance_amount > Decimal("0") and vi_type.insurance_account is None:
        logger.warning(
            "VI conversion %s: insurance_amount=%s but no insurance_account configured — "
            "insurance debit line omitted, entry may be unbalanced",
            entitlement.code,
            insurance_amount,
        )

    # C insurance_expense_account (616) — reverses D 616 from realization [if configured]
    expense_acc = vi_type.insurance_expense_account
    if insurance_amount > Decimal("0") and expense_acc is not None:
        db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=expense_acc.uuid,
            tiers_uuid=vi_type.insurance_tiers_uuid,
            debit=Decimal("0"),
            credit=insurance_amount,
            description=f"Annulation charge assurance VI {entitlement.code}",
        ))

    # C 411 (amount_ttc, tiers=registered_member)
    db.add(AccountingLine(
        uuid=uuid4(),
        fiscal_year_uuid=fiscal_year_uuid,
        entry_uuid=entry_uuid,
        account_uuid=receivable_acc.uuid,
        tiers_uuid=registered_member_uuid,
        debit=Decimal("0"),
        credit=amount_ttc,
        description=f"Créance membre {registered_member.account_id} VI {entitlement.code}",
    ))

    await db.flush()

    entitlement.conversion_entry_uuid = entry_uuid
    entitlement.registered_member_uuid = registered_member_uuid
    entitlement.status = int(ViEntitlementStatus.CONVERTED)
    entitlement.updated_by = user_id

    # Return all linked flight UUIDs so the route can unbill (if applied) and update charge_to
    linked_flight_uuids: list[UUID] = [
        link.flight_uuid
        for link in entitlement.flight_links
        if link.flight_uuid is not None
    ]

    logger.info(
        "VI conversion: created OD entry %s for entitlement %s member=%s linked_flights=%d",
        entry_uuid, entitlement.code, registered_member.account_id, len(linked_flight_uuids),
    )
    return entry, linked_flight_uuids
