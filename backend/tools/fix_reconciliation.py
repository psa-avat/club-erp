"""
ERP-CLUB - ERP pour Club de vol a voile
- Logiciel libre de gestion d'un club de vol a voile
- fix_reconciliation: Bulk bank-reconciliation maintenance.
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

---

Unlike the other tools/ scripts (raw psycopg2 against the DB, reimplementing
just enough SQL to do the job), this one imports and calls the real async
service layer (services.bank_reconciliation.run_auto_match / unmatch)
directly, through the same AsyncSession the FastAPI app uses. Bank
reconciliation match scoring (amount/date/description weights, internal
transfer capping, fiscal-year/state eligibility) is real business logic that
must not drift into a second, hand-rolled SQL implementation here. Every
action this script takes is exactly what a user could trigger from the
Rapprochement bancaire UI ("Lancer le matching" / "Dissocier") — this just
batches it across statements.

Actions (both run by default; pass one or more flags to run a subset):

  --auto-match          Re-run auto-match (services.run_auto_match) on every
                         selected statement. Idempotent and safe to repeat —
                         it only assigns currently unmatched/discrepancy
                         lines within the configured amount tolerance and
                         never touches an already manually_matched line.
                         Always applied live: --dry-run has no effect on this
                         action (there's nothing meaningful to preview for a
                         deterministic, non-destructive scoring pass — use
                         the UI's candidate list to preview instead).

  --unlink-mismatches   Unmatch any linked line (auto_matched or discrepancy
                         by default) whose matched entry's amount does not
                         EXACTLY equal the statement line's amount. Respects
                         --dry-run. manually_matched lines are skipped unless
                         --include-manual is passed, since a human explicitly
                         confirmed those (see detect_discrepancies()'s same
                         rule in services/bank_reconciliation.py).

Scope (default: every non-reconciled statement):
  --statement UUID      restrict to a single statement
  --fiscal-year CODE    restrict to statements in this fiscal year (e.g. 2026)
  --all                 also include already-reconciled statements (default:
                         skipped, since re-touching a closed statement is
                         unusual)

Usage:
  python fix_reconciliation.py --statement <uuid>
  python fix_reconciliation.py --fiscal-year 2026 --unlink-mismatches --dry-run
  python fix_reconciliation.py --fiscal-year 2026
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path
from uuid import UUID

from dotenv import dotenv_values

TOOLS_DIR = Path(__file__).parent.resolve()
BACKEND_DIR = TOOLS_DIR.parent


def _load_database_url() -> str:
    for env_path in [TOOLS_DIR / ".env", BACKEND_DIR.parent / "deploy" / ".env", BACKEND_DIR / ".env"]:
        if env_path.exists():
            vals = dotenv_values(env_path)
            if "DATABASE_URL" in vals:
                return vals["DATABASE_URL"]
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    raise RuntimeError(
        "DATABASE_URL not found in backend/tools/.env, deploy/.env, backend/.env, or environment.\n"
        "Create backend/tools/.env with (note: +asyncpg, unlike the psycopg2 tools):\n"
        "  DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/erp_club_db\n"
    )


# database.py reads DATABASE_URL from the environment at import time, so this
# must run before `from database import ...` below.
os.environ["DATABASE_URL"] = _load_database_url()
sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import select  # noqa: E402

from database import AsyncSessionLocal  # noqa: E402
from models import AccountingEntry, AccountingFiscalYear, AccountingLine, BankStatement, BankStatementLine  # noqa: E402
from services.bank_reconciliation import get_statement, list_statements, run_auto_match, unmatch  # noqa: E402


async def resolve_fiscal_year_uuid(db, code: str | None):
    if not code:
        return None
    fy = await db.scalar(select(AccountingFiscalYear).where(AccountingFiscalYear.code == code))
    if not fy:
        raise SystemExit(f"ERROR: fiscal year '{code}' not found.")
    return fy.uuid


async def select_statements(db, *, statement_uuid: str | None, fiscal_year_uuid, include_reconciled: bool) -> list[BankStatement]:
    if statement_uuid:
        try:
            parsed = UUID(statement_uuid)
        except ValueError:
            raise SystemExit(f"ERROR: '{statement_uuid}' is not a valid UUID.")
        try:
            statement = await get_statement(db, parsed)  # eager-loads .lines, unlike a bare db.get()
        except HTTPException:
            raise SystemExit(f"ERROR: statement '{statement_uuid}' not found.")
        return [statement]

    statements = await list_statements(db, fiscal_year_uuid=fiscal_year_uuid)
    if not include_reconciled:
        statements = [s for s in statements if s.status != "reconciled"]
    return statements


async def cmd_auto_match(db, statements: list[BankStatement], *, include_drafts: bool) -> None:
    print(f"\n=== Auto-match ({len(statements)} statement(s), drafts {'included' if include_drafts else 'excluded'}) ===")
    for statement in statements:
        result = await run_auto_match(db, statement.uuid, include_drafts=include_drafts)
        print(
            f"  {statement.statement_date}  auto_matched={result['auto_matched']:<4} "
            f"flagged_review={result['flagged_review']:<4} unmatched={result['unmatched']:<4}"
        )


async def find_amount_mismatches(db, statements: list[BankStatement], *, include_manual: bool) -> list[dict]:
    statement_uuids = [s.uuid for s in statements]
    statement_by_uuid = {s.uuid: s for s in statements}
    statuses = ["auto_matched", "discrepancy"] + (["manually_matched"] if include_manual else [])

    result = await db.execute(
        select(BankStatementLine, AccountingLine, AccountingEntry)
        .join(
            AccountingLine,
            (AccountingLine.uuid == BankStatementLine.matched_line_uuid)
            & (AccountingLine.fiscal_year_uuid == BankStatementLine.matched_fiscal_year_uuid),
        )
        .join(
            AccountingEntry,
            (AccountingEntry.uuid == AccountingLine.entry_uuid)
            & (AccountingEntry.fiscal_year_uuid == AccountingLine.fiscal_year_uuid),
        )
        .where(
            BankStatementLine.statement_uuid.in_(statement_uuids),
            BankStatementLine.match_status.in_(statuses),
        )
    )

    mismatches = []
    for line, accounting_line, entry in result.all():
        entry_amount = accounting_line.debit - accounting_line.credit
        if entry_amount != line.amount:
            mismatches.append(
                {
                    "line": line,
                    "statement": statement_by_uuid[line.statement_uuid],
                    "entry": entry,
                    "entry_amount": entry_amount,
                }
            )

    mismatches.sort(key=lambda m: (m["statement"].statement_date, m["line"].line_date))
    return mismatches


async def cmd_unlink_mismatches(db, statements: list[BankStatement], *, include_manual: bool, dry_run: bool) -> None:
    mismatches = await find_amount_mismatches(db, statements, include_manual=include_manual)
    suffix = ", including manually_matched" if include_manual else ""
    print(f"\n=== Unlink amount mismatches ({len(mismatches)} found{suffix}) ===")

    for mismatch in mismatches:
        line = mismatch["line"]
        statement = mismatch["statement"]
        entry = mismatch["entry"]
        print(
            f"  [{line.match_status:<16}]  {statement.statement_date}  {line.line_date}  "
            f"stmt={line.amount:>10}  entry={mismatch['entry_amount']:>10}  "
            f"{(entry.description or '')[:50]}"
        )
        if not dry_run:
            await unmatch(db, line.uuid, "fix_reconciliation.py: entry amount differs from statement amount")

    if dry_run:
        print("\nDRY RUN — no changes written.")
    else:
        print(f"\nUnlinked {len(mismatches)} line(s).")


async def main_async(args: argparse.Namespace) -> None:
    async with AsyncSessionLocal() as db:
        fiscal_year_uuid = await resolve_fiscal_year_uuid(db, args.fiscal_year)
        statements = await select_statements(
            db,
            statement_uuid=args.statement,
            fiscal_year_uuid=fiscal_year_uuid,
            include_reconciled=args.all,
        )
        if not statements:
            print("No matching statement(s) found.")
            return

        run_both = not args.auto_match and not args.unlink_mismatches
        if args.auto_match or run_both:
            await cmd_auto_match(db, statements, include_drafts=not args.no_drafts)
        if args.unlink_mismatches or run_both:
            await cmd_unlink_mismatches(db, statements, include_manual=args.include_manual, dry_run=args.dry_run)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-run auto-match and/or unlink amount-mismatched lines across bank statements.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--statement", metavar="UUID", help="Restrict to a single statement")
    parser.add_argument("--fiscal-year", metavar="CODE", help="Restrict to statements in this fiscal year (e.g. 2026)")
    parser.add_argument("--all", action="store_true", help="Include already-reconciled statements (default: skipped)")
    parser.add_argument("--auto-match", action="store_true", help="Run only the auto-match action")
    parser.add_argument("--unlink-mismatches", action="store_true", help="Run only the unlink-mismatches action")
    parser.add_argument("--no-drafts", action="store_true", help="auto-match: exclude Draft entries from candidates")
    parser.add_argument("--include-manual", action="store_true", help="unlink-mismatches: also unmatch manually_matched lines")
    parser.add_argument("--dry-run", action="store_true", help="Preview unlink-mismatches without writing (auto-match is always live)")
    args = parser.parse_args()

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
