"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: matching engine, discrepancies, closure, reporting
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

import logging
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    AccountingEntry,
    AccountingJournal,
    AccountingLine,
    BankCsvMapping,
    BankStatement,
    BankStatementLine,
)

logger = logging.getLogger(__name__)

# Statement line statuses eligible for (re)matching.
_REMATCHABLE_STATUSES = ("unmatched", "discrepancy")
_LOCKED_MATCH_STATUSES = ("auto_matched", "manually_matched")

_AUTO_ACCEPT_THRESHOLD = Decimal("0.90")
_MIN_MATCH_SCORE = Decimal("0.40")
_TIMING_DISCREPANCY_DAYS = 7
_BALANCE_TOLERANCE = Decimal("0.01")

# Note on sign convention: bank_statement_lines.amount follows the bank-statement
# convention (positive = money received / "crédit" on the customer's statement).
# For the reconciled GL line (an asset account: Banque=3 or Caisse=4), a deposit is
# recorded as a DEBIT (increase of the asset), so the equivalent signed amount on the
# GL side is (debit - credit) — not (credit - debit) — for it to carry the same sign
# as the statement amount.


async def get_statement(db: AsyncSession, statement_uuid: UUID) -> BankStatement:
    statement = await db.get(BankStatement, statement_uuid, options=(selectinload(BankStatement.lines),))
    if not statement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Statement {statement_uuid} not found")
    return statement


async def list_statements(
    db: AsyncSession,
    *,
    fiscal_year_uuid: UUID | None = None,
    journal_uuid: UUID | None = None,
    status_filter: str | None = None,
) -> list[BankStatement]:
    stmt = select(BankStatement).order_by(BankStatement.statement_date.desc())
    if fiscal_year_uuid:
        stmt = stmt.where(BankStatement.fiscal_year_uuid == fiscal_year_uuid)
    if journal_uuid:
        stmt = stmt.where(BankStatement.journal_uuid == journal_uuid)
    if status_filter:
        stmt = stmt.where(BankStatement.status == status_filter)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def delete_statement(db: AsyncSession, statement_uuid: UUID) -> None:
    statement = await get_statement(db, statement_uuid)
    if statement.status == "reconciled":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete a reconciled statement")
    await db.delete(statement)
    await db.commit()


# ---------------------------------------------------------------------------
# Matching engine
# ---------------------------------------------------------------------------

def _score_candidate(date_diff: int, reference_match: bool) -> Decimal:
    if reference_match and date_diff <= 1:
        return Decimal("1.000")
    if date_diff == 0:
        return Decimal("0.950")
    if date_diff <= 3:
        return Decimal("0.850")
    if date_diff <= 7:
        return Decimal("0.600")
    if date_diff <= 30:
        return Decimal("0.500")
    return _MIN_MATCH_SCORE


async def _load_eligible_entries(
    db: AsyncSession, statement: BankStatement, *, include_drafts: bool = False
) -> list[AccountingEntry]:
    """Entries in the statement's journal/fiscal year with a line on the statement's
    account, excluding entries already reconciled to another line.

    Posted (state=2) only by default. When include_drafts is true, Draft (state=1)
    entries are also eligible for matching/preview — useful when a club drafts its
    bank-journal entries before posting them. This never affects close_reconciliation,
    which always requires matched entries to be Posted before a statement can close.
    """
    bank_line_exists = (
        select(AccountingLine.uuid)
        .where(
            AccountingLine.entry_uuid == AccountingEntry.uuid,
            AccountingLine.fiscal_year_uuid == AccountingEntry.fiscal_year_uuid,
            AccountingLine.account_uuid == statement.account_uuid,
        )
        .exists()
    )
    matched_entry_uuids = select(BankStatementLine.matched_entry_uuid).where(
        BankStatementLine.match_status.in_(_LOCKED_MATCH_STATUSES),
        BankStatementLine.matched_entry_uuid.isnot(None),
    )
    eligible_states = (1, 2) if include_drafts else (2,)

    stmt = (
        select(AccountingEntry)
        .join(AccountingJournal, AccountingJournal.uuid == AccountingEntry.journal_uuid)
        .where(
            AccountingEntry.fiscal_year_uuid == statement.fiscal_year_uuid,
            AccountingEntry.journal_uuid == statement.journal_uuid,
            AccountingJournal.type.in_((3, 4)),
            AccountingEntry.state.in_(eligible_states),
            AccountingEntry.reversal_of_entry_uuid.is_(None),
            bank_line_exists,
            AccountingEntry.uuid.notin_(matched_entry_uuids),
        )
        .options(selectinload(AccountingEntry.lines).joinedload(AccountingLine.account))
    )
    result = await db.execute(stmt)
    return list(result.unique().scalars().all())


