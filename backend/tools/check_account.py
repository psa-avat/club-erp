"""
ERP-CLUB - Account Balance Check Tool
Copyright (C) 2026  SAFORCADA Patrick

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Compare Vulcain CB (balance sheet) and CR (income statement) CSVs against
the ERP's accounting ledger for fiscal year 2026.

Input files (in legacy-data/):
  CB 24062026.csv                     Vulcain "Compte de Bilan" (balance sheet)
  CR 24062026.csv                     Vulcain "Compte de Résultat" (income statement)
  V_comptabilité_validée_2026.csv     Vulcain raw ledger export (optional; used to
                                       show Vulcain entry count/balance per journal
                                       in the journal breakdown)

Output files (in output/):
  check_account_report.txt      human-readable summary + per-account table
  check_account_detail.csv      per-account comparison (all accounts)
  check_account_entries.csv     ERP entry breakdown for mismatched accounts

Account code mapping rule (from export_journaux.py):
  old 9-digit Vulcain code → best-matching ERP code (longest prefix match)
  e.g.  215500000 → ERP code that starts with as many of those digits as possible

Sign convention for comparison:
  Actif / Charges   → ERP (debit − credit) should equal +Vulcain solde
  Passif / Produits → ERP (debit − credit) should equal −Vulcain solde

Usage:
  python check_account.py [--threshold AMOUNT] [--account CODE] [--dry-run]
                          [--export-accounts] [--account-file PATH]

  --threshold AMOUNT   flag accounts where |diff| > AMOUNT (default 0.10)
  --account CODE       show full ERP entry breakdown for ERP account CODE
                       (CODE is the ERP account code, e.g. "215" or "6026")
  --dry-run            print report without writing output files
  --export-accounts    merge auto-detected Vulcain→ERP mappings into
                       output/account_mapping.json (shared with import_legacy.py),
                       then exit. Edit the file to correct wrong mappings or set
                       "erp_code": null to exclude an account.
  --account-file PATH  load account mapping from PATH (default:
                       output/account_mapping.json). File entries override
                       auto-matching; Vulcain codes absent from the file still
                       use auto prefix-matching.
"""

import csv
import json
import os
import sys
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TOOLS_DIR = Path(__file__).parent.resolve()
LEGACY_DIR = TOOLS_DIR / "legacy-data"
OUTPUT_DIR = TOOLS_DIR / "output"

CB_FILE = LEGACY_DIR / "CB-AVAT.csv"
CR_FILE = LEGACY_DIR / "CR-AVAT.csv"
VULCAIN_ENTRIES_FILE = LEGACY_DIR / "V_comptabilité_validée_2026.csv"

# Legacy Vulcain journal code -> ERP journal code (same mapping as
# import_legacy.py). VVO (flight) entries are excluded: flight billing is
# reconciled separately via the FL/REM journals, not the raw Vulcain ledger.
JOURNAL_MAP: dict[str, str | None] = {
    "VVO": None,
    "RPT": "AN",
    "VIN": "VT",
    "VDI": "VT",
    "AC":  "AC",
    "BQ":  "BQ",
    "CA":  "CA",
    "EXP": "OD",
    "INV": "OD",
    "MEM": "OD",
    "ORG": "OD",
    "PER": "OD",
}

# ---------------------------------------------------------------------------
# DB connection (same pattern as import_legacy.py)
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
# Amount parsing (French format: space or nbsp thousands, comma decimal)
# ---------------------------------------------------------------------------

def _clean_amount(val: str) -> Decimal:
    if not val:
        return Decimal("0")
    cleaned = val.strip().replace("\xa0", "").replace(" ", "").replace(" ", "").replace(",", ".")
    if not cleaned or cleaned == "-":
        return Decimal("0")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return Decimal("0")


# ---------------------------------------------------------------------------
# Parse Vulcain CB / CR CSVs
# ---------------------------------------------------------------------------
# Each row in these files repeats the full header info and totals, with actual
# account data at fixed column positions:
#   [16] left account code (9 digits)
#   [17] left label
#   [18] left solde (current year)
#   [19] left solde N-1
#   [20] right account code (9 digits)
#   [21] right label
#   [22] right solde (current year)
#   [23] right solde N-1
# Column [6] distinguishes the report type: "Actif"/"Passif" or "Charges"/"Produits".

