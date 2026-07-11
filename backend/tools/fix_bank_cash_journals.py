"""
ERP-CLUB - ERP pour Club de vol a voile
- Logiciel libre de gestion d'un club de vol a voile
- fix_bank_cash_journals: Move entries onto the correct bank/cash journal.
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

Reassign every accounting entry that has a line on account 512 (Banque) or
531 (Caisse), based on which side of that line is used — regardless of
which journal the entry was originally posted into (many were imported
straight into AC/HA/VT/OD/... journals with the payment line combined into
the same entry):

  512 (Banque) line is a DEBIT (money coming in)  -> BQ journal
  512 (Banque) line is a CREDIT (money going out) -> AC journal (paying a
                                                      supplier by bank transfer)
  531 (Caisse) line is a DEBIT (money coming in)   -> CS journal
  531 (Caisse) line is a CREDIT (money going out)  -> AC journal (paying a
                                                      supplier in cash)

Net debit/credit is used per entry, so multiple lines on the same account
within one entry are summed before choosing a side.

Entries with lines on BOTH 512 and 531 (e.g. internal transfers between
bank and cash) are ambiguous and are always reported but never touched —
they need a manual decision (split the entry, or pick a side). Entries
where the 512 or 531 net is exactly zero (offsetting lines within the same
entry) are likewise reported as ambiguous and left untouched.

For posted entries (state=2), the journal change also requires recomputing
entry_hash so it stays consistent with services/accounting.py's
compute_entry_hash(); posted entries are skipped unless --include-posted is
passed, since changing a posted entry's journal is a bigger deal than a
draft one.

Usage:
  python fix_bank_cash_journals.py [--fiscal-year CODE] [--dry-run] [--include-posted]
                                   [--account-512 CODE] [--account-531 CODE]
                                   [--journal-bq CODE] [--journal-cs CODE] [--journal-ac CODE]

  --fiscal-year CODE   restrict to entries in this fiscal year (e.g. "2026")
  --dry-run            show what would change without modifying the database
  --include-posted     also fix posted entries (state=2), recomputing entry_hash
  --account-512 CODE   account code for "Banque" (default: "512")
  --account-531 CODE   account code for "Caisse" (default: "531")
  --journal-bq CODE    target journal code for 512 debit lines (default: "BQ")
  --journal-cs CODE    target journal code for 531 debit lines (default: "CS")
  --journal-ac CODE    target journal code for 512/531 credit lines (default: "AC")
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


def lookup_journal(cur, code: str) -> dict:
    cur.execute("SELECT uuid, code, name FROM accounting_journals WHERE code = %s", (code,))
    row = cur.fetchone()
    if row is None:
        raise SystemExit(f"ERROR: Journal '{code}' not found.")
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
# Candidate entries: any entry with a line on the 512 or 531 account
# ---------------------------------------------------------------------------

def load_candidate_entries(
    cur, account_512_code: str, account_531_code: str, fiscal_year_uuid: str | None
) -> list[dict]:
    where_clause = ""
    params: list = [account_512_code, account_531_code, account_512_code, account_512_code, account_531_code, account_531_code]
    if fiscal_year_uuid:
        where_clause = "AND ae.fiscal_year_uuid = %s"
        params.append(fiscal_year_uuid)

    cur.execute(
        f"""
        SELECT ae.uuid, ae.fiscal_year_uuid, aj.code AS journal_code, ae.state,
               ae.entry_date, ae.reference, ae.description,
               bool_or(aa.code = %s) AS has_512,
               bool_or(aa.code = %s) AS has_531,
               COALESCE(SUM(al.debit)  FILTER (WHERE aa.code = %s), 0) AS debit_512,
               COALESCE(SUM(al.credit) FILTER (WHERE aa.code = %s), 0) AS credit_512,
               COALESCE(SUM(al.debit)  FILTER (WHERE aa.code = %s), 0) AS debit_531,
               COALESCE(SUM(al.credit) FILTER (WHERE aa.code = %s), 0) AS credit_531
        FROM accounting_entries ae
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
        JOIN accounting_lines al ON al.entry_uuid = ae.uuid AND al.fiscal_year_uuid = ae.fiscal_year_uuid
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        WHERE 1=1 {where_clause}
        GROUP BY ae.uuid, ae.fiscal_year_uuid, aj.code, ae.state,
                 ae.entry_date, ae.reference, ae.description
        HAVING bool_or(aa.code = %s) OR bool_or(aa.code = %s)
        ORDER BY ae.entry_date
        """,
        params + [account_512_code, account_531_code],
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
# Classification: which journal an entry belongs on
# ---------------------------------------------------------------------------

def classify_target_journal(entry: dict, journal_bq: dict, journal_cs: dict, journal_ac: dict) -> dict | None:
    """
    Return the target journal for this entry, or None if ambiguous:
      - touches both 512 and 531 (e.g. an internal bank<->cash transfer), or
      - the account's net (debit - credit) is exactly zero (offsetting lines
        within the same entry) — no clear side to classify on.
    """
    if entry["has_512"] and entry["has_531"]:
        return None

    if entry["has_512"]:
        net = Decimal(str(entry["debit_512"])) - Decimal(str(entry["credit_512"]))
        if net > 0:
            return journal_bq
        if net < 0:
            return journal_ac
        return None

    net = Decimal(str(entry["debit_531"])) - Decimal(str(entry["credit_531"]))
    if net > 0:
        return journal_cs
    if net < 0:
        return journal_ac
    return None


# ---------------------------------------------------------------------------
# Entry hash — mirrors services/accounting.py compute_entry_hash(). Keep in
# sync with that function; only journal_uuid changes here.
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


def apply_journal_change(cur, entry: dict, target_journal: dict, recompute_hash: bool) -> None:
    if recompute_hash:
        cur.execute(
            "SELECT sequence_number FROM accounting_entries WHERE uuid = %s AND fiscal_year_uuid = %s",
            (str(entry["uuid"]), str(entry["fiscal_year_uuid"])),
        )
        entry["sequence_number"] = cur.fetchone()[0]
        lines = load_entry_lines(cur, entry["uuid"], entry["fiscal_year_uuid"])
        new_hash = compute_entry_hash(entry, target_journal["uuid"], lines)
        cur.execute(
            "UPDATE accounting_entries SET journal_uuid = %s, entry_hash = %s "
            "WHERE uuid = %s AND fiscal_year_uuid = %s",
            (str(target_journal["uuid"]), new_hash, str(entry["uuid"]), str(entry["fiscal_year_uuid"])),
        )
    else:
        cur.execute(
            "UPDATE accounting_entries SET journal_uuid = %s WHERE uuid = %s AND fiscal_year_uuid = %s",
            (str(target_journal["uuid"]), str(entry["uuid"]), str(entry["fiscal_year_uuid"])),
        )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Move entries with a 512 (Banque) or 531 (Caisse) line onto the "
                    "journal implied by which side (debit/credit) that line is on.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--fiscal-year", metavar="CODE", help="Restrict to this fiscal year (e.g. 2026)")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without modifying the database")
    parser.add_argument("--include-posted", action="store_true", help="Also fix posted entries (state=2)")
    parser.add_argument("--account-512", metavar="CODE", default="512", help="Bank account code (default: 512)")
    parser.add_argument("--account-531", metavar="CODE", default="531", help="Cash account code (default: 531)")
    parser.add_argument("--journal-bq", metavar="CODE", default="BQ", help="Target journal for 512 debit lines (default: BQ)")
    parser.add_argument("--journal-cs", metavar="CODE", default="CS", help="Target journal for 531 debit lines (default: CS)")
    parser.add_argument("--journal-ac", metavar="CODE", default="AC", help="Target journal for 512/531 credit lines (default: AC)")
    args = parser.parse_args()

    conn = _connect()
    cur = conn.cursor()

    account_512 = lookup_account(cur, args.account_512)
    account_531 = lookup_account(cur, args.account_531)
    journal_bq = lookup_journal(cur, args.journal_bq)
    journal_cs = lookup_journal(cur, args.journal_cs)
    journal_ac = lookup_journal(cur, args.journal_ac)

    print(f"Bank account   : {account_512['code']} — {account_512['name']}  → debit {journal_bq['code']} / credit {journal_ac['code']}")
    print(f"Cash account   : {account_531['code']} — {account_531['name']}  → debit {journal_cs['code']} / credit {journal_ac['code']}")

    fy_uuid = None
    if args.fiscal_year:
        fy = lookup_fiscal_year(cur, args.fiscal_year)
        fy_uuid = fy["uuid"]
        print(f"Fiscal year    : {fy['code']} ({fy['label']})")

    print(f"Mode           : {'DRY RUN — no changes will be written' if args.dry_run else 'LIVE — changes will be committed'}")
    print(f"Posted entries : {'included' if args.include_posted else 'skipped'}")
    print()

    entries = load_candidate_entries(cur, account_512["code"], account_531["code"], fy_uuid)
    print(f"Candidate entries found (line on {account_512['code']} or {account_531['code']}): {len(entries)}")
    print()

    stats = {
        "fixed_bq": 0, "fixed_cs": 0, "fixed_ac": 0, "already_ok": 0,
        "ambiguous": 0, "skipped_posted": 0, "skipped_cancelled": 0,
    }
    ambiguous_entries = []

    for entry in entries:
        state = entry["state"]
        state_label = ENTRY_STATE_LABELS.get(state, str(state))
        label = f"{entry['entry_date']}  {entry['reference'] or '':<12}  {entry['description'][:50]}"

        target_journal = classify_target_journal(entry, journal_bq, journal_cs, journal_ac)
        if target_journal is None:
            stats["ambiguous"] += 1
            ambiguous_entries.append(entry)
            continue

        if entry["journal_code"] == target_journal["code"]:
            stats["already_ok"] += 1
            continue

        if state == 3:
            print(f"  SKIP  [{state_label}]  {label}  ({entry['journal_code']} → {target_journal['code']})")
            stats["skipped_cancelled"] += 1
            continue

        if state == 2 and not args.include_posted:
            print(f"  SKIP  [{state_label}]  {label}  ({entry['journal_code']} → {target_journal['code']})  "
                  f"use --include-posted to fix posted entries")
            stats["skipped_posted"] += 1
            continue

        print(f"  FIX   [{state_label}]  {label}  {entry['journal_code']} → {target_journal['code']}")
        if target_journal["code"] == journal_bq["code"]:
            stats["fixed_bq"] += 1
        elif target_journal["code"] == journal_cs["code"]:
            stats["fixed_cs"] += 1
        else:
            stats["fixed_ac"] += 1

        if not args.dry_run:
            apply_journal_change(cur, entry, target_journal, recompute_hash=(state == 2))

    if ambiguous_entries:
        print()
        print(f"--- Ambiguous entries (both {account_512['code']}/{account_531['code']}, or a zero net) — not touched ---")
        for entry in ambiguous_entries:
            state_label = ENTRY_STATE_LABELS.get(entry["state"], str(entry["state"]))
            print(f"  {entry['entry_date']}  [{state_label}]  journal={entry['journal_code']:<4}  "
                  f"{entry['reference'] or '':<12}  {entry['description'][:60]}")

    print()
    print("Summary")
    print(f"  Moved to {journal_bq['code']:<4}   : {stats['fixed_bq']}")
    print(f"  Moved to {journal_cs['code']:<4}   : {stats['fixed_cs']}")
    print(f"  Moved to {journal_ac['code']:<4}   : {stats['fixed_ac']}")
    print(f"  Already correct  : {stats['already_ok']}")
    print(f"  Ambiguous (skip) : {stats['ambiguous']}")
    print(f"  Skipped (posted) : {stats['skipped_posted']}")
    print(f"  Skipped (cancel) : {stats['skipped_cancelled']}")

    total_fixed = stats["fixed_bq"] + stats["fixed_cs"] + stats["fixed_ac"]
    if args.dry_run:
        print()
        print("DRY RUN — no changes committed.")
        conn.rollback()
    else:
        if total_fixed > 0:
            conn.commit()
            print()
            print(f"Committed {total_fixed} journal change(s).")
        else:
            conn.rollback()
            print()
            print("Nothing to commit.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