def _entry_bank_line(entry: AccountingEntry, account_uuid: UUID) -> AccountingLine | None:
    return next((l for l in entry.lines if l.account_uuid == account_uuid), None)


def _is_internal_transfer_candidate(entry: AccountingEntry, bank_line: AccountingLine) -> bool:
    """An entry whose other line also sits on a reconcilable account is a transfer
    between two of the club's own bank/cash accounts — cap its score to avoid a
    false-positive 1.0 auto-accept."""
    return any(
        line.uuid != bank_line.uuid and line.account is not None and line.account.is_reconcilable
        for line in entry.lines
    )


async def run_auto_match(db: AsyncSession, statement_uuid: UUID, *, include_drafts: bool = False) -> dict:
    """Score unmatched/discrepancy lines against eligible entries and assign the best
    1-to-1 matches. Posted-only by default; pass include_drafts=True to also consider
    Draft entries (e.g. when the club hasn't posted its bank-journal entries yet).
    Returns {auto_matched, flagged_review, unmatched}."""
    statement = await get_statement(db, statement_uuid)
    lines = [l for l in statement.lines if l.match_status in _REMATCHABLE_STATUSES]
    entries = await _load_eligible_entries(db, statement, include_drafts=include_drafts)

    candidates: list[tuple[Decimal, BankStatementLine, AccountingEntry]] = []
    for entry in entries:
        bank_line = _entry_bank_line(entry, statement.account_uuid)
        if bank_line is None:
            continue
        entry_signed_amount = bank_line.debit - bank_line.credit
        is_internal_transfer = _is_internal_transfer_candidate(entry, bank_line)

        for line in lines:
            if entry_signed_amount != line.amount:
                continue

            date_diff = abs((line.line_date - entry.entry_date).days)
            reference_match = bool(line.reference) and (
                line.reference == entry.reference
                or (entry.reference and line.reference in entry.reference)
                or (entry.description and line.reference in entry.description)
            )
            score = _score_candidate(date_diff, reference_match)
            if is_internal_transfer:
                score = min(score, Decimal("0.60"))

            candidates.append((score, line, entry))

    candidates.sort(key=lambda c: c[0], reverse=True)

    assigned_lines: set[UUID] = set()
    assigned_entries: set[UUID] = set()
    for score, line, entry in candidates:
        if line.uuid in assigned_lines or entry.uuid in assigned_entries:
            continue
        assigned_lines.add(line.uuid)
        assigned_entries.add(entry.uuid)

        line.match_confidence = score
        line.matched_entry_uuid = entry.uuid
        line.matched_fiscal_year_uuid = entry.fiscal_year_uuid
        if score >= _AUTO_ACCEPT_THRESHOLD:
            line.match_status = "auto_matched"
            line.discrepancy_type = None
        else:
            line.match_status = "discrepancy"
            line.discrepancy_type = "amount_variance"

    for line in lines:
        if line.uuid not in assigned_lines:
            line.match_status = "unmatched"
            line.matched_entry_uuid = None
            line.matched_fiscal_year_uuid = None
            line.match_confidence = None
            line.discrepancy_type = None

    if statement.status == "imported":
        statement.status = "matching"

    await db.commit()

    return {
        "auto_matched": sum(1 for l in lines if l.match_status == "auto_matched"),
        "flagged_review": sum(1 for l in lines if l.match_status == "discrepancy"),
        "unmatched": sum(1 for l in lines if l.match_status == "unmatched"),
    }


