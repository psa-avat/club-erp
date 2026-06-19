"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - scheduled_entries: Generate accounting entries from recurring templates
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
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from models import (
    AccountingEntry,
    AccountingLine,
    AccountingEntryTemplate,
    AccountingEntryTemplateLine,
    AccountingFiscalYear,
)
from schemas.accounting import (
    AccountingEntryTemplatePreviewResponse,
    AccountingEntryTemplateGenerateResponse,
    AccountingEntryTemplateGenerateDueResponse,
    GenerateDueItem,
    GenerateDueSkipped,
    GenerateDueError,
    GeneratePreviewLine,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ENTRY_STATE_DRAFT = 1
RECURRENCE_MONTHLY = 2
RECURRENCE_QUARTERLY = 3
RECURRENCE_YEARLY = 4

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def generate_entry(
    db: AsyncSession,
    template_uuid: UUID,
    target_date: date,
    user_id: int,
) -> tuple[AccountingEntry, bool]:
    """Generate a single accounting entry from a template.

    Returns (entry, was_already_generated).
    The fiscal year is resolved at runtime: no fiscal_year_uuid passed.
    """
    # 1. Load template with lines
    template = await _load_template(db, template_uuid)

    # 2. Validate template is active
    if not template.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Template {template.code} is inactive",
        )

    # 3. Validate date bounds
    if template.valid_from and target_date < template.valid_from:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Target date {target_date} is before valid_from {template.valid_from}",
        )
    if template.valid_until and target_date > template.valid_until:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Target date {target_date} is after valid_until {template.valid_until}",
        )

    # 4. Resolve fiscal year at runtime
    fy = await _resolve_fiscal_year(db, target_date)

    # 5. Deduplication
    reference = _build_reference(template.code, target_date)
    existing_entry = await _find_existing_by_reference(db, reference, fy.uuid)
    if existing_entry:
        return existing_entry, True

    # 6. Calculate line amounts
    calculated_lines = _calculate_line_amounts(template.lines)

    # 7. Balance check — rounding_adjustment line if needed
    total_debit = sum(line["debit"] for line in calculated_lines)
    total_credit = sum(line["credit"] for line in calculated_lines)

    if total_debit != total_credit:
        # Look for a rounding_adjustment line
        rounding_lines = [l for l in calculated_lines if l["formula_type"] == "rounding_adjustment"]
        if rounding_lines:
            diff = total_debit - total_credit
            rounding_lines[0]["debit"] = abs(diff) if diff > 0 else Decimal("0")
            rounding_lines[0]["credit"] = abs(diff) if diff < 0 else Decimal("0")
            # Recalculate totals
            total_debit = sum(line["debit"] for line in calculated_lines)
            total_credit = sum(line["credit"] for line in calculated_lines)
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Entry {reference} is unbalanced: D {total_debit:.4f} ≠ C {total_credit:.4f} "
                       f"and no rounding_adjustment line found",
            )

    # 8. Create AccountingEntry in Draft
    entry = AccountingEntry(
        uuid=uuid4(),
        fiscal_year_uuid=fy.uuid,
        journal_uuid=template.journal_uuid,
        entry_date=target_date,
        reference=reference,
        description=f"{template.name} — {target_date.strftime('%m/%Y')}",
        state=ENTRY_STATE_DRAFT,
        created_by=user_id,
    )

    # 9. Create AccountingLines
    for line_data in calculated_lines:
        entry.lines.append(
            AccountingLine(
                uuid=uuid4(),
                account_uuid=line_data["account_uuid"],
                debit=line_data["debit"],
                credit=line_data["credit"],
                description=line_data["description"],
                tiers_uuid=line_data.get("tiers_uuid"),
            )
        )

    db.add(entry)

    # 10. Update template scheduling fields
    template.last_generated_at = datetime.now(timezone.utc)
    template.last_generated_entry_uuid = entry.uuid
    template.next_scheduled_date = _compute_next_date(target_date, template)

    await db.commit()
    await db.refresh(entry, ["lines"])
    return entry, False


