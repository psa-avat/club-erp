"""
ERP-CLUB - Member 411 Account Balance Check Tool
Copyright (C) 2026  SAFORCADA Patrick

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Compare per-member 411 account balances between the ERP (FY2026) and Vulcain.

Sources:
  Vulcain: V_comptabilité_validée_2026.csv  (account 411200000, by num_pilote)
           V_pilotes_2026.csv               (pilot n → name / num_FFVV)
           V_vols_validés_2026.csv          (pilote_prix_total / pilote_reduction_total …)
  ERP:     accounting_lines WHERE account.code LIKE '411%'
           grouped by tiers_uuid (member), FL journal = gross flight debit, REM = discount

Output:
  output/check_411t.csv
    Columns: name, member_id, legacy_id,
             debit_erp, credit_erp, flight_debit_erp, discount_erp,
             debit_vulcain, credit_vulcain, flight_debit_vulcain, discount_vulcain,
             balance_diff

balance_diff = (debit_erp − credit_erp) − (debit_vulcain − credit_vulcain)
  A non-zero diff means the ERP net position differs from Vulcain.

Usage:
  python check_411t.py [--dry-run] [--threshold AMOUNT]

  --dry-run           print summary without writing the CSV
  --threshold AMOUNT  only emit rows where |balance_diff| > AMOUNT (default: all rows)
"""

import csv
import os
import sys
import unicodedata
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

COMPTA_FILE = LEGACY_DIR / "V_comptabilité_validée_2026.csv"
PILOTES_FILE = LEGACY_DIR / "V_pilotes_2026.csv"
VOLS_FILE   = LEGACY_DIR / "V_vols_validés_2026.csv"

# Account prefix for pilot receivables in Vulcain
VULCAIN_PILOT_ACCOUNT = "411200000"


# ---------------------------------------------------------------------------
# DB connection (same pattern as import_legacy.py / check_account.py)
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
# Amount parsing (French format: space/nbsp thousands, comma decimal)
# ---------------------------------------------------------------------------

def _clean_amount(val: str) -> Decimal:
    if not val:
        return Decimal("0")
    cleaned = (
        val.strip()
        .replace("\xa0", "")
        .replace(" ", "")
        .replace(" ", "")
        .replace(",", ".")
    )
    if not cleaned or cleaned == "-":
        return Decimal("0")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return Decimal("0")


# ---------------------------------------------------------------------------
# Name normalization (for fallback matching)
# ---------------------------------------------------------------------------