async def manual_match(
    db: AsyncSession,
    line_uuid: UUID,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
    *,
    include_drafts: bool = False,
) -> BankStatementLine:
    line = await db.get(BankStatementLine, line_uuid)
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Statement line {line_uuid} not found")
    if line.match_status in _LOCKED_MATCH_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Line {line_uuid} is already matched")

    statement = await get_statement(db, line.statement_uuid)

    entry = await db.scalar(
        select(AccountingEntry)
        .where(AccountingEntry.uuid == entry_uuid, AccountingEntry.fiscal_year_uuid == fiscal_year_uuid)
        .options(selectinload(AccountingEntry.journal), selectinload(AccountingEntry.lines))
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entry {entry_uuid} not found in fiscal year {fiscal_year_uuid}",
        )
    if entry.journal_uuid != statement.journal_uuid or entry.fiscal_year_uuid != statement.fiscal_year_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Entry must belong to the same journal and fiscal year as the statement",
        )
    if entry.journal.type not in (3, 4):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Entry's journal is not Banque/Caisse")
    if entry.state == 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancelled entries cannot be reconciled")
    if entry.state == 1 and not include_drafts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only posted entries can be reconciled (enable 'include drafts' to match against Draft entries)",
        )
    if _entry_bank_line(entry, statement.account_uuid) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry has no line on account {statement.account_uuid}",
        )

    already_matched = await db.scalar(
        select(BankStatementLine.uuid)
        .where(
            BankStatementLine.matched_entry_uuid == entry.uuid,
            BankStatementLine.matched_fiscal_year_uuid == entry.fiscal_year_uuid,
            BankStatementLine.match_status.in_(_LOCKED_MATCH_STATUSES),
        )
        .limit(1)
    )
    if already_matched:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entry {entry_uuid} is already reconciled against another statement line",
        )

    line.match_status = "manually_matched"
    line.matched_entry_uuid = entry.uuid
    line.matched_fiscal_year_uuid = entry.fiscal_year_uuid
    line.match_confidence = None
    line.discrepancy_type = None
    line.resolved_at = datetime.now(timezone.utc)
    line.resolved_by = user_id

    await db.commit()
    await db.refresh(line)
    return line


async def unmatch(db: AsyncSession, line_uuid: UUID, reason: str) -> BankStatementLine:
    line = await db.get(BankStatementLine, line_uuid)
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Statement line {line_uuid} not found")

    line.match_status = "unmatched"
    line.matched_entry_uuid = None
    line.matched_fiscal_year_uuid = None
    line.match_confidence = None
    line.discrepancy_type = None
    line.discrepancy_notes = reason
    line.resolved_at = None
    line.resolved_by = None

    await db.commit()
    await db.refresh(line)
    return line


# ---------------------------------------------------------------------------
# Discrepancies, correcting entries, closure, reporting
# ---------------------------------------------------------------------------

async def _load_matched_entries(
    db: AsyncSession,
    lines: list[BankStatementLine],
    *,
    with_lines: bool = False,
    exclude_excluded: bool = False,
) -> dict[tuple[UUID, UUID], AccountingEntry]:
    """Batch-fetch the AccountingEntry referenced by matched_entry_uuid/matched_fiscal_year_uuid
    on a set of statement lines, keyed by (entry_uuid, fiscal_year_uuid)."""
    matched_keys = {
        (l.matched_entry_uuid, l.matched_fiscal_year_uuid)
        for l in lines
        if l.matched_entry_uuid and not (exclude_excluded and l.match_status == "excluded")
    }
    if not matched_keys:
        return {}

    uuids = [k[0] for k in matched_keys]
    fy_uuids = [k[1] for k in matched_keys]
    stmt = select(AccountingEntry).where(
        AccountingEntry.uuid.in_(uuids), AccountingEntry.fiscal_year_uuid.in_(fy_uuids)
    )
    if with_lines:
        stmt = stmt.options(selectinload(AccountingEntry.lines))
    result = await db.execute(stmt)
    entries = result.scalars().unique().all() if with_lines else result.scalars().all()
    return {(entry.uuid, entry.fiscal_year_uuid): entry for entry in entries}