def parse_vulcain_report(path: Path) -> tuple[list[dict], dict]:
    """
    Parse a Vulcain CB or CR CSV.

    Returns:
      accounts: list of {
        'side': 'actif'|'passif'|'charges'|'produits',
        'vulcain_code': str (9-digit),
        'label': str,
        'solde': Decimal,
        'solde_n1': Decimal,
      }
      totals: {
        'left_label': str, 'right_label': str,
        'total_left': Decimal, 'total_right': Decimal,
        'total_left_n1': Decimal, 'total_right_n1': Decimal,
        'result': Decimal, 'result_qualifier': str,
      }
    """
    accounts: list[dict] = []
    totals: dict = {}

    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 24:
                continue

            left_header = row[6].strip()   # "Actif" or "Charges"
            right_header = row[7].strip()  # "Passif" or "Produits"
            left_side = left_header.lower()
            right_side = right_header.lower()

            left_code = row[16].strip()
            left_label = row[17].strip()
            left_solde_raw = row[18].strip()
            left_solde_n1_raw = row[19].strip()

            right_code = row[20].strip()
            right_label = row[21].strip()
            right_solde_raw = row[22].strip()
            right_solde_n1_raw = row[23].strip()

            # Collect totals from the recurring footer fields (consistent across all rows)
            if not totals and len(row) >= 30:
                totals = {
                    "left_label": left_header,
                    "right_label": right_header,
                    "total_left": _clean_amount(row[25]) if len(row) > 25 else Decimal("0"),
                    "total_left_n1": _clean_amount(row[26]) if len(row) > 26 else Decimal("0"),
                    "total_right": _clean_amount(row[28]) if len(row) > 28 else Decimal("0"),
                    "total_right_n1": _clean_amount(row[29]) if len(row) > 29 else Decimal("0"),
                }
                # Result qualifier: CB uses row[32], CR uses row[33]
                if left_header == "Actif":
                    totals["result_qualifier"] = row[32].strip() if len(row) > 32 else ""
                else:
                    totals["result_qualifier"] = row[33].strip() if len(row) > 33 else ""
                # Result value: computed from totals (avoids CB/CR layout divergence).
                # CB: Actifs − Passifs = excédent (positive) or déficit (negative)
                # CR: Produits − Charges = excédent (positive) or déficit (negative)
                # Set after totals are populated (see below).

            if left_code and left_code[0].isdigit():
                accounts.append({
                    "side": left_side,
                    "vulcain_code": left_code,
                    "label": left_label,
                    "solde": _clean_amount(left_solde_raw),
                    "solde_n1": _clean_amount(left_solde_n1_raw),
                })

            if right_code and right_code[0].isdigit():
                accounts.append({
                    "side": right_side,
                    "vulcain_code": right_code,
                    "label": right_label,
                    "solde": _clean_amount(right_solde_raw),
                    "solde_n1": _clean_amount(right_solde_n1_raw),
                })

    # Compute result from totals (sign: positive = excédent)
    if totals:
        left_h = totals.get("left_label", "")
        if left_h == "Actif":
            # CB: Actifs − Passifs
            totals["result"] = totals["total_left"] - totals["total_right"]
        else:
            # CR: Produits − Charges
            totals["result"] = totals["total_right"] - totals["total_left"]

    return accounts, totals


# ---------------------------------------------------------------------------
# ERP lookups
# ---------------------------------------------------------------------------

def load_erp_data(conn) -> dict:
    """
    Load from ERP:
      - fiscal year 2026 uuid and date range
      - all accounts (code, label, is_posting_allowed)
      - account balances (sum debit/credit) for FY2026 across all journals
    """
    cur = conn.cursor()

    # Fiscal year
    cur.execute(
        "SELECT uuid::text, year, start_date::text, end_date::text "
        "FROM accounting_fiscal_years WHERE year = 2026 LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("No fiscal year for 2026 found in the ERP database.")
    fy_uuid, fy_year, fy_start, fy_end = row

    # All accounts
    cur.execute(
        "SELECT code, name, is_posting_allowed FROM accounting_accounts ORDER BY code"
    )
    erp_accounts: dict[str, dict] = {}
    for code, name, is_posting in cur.fetchall():
        erp_accounts[code] = {"code": code, "name": name or "", "is_posting": is_posting}

    # Account balances for FY2026: sum(debit), sum(credit) per account
    cur.execute(
        """
        SELECT aa.code,
               COALESCE(SUM(al.debit),  0) AS total_debit,
               COALESCE(SUM(al.credit), 0) AS total_credit
        FROM accounting_lines al
        JOIN accounting_entries ae ON ae.uuid = al.entry_uuid
                                   AND ae.fiscal_year_uuid = al.fiscal_year_uuid
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        WHERE al.fiscal_year_uuid = %s
        GROUP BY aa.code
        ORDER BY aa.code
        """,
        (fy_uuid,),
    )
    erp_balances: dict[str, dict] = {}
    for code, total_debit, total_credit in cur.fetchall():
        d = Decimal(str(total_debit))
        c = Decimal(str(total_credit))
        erp_balances[code] = {
            "debit": d,
            "credit": c,
            "net": d - c,  # positive = debit-heavy
        }

    # Per-journal breakdown for each account (for the "why" investigation)
    cur.execute(
        """
        SELECT aa.code,
               aj.code AS journal,
               COALESCE(SUM(al.debit),  0) AS total_debit,
               COALESCE(SUM(al.credit), 0) AS total_credit,
               COUNT(DISTINCT ae.uuid)      AS entry_count
        FROM accounting_lines al
        JOIN accounting_entries ae ON ae.uuid = al.entry_uuid
                                   AND ae.fiscal_year_uuid = al.fiscal_year_uuid
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        JOIN accounting_journals  aj ON aj.uuid = ae.journal_uuid
        WHERE al.fiscal_year_uuid = %s
        GROUP BY aa.code, aj.code
        ORDER BY aa.code, aj.code
        """,
        (fy_uuid,),
    )
    erp_by_journal: dict[str, list[dict]] = {}
    for acc_code, jrn_code, d, c, n in cur.fetchall():
        erp_by_journal.setdefault(acc_code, []).append({
            "journal": jrn_code,
            "debit": Decimal(str(d)),
            "credit": Decimal(str(c)),
            "entries": int(n),
        })

    cur.close()
    return {
        "fy_uuid": fy_uuid,
        "fy_year": fy_year,
        "fy_start": fy_start,
        "fy_end": fy_end,
        "erp_accounts": erp_accounts,
        "erp_balances": erp_balances,
        "erp_by_journal": erp_by_journal,
    }


def load_erp_entries_for_account(conn, fy_uuid: str, erp_account_code: str) -> list[dict]:
    """
    Load all individual entry lines for a given account in FY2026.
    Used for --account drill-down.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT ae.entry_date::text,
               aj.code AS journal,
               ae.reference,
               ae.description,
               al.description AS line_desc,
               al.debit,
               al.credit
        FROM accounting_lines al
        JOIN accounting_entries ae ON ae.uuid = al.entry_uuid
                                   AND ae.fiscal_year_uuid = al.fiscal_year_uuid
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        JOIN accounting_journals  aj ON aj.uuid = ae.journal_uuid
        WHERE al.fiscal_year_uuid = %s
          AND aa.code = %s
        ORDER BY ae.entry_date, ae.uuid
        """,
        (fy_uuid, erp_account_code),
    )
    rows = []
    for entry_date, journal, ref, desc, line_desc, debit, credit in cur.fetchall():
        rows.append({
            "entry_date": entry_date,
            "journal": journal,
            "reference": ref or "",
            "description": desc or "",
            "line_description": line_desc or "",
            "debit": Decimal(str(debit or 0)),
            "credit": Decimal(str(credit or 0)),
        })
    cur.close()
    return rows


