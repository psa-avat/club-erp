"""
ERP-CLUB - ERP pour Club de vol a voile
- Logiciel libre de gestion d'un club de vol a voile
- check_pilot_bank_reconciliation: pilot (411) entries with an unreconciled
  bank-side line.
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

Members don't get a distinct sub-account per pilot in this chart of accounts
(unlike Vulcain's 411200000+num_pilote) — there is a single generic "411"
account, and each pilot's position on it is discriminated by
accounting_lines.tiers_uuid (see check_411t.py). A pilot-facing cash movement
(a deposit, a refund, a direct bank settlement of their balance) is booked as
one accounting entry with a line on 411 for that pilot AND a line on a
treasury account (512 Banque, 5112 Chèques à encaisser, ...) in the SAME
entry. Only accounts that actually receive bank statement imports
(bank_statements.account_uuid) are treated as "treasury" here — a cash
account (531 Caisse) has no bank feed and can never be reconciled this way,
so including it would just be permanent, unfixable noise.

This tool finds every such entry whose treasury-side line has NOT been
reconciled against a bank statement — i.e. no bank_statement_lines row
references it with match_status IN ('auto_matched', 'manually_matched',
'excluded') — and reports it grouped by pilot. This is exactly the pattern
behind the FY-boundary case investigated earlier this project (a member
travel-expense reimbursement booked in a closed fiscal year, whose 512 line
never got linked to the January bank statement that actually cleared it) —
this tool surfaces that class of issue directly instead of relying on
someone spotting it in the reconciliation workspace one statement at a time.

READ-ONLY: this tool never writes to the database.

Output (in output/):
  check_pilot_bank_reconciliation.csv   one row per unreconciled entry
  Console: summary grouped by pilot, sorted by oldest entry first.

Usage:
  python check_pilot_bank_reconciliation.py [--fiscal-year CODE] [--all-years]
                                             [--pilot ACCOUNT_ID]
                                             [--min-days N] [--threshold AMOUNT]
                                             [--dry-run] [--output PATH]

  --fiscal-year CODE   restrict to this fiscal year's entries (default: the
                       currently Open fiscal year)
  --all-years          scan every fiscal year (overrides --fiscal-year)
  --pilot ACCOUNT_ID   restrict to one pilot (member.account_id, e.g. ME2026-0042)
  --min-days N         only report entries at least N days old (default: 0 — all)
  --threshold AMOUNT   only report entries with |amount| >= AMOUNT (default: 0 — all)
  --dry-run            print the summary only, no CSV written
  --output PATH        CSV path (default: output/check_pilot_bank_reconciliation.csv)
"""

import argparse
import csv
import os
from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TOOLS_DIR = Path(__file__).parent.resolve()
OUTPUT_DIR = TOOLS_DIR / "output"

STATE_LABELS = {1: "Draft", 2: "Posted", 3: "Cancelled"}


# ---------------------------------------------------------------------------
# DB connection (same pattern as other tools)
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

def lookup_fiscal_year(cur, code: str) -> dict:
    cur.execute(
        "SELECT uuid, code, label FROM accounting_fiscal_years WHERE code = %s",
        (code,),
    )
    row = cur.fetchone()
    if row is None:
        raise SystemExit(f"ERROR: fiscal year '{code}' not found.")
    return {"uuid": row[0], "code": row[1], "label": row[2]}


def lookup_active_fiscal_year(cur) -> dict:
    cur.execute("SELECT uuid, code, label FROM accounting_fiscal_years WHERE state = 1 ORDER BY start_date DESC LIMIT 1")
    row = cur.fetchone()
    if row is None:
        raise SystemExit("ERROR: no Open fiscal year found — pass --fiscal-year or --all-years explicitly.")
    return {"uuid": row[0], "code": row[1], "label": row[2]}


def build_member_map(cur) -> dict:
    cur.execute("SELECT uuid::text, account_id, first_name, last_name FROM members")
    members = {}
    for uuid, account_id, first_name, last_name in cur.fetchall():
        members[uuid] = {"account_id": account_id or "", "name": f"{first_name} {last_name}".strip()}
    return members