async def _find_unposted_matched_entries(db: AsyncSession, matched_lines: list[BankStatementLine]) -> list[UUID]:
    """Return the entry uuids referenced by matched_lines that are not yet Posted (state=2)."""
    entries_by_key = await _load_matched_entries(db, matched_lines)
    return [entry.uuid for entry in entries_by_key.values() if entry.state != 2]


async def detect_discrepancies(db: AsyncSession, statement_uuid: UUID) -> list[dict]:
    """Scan a statement's lines for missing_entry / amount_variance / timing /
    duplicate issues. Sets statement.status = 'flagged' if any is found."""
    statement = await get_statement(db, statement_uuid)
    lines = statement.lines

    entries_by_key = await _load_matched_entries(db, lines, with_lines=True, exclude_excluded=True)

    findings: list[dict] = []
    seen_entry_keys: dict[tuple, UUID] = {}

    for line in lines:
        if line.match_status == "excluded":
            continue

        if line.match_status == "unmatched":
            findings.append(
                {
                    "line_uuid": line.uuid,
                    "type": "missing_entry",
                    "description": f"No GL entry found for {line.line_date} / {line.amount}",
                }
            )
            continue

        key = (line.matched_entry_uuid, line.matched_fiscal_year_uuid)
        entry = entries_by_key.get(key)
        if entry is None:
            continue

        if key in seen_entry_keys:
            findings.append(
                {
                    "line_uuid": line.uuid,
                    "type": "duplicate",
                    "description": f"Entry {entry.uuid} already matched to line {seen_entry_keys[key]}",
                }
            )
        else:
            seen_entry_keys[key] = line.uuid

        bank_line = _entry_bank_line(entry, statement.account_uuid)
        if bank_line is not None:
            entry_signed_amount = bank_line.debit - bank_line.credit
            if entry_signed_amount != line.amount:
                findings.append(
                    {
                        "line_uuid": line.uuid,
                        "type": "amount_variance",
                        "description": f"Statement amount {line.amount} != entry amount {entry_signed_amount}",
                    }
                )

        date_diff = abs((line.line_date - entry.entry_date).days)
        if date_diff > _TIMING_DISCREPANCY_DAYS:
            findings.append(
                {
                    "line_uuid": line.uuid,
                    "type": "timing",
                    "description": f"{date_diff} days between statement line and entry date",
                }
            )

    finding_type_by_line: dict[UUID, str] = {}
    for finding in findings:
        finding_type_by_line.setdefault(finding["line_uuid"], finding["type"])

    lines_by_uuid = {l.uuid: l for l in lines}
    for line_uuid, discrepancy_type in finding_type_by_line.items():
        line = lines_by_uuid[line_uuid]
        if line.match_status in _LOCKED_MATCH_STATUSES:
            line.match_status = "discrepancy"
        line.discrepancy_type = discrepancy_type

    if findings:
        statement.status = "flagged"

    await db.commit()
    return findings


