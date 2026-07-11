"""
ERP-CLUB - ERP pour Club de vol a voile
- Logiciel libre de gestion d'un club de vol a voile
- fix_registration_fees_account: Split account 756 lines onto 7561/7065 by amount.
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

Reclassify every accounting_lines row on account 756 (Cotisations) onto a
more specific account, based on the line's own amount (debit or credit,
whichever is non-zero on that line):

  amount <= threshold (default 100.00) -> 7561 (Cotisations et adhesions)
  amount >  threshold                  -> 7065 (Frais de fonctionnement)

The classification is per LINE, not per entry: a single entry can carry two
separate 756 lines (e.g. a 350 "participation" line and a 100 "cotisation"
line for the same member), and each must be reclassified independently by
its own amount. Only the line's account_uuid changes; debit/credit values
are untouched, so the entry stays balanced automatically.

For posted entries (state=2), the account change also requires recomputing
entry_hash so it stays consistent with services/accounting.py's
compute_entry_hash(); posted entries are skipped unless --include-posted is
passed.

Usage:
  python fix_registration_fees_account.py [--fiscal-year CODE] [--dry-run] [--include-posted]
                                          [--source-account CODE] [--threshold AMOUNT]
                                          [--account-le CODE] [--account-gt CODE]

  --fiscal-year CODE     restrict to entries in this fiscal year (e.g. "2026")
  --dry-run              show what would change without modifying the database
  --include-posted       also fix posted entries (state=2), recomputing entry_hash
  --source-account CODE  account code to split (default: "756")
  --threshold AMOUNT     boundary amount, inclusive on the low side (default: 100.00)
  --account-le CODE      target account for amount <= threshold (default: "7561")
  --account-gt CODE      target account for amount >  threshold (default: "7065")
"""

import argparse
import hashlib
import os
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

def lookup_account(cur, code: str) -> dict:
    cur.execute("SELECT uuid, code, name FROM accounting_accounts WHERE code = %s", (code,))
    row = cur.fetchone()
    if row is None:
        raise SystemExit(f"ERROR: Account '{code}' not found in the chart of accounts.")
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
# Candidate lines: every line on the source account
# ---------------------------------------------------------------------------

