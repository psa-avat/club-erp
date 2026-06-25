"""
ERP-CLUB - Flight Billing Integrity Checker
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
Three checks in one pass:

  1. ORPHAN FL ENTRIES
     FL journal accounting entries that no ValidatedFlight references
     (validated_flights.accounting_entry_uuid != entry.uuid for every row).
     These are billing artefacts that should be deleted.

  2. DUPLICATE FLIGHTS
     ValidatedFlight rows that share the same (jour, asset_code, pilot_erp_id,
     takeoff_time, landing_time) — i.e. the same physical flight imported or
     billed more than once under different UUIDs.

     Each duplicate flight is linked to its own FL accounting entry, so
     these do NOT appear as orphans. The fix is to delete the unwanted
     ValidatedFlight row — this converts its linked FL entry into an orphan
     which can then be removed with --delete-orphans.

     Deletion: --delete-flights UUID,... removes the specified ValidatedFlight
     rows AND their linked FL accounting entries in one step.

  3. NON-BILLED FLIGHTS
     ValidatedFlight rows whose accounting_entry_uuid IS NULL and whose
     source_status is not 'deleted'. These flights exist in the ERP but have
     never been billed.

────────────────────────────────────────────────────────────────────────────
Usage
  python check_flight_billing.py [options]

Options
  --year YEAR             fiscal year to scan (default: 2026)
  --dry-run               no files written and no deletions performed
  --output-orphans PATH   CSV for orphan entries  (default: output/orphan_fl_entries.csv)
  --output-dupes PATH     CSV for duplicate flights (default: output/duplicate_flights.csv)
  --output-flights PATH   CSV for non-billed flights (default: output/unbilled_flights.csv)

Deletion — orphan FL entries
  --delete-orphans        delete ALL orphan FL entries found (after confirmation)
  --delete UUID,...       delete specific orphan entry UUIDs
  --allow-posted          allow deleting Posted (state=2) orphan entries
                          (default: Draft only)

Deletion — duplicate flights (flight row + its FL accounting entry together)
  --delete-flights UUID,... comma-separated ValidatedFlight UUIDs to delete.
                          The linked FL entry is deleted in the same transaction.

Common flags
  --force                 skip confirmation prompt
────────────────────────────────────────────────────────────────────────────
"""

import csv
import os
import sys
from decimal import Decimal
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

# ---------------------------------------------------------------------------
# Paths / constants
# ---------------------------------------------------------------------------
TOOLS_DIR = Path(__file__).parent.resolve()
OUTPUT_DIR = TOOLS_DIR / "output"

STATE_LABELS = {1: "Draft", 2: "Posted", 3: "Cancelled"}
ERP_STATUS_LABELS = {0: "pending", 1: "transferred", 2: "modified"}


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
# Data loading
# ---------------------------------------------------------------------------

def load_fiscal_year(conn, year: int) -> dict:
    cur = conn.cursor()
    cur.execute(
        "SELECT uuid::text, year, start_date::text, end_date::text "
        "FROM accounting_fiscal_years WHERE year = %s LIMIT 1",
        (year,),
    )
    row = cur.fetchone()
    cur.close()
    if not row:
        raise RuntimeError(f"No fiscal year for {year} found in the database.")
    return {"uuid": row[0], "year": row[1], "start_date": row[2], "end_date": row[3]}


def load_member_names(conn) -> dict[str, str]:
    """Return {uuid_str: 'Prénom NOM (ME2026-XXXX)'} for all members."""
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


