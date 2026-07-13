"""
ERP-CLUB - VI Entry Matching Tool
Copyright (C) 2026  SAFORCADA Patrick

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Match individual VI transactions between Vulcain and ERP.

Purpose:
  Find which VI transactions are matched between Vulcain (411100601/411100610)
  and ERP (419100/7067), identify same-day VI flows, and spot refunds/missing entries.

Output files (in output/):
  check_vi_entries_matched.csv    matched pairs (date, amount, type, description)
  check_vi_entries_orphaned.csv   unmatched entries (one per row)
  check_vi_entries_report.txt     human-readable summary

Usage:
  python check_vi_entries_matching.py
"""

import csv
import json
import os
from collections import defaultdict
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

VULCAIN_ENTRIES_FILE = LEGACY_DIR / "V_comptabilité_validée_2026.csv"


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
    raise RuntimeError("DATABASE_URL not found")


def _connect() -> psycopg2.extensions.connection:
    url = _load_db_url()
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return psycopg2.connect(url)


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def _parse_date(val: str) -> str:
    """DD/MM/YY or DD/MM/YYYY → YYYY-MM-DD."""
    val = (val or "").strip()
    for fmt in ("%d/%m/%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(val, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {val!r}")


def _clean_amount(val: str) -> Decimal:
    """Parse French-formatted decimal."""
    if not val:
        return Decimal("0")
    cleaned = val.strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    if not cleaned or cleaned == "-":
        return Decimal("0")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return Decimal("0")


# ---------------------------------------------------------------------------
# Load Vulcain VI entries
# ---------------------------------------------------------------------------

