"""
    ERP-CLUB - ERP pour Club de vol a voile 
    - Logiciel libre de gestion d'un club de vol a voile
    - flight_billing_apply: Apply billing (gross FL entry + pack consumption + REM upsert)
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
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    AccountingAccount,
    AccountingEntry,
    AccountingLine,
    AccountingJournal,
    FlightBillingSettings,
    MemberPackConsumption,
    PackDefinition,
    ValidatedFlight,
)
from schemas.flight_billing import CloseRemPeriodResponse
from services.flight_billing import _dec, _money, FlightBillingPreviewService
from services.flight_packs import (
    compute_rem_adjustment,
    create_pack_purchase_entry,
    get_account_by_code,
    record_consumption,
    upsert_rem_entry,
)
from schemas.flight_packs import MemberPackConsumptionCreate

logger = logging.getLogger(__name__)


async def get_journal_by_code(db: AsyncSession, code: str) -> AccountingJournal | None:
    """Find a journal by its code."""
    result = await db.execute(
        select(AccountingJournal).where(AccountingJournal.code == code)
    )
    return result.scalar_one_or_none()


class FlightBillingApplyService:
    """
    Turns billing previews into Draft accounting entries (gross in FL journal),
    records pack consumptions, and upserts REM adjustment entries.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._preview_service = FlightBillingPreviewService(db)

    async def _load_settings(self, fiscal_year_uuid: UUID) -> FlightBillingSettings:
        """Load FlightBillingSettings or raise if not configured."""
        result = await self.db.execute(
            select(FlightBillingSettings).where(
                FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
            )
        )
        settings = result.scalar_one_or_none()
        if settings is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Flight billing settings not configured for this fiscal year. "
                       "Configure them in Banque → Paramètres → Facturation des vols.",
            )
        return settings

    async def apply_flight_billing(
        self,
        flight_uuid: UUID,
        fiscal_year_uuid: UUID,
        user_id: int,
    ) -> AccountingEntry:
        """
        1. Loads billing settings
        2. Runs preview at gross price
        3. Creates Draft FL entry at gross using configured FL journal
        4. Links FL entry to the flight
        5. Records pack consumptions
        6. Upserts REM entry for the pilot
        """
        settings = await self._load_settings(fiscal_year_uuid)

        preview = await self._preview_service.preview_flight(
            flight_uuid, fiscal_year_uuid=fiscal_year_uuid
        )
        if not preview.can_apply:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Flight cannot be billed. Fix errors first.",
            )

        # Get the flight
        result = await self.db.execute(
            select(ValidatedFlight).where(ValidatedFlight.uuid == flight_uuid)
        )
        flight = result.scalar_one_or_none()
        if flight is None:
            raise HTTPException(status_code=404, detail="Flight not found")

        # ── Create Draft FL entry (gross amounts) ──────────────────────
        entry_uuid = uuid4()
        entry = AccountingEntry(
            uuid=entry_uuid,
            fiscal_year_uuid=fiscal_year_uuid,
            journal_uuid=settings.fl_journal_uuid,
            entry_date=flight.jour or datetime.now(timezone.utc),
            reference=f"FL-{flight.planche_uuid or flight_uuid}",
            description=f"Vol {flight.planche_uuid or flight_uuid}",
            state=1,  # Draft
            created_by=user_id,
        )
        self.db.add(entry)
        await self.db.flush()

        for line in preview.accounting_lines:
            self.db.add(AccountingLine(
                uuid=uuid4(),
                fiscal_year_uuid=fiscal_year_uuid,
                entry_uuid=entry_uuid,
                account_uuid=UUID(line.account_uuid),
                member_uuid=UUID(line.member_uuid) if line.member_uuid else None,
                analytical_asset_uuid=UUID(line.analytical_asset_uuid) if line.analytical_asset_uuid else None,
                debit=_money(_dec(line.debit)) if line.debit else Decimal("0"),
                credit=_money(_dec(line.credit)) if line.credit else Decimal("0"),
            ))

        # Link FL entry to flight
        flight.accounting_entry_uuid = entry_uuid
        flight.billing_quote_state = "applied"

        # ── Record pack consumptions ───────────────────────────────────
        for applied_line in preview.applied_lines:
            if applied_line.discount_reason == "pack" and applied_line.payer_member_uuid:
                consumption = MemberPackConsumption(
                    uuid=uuid4(),
                    member_uuid=UUID(applied_line.payer_member_uuid),
                    flight_uuid=flight_uuid,
                    pack_type="flight_hours",
                    valid_from=datetime.now(timezone.utc),
                    quantity_consumed=_money(applied_line.pack_hours_used),
                    discount_unit_price=applied_line.normal_unit_price - applied_line.applied_unit_price,
                    total_discount_amount=_money(
                        applied_line.pack_hours_used * (applied_line.normal_unit_price - applied_line.applied_unit_price)
                    ),
                    accounting_entry_uuid=entry_uuid,
                )
                self.db.add(consumption)

        # ── Upsert REM entry for the member/period ─────────────────────
        member_uuids = set()
        for al in preview.applied_lines:
            if al.discount_reason == "pack" and al.payer_member_uuid:
                member_uuids.add(UUID(al.payer_member_uuid))

        period_start = datetime(flight.jour.year, flight.jour.month, 1, tzinfo=timezone.utc)
        period_end = datetime.now(timezone.utc)

        for muuid in member_uuids:
            total_discount = await compute_rem_adjustment(
                self.db, muuid, fiscal_year_uuid, period_start, period_end,
            )
            # Resolve discount account: pack definition → settings default → 658
            discount_account_uuid = settings.default_pack_discount_expense_account_uuid
            if discount_account_uuid:
                acct = await self.db.get(AccountingAccount, discount_account_uuid)
                discount_account = acct
            else:
                discount_account = await get_account_by_code(self.db, "658")

            await upsert_rem_entry(
                self.db, muuid, fiscal_year_uuid, settings.rem_journal_uuid,
                discount_account.uuid, total_discount,
                period_start, period_end, user_id,
            )

        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def post_flight_billing(
        self,
        flight_uuid: UUID,
        fiscal_year_uuid: UUID,
        user_id: int,
    ) -> AccountingEntry:
        """Apply billing and immediately post the FL entry."""
        from services.accounting import post_accounting_entry

        entry = await self.apply_flight_billing(flight_uuid, fiscal_year_uuid, user_id)
        return await post_accounting_entry(self.db, entry.uuid, fiscal_year_uuid, user_id)

    async def batch_apply(
        self,
        flight_uuids: list[UUID],
        fiscal_year_uuid: UUID,
        user_id: int,
    ) -> list[tuple[UUID, AccountingEntry]]:
        """Apply billing for multiple flights. Returns list of (flight_uuid, entry) tuples."""
        entries: list[tuple[UUID, AccountingEntry]] = []
        for fuuid in flight_uuids:
            entry = await self.apply_flight_billing(fuuid, fiscal_year_uuid, user_id)
            entries.append((fuuid, entry))
        return entries

    async def close_rem_period(
        self,
        fiscal_year_uuid: UUID,
        period_end: date,
        user_id: int,
    ) -> CloseRemPeriodResponse:
        """
        Post all Draft REM entries for the period, open new Drafts for next period.

        1. Find all Draft entries in REM journal for this FY
        2. Post each one
        3. Open new Draft entries for the next period (period_start = period_end + 1 day)
        """
        from services.accounting import post_accounting_entry

        settings = await self._load_settings(fiscal_year_uuid)

        # Find all Draft REM entries for this FY
        result = await self.db.execute(
            select(AccountingEntry).where(
                AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
                AccountingEntry.journal_uuid == settings.rem_journal_uuid,
                AccountingEntry.state == 1,  # Draft
            )
        )
        draft_entries = list(result.scalars().all())

        posted_count = 0
        total_discount = Decimal("0")
        entries_info: list[dict] = []

        for draft in draft_entries:
            try:
                await post_accounting_entry(self.db, draft.uuid, fiscal_year_uuid, user_id)
                posted_count += 1
                # Sum debit amounts from the REM entry
                lines_result = await self.db.execute(
                    select(text("COALESCE(SUM(debit), 0)")).select_from(AccountingLine).where(
                        AccountingLine.entry_uuid == draft.uuid
                    )
                )
                total = _dec(lines_result.scalar())
                total_discount += total
                entries_info.append({
                    "entry_uuid": str(draft.uuid),
                    "reference": draft.reference or "",
                    "posted": True,
                    "total_discount": str(total),
                })
            except Exception as exc:
                logger.error("Failed to post REM entry %s: %s", draft.uuid, exc)
                entries_info.append({
                    "entry_uuid": str(draft.uuid),
                    "reference": draft.reference or "",
                    "posted": False,
                    "error": str(exc),
                })

        # Open new Drafts for next period
        next_start = datetime.combine(period_end, datetime.min.time()) + timedelta(days=1)
        # REM entries for the new period will be created by apply_flight_billing
        # as flights are billed — nothing to pre-create here

        return CloseRemPeriodResponse(
            posted_count=posted_count,
            total_discount=_money(total_discount),
            entries=entries_info,
        )
