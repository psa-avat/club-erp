"""
ERP-CLUB - ERP pour Club de vol a voile
- Logiciel libre de gestion d'un club de vol a voile
- fix_vi_insurance_revenue_split: split the 7067 VI/JD revenue credit into a
  flight-portion (7067) and an insurance-portion (7069) credit line.
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

Fix VI realization entries that credit the full amount_ttc (flight + insurance)
to the revenue account (e.g. 7067), instead of splitting the insurance portion
out to a dedicated insurance-revenue account (e.g. 7069).

Current (pre-split) realization entry structure:
  D 419100  amount_ttc
  D 6169    insurance_amount                  ← [if insurance was expensed]
  C 7067    amount_ttc                        ← flight + insurance combined
  C 401     insurance_amount                  ← insurance payable

Target structure after this fix:
  D 419100  amount_ttc                        ← unchanged
  D 6169    insurance_amount                  ← unchanged
  C 7067    amount_ttc - insurance_amount     ← reduced by insurance_amount
  C 7069    insurance_amount                  ← new balancing line (insurance revenue)
  C 401     insurance_amount                  ← unchanged

The fix:
  1. Decreases the 7067 CREDIT by the insurance_amount (from the 401 line).
  2. Inserts a new CREDIT line on --insurance-revenue-account (default: first
     account with code starting with "7069") for the same amount as the 401 line.

Only realization entries that:
  - have a 401 line (insurance was booked), AND
  - have a 7067 (or --revenue-account) credit line, AND
  - do NOT already have an insurance-revenue credit line (not yet fixed)
are modified. All others are reported but skipped.

Usage:
  python fix_vi_insurance_revenue_split.py [--fiscal-year CODE]
                           [--revenue-account CODE] [--insurance-revenue-account CODE]
                           [--dry-run] [--include-posted]

  --fiscal-year CODE               restrict to entries in this fiscal year (e.g. "2026")
  --revenue-account CODE           account code for the existing revenue line (default: "7067")
  --insurance-revenue-account CODE account code for the new insurance-revenue line (default: "7069")
  --dry-run                        show what would change without modifying the database
  --include-posted                 also fix posted entries (state=2); default skips them
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

def lookup_account(cur, code_prefix: str) -> dict:
    """Return the first accounting account whose code starts with code_prefix."""
    cur.execute(
        "SELECT uuid, code, name FROM accounting_accounts WHERE code LIKE %s ORDER BY code LIMIT 1",
        (code_prefix + "%",),
    )
    row = cur.fetchone()
    if row is None:
        raise SystemExit(
            f"ERROR: No account found with code starting with '{code_prefix}'.\n"
            "Create the account in the chart of accounts (or import the PCG seed) first."
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


def classify_entry(lines: list[dict], revenue_account_code: str, insurance_revenue_account_code: str) -> dict:
    """
    Classify the lines of a realization entry.

    Returns a dict with:
      line_revenue          — the revenue CREDIT line (e.g. 7067) (or None)
      line_401               — the 401xxx CREDIT line with the insurance amount (or None)
      line_insurance_revenue — an existing insurance-revenue CREDIT line (already fixed, or None)
    """
    result = {"line_revenue": None, "line_401": None, "line_insurance_revenue": None}
    for line in lines:
        code = line["account_code"]
        if code.startswith(insurance_revenue_account_code) and Decimal(str(line["credit"])) > 0:
            result["line_insurance_revenue"] = line
        elif code.startswith(revenue_account_code) and Decimal(str(line["credit"])) > 0:
            result["line_revenue"] = line
        elif code.startswith("401") and Decimal(str(line["credit"])) > 0:
            result["line_401"] = line
    return result


def apply_fix(cur, entry: dict, classification: dict, insurance_revenue_account: dict) -> None:
    """
    Apply the fix to one realization entry:
      1. Decrease the revenue line credit by the 401 line credit (insurance_amount).
      2. Insert a new credit line on insurance_revenue_account for insurance_amount.
    """
    line_revenue = classification["line_revenue"]
    line_401 = classification["line_401"]
    insurance_amount = Decimal(str(line_401["credit"]))
    new_credit = Decimal(str(line_revenue["credit"])) - insurance_amount
    line_description = f"Assurance VI {entry['entitlement_code']}"

    # 1. Decrease revenue credit
    cur.execute(
        "UPDATE accounting_lines SET credit = %s WHERE uuid = %s AND fiscal_year_uuid = %s",
        (new_credit, str(line_revenue["uuid"]), str(entry["fiscal_year_uuid"])),
    )

    # 2. Insert new credit line on insurance_revenue_account (no tiers, like the revenue line)
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
            str(insurance_revenue_account["uuid"]),
            None,
            Decimal("0"),
            insurance_amount,
            line_description,
        ),
    )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fix VI realization entries: split the revenue credit into flight (7067) and insurance (7069) portions.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--fiscal-year", metavar="CODE", help="Restrict to this fiscal year (e.g. 2026)")
    parser.add_argument("--revenue-account", metavar="CODE", default="7067",
                        help="Account code for the existing revenue line (default: 7067)")
    parser.add_argument("--insurance-revenue-account", metavar="CODE", default="7069",
                        help="Account code for the new insurance-revenue line (default: 7069)")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without modifying the database")
    parser.add_argument("--include-posted", action="store_true", help="Also fix posted entries (state=2)")
    args = parser.parse_args()

    conn = _connect()
    cur = conn.cursor()

    # Resolve insurance-revenue account
    insurance_revenue_account = lookup_account(cur, args.insurance_revenue_account)
    print(f"Insurance revenue account : {insurance_revenue_account['code']} — {insurance_revenue_account['name']}")

    # Resolve fiscal year filter
    fy_uuid = None
    if args.fiscal_year:
        fy = lookup_fiscal_year(cur, args.fiscal_year)
        fy_uuid = fy["uuid"]
        print(f"Fiscal year               : {fy['code']} ({fy['label']})")

    print(f"Mode                      : {'DRY RUN — no changes will be written' if args.dry_run else 'LIVE — changes will be committed'}")
    print(f"Posted entries            : {'included' if args.include_posted else 'skipped'}")
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
        cl = classify_entry(lines, args.revenue_account, args.insurance_revenue_account)

        if cl["line_revenue"] is None:
            print(f"  WARN  {code:30s}  [{state_label}]  no {args.revenue_account} line found — skipping")
            continue

        if cl["line_401"] is None:
            print(f"  INFO  {code:30s}  [{state_label}]  no 401 insurance line — skipping (no insurance)")
            stats["no_insurance"] += 1
            continue

        if cl["line_insurance_revenue"] is not None:
            insurance_amount = Decimal(str(cl["line_401"]["credit"]))
            print(
                f"  OK    {code:30s}  [{state_label}]  "
                f"already has {insurance_revenue_account['code']} line (ins={insurance_amount}) — skipping"
            )
            stats["already_ok"] += 1
            continue

        insurance_amount = Decimal(str(cl["line_401"]["credit"]))
        old_revenue = Decimal(str(cl["line_revenue"]["credit"]))
        new_revenue = old_revenue - insurance_amount

        if new_revenue < Decimal("0"):
            print(
                f"  WARN  {code:30s}  [{state_label}]  "
                f"insurance ({insurance_amount}) exceeds {args.revenue_account} credit ({old_revenue}) — skipping"
            )
            continue

        print(
            f"  FIX   {code:30s}  [{state_label}]  "
            f"{args.revenue_account}: {old_revenue} → {new_revenue}  "
            f"+C {insurance_revenue_account['code']} {insurance_amount}"
        )
        stats["fixed"] += 1

        if not args.dry_run:
            apply_fix(cur, entry, cl, insurance_revenue_account)

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
