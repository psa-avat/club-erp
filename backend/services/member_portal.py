"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - member_portal: service functions for member self-service portal
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

import hashlib
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    AccountingEntry,
    AccountingLine,
    Member,
    MemberPackConsumption,
    MemberSheet,
    ValidatedFlight,
)
from schemas.member_portal import (
    MemberPortalAccountEntry,
    MemberPortalAccountSummary,
    MemberPortalConsumption,
    MemberPortalFlightBillingDetail,
    MemberPortalFlightItem,
    MemberPortalPackBalance,
    MemberPortalProfile,
)

FLIGHT_TYPE_LABELS: dict[int, str] = {
    0: "instruction",
    1: "solo",
    2: "initiation",
    3: "partage",
    4: "passager",
    5: "lacher",
    6: "supervise",
    7: "essai",
}

PACK_TYPE_LABELS: dict[str, str] = {
    "flight_hours": "Heures de vol",
    "winch_launches": "Treuillées",
    "tow_launches": "Remorquées",
    "engine_time": "Temps moteur",
}


# ── Auth ───────────────────────────────────────────────────────────────────────

def _hash_password(raw: str) -> str:
    """SHA256 hash of a password for secure storage."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _compute_default_password(member: Member) -> str | None:
    """Default portal password = {ffvp_id}_{YYYYMMDD} or {account_id}_{YYYYMMDD}."""
    date_part = member.date_of_birth.strftime("%Y%m%d") if member.date_of_birth else None
    if not date_part:
        return None
    identifier = member.ffvp_id or member.account_id
    return f"{identifier}_{date_part}"


async def _get_current_sheet(db: AsyncSession, member_uuid: UUID) -> MemberSheet | None:
    """Get the most recent MemberSheet for the member (current year or latest)."""
    result = await db.execute(
        select(MemberSheet)
        .where(MemberSheet.member_uuid == member_uuid)
        .order_by(MemberSheet.year.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def authenticate_member(
    db: AsyncSession,
    member_identifier: str,
    password: str,
) -> Member | None:
    """
    Validate member identifier + portal password.

    Password logic:
    1. If MemberSheet.portal_password_hash is set → compare against that
    2. Otherwise → compute default password = {ffvp_id}_{YYYYMMDD}
       If matches → store the hash (first-login activation)
    3. Also check legacy expense_access_token_hash for backward compat
    """
    # Resolve member
    member = None
    try:
        member_uuid = UUID(member_identifier)
        result = await db.execute(
            select(Member).where(Member.uuid == member_uuid, Member.status == 1)
        )
        member = result.scalar_one_or_none()
    except (ValueError, TypeError):
        pass

    if member is None:
        result = await db.execute(
            select(Member).where(Member.account_id == member_identifier, Member.status == 1)
        )
        member = result.scalar_one_or_none()
    if member is None:
        return None

    # Check legacy expense access token first
    legacy_hash = _hash_password(password)
    sheet = await _get_current_sheet(db, member.uuid)
    if sheet and sheet.expense_access_enabled and sheet.expense_access_token_hash == legacy_hash:
        return member

    # Portal password logic
    password_hash = _hash_password(password)

    if sheet and sheet.portal_password_hash:
        # Password already set → verify
        if sheet.portal_password_hash == password_hash:
            return member
        return None

    # No password hash yet → try default
    default_pw = _compute_default_password(member)
    if default_pw is None:
        return None
    if password != default_pw:
        return None

    # First successful login with default password → store hash
    if sheet is None:
        # Create a MemberSheet for the current year if none exists
        from datetime import timezone
        current_year = datetime.now(timezone.utc).year
        sheet = MemberSheet(
            member_uuid=member.uuid,
            year=current_year,
            fare_type=1,
            portal_password_hash=password_hash,
        )
        db.add(sheet)
    else:
        sheet.portal_password_hash = password_hash
    await db.commit()
    return member


async def change_portal_password(
    db: AsyncSession,
    member_uuid: UUID,
    current_password: str,
    new_password: str,
) -> bool:
    """Change the member's portal password. Returns True on success."""
    member_result = await db.execute(
        select(Member).where(Member.uuid == member_uuid, Member.status == 1)
    )
    member = member_result.scalar_one_or_none()
    if not member:
        return False

    # Verify current password
    auth_result = await authenticate_member(db, member.account_id, current_password)
    if not auth_result:
        return False

    # Hash and store new password
    sheet = await _get_current_sheet(db, member.uuid)
    if sheet is None:
        from datetime import timezone
        current_year = datetime.now(timezone.utc).year
        sheet = MemberSheet(
            member_uuid=member.uuid,
            year=current_year,
            fare_type=1,
        )
        db.add(sheet)

    sheet.portal_password_hash = _hash_password(new_password)
    await db.commit()
    return True


async def get_member_profile(member: Member) -> MemberPortalProfile:
    """Build profile from Member model."""
    return MemberPortalProfile(
        uuid=str(member.uuid),
        account_id=member.account_id,
        first_name=member.first_name,
        last_name=member.last_name,
        email=member.email,
        member_category=member.member_category,
    )