def lookup_pilot(cur, account_id: str) -> str:
    cur.execute("SELECT uuid::text FROM members WHERE account_id = %s", (account_id,))
    row = cur.fetchone()
    if row is None:
        raise SystemExit(f"ERROR: pilot '{account_id}' not found (members.account_id).")
    return row[0]


# ---------------------------------------------------------------------------
# Candidate entries: a line on 411 for a pilot + a line on a treasury account
# (PCG class 5) in the same entry, whose treasury-side line is unreconciled.
# ---------------------------------------------------------------------------

def load_unreconciled_pilot_entries(
    cur, *, fiscal_year_uuid: str | None, pilot_uuid: str | None,
) -> list[dict]:
    where_clauses = ["ae.state IN (1, 2)", "ml.tiers_uuid IS NOT NULL"]
    params: list = []
    if fiscal_year_uuid:
        where_clauses.append("ae.fiscal_year_uuid = %s")
        params.append(fiscal_year_uuid)
    if pilot_uuid:
        where_clauses.append("ml.tiers_uuid = %s")
        params.append(pilot_uuid)

    cur.execute(
        f"""
        WITH member_lines AS (
            SELECT al.entry_uuid, al.fiscal_year_uuid, al.tiers_uuid
            FROM accounting_lines al
            JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
            WHERE aa.code LIKE '411%%' AND al.tiers_uuid IS NOT NULL
        ),
        treasury_accounts AS (
            SELECT DISTINCT account_uuid FROM bank_statements
        )
        SELECT
            ae.uuid AS entry_uuid, ae.fiscal_year_uuid, ae.entry_date, ae.description,
            ae.reference, ae.state,
            ml.tiers_uuid,
            tl.uuid AS treasury_line_uuid, aa.code AS treasury_account_code, aa.name AS treasury_account_name,
            (tl.debit - tl.credit) AS amount
        FROM member_lines ml
        JOIN accounting_entries ae ON ae.uuid = ml.entry_uuid AND ae.fiscal_year_uuid = ml.fiscal_year_uuid
        JOIN accounting_lines tl ON tl.entry_uuid = ml.entry_uuid AND tl.fiscal_year_uuid = ml.fiscal_year_uuid
        JOIN treasury_accounts ta ON ta.account_uuid = tl.account_uuid
        JOIN accounting_accounts aa ON aa.uuid = tl.account_uuid
        WHERE {" AND ".join(where_clauses)}
          AND NOT EXISTS (
              SELECT 1 FROM bank_statement_lines bsl
              WHERE bsl.matched_line_uuid = tl.uuid
                AND bsl.match_status IN ('auto_matched', 'manually_matched', 'excluded')
          )
        ORDER BY ae.entry_date
        """,
        params,
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def build_rows(entries: list[dict], members: dict, *, min_days: int, threshold: Decimal, today: date) -> list[dict]:
    rows = []
    for entry in entries:
        amount = Decimal(str(entry["amount"]))
        if abs(amount) < threshold:
            continue
        days_outstanding = (today - entry["entry_date"]).days
        if days_outstanding < min_days:
            continue

        member = members.get(str(entry["tiers_uuid"]), {"account_id": "?", "name": "?"})
        rows.append(
            {
                "pilot_account_id": member["account_id"],
                "pilot_name": member["name"],
                "entry_date": entry["entry_date"],
                "days_outstanding": days_outstanding,
                "state": STATE_LABELS.get(entry["state"], str(entry["state"])),
                "treasury_account_code": entry["treasury_account_code"],
                "treasury_account_name": entry["treasury_account_name"],
                "amount": amount,
                "description": entry["description"],
                "reference": entry["reference"] or "",
                "entry_uuid": entry["entry_uuid"],
                "fiscal_year_uuid": entry["fiscal_year_uuid"],
                "treasury_line_uuid": entry["treasury_line_uuid"],
            }
        )
    rows.sort(key=lambda r: (r["pilot_account_id"], r["entry_date"]))
    return rows


def print_summary(rows: list[dict]) -> None:
    if not rows:
        print("No unreconciled pilot (411) bank-side entries found.")
        return

    by_pilot: dict[str, list[dict]] = {}
    for row in rows:
        by_pilot.setdefault(row["pilot_account_id"], []).append(row)

    print(f"{len(rows)} unreconciled entr{'y' if len(rows) == 1 else 'ies'} across {len(by_pilot)} pilot(s):\n")
    for pilot_id, pilot_rows in sorted(by_pilot.items(), key=lambda kv: -max(r["days_outstanding"] for r in kv[1])):
        name = pilot_rows[0]["pilot_name"]
        total = sum((r["amount"] for r in pilot_rows), Decimal("0"))
        print(f"  {pilot_id:<14} {name:<30}  {len(pilot_rows)} entr{'y' if len(pilot_rows) == 1 else 'ies'}  total={total:>10.2f}")
        for row in pilot_rows:
            print(
                f"      {row['entry_date']}  [{row['state']:<7}]  {row['days_outstanding']:>4}d  "
                f"{row['treasury_account_code']:<6}  {row['amount']:>10.2f}  {(row['description'] or '')[:55]}"
            )
    print()
    print(f"Total outstanding amount: {sum((r['amount'] for r in rows), Decimal('0')):.2f}")


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "pilot_account_id", "pilot_name", "entry_date", "days_outstanding", "state",
        "treasury_account_code", "treasury_account_name", "amount", "description",
        "reference", "entry_uuid", "fiscal_year_uuid", "treasury_line_uuid",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Find pilot (411) entries whose bank-side line is not yet reconciled.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--fiscal-year", metavar="CODE", help="Restrict to this fiscal year (default: the Open one)")
    parser.add_argument("--all-years", action="store_true", help="Scan every fiscal year (overrides --fiscal-year)")
    parser.add_argument("--pilot", metavar="ACCOUNT_ID", help="Restrict to one pilot (members.account_id)")
    parser.add_argument("--min-days", type=int, default=0, metavar="N", help="Only entries at least N days old (default: 0)")
    parser.add_argument("--threshold", type=str, default="0", metavar="AMOUNT", help="Only entries with |amount| >= AMOUNT (default: 0)")
    parser.add_argument("--dry-run", action="store_true", help="Print the summary only, no CSV written")
    parser.add_argument("--output", metavar="PATH", help="CSV path (default: output/check_pilot_bank_reconciliation.csv)")
    args = parser.parse_args()

    conn = _connect()
    cur = conn.cursor()

    fiscal_year_uuid = None
    if args.all_years:
        print("Fiscal year    : all")
    elif args.fiscal_year:
        fy = lookup_fiscal_year(cur, args.fiscal_year)
        fiscal_year_uuid = fy["uuid"]
        print(f"Fiscal year    : {fy['code']} ({fy['label']})")
    else:
        fy = lookup_active_fiscal_year(cur)
        fiscal_year_uuid = fy["uuid"]
        print(f"Fiscal year    : {fy['code']} ({fy['label']}) [default: Open]")

    pilot_uuid = None
    if args.pilot:
        pilot_uuid = lookup_pilot(cur, args.pilot)
        print(f"Pilot          : {args.pilot}")

    print()

    members = build_member_map(cur)
    entries = load_unreconciled_pilot_entries(cur, fiscal_year_uuid=fiscal_year_uuid, pilot_uuid=pilot_uuid)
    rows = build_rows(entries, members, min_days=args.min_days, threshold=Decimal(args.threshold), today=date.today())

    print_summary(rows)

    if not args.dry_run and rows:
        out_path = Path(args.output) if args.output else OUTPUT_DIR / "check_pilot_bank_reconciliation.csv"
        write_csv(rows, out_path)
        print(f"\nWritten → {out_path}")
    elif args.dry_run:
        print("\nDRY RUN — no CSV written.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