def load_vulcain_vi_entries() -> dict:
    """
    Load individual Vulcain VI entries, keyed by (date, account).
    Returns dict of {(date, account): [entries]}.
    Each entry has: date, account, debit, credit, amount (signed), description, reference
    """
    entries = defaultdict(list)

    with open(VULCAIN_ENTRIES_FILE, encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            try:
                date = _parse_date(row.get("date_de_valeur", ""))
            except ValueError:
                continue

            if "2026" not in date:
                continue

            compte = (row.get("compte") or "").strip()
            if not (compte.startswith("411100601") or compte.startswith("411100610")):
                continue

            account = compte[:9]
            debit = _clean_amount(row.get("débit", "") or row.get("d\xa9bit", ""))
            credit = _clean_amount(row.get("crédit", "") or row.get("cr\xa9dit", ""))
            amount = debit - credit  # signed amount

            # Try both possible column name encodings
            description = (row.get("libellé", "") or row.get("libell\xe9", "") or "").strip()

            entry = {
                "date": date,
                "account": account,
                "debit": debit,
                "credit": credit,
                "amount": amount,
                "description": description,
                "reference": "",  # Vulcain CSV doesn't have explicit reference column
                "source": "Vulcain",
            }
            entries[(date, account)].append(entry)

    return dict(entries)


# ---------------------------------------------------------------------------
# Load ERP VI entries
# ---------------------------------------------------------------------------

def load_erp_vi_entries(conn) -> dict:
    """
    Load individual ERP VI entries from 419100 and 7067.
    Returns dict of {(date, account): [entries]}.
    Each entry has: date, account, debit, credit, amount (signed), description, reference
    """
    cur = conn.cursor()

    # Get fiscal year UUID
    cur.execute(
        "SELECT uuid FROM accounting_fiscal_years WHERE code = 'FY2026' LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("Fiscal year FY2026 not found")
    fy_uuid = row[0]

    # Get account UUIDs
    cur.execute(
        "SELECT uuid, code FROM accounting_accounts WHERE code IN ('419100', '7067')"
    )
    accounts = {row[1]: row[0] for row in cur.fetchall()}

    # Query entries
    entries = defaultdict(list)
    for code, uuid in accounts.items():
        cur.execute(
            """
            SELECT al.entry_uuid, ae.entry_date, al.debit, al.credit, al.description,
                   ae.reference
            FROM accounting_lines al
            JOIN accounting_entries ae ON ae.uuid = al.entry_uuid AND ae.fiscal_year_uuid = al.fiscal_year_uuid
            WHERE al.account_uuid = %s AND al.fiscal_year_uuid = %s
            ORDER BY ae.entry_date
            """,
            (uuid, fy_uuid)
        )
        for row in cur.fetchall():
            entry_uuid, entry_date, debit, credit, description, reference = row
            debit = Decimal(str(debit or 0))
            credit = Decimal(str(credit or 0))
            amount = debit - credit

            entry = {
                "date": entry_date.strftime("%Y-%m-%d"),
                "account": code,
                "entry_uuid": str(entry_uuid),
                "debit": debit,
                "credit": credit,
                "amount": amount,
                "description": (description or "").strip(),
                "reference": (reference or "").strip(),
                "source": "ERP",
            }
            entries[(entry_date.strftime("%Y-%m-%d"), code)].append(entry)

    return dict(entries)


# ---------------------------------------------------------------------------
# Matching logic
# ---------------------------------------------------------------------------

def _normalize_description(desc: str) -> str:
    """Extract key identifiers from description for matching."""
    desc_upper = (desc or "").upper().strip()
    # Extract HelloAsso N° or AVAT N° references
    import re
    match = re.search(r"N[°#]?(\d+)", desc_upper)
    if match:
        return "N" + match.group(1)
    # Extract VI/JD references
    match = re.search(r"(VI|JD)[\s-]?(\d+|[A-Z]+[\d.]+)", desc_upper)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    return desc_upper[:20]


def match_entries(vulcain_entries: dict, erp_entries: dict) -> tuple[list, list, list]:
    """
    Match Vulcain and ERP entries with more flexible logic.
    Strategy: match by date + amount, with description verification.
    """
    matched_pairs = []
    orphaned_vulcain = []
    orphaned_erp = []

    # Track which ERP entries have been matched
    erp_used = set()

    # Process each Vulcain entry
    for (v_date, v_acct), v_list in vulcain_entries.items():
        for v_entry in v_list:
            v_amount = v_entry["amount"]
            v_norm_desc = _normalize_description(v_entry["description"])
            found = False

            # For 411100601, try to match against 419100
            # For 411100610, try both 419100 (advance side) and 7067 (revenue side)
            candidate_keys = []
            if v_acct == "411100601":
                candidate_keys.append((v_date, "419100"))
            elif v_acct == "411100610":
                candidate_keys.append((v_date, "7067"))
                candidate_keys.append((v_date, "419100"))

            for e_key in candidate_keys:
                if e_key not in erp_entries or found:
                    continue

                e_list = erp_entries[e_key]
                for idx, e_entry in enumerate(e_list):
                    entry_id = (e_key, idx)
                    if entry_id in erp_used:
                        continue

                    e_amount = e_entry["amount"]
                    e_norm_desc = _normalize_description(e_entry["description"])

                    # Prefer exact amount match
                    if abs(e_amount - v_amount) < Decimal("0.01"):
                        # If descriptions share key reference, it's a match
                        if v_norm_desc and e_norm_desc and v_norm_desc == e_norm_desc:
                            matched_pairs.append({
                                "date": v_date,
                                "v_account": v_entry["account"],
                                "e_account": e_entry["account"],
                                "amount": v_amount,
                                "v_description": v_entry["description"],
                                "e_description": e_entry["description"],
                                "v_reference": v_entry["reference"],
                                "e_reference": e_entry["reference"],
                                "type": "normal" if v_acct != "411100610" else "realized",
                            })
                            erp_used.add(entry_id)
                            found = True
                            break
                        # Or if descriptions are very similar (contain same words)
                        elif v_norm_desc and e_norm_desc:
                            v_words = set(v_norm_desc.split())
                            e_words = set(e_norm_desc.split())
                            overlap = len(v_words & e_words)
                            if overlap >= 2:  # At least 2 words in common
                                matched_pairs.append({
                                    "date": v_date,
                                    "v_account": v_entry["account"],
                                    "e_account": e_entry["account"],
                                    "amount": v_amount,
                                    "v_description": v_entry["description"],
                                    "e_description": e_entry["description"],
                                    "v_reference": v_entry["reference"],
                                    "e_reference": e_entry["reference"],
                                    "type": "normal" if v_acct != "411100610" else "realized",
                                })
                                erp_used.add(entry_id)
                                found = True
                                break

            if not found:
                orphaned_vulcain.append(v_entry)

    # Find orphaned ERP entries
    for (e_date, e_acct), e_list in erp_entries.items():
        for idx, e_entry in enumerate(e_list):
            if ((e_date, e_acct), idx) not in erp_used:
                orphaned_erp.append(e_entry)

    return matched_pairs, orphaned_vulcain, orphaned_erp


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def build_report(matched: list, orphaned_v: list, orphaned_e: list) -> str:
    """Generate matching report."""
    lines = [
        "=== VI Entry Matching Report (Vulcain vs ERP) ===",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Fiscal year: 2026",
        "",
        f"--- Summary ---",
        f"Matched entries:      {len(matched)}",
        f"Orphaned Vulcain:     {len(orphaned_v)}",
        f"Orphaned ERP:         {len(orphaned_e)}",
        "",
    ]

    if orphaned_v:
        lines.extend([
            "--- Vulcain entries NOT in ERP ---",
            "(These should be investigated: refunds, duplicates, or missing imports)",
            "",
        ])
        for entry in orphaned_v:
            type_label = "ADVANCE" if entry["account"] == "411100601" else "REALIZED"
            lines.append(
                f"  {entry['date']}  [{type_label}]  {entry['amount']:>10.2f}  "
                f"desc='{entry['description'][:40]}' ref='{entry['reference']}'"
            )
        lines.append("")

        # Categorize orphaned Vulcain entries
        refunds = [e for e in orphaned_v if e["credit"] > 0]
        advances = [e for e in orphaned_v if e["account"] == "411100601" and e["debit"] > 0]
        realized = [e for e in orphaned_v if e["account"] == "411100610"]

        lines.extend([
            f"Breakdown:",
            f"  Refunds (credit entries):    {len(refunds)}",
            f"  Advances (debit entries):    {len(advances)}",
            f"  Realized (411100610):        {len(realized)}",
            "",
        ])

    if orphaned_e:
        lines.extend([
            "--- ERP entries NOT in Vulcain ---",
            "(These may be ERP-only records, refunds, or data entry errors)",
            "",
        ])
        for entry in orphaned_e:
            lines.append(
                f"  {entry['date']}  [{entry['account']}]  {entry['amount']:>10.2f}  "
                f"desc='{entry['description'][:40]}' ref='{entry['reference']}'"
            )
        lines.append("")

    lines.extend([
        "--- Next Steps ---",
        "1. Review orphaned Vulcain entries — are they refunds, duplicates, or missing in ERP?",
        "2. Review orphaned ERP entries — are they ERP-only or failed imports from Vulcain?",
        "3. Cross-check descriptions for partial matches (typos, abbreviations).",
        "4. Verify insurance entries (6169/401) are tracked consistently in both systems.",
    ])

    return "\n".join(lines) + "\n"


def write_csv_matched(matched: list, path: Path) -> None:
    """Write matched pairs to CSV."""
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "date", "v_account", "e_account", "amount",
                "v_description", "e_description", "v_reference", "e_reference", "type"
            ],
        )
        writer.writeheader()
        writer.writerows(matched)