def load_orphan_fl_entries(conn, fy_uuid: str) -> list[dict]:
    """
    FL journal entries in the fiscal year that no ValidatedFlight references.
    A ValidatedFlight links to an entry via validated_flights.accounting_entry_uuid.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            ae.uuid::text,
            ae.entry_date::text,
            ae.state,
            ae.sequence_number,
            ae.description,
            ae.reference,
            ae.source_system,
            ae.external_id,
            ae.created_at::text,
            ROUND(COALESCE(SUM(al.debit),  0)::numeric, 2)::text AS total_debit,
            ROUND(COALESCE(SUM(al.credit), 0)::numeric, 2)::text AS total_credit
        FROM accounting_entries ae
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid AND aj.code = 'FL'
        LEFT JOIN accounting_lines al
               ON al.entry_uuid = ae.uuid AND al.fiscal_year_uuid = ae.fiscal_year_uuid
        LEFT JOIN validated_flights vf ON vf.accounting_entry_uuid = ae.uuid
        WHERE ae.fiscal_year_uuid = %s
          AND vf.uuid IS NULL
        GROUP BY ae.uuid, ae.entry_date, ae.state, ae.sequence_number,
                 ae.description, ae.reference, ae.source_system, ae.external_id, ae.created_at
        ORDER BY ae.entry_date, ae.created_at
        """,
        (fy_uuid,),
    )
    rows = []
    for row in cur.fetchall():
        rows.append({
            "uuid": row[0],
            "entry_date": row[1],
            "state": row[2],
            "state_label": STATE_LABELS.get(row[2], str(row[2])),
            "sequence_number": row[3] or "",
            "description": row[4] or "",
            "reference": row[5] or "",
            "source_system": row[6] or "",
            "external_id": row[7] or "",
            "created_at": row[8] or "",
            "total_debit": Decimal(row[9]),
            "total_credit": Decimal(row[10]),
        })
    cur.close()
    return rows


def load_duplicate_flights(conn, fy_start: str, fy_end: str) -> list[list[dict]]:
    """
    Find ValidatedFlight rows that share (jour, asset_code, pilot_erp_id,
    takeoff_time, landing_time) — the fingerprint of a unique physical flight.
    Returns groups of 2+ rows, each group sorted by validated_at ascending
    (oldest first = the one most likely to keep).
    Only looks at flights in the fiscal year date range.
    """
    cur = conn.cursor()
    cur.execute(
        """
        WITH fingerprints AS (
            SELECT
                uuid::text,
                planche_uuid,
                jour::text,
                asset_code,
                pilot_erp_id,
                second_pilot_erp_id,
                charge_to_erp_id,
                takeoff_time,
                landing_time,
                erp_status,
                billing_quote_state,
                source_status,
                accounting_entry_uuid::text  AS accounting_entry_uuid,
                validated_at::text,
                COUNT(*) OVER (
                    PARTITION BY jour, asset_code, pilot_erp_id, takeoff_time, landing_time
                ) AS grp_size,
                MIN(validated_at) OVER (
                    PARTITION BY jour, asset_code, pilot_erp_id, takeoff_time, landing_time
                ) AS grp_oldest_at
            FROM validated_flights
            WHERE jour BETWEEN %s AND %s
              AND source_status NOT IN ('deleted')
        )
        SELECT
            uuid, planche_uuid, jour, asset_code,
            pilot_erp_id, second_pilot_erp_id, charge_to_erp_id,
            takeoff_time, landing_time,
            erp_status, billing_quote_state, source_status,
            accounting_entry_uuid,
            validated_at
        FROM fingerprints
        WHERE grp_size > 1
        ORDER BY jour, asset_code, takeoff_time, grp_oldest_at, validated_at
        """,
        (fy_start, fy_end),
    )
    raw: dict[tuple, list[dict]] = {}
    for row in cur.fetchall():
        fp = {
            "uuid": row[0],
            "planche_uuid": row[1] or "",
            "jour": row[2],
            "asset_code": row[3] or "",
            "pilot_erp_id": row[4] or "",
            "second_pilot_erp_id": row[5] or "",
            "charge_to_erp_id": row[6] or "",
            "takeoff_time": row[7] or "",
            "landing_time": row[8] or "",
            "erp_status": row[9],
            "erp_status_label": ERP_STATUS_LABELS.get(row[9], str(row[9])),
            "billing_quote_state": row[10] or "",
            "source_status": row[11] or "",
            "accounting_entry_uuid": row[12] or "",
            "validated_at": row[13] or "",
        }
        key = (fp["jour"], fp["asset_code"], fp["pilot_erp_id"], fp["takeoff_time"], fp["landing_time"])
        raw.setdefault(key, []).append(fp)
    cur.close()
    return [sorted(g, key=lambda r: r["validated_at"]) for g in raw.values()]