async def create_correcting_entry(
    db: AsyncSession,
    line_uuid: UUID,
    counter_account_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> AccountingEntry:
    """Create a Draft entry in the statement's Banque/Caisse journal for a line
    that has no matching GL entry, then mark the line as manually matched to it."""
    from schemas.accounting import AccountingEntryCreateRequest, AccountingLineCreateRequest
    from services.accounting import create_accounting_entry

    line = await db.get(BankStatementLine, line_uuid)
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Statement line {line_uuid} not found")
    statement = await get_statement(db, line.statement_uuid)
    if statement.fiscal_year_uuid != fiscal_year_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fiscal_year_uuid does not match the statement's fiscal year",
        )

    amount = line.amount
    bank_debit = amount if amount > 0 else Decimal("0")
    bank_credit = -amount if amount < 0 else Decimal("0")

    request = AccountingEntryCreateRequest(
        journal_uuid=statement.journal_uuid,
        entry_date=line.line_date,
        description=f"Correction rapprochement - {line.description or ''}".strip(),
        reference=f"RAPPRO-{statement.statement_date.isoformat()}-{line.line_index}",
        fiscal_year_uuid=fiscal_year_uuid,
        lines=[
            AccountingLineCreateRequest(account_uuid=statement.account_uuid, debit=bank_debit, credit=bank_credit),
            AccountingLineCreateRequest(account_uuid=counter_account_uuid, debit=bank_credit, credit=bank_debit),
        ],
        source_system="bank_reconciliation",
    )
    entry = await create_accounting_entry(db, request, user_id)

    line.match_status = "manually_matched"
    line.matched_entry_uuid = entry.uuid
    line.matched_fiscal_year_uuid = entry.fiscal_year_uuid
    line.match_confidence = None
    line.discrepancy_type = None
    line.resolved_at = datetime.now(timezone.utc)
    line.resolved_by = user_id

    await db.commit()
    await db.refresh(entry, ["lines"])
    return entry


async def resolve_discrepancy(
    db: AsyncSession,
    line_uuid: UUID,
    action: str,
    user_id: int,
    counter_account_uuid: UUID | None = None,
    notes: str | None = None,
) -> BankStatementLine:
    """action: 'accept' (confirm the suggested match) | 'exclude' (not a GL operation,
    e.g. a bank fee to ignore) | 'create_correcting_entry' (generate a Draft entry)."""
    line = await db.get(BankStatementLine, line_uuid)
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Statement line {line_uuid} not found")
    if line.match_status not in ("discrepancy", "unmatched"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Line {line_uuid} has no discrepancy to resolve (status={line.match_status})",
        )

    if action == "accept":
        if not line.matched_entry_uuid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No suggested entry to accept")
        line.match_status = "manually_matched"
        line.discrepancy_type = None
        line.discrepancy_notes = notes
        line.resolved_at = datetime.now(timezone.utc)
        line.resolved_by = user_id
        await db.commit()
        await db.refresh(line)
        return line

    if action == "exclude":
        line.match_status = "excluded"
        line.matched_entry_uuid = None
        line.matched_fiscal_year_uuid = None
        line.match_confidence = None
        line.discrepancy_type = None
        line.discrepancy_notes = notes
        line.resolved_at = datetime.now(timezone.utc)
        line.resolved_by = user_id
        await db.commit()
        await db.refresh(line)
        return line

    if action == "create_correcting_entry":
        if not counter_account_uuid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="counter_account_uuid is required to create a correcting entry",
            )
        statement = await get_statement(db, line.statement_uuid)
        await create_correcting_entry(db, line_uuid, counter_account_uuid, statement.fiscal_year_uuid, user_id)
        await db.refresh(line)
        return line

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown resolution action {action!r}")


async def close_reconciliation(db: AsyncSession, statement_uuid: UUID, user_id: int) -> BankStatement:
    statement = await get_statement(db, statement_uuid)
    lines = statement.lines

    unresolved = [l for l in lines if l.match_status in _REMATCHABLE_STATUSES]
    if unresolved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{len(unresolved)} statement line(s) are not resolved (unmatched or discrepancy)",
        )

    matched_lines = [l for l in lines if l.match_status in _LOCKED_MATCH_STATUSES]
    unposted = await _find_unposted_matched_entries(db, matched_lines)
    if unposted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{len(unposted)} matched entry(ies) are not posted yet — post them before closing "
                f"(entry uuids: {', '.join(str(u) for u in unposted)})"
            ),
        )

    # 'excluded' lines represent real bank movements with no GL counterpart (e.g. bank
    # fees): they still affect the bank's closing balance, so they count toward it here
    # even though they carry no matched_entry_uuid.
    reconciled_sum = sum(
        (l.amount for l in lines if l.match_status in _LOCKED_MATCH_STATUSES or l.match_status == "excluded"),
        Decimal("0"),
    )
    expected_closing = statement.opening_balance + reconciled_sum
    balance_difference = statement.closing_balance - expected_closing
    if abs(balance_difference) > _BALANCE_TOLERANCE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Balance mismatch: expected closing {expected_closing}, "
                f"statement closing {statement.closing_balance}"
            ),
        )

    statement.status = "reconciled"
    statement.reconciled_balance = statement.closing_balance
    statement.balance_difference = balance_difference
    statement.reconciled_at = datetime.now(timezone.utc)
    statement.reconciled_by = user_id

    await db.commit()
    await db.refresh(statement)
    return statement


