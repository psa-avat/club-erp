"""
ERP-CLUB - VI Insurance Tracking Verification
Copyright (C) 2026  SAFORCADA Patrick

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Verify that VI realization entries (account 7067) have corresponding
insurance expense (6169) and payable (401) entries.

Note: 616 (Primes d'assurances) is a non-postable header account in the PCG
(is_posting_allowed=false) — actual VI insurance postings go to its sub-account
6169 (Assurance VI/JD FFVP). Querying 616 directly always returns zero rows.

Purpose:
  For each VI realization in 7067, check if there's a matching insurance
  entry in 6169 (expense) and 401 (payable) on the same date or nearby.
  Identifies missing insurance entries and premium inconsistencies.

Output files (in output/):
  check_vi_insurance_report.txt    human-readable summary
  check_vi_insurance_detail.csv    per-entry insurance matching

Usage:
  python check_vi_insurance_tracking.py
"""

import csv
import os
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TOOLS_DIR = Path(__file__).parent.resolve()
OUTPUT_DIR = TOOLS_DIR / "output"


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
# Load VI and Insurance Data
# ---------------------------------------------------------------------------

def load_vi_and_insurance_data(conn) -> dict:
    """
    Load VI realizations (7067) and insurance entries (6169, 401) from ERP.
    Returns structured data for matching.
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
        "SELECT uuid, code FROM accounting_accounts WHERE code IN ('7067', '6169', '401')"
    )
    accounts = {row[1]: row[0] for row in cur.fetchall()}

    data = {
        "vi_realizations": [],      # 7067 entries (credit = revenue)
        "insurance_expense": [],     # 6169 entries (debit = expense)
        "insurance_payable": [],     # 401 entries (credit = payable)
    }

    # Load VI realizations (7067)
    cur.execute(
        """
        SELECT ae.entry_date, al.debit, al.credit, al.description,
               ae.reference, ae.uuid, ae.entry_date AT TIME ZONE 'UTC'
        FROM accounting_lines al
        JOIN accounting_entries ae ON ae.uuid = al.entry_uuid AND ae.fiscal_year_uuid = al.fiscal_year_uuid
        WHERE al.account_uuid = %s AND al.fiscal_year_uuid = %s
        ORDER BY ae.entry_date
        """,
        (accounts["7067"], fy_uuid)
    )
    for row in cur.fetchall():
        entry_date, debit, credit, description, reference, entry_uuid, _ = row
        # VI revenue is a credit (account 7067 is income, so credit = negative balance)
        if credit > 0:  # Only count actual revenue entries (credits)
            data["vi_realizations"].append({
                "date": entry_date.strftime("%Y-%m-%d"),
                "date_obj": entry_date,
                "amount": Decimal(str(credit)),
                "description": (description or "").strip(),
                "reference": (reference or "").strip(),
                "entry_uuid": str(entry_uuid),
            })

    # Load insurance expense (6169) - debit = expense
    cur.execute(
        """
        SELECT ae.entry_date, al.debit, al.credit, al.description,
               ae.reference, ae.uuid
        FROM accounting_lines al
        JOIN accounting_entries ae ON ae.uuid = al.entry_uuid AND ae.fiscal_year_uuid = al.fiscal_year_uuid
        WHERE al.account_uuid = %s AND al.fiscal_year_uuid = %s
        ORDER BY ae.entry_date
        """,
        (accounts["6169"], fy_uuid)
    )
    for row in cur.fetchall():
        entry_date, debit, credit, description, reference, entry_uuid = row
        if debit > 0:  # Debit = expense
            data["insurance_expense"].append({
                "date": entry_date.strftime("%Y-%m-%d"),
                "date_obj": entry_date,
                "amount": Decimal(str(debit)),
                "description": (description or "").strip(),
                "reference": (reference or "").strip(),
                "entry_uuid": str(entry_uuid),
            })

    # Load insurance payable (401) - credit = payable
    cur.execute(
        """
        SELECT ae.entry_date, al.debit, al.credit, al.description,
               ae.reference, ae.uuid
        FROM accounting_lines al
        JOIN accounting_entries ae ON ae.uuid = al.entry_uuid AND ae.fiscal_year_uuid = al.fiscal_year_uuid
        WHERE al.account_uuid = %s AND al.fiscal_year_uuid = %s
        ORDER BY ae.entry_date
        """,
        (accounts["401"], fy_uuid)
    )
    for row in cur.fetchall():
        entry_date, debit, credit, description, reference, entry_uuid = row
        if credit > 0:  # Credit = payable (liability)
            data["insurance_payable"].append({
                "date": entry_date.strftime("%Y-%m-%d"),
                "date_obj": entry_date,
                "amount": Decimal(str(credit)),
                "description": (description or "").strip(),
                "reference": (reference or "").strip(),
                "entry_uuid": str(entry_uuid),
            })

    return data


# ---------------------------------------------------------------------------
# Matching and Analysis
# ---------------------------------------------------------------------------

def match_vi_to_insurance(data: dict) -> tuple[list, list]:
    """
    Match VI realizations to insurance entries.
    Returns (matched, unmatched_vi).
    """
    matched = []
    unmatched_vi = []

    # Group insurance by date for quick lookup
    exp_by_date = defaultdict(list)
    pay_by_date = defaultdict(list)
    for exp in data["insurance_expense"]:
        exp_by_date[exp["date"]].append(exp)
    for pay in data["insurance_payable"]:
        pay_by_date[pay["date"]].append(pay)

    # Process each VI realization
    for vi in data["vi_realizations"]:
        vi_date = vi["date"]
        vi_amount = vi["amount"]

        # Look for matching insurance entries on same date
        exps = exp_by_date.get(vi_date, [])
        pays = pay_by_date.get(vi_date, [])

        # Find expense and payable entries for this date
        # Typically insurance is a fixed amount per VI (e.g., 20€)
        found_exp = None
        found_pay = None

        # Try to match by amount (insurance premium is usually consistent)
        for exp in exps:
            if exp["amount"] > 0:
                found_exp = exp
                break

        for pay in pays:
            if pay["amount"] > 0 and found_exp and found_exp["amount"] == pay["amount"]:
                found_pay = pay
                break

        if found_exp and found_pay:
            matched.append({
                "date": vi_date,
                "vi_amount": vi_amount,
                "insurance_amount": found_exp["amount"],
                "vi_reference": vi["reference"],
                "vi_description": vi["description"],
                "exp_reference": found_exp["reference"],
                "pay_reference": found_pay["reference"],
                "status": "OK" if found_exp["amount"] == found_pay["amount"] else "MISMATCH",
            })
        else:
            unmatched_vi.append({
                "date": vi_date,
                "amount": vi_amount,
                "reference": vi["reference"],
                "description": vi["description"],
                "has_expense": bool(found_exp),
                "has_payable": bool(found_pay),
            })

    return matched, unmatched_vi


# ---------------------------------------------------------------------------
# Report Generation
# ---------------------------------------------------------------------------

def build_report(matched: list, unmatched: list, total_vi: int) -> str:
    """Generate insurance tracking report."""
    lines = [
        "=== VI Insurance Tracking Verification ===",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Fiscal year: 2026",
        "",
        "--- Summary ---",
        f"Total VI realizations:     {total_vi}",
        f"VI with insurance:         {len(matched)}",
        f"VI without insurance:      {len(unmatched)}",
        f"Coverage:                  {len(matched) * 100 / total_vi:.1f}%" if total_vi > 0 else "N/A",
        "",
    ]

    if unmatched:
        lines.extend([
            "--- VI Entries WITHOUT Matching Insurance ---",
            "(These should have both 6169 expense and 401 payable entries)",
            "",
        ])
        for item in unmatched[:30]:  # Show first 30
            status = []
            if not item["has_expense"]:
                status.append("missing 6169")
            if not item["has_payable"]:
                status.append("missing 401")
            lines.append(
                f"  {item['date']}  VI {item['amount']:>7.2f}  {' + '.join(status):<20}  "
                f"ref='{item['reference'][:30]}'"
            )

        if len(unmatched) > 30:
            lines.append(f"  ... and {len(unmatched) - 30} more")

        lines.append("")

    if matched:
        lines.extend([
            "--- Sample Matched VI with Insurance (first 10) ---",
            "",
        ])
        for item in matched[:10]:
            diff = ""
            if item["vi_amount"] != item["insurance_amount"]:
                diff = f"  ⚠️ VI={item['vi_amount']:.2f} but insurance={item['insurance_amount']:.2f}"
            lines.append(
                f"  {item['date']}  VI {item['vi_amount']:>7.2f}  insurance {item['insurance_amount']:>6.2f}{diff}"
            )

        lines.append("")

    # Analyze insurance premium consistency
    if matched:
        premiums = [m["insurance_amount"] for m in matched]
        from statistics import mean, stdev
        avg_premium = mean(premiums)
        lines.extend([
            "--- Insurance Premium Analysis ---",
            f"Insurance entries analyzed: {len(matched)}",
            f"Average premium per VI:     €{avg_premium:.2f}",
            f"Min premium:                €{min(premiums):.2f}",
            f"Max premium:                €{max(premiums):.2f}",
            "",
        ])
        if len(set(premiums)) > 1:
            lines.append("⚠️  Multiple different insurance premium amounts detected.")
            lines.append("   Expected: consistent insurance fee per VI.")

    lines.extend([
        "--- Recommendations ---",
        "1. If VI without insurance > 0: check if insurance entries were created for those VI.",
        "2. If insurance amounts vary: verify pricing rules haven't changed.",
        "3. Link insurance entries to VI flights by date and validate amounts.",
    ])

    return "\n".join(lines) + "\n"


def write_detail_csv(matched: list, unmatched: list, path: Path) -> None:
    """Write detailed matching data to CSV."""
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "date", "vi_amount", "insurance_amount", "status",
                "vi_reference", "vi_description", "exp_reference", "pay_reference",
                "has_insurance"
            ],
        )
        writer.writeheader()

        for item in matched:
            writer.writerow({
                "date": item["date"],
                "vi_amount": item["vi_amount"],
                "insurance_amount": item["insurance_amount"],
                "status": item["status"],
                "vi_reference": item["vi_reference"],
                "vi_description": item["vi_description"],
                "exp_reference": item["exp_reference"],
                "pay_reference": item["pay_reference"],
                "has_insurance": "YES",
            })

        for item in unmatched:
            writer.writerow({
                "date": item["date"],
                "vi_amount": item["amount"],
                "insurance_amount": "",
                "status": "MISSING",
                "vi_reference": item["reference"],
                "vi_description": item["description"],
                "exp_reference": "",
                "pay_reference": "",
                "has_insurance": "NO",
            })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Loading VI and insurance data...")
    conn = _connect()
    data = load_vi_and_insurance_data(conn)
    conn.close()

    print(f"  VI realizations (7067):     {len(data['vi_realizations'])} entries")
    print(f"  Insurance expense (6169):   {len(data['insurance_expense'])} entries")
    print(f"  Insurance payable (401):    {len(data['insurance_payable'])} entries")

    print("Matching VI to insurance...")
    matched, unmatched = match_vi_to_insurance(data)

    print("Generating report...")
    report = build_report(matched, unmatched, len(data["vi_realizations"]))

    # Write files
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    detail_path = OUTPUT_DIR / "check_vi_insurance_detail.csv"
    write_detail_csv(matched, unmatched, detail_path)

    report_path = OUTPUT_DIR / "check_vi_insurance_report.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)

    # Print to console
    print()
    print(report)
    print(f"Written → {detail_path.name}")
    print(f"Written → {report_path.name}")


if __name__ == "__main__":
    main()