# ---------------------------------------------------------------------------
# Account code matching: Vulcain 9-digit → best ERP code
# ---------------------------------------------------------------------------

def _build_erp_code_list(erp_accounts: dict[str, dict]) -> list[str]:
    """Return ERP codes sorted longest-first (for best-prefix matching)."""
    return sorted(erp_accounts.keys(), key=len, reverse=True)


def find_best_erp_match(vulcain_code: str, erp_codes_sorted: list[str]) -> str | None:
    """
    Find the ERP account code that is the longest prefix of the Vulcain 9-digit code.
    e.g. vulcain_code='215500000' → matches ERP '2155' over '215' (more specific).
    """
    for erp_code in erp_codes_sorted:
        if vulcain_code.startswith(erp_code):
            return erp_code
    return None


def _find_entries_col(row: dict, candidates: list[str]) -> str:
    """Find a column name in a legacy CSV row, tolerating accented headers."""
    keys = list(row.keys())
    for c in candidates:
        if c in keys:
            return c
        for k in keys:
            if len(c) >= 6 and k.startswith(c[:6]):
                return k
    return candidates[0]


def load_vulcain_journal_breakdown(
    path: Path,
    erp_codes_sorted: list[str],
    account_matching: dict[str, str | None] | None,
) -> dict[str, dict[str, dict]]:
    """
    Read the raw Vulcain accounting ledger export and aggregate debit/credit/
    entry counts per (ERP account code, ERP journal code), so the per-journal
    breakdown can be cross-checked against the Vulcain ledger, not just the
    ERP one.

    Returns: erp_code -> erp_journal_code -> {"debit", "credit", "balance", "entries"}.
    Returns {} if the source file is not present (feature degrades gracefully).
    """
    if not path.exists():
        return {}

    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        rows = list(reader)
    if not rows:
        return {}

    sample = rows[0]
    col_num = _find_entries_col(sample, ["num_écriture", "num_ecriture"])
    col_compte = _find_entries_col(sample, ["compte"])
    col_debit = _find_entries_col(sample, ["débit", "debit"])
    col_credit = _find_entries_col(sample, ["crédit", "credit"])
    col_journal = _find_entries_col(sample, ["journal"])

    # (erp_code, erp_journal) -> {"debit", "credit", "entry_ids"}
    agg: dict[tuple[str, str], dict] = {}

    for row in rows:
        vulcain_journal = (row.get(col_journal) or "").strip()
        erp_journal = JOURNAL_MAP.get(vulcain_journal)
        if erp_journal is None:
            continue

        vcode = (row.get(col_compte) or "").strip()
        if not vcode:
            continue
        if account_matching is not None and vcode in account_matching:
            erp_code = account_matching[vcode]
        else:
            erp_code = find_best_erp_match(vcode, erp_codes_sorted)
        if erp_code is None:
            continue

        key = (erp_code, erp_journal)
        bucket = agg.setdefault(key, {"debit": Decimal("0"), "credit": Decimal("0"), "entry_ids": set()})
        bucket["debit"] += _clean_amount(row.get(col_debit))
        bucket["credit"] += _clean_amount(row.get(col_credit))
        num = (row.get(col_num) or "").strip()
        if num:
            bucket["entry_ids"].add(num)

    result: dict[str, dict[str, dict]] = {}
    for (erp_code, erp_journal), bucket in agg.items():
        result.setdefault(erp_code, {})[erp_journal] = {
            "debit": bucket["debit"],
            "credit": bucket["credit"],
            "balance": bucket["debit"] - bucket["credit"],
            "entries": len(bucket["entry_ids"]),
        }
    return result


