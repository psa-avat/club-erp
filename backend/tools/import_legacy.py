"""
ERP-CLUB - Legacy Data Import Tool
Copyright (C) 2026  SAFORCADA Patrick

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Read Vulcain legacy CSV data, produce import-ready files for the ERP:
  - import_entries_{journal}.json   accounting entries per journal (non-flight)
  - pack_consumptions.json          MemberPackConsumption records (pack25 flights)
  - pack_unmatched.csv              pack flights with no ERP flight match
  - gap_report_flights.csv          flight presence + gross price comparison
  - member_mapping.csv              pilot n → ERP member mapping for review
  - import_summary.txt              run statistics

The tool NEVER writes to the database. All DB access is read-only.
Run from backend/tools/ or anywhere; paths are relative to this file.
"""

import csv
import json
import os
import sys
import unicodedata
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TOOLS_DIR = Path(__file__).parent.resolve()
LEGACY_DIR = TOOLS_DIR / "legacy-data"
OUTPUT_DIR = TOOLS_DIR / "output"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SOURCE_SYSTEM = "vulcain"
IMPORT_BATCH_ID = "vulcain-2026"

# Legacy journal code → ERP journal code (None = skip, flight-related)
JOURNAL_MAP: dict[str, str | None] = {
    "VVO": None,   # flight entries — always skip
    "RPT": "AN",
    "VIN": "VT",
    "VDI": "VT",
    "AC":  "AC",   # ERP has both AC and HA; previous CSV import used AC
    "BQ":  "BQ",
    "CA":  "CA",   # ERP has both CA and CS; previous CSV import used CA
    "EXP": "OD",
    "INV": "OD",
    "MEM": "OD",
    "ORG": "OD",
    "PER": "OD",
}

# Account prefixes considered flight-related (used as extra guard)
FLIGHT_ACCOUNT_PREFIXES = ("7061", "7062", "7063", "7064")


# ---------------------------------------------------------------------------
# DB connection
# ---------------------------------------------------------------------------

def _load_db_url() -> str:
    # Priority: tools/.env > deploy/.env > backend/.env > environment variable
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
        "See backend/tools/.env.example for a template."
    )


def _connect() -> psycopg2.extensions.connection:
    url = _load_db_url()
    # Strip async driver prefix if present
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return psycopg2.connect(url)


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def _read_csv(path: Path) -> list[dict]:
    """Read a legacy CSV (Latin-1, semicolon-separated)."""
    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        return [row for row in reader]


def _clean_amount(val: str) -> Decimal:
    """Parse French-formatted decimal (comma as separator, optional nbsp)."""
    if not val:
        return Decimal("0")
    cleaned = val.strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    if not cleaned or cleaned == "-":
        return Decimal("0")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return Decimal("0")


def _parse_date(val: str) -> str:
    """DD/MM/YY or DD/MM/YYYY → YYYY-MM-DD."""
    val = (val or "").strip()
    for fmt in ("%d/%m/%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(val, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {val!r}")


def _normalize_name(s: str) -> str:
    """Lowercase, strip diacritics and whitespace for fuzzy name matching."""
    s = (s or "").strip().lower()
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _normalize_time(t: str) -> str:
    """Normalize takeoff/landing time to 'HH:MM'.
    ERP stores '16:04'; legacy stores '16.04'. Both become '16:04'.
    """
    t = (t or "").strip().replace(".", ":").replace(",", ":")
    parts = t.split(":")
    if len(parts) >= 2:
        return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}"
    return t


# ---------------------------------------------------------------------------
# ERP lookups (all read-only SELECT)
# ---------------------------------------------------------------------------

