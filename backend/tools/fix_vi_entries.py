"""
ERP-CLUB - ERP pour Club de vol a voile
- Logiciel libre de gestion d'un club de vol a voile
- fix_vi_entries: Correct VI realization entry lines.
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

Fix VI realization entries that were created with the insurance amount
deducted from the revenue account (7067) instead of being recognized
as a full-amount revenue offset by an FFVP receivable.

Current (broken) realization entry structure:
  D 419100  amount_ttc
  C 7067    amount_ttc - insurance_amount   ← flight portion only
  C 401     insurance_amount                ← insurance payable

Target structure after fix:
  D 419100  amount_ttc                      ← unchanged
  C 7067    amount_ttc                      ← increased by insurance_amount
  C 401     insurance_amount                ← unchanged
  D 616     insurance_amount                ← new balancing line (FFVP receivable)

The fix:
  1. Increases the 7067 CREDIT by the insurance_amount (from the 401 line).
  2. Inserts a new DEBIT line on account --debit-account (default: first account
     with code starting with "616") for the same amount and tiers as the 401 line.

Only realization entries that:
  - have a 401 line (insurance was booked), AND
  - do NOT already have a 616 line (not yet fixed)
are modified. All others are reported but skipped.

Usage:
  python fix_vi_entries.py [--fiscal-year CODE] [--debit-account CODE]
                           [--dry-run] [--include-posted]

  --fiscal-year CODE    restrict to entries in this fiscal year (e.g. "2026")
  --debit-account CODE  account code for the new debit line (default: "416")
  --dry-run             show what would change without modifying the database
  --include-posted      also fix posted entries (state=2); default skips them
"""

import argparse
import os
import sys
import uuid
from decimal import Decimal
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

TOOLS_DIR = Path(__file__).parent.resolve()

ENTRY_STATE_LABELS = {1: "Draft", 2: "Posted", 3: "Cancelled"}


# ---------------------------------------------------------------------------
# DB connection
# ---------------------------------------------------------------------------

def _load_db_url() -> str:
    for env_path in [
        TOOLS_DIR / ".env",
        TOOLS_DIR.parent.parent / "deploy" / ".env",
        TOOLS_DIR.parent / ".env",
    ]:
        if env_path.exists():
            vals = dotenv_values(env_path)
            if "DATABASE_URL" in vals:
                return vals["DATABASE_URL"]
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    raise RuntimeError(
        "DATABASE_URL not found in backend/tools/.env, deploy/.env, backend/.env, or environment.\n"
        "Create backend/tools/.env with:\n"
        "  DATABASE_URL=postgresql://user:password@localhost:5432/erp_club_db\n"
    )


def _connect() -> psycopg2.extensions.connection:
    url = _load_db_url()
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return psycopg2.connect(url)


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

def lookup_debit_account(cur, code_prefix: str) -> dict:
    """Return the first accounting account whose code starts with code_prefix."""
    cur.execute(
        "SELECT uuid, code, name FROM accounting_accounts WHERE code LIKE %s ORDER BY code LIMIT 1",
        (code_prefix + "%",),
    )
    row = cur.fetchone()
    if row is None:
        raise SystemExit(
            f"ERROR: No account found with code starting with '{code_prefix}'.\n"
            "Create the account in the chart of accounts or use --debit-account to specify a different code."
        )
    return {"uuid": row[0], "code": row[1], "name": row[2]}


