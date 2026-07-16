"""
    ERP-CLUB - ERP pour Club de vol a voile
    - Logiciel libre de gestion d'un club de vol a voile
    - vi_reports: Realized/converted VI voucher report and KPIs
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

from collections import Counter
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from models import (
    AccountingEntry,
    AccountingLine,
    Member,
    ValidatedFlight,
    ViEntitlement,
    ViEntitlementStatus,
    ViFlightLink,
    ViTypeCatalog,
)
from schemas.vi import (
    ViAccountingEntryRef,
    ViEntryLineDisplay,
    ViRealizedReportResponse,
    ViReportKpis,
    ViReportTopPilot,
    ViReportVoucherRow,
)

TOP_PILOTS_LIMIT = 5

# VI/JD accounting accounts are configured per vi_type in the DB, but every vi_type
# in this club's chart of accounts shares the same codes — see docs/operations/mapping_journal.md.
ACCOUNT_FLIGHT_COST = "921"        # analytical cost of flights (D — debited during FL billing)
ACCOUNT_CLIENT_ADVANCE = "419100"  # advances received (C on purchase, D on realization/reimbursement)
ACCOUNT_FLIGHT_REVENUE = "7067"    # net billed revenue for realized VI (reversed on conversion)
ACCOUNT_INSURANCE_REVENUE = "7069"  # insurance amount collected from buyer (reversed on conversion)
ACCOUNT_INSURANCE_EXPENSE = "6169"  # insurance amount owed to FFVP (reversed on conversion)


def _member_name(member: Member | None) -> str | None:
    if member is None:
        return None
    return f"{member.first_name} {member.last_name}".strip()


def _net_by_account(entry: AccountingEntry | None, account_code: str) -> Decimal:
    """Net (credit - debit) for a given account code within one entry."""
    if entry is None:
        return Decimal("0")
    total = Decimal("0")
    for ln in entry.lines:
        if ln.account and ln.account.code == account_code:
            total += Decimal(str(ln.credit)) - Decimal(str(ln.debit))
    return total


async def get_vi_realized_report(
    db: AsyncSession,
    date_from: date | None = None,
    date_to: date | None = None,
) -> ViRealizedReportResponse:
    """
    Report of every realized (3) or converted (6) VI voucher, with its flights
    and realization/conversion accounting entries, plus module-wide KPIs.

    Generic (catch-all) vouchers are excluded — they don't represent individual
    initiation flights, so a per-voucher/per-flight breakdown doesn't apply.

    KPIs are derived from the actual ledger accounts rather than the raw
    amount_ttc/insurance_amount fields, because conversion (Step 4) reverses the
    realization's 7067/7069/6169 lines — a converted voucher's revenue moves to
    the member's receivable (411) instead of staying recognized as VI revenue.
    """
    filters = [
        ViEntitlement.status.in_([int(ViEntitlementStatus.REALIZED), int(ViEntitlementStatus.CONVERTED)]),
        ViEntitlement.is_generic.is_(False),
    ]
    if date_from is not None:
        filters.append(ViEntitlement.realisation_date >= date_from)
    if date_to is not None:
        filters.append(ViEntitlement.realisation_date <= date_to)

    result = await db.execute(
        select(ViEntitlement)
        .options(
            joinedload(ViEntitlement.vi_type),
            joinedload(ViEntitlement.buyer_member),
            joinedload(ViEntitlement.registered_member),
            selectinload(ViEntitlement.flight_links).joinedload(ViFlightLink.flight),
        )
        .where(*filters)
        .order_by(ViEntitlement.realisation_date.desc().nulls_last(), ViEntitlement.code)
    )
    entitlements = list(result.unique().scalars().all())

    # ── Bulk-load realization/conversion entries + lines + accounts ─────────
    entry_uuids = {
        e.realization_entry_uuid for e in entitlements if e.realization_entry_uuid
    } | {
        e.conversion_entry_uuid for e in entitlements if e.conversion_entry_uuid
    }
    entries_by_uuid: dict = {}
    if entry_uuids:
        entries_result = await db.execute(
            select(AccountingEntry)
            .options(joinedload(AccountingEntry.lines).joinedload(AccountingLine.account))
            .where(AccountingEntry.uuid.in_(entry_uuids))
        )
        for entry in entries_result.unique().scalars().all():
            entries_by_uuid[entry.uuid] = entry

    def _entry_ref(entry_uuid) -> ViAccountingEntryRef:
        entry = entries_by_uuid.get(entry_uuid) if entry_uuid else None
        if entry is None:
            return ViAccountingEntryRef()
        lines = [
            ViEntryLineDisplay(
                account_code=ln.account.code if ln.account else "?",
                account_name=ln.account.name if ln.account else None,
                debit=Decimal(str(ln.debit)),
                credit=Decimal(str(ln.credit)),
                description=ln.description,
            )
            for ln in entry.lines
        ]
        return ViAccountingEntryRef(
            entry_uuid=entry.uuid,
            fiscal_year_uuid=entry.fiscal_year_uuid,
            state=entry.state,
            entry_date=entry.entry_date,
            lines=lines,
        )

    # ── Bulk-load flight cost (account 921) from each flight's own FL entry ──
    # ViFlightLink.analytical_entry_uuid is never populated in practice (the
    # dedicated create_vi_analytical_entry() helper in vi_accounting.py is not
    # wired into the billing pipeline) — the real D 921 / C 902 lines are posted
    # directly inside the flight's own FL entry (validated_flights.accounting_entry_uuid)
    # by flight_billing.py when the flight is club-billed in VI analytical mode.
    flight_entry_uuids = {
        link.flight.accounting_entry_uuid
        for e in entitlements
        for link in e.flight_links
        if link.flight_uuid is not None and link.flight is not None and link.flight.accounting_entry_uuid
    }
    flight_cost = Decimal("0")
    if flight_entry_uuids:
        analytical_result = await db.execute(
            select(AccountingLine.debit)
            .join(AccountingLine.account)
            .where(
                AccountingLine.entry_uuid.in_(flight_entry_uuids),
                AccountingLine.account.has(code=ACCOUNT_FLIGHT_COST),
            )
        )
        flight_cost = sum(
            (Decimal(str(v)) for v in analytical_result.scalars().all()),
            Decimal("0"),
        )

    # ── Bulk-resolve pilots for top-5 KPI ───────────────────────────────────
    pilot_ref_ids = {
        link.flight.pilot_erp_id
        for e in entitlements
        for link in e.flight_links
        if link.flight_uuid is not None and link.flight is not None and link.flight.pilot_erp_id
    }
    pilots_by_ref: dict[str, Member] = {}
    if pilot_ref_ids:
        pilots_result = await db.execute(
            select(Member).where(
                (Member.account_id.in_(pilot_ref_ids)) | (Member.legacy_account_id.in_(pilot_ref_ids))
            )
        )
        for member in pilots_result.scalars().all():
            if member.account_id in pilot_ref_ids:
                pilots_by_ref[member.account_id] = member
            if member.legacy_account_id in pilot_ref_ids:
                pilots_by_ref[member.legacy_account_id] = member

    pilot_flight_counter: Counter[str] = Counter()
    for e in entitlements:
        for link in e.flight_links:
            if link.flight_uuid is None or link.flight is None or not link.flight.pilot_erp_id:
                continue
            pilot_flight_counter[link.flight.pilot_erp_id] += 1

    # ── Build voucher rows + accumulate ledger-based KPIs ───────────────────
    vouchers: list[ViReportVoucherRow] = []
    net_flight_revenue = Decimal("0")
    insurance_collected = Decimal("0")
    insurance_paid = Decimal("0")
    insurance_voucher_count = 0
    realized_count = 0
    converted_count = 0

    for e in entitlements:
        vi_type: ViTypeCatalog | None = e.vi_type
        insurance_amount = (
            Decimal(str(e.insurance_amount_override))
            if e.insurance_amount_override is not None
            else (Decimal(str(vi_type.insurance_amount)) if vi_type and vi_type.insurance_amount else Decimal("0"))
        )
        amount_ttc = Decimal(str(e.amount_ttc)) if e.amount_ttc is not None else None

        linked_flights = sorted(
            (link.flight for link in e.flight_links if link.flight_uuid is not None and link.flight is not None),
            key=lambda f: f.jour,
        )

        # realized_count covers both REALIZED and CONVERTED (same tile — converted
        # vouchers were realized first); converted_count is the subset that converted.
        realized_count += 1
        if e.status == int(ViEntitlementStatus.CONVERTED):
            converted_count += 1

        realization_entry = entries_by_uuid.get(e.realization_entry_uuid) if e.realization_entry_uuid else None
        conversion_entry = entries_by_uuid.get(e.conversion_entry_uuid) if e.conversion_entry_uuid else None

        # Net ledger movement across realization + conversion — conversion reverses
        # the realization's revenue/insurance lines, so a converted voucher nets to 0
        # here (its revenue moved to the member's receivable instead).
        net_flight_revenue += (
            _net_by_account(realization_entry, ACCOUNT_FLIGHT_REVENUE)
            + _net_by_account(conversion_entry, ACCOUNT_FLIGHT_REVENUE)
        )
        insurance_collected += (
            _net_by_account(realization_entry, ACCOUNT_INSURANCE_REVENUE)
            + _net_by_account(conversion_entry, ACCOUNT_INSURANCE_REVENUE)
        )
        insurance_paid += -(
            _net_by_account(realization_entry, ACCOUNT_INSURANCE_EXPENSE)
            + _net_by_account(conversion_entry, ACCOUNT_INSURANCE_EXPENSE)
        )

        if insurance_amount > Decimal("0"):
            insurance_voucher_count += 1

        vouchers.append(
            ViReportVoucherRow(
                entitlement_uuid=e.uuid,
                code=e.code,
                vi_type_code=vi_type.code if vi_type else None,
                status=e.status,
                realisation_date=e.realisation_date,
                amount_ttc=amount_ttc,
                insurance_amount=insurance_amount,
                buyer_member_name=_member_name(e.buyer_member),
                registered_member_name=_member_name(e.registered_member),
                flight_count=len(linked_flights),
                flight_dates=[f.jour for f in linked_flights],
                realization=_entry_ref(e.realization_entry_uuid),
                conversion=_entry_ref(e.conversion_entry_uuid),
            )
        )

    # ── Remaining vouchers: LOADED/SCHEDULED, non-generic ───────────────────
    remaining_result = await db.execute(
        select(func.count()).select_from(ViEntitlement).where(
            ViEntitlement.status.in_([1, 2]),
            ViEntitlement.is_generic.is_(False),
        )
    )
    remaining_count = int(remaining_result.scalar_one() or 0)

    # ── Advances collected but not yet realized (419100 global GL balance) ──
    # Purchase (encaissement) entries are rarely booked through the dedicated VI
    # Step 1 flow (vi_entitlements.purchase_entry_uuid) — in practice, incoming
    # payments are credited to 419100 directly via bank/cash reconciliation (BQ/CS
    # journals), and legacy opening balances via AN. So the only reliable way to
    # get "advances not yet realized" is the account's actual GL balance
    # (credit - debit, across every journal), not a per-voucher lookup.
    advances_result = await db.execute(
        select(AccountingLine.credit, AccountingLine.debit)
        .join(AccountingLine.account)
        .where(AccountingLine.account.has(code=ACCOUNT_CLIENT_ADVANCE))
    )
    advances_unrealized = Decimal("0")
    for credit, debit in advances_result.all():
        advances_unrealized += Decimal(str(credit)) - Decimal(str(debit))

    conversion_rate = (converted_count / realized_count) if realized_count else 0.0

    top_pilots = [
        ViReportTopPilot(
            member_uuid=pilots_by_ref[ref].uuid if ref in pilots_by_ref else None,
            account_id=pilots_by_ref[ref].account_id if ref in pilots_by_ref else ref,
            member_name=_member_name(pilots_by_ref.get(ref)) or ref,
            flight_count=count,
        )
        for ref, count in pilot_flight_counter.most_common(TOP_PILOTS_LIMIT)
    ]

    kpis = ViReportKpis(
        realized_count=realized_count,
        converted_count=converted_count,
        remaining_count=remaining_count,
        conversion_rate=conversion_rate,
        net_flight_revenue=net_flight_revenue,
        insurance_collected=insurance_collected,
        insurance_paid=insurance_paid,
        insurance_voucher_count=insurance_voucher_count,
        flight_cost=flight_cost,
        margin=net_flight_revenue - flight_cost,
        advances_unrealized=advances_unrealized,
        top_pilots=top_pilots,
    )

    return ViRealizedReportResponse(vouchers=vouchers, kpis=kpis)