def _normalize_name(s: str) -> str:
    """Fold to ASCII uppercase, strip punctuation."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.upper().strip()


# ---------------------------------------------------------------------------
# Vulcain data loading
# ---------------------------------------------------------------------------

def load_vulcain_pilots(path: Path) -> dict[str, dict]:
    """
    Parse V_pilotes_2026.csv.
    Returns {n: {'n': str, 'nom': str, 'prenom': str, 'ffvv': str}} keyed by pilot n.
    """
    pilots: dict[str, dict] = {}
    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            n = (row.get("n") or "").strip()
            if not n:
                continue
            nom = (row.get("nom") or "").strip()
            prenom = (row.get("prénom") or row.get("prenom") or "").strip()
            ffvv = (row.get("num_FFVV") or "").strip()
            pilots[n] = {
                "n": n,
                "nom": nom,
                "prenom": prenom,
                "ffvv": ffvv,
            }
    return pilots


def load_vulcain_411_balances(path: Path) -> dict[str, dict]:
    """
    Parse V_comptabilité_validée_2026.csv.
    Aggregate debit/credit per num_pilote for rows where compte == VULCAIN_PILOT_ACCOUNT.
    Returns {num_pilote: {'debit': Decimal, 'credit': Decimal}}.
    """
    balances: dict[str, dict] = {}
    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            compte = (row.get("compte") or "").strip()
            if compte != VULCAIN_PILOT_ACCOUNT:
                continue
            n_pilote = (row.get("num_pilote") or "").strip()
            if not n_pilote or n_pilote == "0":
                continue
            debit = _clean_amount(row.get("débit") or "")
            credit = _clean_amount(row.get("crédit") or "")
            if n_pilote not in balances:
                balances[n_pilote] = {"debit": Decimal("0"), "credit": Decimal("0")}
            balances[n_pilote]["debit"] += debit
            balances[n_pilote]["credit"] += credit
    return balances


def load_vulcain_flight_balances(path: Path) -> dict[str, dict]:
    """
    Parse V_vols_validés_2026.csv.
    For each flight row aggregate per pilot:
      flight_debit = pilote_prix_total (or copilote_prix_total for the copilot)
      discount     = pilote_reduction_total (or copilote_reduction_total)
    Returns {n_pilote: {'flight_debit': Decimal, 'discount': Decimal}}.
    """
    ZERO = Decimal("0")
    totals: dict[str, dict] = {}

    def _add(n: str, prix: Decimal, reduc: Decimal) -> None:
        if n not in totals:
            totals[n] = {"flight_debit": ZERO, "discount": ZERO}
        totals[n]["flight_debit"] += prix
        totals[n]["discount"]     += reduc

    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            n_pilote   = (row.get("n_pilote")   or "").strip()
            n_copilote = (row.get("n_copilote") or "").strip()

            if n_pilote and n_pilote != "0":
                _add(
                    n_pilote,
                    _clean_amount(row.get("pilote_prix_total")   or ""),
                    _clean_amount(row.get("pilote_reduction_total") or ""),
                )
            if n_copilote and n_copilote != "0":
                _add(
                    n_copilote,
                    _clean_amount(row.get("copilote_prix_total")   or ""),
                    _clean_amount(row.get("copilote_reduction_total") or ""),
                )
    return totals


# ---------------------------------------------------------------------------
# ERP data loading
# ---------------------------------------------------------------------------

def load_erp_members(conn) -> dict[str, dict]:
    """
    Load all ERP members.
    Returns {uuid: {'uuid': str, 'account_id': str, 'legacy_account_id': str,
                    'first_name': str, 'last_name': str, 'ffvp_id': str|None}}.
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT uuid::text, account_id, legacy_account_id, first_name, last_name, ffvp_id "
        "FROM members ORDER BY account_id"
    )
    members: dict[str, dict] = {}
    for uuid, account_id, legacy_id, first_name, last_name, ffvp_id in cur.fetchall():
        members[uuid] = {
            "uuid": uuid,
            "account_id": account_id or "",
            "legacy_account_id": legacy_id or "",
            "first_name": first_name or "",
            "last_name": last_name or "",
            "ffvp_id": str(int(ffvp_id)) if ffvp_id is not None else None,
        }
    cur.close()
    return members