# ── Flights ────────────────────────────────────────────────────────────────────

async def list_member_flights(
    db: AsyncSession,
    member_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[MemberPortalFlightItem], int]:
    """List flights for a member with billing status."""
    # Count total
    count_result = await db.execute(
        select(func.count(ValidatedFlight.uuid))
        .where(
            or_(
                ValidatedFlight.pilot_erp_id == str(member_uuid),
                ValidatedFlight.pilot_erp_id == member_uuid,  # also match raw uuid string
                ValidatedFlight.second_pilot_erp_id == str(member_uuid),
                ValidatedFlight.charge_to_erp_id == str(member_uuid),
            )
        )
    )
    total = count_result.scalar() or 0

    # Fetch flights
    result = await db.execute(
        select(ValidatedFlight)
        .where(
            or_(
                ValidatedFlight.pilot_erp_id == str(member_uuid),
                ValidatedFlight.second_pilot_erp_id == str(member_uuid),
                ValidatedFlight.charge_to_erp_id == str(member_uuid),
            )
        )
        .order_by(ValidatedFlight.jour.desc(), ValidatedFlight.takeoff_time.desc())
        .offset(offset)
        .limit(limit)
    )
    flights = result.scalars().all()

    items = []
    for f in flights:
        items.append(MemberPortalFlightItem(
            uuid=str(f.uuid),
            jour=f.jour,
            type_of_flight=f.type_of_flight,
            type_label=FLIGHT_TYPE_LABELS.get(f.type_of_flight),
            asset_code=f.asset_code,
            pilot_erp_id=f.pilot_erp_id,
            launch_method=f.launch_method,
            launch_asset_code=f.launch_asset_code,
            takeoff_time=f.takeoff_time,
            landing_time=f.landing_time,
            billing_quote_state=f.billing_quote_state,
            has_discount=f.has_discount or False,
        ))
    return items, total


async def get_flight_billing_detail(
    db: AsyncSession,
    flight_uuid: UUID,
    member_uuid: UUID,
) -> MemberPortalFlightBillingDetail | None:
    """Get billing detail for a specific flight, verifying member ownership."""
    result = await db.execute(
        select(ValidatedFlight).where(
            ValidatedFlight.uuid == flight_uuid,
            or_(
                ValidatedFlight.pilot_erp_id == str(member_uuid),
                ValidatedFlight.second_pilot_erp_id == str(member_uuid),
                ValidatedFlight.charge_to_erp_id == str(member_uuid),
            ),
        )
    )
    flight = result.scalar_one_or_none()
    if flight is None:
        return None

    # Get billing lines from accounting entry if billed
    applied_lines: list = []
    consumptions: list = []
    entry_state: int | None = None

    if flight.accounting_entry_uuid:
        entry_result = await db.execute(
            select(AccountingEntry).where(AccountingEntry.uuid == flight.accounting_entry_uuid)
        )
        entry = entry_result.scalar_one_or_none()
        if entry:
            entry_state = entry.state
            # Get accounting lines
            lines_result = await db.execute(
                select(AccountingLine).where(AccountingLine.entry_uuid == entry.uuid)
            )
            lines = lines_result.scalars().all()
            for line in lines:
                applied_lines.append({
                    "source": "flight",
                    "asset_code": flight.asset_code,
                    "quantity": Decimal("1"),
                    "applied_unit_price": line.debit if line.debit > 0 else line.credit,
                    "amount": line.debit if line.debit > 0 else line.credit,
                })

    # Get pack consumptions
    cons_result = await db.execute(
        select(MemberPackConsumption).where(
            MemberPackConsumption.flight_uuid == flight_uuid,
            MemberPackConsumption.tiers_uuid == member_uuid,
        )
    )
    cons_rows = cons_result.scalars().all()
    for c in cons_rows:
        consumptions.append(MemberPortalConsumption(
            pack_type=c.pack_type,
            quantity_consumed=c.quantity_consumed,
            discount_unit_price=c.discount_unit_price,
            total_discount_amount=c.total_discount_amount,
            valid_from=c.valid_from,
        ))

    total_discount = sum(c.total_discount_amount for c in cons_rows) if cons_rows else Decimal("0")

    return MemberPortalFlightBillingDetail(
        flight_uuid=str(flight.uuid),
        total_gross=Decimal("0"),  # would need aggregated line data
        total_discount=total_discount,
        net_amount=Decimal("0"),
        applied_lines=[],
        consumptions=consumptions,
        entry_state=entry_state,
    )


# ── Account ────────────────────────────────────────────────────────────────────