async def generate_due_entries(
    db: AsyncSession,
    user_id: int,
) -> AccountingEntryTemplateGenerateDueResponse:
    """Generate entries for all due templates.

    Returns a summary of generated, skipped, and errored entries.
    Each template resolves its own fiscal year at runtime.
    A failure on one template does not interrupt others.
    """
    today = date.today()

    conditions = [
        AccountingEntryTemplate.is_active == True,
        AccountingEntryTemplate.next_scheduled_date <= today,
        and_(
            AccountingEntryTemplate.valid_from.is_(None),
            AccountingEntryTemplate.valid_from <= today,
        ),
        and_(
            AccountingEntryTemplate.valid_until.is_(None),
            AccountingEntryTemplate.valid_until >= today,
        ),
    ]

    stmt = (
        select(AccountingEntryTemplate)
        .where(and_(*conditions))
        .options(joinedload(AccountingEntryTemplate.lines))
        .order_by(AccountingEntryTemplate.next_scheduled_date.asc())
    )

    # Use unique() because of joinedload
    result = await db.scalars(stmt)
    templates = result.unique().all()

    generated: list[GenerateDueItem] = []
    skipped: list[GenerateDueSkipped] = []
    errors: list[GenerateDueError] = []

    for template in templates:
        try:
            entry, was_already = await generate_entry(db, template.uuid, today, user_id)
            if was_already:
                skipped.append(GenerateDueSkipped(
                    template_code=template.code,
                    reason="already_generated",
                ))
            else:
                generated.append(GenerateDueItem(
                    template_code=template.code,
                    entry_uuid=entry.uuid,
                    reference=entry.reference,
                    fiscal_year_uuid=entry.fiscal_year_uuid,
                ))
        except HTTPException as exc:
            errors.append(GenerateDueError(
                template_code=template.code,
                reason=exc.detail,
            ))
        except Exception as exc:
            logger.exception(f"Failed to generate entry for template {template.code}")
            errors.append(GenerateDueError(
                template_code=template.code,
                reason=str(exc),
            ))

    return AccountingEntryTemplateGenerateDueResponse(
        generated=generated,
        skipped=skipped,
        errors=errors,
    )


async def preview_generation(
    db: AsyncSession,
    template_uuid: UUID,
    target_date: date,
) -> AccountingEntryTemplatePreviewResponse:
    """Simulate entry generation without persisting.

    Returns calculated lines, totals, fiscal year resolution, and warnings.
    """
    template = await _load_template(db, template_uuid)

    # Resolve fiscal year at runtime
    try:
        fy = await _resolve_fiscal_year(db, target_date)
        fiscal_year_label = f"{fy.start_date.year}/{fy.end_date.year}"
    except HTTPException as exc:
        # Return as a warning if no fiscal year found
        fy = None
        fiscal_year_label = "N/A — aucun exercice ouvert"

    reference = _build_reference(template.code, target_date)
    calculated_lines = _calculate_line_amounts(template.lines)

    total_debit = sum(line["debit"] for line in calculated_lines)
    total_credit = sum(line["credit"] for line in calculated_lines)

    # Check balance
    warnings: list[str] = []
    if total_debit != total_credit:
        has_rounding = any(l["formula_type"] == "rounding_adjustment" for l in calculated_lines)
        if has_rounding:
            diff = total_debit - total_credit
            warnings.append(f"Rounding adjustment line will absorb {'debit' if diff > 0 else 'credit'} excess of {abs(diff):.4f}")
        else:
            warnings.append(f"Entry is unbalanced: D {total_debit:.4f} ≠ C {total_credit:.4f}")

    if fy is None:
        warnings.append(f"No open fiscal year found for {target_date} — generation blocked")

    preview_lines = [
        GeneratePreviewLine(
            account_code=line.get("account_code", ""),
            debit=line["debit"],
            credit=line["credit"],
            description=line["description"],
        )
        for line in calculated_lines
    ]

    return AccountingEntryTemplatePreviewResponse(
        template_code=template.code,
        reference=reference,
        description=f"{template.name} — {target_date.strftime('%m/%Y')}",
        fiscal_year_uuid=fy.uuid if fy else UUID(int=0),
        fiscal_year_label=fiscal_year_label,
        lines=preview_lines,
        total_debit=total_debit,
        total_credit=total_credit,
        is_balanced=(total_debit == total_credit),
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _load_template(db: AsyncSession, template_uuid: UUID) -> AccountingEntryTemplate:
    """Load a template with its lines, raising 404 if not found."""
    stmt = (
        select(AccountingEntryTemplate)
        .where(AccountingEntryTemplate.uuid == template_uuid)
        .options(joinedload(AccountingEntryTemplate.lines))
    )
    template = await db.scalar(stmt)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entry model {template_uuid} not found",
        )
    return template