# ---------------------------------------------------------------------------
# Account matching file — export and load
# ---------------------------------------------------------------------------

# Shared with import_legacy.py
ACCOUNT_MAPPING_FILE = OUTPUT_DIR / "account_mapping.json"

_MAPPING_NOTE = (
    "Shared account mapping file — used by import_legacy.py (--import-mapping) "
    "and check_account.py (--account-file). "
    "Each entry maps a Vulcain code to an ERP account. "
    "Fields: vulcain_code (required), erp_code (override auto-matching; null = exclude), "
    "asset_code (import_legacy only: ERP asset code to attach as tiers_uuid), "
    "vulcain_label / vulcain_side / erp_name (informational, set by check_account export), "
    "count (set by import_legacy export), note (free text)."
)


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


def export_account_matching(vulcain_accounts: list[dict], erp_data: dict, path: Path) -> int:
    """
    Merge auto-detected Vulcain→ERP mappings into the shared account_mapping.json.
    Existing entries from import_legacy.py and user edits (erp_code, asset_code,
    note) are preserved. Informational fields (vulcain_label, vulcain_side,
    erp_name) are updated. Returns the number of entries in the merged file.
    """
    erp_accounts = erp_data["erp_accounts"]
    erp_codes_sorted = _build_erp_code_list(erp_accounts)

    existing = _load_existing_mapping(path)
    new_codes = 0

    # Deduplicate Vulcain accounts (same code may appear on left and right columns)
    seen: set[str] = set()
    for acc in vulcain_accounts:
        vcode = acc["vulcain_code"]
        if vcode in seen:
            continue
        seen.add(vcode)
        best = find_best_erp_match(vcode, erp_codes_sorted)
        erp_name = erp_accounts[best]["name"] if best else None

        if vcode in existing:
            # Update informational fields; preserve user-editable ones
            existing[vcode]["vulcain_label"] = acc["label"]
            existing[vcode]["vulcain_side"] = acc["side"]
            existing[vcode]["erp_name"] = erp_name or existing[vcode].get("erp_name", "")
            # Only update erp_code if it was never set (first export for this code)
            if "erp_code" not in existing[vcode]:
                existing[vcode]["erp_code"] = best
        else:
            existing[vcode] = {
                "vulcain_code": vcode,
                "erp_code": best,
                "asset_code": None,
                "vulcain_label": acc["label"],
                "vulcain_side": acc["side"],
                "erp_name": erp_name or "",
                "count": None,
                "note": "",
            }
            new_codes += 1

    entries = sorted(existing.values(), key=lambda e: e["vulcain_code"])
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"_note": _MAPPING_NOTE, "mappings": entries}, f, ensure_ascii=False, indent=2)
    return len(entries)


def load_account_matching(path: Path) -> dict[str, str | None]:
    """
    Load the shared mapping file produced by --export-accounts or --export-mapping.
    Returns a dict: vulcain_code -> erp_code (or None if explicitly excluded).
    Vulcain codes absent from the file fall back to auto prefix-matching.
    """
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    entries = data.get("mappings", data) if isinstance(data, dict) else data
    if not isinstance(entries, list):
        raise ValueError(f"Unrecognised format in {path}: expected {{\"mappings\": [...]}}")

    result: dict[str, str | None] = {}
    for entry in entries:
        code = entry.get("vulcain_code")
        if not code:
            continue
        result[code] = entry.get("erp_code")  # may be None (explicit exclusion)
    return result


# ---------------------------------------------------------------------------
# Comparison logic
# ---------------------------------------------------------------------------

def _build_journal_detail(
    erp_code: str,
    erp_by_journal: dict[str, list[dict]],
    vulcain_journal_by_account: dict[str, dict[str, dict]],
) -> tuple[list[dict], str]:
    """Attach Vulcain entry count / balance to each ERP per-journal line."""
    vulcain_journals = vulcain_journal_by_account.get(erp_code, {})
    detail: list[dict] = []
    for j in erp_by_journal.get(erp_code, []):
        v = vulcain_journals.get(j["journal"])
        detail.append({
            **j,
            "vulcain_entries": v["entries"] if v else 0,
            "vulcain_debit": v["debit"] if v else Decimal("0"),
            "vulcain_credit": v["credit"] if v else Decimal("0"),
            "vulcain_balance": v["balance"] if v else Decimal("0"),
        })
    breakdown_str = "  ".join(
        f"{j['journal']}: D={j['debit']:.2f} C={j['credit']:.2f} ({j['entries']} entries, "
        f"vulcain {j['vulcain_entries']} entries bal={j['vulcain_balance']:.2f})"
        for j in detail
    )
    return detail, breakdown_str