async def get_account_summary(
    db: AsyncSession,
    member_uuid: UUID,
) -> MemberPortalAccountSummary:
    """Get member account summary: balance, pack balances."""
    # Get pack balances from vw_member_pack_balances view
    active_packs = []
    try:
        balances_result = await db.execute(
            text("SELECT member_uuid, pack_type, total_purchased, total_consumed, units_remaining "
                 "FROM vw_member_pack_balances WHERE member_uuid = :uuid AND units_remaining > 0"),
            {"uuid": member_uuid},
        )
        rows = balances_result.fetchall()
        for row in rows:
            active_packs.append(MemberPortalPackBalance(
                pack_type=row[1],
                pack_type_label=PACK_TYPE_LABELS.get(row[1], row[1]),
                total_purchased=row[2] or Decimal("0"),
                total_consumed=row[3] or Decimal("0"),
                units_remaining=row[4] or Decimal("0"),
            ))
    except Exception:
        active_packs = []

    # Count entries where member appears in accounting lines
    pending_count_result = await db.execute(
        select(func.count(func.distinct(AccountingLine.entry_uuid)))
        .join(AccountingEntry, AccountingEntry.uuid == AccountingLine.entry_uuid)
        .where(
            AccountingLine.tiers_uuid == member_uuid,
            AccountingEntry.state == 1,  # Draft
        )
    )
    pending_count = pending_count_result.scalar() or 0

    posted_count_result = await db.execute(
        select(func.count(func.distinct(AccountingLine.entry_uuid)))
        .join(AccountingEntry, AccountingEntry.uuid == AccountingLine.entry_uuid)
        .where(
            AccountingLine.tiers_uuid == member_uuid,
            AccountingEntry.state == 2,  # Posted
        )
    )
    posted_count = posted_count_result.scalar() or 0

    return MemberPortalAccountSummary(
        current_balance=Decimal("0"),
        pending_entries_count=pending_count,
        posted_entries_count=posted_count,
        active_packs=active_packs,
    )


async def list_account_entries(
    db: AsyncSession,
    member_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[MemberPortalAccountEntry], int]:
    """List accounting entries where the member appears."""
    count_result = await db.execute(
        select(func.count(func.distinct(AccountingEntry.uuid)))
        .join(AccountingLine, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .where(AccountingLine.tiers_uuid == member_uuid)
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(AccountingEntry)
        .join(AccountingLine, AccountingLine.entry_uuid == AccountingEntry.uuid)
        .where(AccountingLine.tiers_uuid == member_uuid)
        .order_by(AccountingEntry.date.desc())
        .offset(offset)
        .limit(limit)
        .distinct()
    )
    entries = result.scalars().all()

    items = []
    for entry in entries:
        # Sum debit/credit for this member's lines
        lines_result = await db.execute(
            select(
                func.coalesce(func.sum(AccountingLine.debit), 0),
                func.coalesce(func.sum(AccountingLine.credit), 0),
            ).where(
                AccountingLine.entry_uuid == entry.uuid,
                AccountingLine.tiers_uuid == member_uuid,
            )
        )
        debit_sum, credit_sum = lines_result.one()

        items.append(MemberPortalAccountEntry(
            uuid=str(entry.uuid),
            journal_code=entry.journal_code,
            reference=entry.reference,
            description=entry.description,
            entry_date=entry.date,
            state=entry.state,
            debit=debit_sum,
            credit=credit_sum,
        ))
    return items, total


async def list_member_packs(
    db: AsyncSession,
    member_uuid: UUID,
) -> list[MemberPortalPackBalance]:
    """List active packs with remaining quantities."""
    packs = []
    try:
        balances_result = await db.execute(
            text("SELECT member_uuid, pack_type, total_purchased, total_consumed, units_remaining "
                 "FROM vw_member_pack_balances WHERE member_uuid = :uuid"),
            {"uuid": member_uuid},
        )
        rows = balances_result.fetchall()
        for row in rows:
            packs.append(MemberPortalPackBalance(
                pack_type=row[1],
                pack_type_label=PACK_TYPE_LABELS.get(row[1], row[1]),
                total_purchased=row[2] or Decimal("0"),
                total_consumed=row[3] or Decimal("0"),
                units_remaining=row[4] or Decimal("0"),
            ))
    except Exception:
        packs = []
    return packs


# ── Expenses ───────────────────────────────────────────────────────────────────

async def declare_expense(
    db: AsyncSession,
    member_uuid: UUID,
    amount: Decimal,
    reason: str,
    receipt_photo: str | None = None,
):
    """Record an expense declaration (stub — requires actual model)."""
    # TODO: implement when expense model exists
    pass


async def list_expenses(
    db: AsyncSession,
    member_uuid: UUID,
) -> list:
    """List expense declarations (stub — requires actual model)."""
    return []


# ── Deposits ───────────────────────────────────────────────────────────────────

async def record_deposit(
    db: AsyncSession,
    member_uuid: UUID,
    amount: Decimal,
    payment_method: str = "bank_transfer",
) -> dict:
    """Record a deposit on the member's account (stub)."""
    # TODO: implement deposit recording when deposit model exists
    import secrets
    return {
        "uuid": str(secrets.token_hex(16)),
        "amount": amount,
        "status": "pending",
        "message": "Dépôt enregistré, en attente de confirmation",
    }


# ── Tax Expenses ───────────────────────────────────────────────────────────────

async def list_tax_expenses(
    db: AsyncSession,
    member_uuid: UUID,
) -> list:
    """List volunteer expenses for tax purposes (stub)."""
    return []



