"""
ERP-CLUB - Duplicate Accounting Entries Checker / Remover
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

────────────────────────────────────────────────────────────────────────────
Detect accounting entries that are likely duplicates of each other,
even across different journals.

Two entries are considered duplicates when they share:
  • entry_date
  • the same "line signature": sorted set of
    (account_code, tiers_uuid, round(debit,2), round(credit,2)) per line

Detection is journal-agnostic: a BQ entry and a VT entry on the same date
with the same amounts and the same member/accounts will be flagged.

────────────────────────────────────────────────────────────────────────────
Usage
  python check_duplicates.py [options]

Detection options
  --year YEAR             fiscal year to scan (default: 2026)
  --journal CODE          restrict detection to this journal code
  --tiers UUID            restrict to entries whose lines reference this tiers_uuid
  --dry-run               no CSV written and no deletions performed

Output
  --output PATH           CSV path (default: output/check_duplicates.csv)

Deletion mode (explicit UUIDs)
  --delete UUID,...       comma-separated entry UUIDs to delete

Deletion mode (by journal)
  --delete-journal CODE   in every duplicate group, delete the entries from this
                          journal code and keep the others.
                          Safety: refuses to wipe out the only remaining copy
                          (at least one non-CODE entry must exist in the group).

Common deletion flags
  --allow-posted          allow deleting Posted (state=2) entries
                          (default: only Draft entries may be deleted)
  --force                 skip interactive confirmation prompt
────────────────────────────────────────────────────────────────────────────
"""

import csv
import hashlib
import os
import sys
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
# Data loading
# ---------------------------------------------------------------------------

def load_fiscal_year_uuid(conn, year: int) -> str:
    cur = conn.cursor()
    cur.execute(
        "SELECT uuid::text FROM accounting_fiscal_years WHERE year = %s LIMIT 1",
        (year,),
    )
    row = cur.fetchone()
    cur.close()
    if not row:
        raise RuntimeError(f"No fiscal year for {year} found in the database.")
    return row[0]


def load_entries_with_lines(conn, fy_uuid: str, journal_code: str | None, tiers_uuid: str | None) -> list[dict]:
    """
    Load all entries for the fiscal year together with their lines and journal code.
    Returns a list of entry dicts, each with a 'lines' list.
    """
    cur = conn.cursor()

    journal_filter = ""
    journal_param: list = []
    if journal_code:
        journal_filter = "AND aj.code = %s"
        journal_param = [journal_code]

    cur.execute(
        f"""
        SELECT
            ae.uuid::text,
            ae.fiscal_year_uuid::text,
            ae.entry_date::text,
            ae.state,
            ae.sequence_number,
            ae.description,
            ae.reference,
            ae.source_system,
            ae.external_id,
            ae.import_batch_id,
            ae.created_at::text,
            aj.code  AS journal_code,
            aj.name  AS journal_name
        FROM accounting_entries ae
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
        WHERE ae.fiscal_year_uuid = %s
          {journal_filter}
        ORDER BY ae.entry_date, ae.created_at
        """,
        [fy_uuid] + journal_param,
    )
    entries = {}
    for row in cur.fetchall():
        uuid = row[0]
        entries[uuid] = {
            "uuid": uuid,
            "fiscal_year_uuid": row[1],
            "entry_date": row[2],
            "state": row[3],
            "sequence_number": row[4] or "",
            "description": row[5] or "",
            "reference": row[6] or "",
            "source_system": row[7] or "",
            "external_id": row[8] or "",
            "import_batch_id": row[9] or "",
            "created_at": row[10] or "",
            "journal_code": row[11],
            "journal_name": row[12],
            "lines": [],
        }

    if not entries:
        cur.close()
        return []

    # Load lines with account codes
    tiers_filter = ""
    tiers_param: list = []
    if tiers_uuid:
        # restrict to entries that have at least one line with this tiers_uuid
        tiers_filter = "AND al.entry_uuid IN (SELECT entry_uuid FROM accounting_lines WHERE tiers_uuid = %s::uuid AND fiscal_year_uuid = %s)"
        tiers_param = [tiers_uuid, fy_uuid]

    cur.execute(
        f"""
        SELECT
            al.entry_uuid::text,
            aa.code          AS account_code,
            al.tiers_uuid::text,
            ROUND(al.debit::numeric,  2)::text AS debit,
            ROUND(al.credit::numeric, 2)::text AS credit
        FROM accounting_lines al
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        WHERE al.fiscal_year_uuid = %s
          {tiers_filter}
        ORDER BY al.entry_uuid, aa.code, al.debit, al.credit
        """,
        [fy_uuid] + tiers_param,
    )
    for entry_uuid, account_code, line_tiers_uuid, debit, credit in cur.fetchall():
        if entry_uuid in entries:
            entries[entry_uuid]["lines"].append({
                "account_code": account_code,
                "tiers_uuid": line_tiers_uuid or "",
                "debit": Decimal(debit),
                "credit": Decimal(credit),
            })

    cur.close()

    # If tiers filter applied, drop entries that ended up with no lines (weren't actually in scope)
    if tiers_uuid:
        entries = {k: v for k, v in entries.items() if v["lines"]}

    return list(entries.values())


