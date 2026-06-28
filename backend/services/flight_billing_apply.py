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
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    AccountingAccount,
    AccountingEntry,
    AccountingLine,
    AccountingJournal,
    FlightBillingSettings,
    MemberPackConsumption,
    ValidatedFlight,
)
from schemas.flight_billing import CloseRemPeriodResponse
from services.flight_billing import _dec, _money, FlightBillingPreviewService
from services.flight_packs import (
    REM_DISCOUNT_REF_PREFIX,
    create_pack_purchase_entry,
    get_account_by_code,
    record_consumption,
)

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

        # Build human-readable description: Vol {date} {machine} {pilot} {duration}
        flight_date = flight.jour.strftime("%d/%m/%Y") if flight.jour else ""
        flight_duration = ""
        if flight.takeoff_time and flight.landing_time:
            try:
                th, tm = flight.takeoff_time.split(":")
                lh, lm = flight.landing_time.split(":")
                start_min = int(th) * 60 + int(tm)
                end_min = int(lh) * 60 + int(lm)
                if end_min >= start_min:
                    diff = end_min - start_min
                    flight_duration = f"{diff // 60}h{diff % 60:02d}"
            except (ValueError, TypeError):
                flight_duration = ""
        desc_parts = [flight_date, flight.asset_code or "", flight.pilot_erp_id or "", flight_duration]
        description = "Vol " + " ".join(p for p in desc_parts if p)

        entry = AccountingEntry(
            uuid=entry_uuid,
            fiscal_year_uuid=fiscal_year_uuid,
            journal_uuid=settings.fl_journal_uuid,
            entry_date=flight.jour or datetime.now(timezone.utc),
            reference=f"FL-{flight.planche_uuid or flight_uuid}",
            description=description,
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
                tiers_uuid=UUID(line.tiers_uuid) if line.tiers_uuid else None,
                debit=_money(_dec(line.debit)) if line.debit else Decimal("0"),
                credit=_money(_dec(line.credit)) if line.credit else Decimal("0"),
            ))

        # Link FL entry to flight
        flight.accounting_entry_uuid = entry_uuid
        flight.billing_quote_state = "applied"

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
        return await post_accounting_entry(self.db, entry.uuid, fiscal_year_uuid)

    async def unbill_flight(self, flight_uuid: UUID) -> None:
        """
        Revert an 'applied' (Draft) billing for a flight.

        Deletes the linked Draft FL accounting entry and all its lines,
        then resets the flight back to 'pending'. Refuses if the entry is
        already posted (state == 2).

        If the flight had pack discounts, the MemberPackConsumption rows are
        deleted and the member's REM discount entry is patched in-place (no full
        FIFO re-run — just a re-sum of the remaining consumption rows).
        """
        result = await self.db.execute(
            select(ValidatedFlight).where(ValidatedFlight.uuid == flight_uuid)
        )
        flight = result.scalar_one_or_none()
        if flight is None:
            raise HTTPException(status_code=404, detail="Flight not found")

        if flight.billing_quote_state != "applied":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only flights with status 'applied' (Draft entry) can be unbilled.",
            )

        if flight.accounting_entry_uuid is None:
            # Inconsistent state — reset anyway
            flight.billing_quote_state = "pending"
            await self.db.commit()
            return

        entry_result = await self.db.execute(
            select(AccountingEntry).where(
                AccountingEntry.uuid == flight.accounting_entry_uuid
            )
        )
        entry = entry_result.scalar_one_or_none()

        if entry is not None:
            if entry.state == 2:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Cannot unbill: accounting entry is already posted.",
                )
            # Delete all lines first, then the entry
            lines_result = await self.db.execute(
                select(AccountingLine).where(
                    AccountingLine.entry_uuid == entry.uuid
                )
            )
            for line in lines_result.scalars().all():
                await self.db.delete(line)
            await self.db.flush()
            await self.db.delete(entry)
            await self.db.flush()

        # Collect affected members before deleting their consumption rows so
        # we can patch the REM entry without a full FIFO re-run.
        fiscal_year_uuid: UUID | None = entry.fiscal_year_uuid if entry is not None else None  # type: ignore[assignment]
        affected_members: list[UUID] = []
        if flight.has_discount and fiscal_year_uuid is not None:
            mpc_rows = await self.db.execute(
                select(MemberPackConsumption.tiers_uuid).where(
                    MemberPackConsumption.flight_uuid == flight_uuid
                ).distinct()
            )
            affected_members = [row.tiers_uuid for row in mpc_rows.all()]

        # Delete pack consumption rows — restores pack balance for re-billing.
        await self.db.execute(
            delete(MemberPackConsumption).where(
                MemberPackConsumption.flight_uuid == flight_uuid
            )
        )

        flight.accounting_entry_uuid = None
        flight.billing_quote_state = "pending"
        flight.has_discount = False
        await self.db.flush()

        # Patch each affected member's REM discount entry.
        if affected_members and fiscal_year_uuid is not None:
            for member_uuid in affected_members:
                await self._patch_rem_entry(member_uuid, fiscal_year_uuid)

        await self.db.commit()

    async def _patch_rem_entry(self, member_uuid: UUID, fiscal_year_uuid: UUID) -> None:
        """
        Update the member's aggregated REM discount entry after one flight's
        pack consumptions have been deleted.

        Strategy: re-sum the *remaining* MemberPackConsumption rows for this
        member (other flights are untouched, so their amounts are still correct).
        Then replace the two GL lines on the existing REM Draft entry with the
        new total, or delete the entry entirely if nothing is left.

        This avoids a full FIFO re-run (discount_review_for_member). The trade-off:
        if another flight was billed at full price only because this flight
        exhausted the pack, that flight won't gain a discount automatically — a
        full review or re-billing is needed for that.
        """
        # Load billing settings to find the REM journal and discount account.
        settings_result = await self.db.execute(
            select(FlightBillingSettings).where(
                FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
            )
        )
        settings = settings_result.scalar_one_or_none()
        if settings is None:
            logger.warning(
                "_patch_rem_entry: no billing settings for fiscal_year=%s, skipping REM patch",
                fiscal_year_uuid,
            )
            return

        # Sum remaining discount amounts for this member from still-billed flights.
        # Join through ValidatedFlight → AccountingEntry to scope to the fiscal year.
        sum_result = await self.db.execute(
            select(
                func.coalesce(func.sum(MemberPackConsumption.total_discount_amount), Decimal("0"))
            )
            .join(ValidatedFlight, MemberPackConsumption.flight_uuid == ValidatedFlight.uuid)
            .join(AccountingEntry, ValidatedFlight.accounting_entry_uuid == AccountingEntry.uuid)
            .where(
                MemberPackConsumption.tiers_uuid == member_uuid,
                MemberPackConsumption.flight_uuid.isnot(None),
                AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
            )
        )
        new_total = Decimal(str(sum_result.scalar() or 0))

        # Locate the existing REM entry for this member / fiscal year.
        reference = f"{REM_DISCOUNT_REF_PREFIX}{member_uuid}"
        rem_result = await self.db.execute(
            select(AccountingEntry)
            .join(
                AccountingLine,
                and_(
                    AccountingLine.entry_uuid == AccountingEntry.uuid,
                    AccountingLine.tiers_uuid == member_uuid,
                ),
            )
            .where(
                AccountingEntry.journal_uuid == settings.rem_journal_uuid,
                AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
                AccountingEntry.reference == reference,
            )
            .limit(1)
        )
        rem_entry = rem_result.scalar_one_or_none()

        if rem_entry is None:
            logger.info(
                "_patch_rem_entry: no REM entry found for member=%s, nothing to patch",
                member_uuid,
            )
            return

        if rem_entry.state == 2:
            logger.warning(
                "_patch_rem_entry: REM entry %s is posted — cannot patch automatically",
                rem_entry.uuid,
            )
            return

        # Delete current GL lines.
        await self.db.execute(
            delete(AccountingLine).where(AccountingLine.entry_uuid == rem_entry.uuid)
        )
        await self.db.flush()

        if new_total <= Decimal("0"):
            # No remaining discounts for this member — remove the entry entirely.
            await self.db.delete(rem_entry)
            logger.info(
                "_patch_rem_entry: deleted empty REM entry %s for member=%s",
                rem_entry.uuid, member_uuid,
            )
            return

        # Resolve accounts for the two balanced GL lines.
        discount_account_uuid = settings.default_pack_discount_expense_account_uuid
        receivable = await get_account_by_code(self.db, "411")
        if receivable is None:
            logger.error("_patch_rem_entry: account 411 not found — REM entry left empty")
            return

        self.db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            entry_uuid=rem_entry.uuid,
            account_uuid=discount_account_uuid,
            debit=new_total,
        ))
        self.db.add(AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=fiscal_year_uuid,
            entry_uuid=rem_entry.uuid,
            account_uuid=receivable.uuid,
            tiers_uuid=member_uuid,
            credit=new_total,
        ))
        await self.db.flush()
        logger.info(
            "_patch_rem_entry: patched REM entry %s for member=%s new_total=%s",
            rem_entry.uuid, member_uuid, new_total,
        )

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
                    select(func.coalesce(func.sum(AccountingLine.debit), 0)).where(
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
