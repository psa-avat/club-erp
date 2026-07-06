"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Cheque receipt + remittance (remise de chèque): candidate listing and deposit generation
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
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import AccountingEntry, AccountingJournal, AccountingLine, ChequeRemittance, ChequeRemittanceLine
from schemas.accounting import AccountingEntryCreateRequest, AccountingLineCreateRequest
from schemas.cheque_remittance import ChequeCandidateResponse, ChequeRemittanceCreateRequest
from services.accounting import DEFAULT_SYSTEM_SETTINGS, _enrich_lines_tiers, create_accounting_entry, get_system_setting

_CHEQUE_SETTINGS_MODULE = "cheque_payments"


async def _get_cheque_settings(db: AsyncSession) -> dict:
    """Load cheque settings, falling back to defaults (None accounts) if unset."""
    try:
        setting = await get_system_setting(db, _CHEQUE_SETTINGS_MODULE)
        stored = setting.settings or {}
    except HTTPException:
        stored = {}
    return {**DEFAULT_SYSTEM_SETTINGS[_CHEQUE_SETTINGS_MODULE], **stored}


async def _get_bq_journal(db: AsyncSession) -> AccountingJournal:
    result = await db.execute(select(AccountingJournal).where(AccountingJournal.code == "BQ"))
    journal = result.scalar_one_or_none()
    if journal is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BQ journal not found — run journal seeding.",
        )
    return journal


async def _load_cheque_candidate_entries(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    pending_account_uuid: UUID,
    *,
    include_drafts: bool = True,
) -> list[AccountingEntry]:
    """Cheque-receipt entries in the fiscal year with a debit line on the pending
    cheques account, not already consumed by another remittance.

    Filtering on `debit > 0` (not just "has a line on this account") excludes the
    deposit entries themselves, which credit this same account on the other side.
    """
    pending_debit_line_exists = (
        select(AccountingLine.uuid)
        .where(
            AccountingLine.entry_uuid == AccountingEntry.uuid,
            AccountingLine.fiscal_year_uuid == AccountingEntry.fiscal_year_uuid,
            AccountingLine.account_uuid == pending_account_uuid,
            AccountingLine.debit > 0,
        )
        .exists()
    )
    already_remised_entry_uuids = select(ChequeRemittanceLine.source_entry_uuid).where(
        ChequeRemittanceLine.source_fiscal_year_uuid == fiscal_year_uuid,
    )
    eligible_states = (1, 2) if include_drafts else (2,)

    stmt = (
        select(AccountingEntry)
        .where(
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
            AccountingEntry.state.in_(eligible_states),
            AccountingEntry.reversal_of_entry_uuid.is_(None),
            pending_debit_line_exists,
            AccountingEntry.uuid.notin_(already_remised_entry_uuids),
        )
        .options(selectinload(AccountingEntry.lines).joinedload(AccountingLine.account))
        .order_by(AccountingEntry.entry_date.asc())
    )
    result = await db.execute(stmt)
    return list(result.unique().scalars().all())


def _pending_line(entry: AccountingEntry, pending_account_uuid: UUID) -> AccountingLine:
    return next(
        line for line in entry.lines
        if line.account_uuid == pending_account_uuid and line.debit and Decimal(line.debit) > 0
    )


async def list_cheque_candidates(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    *,
    include_drafts: bool = True,
) -> list[ChequeCandidateResponse]:
    """List cheque-receipt entries available for a new remittance."""
    settings = await _get_cheque_settings(db)
    pending_account_uuid_raw = settings.get("pending_account_uuid")
    if not pending_account_uuid_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cheque settings not configured: pending_account_uuid is missing.",
        )
    pending_account_uuid = UUID(str(pending_account_uuid_raw))

    entries = await _load_cheque_candidate_entries(db, fiscal_year_uuid, pending_account_uuid, include_drafts=include_drafts)
    await _enrich_lines_tiers(db, [line for entry in entries for line in entry.lines])

    responses: list[ChequeCandidateResponse] = []
    for entry in entries:
        pending_line = _pending_line(entry, pending_account_uuid)
        other_line = next((line for line in entry.lines if line.uuid != pending_line.uuid), None)
        responses.append(
            ChequeCandidateResponse(
                entry_uuid=entry.uuid,
                fiscal_year_uuid=entry.fiscal_year_uuid,
                entry_date=entry.entry_date,
                description=entry.description,
                state=entry.state,
                account_code=other_line.account.code if other_line and other_line.account else "",
                tiers_display_ref=getattr(other_line, "tiers_display_ref", None) if other_line else None,
                tiers_display_name=getattr(other_line, "tiers_display_name", None) if other_line else None,
                amount=pending_line.debit,
            )
        )
    return responses


async def create_cheque_remittance(
    db: AsyncSession,
    request: ChequeRemittanceCreateRequest,
    user_id: int,
) -> ChequeRemittance:
    """Generate the deposit entry (debit bank / credit pending cheques account) for a
    batch of previously-recorded cheque-receipt entries, and record which ones were consumed."""
    settings = await _get_cheque_settings(db)
    pending_account_uuid_raw = settings.get("pending_account_uuid")
    bank_account_uuid_raw = settings.get("bank_account_uuid")
    if not pending_account_uuid_raw or not bank_account_uuid_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cheque settings not configured: pending_account_uuid/bank_account_uuid are missing.",
        )
    pending_account_uuid = UUID(str(pending_account_uuid_raw))
    bank_account_uuid = UUID(str(bank_account_uuid_raw))

    # Re-run the candidacy query rather than trusting the caller's snapshot — protects
    # against a race where a cheque was deleted or already remised since the picker loaded.
    candidates = await _load_cheque_candidate_entries(db, request.fiscal_year_uuid, pending_account_uuid, include_drafts=True)
    candidates_by_uuid = {entry.uuid: entry for entry in candidates}
    missing = [str(entry_uuid) for entry_uuid in request.entry_uuids if entry_uuid not in candidates_by_uuid]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entries no longer available for remittance: {', '.join(missing)}",
        )

    selected_entries = [candidates_by_uuid[entry_uuid] for entry_uuid in request.entry_uuids]
    line_amounts = {entry.uuid: Decimal(_pending_line(entry, pending_account_uuid).debit) for entry in selected_entries}
    total = sum(line_amounts.values(), Decimal("0"))

    journal = await _get_bq_journal(db)

    deposit_entry = await create_accounting_entry(
        db,
        AccountingEntryCreateRequest(
            fiscal_year_uuid=request.fiscal_year_uuid,
            journal_uuid=journal.uuid,
            entry_date=request.remittance_date,
            description=f"Remise de chèques du {request.remittance_date.isoformat()}",
            reference=None,
            lines=[
                AccountingLineCreateRequest(account_uuid=bank_account_uuid, debit=total, credit=Decimal("0")),
                AccountingLineCreateRequest(account_uuid=pending_account_uuid, debit=Decimal("0"), credit=total),
            ],
        ),
        user_id,
    )

    remittance = ChequeRemittance(
        fiscal_year_uuid=request.fiscal_year_uuid,
        remittance_date=request.remittance_date,
        deposit_entry_uuid=deposit_entry.uuid,
        total_amount=total,
        created_by=user_id,
    )
    for entry in selected_entries:
        remittance.lines.append(
            ChequeRemittanceLine(
                source_entry_uuid=entry.uuid,
                source_fiscal_year_uuid=request.fiscal_year_uuid,
                amount=line_amounts[entry.uuid],
            )
        )
    db.add(remittance)
    await db.commit()
    await db.refresh(remittance, ["lines"])
    return remittance