def load_member_names(conn) -> dict[str, str]:
    """Return {uuid: 'Prénom NOM (ME2026-XXXX)'} for all members."""
    cur = conn.cursor()
    cur.execute("SELECT uuid::text, account_id, first_name, last_name FROM members")
    result = {}
    for uuid, account_id, first_name, last_name in cur.fetchall():
        label = f"{first_name or ''} {last_name or ''}".strip()
        if account_id:
            label += f" ({account_id})"
        result[uuid] = label
    cur.close()
    return result


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------

def _line_signature(lines: list[dict]) -> str:
    """
    Stable hash of the sorted set of (account_code, tiers_uuid, debit, credit) tuples.
    Two entries with identical lines (regardless of order) get the same signature.
    """
    parts = sorted(
        f"{l['account_code']}|{l['tiers_uuid']}|{l['debit']:.2f}|{l['credit']:.2f}"
        for l in lines
    )
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:16]


def find_duplicate_groups(entries: list[dict]) -> list[list[dict]]:
    """
    Group entries by (entry_date, description, reference, line_signature).

    'reference' is the business reference stored on the entry header.
    For FL flight-billing entries it is 'FL-<planche_uuid>' — unique per flight.
    This prevents two real flights with the same day/amount/pilot from being
    flagged as duplicates just because their billing description is identical.
    Two entries with different references are never duplicates, even if the
    amounts and accounts match exactly.
    Entries with no reference (empty string) are grouped by the other three
    fields as before.
    """
    from collections import defaultdict
    buckets: dict[tuple, list[dict]] = defaultdict(list)
    for entry in entries:
        if not entry["lines"]:
            continue
        sig = _line_signature(entry["lines"])
        key = (entry["entry_date"], entry["description"].strip(), entry["reference"].strip(), sig)
        buckets[key].append(entry)

    return [
        sorted(group, key=lambda e: e["journal_code"])
        for group in buckets.values()
        if len(group) > 1
    ]


# ---------------------------------------------------------------------------
# Printing
# ---------------------------------------------------------------------------

def _entry_totals(entry: dict) -> tuple[Decimal, Decimal]:
    total_d = sum(l["debit"] for l in entry["lines"])
    total_c = sum(l["credit"] for l in entry["lines"])
    return total_d, total_c


def _tiers_label(entry: dict, member_names: dict[str, str]) -> str:
    uuids = {l["tiers_uuid"] for l in entry["lines"] if l["tiers_uuid"]}
    if not uuids:
        return ""
    labels = [member_names.get(u, u[:8] + "…") for u in sorted(uuids)]
    return ", ".join(labels)


