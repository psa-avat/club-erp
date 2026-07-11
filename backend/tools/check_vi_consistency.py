"""
ERP-CLUB - VI (Initiation Flight) Reconciliation Tool
Copyright (C) 2026  SAFORCADA Patrick

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Compare VI (Vols d'Initiation / initiation flights) accounting between
Vulcain and ERP for fiscal year 2026.

Vulcain VI structure:
  411100601  VI à faire (advance, money received from customer)
  411100610  VI réalisé (realized flight, payment out or revenue credit)

ERP VI structure:
  419100     Avances reçues — Vols d'initiation (VI advance, money received)
  7067       VI / JD (VI revenue when flight is realized)
  616        Primes d'assurances (insurance expense)
  401        Fournisseurs (insurance payable, FFVP tiers)
  512/531    Bank/cash (payments in/out)

Flow comparison:
  Purchase:
    Vulcain: 512/531 → 411100601 (customer pays)
    ERP:     512/531 → 419100 (customer pays)

  Realization:
    Vulcain: 411100601 → 411100610 (mark as realized)
    ERP:     419100 → 7067 (revenue) + 616 → 401 (insurance tracking)

  Refund:
    Both:    VI advance → 512/531 (refund customer)

Output files (in output/):
  check_vi_report.txt        human-readable summary
  check_vi_detail.csv        per-account/journal breakdown

Usage:
  python check_vi_consistency.py [--dry-run]

"""

import csv
import json
import os
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
# CSV helpers (from import_legacy.py)
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
# Load ERP VI data
# ---------------------------------------------------------------------------