def load_erp_lookups(conn) -> dict:
    cur = conn.cursor()

    # Fiscal year 2026
    cur.execute(
        "SELECT uuid::text FROM accounting_fiscal_years WHERE year = 2026 LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("No fiscal year for 2026 found in ERP database.")
    fy_uuid = row[0]

    # Journals: code → uuid
    cur.execute("SELECT code, uuid::text FROM accounting_journals")
    journals: dict[str, str] = {r[0]: r[1] for r in cur.fetchall()}

    # Accounts with posting allowed — keyed by first-3-digit prefix
    # (If multiple accounts share a prefix, first encountered wins; warn later)
    cur.execute(
        "SELECT code, uuid::text FROM accounting_accounts "
        "WHERE is_posting_allowed = true ORDER BY code"
    )
    accounts_by_prefix: dict[str, str] = {}
    accounts_by_full_code: dict[str, str] = {}
    for code, uuid in cur.fetchall():
        accounts_by_full_code[code] = uuid
        prefix = code[:3]
        if prefix not in accounts_by_prefix:
            accounts_by_prefix[prefix] = uuid

    # Members: uuid, account_id, ffvp_id (bigint), first_name, last_name
    cur.execute(
        "SELECT uuid::text, account_id, ffvp_id, first_name, last_name FROM members"
    )
    members_by_ffvp: dict[str, dict] = {}
    members_by_name: dict[tuple, dict] = {}
    for uuid, account_id, ffvp_id, first_name, last_name in cur.fetchall():
        m = {
            "uuid": uuid,
            "account_id": account_id,
            "ffvp_id": ffvp_id,
            "first_name": first_name or "",
            "last_name": last_name or "",
        }
        if ffvp_id is not None:
            members_by_ffvp[str(int(ffvp_id))] = m
        key = (_normalize_name(last_name or ""), _normalize_name(first_name or ""))
        members_by_name[key] = m

    # Existing entries already imported (idempotency — three layers):
    # 1. external_id = 'vulcain-N' (entries imported by THIS tool)
    cur.execute(
        "SELECT external_id FROM accounting_entries "
        "WHERE fiscal_year_uuid = %s AND source_system = %s AND external_id IS NOT NULL",
        (fy_uuid, SOURCE_SYSTEM),
    )
    existing_external_ids: set[str] = {r[0] for r in cur.fetchall()}

    # 2. reference = num_écriture (entries imported via UI with reference set)
    cur.execute(
        "SELECT reference FROM accounting_entries "
        "WHERE fiscal_year_uuid = %s AND reference IS NOT NULL",
        (fy_uuid,),
    )
    existing_references: set[str] = {r[0] for r in cur.fetchall()}

    # 3. Content fingerprint (date, journal_code, total_debit, total_credit, line_count)
    #    Catches entries imported via the backend CSV import endpoint (source_system='legacy-accounting-csv')
    #    which have no reference and a hash-based external_id we cannot reproduce.
    cur.execute(
        """
        SELECT ae.entry_date::text,
               aj.code,
               ROUND(COALESCE(SUM(al.debit), 0), 2)::text,
               ROUND(COALESCE(SUM(al.credit), 0), 2)::text,
               COUNT(al.uuid)::text
        FROM accounting_entries ae
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
        LEFT JOIN accounting_lines al
               ON al.entry_uuid = ae.uuid
              AND al.fiscal_year_uuid = ae.fiscal_year_uuid
        WHERE ae.fiscal_year_uuid = %s
        GROUP BY ae.uuid, ae.entry_date, aj.code
        """,
        (fy_uuid,),
    )
    existing_fingerprints: set[tuple] = {
        (r[0], r[1], r[2], r[3], r[4]) for r in cur.fetchall()
    }

    # Validated flights: build two lookup dicts.
    # Primary: (jour, asset_code, pilot_erp_id, takeoff_time_normalized) — precise
    # Fallback: (jour, asset_code, pilot_erp_id) — first match only (legacy behavior)
    cur.execute(
        "SELECT uuid::text, jour::text, asset_code, pilot_erp_id::text, "
        "       accounting_entry_uuid::text, takeoff_time "
        "FROM validated_flights"
    )
    flights_by_key: dict[tuple, dict] = {}        # fallback: (date, ac, pilot)
    flights_by_key_time: dict[tuple, dict] = {}   # precise: (date, ac, pilot, time)
    erp_flights_all: list[dict] = []
    for uuid, jour, asset_code, pilot_erp_id, ae_uuid, takeoff_time in cur.fetchall():
        f = {
            "uuid": uuid,
            "jour": jour,
            "asset_code": asset_code,
            "pilot_erp_id": pilot_erp_id,
            "accounting_entry_uuid": ae_uuid,
            "takeoff_time": takeoff_time or "",
        }
        erp_flights_all.append(f)
        base_key = (jour, asset_code, pilot_erp_id)
        if base_key not in flights_by_key:
            flights_by_key[base_key] = f
        if takeoff_time:
            time_key = (jour, asset_code, pilot_erp_id, _normalize_time(takeoff_time))
            flights_by_key_time[time_key] = f

    # Existing pack consumptions (idempotency): set of (flight_uuid, member_uuid)
    cur.execute(
        "SELECT flight_uuid::text, member_uuid::text FROM member_pack_consumptions"
    )
    existing_consumptions: set[tuple] = {(r[0], r[1]) for r in cur.fetchall()}

    # FL entry gross amounts: entry_uuid → total_credit (for gap report)
    cur.execute(
        """
        SELECT ae.uuid::text, COALESCE(SUM(al.credit), 0)
        FROM accounting_entries ae
        JOIN accounting_lines al
            ON al.entry_uuid = ae.uuid AND al.fiscal_year_uuid = ae.fiscal_year_uuid
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
        WHERE aj.code = 'FL' AND ae.fiscal_year_uuid = %s
        GROUP BY ae.uuid
        """,
        (fy_uuid,),
    )
    fl_entry_gross: dict[str, Decimal] = {
        r[0]: Decimal(str(r[1])) for r in cur.fetchall()
    }

    cur.close()

    return {
        "fy_uuid": fy_uuid,
        "journals": journals,
        "accounts_by_prefix": accounts_by_prefix,
        "accounts_by_full_code": accounts_by_full_code,
        "members_by_ffvp": members_by_ffvp,
        "members_by_name": members_by_name,
        "existing_external_ids": existing_external_ids,
        "existing_references": existing_references,
        "existing_fingerprints": existing_fingerprints,
        "erp_flights_all": erp_flights_all,
        "flights_by_key": flights_by_key,
        "flights_by_key_time": flights_by_key_time,
        "existing_consumptions": existing_consumptions,
        "fl_entry_gross": fl_entry_gross,
    }


# ---------------------------------------------------------------------------
# Member mapping: V_pilotes n → ERP member
# ---------------------------------------------------------------------------

def build_member_map(pilot_rows: list[dict], lookups: dict) -> dict[str, dict | None]:
    """
    Map each pilot row's `n` → ERP member dict (or None if unresolved).
    Resolution order:
      1. ffvp_id (num_FFVV column, numeric)
      2. name (nom + prénom, normalized)
    """
    by_ffvp = lookups["members_by_ffvp"]
    by_name = lookups["members_by_name"]
    mapping: dict[str, dict | None] = {}

    for row in pilot_rows:
        n = (row.get("n") or "").strip()
        if not n:
            continue
        ffvp_raw = (row.get("num_FFVV") or "").strip()
        nom = (row.get("nom") or "").strip()
        prenom = (row.get("prénom") or row.get("prenom") or "").strip()

        member = None

        # Try ffvp_id (must be numeric)
        if ffvp_raw and ffvp_raw.lstrip("0").isdigit():
            member = by_ffvp.get(str(int(ffvp_raw)))

        # Fallback: name
        if member is None:
            key = (_normalize_name(nom), _normalize_name(prenom))
            member = by_name.get(key)

        mapping[n] = member  # may be None — error raised when actually used

    return mapping


def _lookup_flight(date_str: str, aircraft: str, pilot_id: str,
                   takeoff_raw: str, lookups: dict) -> dict | None:
    """Look up an ERP flight, preferring the precise (date+aircraft+pilot+time) key."""
    if takeoff_raw:
        time_key = (date_str, aircraft, pilot_id, _normalize_time(takeoff_raw))
        f = lookups["flights_by_key_time"].get(time_key)
        if f:
            return f
    return lookups["flights_by_key"].get((date_str, aircraft, pilot_id))


def _resolve_member(n_str: str, member_map: dict, context: str) -> dict:
    """Resolve pilot n to ERP member. Raises with context on failure."""
    n = str(n_str).strip()
    if n not in member_map:
        raise RuntimeError(
            f"Pilot n={n!r} referenced in {context} is not in V_pilotes_2026.csv"
        )
    m = member_map[n]
    if m is None:
        raise RuntimeError(
            f"Pilot n={n!r} ({context}) could not be matched to an ERP member "
            f"by ffvp_id or name. Add this member to the ERP first."
        )
    return m


# ---------------------------------------------------------------------------
# Step 1 — Accounting entry import
# ---------------------------------------------------------------------------

def build_accounting_entries(
    accounting_rows: list[dict],
    member_map: dict,
    lookups: dict,
    warnings: list[str],
) -> dict[str, list[dict]]:
    """
    Group accounting rows by num_écriture, skip VVO entries, map to ERP format.
    Returns dict: erp_journal_code → list of entry dicts.
    Skips entries whose external_id already exists in DB (idempotency).
    """
    journals = lookups["journals"]
    accounts = lookups["accounts_by_prefix"]
    fy_uuid = lookups["fy_uuid"]
    existing_ids = lookups["existing_external_ids"]
    existing_refs = lookups["existing_references"]
    existing_fps = lookups["existing_fingerprints"]

    # Detect column names (accents may vary by locale)
    if not accounting_rows:
        return {}
    sample = accounting_rows[0]
    col_num_ecriture = _find_col(sample, ["num_écriture", "num_ecriture", "num_Ã©criture"])
    col_date = _find_col(sample, ["date_de_valeur"])
    col_label = _find_col(sample, ["libellé", "libelle", "libellÃ©"])
    col_compte = _find_col(sample, ["compte"])
    col_debit = _find_col(sample, ["débit", "debit", "dÃ©bit"])
    col_credit = _find_col(sample, ["crédit", "credit", "crÃ©dit"])
    col_journal = _find_col(sample, ["journal"])
    col_num_pilote = _find_col(sample, ["num_pilote"])

    # Group by num_écriture
    groups: dict[str, list[dict]] = {}
    for row in accounting_rows:
        key = (row.get(col_num_ecriture) or "").strip()
        if key:
            groups.setdefault(key, []).append(row)

    entries_by_journal: dict[str, list[dict]] = {}
    stats = {"total": 0, "skipped_vvo": 0, "skipped_existing": 0, "exported": 0, "warnings": 0}

    for num_ecriture, lines in groups.items():
        stats["total"] += 1

        # Skip if any line is VVO (flight journal)
        journals_in_group = {(r.get(col_journal) or "").strip() for r in lines}
        if "VVO" in journals_in_group:
            stats["skipped_vvo"] += 1
            continue

        # Determine target ERP journal (use first line's journal)
        first_journal = next(iter(journals_in_group))
        erp_journal_code = JOURNAL_MAP.get(first_journal)
        if erp_journal_code is None:
            # Unmapped non-VVO journal → OD with warning
            warnings.append(f"Unknown journal {first_journal!r} for num_écriture={num_ecriture}, mapped to OD")
            erp_journal_code = "OD"
            stats["warnings"] += 1

        # Idempotency check — three layers (see load_erp_lookups for details)
        external_id = f"vulcain-{num_ecriture}"

        # Layer 3: content fingerprint — must be computed before processing lines
        # so we can skip early. Use raw amounts from CSV (same precision as DB import).
        try:
            raw_entry_date = _parse_date(lines[0].get(col_date) or "")
        except ValueError:
            raw_entry_date = ""
        raw_total_d = sum(_clean_amount(r.get(col_debit) or "") for r in lines)
        raw_total_c = sum(_clean_amount(r.get(col_credit) or "") for r in lines)
        fingerprint = (
            raw_entry_date,
            erp_journal_code,
            str(raw_total_d.quantize(Decimal("0.01"))),
            str(raw_total_c.quantize(Decimal("0.01"))),
            str(len(lines)),
        )

        if (external_id in existing_ids
                or num_ecriture in existing_refs
                or fingerprint in existing_fps):
            stats["skipped_existing"] += 1
            continue

        journal_uuid = journals.get(erp_journal_code)
        if not journal_uuid:
            warnings.append(
                f"ERP journal {erp_journal_code!r} not found for num_écriture={num_ecriture}, skipped"
            )
            stats["warnings"] += 1
            continue

        # Parse entry date (use first line)
        try:
            entry_date = _parse_date(lines[0].get(col_date) or "")
        except ValueError as e:
            warnings.append(f"num_écriture={num_ecriture}: {e}, skipped")
            stats["warnings"] += 1
            continue

        description = (lines[0].get(col_label) or "").strip()[:255]

        # Build lines
        entry_lines = []
        total_debit = Decimal("0")
        total_credit = Decimal("0")

        for line in lines:
            raw_compte = (line.get(col_compte) or "").strip()
            prefix = raw_compte[:3]

            account_uuid = accounts.get(prefix)
            if not account_uuid:
                warnings.append(
                    f"Account prefix {prefix!r} (full: {raw_compte!r}) not found in ERP "
                    f"for num_écriture={num_ecriture}, line skipped"
                )
                stats["warnings"] += 1
                continue

            debit = _clean_amount(line.get(col_debit) or "")
            credit = _clean_amount(line.get(col_credit) or "")
            total_debit += debit
            total_credit += credit

            tiers_uuid = None
            member_account_id = ""
            if prefix == "411":
                n_pilote = (line.get(col_num_pilote) or "").strip()
                if n_pilote and n_pilote not in ("0", ""):
                    if n_pilote in member_map:
                        m = member_map[n_pilote]
                        if m:
                            tiers_uuid = m["uuid"]
                            member_account_id = m["account_id"] or ""
                        else:
                            warnings.append(
                                f"num_écriture={num_ecriture}: pilot n={n_pilote!r} "
                                f"on 411 account has no ERP match — tiers_uuid left null"
                            )
                            stats["warnings"] += 1
                    else:
                        warnings.append(
                            f"num_écriture={num_ecriture}: pilot n={n_pilote!r} "
                            f"not in V_pilotes_2026.csv — tiers_uuid left null"
                        )
                        stats["warnings"] += 1

            line_dict: dict = {
                "account_uuid": account_uuid,
                "debit": str(debit.quantize(Decimal("0.0001"))),
                "credit": str(credit.quantize(Decimal("0.0001"))),
                "description": (line.get(col_label) or "").strip()[:255],
                # Underscore-prefixed: used for CSV output, stripped before JSON
                "_account_code": prefix,
                "_member_account_id": member_account_id,
            }
            if tiers_uuid:
                line_dict["tiers_uuid"] = tiers_uuid

            entry_lines.append(line_dict)

        if not entry_lines:
            warnings.append(f"num_écriture={num_ecriture}: all lines skipped, entry omitted")
            stats["warnings"] += 1
            continue

        # Balance check
        diff = abs(total_debit - total_credit)
        if diff > Decimal("0.01"):
            warnings.append(
                f"num_écriture={num_ecriture}: unbalanced entry "
                f"(debit={total_debit}, credit={total_credit}, diff={diff})"
            )
            stats["warnings"] += 1

        # Strip internal-only fields before storing in the JSON-destined structure
        json_lines = [{k: v for k, v in l.items() if not k.startswith("_")} for l in entry_lines]
        entry = {
            "fiscal_year_uuid": fy_uuid,
            "journal_uuid": journal_uuid,
            "entry_date": entry_date,
            "description": description,
            "reference": num_ecriture,
            "source_system": SOURCE_SYSTEM,
            "external_id": external_id,
            "import_batch_id": IMPORT_BATCH_ID,
            "lines": json_lines,
            # Keep full lines (with _account_code / _member_account_id) for CSV output
            "_lines_full": entry_lines,
        }
        entries_by_journal.setdefault(erp_journal_code, []).append(entry)
        stats["exported"] += 1

    # Attach stats for summary
    entries_by_journal["__stats__"] = stats
    return entries_by_journal


# ---------------------------------------------------------------------------
# Step 2 — Pack25 consumption records
# ---------------------------------------------------------------------------

def build_pack_consumptions(
    flight_rows: list[dict],
    member_map: dict,
    lookups: dict,
    warnings: list[str],
) -> tuple[list[dict], list[dict], dict]:
    """
    Scan flights for pack25 reductions. Produce MemberPackConsumption records.
    Returns (consumptions, unmatched_rows).
    Raises on unresolved members.
    """
    existing = lookups["existing_consumptions"]

    if not flight_rows:
        return [], []

    sample = flight_rows[0]
    col_n = _find_col(sample, ["n"])
    col_date = _find_col(sample, ["date_valeur"])
    col_aircraft = _find_col(sample, ["appareil"])
    col_pilot_red = _find_col(sample, ["pilote_reduction_total"])
    col_copilot_red = _find_col(sample, ["copilote_reduction_total"])
    col_prix_vol = _find_col(sample, ["prix_vol"])
    col_n_pilote = _find_col(sample, ["n_pilote"])
    col_n_copilote = _find_col(sample, ["n_copilote"])
    col_temps_vol = _find_col(sample, ["temps_de_vol"])
    col_nbre_treuil = _find_col(sample, ["nbre_treuill"])  # nbre_treuillée_U
    col_takeoff = _find_col(sample, ["heure_décollage", "heure_decollage"])

    consumptions: list[dict] = []
    unmatched: list[dict] = []
    stats = {
        "flights_with_reduction": 0,
        "matched": 0,
        "skipped_existing": 0,
        "unmatched_erp": 0,
        "duplicate_key_warned": 0,
    }

    for row in flight_rows:
        pilot_red = _clean_amount(row.get(col_pilot_red) or "")
        copilot_red = _clean_amount(row.get(col_copilot_red) or "")

        if pilot_red <= 0 and copilot_red <= 0:
            continue

        stats["flights_with_reduction"] += 1
        n_str = (row.get(col_n) or "").strip()
        date_str = _parse_date(row.get(col_date) or "")
        aircraft = (row.get(col_aircraft) or "").strip()
        n_pilote = (row.get(col_n_pilote) or "").strip()
        n_copilote = (row.get(col_n_copilote) or "").strip()
        temps_vol_min = _clean_amount(row.get(col_temps_vol) or "")
        nbre_treuil = _clean_amount(row.get(col_nbre_treuil) or "")
        takeoff_raw = (row.get(col_takeoff) or "").strip()

        # Process pilot reduction
        if pilot_red > 0 and n_pilote and n_pilote != "0":
            pilot_member = _resolve_member(n_pilote, member_map, f"flight n={n_str} pilot")
            pilot_uuid = pilot_member["uuid"]
            pilot_member_id = pilot_member["account_id"]  # validated_flights.pilot_erp_id is member_id

            erp_flight = _lookup_flight(date_str, aircraft, pilot_member_id, takeoff_raw, lookups)
            if erp_flight is None:
                stats["unmatched_erp"] += 1
                unmatched.append({
                    "vulcain_n": n_str,
                    "date": date_str,
                    "aircraft": aircraft,
                    "n_pilote": n_pilote,
                    "pilot_erp_id": pilot_member_id,
                    "reduction": str(pilot_red),
                    "role": "pilot",
                })
                warnings.append(
                    f"Pack25 flight n={n_str} ({date_str}, {aircraft}, pilot={n_pilote}): "
                    f"no matching ERP flight found"
                )
            else:
                flight_uuid = erp_flight["uuid"]
                if (flight_uuid, pilot_uuid) in existing:
                    stats["skipped_existing"] += 1
                else:
                    qty = (temps_vol_min / Decimal("60")).quantize(
                        Decimal("0.0001"), rounding=ROUND_HALF_UP
                    )
                    consumptions.append({
                        "member_uuid": pilot_uuid,
                        "flight_uuid": flight_uuid,
                        "pack_type": "flight_hours",
                        "quantity_consumed": str(qty),
                        "total_discount_amount": str(pilot_red.quantize(Decimal("0.0001"))),
                        "valid_from": date_str,
                        "_vulcain_n": n_str,
                        "_aircraft": aircraft,
                    })
                    stats["matched"] += 1

        # Process copilot reduction
        if copilot_red > 0 and n_copilote and n_copilote != "0":
            copilot_member = _resolve_member(n_copilote, member_map, f"flight n={n_str} copilot")
            copilot_uuid = copilot_member["uuid"]
            copilot_member_id = copilot_member["account_id"]  # validated_flights.pilot_erp_id is member_id

            erp_flight = _lookup_flight(date_str, aircraft, copilot_member_id, takeoff_raw, lookups)
            if erp_flight is None:
                # Also try matching as pilot (copilot billed as pilot on that flight)
                stats["unmatched_erp"] += 1
                unmatched.append({
                    "vulcain_n": n_str,
                    "date": date_str,
                    "aircraft": aircraft,
                    "n_pilote": n_copilote,
                    "pilot_erp_id": copilot_member_id,
                    "reduction": str(copilot_red),
                    "role": "copilot",
                })
                warnings.append(
                    f"Pack25 flight n={n_str} ({date_str}, {aircraft}, copilot={n_copilote}): "
                    f"no matching ERP flight found"
                )
            else:
                flight_uuid = erp_flight["uuid"]
                if (flight_uuid, copilot_uuid) in existing:
                    stats["skipped_existing"] += 1
                else:
                    qty = (temps_vol_min / Decimal("60")).quantize(
                        Decimal("0.0001"), rounding=ROUND_HALF_UP
                    )
                    consumptions.append({
                        "member_uuid": copilot_uuid,
                        "flight_uuid": flight_uuid,
                        "pack_type": "flight_hours",
                        "quantity_consumed": str(qty),
                        "total_discount_amount": str(copilot_red.quantize(Decimal("0.0001"))),
                        "valid_from": date_str,
                        "_vulcain_n": n_str,
                        "_aircraft": aircraft,
                    })
                    stats["matched"] += 1

    consumptions_clean = [{k: v for k, v in c.items() if not k.startswith("_")} for c in consumptions]
    return consumptions_clean, unmatched, stats


# ---------------------------------------------------------------------------
# Step 3 — Flight gap report
# ---------------------------------------------------------------------------

def build_gap_report(
    flight_rows: list[dict],
    member_map: dict,
    lookups: dict,
    warnings: list[str],
) -> list[dict]:
    """
    Compare legacy flights vs ERP validated_flights.
    Returns list of report rows.
    """
    flights_by_key = lookups["flights_by_key"]
    erp_flights_all = lookups["erp_flights_all"]
    fl_entry_gross = lookups["fl_entry_gross"]

    if not flight_rows:
        return []

    sample = flight_rows[0]
    col_n = _find_col(sample, ["n"])
    col_date = _find_col(sample, ["date_valeur"])
    col_aircraft = _find_col(sample, ["appareil"])
    col_n_pilote = _find_col(sample, ["n_pilote"])
    col_n_copilote = _find_col(sample, ["n_copilote"])
    col_prix_vol = _find_col(sample, ["prix_vol"])
    col_prix_reduction = _find_col(sample, ["prix_vol_réduction", "prix_vol_reduction"])
    col_takeoff = _find_col(sample, ["heure_décollage", "heure_decollage"])
    col_landing = _find_col(sample, ["heure_atterrissage", "heure_atterissage"])
    col_temps = _find_col(sample, ["temps_de_vol"])
    col_type = _find_col(sample, ["type_de_vol"])
    col_remorqueur = _find_col(sample, ["appareil_remorq"])  # appareil_remorqueur
    col_treuil = _find_col(sample, ["treuill"])              # treuillée

    matched_erp_uuids: set[str] = set()
    report: list[dict] = []
    missing_rows: list[dict] = []   # MISSING_FROM_ERP with full legacy detail
    price_gap_rows: list[dict] = [] # MATCHED + billed + price_diff != 0

    stats = {
        "legacy_total": 0,
        "matched": 0,
        "multi_matched": 0,
        "matched_billed": 0,
        "matched_unbilled": 0,
        "price_match": 0,
        "price_mismatch": 0,
        "missing_from_erp": 0,
        "missing_from_legacy": 0,
    }

    for row in flight_rows:
        stats["legacy_total"] += 1
        n_str = (row.get(col_n) or "").strip()
        date_str = _parse_date(row.get(col_date) or "")
        aircraft = (row.get(col_aircraft) or "").strip()
        n_pilote = (row.get(col_n_pilote) or "").strip()
        n_copilote = (row.get(col_n_copilote) or "").strip()
        prix_paid = _clean_amount(row.get(col_prix_vol) or "")              # prix_vol = net (after pack discount)
        prix_reduction = _clean_amount(row.get(col_prix_reduction) or "")  # prix_vol_réduction = pack discount
        prix_gross = prix_paid + prix_reduction                             # gross = net + discount, compared to erp_gross
        takeoff_raw = (row.get(col_takeoff) or "").strip()
        landing_raw = (row.get(col_landing) or "").strip()
        temps = (row.get(col_temps) or "").strip()
        type_vol = (row.get(col_type) or "").strip()
        remorqueur = (row.get(col_remorqueur) or "").strip()
        treuil = (row.get(col_treuil) or "").strip()

        pilot_erp_id = ""
        pilot_name = ""
        if n_pilote and n_pilote != "0":
            m = member_map.get(n_pilote)
            if m:
                pilot_erp_id = m["account_id"]
                pilot_name = f"{m.get('last_name','')} {m.get('first_name','')}".strip()

        erp_flight = None
        if pilot_erp_id:
            erp_flight = _lookup_flight(date_str, aircraft, pilot_erp_id, takeoff_raw, lookups)

        if erp_flight:
            already_matched = erp_flight["uuid"] in matched_erp_uuids
            if already_matched:
                stats["multi_matched"] += 1
            else:
                stats["matched"] += 1
            matched_erp_uuids.add(erp_flight["uuid"])
            ae_uuid = erp_flight.get("accounting_entry_uuid") or ""
            erp_gross = fl_entry_gross.get(ae_uuid, Decimal("0")) if ae_uuid else Decimal("0")
            is_billed = bool(ae_uuid) and erp_gross > 0
            if is_billed:
                stats["matched_billed"] += 1
            else:
                stats["matched_unbilled"] += 1
            price_diff = erp_gross - prix_gross if is_billed else Decimal("0")

            if is_billed:
                if abs(price_diff) <= Decimal("0.05"):
                    stats["price_match"] += 1
                else:
                    stats["price_mismatch"] += 1
                    price_gap_rows.append({
                        "vulcain_n": n_str,
                        "date": date_str,
                        "aircraft": aircraft,
                        "pilot_legacy_id": n_pilote,
                        "pilot_erp_id": pilot_erp_id,
                        "pilot_name": pilot_name,
                        "takeoff": _normalize_time(takeoff_raw),
                        "landing": _normalize_time(landing_raw),
                        "duration_min": temps,
                        "vulcain_gross": str(prix_gross.quantize(Decimal("0.01"))),
                        "erp_gross": str(erp_gross.quantize(Decimal("0.01"))),
                        "price_diff": str(price_diff.quantize(Decimal("0.01"))),
                        "erp_flight_uuid": erp_flight["uuid"],
                        "erp_entry_uuid": ae_uuid,
                    })

            report.append({
                "vulcain_n": n_str,
                "date": date_str,
                "aircraft": aircraft,
                "pilot_legacy_id": n_pilote,
                "pilot_erp_id": pilot_erp_id,
                "status": "MATCHED",
                "vulcain_gross": str(prix_gross.quantize(Decimal("0.01"))),
                "erp_gross": str(erp_gross.quantize(Decimal("0.01"))) if is_billed else "",
                "price_diff": str(price_diff.quantize(Decimal("0.01"))) if is_billed else "",
                "erp_flight_uuid": erp_flight["uuid"],
                "erp_entry_uuid": ae_uuid,
            })
        else:
            stats["missing_from_erp"] += 1
            report.append({
                "vulcain_n": n_str,
                "date": date_str,
                "aircraft": aircraft,
                "pilot_legacy_id": n_pilote,
                "pilot_erp_id": pilot_erp_id,
                "status": "MISSING_FROM_ERP",
                "vulcain_gross": str(prix_gross.quantize(Decimal("0.01"))),
                "erp_gross": "",
                "price_diff": "",
                "erp_flight_uuid": "",
                "erp_entry_uuid": "",
            })
            missing_rows.append({
                "vulcain_n": n_str,
                "date": date_str,
                "aircraft": aircraft,
                "pilot_legacy_id": n_pilote,
                "pilot_erp_id": pilot_erp_id,
                "pilot_name": pilot_name,
                "copilot_legacy_id": n_copilote,
                "takeoff": _normalize_time(takeoff_raw),
                "landing": _normalize_time(landing_raw),
                "duration_min": temps,
                "type_de_vol": type_vol,
                "remorqueur": remorqueur,
                "treuillée": treuil,
                "vulcain_gross": str(prix_gross.quantize(Decimal("0.01"))),
            })

    # ERP flights not matched to any legacy row
    for f in erp_flights_all:
        if f["uuid"] not in matched_erp_uuids:
            stats["missing_from_legacy"] += 1
            report.append({
                "vulcain_n": "",
                "date": f["jour"],
                "aircraft": f["asset_code"] or "",
                "pilot_legacy_id": "",
                "pilot_erp_id": f["pilot_erp_id"] or "",
                "status": "MISSING_FROM_LEGACY",
                "vulcain_gross": "",
                "erp_gross": "",
                "price_diff": "",
                "erp_flight_uuid": f["uuid"],
                "erp_entry_uuid": f.get("accounting_entry_uuid") or "",
            })

    report.append({"__stats__": stats})
    return report, missing_rows, price_gap_rows


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def _find_col(row: dict, candidates: list[str]) -> str:
    """Find first matching column name from candidates (also tries lowercased keys)."""
    keys = list(row.keys())
    for c in candidates:
        if c in keys:
            return c
        # Try normalized (accent-stripped, lowercase)
        norm = _normalize_name(c)
        for k in keys:
            if _normalize_name(k) == norm or (len(c) >= 8 and k.startswith(c[:8])):
                return k
    # Last resort: return first candidate as-is (will produce empty values with warning)
    return candidates[0]


def write_outputs(
    entries_by_journal: dict,
    consumptions: list[dict],
    unmatched: list[dict],
    gap_report: list[dict],
    missing_flights: list[dict],
    price_gap: list[dict],
    member_map: dict,
    pilot_rows: list[dict],
    warnings: list[str],
) -> dict:
    """Write all output files. Returns summary stats."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    acc_stats = entries_by_journal.pop("__stats__", {})
    pack_stats = {}
    gap_stats = {}

    # Pull pack stats from consumptions list (stored as last element if dict)
    if consumptions and isinstance(consumptions[-1], dict) and "flights_with_reduction" in consumptions[-1]:
        pack_stats = consumptions.pop()
    # Same for gap report
    if gap_report and isinstance(gap_report[-1], dict) and "__stats__" in gap_report[-1]:
        gap_stats = gap_report.pop()["__stats__"]

    # 1a. Accounting entry CSV files per journal (backend CSV import format)
    CSV_COLS = ["num_ecriture", "date", "journal", "label", "account_code",
                "member_account_id", "debit", "credit"]
    for journal_code, entries in entries_by_journal.items():
        csv_path = OUTPUT_DIR / f"import_entries_{journal_code}.csv"
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=CSV_COLS)
            w.writeheader()
            for entry in entries:
                for line in entry.get("_lines_full", []):
                    w.writerow({
                        "num_ecriture": entry.get("reference", ""),
                        "date": entry.get("entry_date", ""),
                        "journal": journal_code,
                        "label": line.get("description", ""),
                        "account_code": line.get("_account_code", ""),
                        "member_account_id": line.get("_member_account_id", ""),
                        "debit": line.get("debit", "0.0000"),
                        "credit": line.get("credit", "0.0000"),
                    })
        print(f"  Written CSV import file   → {csv_path.name}")

    # 1b. Accounting entry JSON files per journal (strip internal _* keys)
    total_entries = 0
    for journal_code, entries in entries_by_journal.items():
        clean_entries = [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]
        path = OUTPUT_DIR / f"import_entries_{journal_code}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(clean_entries, f, ensure_ascii=False, indent=2)
        total_entries += len(entries)
        print(f"  Written {len(entries):>5} entries → {path.name}")

    # 2. Pack consumptions JSON
    pack_path = OUTPUT_DIR / "pack_consumptions.json"
    with open(pack_path, "w", encoding="utf-8") as f:
        json.dump(consumptions, f, ensure_ascii=False, indent=2)
    print(f"  Written {len(consumptions):>5} pack consumptions → {pack_path.name}")

    # 3. Pack unmatched CSV
    unmatched_path = OUTPUT_DIR / "pack_unmatched.csv"
    if unmatched:
        with open(unmatched_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["vulcain_n", "date", "aircraft", "n_pilote", "pilot_erp_id", "reduction", "role"])
            w.writeheader()
            w.writerows(unmatched)
    else:
        unmatched_path.write_text("vulcain_n,date,aircraft,n_pilote,pilot_erp_id,reduction,role\n", encoding="utf-8")
    print(f"  Written {len(unmatched):>5} unmatched pack flights → {unmatched_path.name}")

    # 4. Gap report CSV
    gap_cols = ["vulcain_n", "date", "aircraft", "pilot_legacy_id", "pilot_erp_id",
                "status", "vulcain_gross", "erp_gross", "price_diff",
                "erp_flight_uuid", "erp_entry_uuid"]
    gap_path = OUTPUT_DIR / "gap_report_flights.csv"
    with open(gap_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=gap_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(gap_report)
    print(f"  Written {len(gap_report):>5} flight gap rows → {gap_path.name}")

    # 4b. Missing flights CSV (MISSING_FROM_ERP with full legacy detail)
    missing_cols = ["vulcain_n", "date", "aircraft", "pilot_legacy_id", "pilot_erp_id",
                    "pilot_name", "copilot_legacy_id", "takeoff", "landing", "duration_min",
                    "type_de_vol", "remorqueur", "treuillée", "vulcain_gross"]
    missing_path = OUTPUT_DIR / "missing_flights.csv"
    with open(missing_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=missing_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(missing_flights)
    print(f"  Written {len(missing_flights):>5} missing flights  → {missing_path.name}")

    # 4c. Price mismatch CSV (MATCHED + billed + price_diff != 0)
    price_cols = ["vulcain_n", "date", "aircraft", "pilot_legacy_id", "pilot_erp_id",
                  "pilot_name", "takeoff", "landing", "duration_min",
                  "vulcain_gross", "erp_gross", "price_diff",
                  "erp_flight_uuid", "erp_entry_uuid"]
    price_path = OUTPUT_DIR / "price_mismatches.csv"
    with open(price_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=price_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(price_gap)
    print(f"  Written {len(price_gap):>5} price mismatches  → {price_path.name}")

    # 5. Member mapping CSV
    mapping_path = OUTPUT_DIR / "member_mapping.csv"
    pilot_index = {(r.get("n") or "").strip(): r for r in pilot_rows}
    with open(mapping_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["n_pilote", "nom", "prénom", "num_FFVV", "erp_uuid", "erp_account_id", "resolved"])
        for n, m in sorted(member_map.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 0):
            pr = pilot_index.get(n, {})
            nom = pr.get("nom", "")
            prenom = pr.get("prénom") or pr.get("prenom", "")
            ffvp = pr.get("num_FFVV", "")
            w.writerow([
                n, nom, prenom, ffvp,
                m["uuid"] if m else "",
                m["account_id"] if m else "",
                "YES" if m else "NO",
            ])
    print(f"  Written member mapping ({len(member_map)} pilots) → {mapping_path.name}")

    # 6. Warnings file
    if warnings:
        warn_path = OUTPUT_DIR / "import_warnings.txt"
        with open(warn_path, "w", encoding="utf-8") as f:
            for w_line in warnings:
                f.write(w_line + "\n")
        print(f"  Written {len(warnings)} warnings → {warn_path.name}")

    # 7. Summary
    summary_lines = [
        "=== Vulcain Legacy Import Summary ===",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "--- Accounting Entries ---",
        f"  Total num_écriture groups:   {acc_stats.get('total', 0)}",
        f"  Skipped (VVO/flight):        {acc_stats.get('skipped_vvo', 0)}",
        f"  Skipped (already in ERP):    {acc_stats.get('skipped_existing', 0)}",
        f"  Exported:                    {total_entries}",
        f"  Journals: {', '.join(entries_by_journal.keys())}",
        "",
        "--- Pack25 Consumptions ---",
        f"  Flights with reduction:      {pack_stats.get('flights_with_reduction', 0)}",
        f"  Matched to ERP flights:      {pack_stats.get('matched', 0)}",
        f"  Skipped (already in ERP):   {pack_stats.get('skipped_existing', 0)}",
        f"  No ERP match (unmatched):    {pack_stats.get('unmatched_erp', 0)}",
        "",
        "--- Flight Gap Report ---",
        f"  Legacy flights total:        {gap_stats.get('legacy_total', 0)}",
        f"  Matched (unique ERP):        {gap_stats.get('matched', 0)}",
        f"  Multi-match (same ERP):      {gap_stats.get('multi_matched', 0)}",
        f"  Missing from ERP:            {gap_stats.get('missing_from_erp', 0)}",
        f"  ERP-only (not in Vulcain):   {gap_stats.get('missing_from_legacy', 0)}",
        f"  Check (matched+ERP-only):    {gap_stats.get('matched', 0) + gap_stats.get('missing_from_legacy', 0)} (should = total ERP flights)",
        "",
        "--- Price Comparison (matched + billed) ---",
        f"  Billed in ERP:               {gap_stats.get('matched_billed', 0)}",
        f"  Not billed in ERP:           {gap_stats.get('matched_unbilled', 0)}",
        f"  Price matches (≤0.05 diff):  {gap_stats.get('price_match', 0)}",
        f"  Price mismatches:            {gap_stats.get('price_mismatch', 0)}",
        "",
        f"--- Warnings: {len(warnings)} ---",
    ]
    summary_path = OUTPUT_DIR / "import_summary.txt"
    summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")
    print(f"  Written summary → {summary_path.name}")

    return {
        "acc_exported": total_entries,
        "acc_skipped_vvo": acc_stats.get("skipped_vvo", 0),
        "acc_skipped_existing": acc_stats.get("skipped_existing", 0),
        "pack_matched": pack_stats.get("matched", 0),
        "pack_unmatched": pack_stats.get("unmatched_erp", 0),
        "gap_matched": gap_stats.get("matched", 0),
        "gap_missing_erp": gap_stats.get("missing_from_erp", 0),
        "gap_missing_legacy": gap_stats.get("missing_from_legacy", 0),
        "warnings": len(warnings),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    dry_run = "--dry-run" in sys.argv

    print("=== Vulcain Legacy Import Tool ===")
    print(f"  Legacy data: {LEGACY_DIR}")
    print(f"  Output:      {OUTPUT_DIR}")
    if dry_run:
        print("  [DRY RUN — no files written]")
    print()

    # Connect
    print("Connecting to ERP database…")
    conn = _connect()
    print("  Connected.")

    # Load ERP lookups
    print("Loading ERP lookups…")
    lookups = load_erp_lookups(conn)
    print(
        f"  FY={lookups['fy_uuid'][:8]}…  "
        f"{len(lookups['journals'])} journals  "
        f"{len(lookups['accounts_by_prefix'])} account prefixes  "
        f"{len(lookups['members_by_ffvp'])} members (by ffvp)  "
        f"{len(lookups['erp_flights_all'])} flights"
    )

    # Load legacy CSVs
    print("Loading legacy CSVs…")
    accounting_rows = _read_csv(LEGACY_DIR / "V_comptabilité_validée_2026.csv")
    flight_rows = _read_csv(LEGACY_DIR / "V_vols_validés_2026.csv")
    pilot_rows = _read_csv(LEGACY_DIR / "V_pilotes_2026.csv")
    print(
        f"  {len(accounting_rows)} accounting lines  "
        f"| {len(flight_rows)} flights  "
        f"| {len(pilot_rows)} pilots"
    )

    conn.close()

    # Build member map
    print("Building member map…")
    warnings: list[str] = []
    member_map = build_member_map(pilot_rows, lookups)
    unresolved = [n for n, m in member_map.items() if m is None]
    print(f"  {len(member_map) - len(unresolved)}/{len(member_map)} pilots resolved")
    if unresolved:
        print(f"  WARNING: {len(unresolved)} pilots unresolved: {unresolved[:10]}{'…' if len(unresolved) > 10 else ''}")

    # Step 1: Accounting entries
    print("\nStep 1 — Accounting entries (non-flight)…")
    entries_by_journal = build_accounting_entries(accounting_rows, member_map, lookups, warnings)

    # Step 2: Pack25 consumptions
    print("Step 2 — Pack25 consumptions…")
    result = build_pack_consumptions(flight_rows, member_map, lookups, warnings)
    consumptions, unmatched, pack_stats = result[0], result[1], result[2]
    # Re-attach pack_stats at end of consumptions list for write_outputs
    consumptions_with_stats = consumptions + [pack_stats]  # type: ignore[operator]

    # Step 3: Gap report
    print("Step 3 — Flight gap report…")
    gap_report, missing_flights, price_gap = build_gap_report(flight_rows, member_map, lookups, warnings)

    if dry_run:
        print("\n[DRY RUN] No files written. Remove --dry-run to generate output.")
        print(f"  Warnings: {len(warnings)}")
        for w in warnings[:20]:
            print(f"    {w}")
        return

    # Write outputs
    print("\nWriting outputs…")
    summary = write_outputs(
        entries_by_journal,
        consumptions_with_stats,
        unmatched,
        gap_report,
        missing_flights,
        price_gap,
        member_map,
        pilot_rows,
        warnings,
    )

    print()
    print("Done.")
    print(f"  Accounting entries exported: {summary['acc_exported']}")
    print(f"  Pack consumptions matched:   {summary['pack_matched']}")
    print(f"  Flights matched:             {summary['gap_matched']}")
    print(f"  Warnings:                    {summary['warnings']}")
    print(f"\nReview {OUTPUT_DIR}/import_summary.txt before importing.")


if __name__ == "__main__":
    main()
