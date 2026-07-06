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
from datetime import date, datetime, timezone
from decimal import Decimal
from difflib import SequenceMatcher
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    AccountingEntry,
    AccountingLine,
    BankCsvMapping,
    BankStatement,
    BankStatementLine,
)
from services.accounting import DEFAULT_SYSTEM_SETTINGS, get_system_setting, post_accounting_entries_batch

logger = logging.getLogger(__name__)

# Statement line statuses eligible for (re)matching.
_REMATCHABLE_STATUSES = ("unmatched", "discrepancy")
_LOCKED_MATCH_STATUSES = ("auto_matched", "manually_matched")

_TIMING_DISCREPANCY_DAYS = 7
_BALANCE_TOLERANCE = Decimal("0.01")
_MATCHING_SETTINGS_MODULE = "bank_reconciliation"
_DEFAULT_MATCHING_SETTINGS = DEFAULT_SYSTEM_SETTINGS[_MATCHING_SETTINGS_MODULE]["matching"]

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


async def list_statement_summaries(
    db: AsyncSession,
    *,
    fiscal_year_uuid: UUID | None = None,
    journal_uuid: UUID | None = None,
    status_filter: str | None = None,
) -> list[dict]:
    """Statement inbox listing enriched with per-statement status counts and a live
    balance difference. Computed via two SQL aggregates over bank_statement_lines
    (GROUP BY statement_uuid), not by loading every line of every statement into
    Python — that per-statement full-report approach is exactly what made the
    400+-line single-statement view slow before it was paginated, and would be worse
    here since it would run once per statement in the list."""
    statements = await list_statements(
        db, fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, status_filter=status_filter
    )
    if not statements:
        return []

    statement_uuids = [s.uuid for s in statements]

    count_rows = await db.execute(
        select(BankStatementLine.statement_uuid, BankStatementLine.match_status, func.count())
        .where(BankStatementLine.statement_uuid.in_(statement_uuids))
        .group_by(BankStatementLine.statement_uuid, BankStatementLine.match_status)
    )
    counts_by_statement: dict[UUID, dict[str, int]] = {}
    for statement_uuid, match_status, count in count_rows:
        counts_by_statement.setdefault(statement_uuid, {})[match_status] = count

    reconciled_sum_rows = await db.execute(
        select(BankStatementLine.statement_uuid, func.sum(BankStatementLine.amount))
        .where(
            BankStatementLine.statement_uuid.in_(statement_uuids),
            BankStatementLine.match_status.in_((*_LOCKED_MATCH_STATUSES, "excluded")),
        )
        .group_by(BankStatementLine.statement_uuid)
    )
    reconciled_sum_by_statement: dict[UUID, Decimal] = dict(reconciled_sum_rows.all())

    summaries: list[dict] = []
    for statement in statements:
        counts = counts_by_statement.get(statement.uuid, {})
        unresolved_count = counts.get("unmatched", 0) + counts.get("discrepancy", 0)
        if statement.status == "reconciled":
            live_balance_difference = statement.balance_difference or Decimal("0")
        else:
            reconciled_sum = reconciled_sum_by_statement.get(statement.uuid, Decimal("0"))
            expected_closing = statement.opening_balance + reconciled_sum
            live_balance_difference = statement.closing_balance - expected_closing

        summaries.append(
            {
                "uuid": statement.uuid,
                "fiscal_year_uuid": statement.fiscal_year_uuid,
                "journal_uuid": statement.journal_uuid,
                "account_uuid": statement.account_uuid,
                "import_date": statement.import_date,
                "statement_date": statement.statement_date,
                "statement_period_start": statement.statement_period_start,
                "statement_period_end": statement.statement_period_end,
                "source_format": statement.source_format,
                "raw_filename": statement.raw_filename,
                "opening_balance": statement.opening_balance,
                "closing_balance": statement.closing_balance,
                "total_debits": statement.total_debits,
                "total_credits": statement.total_credits,
                "line_count": statement.line_count,
                "status": statement.status,
                "reconciled_balance": statement.reconciled_balance,
                "balance_difference": statement.balance_difference,
                "reconciled_at": statement.reconciled_at,
                "reconciled_by": statement.reconciled_by,
                "created_by": statement.created_by,
                "created_at": statement.created_at,
                "updated_at": statement.updated_at,
                "status_counts": counts,
                "unresolved_count": unresolved_count,
                "live_balance_difference": live_balance_difference,
            }
        )
    return summaries


async def delete_statement(db: AsyncSession, statement_uuid: UUID) -> None:
    statement = await get_statement(db, statement_uuid)
    if statement.status == "reconciled":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete a reconciled statement")
    await db.delete(statement)
    await db.commit()