def load_unbilled_flights(conn, fy_start: str, fy_end: str) -> list[dict]:
    """
    ValidatedFlight rows with no accounting entry (not billed), within the fiscal year
    date range, excluding Planche-deleted flights.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            vf.uuid::text,
            vf.planche_uuid,
            vf.jour::text,
            vf.asset_code,
            vf.pilot_erp_id,
            vf.second_pilot_erp_id,
            vf.charge_to_erp_id,
            vf.type_of_flight,
            vf.launch_method,
            vf.takeoff_time,
            vf.landing_time,
            vf.erp_status,
            vf.billing_quote_state,
            vf.source_status,
            vf.validated_at::text,
            vf.transferred_at::text
        FROM validated_flights vf
        WHERE vf.accounting_entry_uuid IS NULL
          AND vf.jour BETWEEN %s AND %s
          AND vf.source_status NOT IN ('deleted')
        ORDER BY vf.jour, vf.asset_code, vf.takeoff_time
        """,
        (fy_start, fy_end),
    )
    rows = []
    for row in cur.fetchall():
        rows.append({
            "uuid": row[0],
            "planche_uuid": row[1] or "",
            "jour": row[2],
            "asset_code": row[3] or "",
            "pilot_erp_id": row[4] or "",
            "second_pilot_erp_id": row[5] or "",
            "charge_to_erp_id": row[6] or "",
            "type_of_flight": row[7],
            "launch_method": row[8],
            "takeoff_time": row[9] or "",
            "landing_time": row[10] or "",
            "erp_status": row[11],
            "erp_status_label": ERP_STATUS_LABELS.get(row[11], str(row[11])),
            "billing_quote_state": row[12] or "",
            "source_status": row[13] or "",
            "validated_at": row[14] or "",
            "transferred_at": row[15] or "",
        })
    cur.close()
    return rows


# ---------------------------------------------------------------------------
# Printing
# ---------------------------------------------------------------------------

def _duration_label(takeoff: str, landing: str) -> str:
    """Return HHhMM or '' from HH:MM strings."""
    try:
        th, tm = int(takeoff[:2]), int(takeoff[3:5])
        lh, lm = int(landing[:2]), int(landing[3:5])
        diff = (lh * 60 + lm) - (th * 60 + tm)
        if diff < 0:
            diff += 24 * 60
        return f"{diff // 60}h{diff % 60:02d}"
    except (ValueError, TypeError, IndexError):
        return ""


def print_orphan_entries(entries: list[dict]) -> None:
    if not entries:
        print("  No orphan FL entries found.")
        return
    print(f"  {len(entries)} orphan FL entr{'y' if len(entries)==1 else 'ies'} (no linked flight):\n")
    print(f"  {'Date':<12}  {'State':<9}  {'Seq':<20}  {'Debit':>10}  {'Credit':>10}  Description / UUID")
    print(f"  {'-'*12}  {'-'*9}  {'-'*20}  {'-'*10}  {'-'*10}  {'-'*50}")
    for e in entries:
        print(f"  {e['entry_date']:<12}  {e['state_label']:<9}  {e['sequence_number'] or '(no seq)':<20}  "
              f"{e['total_debit']:>10.2f}  {e['total_credit']:>10.2f}  "
              f"{e['description'][:40]}")
        print(f"  {'':12}  {'':9}  {'':20}  {'':10}  {'':10}  uuid={e['uuid']}")
    print()


def print_duplicate_flights(groups: list[list[dict]], member_names: dict[str, str]) -> None:
    if not groups:
        print("  No duplicate flights found.")
        return
    total = sum(len(g) for g in groups)
    print(f"  {len(groups)} duplicate group(s) — {total} ValidatedFlight rows:\n")
    for gidx, group in enumerate(groups, 1):
        f0 = group[0]
        pilot = member_names.get(f0["pilot_erp_id"], f0["pilot_erp_id"][:16] if f0["pilot_erp_id"] else "—")
        dur = _duration_label(f0["takeoff_time"], f0["landing_time"])
        print(f"  ── Group {gidx}  {f0['jour']}  {f0['asset_code']}  {f0['takeoff_time']}–{f0['landing_time']} ({dur})  {pilot}")
        for i, fl in enumerate(group):
            keep_tag = "  ← keep (oldest)" if i == 0 else "  ← DELETE?"
            billed = f"entry={fl['accounting_entry_uuid'][:8]}…" if fl["accounting_entry_uuid"] else "NOT BILLED"
            print(f"       flight={fl['uuid']}  planche={fl['planche_uuid'][:16] if fl['planche_uuid'] else '—'}…"
                  f"  [{fl['erp_status_label']:<12}]  {billed}{keep_tag}")
        print()