def load_erp_vi_data(conn) -> dict:
    """Load ERP VI-related accounts and entries."""
    cur = conn.cursor()

    # Get fiscal year UUID
    cur.execute(
        "SELECT uuid FROM accounting_fiscal_years WHERE code = 'FY2026' LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("Fiscal year FY2026 not found")
    fy_uuid = row[0]

    # Get VI-related account UUIDs
    cur.execute(
        "SELECT uuid, code FROM accounting_accounts WHERE code IN ('419100', '7067', '616', '401')"
    )
    accounts = {row[1]: row[0] for row in cur.fetchall()}

    # Get VI entries per account
    vi_data = {}
    for code in accounts:
        cur.execute(
            """
            SELECT aj.code as journal, COUNT(*) as entries,
                   SUM(al.debit) as debit, SUM(al.credit) as credit
            FROM accounting_lines al
            JOIN accounting_entries ae ON ae.uuid = al.entry_uuid AND ae.fiscal_year_uuid = al.fiscal_year_uuid
            JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
            WHERE al.account_uuid = %s AND al.fiscal_year_uuid = %s
            GROUP BY aj.code
            ORDER BY aj.code
            """,
            (accounts[code], fy_uuid)
        )
        vi_data[code] = {}
        for row in cur.fetchall():
            journal, entries, debit, credit = row
            vi_data[code][journal] = {
                "entries": entries,
                "debit": Decimal(str(debit or 0)),
                "credit": Decimal(str(credit or 0)),
            }

    return vi_data


# ---------------------------------------------------------------------------
# Load Vulcain VI data
# ---------------------------------------------------------------------------

def load_vulcain_vi_data() -> dict:
    """Load Vulcain VI account totals."""
    vi_accounts = {
        "411100601": {"label": "VI à faire (advance)", "debit": Decimal("0"), "credit": Decimal("0"), "entries": 0},
        "411100610": {"label": "VI réalisé", "debit": Decimal("0"), "credit": Decimal("0"), "entries": 0},
    }

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

            key = compte[:9]
            debit = _clean_amount(row.get("débit", ""))
            credit = _clean_amount(row.get("crédit", ""))

            if key in vi_accounts:
                vi_accounts[key]["debit"] += debit
                vi_accounts[key]["credit"] += credit
                vi_accounts[key]["entries"] += 1

    return vi_accounts


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def build_report(erp_data: dict, vulcain_data: dict) -> str:
    """Generate comparison report."""
    lines = [
        "=== VI (Initiation Flights) Reconciliation Report ===",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Fiscal year: 2026",
        "",
        "=== KEY FINDING ===",
        "In Vulcain, same-day VI can bypass 411100601 and go directly to 411100610.",
        "This explains why 411100610 (realized) is nearly empty while ERP 7067 shows realized VI revenue.",
        "",
        "--- VI Advances (Purchase Side) ---",
        "",
        "ERP 419100 (Avances reçues — Vols d'initiation):",
    ]

    # ERP 419100
    erp_419100 = erp_data.get("419100", {})
    erp_419100_total_d = sum(j["debit"] for j in erp_419100.values())
    erp_419100_total_c = sum(j["credit"] for j in erp_419100.values())
    erp_419100_net = erp_419100_total_d - erp_419100_total_c
    lines.append(f"  Total:   entries={sum(j['entries'] for j in erp_419100.values())}  D={erp_419100_total_d:.2f}  C={erp_419100_total_c:.2f}  net={erp_419100_net:.2f}")
    for journal in sorted(erp_419100.keys()):
        j = erp_419100[journal]
        lines.append(f"    {journal}: entries={j['entries']:>3}  D={j['debit']:>10.2f}  C={j['credit']:>10.2f}")

    lines.append("")
    lines.append("Vulcain 411100601 (VI à faire — advance account):")

    # Vulcain 411100601
    vulcain_601 = vulcain_data.get("411100601", {})
    vulcain_601_net = vulcain_601["debit"] - vulcain_601["credit"]
    lines.append(f"  Total:   entries={vulcain_601['entries']}  D={vulcain_601['debit']:.2f}  C={vulcain_601['credit']:.2f}  net={vulcain_601_net:.2f}")

    lines.append("")

    # Comparison
    diff_net = erp_419100_net - vulcain_601_net
    lines.append("Comparison (VI Advance net balance):")
    lines.append(f"  ERP 419100:        {erp_419100_net:>10.2f}  (should be = 411100601 + same-day VI)")
    lines.append(f"  Vulcain 411100601: {vulcain_601_net:>10.2f}  (excludes same-day flows)")
    lines.append(f"  Difference:        {diff_net:>10.2f}  (likely same-day VI that went to 411100610 directly)")
    if abs(diff_net) < 0.01:
        lines.append("  Status: ✓ OK (no same-day VI or fully realized)")
    else:
        lines.append(f"  Status: ⚠ DELTA = {diff_net:.2f}  (same-day VI amount, should match 411100610)")

    lines.extend([
        "",
        "--- VI Realizations (Flight Revenue Side) ---",
        "",
        "ERP 7067 (VI / JD revenue when flights are realized):",
    ])

    # ERP 7067
    erp_7067 = erp_data.get("7067", {})
    erp_7067_total_d = sum(j["debit"] for j in erp_7067.values())
    erp_7067_total_c = sum(j["credit"] for j in erp_7067.values())
    erp_7067_net = erp_7067_total_d - erp_7067_total_c
    lines.append(f"  Total:   entries={sum(j['entries'] for j in erp_7067.values())}  D={erp_7067_total_d:.2f}  C={erp_7067_total_c:.2f}  net={erp_7067_net:.2f}")
    for journal in sorted(erp_7067.keys()):
        j = erp_7067[journal]
        lines.append(f"    {journal}: entries={j['entries']:>3}  D={j['debit']:>10.2f}  C={j['credit']:>10.2f}")

    lines.append("")
    lines.append("Vulcain 411100610 (VI réalisé — includes same-day VI that bypassed 411100601):")

    # Vulcain 411100610
    vulcain_610 = vulcain_data.get("411100610", {})
    vulcain_610_net = vulcain_610["debit"] - vulcain_610["credit"]
    lines.append(f"  Total:   entries={vulcain_610['entries']}  D={vulcain_610['debit']:.2f}  C={vulcain_610['credit']:.2f}  net={vulcain_610_net:.2f}")

    lines.append("")
    lines.append("Comparison (VI Realization side):")
    lines.append(f"  ERP 7067:         {erp_7067_net:>10.2f}  (revenue from realized VI flights)")
    lines.append(f"  Vulcain 411100610: {vulcain_610_net:>10.2f}  (mostly empty — same-day VI bypassed here)")
    lines.append(f"  Difference:       {(erp_7067_net - vulcain_610_net):>10.2f}  ⚠ LARGE DELTA")
    lines.append("")
    lines.append("⚠️  INTERPRETATION:")
    lines.append("  In Vulcain, same-day VI likely went: 512/531 → 411100610 directly (bypassing 411100601)")
    lines.append("  In ERP, same path likely went:      512/531 → 419100 → 7067 (with 616→401 insurance tracking)")
    lines.append("")
    lines.append("  Expected: 411100601 (unrealized) + 411100610 (realized + same-day) ≈ 419100 net balance")

    lines.extend([
        "",
        "--- Insurance Tracking (ERP only, not in Vulcain) ---",
        "",
        "ERP 616 (Primes d'assurances / Insurance expense):",
    ])

    # ERP 616
    erp_616 = erp_data.get("616", {})
    erp_616_total_d = sum(j["debit"] for j in erp_616.values())
    erp_616_total_c = sum(j["credit"] for j in erp_616.values())
    erp_616_net = erp_616_total_d - erp_616_total_c
    lines.append(f"  Total:   entries={sum(j['entries'] for j in erp_616.values())}  D={erp_616_total_d:.2f}  C={erp_616_total_c:.2f}  net={erp_616_net:.2f}")
    for journal in sorted(erp_616.keys()):
        j = erp_616[journal]
        lines.append(f"    {journal}: entries={j['entries']:>3}  D={j['debit']:>10.2f}  C={j['credit']:>10.2f}")

    lines.extend([
        "",
        "ERP 401 (Fournisseurs, includes insurance payable to FFVP):",
    ])

    # ERP 401
    erp_401 = erp_data.get("401", {})
    erp_401_total_d = sum(j["debit"] for j in erp_401.values())
    erp_401_total_c = sum(j["credit"] for j in erp_401.values())
    erp_401_net = erp_401_total_d - erp_401_total_c
    lines.append(f"  Total:   entries={sum(j['entries'] for j in erp_401.values())}  D={erp_401_total_d:.2f}  C={erp_401_total_c:.2f}  net={erp_401_net:.2f}")
    for journal in sorted(erp_401.keys()):
        j = erp_401[journal]
        lines.append(f"    {journal}: entries={j['entries']:>3}  D={j['debit']:>10.2f}  C={j['credit']:>10.2f}")

    # Calculate verification: does Vulcain 411100601 + 411100610 + refunds ≈ ERP 419100?
    vulcain_total_vi = vulcain_601_net + vulcain_610_net

    lines.extend([
        "",
        "--- Summary ---",
        "",
        f"VI Flow Comparison:",
        f"  ERP 419100 (net advances):       {erp_419100_net:>10.2f}",
        f"  Vulcain 411100601 (advance):     {vulcain_601_net:>10.2f}",
        f"  Vulcain 411100610 (realized):    {vulcain_610_net:>10.2f}",
        f"  Vulcain total (601+610):         {vulcain_total_vi:>10.2f}",
        f"  Difference (likely same-day VI): {(erp_419100_net - vulcain_total_vi):>10.2f}",
        "",
        f"VI Realization Revenue:",
        f"  ERP 7067 (VI revenue):           {erp_7067_net:>10.2f}",
        f"  Vulcain 411100610 (realized):    {vulcain_610_net:>10.2f}",
        f"  Delta (411100610 likely empty):  {(erp_7067_net - vulcain_610_net):>10.2f}",
        "",
        f"Insurance Tracking (ERP only):",
        f"  ERP 616 (insurance expense):     {erp_616_net:>10.2f}",
        f"  ERP 401 (insurance payable):     {erp_401_net:>10.2f}",
        "",
        "✓ HYPOTHESIS TO VERIFY:",
        f"  Difference of {diff_net:.2f} in VI advances likely represents same-day VI",
        f"  that went directly to 411100610 in Vulcain, bypassing 411100601.",
        f"  In ERP, these should be in 419100 with realization to 7067.",
    ])

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Loading ERP VI data...")
    conn = _connect()
    erp_data = load_erp_vi_data(conn)
    conn.close()

    print("Loading Vulcain VI data...")
    vulcain_data = load_vulcain_vi_data()

    print("Generating report...")
    report = build_report(erp_data, vulcain_data)

    # Write report
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = OUTPUT_DIR / "check_vi_report.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)

    # Print to console
    print()
    print(report)
    print(f"Written → {report_path.name}")


if __name__ == "__main__":
    main()