async def _resolve_fiscal_year(db: AsyncSession, target_date: date) -> AccountingFiscalYear:
    """Resolve the open fiscal year for a given target date.

    Queries accounting_fiscal_years WHERE state = 1
    AND target_date BETWEEN start_date AND end_date.
    """
    stmt = (
        select(AccountingFiscalYear)
        .where(
            AccountingFiscalYear.state == 1,
            AccountingFiscalYear.start_date <= target_date,
            AccountingFiscalYear.end_date >= target_date,
        )
    )
    fy = await db.scalar(stmt)
    if not fy:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No open fiscal year found for {target_date} — generation is blocked. "
                   f"Please open a fiscal year covering this date.",
        )
    return fy


def _build_reference(code: str, target_date: date) -> str:
    """Build a reference string like COTIS-MENSUELLE-202607."""
    return f"{code}-{target_date.strftime('%Y%m')}"


async def _find_existing_by_reference(
    db: AsyncSession,
    reference: str,
    fiscal_year_uuid: UUID,
) -> AccountingEntry | None:
    """Check if an entry with this reference already exists."""
    stmt = (
        select(AccountingEntry)
        .where(
            AccountingEntry.reference == reference,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
        )
    )
    return await db.scalar(stmt)


def _calculate_line_amounts(
    lines: list[AccountingEntryTemplateLine],
) -> list[dict]:
    """Calculate amounts for each line based on formula_type."""
    results: list[dict] = []

    for line in lines:
        line_dict = {
            "account_uuid": line.account_uuid,
            "account_code": "",  # account relationship not loaded by default
            "debit": line.debit,
            "credit": line.credit,
            "description": line.description,
            "tiers_uuid": line.tiers_uuid,
            "formula_type": line.formula_type,
        }

        if line.formula_type == "fixed":
            # Keep template values as-is
            pass

        elif line.formula_type == "percentage":
            params = line.formula_params or {}
            percentage = Decimal(str(params.get("percentage", 0)))
            source_index = params.get("source_line_index", 0)

            if source_index < len(results):
                source = results[source_index]
                source_amount = source["debit"] if source["debit"] > 0 else source["credit"]
                calculated = (source_amount * percentage / Decimal("100")).quantize(Decimal("0.0001"))
                # Apply to the side that has amount
                if line.debit > 0:
                    line_dict["debit"] = calculated
                    line_dict["credit"] = Decimal("0")
                else:
                    line_dict["credit"] = calculated
                    line_dict["debit"] = Decimal("0")
            # If source line not yet computed, keep default amounts

        elif line.formula_type == "previous_period":
            # Keep template amounts as fallback — in a real implementation,
            # we would query last generated entry's lines
            params = line.formula_params or {}
            fallback = Decimal(str(params.get("fallback_amount", 0)))
            if fallback > 0 and line.debit == 0 and line.credit == 0:
                if line.debit > 0 or (line.credit == 0 and line.debit > 0):
                    line_dict["debit"] = fallback
                else:
                    line_dict["credit"] = fallback

        elif line.formula_type == "rounding_adjustment":
            # Will be calculated in the balance step
            line_dict["debit"] = Decimal("0")
            line_dict["credit"] = Decimal("0")

        results.append(line_dict)

    return results


def _compute_next_date(current_date: date, template: AccountingEntryTemplate) -> date:
    """Compute the next scheduled date based on recurrence_type."""
    if template.recurrence_type == RECURRENCE_MONTHLY:
        # Add 1 month, handling calendar quirks
        year = current_date.year + (current_date.month // 12)
        month = (current_date.month % 12) + 1
        day = min(current_date.day, 28)  # Safe day for all months
        return date(year, month, day)
    elif template.recurrence_type == RECURRENCE_QUARTERLY:
        year = current_date.year + ((current_date.month + 2) // 12)
        month = ((current_date.month + 2) % 12) + 1
        day = min(current_date.day, 28)
        return date(year, month, day)
    elif template.recurrence_type == RECURRENCE_YEARLY:
        return date(current_date.year + 1, current_date.month, min(current_date.day, 28))
    else:
        # Manual — no automatic next date
        return None