async def list_statement_lines(
    db: AsyncSession,
    statement_uuid: UUID,
    *,
    description: str | None = None,
    match_status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[BankStatementLine], int]:
    """Server-side paginated + filtered listing of a statement's lines, so the
    workspace UI doesn't have to render hundreds of rows at once."""
    conditions = [BankStatementLine.statement_uuid == statement_uuid]
    if description:
        conditions.append(BankStatementLine.description.ilike(f"%{description}%"))
    if match_status:
        # Accept a comma-separated list (e.g. "unmatched,discrepancy" for the default
        # unresolved-first queue) alongside a single status, without a separate param.
        statuses = [s.strip() for s in match_status.split(",") if s.strip()]
        conditions.append(
            BankStatementLine.match_status.in_(statuses) if len(statuses) > 1
            else BankStatementLine.match_status == statuses[0]
        )
    if date_from:
        conditions.append(BankStatementLine.line_date >= date_from)
    if date_to:
        conditions.append(BankStatementLine.line_date <= date_to)
    if amount_min is not None:
        conditions.append(BankStatementLine.amount >= amount_min)
    if amount_max is not None:
        conditions.append(BankStatementLine.amount <= amount_max)

    total = await db.scalar(select(func.count()).select_from(BankStatementLine).where(*conditions))

    result = await db.execute(
        select(BankStatementLine)
        .where(*conditions)
        .order_by(BankStatementLine.line_index)
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), total or 0


# ---------------------------------------------------------------------------
# Matching engine
#
# Score is a weighted composite of three independent signals, each in [0, 1]:
#   - amount: 1.0 at an exact match, decaying linearly to 0 at amount_tolerance.
#             Also acts as a hard candidacy gate — entries beyond the tolerance
#             are never proposed (two different amounts are never "the same
#             transaction", tolerance only exists to absorb rounding).
#   - date:   1.0 at same-day, decaying linearly to 0 at date_tolerance_days.
#             Soft only — a wide date gap lowers confidence but never excludes
#             a candidate, since bank posting lag is common and expected.
#   - description: fuzzy text similarity (difflib) between the statement line's
#             description/counterparty/reference and the entry's description/reference.
# The weighted average is compared against auto_accept_threshold (-> auto_matched)
# and review_threshold (-> discrepancy, needs human review); below review_threshold
# the line is left unmatched. All of the above are per-club parameters stored under
# system_settings.module_name = "bank_reconciliation" (see DEFAULT_SYSTEM_SETTINGS).
# ---------------------------------------------------------------------------

async def get_matching_settings(db: AsyncSession) -> dict:
    """Load matching thresholds/weights, falling back to defaults for any missing key
    (so a partially-customized settings payload never crashes the matching engine)."""
    try:
        setting = await get_system_setting(db, _MATCHING_SETTINGS_MODULE)
        stored = setting.settings.get("matching", {}) if setting.settings else {}
    except HTTPException:
        stored = {}
    return {**_DEFAULT_MATCHING_SETTINGS, **stored}


def _normalize_text(value: str | None) -> str:
    return (value or "").strip().lower()


def _description_similarity(line: BankStatementLine, entry: AccountingEntry) -> float:
    """Best-effort fuzzy similarity between the statement line's free text and the
    entry's — checked across every plausible field pairing since either side might
    carry the useful text in description, reference, or counterparty."""
    line_texts = [_normalize_text(line.description), _normalize_text(line.reference), _normalize_text(line.counterparty)]
    entry_texts = [_normalize_text(entry.description), _normalize_text(entry.reference)]

    best = 0.0
    for a in line_texts:
        if not a:
            continue
        for b in entry_texts:
            if not b:
                continue
            ratio = SequenceMatcher(None, a, b).ratio()
            best = max(best, ratio)
    return best


def _score_candidate(
    *,
    amount_diff: Decimal,
    date_diff: int,
    description_score: float,
    settings: dict,
) -> Decimal:
    amount_tolerance = Decimal(str(settings["amount_tolerance"]))
    date_tolerance = int(settings["date_tolerance_days"])
    weight_amount = Decimal(str(settings["weight_amount"]))
    weight_date = Decimal(str(settings["weight_date"]))
    weight_description = Decimal(str(settings["weight_description"]))

    amount_component = (
        max(Decimal("0"), Decimal("1") - (amount_diff / amount_tolerance)) if amount_tolerance > 0
        else (Decimal("1") if amount_diff == 0 else Decimal("0"))
    )
    date_component = (
        max(Decimal("0"), Decimal("1") - (Decimal(date_diff) / Decimal(date_tolerance))) if date_tolerance > 0
        else (Decimal("1") if date_diff == 0 else Decimal("0"))
    )
    description_component = Decimal(str(round(description_score, 4)))

    total_weight = weight_amount + weight_date + weight_description
    if total_weight <= 0:
        return Decimal("0")

    score = (
        amount_component * weight_amount + date_component * weight_date + description_component * weight_description
    ) / total_weight
    return score.quantize(Decimal("0.001"))