async def get_reconciliation_report(db: AsyncSession, statement_uuid: UUID) -> dict:
    statement = await get_statement(db, statement_uuid)
    lines = sorted(statement.lines, key=lambda l: l.line_index)

    entries_by_key = await _load_matched_entries(db, lines)

    status_counts: dict[str, int] = {}
    correcting_entries: list[dict] = []
    unresolved_lines: list[dict] = []

    for line in lines:
        status_counts[line.match_status] = status_counts.get(line.match_status, 0) + 1

        entry = entries_by_key.get((line.matched_entry_uuid, line.matched_fiscal_year_uuid)) if line.matched_entry_uuid else None
        if entry is not None and entry.source_system == "bank_reconciliation":
            correcting_entries.append(
                {
                    "line_uuid": line.uuid,
                    "entry_uuid": entry.uuid,
                    "fiscal_year_uuid": entry.fiscal_year_uuid,
                    "reference": entry.reference,
                    "description": entry.description,
                }
            )

        if line.match_status in _REMATCHABLE_STATUSES:
            unresolved_lines.append(
                {
                    "uuid": line.uuid,
                    "line_date": line.line_date,
                    "description": line.description,
                    "amount": line.amount,
                    "match_status": line.match_status,
                    "discrepancy_type": line.discrepancy_type,
                    "discrepancy_notes": line.discrepancy_notes,
                }
            )

    return {
        "statement_uuid": statement.uuid,
        "fiscal_year_uuid": statement.fiscal_year_uuid,
        "journal_uuid": statement.journal_uuid,
        "account_uuid": statement.account_uuid,
        "statement_date": statement.statement_date,
        "period_start": statement.statement_period_start,
        "period_end": statement.statement_period_end,
        "opening_balance": statement.opening_balance,
        "closing_balance": statement.closing_balance,
        "reconciled_balance": statement.reconciled_balance,
        "balance_difference": statement.balance_difference,
        "status": statement.status,
        "line_count": statement.line_count,
        "status_counts": status_counts,
        "correcting_entries": correcting_entries,
        "unresolved_lines": unresolved_lines,
        "reconciled_at": statement.reconciled_at,
        "reconciled_by": statement.reconciled_by,
    }


# ---------------------------------------------------------------------------
# CSV mapping CRUD
# ---------------------------------------------------------------------------

async def list_csv_mappings(db: AsyncSession, *, user_id: int | None = None) -> list[BankCsvMapping]:
    stmt = select(BankCsvMapping).order_by(BankCsvMapping.name)
    if user_id is not None:
        stmt = stmt.where(BankCsvMapping.created_by == user_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_csv_mapping(
    db: AsyncSession,
    *,
    name: str,
    column_mapping: dict,
    separator: str | None,
    encoding: str | None,
    date_format: str,
    user_id: int,
) -> BankCsvMapping:
    mapping = BankCsvMapping(
        name=name,
        created_by=user_id,
        column_mapping=column_mapping,
        separator=separator,
        encoding=encoding,
        date_format=date_format or "DD/MM/YYYY",
    )
    db.add(mapping)
    await db.commit()
    await db.refresh(mapping)
    return mapping


async def delete_csv_mapping(db: AsyncSession, mapping_uuid: UUID) -> None:
    mapping = await db.get(BankCsvMapping, mapping_uuid)
    if not mapping:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"CSV mapping {mapping_uuid} not found")
    await db.delete(mapping)
    await db.commit()