def load_erp_411_balances(conn) -> tuple[str, dict[str, dict]]:
    """
    Load FY2026 debit/credit totals from accounting_lines for all accounts
    whose code starts with '411', grouped by (tiers_uuid, journal_code).

    Returns (fy_uuid, {tiers_uuid: {
        'debit': Decimal, 'credit': Decimal,
        'flight_debit': Decimal,   # FL journal debit
        'discount': Decimal,       # REM journal credit
    }}).
    """
    cur = conn.cursor()

    cur.execute(
        "SELECT uuid::text FROM accounting_fiscal_years WHERE year = 2026 LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("No fiscal year for 2026 found in the ERP database.")
    fy_uuid = row[0]

    cur.execute(
        """
        SELECT al.tiers_uuid::text,
               aj.code AS journal,
               COALESCE(SUM(al.debit),  0) AS total_debit,
               COALESCE(SUM(al.credit), 0) AS total_credit
        FROM accounting_lines al
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        JOIN accounting_entries  ae ON ae.uuid = al.entry_uuid
                                    AND ae.fiscal_year_uuid = al.fiscal_year_uuid
        JOIN accounting_journals  aj ON aj.uuid = ae.journal_uuid
        WHERE al.fiscal_year_uuid = %s
          AND aa.code LIKE '411%%'
        GROUP BY al.tiers_uuid, aj.code
        """,
        (fy_uuid,),
    )
    ZERO = Decimal("0")
    balances: dict[str, dict] = {}
    for tiers_uuid, journal, total_debit, total_credit in cur.fetchall():
        key = tiers_uuid or "__no_member__"
        if key not in balances:
            balances[key] = {
                "debit": ZERO, "credit": ZERO,
                "flight_debit": ZERO, "discount": ZERO,
            }
        d = Decimal(str(total_debit))
        c = Decimal(str(total_credit))
        balances[key]["debit"]  += d
        balances[key]["credit"] += c
        if journal == "FL":
            balances[key]["flight_debit"] += d
        if journal == "REM":
            balances[key]["discount"] += c
    cur.close()
    return fy_uuid, balances


# ---------------------------------------------------------------------------
# Build pilot → ERP member mapping
# ---------------------------------------------------------------------------

def build_member_map(
    pilots: dict[str, dict],
    erp_members: dict[str, dict],
) -> dict[str, str | None]:
    """
    Map Vulcain pilot n → ERP member uuid.
    Resolution order:
      1. ffvv (num_FFVV) → erp member.ffvp_id
      2. name (nom + prénom, normalized) → erp member name
    Returns {n: uuid | None}.
    """
    by_ffvp: dict[str, str] = {}  # ffvp_id str → member uuid
    by_name: dict[tuple, str] = {}  # (norm_last, norm_first) → member uuid
    for uuid, m in erp_members.items():
        if m["ffvp_id"] is not None:
            by_ffvp[m["ffvp_id"]] = uuid
        key = (
            _normalize_name(m["last_name"]),
            _normalize_name(m["first_name"]),
        )
        by_name[key] = uuid

    mapping: dict[str, str | None] = {}
    for n, pilot in pilots.items():
        ffvv = pilot["ffvv"].lstrip("0")
        resolved: str | None = None
        if ffvv and ffvv.isdigit():
            resolved = by_ffvp.get(ffvv)
        if resolved is None:
            key = (_normalize_name(pilot["nom"]), _normalize_name(pilot["prenom"]))
            resolved = by_name.get(key)
        mapping[n] = resolved
    return mapping


# ---------------------------------------------------------------------------
# Merge and build output rows
# ---------------------------------------------------------------------------

def build_rows(
    vulcain_balances: dict[str, dict],
    vulcain_flight_balances: dict[str, dict],
    erp_balances: dict[str, dict],
    pilots: dict[str, dict],
    erp_members: dict[str, dict],
    pilot_to_erp: dict[str, str | None],
    threshold: Decimal,
    all_rows: bool,
) -> list[dict]:
    """
    Merge Vulcain per-pilot balances with ERP per-member balances.

    For each pilot seen in Vulcain OR each member seen in ERP (on 411):
      - Look up the other side
      - Compute balance_diff = (debit_erp − credit_erp) − (debit_vulcain − credit_vulcain)
    """
    ZERO = Decimal("0")

    # erp_uuid → which Vulcain pilot n maps to it (reverse of pilot_to_erp)
    erp_to_pilot: dict[str, str] = {}
    for n, uuid in pilot_to_erp.items():
        if uuid:
            erp_to_pilot[uuid] = n

    rows: list[dict] = []
    seen_erp_uuids: set[str] = set()

    # --- Rows driven by Vulcain pilots ---
    for n, vbal in sorted(vulcain_balances.items(), key=lambda x: x[0].zfill(6)):
        erp_uuid = pilot_to_erp.get(n)
        pilot = pilots.get(n, {})
        vulcain_name = f"{pilot.get('nom', '')} {pilot.get('prenom', '')}".strip()

        erp_bal = erp_balances.get(erp_uuid, {}) if erp_uuid else {}
        erp_debit         = erp_bal.get("debit",        ZERO)
        erp_credit        = erp_bal.get("credit",       ZERO)
        erp_flight_debit  = erp_bal.get("flight_debit", ZERO)
        erp_discount      = erp_bal.get("discount",     ZERO)

        vflight = vulcain_flight_balances.get(n, {})
        v_debit         = vbal["debit"]
        v_credit        = vbal["credit"]
        v_flight_debit  = vflight.get("flight_debit", ZERO)
        v_discount      = vflight.get("discount",     ZERO)

        diff = (erp_debit - erp_credit) - (v_debit - v_credit)

        if erp_uuid:
            m = erp_members.get(erp_uuid, {})
            member_id  = m.get("account_id", "")
            legacy_id  = m.get("legacy_account_id", "")
            erp_name   = f"{m.get('first_name', '')} {m.get('last_name', '')}".strip()
            name       = erp_name or vulcain_name
            seen_erp_uuids.add(erp_uuid)
        else:
            member_id = f"?pilot_n={n}"
            legacy_id = ""
            name      = vulcain_name

        if not all_rows and abs(diff) <= threshold:
            continue

        rows.append({
            "name":                name,
            "member_id":           member_id,
            "legacy_id":           legacy_id,
            "vulcain_pilot_n":     n,
            "debit_erp":           erp_debit,
            "credit_erp":          erp_credit,
            "flight_debit_erp":    erp_flight_debit,
            "discount_erp":        erp_discount,
            "debit_vulcain":       v_debit,
            "credit_vulcain":      v_credit,
            "flight_debit_vulcain": v_flight_debit,
            "discount_vulcain":    v_discount,
            "balance_diff":        diff,
        })

    # --- ERP-only members (on 411) not matched to any Vulcain pilot ---
    for erp_uuid, erp_bal in erp_balances.items():
        if erp_uuid == "__no_member__" or erp_uuid in seen_erp_uuids:
            continue
        erp_debit        = erp_bal["debit"]
        erp_credit       = erp_bal["credit"]
        erp_flight_debit = erp_bal.get("flight_debit", ZERO)
        erp_discount     = erp_bal.get("discount",     ZERO)
        diff = erp_debit - erp_credit  # no Vulcain side

        if not all_rows and abs(diff) <= threshold:
            continue

        m = erp_members.get(erp_uuid, {})
        member_id = m.get("account_id", erp_uuid[:8] + "…")
        legacy_id = m.get("legacy_account_id", "")
        name      = f"{m.get('first_name', '')} {m.get('last_name', '')}".strip()
        pilot_n   = erp_to_pilot.get(erp_uuid, "")

        rows.append({
            "name":                name,
            "member_id":           member_id,
            "legacy_id":           legacy_id,
            "vulcain_pilot_n":     pilot_n,
            "debit_erp":           erp_debit,
            "credit_erp":          erp_credit,
            "flight_debit_erp":    erp_flight_debit,
            "discount_erp":        erp_discount,
            "debit_vulcain":       ZERO,
            "credit_vulcain":      ZERO,
            "flight_debit_vulcain": ZERO,
            "discount_vulcain":    ZERO,
            "balance_diff":        diff,
        })

    rows.sort(key=lambda r: r["name"].upper())
    return rows


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_csv(rows: list[dict], path: Path) -> None:
    fieldnames = [
        "name",
        "member_id",
        "legacy_id",
        "debit_erp",
        "credit_erp",
        "flight_debit_erp",
        "discount_erp",
        "debit_vulcain",
        "credit_vulcain",
        "flight_debit_vulcain",
        "discount_vulcain",
        "balance_diff",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({
                **row,
                "debit_erp":            f"{row['debit_erp']:.2f}",
                "credit_erp":           f"{row['credit_erp']:.2f}",
                "flight_debit_erp":     f"{row['flight_debit_erp']:.2f}",
                "discount_erp":         f"{row['discount_erp']:.2f}",
                "debit_vulcain":        f"{row['debit_vulcain']:.2f}",
                "credit_vulcain":       f"{row['credit_vulcain']:.2f}",
                "flight_debit_vulcain": f"{row['flight_debit_vulcain']:.2f}",
                "discount_vulcain":     f"{row['discount_vulcain']:.2f}",
                "balance_diff":         f"{row['balance_diff']:.2f}",
            })


def print_summary(rows: list[dict]) -> None:
    diffs = [r for r in rows if r["balance_diff"] != 0]
    print(
        f"\n  {'Name':<30}  {'ID':<14}  {'Legacy':<14}  {'n':>6}  "
        f"{'D-ERP':>11}  {'C-ERP':>11}  {'FL-ERP':>11}  {'REM-ERP':>11}  "
        f"{'D-Vulc':>11}  {'C-Vulc':>11}  {'FL-Vulc':>11}  {'Disc-V':>11}  "
        f"{'Diff':>11}"
    )
    sep = "  ".join(["-"*30, "-"*14, "-"*14, "-"*6,
                     "-"*11, "-"*11, "-"*11, "-"*11,
                     "-"*11, "-"*11, "-"*11, "-"*11, "-"*11])
    print(f"  {sep}")
    for r in rows:
        flag = " <--" if abs(r["balance_diff"]) > Decimal("0.01") else ""
        print(
            f"  {r['name']:<30}  {r['member_id']:<14}  {r['legacy_id']:<14}  "
            f"{r['vulcain_pilot_n']:>6}  "
            f"{r['debit_erp']:>11.2f}  {r['credit_erp']:>11.2f}  "
            f"{r['flight_debit_erp']:>11.2f}  {r['discount_erp']:>11.2f}  "
            f"{r['debit_vulcain']:>11.2f}  {r['credit_vulcain']:>11.2f}  "
            f"{r['flight_debit_vulcain']:>11.2f}  {r['discount_vulcain']:>11.2f}  "
            f"{r['balance_diff']:>11.2f}{flag}"
        )
    total_diff = sum(r["balance_diff"] for r in rows)
    print(f"\n  Rows: {len(rows)}  |  Non-zero diff: {len(diffs)}  "
          f"|  Total diff: {total_diff:.2f}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    threshold = Decimal("0")
    all_rows = True  # by default show all rows

    i = 0
    while i < len(args):
        if args[i] == "--threshold" and i + 1 < len(args):
            threshold = Decimal(args[i + 1])
            all_rows = False
            i += 2
        else:
            i += 1

    print("=== ERP Member 411 Account Balance Check ===")
    print(f"  Vulcain journal: {COMPTA_FILE.name}")
    print(f"  Vulcain pilots:  {PILOTES_FILE.name}")
    print(f"  Vulcain flights: {VOLS_FILE.name}")
    if not all_rows:
        print(f"  Threshold: |diff| > {threshold}")
    if dry_run:
        print("  [DRY RUN — no CSV written]")
    print()

    # --- Load Vulcain data ---
    print("Loading Vulcain pilots…")
    pilots = load_vulcain_pilots(PILOTES_FILE)
    print(f"  {len(pilots)} pilots loaded.")

    print("Loading Vulcain 411 journal balances…")
    vulcain_balances = load_vulcain_411_balances(COMPTA_FILE)
    print(f"  {len(vulcain_balances)} pilots with 411 entries.")

    print("Loading Vulcain flight gross/discount balances…")
    vulcain_flight_balances = load_vulcain_flight_balances(VOLS_FILE)
    print(f"  {len(vulcain_flight_balances)} pilots with validated flights.")

    # --- Connect to ERP ---
    print("\nConnecting to ERP database…")
    conn = _connect()
    print("  Connected.")

    print("Loading ERP members…")
    erp_members = load_erp_members(conn)
    print(f"  {len(erp_members)} members loaded.")

    print("Loading ERP 411 balances for FY2026…")
    fy_uuid, erp_balances = load_erp_411_balances(conn)
    has_no_member = "__no_member__" in erp_balances
    member_count = sum(1 for k in erp_balances if k != "__no_member__")
    print(f"  {member_count} members with 411 entries"
          + (f"  (+1 bucket with no tiers_uuid)" if has_no_member else "") + ".")
    conn.close()

    # --- Build mapping ---
    print("\nMatching Vulcain pilots → ERP members…")
    pilot_to_erp = build_member_map(pilots, erp_members)
    matched = sum(1 for v in pilot_to_erp.values() if v is not None)
    unmatched_pilots = [n for n, v in pilot_to_erp.items() if v is None
                        and n in vulcain_balances]
    print(f"  {matched}/{len(pilots)} pilots resolved to an ERP member.")
    if unmatched_pilots:
        print(f"  {len(unmatched_pilots)} pilots with 411 balance have NO ERP match:")
        for n in sorted(unmatched_pilots, key=lambda x: x.zfill(6)):
            p = pilots[n]
            vb = vulcain_balances[n]
            print(
                f"    pilot n={n}  {p['nom']} {p['prenom']}  "
                f"D={vb['debit']:.2f}  C={vb['credit']:.2f}"
            )

    # --- Merge ---
    print("\nBuilding comparison rows…")
    rows = build_rows(
        vulcain_balances=vulcain_balances,
        vulcain_flight_balances=vulcain_flight_balances,
        erp_balances=erp_balances,
        pilots=pilots,
        erp_members=erp_members,
        pilot_to_erp=pilot_to_erp,
        threshold=threshold,
        all_rows=all_rows,
    )

    print_summary(rows)

    if dry_run:
        print("\n[DRY RUN] No files written.")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "check_411t.csv"
    write_csv(rows, out_path)
    print(f"\n  Written {len(rows)} rows → {out_path}")


if __name__ == "__main__":
    main()