async def _load_eligible_entries(
    db: AsyncSession, statement: BankStatement, *, include_drafts: bool = True
) -> list[AccountingEntry]:
    """Entries in the statement's fiscal year with a line on the statement's account,
    excluding entries already reconciled to another line.

    Scoped by account, not by journal: what actually moves the bank/cash balance is a
    line on statement.account_uuid, regardless of which journal recorded it (e.g. a
    correcting OD entry, or another journal posting directly to the bank account, still
    needs to reconcile against the statement). Restricting to the statement's own
    journal would silently hide legitimate matches recorded elsewhere.

    Draft (state=1) entries are eligible by default alongside Posted (state=2) ones —
    clubs typically draft their bank-journal entries and only post them once reconciled;
    close_reconciliation posts any still-Draft matched entries automatically. Pass
    include_drafts=False to restrict matching to already-Posted entries only.
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
        .where(
            AccountingEntry.fiscal_year_uuid == statement.fiscal_year_uuid,
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


def _is_treasury_account(account) -> bool:
    """PCG class 5 (Trésorerie: Banque/Caisse/Livrets/Régies/Virements internes) —
    the club's own liquidity accounts. NOT the same as `is_reconcilable`, which also
    flags ordinary third-party accounts (411 Membres, 401 Fournisseurs, 43x Organismes
    sociaux...) for lettrage and would otherwise make routine payments look like
    inter-account transfers."""
    return bool(account is not None and account.code and account.code.startswith("5"))


def _is_internal_transfer_candidate(entry: AccountingEntry, bank_line: AccountingLine) -> bool:
    """An entry whose other line also sits on a treasury account is a transfer
    between two of the club's own bank/cash accounts — cap its score to avoid a
    false-positive auto-accept (either leg could plausibly match the same statement
    line, so this always needs human judgment regardless of textual score)."""
    return any(line.uuid != bank_line.uuid and _is_treasury_account(line.account) for line in entry.lines)


async def run_auto_match(db: AsyncSession, statement_uuid: UUID, *, include_drafts: bool = True) -> dict:
    """Score unmatched/discrepancy lines against eligible entries and assign the best
    1-to-1 matches. Drafts are included by default — clubs typically draft their
    bank-journal entries and only post them once reconciled (post_accounting_entries_batch
    posts them automatically when the statement is closed, see close_reconciliation).
    Pass include_drafts=False to restrict matching to already-Posted entries only.
    Returns {auto_matched, flagged_review, unmatched}."""
    statement = await get_statement(db, statement_uuid)
    lines = [l for l in statement.lines if l.match_status in _REMATCHABLE_STATUSES]
    entries = await _load_eligible_entries(db, statement, include_drafts=include_drafts)
    settings = await get_matching_settings(db)

    amount_tolerance = Decimal(str(settings["amount_tolerance"]))
    auto_accept_threshold = Decimal(str(settings["auto_accept_threshold"]))
    review_threshold = Decimal(str(settings["review_threshold"]))
    internal_transfer_cap = Decimal(str(settings["internal_transfer_cap"]))

    candidates: list[tuple[Decimal, BankStatementLine, AccountingEntry]] = []
    for entry in entries:
        bank_line = _entry_bank_line(entry, statement.account_uuid)
        if bank_line is None:
            continue
        entry_signed_amount = bank_line.debit - bank_line.credit
        is_internal_transfer = _is_internal_transfer_candidate(entry, bank_line)

        for line in lines:
            amount_diff = abs(entry_signed_amount - line.amount)
            if amount_diff > amount_tolerance:
                continue

            date_diff = abs((line.line_date - entry.entry_date).days)
            description_score = _description_similarity(line, entry)
            score = _score_candidate(
                amount_diff=amount_diff,
                date_diff=date_diff,
                description_score=description_score,
                settings=settings,
            )
            if is_internal_transfer:
                score = min(score, internal_transfer_cap)

            if score < review_threshold:
                continue

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
        if score >= auto_accept_threshold:
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


async def get_match_candidates(db: AsyncSession, line_uuid: UUID, *, include_drafts: bool = True) -> list[dict]:
    """Ranked match candidates for a single unmatched/discrepancy line, reusing the
    exact eligibility/scoring/internal-transfer-cap logic run_auto_match uses — a
    single source of truth so the manual-match picker can never suggest something
    auto-match itself would score or flag differently.

    Entries already reconciled to another line are excluded by _load_eligible_entries
    (an AccountingEntry can only ever be matched to one BankStatementLine at a time),
    so a ledger entry that's already associated never appears here to be picked again.
    """
    line = await db.get(BankStatementLine, line_uuid)
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Statement line {line_uuid} not found")

    statement = await get_statement(db, line.statement_uuid)
    entries = await _load_eligible_entries(db, statement, include_drafts=include_drafts)
    settings = await get_matching_settings(db)

    amount_tolerance = Decimal(str(settings["amount_tolerance"]))
    internal_transfer_cap = Decimal(str(settings["internal_transfer_cap"]))

    candidates: list[dict] = []
    for entry in entries:
        bank_line = _entry_bank_line(entry, statement.account_uuid)
        if bank_line is None:
            continue

        entry_signed_amount = bank_line.debit - bank_line.credit
        amount_diff = abs(entry_signed_amount - line.amount)
        if amount_diff > amount_tolerance:
            continue

        date_diff = abs((line.line_date - entry.entry_date).days)
        description_score = _description_similarity(line, entry)
        score = _score_candidate(
            amount_diff=amount_diff, date_diff=date_diff, description_score=description_score, settings=settings,
        )
        is_internal_transfer = _is_internal_transfer_candidate(entry, bank_line)
        if is_internal_transfer:
            score = min(score, internal_transfer_cap)

        candidates.append(
            {
                "entry_uuid": entry.uuid,
                "fiscal_year_uuid": entry.fiscal_year_uuid,
                "entry_date": entry.entry_date,
                "description": entry.description,
                "reference": entry.reference,
                "state": entry.state,
                "amount": entry_signed_amount,
                "amount_diff": amount_diff,
                "date_diff": date_diff,
                "description_score": Decimal(str(round(description_score, 4))),
                "score": score,
                "is_internal_transfer": is_internal_transfer,
            }
        )

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates


async def manual_match(
    db: AsyncSession,
    line_uuid: UUID,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    user_id: int,
    *,
    include_drafts: bool = True,
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
        .options(selectinload(AccountingEntry.lines))
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entry {entry_uuid} not found in fiscal year {fiscal_year_uuid}",
        )
    if entry.fiscal_year_uuid != statement.fiscal_year_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Entry must belong to the same fiscal year as the statement",
        )
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


async def _post_draft_matched_entries(
    db: AsyncSession, fiscal_year_uuid: UUID, matched_lines: list[BankStatementLine]
) -> list[AccountingEntry]:
    """Post any still-Draft entries referenced by matched_lines. Reconciling a statement
    is what confirms a Draft bank-journal entry actually happened as recorded, so closing
    is the natural point to post it — this is the standard practice this club follows
    (draft during review so mismatches are still correctable, post at reconciliation)."""
    entries_by_key = await _load_matched_entries(db, matched_lines)
    draft_entry_uuids = [entry.uuid for entry in entries_by_key.values() if entry.state == 1]
    if not draft_entry_uuids:
        return []
    return await post_accounting_entries_batch(db, fiscal_year_uuid, draft_entry_uuids)


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
        # A manual match is an explicit human confirmation — detect_discrepancies (run
        # automatically right after every auto-match pass) must never silently downgrade
        # it back to 'discrepancy'. Only an auto_matched line (never human-reviewed) can
        # be flagged this way; the finding is still counted in `findings`/statement.status
        # either way, but a manually_matched line's own status/type are left untouched.
        if line.match_status == "manually_matched":
            continue
        if line.match_status == "auto_matched":
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


def _compute_live_balance_difference(statement: BankStatement, lines: list[BankStatementLine]) -> Decimal:
    """Expected-vs-actual closing balance, computed the same way close_reconciliation
    checks it — shared so the report/closure-proof panel can show the exact blocker
    the user would otherwise only discover after a failed close attempt.

    'excluded' lines represent real bank movements with no GL counterpart (e.g. bank
    fees): they still affect the bank's closing balance, so they count toward it here
    even though they carry no matched_entry_uuid."""
    reconciled_sum = sum(
        (l.amount for l in lines if l.match_status in _LOCKED_MATCH_STATUSES or l.match_status == "excluded"),
        Decimal("0"),
    )
    expected_closing = statement.opening_balance + reconciled_sum
    return statement.closing_balance - expected_closing


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
    await _post_draft_matched_entries(db, statement.fiscal_year_uuid, matched_lines)

    balance_difference = _compute_live_balance_difference(statement, lines)
    if abs(balance_difference) > _BALANCE_TOLERANCE:
        expected_closing = statement.closing_balance - balance_difference
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

    live_balance_difference = (
        statement.balance_difference or Decimal("0")
        if statement.status == "reconciled"
        else _compute_live_balance_difference(statement, lines)
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
        "live_balance_difference": live_balance_difference,
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
