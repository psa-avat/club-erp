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
from datetime import datetime, timezone
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
    MemberPackConsumption,
    PackDefinition,
    ValidatedFlight,
)
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

    async def apply_flight_billing(
        self,
        flight_uuid: UUID,
        fiscal_year_uuid: UUID,
        user_id: int,
    ) -> AccountingEntry:
        """
        1. Runs preview at gross price
        2. Creates Draft FL entry at gross
        3. Links FL entry to the flight
        4. Records pack consumptions
        5. Upserts REM entry for the pilot
        """
        preview = await self._preview_service.preview_flight(
            flight_uuid, fiscal_year_uuid=fiscal_year_uuid
        )
        if not preview.can_apply:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Flight cannot be billed. Fix errors first.",
            )

        # Find FL journal
        fl_journal = await get_journal_by_code(self.db, "FL")
        if fl_journal is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="FL journal not found.",
            )

        # Find REM journal
        rem_journal = await get_journal_by_code(self.db, "REM")
        if rem_journal is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="REM journal not found.",
            )

        # Find 411 receivable
        receivable = await get_account_by_code(self.db, "411")
        if receivable is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Receivable account 411 not found.",
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
            journal_uuid=fl_journal.uuid,
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
                    pack_type="flight_hours",  # resolved from billing context
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
        # Collect unique members from applied lines with pack discount
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
            # Find the pack discount account from the consumptions
            pack_consumptions = await self.db.execute(
                select(MemberPackConsumption)
                .where(MemberPackConsumption.member_uuid == muuid)
                .limit(1)
            )
            first_consumption = pack_consumptions.scalar_one_or_none()
            # Use a default discount account (class 6) — real account resolved from pack definition
            discount_account = await get_account_by_code(self.db, "658")

            await upsert_rem_entry(
                self.db, muuid, fiscal_year_uuid, rem_journal.uuid,
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
    ) -> list[AccountingEntry]:
        """Apply billing for multiple flights."""
        entries = []
        for fuuid in flight_uuids:
            entry = await self.apply_flight_billing(fuuid, fiscal_year_uuid, user_id)
            entries.append(entry)
        return entries
