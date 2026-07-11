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
    "AC":  "AC",
    "BQ":  "BQ",
    "CA":  "CS",   # CA journal retired (merged into CS, see merge_journals.py)
    "EXP": "OD",
    "INV": "OD",
    "MEM": "OD",
    "ORG": "OD",
    "PER": "OD",
}

# Account prefixes considered flight-related (used as extra guard)
FLIGHT_ACCOUNT_PREFIXES = ("7061", "7062", "7063", "7064")

# Shared account mapping file (also used by check_account.py)
MAPPING_FILE = OUTPUT_DIR / "account_mapping.json"

_MAPPING_NOTE = (
    "Shared account mapping file — used by import_legacy.py (--import-mapping) "
    "and check_account.py (--account-file). "
    "Each entry maps a Vulcain code to an ERP account. "
    "Fields: vulcain_code (required), erp_code (override auto-matching; null = exclude), "
    "asset_code (import_legacy only: ERP asset code to attach as tiers_uuid), "
    "vulcain_label / vulcain_side / erp_name (informational, set by check_account export), "
    "count (set by import_legacy export), note (free text)."
)


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


def _to_dmy(iso_date: str) -> str:
    """YYYY-MM-DD → DD/MM/YYYY for CSV output."""
    try:
        return datetime.strptime(iso_date, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return iso_date


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
    accounts_code_by_uuid: dict[str, str] = {}
    for code, uuid in cur.fetchall():
        accounts_by_full_code[code] = uuid
        accounts_code_by_uuid[uuid] = code
        prefix = code[:3]
        if prefix not in accounts_by_prefix:
            accounts_by_prefix[prefix] = uuid

    # Fallback members for 411 lines: EXT-0000 (legacy pilot n=1), EXT-0002 (collective labels)
    cur.execute(
        "SELECT uuid::text, account_id FROM members WHERE account_id IN ('EXT-0000', 'EXT-0002')"
    )
    _ext_members: dict[str, dict] = {}
    for _uuid, _aid in cur.fetchall():
        _ext_members[_aid] = {"uuid": _uuid, "account_id": _aid}
    member_ext_0000 = _ext_members.get("EXT-0000")
    member_ext_0002 = _ext_members.get("EXT-0002")

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

    # 3. Content fingerprint (date, journal_code, sorted per-line (account_code, debit, credit))
    #    Catches entries imported via the backend CSV import endpoint (source_system='legacy-accounting-csv')
    #    which have no reference and a hash-based external_id we cannot reproduce.
    #    Per-line account codes (not just aggregate totals) are required: two unrelated
    #    entries can share the same date/journal/total/line-count by coincidence
    #    (e.g. two distinct 171.20€ two-line entries on different accounts) — matching
    #    on aggregate totals alone produces false-positive "already imported" skips.
    cur.execute(
        """
        SELECT ae.uuid::text,
               ae.entry_date::text,
               aj.code,
               aa.code,
               al.debit,
               al.credit
        FROM accounting_entries ae
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
        LEFT JOIN accounting_lines al
               ON al.entry_uuid = ae.uuid
              AND al.fiscal_year_uuid = ae.fiscal_year_uuid
        LEFT JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        WHERE ae.fiscal_year_uuid = %s
        """,
        (fy_uuid,),
    )
    _fp_entries: dict[tuple, list[tuple]] = {}
    for entry_uuid, entry_date, journal_code, acc_code, debit, credit in cur.fetchall():
        key = (entry_uuid, entry_date, journal_code)
        if acc_code is None and debit is None and credit is None:
            _fp_entries.setdefault(key, [])
            continue
        _fp_entries.setdefault(key, []).append((
            acc_code or "",
            str(Decimal(str(debit or 0)).quantize(Decimal("0.01"))),
            str(Decimal(str(credit or 0)).quantize(Decimal("0.01"))),
        ))
    existing_fingerprints: set[tuple] = {
        (entry_date, journal_code, tuple(sorted(line_list)))
        for (_entry_uuid, entry_date, journal_code), line_list in _fp_entries.items()
    }

    # Validated flights: build two lookup dicts.
    # Primary: (jour, asset_code, pilot_erp_id, takeoff_time_normalized) — precise
    # Fallback: (jour, asset_code, pilot_erp_id) — first match only (legacy behavior)
    cur.execute(
        "SELECT uuid::text, jour::text, asset_code, pilot_erp_id::text, "
        "       accounting_entry_uuid::text, takeoff_time, type_of_flight "
        "FROM validated_flights"
    )
    flights_by_key: dict[tuple, dict] = {}        # fallback: (date, ac, pilot)
    flights_by_key_time: dict[tuple, dict] = {}   # precise: (date, ac, pilot, time)
    erp_flights_all: list[dict] = []
    for uuid, jour, asset_code, pilot_erp_id, ae_uuid, takeoff_time, type_of_flight in cur.fetchall():
        f = {
            "uuid": uuid,
            "jour": jour,
            "asset_code": asset_code,
            "pilot_erp_id": pilot_erp_id,
            "accounting_entry_uuid": ae_uuid,
            "takeoff_time": takeoff_time or "",
            "type_of_flight": type_of_flight,  # 2 = initiation
        }
        erp_flights_all.append(f)
        base_key = (jour, asset_code, pilot_erp_id)
        if base_key not in flights_by_key:
            flights_by_key[base_key] = f
        if takeoff_time:
            time_key = (jour, asset_code, pilot_erp_id, _normalize_time(takeoff_time))
            flights_by_key_time[time_key] = f

    # Existing pack consumptions (idempotency): set of (flight_uuid, tiers_uuid)
    cur.execute(
        "SELECT flight_uuid::text, tiers_uuid::text FROM member_pack_consumptions"
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

    # FL journal lines by account code: code → {debit, credit} (for summary report)
    cur.execute(
        """
        SELECT aa.code,
               COALESCE(SUM(al.debit), 0),
               COALESCE(SUM(al.credit), 0)
        FROM accounting_entries ae
        JOIN accounting_lines al
            ON al.entry_uuid = ae.uuid AND al.fiscal_year_uuid = ae.fiscal_year_uuid
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        WHERE aj.code = 'FL' AND ae.fiscal_year_uuid = %s
        GROUP BY aa.code
        ORDER BY aa.code
        """,
        (fy_uuid,),
    )
    fl_by_account: dict[str, dict] = {
        r[0]: {"debit": Decimal(str(r[1])), "credit": Decimal(str(r[2]))}
        for r in cur.fetchall()
    }

    # Assets: code → uuid (for account mapping asset_code resolution)
    cur.execute("SELECT code, uuid::text FROM assets")
    assets_by_code: dict[str, str] = {r[0]: r[1] for r in cur.fetchall()}

    cur.close()

    return {
        "fy_uuid": fy_uuid,
        "journals": journals,
        "accounts_by_prefix": accounts_by_prefix,
        "accounts_by_full_code": accounts_by_full_code,
        "accounts_code_by_uuid": accounts_code_by_uuid,
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
        "fl_by_account": fl_by_account,
        "member_ext_0000": member_ext_0000,
        "member_ext_0002": member_ext_0002,
        "assets_by_code": assets_by_code,
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

def _resolve_fp_account_code(raw_compte: str, account_mapping: dict | None, lookups: dict) -> str:
    """
    Resolve a legacy account code to the same ERP account code the main
    resolution loop below would produce, for fingerprint purposes only
    (no warnings emitted here — the main loop re-resolves and warns).
    """
    prefix = raw_compte[:3]
    if account_mapping and raw_compte in account_mapping:
        erp_code = (account_mapping[raw_compte].get("erp_code") or "").strip() or prefix
        account_uuid = (
            lookups["accounts_by_full_code"].get(erp_code)
            or lookups["accounts_by_prefix"].get(erp_code[:3])
        )
    else:
        account_uuid = lookups["accounts_by_prefix"].get(prefix)
    return lookups["accounts_code_by_uuid"].get(account_uuid, prefix)


def resolve_bank_cash_journal_override(
    lines: list[dict], col_compte: str, col_debit: str, col_credit: str,
    account_mapping: dict | None, lookups: dict,
) -> str | None:
    """
    Bank/cash rule (mirrors tools/fix_bank_cash_journals.py's
    classify_target_journal(), which applies the same rule to entries already
    in the ERP): a 512 (Banque) line belongs on BQ if it's a net DEBIT (money
    coming in), or on AC if it's a net CREDIT (money going out — paying a
    supplier by bank transfer). A 531 (Caisse) line follows the same pattern,
    with CS instead of BQ for the debit side.

    Returns None when both 512 and 531 are present (ambiguous, e.g. an
    internal transfer between bank and cash) or when the relevant account's
    net is exactly zero (offsetting lines within the same entry) — caller
    should keep whatever journal it already had in mind.
    """
    net_512 = Decimal("0")
    net_531 = Decimal("0")
    has_512 = False
    has_531 = False
    for r in lines:
        raw_compte = (r.get(col_compte) or "").strip()
        if not raw_compte:
            continue
        code = _resolve_fp_account_code(raw_compte, account_mapping, lookups)
        if code not in ("512", "531"):
            continue
        net = _clean_amount(r.get(col_debit) or "") - _clean_amount(r.get(col_credit) or "")
        if code == "512":
            has_512 = True
            net_512 += net
        else:
            has_531 = True
            net_531 += net

    if has_512 and has_531:
        return None
    if has_512:
        if net_512 > 0:
            return "BQ"
        if net_512 < 0:
            return "AC"
        return None
    if has_531:
        if net_531 > 0:
            return "CS"
        if net_531 < 0:
            return "AC"
        return None
    return None


def build_accounting_entries(
    accounting_rows: list[dict],
    member_map: dict,
    lookups: dict,
    warnings: list[str],
    account_mapping: dict | None = None,
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

        # Bank/cash rule — see resolve_bank_cash_journal_override(). This must run
        # before the fingerprint below: entries already corrected in the ERP (by
        # fix_bank_cash_journals.py, or imported that way originally) now live on
        # BQ/CS regardless of their raw legacy journal, so the fingerprint's journal
        # code has to match that, or already-imported entries are mistaken for new ones.
        override = resolve_bank_cash_journal_override(
            lines, col_compte, col_debit, col_credit, account_mapping, lookups
        )
        if override:
            erp_journal_code = override

        # Idempotency check — three layers (see load_erp_lookups for details)
        external_id = f"vulcain-{num_ecriture}"

        # Layer 3: content fingerprint — must be computed before processing lines
        # so we can skip early. Matches the DB-side fingerprint built in
        # load_erp_lookups: (date, journal, sorted per-line (account_code, debit, credit)).
        # Per-line account codes are required, not just aggregate totals — two unrelated
        # entries can share the same date/journal/total/line-count by coincidence.
        try:
            raw_entry_date = _parse_date(lines[0].get(col_date) or "")
        except ValueError:
            raw_entry_date = ""
        line_fp = tuple(sorted(
            (
                _resolve_fp_account_code((r.get(col_compte) or "").strip(), account_mapping, lookups),
                str(_clean_amount(r.get(col_debit) or "").quantize(Decimal("0.01"))),
                str(_clean_amount(r.get(col_credit) or "").quantize(Decimal("0.01"))),
            )
            for r in lines
        ))
        fingerprint = (raw_entry_date, erp_journal_code, line_fp)

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

            # Account mapping: full legacy code → specific ERP account + optional asset
            mapped_asset_uuid = None
            resolved_account_code = prefix
            if account_mapping and raw_compte in account_mapping:
                map_entry = account_mapping[raw_compte]
                erp_code = (map_entry.get("erp_code") or "").strip() or prefix
                # Try full code first (e.g. "2185"), then 3-char prefix fallback
                account_uuid = (
                    lookups["accounts_by_full_code"].get(erp_code)
                    or lookups["accounts_by_prefix"].get(erp_code[:3])
                )
                if not account_uuid:
                    warnings.append(
                        f"Mapping erp_code {erp_code!r} (legacy: {raw_compte!r}) not found in ERP "
                        f"for num_écriture={num_ecriture}, line skipped"
                    )
                    stats["warnings"] += 1
                    continue
                resolved_account_code = erp_code
                asset_code_val = (map_entry.get("asset_code") or "").strip() or None
                if asset_code_val:
                    mapped_asset_uuid = lookups["assets_by_code"].get(asset_code_val)
                    if not mapped_asset_uuid:
                        warnings.append(
                            f"Mapping asset_code {asset_code_val!r} (legacy: {raw_compte!r}) "
                            f"not found in ERP assets for num_écriture={num_ecriture}"
                        )
                        stats["warnings"] += 1
            else:
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
                if tiers_uuid is None and n_pilote == "1":
                    fallback = lookups.get("member_ext_0000")
                    if fallback:
                        tiers_uuid = fallback["uuid"]
                        member_account_id = fallback["account_id"] or ""
                if tiers_uuid is None:
                    line_label = (line.get(col_label) or "").lower()
                    _EXT_KEYWORDS = ("helloasso", "vols", "vol", "jd", "vi","V.I")
                    if any(kw in line_label for kw in _EXT_KEYWORDS):
                        fallback = lookups.get("member_ext_0002")
                        if fallback:
                            tiers_uuid = fallback["uuid"]
                            member_account_id = fallback["account_id"] or ""

            line_dict: dict = {
                "account_uuid": account_uuid,
                "debit": str(debit.quantize(Decimal("0.0001"))),
                "credit": str(credit.quantize(Decimal("0.0001"))),
                "description": (line.get(col_label) or "").strip()[:255],
                # Underscore-prefixed: used for CSV output, stripped before JSON
                "_account_code": resolved_account_code,
                "_member_account_id": member_account_id,
                "_legacy_account_code": raw_compte,
            }
            # Member tiers wins; fall back to asset_uuid from mapping if no member tiers
            if tiers_uuid:
                line_dict["tiers_uuid"] = tiers_uuid
            elif mapped_asset_uuid:
                line_dict["tiers_uuid"] = mapped_asset_uuid
                line_dict["_asset_uuid"] = mapped_asset_uuid

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
                        "tiers_uuid": pilot_uuid,
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
                        "tiers_uuid": copilot_uuid,
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

    stats: dict = {
        "legacy_total": 0,
        "matched": 0,
        "multi_matched": 0,
        "matched_billed": 0,
        "matched_unbilled": 0,
        "price_match": 0,
        "price_mismatch": 0,
        "missing_from_erp": 0,
        "missing_from_legacy": 0,
        # Gross totals — regular flights
        "sum_vulcain_gross_regular": Decimal("0"),
        "sum_erp_gross_regular": Decimal("0"),
        "price_match_regular": 0,
        "price_mismatch_regular": 0,
        # Gross totals — initiation flights (type_de_vol=7 / type_of_flight=2)
        "sum_vulcain_gross_initiation": Decimal("0"),
        "sum_erp_gross_initiation": Decimal("0"),
        "price_match_initiation": 0,
        "price_mismatch_initiation": 0,
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

            # Initiation: Vulcain type_de_vol=7 OR ERP type_of_flight=2
            is_initiation = (type_vol == "7") or (erp_flight.get("type_of_flight") == 2)
            suffix = "initiation" if is_initiation else "regular"

            if is_billed:
                stats["matched_billed"] += 1
                stats[f"sum_erp_gross_{suffix}"] += erp_gross
                stats[f"sum_vulcain_gross_{suffix}"] += prix_gross
            else:
                stats["matched_unbilled"] += 1
                stats[f"sum_vulcain_gross_{suffix}"] += prix_gross
            price_diff = erp_gross - prix_gross if is_billed else Decimal("0")

            if is_billed:
                if abs(price_diff) <= Decimal("0.05"):
                    stats["price_match"] += 1
                    stats[f"price_match_{suffix}"] += 1
                else:
                    stats["price_mismatch"] += 1
                    stats[f"price_mismatch_{suffix}"] += 1
                    price_gap_rows.append({
                        "vulcain_n": n_str,
                        "date": date_str,
                        "aircraft": aircraft,
                        "pilot_legacy_id": n_pilote,
                        "pilot_erp_id": pilot_erp_id,
                        "pilot_name": pilot_name,
                        "is_initiation": "Y" if is_initiation else "N",
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
                "is_initiation": "Y" if is_initiation else "N",
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
                "is_initiation": "Y" if type_vol == "7" else "N",
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
                "is_initiation": "Y" if f.get("type_of_flight") == 2 else "N",
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
# Account mapping (export template / import)
# ---------------------------------------------------------------------------

def _load_existing_mapping(path: Path) -> dict[str, dict]:
    """Read the shared mapping file and return a dict keyed by vulcain_code."""
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    entries = data.get("mappings", data) if isinstance(data, dict) else data
    if not isinstance(entries, list):
        return {}
    return {e["vulcain_code"]: e for e in entries if e.get("vulcain_code")}


def export_account_mapping(accounting_rows: list[dict]) -> None:
    """
    Scan all account codes present in the legacy accounting CSV and merge them
    into output/account_mapping.json (shared with check_account.py).

    Existing entries from check_account.py and user edits (erp_code, asset_code,
    note) are preserved. Only the 'count' field is updated on re-export.

    Workflow:
      1. Run --export-mapping to generate / update the template.
      2. For every 2185xxx-style sub-account: set erp_code to "2185" and fill
         asset_code with the ERP asset code (e.g. "F-CGXY", not the UUID).
      3. Re-run with --import-mapping to apply the mapping during entry export.
    """
    if not accounting_rows:
        print("  No accounting rows — nothing to export.")
        return

    sample = accounting_rows[0]
    col_compte = _find_col(sample, ["compte"])

    counts: dict[str, int] = {}
    for row in accounting_rows:
        code = (row.get(col_compte) or "").strip()
        if code:
            counts[code] = counts.get(code, 0) + 1

    existing = _load_existing_mapping(MAPPING_FILE)
    new_codes = 0

    merged: dict[str, dict] = dict(existing)  # start with everything already in the file
    for code in counts:
        if code in merged:
            merged[code]["count"] = counts[code]   # update occurrence count only
        else:
            merged[code] = {
                "vulcain_code": code,
                "erp_code": code[:3],   # default = current prefix behaviour; edit as needed
                "asset_code": None,
                "vulcain_label": "",
                "vulcain_side": "",
                "erp_name": "",
                "count": counts[code],
                "note": "",
            }
            new_codes += 1

    entries = sorted(merged.values(), key=lambda e: e["vulcain_code"])
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(MAPPING_FILE, "w", encoding="utf-8") as f:
        json.dump({"_note": _MAPPING_NOTE, "mappings": entries}, f, ensure_ascii=False, indent=2)

    print(f"  Written {len(entries)} entries ({new_codes} new) → {MAPPING_FILE.name}")
    print()
    print("  Next steps:")
    print("    1. Open output/account_mapping.json")
    print("    2. For each 2185xxx sub-account: set erp_code to \"2185\" and fill")
    print("       asset_code with the ERP asset code (e.g. \"F-CGXY\", not the UUID)")
    print("    3. Re-run with --import-mapping to apply the mapping during entry export")


def load_account_mapping(path: str) -> dict[str, dict]:
    """
    Load the shared mapping file and return a dict keyed by vulcain_code.
    Accepts the unified list format produced by both tools.
    """
    p = Path(path)
    if not p.exists():
        raise RuntimeError(
            f"Account mapping file not found: {p}\n"
            f"Run --export-mapping first to generate the template."
        )
    result = _load_existing_mapping(p)
    if not result:
        raise RuntimeError(
            f"Account mapping file is empty or has an unrecognised format: {p}"
        )
    return result


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
    fl_by_account: dict,
    vulcain_vvo_by_account: dict,
    unresolved_in_entries: dict | None = None,
    unresolved_in_flights: dict | None = None,
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
    CSV_COLS = ["num_ecriture", "date", "journal", "label",
                "legacy_account_code", "account_code",
                "member_account_id", "tiers_uuid", "debit", "credit"]
    for journal_code, entries in entries_by_journal.items():
        csv_path = OUTPUT_DIR / f"import_entries_{journal_code}.csv"
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=CSV_COLS)
            w.writeheader()
            for entry in entries:
                for line in entry.get("_lines_full", []):
                    w.writerow({
                        "num_ecriture": entry.get("reference", ""),
                        "date": _to_dmy(entry.get("entry_date", "")),
                        "journal": journal_code,
                        "label": line.get("description", ""),
                        "legacy_account_code": line.get("_legacy_account_code", ""),
                        "account_code": line.get("_account_code", ""),
                        "member_account_id": line.get("_member_account_id", ""),
                        "tiers_uuid": line.get("tiers_uuid", ""),
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
                "is_initiation", "status", "vulcain_gross", "erp_gross", "price_diff",
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
                  "pilot_name", "is_initiation", "takeoff", "landing", "duration_min",
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

    # 5b. Unresolved pilots CSV (for manual review)
    unresolved_path = OUTPUT_DIR / "unresolved_pilots.csv"
    unresolved_rows = [
        (n, pilot_index.get(n, {}))
        for n, m in sorted(member_map.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 0)
        if m is None
    ]
    _in_entries = unresolved_in_entries or {}
    _in_flights = unresolved_in_flights or {}
    with open(unresolved_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["n_pilote", "nom", "prénom", "num_FFVV", "nb_ecritures", "ecritures", "nb_vols", "vols"])
        for n, pr in unresolved_rows:
            entries_list = _in_entries.get(n, [])
            flights_list = _in_flights.get(n, [])
            w.writerow([
                n,
                pr.get("nom", ""),
                pr.get("prénom") or pr.get("prenom", ""),
                pr.get("num_FFVV", ""),
                len(entries_list),
                "; ".join(entries_list),
                len(flights_list),
                "; ".join(flights_list),
            ])
    print(f"  Written {len(unresolved_rows):>5} unresolved pilots → {unresolved_path.name}")

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
        f"    of which regular flights:  {gap_stats.get('price_mismatch_regular', 0)}",
        f"    of which initiation:       {gap_stats.get('price_mismatch_initiation', 0)}  (expected — different billing method)",
        "",
    ]

    # Gross totals split by flight category
    sv_reg  = gap_stats.get("sum_vulcain_gross_regular",    Decimal("0"))
    se_reg  = gap_stats.get("sum_erp_gross_regular",        Decimal("0"))
    sv_ini  = gap_stats.get("sum_vulcain_gross_initiation", Decimal("0"))
    se_ini  = gap_stats.get("sum_erp_gross_initiation",     Decimal("0"))
    sv_tot  = sv_reg + sv_ini
    se_tot  = se_reg + se_ini
    summary_lines += [
        "--- Flight Gross Totals (matched flights) ---",
        f"                            {'Vulcain':>12}   {'ERP (billed)':>12}   {'Diff':>12}",
        f"  Regular flights           {sv_reg:>12.2f}   {se_reg:>12.2f}   {se_reg - sv_reg:>12.2f}",
        f"  Initiation flights        {sv_ini:>12.2f}   {se_ini:>12.2f}   {se_ini - sv_ini:>12.2f}",
        f"  TOTAL                     {sv_tot:>12.2f}   {se_tot:>12.2f}   {se_tot - sv_tot:>12.2f}",
        "  Note: Vulcain column includes unbilled flights; ERP column shows billed only.",
        "",
    ]

    # ERP FL journal by account
    summary_lines += ["--- ERP FL Journal — By Account ---"]
    if fl_by_account:
        col_w = max(len(k) for k in fl_by_account) + 2
        total_fl_debit = Decimal("0")
        total_fl_credit = Decimal("0")
        for code, amounts in sorted(fl_by_account.items()):
            d = amounts["debit"]
            c = amounts["credit"]
            total_fl_debit += d
            total_fl_credit += c
            summary_lines.append(
                f"  {code:<{col_w}}  debit={d:>12.2f}  credit={c:>12.2f}"
            )
        summary_lines.append(
            f"  {'TOTAL':<{col_w}}  debit={total_fl_debit:>12.2f}  credit={total_fl_credit:>12.2f}"
        )
    else:
        summary_lines.append("  (no FL journal entries found)")
    summary_lines.append("")

    # Vulcain VVO journal by account
    summary_lines += ["--- Vulcain VVO Journal — By Account ---"]
    if vulcain_vvo_by_account:
        col_w = max(len(k) for k in vulcain_vvo_by_account) + 2
        total_vvo_debit = Decimal("0")
        total_vvo_credit = Decimal("0")
        for code, amounts in sorted(vulcain_vvo_by_account.items()):
            d = amounts["debit"]
            c = amounts["credit"]
            total_vvo_debit += d
            total_vvo_credit += c
            summary_lines.append(
                f"  {code:<{col_w}}  debit={d:>12.2f}  credit={c:>12.2f}"
            )
        summary_lines.append(
            f"  {'TOTAL':<{col_w}}  debit={total_vvo_debit:>12.2f}  credit={total_vvo_credit:>12.2f}"
        )
    else:
        summary_lines.append("  (no VVO journal entries found)")
    summary_lines += [
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

def _print_help() -> None:
    print("""Usage: python import_legacy.py [OPTIONS]

Read Vulcain legacy CSV data and produce import-ready files for the ERP.
All DB access is read-only. Output files are written to backend/tools/output/.

OPTIONS
  (none)                   Full run: export accounting entries, pack consumptions,
                           flight gap report, member mapping, and summary.

  --dry-run                Parse and validate everything but write no output files.

  --export-mapping         Scan the accounting CSV and merge account codes into
                           output/account_mapping.json (shared with check_account.py).
                           Existing entries and user edits are preserved; only the
                           'count' field is updated on re-export. No DB needed.
                           Edit the file, then use --import-mapping on the next run.

  --import-mapping [FILE]  Apply an account mapping file during the accounting entry
                           export. If FILE is omitted, defaults to:
                             output/account_mapping.json

                           The file is shared with check_account.py. Relevant fields:
                             erp_code   — ERP account code to resolve against instead
                                          of the default 3-char prefix (full code tried
                                          first, then first 3 chars as fallback)
                             asset_code — ERP asset code (assets.code, e.g. "F-CGXY")
                                          to attach as tiers_uuid on the line;
                                          resolved to UUID from the DB at run time
                             count      — occurrence count from export (informational)
                             note       — free-text annotation

                           Typical workflow for 2185xxx sub-accounts:
                             1. python import_legacy.py --export-mapping
                             2. Edit output/account_mapping.json:
                                  set erp_code  → "2185"
                                  set asset_code → "F-CGXY"  (one entry per sub-account)
                             3. python import_legacy.py --import-mapping

  --help, -h               Show this help message and exit.

OUTPUT FILES (normal run)
  import_entries_<JOURNAL>.csv   Accounting entries per journal (review format)
  import_entries_<JOURNAL>.json  Accounting entries per journal (API import format)
  pack_consumptions.json         MemberPackConsumption records
  pack_unmatched.csv             Pack flights with no matching ERP flight
  gap_report_flights.csv         Flight presence + gross price comparison
  missing_flights.csv            Legacy flights absent from ERP
  price_mismatches.csv           Matched flights with a price discrepancy
  member_mapping.csv             Pilot n → ERP member mapping
  unresolved_pilots.csv          Pilots that could not be matched to an ERP member
  import_summary.txt             Run statistics
  import_warnings.txt            Warnings generated during the run (if any)
""")


def _parse_import_mapping_arg() -> str | None:
    """Return path string for --import-mapping, or None if not specified."""
    if "--import-mapping" not in sys.argv:
        return None
    idx = sys.argv.index("--import-mapping")
    if idx + 1 < len(sys.argv) and not sys.argv[idx + 1].startswith("--"):
        return sys.argv[idx + 1]
    return str(MAPPING_FILE)


def main() -> None:
    if "--help" in sys.argv or "-h" in sys.argv:
        _print_help()
        return

    dry_run = "--dry-run" in sys.argv
    export_mapping = "--export-mapping" in sys.argv
    import_mapping_path = _parse_import_mapping_arg()

    print("=== Vulcain Legacy Import Tool ===")
    print(f"  Legacy data: {LEGACY_DIR}")
    print(f"  Output:      {OUTPUT_DIR}")
    if dry_run:
        print("  [DRY RUN — no files written]")
    if export_mapping:
        print("  [MODE: export-mapping]")
    if import_mapping_path:
        print(f"  [MODE: import-mapping from {import_mapping_path}]")
    print()

    # --export-mapping: scan CSV and write template; no DB needed
    if export_mapping:
        print("Loading legacy accounting CSV…")
        accounting_rows = _read_csv(LEGACY_DIR / "V_comptabilité_validée_2026.csv")
        print(f"  {len(accounting_rows)} accounting lines")
        print("Exporting account mapping template…")
        export_account_mapping(accounting_rows)
        return

    # Load account mapping if requested
    account_mapping: dict | None = None
    if import_mapping_path:
        print(f"Loading account mapping from {import_mapping_path}…")
        account_mapping = load_account_mapping(import_mapping_path)
        print(f"  {len(account_mapping)} codes loaded, "
              f"{sum(1 for v in account_mapping.values() if v.get('asset_code'))} with asset_code")

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

    # Index which accounting entries and flights each unresolved pilot appears in
    unresolved_set = {n for n, m in member_map.items() if m is None}
    unresolved_in_entries: dict[str, list[str]] = {n: [] for n in unresolved_set}
    unresolved_in_flights: dict[str, list[str]] = {n: [] for n in unresolved_set}
    if unresolved_set:
        if accounting_rows:
            _s = accounting_rows[0]
            _col_np = _find_col(_s, ["num_pilote"])
            _col_ne = _find_col(_s, ["num_écriture", "num_ecriture", "num_Ã©criture"])
            for _row in accounting_rows:
                _np = (_row.get(_col_np) or "").strip()
                if _np in unresolved_set:
                    _ne = (_row.get(_col_ne) or "").strip()
                    if _ne and _ne not in unresolved_in_entries[_np]:
                        unresolved_in_entries[_np].append(_ne)
        if flight_rows:
            _sf = flight_rows[0]
            _col_fn = _find_col(_sf, ["n"])
            _col_fp = _find_col(_sf, ["n_pilote"])
            _col_fc = _find_col(_sf, ["n_copilote"])
            for _row in flight_rows:
                _fn = (_row.get(_col_fn) or "").strip()
                for _col in (_col_fp, _col_fc):
                    _np = (_row.get(_col) or "").strip()
                    if _np in unresolved_set:
                        if _fn and _fn not in unresolved_in_flights[_np]:
                            unresolved_in_flights[_np].append(_fn)

    # Step 1: Accounting entries
    print("\nStep 1 — Accounting entries (non-flight)…")
    entries_by_journal = build_accounting_entries(
        accounting_rows, member_map, lookups, warnings, account_mapping=account_mapping
    )

    # Step 2: Pack25 consumptions
    print("Step 2 — Pack25 consumptions…")
    result = build_pack_consumptions(flight_rows, member_map, lookups, warnings)
    consumptions, unmatched, pack_stats = result[0], result[1], result[2]
    # Re-attach pack_stats at end of consumptions list for write_outputs
    consumptions_with_stats = consumptions + [pack_stats]  # type: ignore[operator]

    # Step 3: Gap report
    print("Step 3 — Flight gap report…")
    gap_report, missing_flights, price_gap = build_gap_report(flight_rows, member_map, lookups, warnings)

    # Compute Vulcain VVO by-account from accounting CSV (VVO rows skipped from import)
    vulcain_vvo_by_account: dict[str, dict] = {}
    if accounting_rows:
        s = accounting_rows[0]
        col_jrn = _find_col(s, ["journal"])
        col_cpt = _find_col(s, ["compte"])
        col_deb = _find_col(s, ["débit", "debit", "dÃ©bit"])
        col_crd = _find_col(s, ["crédit", "credit", "crÃ©dit"])
        for row in accounting_rows:
            if (row.get(col_jrn) or "").strip().upper() != "VVO":
                continue
            compte = (row.get(col_cpt) or "").strip()
            prefix = compte[:3] if len(compte) >= 3 else compte
            if not prefix:
                continue
            d = _clean_amount(row.get(col_deb) or "")
            c = _clean_amount(row.get(col_crd) or "")
            if prefix not in vulcain_vvo_by_account:
                vulcain_vvo_by_account[prefix] = {"debit": Decimal("0"), "credit": Decimal("0")}
            vulcain_vvo_by_account[prefix]["debit"] += d
            vulcain_vvo_by_account[prefix]["credit"] += c

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
        fl_by_account=lookups["fl_by_account"],
        vulcain_vvo_by_account=vulcain_vvo_by_account,
        unresolved_in_entries=unresolved_in_entries,
        unresolved_in_flights=unresolved_in_flights,
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