def print_unbilled_flights(flights: list[dict], member_names: dict[str, str]) -> None:
    if not flights:
        print("  No unbilled flights found.")
        return
    print(f"  {len(flights)} unbilled flight{'s' if len(flights)!=1 else ''}:\n")
    print(f"  {'Date':<12}  {'Glider':<10}  {'Duration':<8}  {'Status':<12}  Pilot / Charge-to")
    print(f"  {'-'*12}  {'-'*10}  {'-'*8}  {'-'*12}  {'-'*40}")
    for f in flights:
        dur = _duration_label(f["takeoff_time"], f["landing_time"])
        pilot = member_names.get(f["pilot_erp_id"], f["pilot_erp_id"][:16] if f["pilot_erp_id"] else "—")
        charge = ""
        if f["charge_to_erp_id"] and f["charge_to_erp_id"] != f["pilot_erp_id"]:
            charge = " → " + member_names.get(f["charge_to_erp_id"], f["charge_to_erp_id"][:16])
        print(f"  {f['jour']:<12}  {f['asset_code']:<10}  {dur:<8}  "
              f"{f['erp_status_label']:<12}  {pilot}{charge}")
    print()


# ---------------------------------------------------------------------------
# CSV output
# ---------------------------------------------------------------------------

def write_orphan_csv(entries: list[dict], path: Path) -> None:
    fieldnames = [
        "entry_uuid", "entry_date", "state", "sequence_number",
        "description", "reference", "total_debit", "total_credit",
        "source_system", "external_id", "created_at",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for e in entries:
            w.writerow({
                "entry_uuid": e["uuid"],
                "entry_date": e["entry_date"],
                "state": e["state_label"],
                "sequence_number": e["sequence_number"],
                "description": e["description"],
                "reference": e["reference"],
                "total_debit": f"{e['total_debit']:.2f}",
                "total_credit": f"{e['total_credit']:.2f}",
                "source_system": e["source_system"],
                "external_id": e["external_id"],
                "created_at": e["created_at"],
            })


def write_duplicate_flights_csv(groups: list[list[dict]], member_names: dict[str, str], path: Path) -> None:
    fieldnames = [
        "group_id", "keep", "flight_uuid", "planche_uuid", "jour", "asset_code",
        "pilot", "takeoff_time", "landing_time", "duration",
        "erp_status", "billing_quote_state", "source_status",
        "accounting_entry_uuid", "validated_at",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for gidx, group in enumerate(groups, 1):
            for i, fl in enumerate(group):
                dur = _duration_label(fl["takeoff_time"], fl["landing_time"])
                pilot = member_names.get(fl["pilot_erp_id"], fl["pilot_erp_id"])
                w.writerow({
                    "group_id": gidx,
                    "keep": "yes" if i == 0 else "no",
                    "flight_uuid": fl["uuid"],
                    "planche_uuid": fl["planche_uuid"],
                    "jour": fl["jour"],
                    "asset_code": fl["asset_code"],
                    "pilot": pilot,
                    "takeoff_time": fl["takeoff_time"],
                    "landing_time": fl["landing_time"],
                    "duration": dur,
                    "erp_status": fl["erp_status_label"],
                    "billing_quote_state": fl["billing_quote_state"],
                    "source_status": fl["source_status"],
                    "accounting_entry_uuid": fl["accounting_entry_uuid"],
                    "validated_at": fl["validated_at"],
                })


def write_unbilled_csv(flights: list[dict], member_names: dict[str, str], path: Path) -> None:
    fieldnames = [
        "flight_uuid", "planche_uuid", "jour", "asset_code",
        "pilot", "charge_to", "takeoff_time", "landing_time", "duration",
        "type_of_flight", "launch_method", "erp_status", "billing_quote_state",
        "source_status", "validated_at",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for fl in flights:
            dur = _duration_label(fl["takeoff_time"], fl["landing_time"])
            pilot = member_names.get(fl["pilot_erp_id"], fl["pilot_erp_id"])
            charge_to = member_names.get(fl["charge_to_erp_id"], fl["charge_to_erp_id"]) if fl["charge_to_erp_id"] else ""
            w.writerow({
                "flight_uuid": fl["uuid"],
                "planche_uuid": fl["planche_uuid"],
                "jour": fl["jour"],
                "asset_code": fl["asset_code"],
                "pilot": pilot,
                "charge_to": charge_to,
                "takeoff_time": fl["takeoff_time"],
                "landing_time": fl["landing_time"],
                "duration": dur,
                "type_of_flight": fl["type_of_flight"],
                "launch_method": fl["launch_method"],
                "erp_status": fl["erp_status_label"],
                "billing_quote_state": fl["billing_quote_state"],
                "source_status": fl["source_status"],
                "validated_at": fl["validated_at"],
            })


# ---------------------------------------------------------------------------
# Deletion
# ---------------------------------------------------------------------------

def delete_duplicate_flights(
    conn,
    flight_uuids: list[str],
    groups: list[list[dict]],
    member_names: dict[str, str],
    dry_run: bool,
    force: bool,
) -> None:
    """
    Delete specified ValidatedFlight rows AND their linked FL accounting entries
    in a single transaction.

    Safety: refuses to delete a flight that is the only (first/oldest) member of
    its duplicate group — you must explicitly pass a non-first UUID.
    """
    # Build lookup: flight_uuid → row dict
    all_flights: dict[str, dict] = {}
    oldest_per_group: set[str] = set()
    for group in groups:
        oldest_per_group.add(group[0]["uuid"])
        for fl in group:
            all_flights[fl["uuid"]] = fl

    to_delete = []
    blocked_oldest = []
    not_found = []

    for uid in flight_uuids:
        if uid not in all_flights:
            not_found.append(uid)
            continue
        if uid in oldest_per_group:
            blocked_oldest.append(all_flights[uid])
        else:
            to_delete.append(all_flights[uid])

    for uid in not_found:
        print(f"  [WARN] UUID not found in duplicate flight groups: {uid}", file=sys.stderr)

    if blocked_oldest:
        print(f"  [BLOCKED] {len(blocked_oldest)} flight(s) are the oldest in their group "
              f"(marked 'keep'). Pass a different UUID from the group, or re-run without this UUID:")
        for fl in blocked_oldest:
            pilot = member_names.get(fl["pilot_erp_id"], fl["pilot_erp_id"][:16])
            print(f"    {fl['uuid']}  {fl['jour']}  {fl['asset_code']}  {pilot}")

    if not to_delete:
        print("  Nothing to delete.")
        return

    print(f"\n  Flights to delete ({len(to_delete)}) — flight row + linked FL entry:")
    for fl in to_delete:
        pilot = member_names.get(fl["pilot_erp_id"], fl["pilot_erp_id"][:16])
        dur = _duration_label(fl["takeoff_time"], fl["landing_time"])
        entry_info = f"  entry={fl['accounting_entry_uuid'][:8]}…" if fl["accounting_entry_uuid"] else "  (no FL entry)"
        print(f"    flight={fl['uuid']}  {fl['jour']}  {fl['asset_code']}  {dur}  "
              f"[{fl['erp_status_label']}]  {pilot}{entry_info}")

    if dry_run:
        print("\n  [DRY RUN] Nothing deleted.")
        return

    if not force:
        answer = input(
            f"\n  Confirm deletion of {len(to_delete)} flight(s) and their FL entries? [yes/N] "
        ).strip().lower()
        if answer not in ("yes", "y"):
            print("  Aborted.")
            return

    flight_uuid_list = [fl["uuid"] for fl in to_delete]
    entry_uuid_list = [fl["accounting_entry_uuid"] for fl in to_delete if fl["accounting_entry_uuid"]]

    cur = conn.cursor()
    try:
        # Delete flights first (no FK cascade to entries)
        cur.execute(
            "DELETE FROM validated_flights WHERE uuid = ANY(%s::uuid[])",
            (flight_uuid_list,),
        )
        flights_deleted = cur.rowcount

        # Delete their linked FL accounting entries (lines cascade)
        entries_deleted = 0
        if entry_uuid_list:
            cur.execute(
                "DELETE FROM accounting_entries WHERE uuid = ANY(%s::uuid[])",
                (entry_uuid_list,),
            )
            entries_deleted = cur.rowcount

        conn.commit()
        print(f"\n  Deleted {flights_deleted} flight(s) and {entries_deleted} FL entr"
              f"{'y' if entries_deleted == 1 else 'ies'} (lines removed by CASCADE).")
    except Exception as exc:
        conn.rollback()
        print(f"\n  [ERROR] Deletion failed: {exc}")
    finally:
        cur.close()


def _resolve_deletion_targets(
    candidates: list[dict],
    uuids_filter: list[str] | None,
    allow_posted: bool,
) -> tuple[list[dict], list[dict]]:
    """
    From candidate orphan entries, select those to delete.
    If uuids_filter is provided, restrict to those UUIDs.
    Returns (to_delete, blocked_posted).
    """
    pool = candidates if not uuids_filter else [
        e for e in candidates if e["uuid"] in set(uuids_filter)
    ]
    if uuids_filter:
        found = {e["uuid"] for e in pool}
        for uid in uuids_filter:
            if uid not in found:
                print(f"  [WARN] UUID not found among orphan entries: {uid}", file=sys.stderr)

    to_delete = []
    blocked = []
    for e in pool:
        if e["state"] == 2 and not allow_posted:
            blocked.append(e)
        else:
            to_delete.append(e)
    return to_delete, blocked


def delete_orphan_entries(
    conn,
    to_delete: list[dict],
    blocked: list[dict],
    dry_run: bool,
    force: bool,
) -> None:
    if blocked:
        print(f"  [BLOCKED] {len(blocked)} Posted entr{'y' if len(blocked)==1 else 'ies'} "
              f"skipped (add --allow-posted to include):")
        for e in blocked:
            print(f"    {e['uuid']}  {e['entry_date']}  seq={e['sequence_number'] or '—'}  "
                  f"D={e['total_debit']:.2f} C={e['total_credit']:.2f}")

    if not to_delete:
        print("  Nothing to delete.")
        return

    print(f"\n  Entries to delete ({len(to_delete)}):")
    for e in to_delete:
        print(f"    {e['uuid']}  {e['entry_date']}  {e['state_label']:<9}  "
              f"seq={e['sequence_number'] or '—'}  "
              f"D={e['total_debit']:.2f} C={e['total_credit']:.2f}  {e['description'][:40]}")

    if dry_run:
        print("\n  [DRY RUN] No entries deleted.")
        return

    if not force:
        answer = input(
            f"\n  Confirm deletion of {len(to_delete)} orphan FL "
            f"entr{'y' if len(to_delete)==1 else 'ies'}? [yes/N] "
        ).strip().lower()
        if answer not in ("yes", "y"):
            print("  Aborted.")
            return

    uuids = [e["uuid"] for e in to_delete]
    cur = conn.cursor()
    try:
        cur.execute(
            "DELETE FROM accounting_entries WHERE uuid = ANY(%s::uuid[])",
            (uuids,),
        )
        deleted = cur.rowcount

        # Safety reset: if any flight still referenced one of these entries
        # (shouldn't happen for true orphans, but guards against edge cases),
        # put the flight back into unbilled state so billing works cleanly.
        cur.execute(
            """
            UPDATE validated_flights
            SET accounting_entry_uuid = NULL,
                billing_quote_state   = 'pending',
                erp_status            = 0
            WHERE accounting_entry_uuid = ANY(%s::uuid[])
            """,
            (uuids,),
        )
        flights_reset = cur.rowcount

        conn.commit()
        msg = (f"\n  Deleted {deleted} orphan FL entr{'y' if deleted==1 else 'ies'} "
               f"(lines removed by CASCADE).")
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
        "dry_run": False,
        "output_orphans": None,
        "output_dupes": None,
        "output_flights": None,
        "delete_orphans": False,
        "delete": [],
        "delete_flights": [],
        "allow_posted": False,
        "force": False,
    }
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--year" and i + 1 < len(argv):
            opts["year"] = int(argv[i + 1]); i += 2
        elif arg == "--dry-run":
            opts["dry_run"] = True; i += 1
        elif arg == "--output-orphans" and i + 1 < len(argv):
            opts["output_orphans"] = argv[i + 1]; i += 2
        elif arg == "--output-dupes" and i + 1 < len(argv):
            opts["output_dupes"] = argv[i + 1]; i += 2
        elif arg == "--output-flights" and i + 1 < len(argv):
            opts["output_flights"] = argv[i + 1]; i += 2
        elif arg == "--delete-orphans":
            opts["delete_orphans"] = True; i += 1
        elif arg == "--delete" and i + 1 < len(argv):
            opts["delete"] = [u.strip() for u in argv[i + 1].split(",") if u.strip()]
            i += 2
        elif arg == "--delete-flights" and i + 1 < len(argv):
            opts["delete_flights"] = [u.strip() for u in argv[i + 1].split(",") if u.strip()]
            i += 2
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

    print("=== ERP Flight Billing Integrity Check ===")
    print(f"  Fiscal year : {opts['year']}")
    if opts["dry_run"]:
        print("  [DRY RUN — no files written / no deletions]")
    if opts["delete_orphans"]:
        print("  Mode        : delete ALL orphan FL entries")
    elif opts["delete"]:
        print(f"  Mode        : delete {len(opts['delete'])} specific orphan UUID(s)")
    if opts["delete_flights"]:
        print(f"  Mode        : delete {len(opts['delete_flights'])} duplicate flight(s) + their FL entries")
    if (opts["delete_orphans"] or opts["delete"]) and opts["allow_posted"]:
        print("  [--allow-posted: Posted entries may be deleted]")
    print()

    print("Connecting to database…")
    conn = _connect()
    print("  Connected.")

    print(f"Loading fiscal year {opts['year']}…")
    fy = load_fiscal_year(conn, opts["year"])
    print(f"  FY {fy['year']}:  {fy['start_date']} → {fy['end_date']}")

    print("Loading member names…")
    member_names = load_member_names(conn)
    print(f"  {len(member_names)} members.")

    out_orphans = Path(opts["output_orphans"]) if opts["output_orphans"] else OUTPUT_DIR / "orphan_fl_entries.csv"
    out_dupes   = Path(opts["output_dupes"])   if opts["output_dupes"]   else OUTPUT_DIR / "duplicate_flights.csv"
    out_flights = Path(opts["output_flights"]) if opts["output_flights"] else OUTPUT_DIR / "unbilled_flights.csv"

    # ── 1. Orphan FL entries ─────────────────────────────────────────────
    print("\n── Orphan FL entries ──────────────────────────────────────────")
    orphans = load_orphan_fl_entries(conn, fy["uuid"])
    print_orphan_entries(orphans)

    if orphans and not opts["dry_run"]:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        write_orphan_csv(orphans, out_orphans)
        print(f"  CSV written → {out_orphans}")
    elif orphans and opts["dry_run"]:
        print("  [DRY RUN] CSV not written.")

    # ── 2. Duplicate flights ─────────────────────────────────────────────
    print("\n── Duplicate flights ──────────────────────────────────────────")
    dupe_groups = load_duplicate_flights(conn, fy["start_date"], fy["end_date"])
    print_duplicate_flights(dupe_groups, member_names)

    if dupe_groups and not opts["dry_run"]:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        write_duplicate_flights_csv(dupe_groups, member_names, out_dupes)
        print(f"  CSV written → {out_dupes}")
    elif dupe_groups and opts["dry_run"]:
        print("  [DRY RUN] CSV not written.")

    # ── 3. Non-billed flights ────────────────────────────────────────────
    print("\n── Non-billed flights ─────────────────────────────────────────")
    unbilled = load_unbilled_flights(conn, fy["start_date"], fy["end_date"])
    print_unbilled_flights(unbilled, member_names)

    if unbilled and not opts["dry_run"]:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        write_unbilled_csv(unbilled, member_names, out_flights)
        print(f"  CSV written → {out_flights}")
    elif unbilled and opts["dry_run"]:
        print("  [DRY RUN] CSV not written.")

    # ── 4. Delete orphan FL entries ──────────────────────────────────────
    if opts["delete_orphans"] or opts["delete"]:
        print("\n── Deletion — orphan FL entries ───────────────────────────────")
        if not orphans:
            print("  No orphan entries to delete.")
        else:
            uuids_filter = opts["delete"] if opts["delete"] else None
            to_delete, blocked = _resolve_deletion_targets(
                orphans, uuids_filter, opts["allow_posted"]
            )
            delete_orphan_entries(conn, to_delete, blocked, opts["dry_run"], opts["force"])

    # ── 5. Delete duplicate flights ──────────────────────────────────────
    if opts["delete_flights"]:
        print("\n── Deletion — duplicate flights ───────────────────────────────")
        if not dupe_groups:
            print("  No duplicate flight groups found.")
        else:
            delete_duplicate_flights(
                conn, opts["delete_flights"], dupe_groups, member_names,
                opts["dry_run"], opts["force"],
            )

    conn.close()


if __name__ == "__main__":
    main()