def write_csv_orphaned(entries: list, path: Path) -> None:
    """Write orphaned entries to CSV."""
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "date", "account", "debit", "credit", "amount",
                "description", "reference", "source"
            ],
        )
        writer.writeheader()
        for entry in entries:
            writer.writerow({
                "date": entry["date"],
                "account": entry["account"],
                "debit": entry["debit"],
                "credit": entry["credit"],
                "amount": entry["amount"],
                "description": entry["description"],
                "reference": entry["reference"],
                "source": entry["source"],
            })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Loading Vulcain VI entries...")
    vulcain_entries = load_vulcain_vi_entries()
    vulcain_count = sum(len(v) for v in vulcain_entries.values())
    print(f"  Found {vulcain_count} Vulcain entries")

    print("Loading ERP VI entries...")
    conn = _connect()
    erp_entries = load_erp_vi_entries(conn)
    conn.close()
    erp_count = sum(len(e) for e in erp_entries.values())
    print(f"  Found {erp_count} ERP entries")

    print("Matching entries...")
    matched, orphaned_v, orphaned_e = match_entries(vulcain_entries, erp_entries)

    print("Generating report...")
    report = build_report(matched, orphaned_v, orphaned_e)

    # Write files
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    matched_path = OUTPUT_DIR / "check_vi_entries_matched.csv"
    write_csv_matched(matched, matched_path)

    orphaned_path = OUTPUT_DIR / "check_vi_entries_orphaned.csv"
    write_csv_orphaned(orphaned_v + orphaned_e, orphaned_path)

    report_path = OUTPUT_DIR / "check_vi_entries_report.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)

    # Print to console
    print()
    print(report)
    print(f"Written → {matched_path.name}")
    print(f"Written → {orphaned_path.name}")
    print(f"Written → {report_path.name}")


if __name__ == "__main__":
    main()