def compare(
    vulcain_accounts: list[dict],
    erp_data: dict,
    threshold: Decimal,
    account_matching: dict[str, str | None] | None = None,
    vulcain_journal_by_account: dict[str, dict[str, dict]] | None = None,
) -> tuple[list[dict], list[dict]]:
    """
    Map Vulcain accounts to ERP codes, aggregate, and compare.

    Returns:
      comparison_rows: one row per (erp_code, side) group
      unmatched_vulcain: Vulcain accounts with no ERP match
    """
    erp_balances = erp_data["erp_balances"]
    erp_accounts = erp_data["erp_accounts"]
    erp_by_journal = erp_data["erp_by_journal"]
    erp_codes_sorted = _build_erp_code_list(erp_accounts)
    vulcain_journal_by_account = vulcain_journal_by_account or {}

    # Group Vulcain accounts by their best-matching ERP code
    # Key: (erp_code, side)  Value: list of Vulcain account dicts
    grouped: dict[tuple[str, str], list[dict]] = {}
    unmatched: list[dict] = []

    for acc in vulcain_accounts:
        vcode = acc["vulcain_code"]
        if account_matching is not None and vcode in account_matching:
            # File has an explicit entry for this code (may be None = excluded)
            best = account_matching[vcode]
        else:
            # Fall back to auto prefix-matching
            best = find_best_erp_match(vcode, erp_codes_sorted)
        if best is None:
            unmatched.append(acc)
            continue
        key = (best, acc["side"])
        grouped.setdefault(key, []).append(acc)

    comparison_rows: list[dict] = []

    for (erp_code, side), accounts in sorted(grouped.items()):
        # Sum Vulcain balances for all accounts in this group
        vulcain_total = sum(a["solde"] for a in accounts)
        vulcain_total_n1 = sum(a["solde_n1"] for a in accounts)
        vulcain_codes = ", ".join(sorted({a["vulcain_code"] for a in accounts}))
        vulcain_labels = " | ".join({a["label"] for a in accounts})

        # ERP balance for this account code
        erp_bal = erp_balances.get(erp_code)
        erp_net = erp_bal["net"] if erp_bal else Decimal("0")
        erp_debit = erp_bal["debit"] if erp_bal else Decimal("0")
        erp_credit = erp_bal["credit"] if erp_bal else Decimal("0")
        erp_missing = erp_bal is None

        # Expected ERP net (debit − credit) based on accounting convention:
        #   actif/charges → expected positive net  → expected = +vulcain_total
        #   passif/produits → expected negative net → expected = −vulcain_total
        if side in ("actif", "charges"):
            expected_erp_net = vulcain_total
        else:
            expected_erp_net = -vulcain_total

        diff = erp_net - expected_erp_net
        flagged = abs(diff) > threshold

        erp_name = erp_accounts.get(erp_code, {}).get("name", "")
        journal_breakdown, breakdown_str = _build_journal_detail(
            erp_code, erp_by_journal, vulcain_journal_by_account
        )

        comparison_rows.append({
            "erp_code": erp_code,
            "erp_name": erp_name,
            "side": side,
            "vulcain_codes": vulcain_codes,
            "vulcain_labels": vulcain_labels,
            "vulcain_solde": vulcain_total,
            "vulcain_solde_n1": vulcain_total_n1,
            "erp_debit": erp_debit,
            "erp_credit": erp_credit,
            "erp_net": erp_net,
            "expected_erp_net": expected_erp_net,
            "diff": diff,
            "flagged": flagged,
            "erp_missing": erp_missing,
            "journal_breakdown": breakdown_str,
            "_journal_detail": journal_breakdown,
        })

    # Also report ERP accounts with balances that have no Vulcain entry
    matched_erp_codes = {row["erp_code"] for row in comparison_rows}
    for erp_code, bal in sorted(erp_balances.items()):
        if erp_code in matched_erp_codes:
            continue
        if abs(bal["net"]) <= threshold:
            continue
        erp_name = erp_accounts.get(erp_code, {}).get("name", "")
        journal_breakdown, breakdown_str = _build_journal_detail(
            erp_code, erp_by_journal, vulcain_journal_by_account
        )
        comparison_rows.append({
            "erp_code": erp_code,
            "erp_name": erp_name,
            "side": "erp_only",
            "vulcain_codes": "",
            "vulcain_labels": "",
            "vulcain_solde": Decimal("0"),
            "vulcain_solde_n1": Decimal("0"),
            "erp_debit": bal["debit"],
            "erp_credit": bal["credit"],
            "erp_net": bal["net"],
            "expected_erp_net": Decimal("0"),
            "diff": bal["net"],
            "flagged": True,
            "erp_missing": False,
            "journal_breakdown": breakdown_str,
            "_journal_detail": journal_breakdown,
        })

    # Sort by erp_code
    comparison_rows.sort(key=lambda r: r["erp_code"])
    return comparison_rows, unmatched


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------