def print_groups(groups: list[list[dict]], member_names: dict[str, str]) -> None:
    total_entries = sum(len(g) for g in groups)
    print(f"\nFound {len(groups)} duplicate group(s) — {total_entries} entries total.\n")

    for gidx, group in enumerate(groups, 1):
        d, c = _entry_totals(group[0])
        tiers = _tiers_label(group[0], member_names)
        print(f"  ── Group {gidx:3d}  date={group[0]['entry_date']}  "
              f"debit={d:>12.2f}  credit={c:>12.2f}  tiers: {tiers or '—'}")
        for entry in group:
            state_label = STATE_LABELS.get(entry["state"], str(entry["state"]))
            seq = entry["sequence_number"] or "(no seq)"
            src = ""
            if entry["source_system"]:
                src = f"  src={entry['source_system']}"
            if entry["external_id"]:
                src += f"/{entry['external_id']}"
            print(f"       {entry['uuid']}  [{entry['journal_code']:5s}]  "
                  f"{state_label:<9s}  {seq:<20s}  {entry['description'][:40]:<40s}{src}")
        print()


# ---------------------------------------------------------------------------
# CSV output
# ---------------------------------------------------------------------------

def write_csv(groups: list[list[dict]], member_names: dict[str, str], path: Path) -> None:
    fieldnames = [
        "group_id",
        "entry_uuid",
        "entry_date",
        "journal_code",
        "journal_name",
        "state",
        "sequence_number",
        "description",
        "reference",
        "total_debit",
        "total_credit",
        "tiers",
        "source_system",
        "external_id",
        "import_batch_id",
        "created_at",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for gidx, group in enumerate(groups, 1):
            for entry in group:
                d, c = _entry_totals(entry)
                w.writerow({
                    "group_id": gidx,
                    "entry_uuid": entry["uuid"],
                    "entry_date": entry["entry_date"],
                    "journal_code": entry["journal_code"],
                    "journal_name": entry["journal_name"],
                    "state": STATE_LABELS.get(entry["state"], str(entry["state"])),
                    "sequence_number": entry["sequence_number"],
                    "description": entry["description"],
                    "reference": entry["reference"],
                    "total_debit": f"{d:.2f}",
                    "total_credit": f"{c:.2f}",
                    "tiers": _tiers_label(entry, member_names),
                    "source_system": entry["source_system"],
                    "external_id": entry["external_id"],
                    "import_batch_id": entry["import_batch_id"],
                    "created_at": entry["created_at"],
                })


# ---------------------------------------------------------------------------
# Deletion
# ---------------------------------------------------------------------------

def pick_journal_targets(groups: list[list[dict]], journal_code: str) -> tuple[list[dict], list[dict]]:
    """
    For each duplicate group, select entries from journal_code for deletion.

    Two cases:
    • Mixed group (some entries are in other journals):
        delete all journal_code entries, the other journals provide the surviving copy.
    • Same-journal group (all entries are journal_code):
        keep the oldest entry (by created_at), delete the rest — always leaves one copy.

    Returns (to_delete, skipped_unsafe).
    skipped_unsafe is always empty now; kept for API compatibility.
    """
    to_delete = []
    for group in groups:
        targets = [e for e in group if e["journal_code"] == journal_code]
        survivors = [e for e in group if e["journal_code"] != journal_code]
        if not targets:
            continue
        if survivors:
            # Other journals provide the canonical copy — remove all journal_code copies.
            to_delete.extend(targets)
        else:
            # All entries are from journal_code — keep the oldest, delete the rest.
            ordered = sorted(targets, key=lambda e: e["created_at"])
            to_delete.extend(ordered[1:])  # skip ordered[0] (the one we keep)
    return to_delete, []


def delete_entries(
    conn,
    uuids: list[str],
    entries_by_uuid: dict[str, dict],
    member_names: dict[str, str],
    allow_posted: bool,
    dry_run: bool,
    force: bool,
) -> None:
    """Delete the specified entries after safety checks and optional confirmation."""
    resolved = []
    blocked = []

    for uuid in uuids:
        entry = entries_by_uuid.get(uuid)
        if entry is None:
            print(f"  [WARN] UUID not found in the loaded set: {uuid}")
            continue
        if entry["state"] == 2 and not allow_posted:
            blocked.append(entry)
        else:
            resolved.append(entry)

    if blocked:
        print(f"\n  [BLOCKED] {len(blocked)} Posted entries cannot be deleted without --allow-posted:")
        for e in blocked:
            d, c = _entry_totals(e)
            print(f"    {e['uuid']}  [{e['journal_code']}]  {e['entry_date']}  "
                  f"D={d:.2f} C={c:.2f}  seq={e['sequence_number'] or '—'}")

    if not resolved:
        print("\n  Nothing to delete.")
        return

    print(f"\n  Entries to delete ({len(resolved)}):")
    for e in resolved:
        d, c = _entry_totals(e)
        tiers = _tiers_label(e, member_names)
        state_label = STATE_LABELS.get(e["state"], str(e["state"]))
        print(f"    {e['uuid']}  [{e['journal_code']}]  {e['entry_date']}  "
              f"{state_label:<9s}  D={d:.2f} C={c:.2f}  "
              f"seq={e['sequence_number'] or '—'}  tiers={tiers or '—'}")

    if dry_run:
        print("\n  [DRY RUN] No entries deleted.")
        return

    if not force:
        answer = input(f"\n  Confirm deletion of {len(resolved)} entr"
                       f"{'y' if len(resolved) == 1 else 'ies'}? [yes/N] ").strip().lower()
        if answer not in ("yes", "y"):
            print("  Aborted.")
            return

    uuids_to_delete = [e["uuid"] for e in resolved]
    cur = conn.cursor()
    try:
        cur.execute(
            "DELETE FROM accounting_entries WHERE uuid = ANY(%s::uuid[])",
            (uuids_to_delete,),
        )
        deleted = cur.rowcount

        # Reset any ValidatedFlight that was pointing at a deleted entry.
        # Keeps the invariant: if an FL entry is gone, the flight must show
        # as unbilled (accounting_entry_uuid = NULL) so billing works cleanly.
        # No-op for non-FL entries (no flight row references them).
        cur.execute(
            """
            UPDATE validated_flights
            SET accounting_entry_uuid = NULL,
                billing_quote_state   = 'pending',
                erp_status            = 0
            WHERE accounting_entry_uuid = ANY(%s::uuid[])
            """,
            (uuids_to_delete,),
        )
        flights_reset = cur.rowcount

        conn.commit()
        msg = f"\n  Deleted {deleted} entr{'y' if deleted == 1 else 'ies'} (lines removed by CASCADE)."
        if flights_reset:
            msg += f"\n  Reset {flights_reset} flight(s) to unbilled state."
        print(msg)
    except Exception as exc:
        conn.rollback()
        print(f"\n  [ERROR] Deletion failed: {exc}")
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def _parse_args(argv: list[str]) -> dict:
    opts = {
        "year": 2026,
        "journal": None,
        "tiers": None,
        "dry_run": False,
        "output": None,
        "delete": [],
        "delete_journal": None,
        "allow_posted": False,
        "force": False,
    }
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--year" and i + 1 < len(argv):
            opts["year"] = int(argv[i + 1]); i += 2
        elif arg == "--journal" and i + 1 < len(argv):
            opts["journal"] = argv[i + 1]; i += 2
        elif arg == "--tiers" and i + 1 < len(argv):
            opts["tiers"] = argv[i + 1]; i += 2
        elif arg == "--dry-run":
            opts["dry_run"] = True; i += 1
        elif arg == "--output" and i + 1 < len(argv):
            opts["output"] = argv[i + 1]; i += 2
        elif arg == "--delete" and i + 1 < len(argv):
            opts["delete"] = [u.strip() for u in argv[i + 1].split(",") if u.strip()]
            i += 2
        elif arg == "--delete-journal" and i + 1 < len(argv):
            opts["delete_journal"] = argv[i + 1]; i += 2
        elif arg == "--allow-posted":
            opts["allow_posted"] = True; i += 1
        elif arg == "--force":
            opts["force"] = True; i += 1
        else:
            print(f"[WARN] Unknown argument: {arg}", file=sys.stderr)
            i += 1
    return opts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    opts = _parse_args(sys.argv[1:])

    out_path = Path(opts["output"]) if opts["output"] else OUTPUT_DIR / "check_duplicates.csv"

    print("=== ERP Duplicate Accounting Entries Checker ===")
    print(f"  Fiscal year : {opts['year']}")
    if opts["journal"]:
        print(f"  Journal     : {opts['journal']}")
    if opts["tiers"]:
        print(f"  Tiers UUID  : {opts['tiers']}")
    if opts["dry_run"]:
        print("  [DRY RUN — no files written / no deletions]")
    if opts["delete"]:
        print(f"  Delete mode : {len(opts['delete'])} UUID(s) requested")
    if opts["delete_journal"]:
        print(f"  Delete-journal : remove [{opts['delete_journal']}] copies from every duplicate group")
    if opts["delete"] or opts["delete_journal"]:
        if opts["allow_posted"]:
            print("  [--allow-posted: Posted entries may be deleted]")
    print()

    print("Connecting to database…")
    conn = _connect()
    print("  Connected.")

    print(f"Loading fiscal year {opts['year']}…")
    fy_uuid = load_fiscal_year_uuid(conn, opts["year"])
    print(f"  FY uuid: {fy_uuid}")

    print("Loading entries and lines…")
    entries = load_entries_with_lines(conn, fy_uuid, opts["journal"], opts["tiers"])
    print(f"  {len(entries)} entries loaded.")

    print("Loading member names…")
    member_names = load_member_names(conn)
    print(f"  {len(member_names)} members.")

    # --- Duplicate detection ---
    print("\nScanning for duplicates…")
    groups = find_duplicate_groups(entries)

    if not groups:
        print("  No duplicates found.")
    else:
        print_groups(groups, member_names)

        if not opts["dry_run"]:
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            write_csv(groups, member_names, out_path)
            print(f"  CSV written → {out_path}")
        else:
            print("  [DRY RUN] CSV not written.")

    # --- Optional deletion: explicit UUIDs ---
    if opts["delete"]:
        entries_by_uuid = {e["uuid"]: e for e in entries}
        print("\n--- Deletion (by UUID) ---")
        delete_entries(
            conn=conn,
            uuids=opts["delete"],
            entries_by_uuid=entries_by_uuid,
            member_names=member_names,
            allow_posted=opts["allow_posted"],
            dry_run=opts["dry_run"],
            force=opts["force"],
        )

    # --- Optional deletion: by journal ---
    if opts["delete_journal"]:
        jcode = opts["delete_journal"]
        print(f"\n--- Deletion (journal={jcode}) ---")
        if not groups:
            print("  No duplicate groups — nothing to delete.")
        else:
            to_delete, _ = pick_journal_targets(groups, jcode)
            if not to_delete:
                print(f"  No entries from journal [{jcode}] found in duplicate groups.")
            else:
                entries_by_uuid = {e["uuid"]: e for e in entries}
                delete_entries(
                    conn=conn,
                    uuids=[e["uuid"] for e in to_delete],
                    entries_by_uuid=entries_by_uuid,
                    member_names=member_names,
                    allow_posted=opts["allow_posted"],
                    dry_run=opts["dry_run"],
                    force=opts["force"],
                )

    conn.close()


if __name__ == "__main__":
    main()