def load_candidate_lines(cur, source_account_code: str, fiscal_year_uuid: str | None) -> list[dict]:
    where_clause = ""
    params: list = [source_account_code]
    if fiscal_year_uuid:
        where_clause = "AND ae.fiscal_year_uuid = %s"
        params.append(fiscal_year_uuid)

    cur.execute(
        f"""
        SELECT al.uuid, al.entry_uuid, al.fiscal_year_uuid, al.debit, al.credit,
               al.tiers_uuid, al.description,
               ae.journal_uuid, aj.code AS journal_code, ae.state,
               ae.entry_date, ae.reference, ae.description AS entry_description
        FROM accounting_lines al
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        JOIN accounting_entries ae ON ae.uuid = al.entry_uuid AND ae.fiscal_year_uuid = al.fiscal_year_uuid
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
        WHERE aa.code = %s {where_clause}
        ORDER BY ae.entry_date
        """,
        params,
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def load_entry_lines(cur, entry_uuid, fiscal_year_uuid) -> list[dict]:
    cur.execute(
        """
        SELECT uuid, account_uuid, tiers_uuid, debit, credit, description
        FROM accounting_lines
        WHERE entry_uuid = %s AND fiscal_year_uuid = %s
        """,
        (entry_uuid, fiscal_year_uuid),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Classification: which account a line belongs on
# ---------------------------------------------------------------------------

def classify_target_account(line: dict, account_le: dict, account_gt: dict, threshold: Decimal) -> dict | None:
    """
    Return the target account for this line, or None if ambiguous (both
    debit and credit are zero — should not happen, but reported not touched).
    """
    debit = Decimal(str(line["debit"]))
    credit = Decimal(str(line["credit"]))
    amount = debit if debit != 0 else credit
    if amount == 0:
        return None
    if amount <= threshold:
        return account_le
    return account_gt


# ---------------------------------------------------------------------------
# Entry hash — mirrors services/accounting.py compute_entry_hash(). Keep in
# sync with that function; only a line's account_uuid changes here.
# ---------------------------------------------------------------------------

def _canonical_decimal(value) -> str:
    return f"{Decimal(value):.4f}"


def compute_entry_hash(entry: dict, journal_uuid: str, lines: list[dict]) -> str:
    header = [
        str(entry["uuid"]),
        str(entry["fiscal_year_uuid"]),
        str(journal_uuid),
        str(entry["entry_date"]),
        str(entry.get("sequence_number") or ""),
        str(entry.get("reference") or ""),
        str(entry["description"]),
        str(entry["state"]),
    ]

    sorted_lines = sorted(lines, key=lambda line: str(line["uuid"]))
    line_payloads = []
    for line in sorted_lines:
        line_payloads.append(
            "|".join(
                [
                    str(line["uuid"]),
                    str(line["account_uuid"]),
                    _canonical_decimal(line["debit"]),
                    _canonical_decimal(line["credit"]),
                    str(line["tiers_uuid"] or ""),
                    str(line["description"] or ""),
                ]
            )
        )

    payload = "\n".join(["|".join(header)] + line_payloads)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def apply_account_change(cur, line: dict, target_account: dict, recompute_hash: bool) -> None:
    cur.execute(
        "UPDATE accounting_lines SET account_uuid = %s WHERE uuid = %s AND fiscal_year_uuid = %s",
        (str(target_account["uuid"]), str(line["uuid"]), str(line["fiscal_year_uuid"])),
    )
    if recompute_hash:
        cur.execute(
            "SELECT uuid, fiscal_year_uuid, entry_date, sequence_number, reference, description, state "
            "FROM accounting_entries WHERE uuid = %s AND fiscal_year_uuid = %s",
            (str(line["entry_uuid"]), str(line["fiscal_year_uuid"])),
        )
        row = cur.fetchone()
        entry = {
            "uuid": row[0], "fiscal_year_uuid": row[1], "entry_date": row[2],
            "sequence_number": row[3], "reference": row[4], "description": row[5], "state": row[6],
        }
        entry_lines = load_entry_lines(cur, line["entry_uuid"], line["fiscal_year_uuid"])
        new_hash = compute_entry_hash(entry, line["journal_uuid"], entry_lines)
        cur.execute(
            "UPDATE accounting_entries SET entry_hash = %s WHERE uuid = %s AND fiscal_year_uuid = %s",
            (new_hash, str(line["entry_uuid"]), str(line["fiscal_year_uuid"])),
        )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Split account 756 (Cotisations) lines onto 7561/7065 based on the "
                    "line's own amount vs a threshold.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--fiscal-year", metavar="CODE", help="Restrict to this fiscal year (e.g. 2026)")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without modifying the database")
    parser.add_argument("--include-posted", action="store_true", help="Also fix posted entries (state=2)")
    parser.add_argument("--source-account", metavar="CODE", default="756", help="Account code to split (default: 756)")
    parser.add_argument("--threshold", metavar="AMOUNT", type=Decimal, default=Decimal("100.00"),
                         help="Boundary amount, inclusive on the low side (default: 100.00)")
    parser.add_argument("--account-le", metavar="CODE", default="7561",
                         help="Target account for amount <= threshold (default: 7561)")
    parser.add_argument("--account-gt", metavar="CODE", default="7065",
                         help="Target account for amount >  threshold (default: 7065)")
    args = parser.parse_args()

    conn = _connect()
    cur = conn.cursor()

    source_account = lookup_account(cur, args.source_account)
    account_le = lookup_account(cur, args.account_le)
    account_gt = lookup_account(cur, args.account_gt)

    print(f"Source account : {source_account['code']} — {source_account['name']}")
    print(f"  amount <= {args.threshold} -> {account_le['code']} — {account_le['name']}")
    print(f"  amount >  {args.threshold} -> {account_gt['code']} — {account_gt['name']}")

    fy_uuid = None
    if args.fiscal_year:
        fy = lookup_fiscal_year(cur, args.fiscal_year)
        fy_uuid = fy["uuid"]
        print(f"Fiscal year    : {fy['code']} ({fy['label']})")

    print(f"Mode           : {'DRY RUN — no changes will be written' if args.dry_run else 'LIVE — changes will be committed'}")
    print(f"Posted entries : {'included' if args.include_posted else 'skipped'}")
    print()

    lines = load_candidate_lines(cur, source_account["code"], fy_uuid)
    print(f"Candidate lines found (on account {source_account['code']}): {len(lines)}")
    print()

    stats = {
        "fixed_le": 0, "fixed_gt": 0,
        "ambiguous": 0, "skipped_posted": 0, "skipped_cancelled": 0,
    }
    ambiguous_lines = []

    for line in lines:
        state = line["state"]
        state_label = ENTRY_STATE_LABELS.get(state, str(state))
        label = f"{line['entry_date']}  {line['reference'] or '':<12}  {(line['description'] or line['entry_description'] or '')[:50]}"

        target_account = classify_target_account(line, account_le, account_gt, args.threshold)
        if target_account is None:
            stats["ambiguous"] += 1
            ambiguous_lines.append(line)
            continue

        if state == 3:
            print(f"  SKIP  [{state_label}]  {label}  ({source_account['code']} → {target_account['code']})")
            stats["skipped_cancelled"] += 1
            continue

        if state == 2 and not args.include_posted:
            print(f"  SKIP  [{state_label}]  {label}  ({source_account['code']} → {target_account['code']})  "
                  f"use --include-posted to fix posted entries")
            stats["skipped_posted"] += 1
            continue

        amount = line["debit"] if Decimal(str(line["debit"])) != 0 else line["credit"]
        print(f"  FIX   [{state_label}]  {label}  amount={amount}  {source_account['code']} → {target_account['code']}")
        if target_account["code"] == account_le["code"]:
            stats["fixed_le"] += 1
        else:
            stats["fixed_gt"] += 1

        if not args.dry_run:
            apply_account_change(cur, line, target_account, recompute_hash=(state == 2))

    if ambiguous_lines:
        print()
        print(f"--- Ambiguous lines (zero debit and credit) — not touched ---")
        for line in ambiguous_lines:
            state_label = ENTRY_STATE_LABELS.get(line["state"], str(line["state"]))
            print(f"  {line['entry_date']}  [{state_label}]  journal={line['journal_code']:<4}  "
                  f"{line['reference'] or '':<12}  {(line['description'] or line['entry_description'] or '')[:60]}")

    print()
    print("Summary")
    print(f"  Moved to {account_le['code']:<6} : {stats['fixed_le']}")
    print(f"  Moved to {account_gt['code']:<6} : {stats['fixed_gt']}")
    print(f"  Ambiguous (skip)  : {stats['ambiguous']}")
    print(f"  Skipped (posted)  : {stats['skipped_posted']}")
    print(f"  Skipped (cancel)  : {stats['skipped_cancelled']}")

    total_fixed = stats["fixed_le"] + stats["fixed_gt"]
    if args.dry_run:
        print()
        print("DRY RUN — no changes committed.")
        conn.rollback()
    else:
        if total_fixed > 0:
            conn.commit()
            print()
            print(f"Committed {total_fixed} account change(s).")
        else:
            conn.rollback()
            print()
            print("Nothing to commit.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