def _fmt(d: Decimal) -> str:
    return f"{d:>14.2f}"


def _flag(row: dict) -> str:
    if row["erp_missing"]:
        return "MISSING_IN_ERP"
    if row["side"] == "erp_only":
        return "ERP_ONLY"
    if row["flagged"]:
        return "MISMATCH"
    return "OK"


def build_report(
    comparison_rows: list[dict],
    unmatched: list[dict],
    cb_totals: dict,
    cr_totals: dict,
    erp_data: dict,
    threshold: Decimal,
) -> str:
    lines = [
        "=== ERP Account Balance Check Report ===",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Vulcain report date: 24/06/2026",
        f"ERP fiscal year: {erp_data['fy_year']} ({erp_data['fy_start']} → {erp_data['fy_end']})",
        f"Mismatch threshold: {threshold:.2f}",
        "",
    ]

    # Vulcain reference totals
    lines += [
        "--- Vulcain Reference Totals ---",
        f"  Balance sheet (CB):",
        f"    Total Actifs:    {cb_totals.get('total_left',  Decimal(0)):>14.2f}",
        f"    Total Passifs:   {cb_totals.get('total_right', Decimal(0)):>14.2f}",
        f"    Bilan ({cb_totals.get('result_qualifier','').strip()}): {cb_totals.get('result', Decimal(0)):>10.2f}",
        f"  Income statement (CR):",
        f"    Total Charges:   {cr_totals.get('total_left',  Decimal(0)):>14.2f}",
        f"    Total Produits:  {cr_totals.get('total_right', Decimal(0)):>14.2f}",
        f"    Résultat ({cr_totals.get('result_qualifier','').strip()}): {cr_totals.get('result', Decimal(0)):>9.2f}",
        "",
    ]

    # Summary
    flagged = [r for r in comparison_rows if r["flagged"]]
    ok_count = len(comparison_rows) - len(flagged)
    lines += [
        "--- Summary ---",
        f"  Total ERP account groups compared: {len(comparison_rows)}",
        f"  OK (diff ≤ {threshold:.2f}):          {ok_count}",
        f"  Mismatches or missing:             {len(flagged)}",
        f"  Vulcain accounts with no ERP match:{len(unmatched)}",
        "",
    ]

    # Flagged accounts
    if flagged:
        lines += ["--- Flagged Accounts (|diff| > threshold or missing) ---",
                  f"  {'ERP Code':<10}  {'Side':<10}  {'Vulcain solde':>14}  {'ERP net':>14}  {'Diff':>12}  Status",
                  f"  {'-'*10}  {'-'*10}  {'-'*14}  {'-'*14}  {'-'*12}  ------"]
        for row in flagged:
            lines.append(
                f"  {row['erp_code']:<10}  {row['side']:<10}  "
                f"{_fmt(row['vulcain_solde'])}  {_fmt(row['erp_net'])}  "
                f"{_fmt(row['diff'])}  {_flag(row)}"
            )
        lines.append("")

    # Per-account journal breakdown for flagged accounts
    lines += ["--- Journal Breakdown for Flagged Accounts ---"]
    for row in flagged:
        if not row["_journal_detail"] and not row["erp_missing"]:
            continue
        lines.append(
            f"\n  Account {row['erp_code']} ({row['erp_name']}) — "
            f"side={row['side']}  diff={row['diff']:+.2f}"
        )
        lines.append(f"  Vulcain codes:  {row['vulcain_codes']}")
        lines.append(f"  Vulcain labels: {row['vulcain_labels']}")
        if row["erp_missing"]:
            lines.append("  *** Account has no balance in ERP (no entries) ***")
        else:
            erp_entries_total = sum(j["entries"] for j in row["_journal_detail"])
            vulcain_entries_total = sum(j["vulcain_entries"] for j in row["_journal_detail"])
            vulcain_debit_total = sum(j["vulcain_debit"] for j in row["_journal_detail"])
            vulcain_credit_total = sum(j["vulcain_credit"] for j in row["_journal_detail"])
            vulcain_balance_total = sum(j["vulcain_balance"] for j in row["_journal_detail"])
            lines.append(
                f"  ERP total:      entries={erp_entries_total:<4}  debit={row['erp_debit']:.2f}  "
                f"credit={row['erp_credit']:.2f}  balance={row['erp_net']:.2f}"
            )
            lines.append(
                f"  Vulcain total:  entries={vulcain_entries_total:<4}  debit={vulcain_debit_total:.2f}  "
                f"credit={vulcain_credit_total:.2f}  balance={vulcain_balance_total:.2f}"
            )
        if row["_journal_detail"]:
            lines.append("  By journal:")
            for j in row["_journal_detail"]:
                lines.append(
                    f"    {j['journal']:<6}  debit={j['debit']:>12.2f}  "
                    f"credit={j['credit']:>12.2f}  ({j['entries']} entries)  "
                    f"vulcain: {j['vulcain_entries']} entries  "
                    f"balance={j['vulcain_balance']:>12.2f}"
                )

    if unmatched:
        lines += [
            "",
            "--- Vulcain Accounts with No ERP Match ---",
            f"  {'Vulcain Code':<15}  {'Side':<10}  {'Solde':>14}  Label",
        ]
        for acc in sorted(unmatched, key=lambda a: a["vulcain_code"]):
            lines.append(
                f"  {acc['vulcain_code']:<15}  {acc['side']:<10}  "
                f"{acc['solde']:>14.2f}  {acc['label']}"
            )

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def write_detail_csv(comparison_rows: list[dict], path: Path) -> None:
    fieldnames = [
        "erp_code", "erp_name", "side", "status",
        "vulcain_codes", "vulcain_labels", "vulcain_solde", "vulcain_solde_n1",
        "erp_debit", "erp_credit", "erp_net", "expected_erp_net", "diff",
        "journal_breakdown",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in comparison_rows:
            w.writerow({
                **row,
                "status": _flag(row),
                "vulcain_solde": f"{row['vulcain_solde']:.2f}",
                "vulcain_solde_n1": f"{row['vulcain_solde_n1']:.2f}",
                "erp_debit": f"{row['erp_debit']:.2f}",
                "erp_credit": f"{row['erp_credit']:.2f}",
                "erp_net": f"{row['erp_net']:.2f}",
                "expected_erp_net": f"{row['expected_erp_net']:.2f}",
                "diff": f"{row['diff']:.2f}",
            })


def write_entries_csv(
    flagged_rows: list[dict],
    conn,
    fy_uuid: str,
    path: Path,
    threshold: Decimal,
) -> int:
    """Write per-entry details for accounts with |diff| > threshold."""
    fieldnames = [
        "erp_code", "erp_name", "side", "diff",
        "entry_date", "journal", "reference", "description",
        "line_description", "debit", "credit",
    ]
    count = 0
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in flagged_rows:
            if abs(row["diff"]) <= threshold:
                continue
            entries = load_erp_entries_for_account(conn, fy_uuid, row["erp_code"])
            for e in entries:
                w.writerow({
                    "erp_code": row["erp_code"],
                    "erp_name": row["erp_name"],
                    "side": row["side"],
                    "diff": f"{row['diff']:.2f}",
                    "entry_date": e["entry_date"],
                    "journal": e["journal"],
                    "reference": e["reference"],
                    "description": e["description"],
                    "line_description": e["line_description"],
                    "debit": f"{e['debit']:.4f}",
                    "credit": f"{e['credit']:.4f}",
                })
                count += 1
    return count


def print_account_drilldown(conn, fy_uuid: str, erp_code: str) -> None:
    """Print all ERP entries for a given account code (--account flag)."""
    entries = load_erp_entries_for_account(conn, fy_uuid, erp_code)
    if not entries:
        print(f"  No entries found for ERP account '{erp_code}' in FY2026.")
        return

    total_d = sum(e["debit"] for e in entries)
    total_c = sum(e["credit"] for e in entries)

    print(f"\n  Account {erp_code} — {len(entries)} lines in FY2026")
    print(f"  {'Date':<12}  {'Journal':<8}  {'Reference':<12}  {'Debit':>12}  {'Credit':>12}  Description")
    print(f"  {'-'*12}  {'-'*8}  {'-'*12}  {'-'*12}  {'-'*12}  -----------")
    for e in entries:
        desc = (e["line_description"] or e["description"])[:60]
        print(
            f"  {e['entry_date']:<12}  {e['journal']:<8}  {e['reference']:<12}  "
            f"{e['debit']:>12.4f}  {e['credit']:>12.4f}  {desc}"
        )
    print(f"  {'TOTAL':<12}  {'':8}  {'':12}  {total_d:>12.4f}  {total_c:>12.4f}  net={total_d-total_c:.4f}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    export_accounts = "--export-accounts" in args
    threshold = Decimal("0.10")
    account_filter: str | None = None
    account_file: Path | None = None

    i = 0
    while i < len(args):
        if args[i] == "--threshold" and i + 1 < len(args):
            threshold = Decimal(args[i + 1])
            i += 2
        elif args[i] == "--account" and i + 1 < len(args):
            account_filter = args[i + 1]
            i += 2
        elif args[i] == "--account-file" and i + 1 < len(args):
            account_file = Path(args[i + 1])
            i += 2
        else:
            i += 1

    print("=== ERP Account Balance Check ===")
    print(f"  CB file: {CB_FILE.name}")
    print(f"  CR file: {CR_FILE.name}")
    print(f"  Threshold: {threshold}")
    if account_file:
        print(f"  Account mapping file: {account_file}")
    elif ACCOUNT_MAPPING_FILE.exists():
        print(f"  (tip: shared mapping file found at {ACCOUNT_MAPPING_FILE.name} — use --account-file to load it)")
    if dry_run:
        print("  [DRY RUN — no output files written]")
    print()

    # Parse Vulcain reports
    print("Parsing Vulcain reports…")
    cb_accounts, cb_totals = parse_vulcain_report(CB_FILE)
    cr_accounts, cr_totals = parse_vulcain_report(CR_FILE)
    all_vulcain = cb_accounts + cr_accounts
    print(
        f"  CB: {len(cb_accounts)} accounts  "
        f"(actifs={sum(1 for a in cb_accounts if a['side']=='actif')}, "
        f"passifs={sum(1 for a in cb_accounts if a['side']=='passif')})"
    )
    print(
        f"  CR: {len(cr_accounts)} accounts  "
        f"(charges={sum(1 for a in cr_accounts if a['side']=='charges')}, "
        f"produits={sum(1 for a in cr_accounts if a['side']=='produits')})"
    )
    print(
        f"  CB totals — Actifs: {cb_totals.get('total_left', 0):.2f}  "
        f"Passifs: {cb_totals.get('total_right', 0):.2f}  "
        f"Result: {cb_totals.get('result', 0):.2f}"
    )
    print(
        f"  CR totals — Charges: {cr_totals.get('total_left', 0):.2f}  "
        f"Produits: {cr_totals.get('total_right', 0):.2f}  "
        f"Result: {cr_totals.get('result', 0):.2f}"
    )

    # Connect and load ERP data
    print("\nConnecting to ERP database…")
    conn = _connect()
    print("  Connected.")

    print("Loading ERP account balances for FY2026…")
    erp_data = load_erp_data(conn)
    print(
        f"  FY2026: {erp_data['fy_start']} → {erp_data['fy_end']}  "
        f"| {len(erp_data['erp_accounts'])} accounts  "
        f"| {len(erp_data['erp_balances'])} with entries"
    )

    # --export-accounts: merge into shared mapping file and exit
    if export_accounts:
        out_path = ACCOUNT_MAPPING_FILE
        n = export_account_matching(all_vulcain, erp_data, out_path)
        conn.close()
        print(f"\nMerged/written {n} account mappings → {out_path}")
        print("Edit 'erp_code' values to correct wrong matches, then re-run with:")
        print(f"  --account-file {out_path}")
        return

    # --account drilldown mode
    if account_filter:
        print(f"\nDrilling down into ERP account '{account_filter}'…")
        print_account_drilldown(conn, erp_data["fy_uuid"], account_filter)
        conn.close()
        return

    # Load account matching file if provided
    account_matching: dict[str, str | None] | None = None
    if account_file:
        print(f"\nLoading account mapping from {account_file}…")
        account_matching = load_account_matching(account_file)
        overrides = sum(1 for v in account_matching.values() if v is not None)
        exclusions = sum(1 for v in account_matching.values() if v is None)
        print(f"  {len(account_matching)} entries loaded ({overrides} mapped, {exclusions} excluded)")

    # Load raw Vulcain ledger for the per-journal breakdown (entry count + balance)
    erp_codes_sorted = _build_erp_code_list(erp_data["erp_accounts"])
    vulcain_journal_by_account = load_vulcain_journal_breakdown(
        VULCAIN_ENTRIES_FILE, erp_codes_sorted, account_matching
    )
    if vulcain_journal_by_account:
        print(f"  Vulcain ledger loaded: {VULCAIN_ENTRIES_FILE.name}")
    else:
        print(f"  (no Vulcain ledger found at {VULCAIN_ENTRIES_FILE.name} — journal breakdown will show 0 vulcain entries)")

    # Compare
    print("\nComparing…")
    comparison_rows, unmatched = compare(
        all_vulcain, erp_data, threshold, account_matching, vulcain_journal_by_account
    )
    flagged = [r for r in comparison_rows if r["flagged"]]
    print(
        f"  {len(comparison_rows)} account groups  "
        f"| {len(flagged)} flagged  "
        f"| {len(unmatched)} Vulcain codes with no ERP match"
    )

    # Build text report
    report_text = build_report(
        comparison_rows, unmatched, cb_totals, cr_totals, erp_data, threshold
    )
    print("\n" + report_text)

    if dry_run:
        conn.close()
        print("[DRY RUN] No files written.")
        return

    # Write outputs
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    report_path = OUTPUT_DIR / "check_account_report.txt"
    report_path.write_text(report_text, encoding="utf-8")
    print(f"  Written → {report_path.name}")

    detail_path = OUTPUT_DIR / "check_account_detail.csv"
    write_detail_csv(comparison_rows, detail_path)
    print(f"  Written → {detail_path.name}")

    entries_path = OUTPUT_DIR / "check_account_entries.csv"
    n_entry_lines = write_entries_csv(flagged, conn, erp_data["fy_uuid"], entries_path, threshold)
    print(f"  Written {n_entry_lines} entry lines → {entries_path.name}")

    conn.close()
    print(f"\nDone. Review {OUTPUT_DIR}/check_account_report.txt")
    if flagged:
        print(
            f"  {len(flagged)} flagged accounts — "
            f"use --account <code> to drill into individual ERP entries."
        )


if __name__ == "__main__":
    main()