def lookup_fiscal_year(cur, code: str) -> dict:
    cur.execute(
        "SELECT uuid, code, label FROM accounting_fiscal_years WHERE code = %s",
        (code,),
    )
    row = cur.fetchone()
    if row is None:
        raise SystemExit(f"ERROR: Fiscal year '{code}' not found.")
    return {"uuid": row[0], "code": row[1], "label": row[2]}


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def load_realization_entries(cur, fiscal_year_uuid=None) -> list[dict]:
    """
    Return all VI entitlements that have a realization_entry_uuid, with
    their accounting entry state and fiscal_year_uuid.
    """
    where_clause = "WHERE ve.realization_entry_uuid IS NOT NULL"
    params = []
    if fiscal_year_uuid:
        where_clause += " AND ae.fiscal_year_uuid = %s"
        params.append(fiscal_year_uuid)

    cur.execute(
        f"""
        SELECT
            ve.uuid            AS entitlement_uuid,
            ve.code            AS entitlement_code,
            ve.realization_entry_uuid,
            ae.fiscal_year_uuid,
            ae.state           AS entry_state,
            ae.reference
        FROM vi_entitlements ve
        JOIN accounting_entries ae ON ae.uuid = ve.realization_entry_uuid
        {where_clause}
        ORDER BY ve.code
        """,
        params,
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def load_entry_lines(cur, entry_uuid, fiscal_year_uuid) -> list[dict]:
    """Return all lines for a given entry with their account codes."""
    cur.execute(
        """
        SELECT
            al.uuid,
            al.account_uuid,
            aa.code  AS account_code,
            al.tiers_uuid,
            al.debit,
            al.credit,
            al.description
        FROM accounting_lines al
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        WHERE al.entry_uuid = %s AND al.fiscal_year_uuid = %s
        ORDER BY al.credit DESC, al.debit DESC
        """,
        (entry_uuid, fiscal_year_uuid),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def classify_entry(lines: list[dict], debit_account_code: str) -> dict:
    """
    Classify the lines of a realization entry.

    Returns a dict with:
      line_419  — the 419xxx DEBIT line (or None)
      line_7067 — the 7067 CREDIT line (or None)
      line_401  — the 401xxx CREDIT line with the insurance amount (or None)
      line_416  — an existing debit-account line (already fixed, or None)
    """
    result = {"line_419": None, "line_7067": None, "line_401": None, "line_416": None}
    for line in lines:
        code = line["account_code"]
        if code.startswith("419") and Decimal(str(line["debit"])) > 0:
            result["line_419"] = line
        elif code.startswith("7067") and Decimal(str(line["credit"])) > 0:
            result["line_7067"] = line
        elif code.startswith("401") and Decimal(str(line["credit"])) > 0:
            result["line_401"] = line
        elif code.startswith(debit_account_code) and Decimal(str(line["debit"])) > 0:
            result["line_416"] = line
    return result


def apply_fix(cur, entry: dict, classification: dict, debit_account: dict) -> None:
    """
    Apply the fix to one realization entry:
      1. Increase the 7067 line credit by the 401 line credit (insurance_amount).
      2. Insert a new debit line on debit_account for insurance_amount.
    """
    line_7067 = classification["line_7067"]
    line_401 = classification["line_401"]
    insurance_amount = Decimal(str(line_401["credit"]))
    new_credit = Decimal(str(line_7067["credit"])) + insurance_amount
    line_description = line_401["description"] or f"Assurance VI"

    # 1. Increase 7067 credit
    cur.execute(
        "UPDATE accounting_lines SET credit = %s WHERE uuid = %s AND fiscal_year_uuid = %s",
        (new_credit, str(line_7067["uuid"]), str(entry["fiscal_year_uuid"])),
    )

    # 2. Insert new debit line on 416 (same tiers as 401)
    new_uuid = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO accounting_lines
            (uuid, fiscal_year_uuid, entry_uuid, account_uuid, tiers_uuid,
             debit, credit, description)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            new_uuid,
            str(entry["fiscal_year_uuid"]),
            str(entry["realization_entry_uuid"]),
            str(debit_account["uuid"]),
            str(line_401["tiers_uuid"]) if line_401["tiers_uuid"] else None,
            insurance_amount,
            Decimal("0"),
            line_description,
        ),
    )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fix VI realization entries: increase 7067 by insurance amount and add a debit line.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--fiscal-year", metavar="CODE", help="Restrict to this fiscal year (e.g. 2026)")
    parser.add_argument("--debit-account", metavar="CODE", default="416",
                        help="Account code for the new debit line (default: 416)")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without modifying the database")
    parser.add_argument("--include-posted", action="store_true", help="Also fix posted entries (state=2)")
    args = parser.parse_args()

    conn = _connect()
    cur = conn.cursor()

    # Resolve debit account
    debit_account = lookup_debit_account(cur, args.debit_account)
    print(f"Debit account  : {debit_account['code']} — {debit_account['name']}")

    # Resolve fiscal year filter
    fy_uuid = None
    if args.fiscal_year:
        fy = lookup_fiscal_year(cur, args.fiscal_year)
        fy_uuid = fy["uuid"]
        print(f"Fiscal year    : {fy['code']} ({fy['label']})")

    print(f"Mode           : {'DRY RUN — no changes will be written' if args.dry_run else 'LIVE — changes will be committed'}")
    print(f"Posted entries : {'included' if args.include_posted else 'skipped'}")
    print()

    entries = load_realization_entries(cur, fy_uuid)
    print(f"Realization entries found: {len(entries)}")
    print()

    stats = {"fixed": 0, "already_ok": 0, "no_insurance": 0, "skipped_posted": 0, "skipped_cancelled": 0}

    for entry in entries:
        code = entry["entitlement_code"]
        state = entry["entry_state"]
        state_label = ENTRY_STATE_LABELS.get(state, str(state))

        if state == 3:
            print(f"  SKIP  {code:30s}  [{state_label}]  cancelled — skipping")
            stats["skipped_cancelled"] += 1
            continue

        if state == 2 and not args.include_posted:
            print(f"  SKIP  {code:30s}  [{state_label}]  use --include-posted to fix posted entries")
            stats["skipped_posted"] += 1
            continue

        lines = load_entry_lines(cur, entry["realization_entry_uuid"], entry["fiscal_year_uuid"])
        cl = classify_entry(lines, args.debit_account)

        if cl["line_7067"] is None:
            print(f"  WARN  {code:30s}  [{state_label}]  no 7067 line found — skipping")
            continue

        if cl["line_401"] is None:
            print(f"  INFO  {code:30s}  [{state_label}]  no 401 insurance line — skipping (no insurance)")
            stats["no_insurance"] += 1
            continue

        if cl["line_416"] is not None:
            insurance_amount = Decimal(str(cl["line_401"]["credit"]))
            print(
                f"  OK    {code:30s}  [{state_label}]  "
                f"already has {debit_account['code']} line (ins={insurance_amount}) — skipping"
            )
            stats["already_ok"] += 1
            continue

        insurance_amount = Decimal(str(cl["line_401"]["credit"]))
        old_7067 = Decimal(str(cl["line_7067"]["credit"]))
        new_7067 = old_7067 + insurance_amount

        print(
            f"  FIX   {code:30s}  [{state_label}]  "
            f"7067: {old_7067} → {new_7067}  +D {debit_account['code']} {insurance_amount}"
        )
        stats["fixed"] += 1

        if not args.dry_run:
            apply_fix(cur, entry, cl, debit_account)

    print()
    print("Summary")
    print(f"  Fixed            : {stats['fixed']}")
    print(f"  Already correct  : {stats['already_ok']}")
    print(f"  No insurance     : {stats['no_insurance']}")
    print(f"  Skipped (posted) : {stats['skipped_posted']}")
    print(f"  Skipped (cancel) : {stats['skipped_cancelled']}")

    if args.dry_run:
        print()
        print("DRY RUN — no changes committed.")
        conn.rollback()
    else:
        if stats["fixed"] > 0:
            conn.commit()
            print()
            print(f"Committed {stats['fixed']} fix(es).")
        else:
            conn.rollback()
            print()
            print("Nothing to commit.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
