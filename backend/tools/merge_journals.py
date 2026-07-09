"""
ERP-CLUB - ERP pour Club de vol a voile
- Logiciel libre de gestion d'un club de vol a voile
- merge_journals: Merge a duplicate journal into its canonical counterpart.
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

The chart of journals has ended up with duplicate "purchases" and "cash"
journals (AC/HA both "Journal des achats", CA/CS both "Journal de caisse")
because legacy imports wrote directly to AC/CA while the app's own defaults
seeded HA/CS. This tool retires the duplicates: it re-points every entry
from a source journal onto a target journal, then deletes the now-empty
source journal.

For posted entries (state=2) the journal change also requires recomputing
entry_hash so it stays consistent with services/accounting.py's
compute_entry_hash(); posted entries are skipped unless --include-posted is
passed. The source journal is only deleted once it has zero remaining
entries — if any entries were skipped (posted without --include-posted, or
cancelled), the source journal is left in place and reported.

Usage:
  python merge_journals.py [--merge FROM:TO ...] [--dry-run] [--include-posted]

  --merge FROM:TO      journal code pair to merge (repeatable).
                       Default: CA:CS HA:AC (the two known duplicate pairs).
  --dry-run            show what would change without modifying the database
  --include-posted     also move posted entries (state=2), recomputing entry_hash
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

DEFAULT_MERGES = ["CA:CS", "HA:AC"]


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

def lookup_journal(cur, code: str) -> dict | None:
    cur.execute("SELECT uuid, code, name FROM accounting_journals WHERE code = %s", (code,))
    row = cur.fetchone()
    if row is None:
        return None
    return {"uuid": row[0], "code": row[1], "name": row[2]}


def load_entries_for_journal(cur, journal_uuid) -> list[dict]:
    cur.execute(
        """
        SELECT uuid, fiscal_year_uuid, state, entry_date, reference, description
        FROM accounting_entries
        WHERE journal_uuid = %s
        ORDER BY entry_date
        """,
        (journal_uuid,),
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


def count_remaining_references(cur, journal_uuid) -> dict:
    """Count rows still pointing at journal_uuid across every table with a FK to it."""
    counts = {}
    for tbl, col in [
        ("accounting_entries", "journal_uuid"),
        ("accounting_entry_templates", "journal_uuid"),
        ("flight_billing_settings", "fl_journal_uuid"),
        ("flight_billing_settings", "vt_journal_uuid"),
        ("flight_billing_settings", "rem_journal_uuid"),
        ("flight_billing_settings", "deposit_journal_uuid"),
    ]:
        cur.execute(f"SELECT COUNT(*) FROM {tbl} WHERE {col} = %s", (str(journal_uuid),))
        n = cur.fetchone()[0]
        if n:
            counts[f"{tbl}.{col}"] = n
    return counts


# ---------------------------------------------------------------------------
# Entry hash — mirrors services/accounting.py compute_entry_hash(). Keep in
# sync with that function; only journal_uuid changes here.
# ---------------------------------------------------------------------------

def _canonical_decimal(value) -> str:
    return f"{Decimal(value):.4f}"


def compute_entry_hash(entry: dict, journal_uuid: str, sequence_number, lines: list[dict]) -> str:
    header = [
        str(entry["uuid"]),
        str(entry["fiscal_year_uuid"]),
        str(journal_uuid),
        str(entry["entry_date"]),
        str(sequence_number or ""),
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
        sequence_number = cur.fetchone()[0]
        lines = load_entry_lines(cur, entry["uuid"], entry["fiscal_year_uuid"])
        new_hash = compute_entry_hash(entry, target_journal["uuid"], sequence_number, lines)
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
# One merge pass
# ---------------------------------------------------------------------------

def merge_journal(cur, from_code: str, to_code: str, dry_run: bool, include_posted: bool) -> dict:
    print(f"=== Merge {from_code} → {to_code} ===")
    stats = {"moved": 0, "skipped_posted": 0, "skipped_cancelled": 0, "deleted": False}

    from_journal = lookup_journal(cur, from_code)
    if from_journal is None:
        print(f"  Journal '{from_code}' does not exist (already merged/removed) — nothing to do.")
        print()
        return stats

    to_journal = lookup_journal(cur, to_code)
    if to_journal is None:
        raise SystemExit(f"ERROR: Target journal '{to_code}' not found.")

    entries = load_entries_for_journal(cur, from_journal["uuid"])
    print(f"  Entries currently on {from_code}: {len(entries)}")

    for entry in entries:
        state = entry["state"]
        state_label = ENTRY_STATE_LABELS.get(state, str(state))
        label = f"{entry['entry_date']}  {entry['reference'] or '':<12}  {entry['description'][:50]}"

        if state == 3:
            print(f"  SKIP  [{state_label}]  {label}  (stays on {from_code})")
            stats["skipped_cancelled"] += 1
            continue

        if state == 2 and not include_posted:
            print(f"  SKIP  [{state_label}]  {label}  (stays on {from_code}) — use --include-posted to move it")
            stats["skipped_posted"] += 1
            continue

        print(f"  MOVE  [{state_label}]  {label}")
        stats["moved"] += 1
        if not dry_run:
            apply_journal_change(cur, entry, to_journal, recompute_hash=(state == 2))

    if dry_run:
        print(f"  [DRY RUN] Would delete journal '{from_code}' if empty afterwards.")
        print()
        return stats

    remaining = count_remaining_references(cur, from_journal["uuid"])
    if remaining:
        print(f"  Journal '{from_code}' still referenced — NOT deleted: {remaining}")
    else:
        cur.execute("DELETE FROM accounting_journals WHERE uuid = %s", (str(from_journal["uuid"]),))
        stats["deleted"] = True
        print(f"  Journal '{from_code}' deleted.")

    print()
    return stats


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Move all entries from a duplicate journal onto its canonical counterpart, "
                    "then delete the now-empty duplicate.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--merge", metavar="FROM:TO", action="append", dest="merges",
        help="Journal code pair to merge, e.g. CA:CS (repeatable). Default: CA:CS HA:AC",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without modifying the database")
    parser.add_argument("--include-posted", action="store_true", help="Also move posted entries (state=2)")
    args = parser.parse_args()

    merges = args.merges or DEFAULT_MERGES
    pairs = []
    for m in merges:
        if ":" not in m:
            raise SystemExit(f"ERROR: --merge expects FROM:TO, got '{m}'")
        from_code, to_code = m.split(":", 1)
        pairs.append((from_code.strip(), to_code.strip()))

    conn = _connect()
    cur = conn.cursor()

    print(f"Mode           : {'DRY RUN — no changes will be written' if args.dry_run else 'LIVE — changes will be committed'}")
    print(f"Posted entries : {'included' if args.include_posted else 'skipped'}")
    print(f"Merges         : {', '.join(f'{f} -> {t}' for f, t in pairs)}")
    print()

    totals = {"moved": 0, "skipped_posted": 0, "skipped_cancelled": 0, "deleted": 0}
    for from_code, to_code in pairs:
        stats = merge_journal(cur, from_code, to_code, args.dry_run, args.include_posted)
        totals["moved"] += stats["moved"]
        totals["skipped_posted"] += stats["skipped_posted"]
        totals["skipped_cancelled"] += stats["skipped_cancelled"]
        totals["deleted"] += int(stats["deleted"])

    print("Summary")
    print(f"  Entries moved    : {totals['moved']}")
    print(f"  Skipped (posted) : {totals['skipped_posted']}")
    print(f"  Skipped (cancel) : {totals['skipped_cancelled']}")
    print(f"  Journals deleted : {totals['deleted']}")

    if args.dry_run:
        print()
        print("DRY RUN — no changes committed.")
        conn.rollback()
    else:
        if totals["moved"] > 0 or totals["deleted"] > 0:
            conn.commit()
            print()
            print("Committed.")
        else:
            conn.rollback()
            print()
            print("Nothing to commit.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
