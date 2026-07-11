"""
ERP-CLUB - ERP pour Club de vol a voile
- Logiciel libre de gestion d'un club de vol a voile
- check_ledger_reconciliation: Entry-level ERP <-> Vulcain ledger comparison.
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

check_account.py compares account BALANCES (Vulcain CB/CR vs ERP, at the
account level). This tool compares individual ENTRIES: for every non-flight
Vulcain ledger entry, is there a matching ERP entry, and do the two agree?
And conversely, does every ERP entry (outside the modules the ERP itself
computes) trace back to a Vulcain entry?

Flight (FL), pack discount (REM), and VI voucher (VI) journal entries are
calculated by the ERP itself from flight/VI data — they were never meant to
have a 1:1 Vulcain counterpart, so they're excluded from the "extra in ERP"
side by default (see --exclude-journals). Vulcain VVO (flight) rows are
always excluded from the Vulcain side for the same reason.

Matching keys primarily on CONTENT (entry date + per-line account/debit/credit),
not journal: journal placement has already drifted from content more than once
(the 512/531 bank/cash rule, the CA/HA duplicate-journal merge), so a
journal-qualified match would silently miss entries that are correct in
substance but filed under an unexpected journal. external_id/reference (when
set) are consulted first, since they're explicit links rather than inferred;
journal is only used to break a tie when several ERP entries share the same
date + lines. Once matched, if the ERP entry's journal doesn't match what the
Vulcain entry maps to, it's reported separately as JOURNAL_DIFFERS rather than
silently accepted — real content match, possibly mis-filed.

This tool is READ-ONLY: it never writes to the database, and never applies
any fix. It only reports differences for manual review — use
fix_bank_cash_journals.py / merge_journals.py / the accounting UI / a fresh
import_legacy.py run to actually correct anything.

Pack purchases (e.g. Pack25 -> account 7066) get a secondary, date-agnostic
check for the same reason: Vulcain bundles a pack purchase into a multi-line
membership entry, while the ERP posts it as a standalone entry dated when the
pack module backfilled it rather than the actual purchase date — entry-level
matching can never pair these up. Instead, the pack account is summed per
member (Vulcain num_pilote vs ERP tiers_uuid) with no date/journal/entry
grouping involved, so a difference here means a real quantity/amount problem,
not just a presentation difference.

Output files (in output/):
  ledger_reconciliation_missing_in_erp.csv    Vulcain entries with no ERP match
  ledger_reconciliation_extra_in_erp.csv      ERP entries with no Vulcain match
  ledger_reconciliation_mismatched.csv        Paired entries whose lines differ
  ledger_reconciliation_journal_differs.csv   Content matches, journal doesn't
  ledger_reconciliation_pack_by_member.csv    Pack account total per member, Vulcain vs ERP
  ledger_reconciliation_pack_validated.csv    Pure pack entries removed from missing/extra
                                              because their member's pack total agrees
  ledger_reconciliation_report.txt            Human-readable summary
  ledger_reconciliation_account_<CODE>_*.csv  Only with --check-account: the four
                                              buckets above narrowed to entries
                                              touching that one account
  ledger_reconciliation_erp_duplicates.csv    ERP-only: candidate double-postings
                                              (same date/account/side, amount within
                                              --dup-threshold) — no Vulcain data involved
  ledger_reconciliation_daily_<CODE>.csv      Only with --daily-account: day-by-day
                                              debit/credit/count totals, ERP vs Vulcain,
                                              for one account (e.g. VI's 419100/401,
                                              where entry-level/member matching doesn't work)

Usage:
  python check_ledger_reconciliation.py [--account-file PATH] [--dry-run]
                                        [--exclude-journals CODE,CODE,...]
                                        [--pack-account CODE]
                                        [--check-account CODE]
                                        [--dup-threshold AMOUNT]
                                        [--daily-account CODE ...] [--daily-threshold AMOUNT]

  --account-file PATH        Vulcain->ERP account mapping (default:
                             backend/account_mapping.json — the curated, git-tracked
                             file — falling back to output/account_mapping.json)
  --exclude-journals CODES   comma-separated ERP journal codes excluded from
                             the "extra in ERP" side (default: FL,REM,VI,AMO,PRO
                             — modules the ERP computes itself)
  --pack-account CODE        ERP account for the pack-by-member check (default: 7066)
  --check-account CODE       focus on one ERP account (e.g. 512) — prints and writes
                             only the missing/extra/mismatched/journal-differs rows
                             that have a line on this account
  --dup-threshold AMOUNT     ERP duplicate-posting check: same date/account/side,
                             amount within this tolerance (default: 0.01)
  --daily-account CODE       day-by-day debit/credit/count totals for one ERP account,
                             ERP vs Vulcain (repeatable). Use for accounts where neither
                             entry nor per-member matching works (e.g. VI: 419100, 401)
  --daily-threshold AMOUNT   tolerance for --daily-account's day-level net diff (default: 0.01)
  --dry-run                  print summary only, no output files
"""

import argparse
import csv
import sys
from decimal import Decimal
from pathlib import Path

TOOLS_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(TOOLS_DIR))

from import_legacy import (  # noqa: E402
    LEGACY_DIR,
    OUTPUT_DIR,
    JOURNAL_MAP,
    _read_csv,
    _clean_amount,
    _parse_date,
    _find_col,
    _normalize_name,
    _resolve_fp_account_code,
    resolve_bank_cash_journal_override,
    load_account_mapping,
    build_member_map,
    _connect,
)

# The curated, git-tracked mapping lives at backend/account_mapping.json (edited
# directly by hand — see e.g. Vulcain "706040300" -> ERP "7066" for Pack25 sales).
# tools/output/ is gitignored scratch space; check_account.py --export-accounts
# writes fresh templates there, but that's not where the maintained file lives.
# Preferring the canonical file by default avoids silently falling back to naive
# 3-digit prefix truncation (e.g. "706040300"[:3] == "706", a real but wrong,
# generic ERP account distinct from the curated "7066").
CANONICAL_MAPPING_FILE = TOOLS_DIR.parent / "account_mapping.json"
FALLBACK_MAPPING_FILE = OUTPUT_DIR / "account_mapping.json"
DEFAULT_EXCLUDED_JOURNALS = {"FL", "REM", "VI"}
DEFAULT_PACK_ACCOUNT = "7066"

ENTRY_STATE_LABELS = {1: "Draft", 2: "Posted", 3: "Cancelled"}


# ---------------------------------------------------------------------------
# ERP-side lookups (accounts only — no members/flights needed here)
# ---------------------------------------------------------------------------

def load_account_lookups(conn) -> dict:
    cur = conn.cursor()

    cur.execute(
        "SELECT uuid::text FROM accounting_fiscal_years WHERE year = 2026 LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("No fiscal year for 2026 found in the ERP database.")
    fy_uuid = row[0]

    cur.execute(
        "SELECT code, uuid::text FROM accounting_accounts WHERE is_posting_allowed = true ORDER BY code"
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

    cur.close()
    return {
        "fy_uuid": fy_uuid,
        "accounts_by_prefix": accounts_by_prefix,
        "accounts_by_full_code": accounts_by_full_code,
        "accounts_code_by_uuid": accounts_code_by_uuid,
    }


def load_erp_entries(conn, fy_uuid: str) -> list[dict]:
    """Load every non-cancelled FY2026 entry with its lines, grouped and fingerprinted."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT ae.uuid::text, ae.entry_date::text, aj.code, ae.reference, ae.external_id,
               ae.source_system, ae.description, ae.state,
               aa.code, al.debit, al.credit, al.tiers_uuid::text
        FROM accounting_entries ae
        JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
        JOIN accounting_lines al ON al.entry_uuid = ae.uuid AND al.fiscal_year_uuid = ae.fiscal_year_uuid
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        WHERE ae.fiscal_year_uuid = %s AND ae.state != 3
        ORDER BY ae.uuid
        """,
        (fy_uuid,),
    )
    by_uuid: dict[str, dict] = {}
    for euuid, edate, jcode, ref, ext_id, source, desc, state, acc_code, debit, credit, tiers_uuid in cur.fetchall():
        entry = by_uuid.setdefault(euuid, {
            "uuid": euuid,
            "date": edate,
            "journal_code": jcode,
            "reference": ref,
            "external_id": ext_id,
            "source_system": source,
            "description": desc or "",
            "state": state,
            "lines": [],
            "lines_with_tiers": [],
            "total_debit": Decimal("0"),
            "total_credit": Decimal("0"),
        })
        d = Decimal(str(debit or 0))
        c = Decimal(str(credit or 0))
        entry["lines"].append((acc_code, d, c))
        entry["lines_with_tiers"].append((acc_code, d, c, tiers_uuid))
        entry["total_debit"] += d
        entry["total_credit"] += c

    cur.close()

    entries = list(by_uuid.values())
    for entry in entries:
        line_fp = tuple(sorted(
            (code, str(d.quantize(Decimal("0.01"))), str(c.quantize(Decimal("0.01"))))
            for code, d, c in entry["lines"]
        ))
        # content_key ignores the journal — an entry can be correctly identified by
        # date + lines alone even when it's filed under an unexpected journal (see
        # resolve_bank_cash_journal_override() and the CA/HA merge: journal placement
        # has drifted independently of content more than once already). fingerprint
        # (journal-qualified) is kept only to detect that drift once a match is found.
        entry["content_key"] = (entry["date"], line_fp)
        entry["fingerprint"] = (entry["date"], entry["journal_code"], line_fp)
        # Some accounts never carry a tiers_uuid on their own line (e.g. 512/531,
        # or 110 — the report-à-nouveau equity counter-account) even though the
        # entry clearly belongs to one member via its paired 411 line. Same
        # pattern as build_erp_pack_summary(): resolve from ANY line in the entry.
        entry["entry_tiers_uuid"] = next(
            (t for _c, _d, _cr, t in entry["lines_with_tiers"] if t), None
        )
    return entries


# ---------------------------------------------------------------------------
# ERP-side duplicate-posting check (no Vulcain data involved)
#
# Distinct from tools/check_duplicates.py, which requires an exact whole-entry
# match (same description/reference and full line signature) — deliberately
# strict, tuned for finding true re-imports of the same entry. This check is
# looser on purpose: same entry_date + same account + same side (debit or
# credit) + same member (tiers_uuid, when the account has one) + amount
# within a tolerance, regardless of which journal, of the rest of the entry's
# other lines, or of description/reference. The member match matters: most of
# this ledger's volume (411 receivable lines, 706x flight revenue) has many
# DIFFERENT members billed the same standard amount the same day — without
# requiring the same tiers_uuid this floods with false positives. Accounts
# with no tiers link at all (512, 531) fall back to (date, account, side)
# only. It's meant to surface candidate double-postings for manual review,
# not to auto-delete anything — two lines from the SAME entry are never
# flagged against each other (that's normal double-entry bookkeeping).
# ---------------------------------------------------------------------------

def find_erp_line_duplicates(
    erp_entries: list[dict], amount_threshold: Decimal, members_by_uuid: dict, exclude_journals: set[str]
) -> list[list[dict]]:
    """
    Bucket by (date, account, side, entry's member) — not just (date, account,
    side). Most volume in this ledger (411 receivable lines, 706x flight
    revenue lines) legitimately has many DIFFERENT members billed the same
    standard amount on the same day; without the member the check drowns in
    false positives (e.g. every member's identical membership fee posted the
    same registration day). The member is resolved from ANY line in the entry
    (entry["entry_tiers_uuid"], set in load_erp_entries), not just the line on
    the account being checked — some accounts never carry a tiers_uuid on
    their own line (512, 531, or 110 the report-à-nouveau equity counter,
    same pattern as build_erp_pack_summary()) even though the entry clearly
    belongs to one member via its paired 411 line. Entries with no resolvable
    member anywhere (entry_tiers_uuid=None) fall back to grouping by (date,
    account, side) only, since a duplicate bank/cash posting isn't
    member-specific anyway.

    Also excludes ERP-computed journals (FL/REM/VI/AMO/PRO by default — same
    set as the main reconciliation's "extra in ERP" side): a single pilot
    routinely has several real flights the same day at the identical
    standard launch/hourly rate (e.g. several winch launches), which would
    otherwise look identical to this check but isn't a double-posting.
    """
    buckets: dict[tuple, list[dict]] = {}
    for entry in erp_entries:
        if entry["journal_code"] in exclude_journals:
            continue
        entry_tiers_uuid = entry["entry_tiers_uuid"]
        member = members_by_uuid.get(entry_tiers_uuid) if entry_tiers_uuid else None
        tiers_label = (
            f"{member.get('last_name', '')} {member.get('first_name', '')}".strip()
            if member else ""
        )
        for account_code, debit, credit, _line_tiers_uuid in entry["lines_with_tiers"]:
            if debit > 0:
                side, amount = "debit", debit
            elif credit > 0:
                side, amount = "credit", credit
            else:
                continue
            buckets.setdefault((entry["date"], account_code, side, entry_tiers_uuid), []).append({
                "entry_uuid": entry["uuid"],
                "amount": amount,
                "journal_code": entry["journal_code"],
                "reference": entry["reference"] or "",
                "description": entry["description"],
                "state": entry["state"],
                "side": side,
                "account_code": account_code,
                "date": entry["date"],
                "tiers_label": tiers_label,
            })

    groups: list[list[dict]] = []
    for candidates in buckets.values():
        if len(candidates) < 2:
            continue
        used = [False] * len(candidates)
        for i in range(len(candidates)):
            if used[i]:
                continue
            cluster = {candidates[i]["entry_uuid"]: candidates[i]}
            used[i] = True
            for j in range(i + 1, len(candidates)):
                if used[j] or candidates[j]["entry_uuid"] == candidates[i]["entry_uuid"]:
                    continue
                if abs(candidates[j]["amount"] - candidates[i]["amount"]) <= amount_threshold:
                    cluster[candidates[j]["entry_uuid"]] = candidates[j]
                    used[j] = True
            if len(cluster) > 1:
                groups.append(list(cluster.values()))

    return groups


def write_erp_duplicates_csv(groups: list[list[dict]], path: Path) -> None:
    fieldnames = [
        "group_id", "entry_uuid", "date", "account_code", "side", "amount",
        "tiers_label", "journal_code", "state", "reference", "description",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for gidx, group in enumerate(sorted(groups, key=lambda g: g[0]["date"]), 1):
            for row in sorted(group, key=lambda r: r["entry_uuid"]):
                w.writerow({
                    "group_id": gidx,
                    "entry_uuid": row["entry_uuid"],
                    "date": row["date"],
                    "account_code": row["account_code"],
                    "side": row["side"],
                    "amount": f"{row['amount']:.2f}",
                    "tiers_label": row["tiers_label"],
                    "journal_code": row["journal_code"],
                    "state": ENTRY_STATE_LABELS.get(row["state"], str(row["state"])),
                    "reference": row["reference"],
                    "description": row["description"],
                })


# ---------------------------------------------------------------------------
# Daily account totals reconciliation (e.g. VI: 419100, 401)
#
# For VI (initiation flight) vouchers, neither entry-level content matching
# nor per-member matching works well: most VI buyers have no tiers_uuid on
# either side (external/HelloAsso buyers, not club members), and the ERP's
# "VI" journal (realization: D 419100 / C 7067 + C 401) has NO Vulcain
# counterpart at all — Vulcain recognizes VI flight revenue as ordinary
# flight revenue (706xxx) inside VVO-journal entries, which are always
# skipped on the Vulcain side (flights are reconciled separately). So the
# exclude_journals set (which already includes "VI") keeps the ERP side of
# this check to just the "purchase" side of 419100 (wherever that landed —
# BQ/CS/AC/AN/...), which IS meant to have a Vulcain counterpart.
#
# Rather than matching individual transactions, this sums debit/credit/count
# PER DAY for one account, on both sides, and flags days whose net diverges
# beyond a tolerance — coarser than entry matching, but immune to structural
# differences in how the two systems group lines into entries, and still
# precise enough to point at which day(s) to investigate by hand.
# ---------------------------------------------------------------------------

def build_erp_daily_account_totals(
    erp_entries: list[dict], account_code: str, exclude_journals: set[str]
) -> dict[str, dict]:
    totals: dict[str, dict] = {}
    for entry in erp_entries:
        if entry["journal_code"] in exclude_journals:
            continue
        for code, debit, credit in entry["lines"]:
            if code != account_code:
                continue
            bucket = totals.setdefault(entry["date"], {"debit": Decimal("0"), "credit": Decimal("0"), "count": 0})
            bucket["debit"] += debit
            bucket["credit"] += credit
            bucket["count"] += 1
    return totals


def build_vulcain_daily_account_totals(
    accounting_rows: list[dict], account_lookups: dict, account_mapping: dict | None, account_code: str
) -> dict[str, dict]:
    totals: dict[str, dict] = {}
    if not accounting_rows:
        return totals

    sample = accounting_rows[0]
    col_compte = _find_col(sample, ["compte"])
    col_debit = _find_col(sample, ["débit", "debit", "dÃ©bit"])
    col_credit = _find_col(sample, ["crédit", "credit", "crÃ©dit"])
    col_journal = _find_col(sample, ["journal"])
    col_date = _find_col(sample, ["date_de_valeur"])

    for row in accounting_rows:
        if (row.get(col_journal) or "").strip() == "VVO":
            continue
        raw_compte = (row.get(col_compte) or "").strip()
        if not raw_compte:
            continue
        if _resolve_fp_account_code(raw_compte, account_mapping, account_lookups) != account_code:
            continue
        try:
            d = _parse_date(row.get(col_date) or "")
        except ValueError:
            continue
        bucket = totals.setdefault(d, {"debit": Decimal("0"), "credit": Decimal("0"), "count": 0})
        bucket["debit"] += _clean_amount(row.get(col_debit) or "")
        bucket["credit"] += _clean_amount(row.get(col_credit) or "")
        bucket["count"] += 1

    return totals


def reconcile_daily_account_totals(
    erp_totals: dict[str, dict], vulcain_totals: dict[str, dict], amount_threshold: Decimal
) -> list[dict]:
    zero = {"debit": Decimal("0"), "credit": Decimal("0"), "count": 0}
    rows = []
    for d in sorted(set(erp_totals) | set(vulcain_totals)):
        e = erp_totals.get(d, zero)
        v = vulcain_totals.get(d, zero)
        e_net = e["debit"] - e["credit"]
        v_net = v["debit"] - v["credit"]
        diff = e_net - v_net
        rows.append({
            "date": d,
            "erp_count": e["count"], "erp_debit": e["debit"], "erp_credit": e["credit"], "erp_net": e_net,
            "vulcain_count": v["count"], "vulcain_debit": v["debit"], "vulcain_credit": v["credit"], "vulcain_net": v_net,
            "diff": diff,
            "flagged": abs(diff) > amount_threshold,
        })
    return rows


def write_daily_account_csv(rows: list[dict], path: Path) -> None:
    fieldnames = [
        "date", "erp_count", "erp_debit", "erp_credit", "erp_net",
        "vulcain_count", "vulcain_debit", "vulcain_credit", "vulcain_net", "diff", "flagged",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in rows:
            w.writerow({
                "date": row["date"],
                "erp_count": row["erp_count"],
                "erp_debit": f"{row['erp_debit']:.2f}",
                "erp_credit": f"{row['erp_credit']:.2f}",
                "erp_net": f"{row['erp_net']:.2f}",
                "vulcain_count": row["vulcain_count"],
                "vulcain_debit": f"{row['vulcain_debit']:.2f}",
                "vulcain_credit": f"{row['vulcain_credit']:.2f}",
                "vulcain_net": f"{row['vulcain_net']:.2f}",
                "diff": f"{row['diff']:.2f}",
                "flagged": "YES" if row["flagged"] else "",
            })


# ---------------------------------------------------------------------------
# Pack-by-member reconciliation (secondary check, date-agnostic)
#
# Pack purchases (e.g. Pack25 -> account 7066) are recorded very differently
# on each side: Vulcain bundles a purchase into one multi-line "inscription"
# entry alongside club fee/insurance; the ERP posts it as its own standalone
# entry, dated when the pack module backfilled it rather than the original
# purchase date. Entry-level (date + lines) matching above can never pair
# these up. This check drops date and journal entirely and instead sums the
# pack-account amount per member — if the totals agree, the difference above
# is just presentation/timing, not a missing or duplicated transaction.
# ---------------------------------------------------------------------------

def load_member_match_lookups(conn) -> dict:
    """Members keyed for both Vulcain matching (ffvp_id/name, via
    import_legacy.build_member_map) and ERP tiers_uuid lookup."""
    cur = conn.cursor()
    cur.execute("SELECT uuid::text, account_id, ffvp_id, first_name, last_name FROM members")
    members_by_ffvp: dict[str, dict] = {}
    members_by_name: dict[tuple, dict] = {}
    members_by_uuid: dict[str, dict] = {}
    for uuid, account_id, ffvp_id, first_name, last_name in cur.fetchall():
        m = {
            "uuid": uuid,
            "account_id": account_id,
            "first_name": first_name or "",
            "last_name": last_name or "",
        }
        members_by_uuid[uuid] = m
        if ffvp_id is not None:
            members_by_ffvp[str(int(ffvp_id))] = m
        key = (_normalize_name(last_name or ""), _normalize_name(first_name or ""))
        members_by_name[key] = m
    cur.close()
    return {
        "members_by_ffvp": members_by_ffvp,
        "members_by_name": members_by_name,
        "members_by_uuid": members_by_uuid,
    }


def build_vulcain_pack_summary(
    accounting_rows: list[dict],
    account_lookups: dict,
    account_mapping: dict | None,
    member_map: dict,
    pack_account_code: str,
) -> dict[str, dict]:
    """Sum the pack-account amount per member across the whole Vulcain ledger,
    ignoring date/journal/entry grouping entirely.

    The pack revenue row itself always has num_pilote=0 — the real pilot number
    is on the paired 411 row of the same num_écriture group — so this groups by
    num_écriture first and resolves the member from any row in that group.
    """
    summary: dict[str, dict] = {}
    if not accounting_rows:
        return summary

    sample = accounting_rows[0]
    col_compte = _find_col(sample, ["compte"])
    col_debit = _find_col(sample, ["débit", "debit", "dÃ©bit"])
    col_credit = _find_col(sample, ["crédit", "credit", "crÃ©dit"])
    col_num_pilote = _find_col(sample, ["num_pilote"])
    col_num_ecriture = _find_col(sample, ["num_écriture", "num_ecriture", "num_Ã©criture"])
    col_date = _find_col(sample, ["date_de_valeur"])
    col_journal = _find_col(sample, ["journal"])
    col_label = _find_col(sample, ["libellé", "libelle", "libellÃ©"])

    groups: dict[str, list[dict]] = {}
    for row in accounting_rows:
        key = (row.get(col_num_ecriture) or "").strip()
        if key:
            groups.setdefault(key, []).append(row)

    for num_ecriture, rows in groups.items():
        if any((r.get(col_journal) or "").strip() == "VVO" for r in rows):
            continue

        pack_amount = Decimal("0")
        has_pack_line = False
        n_pilote = ""
        entry_date = rows[0].get(col_date)
        description = ""
        for r in rows:
            raw_compte = (r.get(col_compte) or "").strip()
            if raw_compte and _resolve_fp_account_code(raw_compte, account_mapping, account_lookups) == pack_account_code:
                has_pack_line = True
                debit = _clean_amount(r.get(col_debit) or "")
                credit = _clean_amount(r.get(col_credit) or "")
                pack_amount += credit - debit  # revenue convention: credit increases the pack account
                description = (r.get(col_label) or "").strip() or description
            candidate_pilote = (r.get(col_num_pilote) or "").strip()
            if candidate_pilote and candidate_pilote != "0" and not n_pilote:
                n_pilote = candidate_pilote

        if not has_pack_line:
            continue

        member = member_map.get(n_pilote) if n_pilote else None
        if member:
            key = member["account_id"]
            label = f"{member.get('last_name', '')} {member.get('first_name', '')}".strip() or key
        else:
            key = f"UNRESOLVED_PILOT:{n_pilote or '?'}"
            label = f"(unresolved Vulcain pilot n={n_pilote or '?'})"

        bucket = summary.setdefault(key, {"member_label": label, "total": Decimal("0"), "count": 0, "details": []})
        bucket["total"] += pack_amount
        bucket["count"] += 1
        bucket["details"].append({
            "num_ecriture": num_ecriture,
            "date": entry_date,
            "amount": pack_amount,
            "description": description,
        })

    return summary


def build_erp_pack_summary(conn, fy_uuid: str, members_by_uuid: dict, pack_account_code: str) -> dict[str, dict]:
    """Sum the pack-account amount per member across ERP FY2026 (not cancelled),
    ignoring date/journal/entry grouping entirely.

    The pack revenue line itself (e.g. 7066) has no tiers_uuid — the member link
    lives on the paired 411 receivable line in the same entry — so this pulls
    ALL lines of every entry that touches the pack account, and resolves the
    member from any line in that entry that has one.
    """
    cur = conn.cursor()
    cur.execute(
        """
        WITH pack_entries AS (
            SELECT DISTINCT ae.uuid AS entry_uuid, ae.fiscal_year_uuid
            FROM accounting_lines al
            JOIN accounting_entries ae ON ae.uuid = al.entry_uuid AND ae.fiscal_year_uuid = al.fiscal_year_uuid
            JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
            WHERE al.fiscal_year_uuid = %s AND aa.code = %s AND ae.state != 3
        )
        SELECT ae.uuid::text, ae.entry_date::text, ae.reference, ae.description,
               aa.code, al.tiers_uuid::text, al.debit, al.credit
        FROM pack_entries pe
        JOIN accounting_entries ae ON ae.uuid = pe.entry_uuid AND ae.fiscal_year_uuid = pe.fiscal_year_uuid
        JOIN accounting_lines al ON al.entry_uuid = ae.uuid AND al.fiscal_year_uuid = ae.fiscal_year_uuid
        JOIN accounting_accounts aa ON aa.uuid = al.account_uuid
        """,
        (fy_uuid, pack_account_code),
    )
    rows = cur.fetchall()
    cur.close()

    by_entry: dict[str, dict] = {}
    for entry_uuid, entry_date, reference, description, acc_code, tiers_uuid, debit, credit in rows:
        entry = by_entry.setdefault(entry_uuid, {
            "date": entry_date, "reference": reference or "", "description": description or "",
            "tiers_uuid": None, "pack_amount": Decimal("0"),
        })
        if tiers_uuid and entry["tiers_uuid"] is None:
            entry["tiers_uuid"] = tiers_uuid
        if acc_code == pack_account_code:
            entry["pack_amount"] += Decimal(str(credit or 0)) - Decimal(str(debit or 0))

    summary: dict[str, dict] = {}
    for entry_uuid, entry in by_entry.items():
        member = members_by_uuid.get(entry["tiers_uuid"]) if entry["tiers_uuid"] else None
        if member:
            key = member["account_id"]
            label = f"{member.get('last_name', '')} {member.get('first_name', '')}".strip() or key
        else:
            key = f"UNRESOLVED_TIERS:{entry_uuid}"
            label = f"(no member link, entry {entry_uuid[:8]})"

        bucket = summary.setdefault(key, {"member_label": label, "total": Decimal("0"), "count": 0, "details": []})
        bucket["total"] += entry["pack_amount"]
        bucket["count"] += 1
        bucket["details"].append({
            "entry_uuid": entry_uuid,
            "date": entry["date"],
            "reference": entry["reference"],
            "amount": entry["pack_amount"],
            "description": entry["description"],
        })

    return summary


def reconcile_pack_by_member(
    vulcain_summary: dict[str, dict], erp_summary: dict[str, dict], tolerance: Decimal = Decimal("0.01")
) -> list[dict]:
    """Compare per-member pack totals; only members whose totals disagree are returned."""
    rows = []
    for key in sorted(set(vulcain_summary) | set(erp_summary)):
        v = vulcain_summary.get(key)
        e = erp_summary.get(key)
        v_total = v["total"] if v else Decimal("0")
        e_total = e["total"] if e else Decimal("0")
        diff = v_total - e_total
        if abs(diff) <= tolerance:
            continue
        rows.append({
            "member_key": key,
            "member_label": (v or e)["member_label"],
            "vulcain_total": v_total,
            "vulcain_count": v["count"] if v else 0,
            "erp_total": e_total,
            "erp_count": e["count"] if e else 0,
            "diff": diff,
        })
    return rows


# ---------------------------------------------------------------------------
# Vulcain-side entries (mirrors import_legacy.build_accounting_entries, minus
# member/tiers resolution and JSON output — this tool only needs the
# comparable shape: journal, date, per-line account/debit/credit)
# ---------------------------------------------------------------------------

def build_vulcain_entries(
    accounting_rows: list[dict], account_lookups: dict, account_mapping: dict | None, warnings: list[str]
) -> tuple[list[dict], dict]:
    stats = {"total": 0, "skipped_vvo": 0, "compared": 0, "warnings": 0}
    if not accounting_rows:
        return [], stats

    sample = accounting_rows[0]
    col_num_ecriture = _find_col(sample, ["num_écriture", "num_ecriture", "num_Ã©criture"])
    col_date = _find_col(sample, ["date_de_valeur"])
    col_label = _find_col(sample, ["libellé", "libelle", "libellÃ©"])
    col_compte = _find_col(sample, ["compte"])
    col_debit = _find_col(sample, ["débit", "debit", "dÃ©bit"])
    col_credit = _find_col(sample, ["crédit", "credit", "crÃ©dit"])
    col_journal = _find_col(sample, ["journal"])

    groups: dict[str, list[dict]] = {}
    for row in accounting_rows:
        key = (row.get(col_num_ecriture) or "").strip()
        if key:
            groups.setdefault(key, []).append(row)

    vulcain_entries: list[dict] = []

    for num_ecriture, lines in groups.items():
        stats["total"] += 1
        journals_in_group = {(r.get(col_journal) or "").strip() for r in lines}
        if "VVO" in journals_in_group:
            stats["skipped_vvo"] += 1
            continue

        first_journal = next(iter(journals_in_group))
        mapped_journal_code = JOURNAL_MAP.get(first_journal)
        if mapped_journal_code is None:
            warnings.append(f"Unknown journal {first_journal!r} for num_écriture={num_ecriture}, treated as OD")
            mapped_journal_code = "OD"
            stats["warnings"] += 1

        override = resolve_bank_cash_journal_override(
            lines, col_compte, col_debit, col_credit, account_mapping, account_lookups
        )
        erp_journal_code = override or mapped_journal_code

        try:
            entry_date = _parse_date(lines[0].get(col_date) or "")
        except ValueError as e:
            warnings.append(f"num_écriture={num_ecriture}: {e}, skipped")
            stats["warnings"] += 1
            continue

        description = (lines[0].get(col_label) or "").strip()

        resolved_lines = []
        total_debit = Decimal("0")
        total_credit = Decimal("0")
        for line in lines:
            raw_compte = (line.get(col_compte) or "").strip()
            account_code = _resolve_fp_account_code(raw_compte, account_mapping, account_lookups)
            debit = _clean_amount(line.get(col_debit) or "")
            credit = _clean_amount(line.get(col_credit) or "")
            total_debit += debit
            total_credit += credit
            resolved_lines.append((account_code, debit, credit))

        line_fp = tuple(sorted(
            (code, str(d.quantize(Decimal("0.01"))), str(c.quantize(Decimal("0.01"))))
            for code, d, c in resolved_lines
        ))
        content_key = (entry_date, line_fp)

        vulcain_entries.append({
            "num_ecriture": num_ecriture,
            "date": entry_date,
            "vulcain_journal": first_journal,
            "erp_journal_code": erp_journal_code,
            "description": description,
            "lines": resolved_lines,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "external_id": f"vulcain-{num_ecriture}",
            "content_key": content_key,
        })
        stats["compared"] += 1

    return vulcain_entries, stats


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def reconcile(
    vulcain_entries: list[dict], erp_entries: list[dict], exclude_journals: set[str]
) -> dict:
    """
    Match Vulcain entries to ERP entries. Journal placement is treated as the
    least reliable signal: entries have already been found filed under a
    different journal than their content implies (the 512/531 bank/cash rule,
    the CA/HA duplicate-journal merge) — a journal-qualified fingerprint would
    silently miss those. So content (date + lines) is the primary match key;
    journal is only consulted to break a tie when several ERP entries share
    the same date + lines. external_id/reference (when set) still take
    priority over content, since they're explicit links rather than inferred.

    Once a match is found, if the ERP entry's journal doesn't match what the
    Vulcain entry would resolve to, it's recorded as journal_differs — real
    content matches, but the entry may be mis-filed (candidate for
    fix_bank_cash_journals.py / merge_journals.py / a manual reclassification).
    """
    by_external_id: dict[str, list[dict]] = {}
    by_reference: dict[str, list[dict]] = {}
    by_content: dict[tuple, list[dict]] = {}
    for e in erp_entries:
        if e["external_id"]:
            by_external_id.setdefault(e["external_id"], []).append(e)
        if e["reference"]:
            by_reference.setdefault(e["reference"], []).append(e)
        by_content.setdefault(e["content_key"], []).append(e)

    matched_uuids: set[str] = set()
    missing_in_erp: list[dict] = []
    mismatched: list[tuple] = []
    journal_differs: list[tuple] = []
    ambiguous_count = 0

    def unclaimed(candidates: list[dict] | None) -> list[dict]:
        # Several Vulcain entries can legitimately share the same content_key
        # (e.g. two members with an identical opening balance) — without this
        # filter every one of them would greedily match the same first ERP
        # candidate, leaving the others' true counterparts unclaimed and
        # wrongly reported as extra_in_erp.
        if not candidates:
            return []
        return [c for c in candidates if c["uuid"] not in matched_uuids]

    for ve in vulcain_entries:
        entry = None
        match_kind = None

        ext_list = unclaimed(by_external_id.get(ve["external_id"]))
        if ext_list:
            entry, match_kind = ext_list[0], "external_id"
        else:
            ref_list = unclaimed(by_reference.get(ve["num_ecriture"]))
            if ref_list:
                entry, match_kind = ref_list[0], "reference"
            else:
                candidates = unclaimed(by_content.get(ve["content_key"]))
                if candidates:
                    if len(candidates) == 1:
                        entry, match_kind = candidates[0], "content"
                    else:
                        # Ambiguous by content alone (rare — identical date+lines across
                        # several entries) — use journal only to break the tie.
                        journal_matches = [c for c in candidates if c["journal_code"] == ve["erp_journal_code"]]
                        if len(journal_matches) == 1:
                            entry, match_kind = journal_matches[0], "content+journal"
                        else:
                            entry, match_kind = candidates[0], "content (ambiguous)"
                            ambiguous_count += 1

        if entry is None:
            missing_in_erp.append(ve)
            continue

        matched_uuids.add(entry["uuid"])

        if entry["content_key"] != ve["content_key"]:
            # Only external_id/reference pairing can reach here with differing content
            # (content-based matching only pairs entries whose content_key is equal).
            mismatched.append((ve, entry, match_kind))
            continue

        if entry["journal_code"] != ve["erp_journal_code"]:
            journal_differs.append((ve, entry, match_kind))

    extra_in_erp = [
        e for e in erp_entries
        if e["journal_code"] not in exclude_journals and e["uuid"] not in matched_uuids
    ]

    return {
        "missing_in_erp": missing_in_erp,
        "extra_in_erp": extra_in_erp,
        "mismatched": mismatched,
        "journal_differs": journal_differs,
        "ambiguous_count": ambiguous_count,
        "matched_count": len(matched_uuids),
    }


def filter_by_account(result: dict, account_code: str) -> dict:
    """Narrow an already-computed reconcile() result down to only the rows
    that have a line on account_code — a quick way to focus on one account
    (e.g. 512) without wading through the full ledger-wide CSVs."""
    def ve_has_account(ve: dict) -> bool:
        return any(code == account_code for code, _d, _c in ve["lines"])

    def entry_has_account(e: dict) -> bool:
        return any(code == account_code for code, _d, _c in e["lines"])

    return {
        "missing_in_erp": [ve for ve in result["missing_in_erp"] if ve_has_account(ve)],
        "extra_in_erp": [e for e in result["extra_in_erp"] if entry_has_account(e)],
        "mismatched": [
            (ve, e, k) for ve, e, k in result["mismatched"]
            if ve_has_account(ve) or entry_has_account(e)
        ],
        "journal_differs": [
            (ve, e, k) for ve, e, k in result["journal_differs"]
            if ve_has_account(ve) or entry_has_account(e)
        ],
    }


def apply_pack_validation(
    result: dict,
    vulcain_pack_summary: dict,
    erp_pack_summary: dict,
    pack_diffs: list[dict],
    pack_account_code: str,
    receivable_account_code: str = "411",
) -> dict:
    """
    An entry that's "missing"/"extra" purely because of pack bundling/date
    differences (see build_vulcain_pack_summary/build_erp_pack_summary) isn't
    actually a discrepancy if the per-member pack total already reconciles —
    that's direct proof the same transaction exists on both sides, just
    shaped differently. This only applies to a "pure" pack entry (lines are
    ONLY the pack account + the member receivable, e.g. 7066+411, not bundled
    with cotisation/insurance/etc. — see e.g. Vulcain n°308) — bundling a pack
    line into a larger entry doesn't prove the REST of that entry is fine, so
    those are left in missing_in_erp/extra_in_erp for manual review.

    Moves confirmed entries from missing_in_erp/extra_in_erp into a new
    "pack_validated" bucket instead of dropping them, so they're still visible.
    """
    discrepant_members = {row["member_key"] for row in pack_diffs}
    allowed_codes = {pack_account_code, receivable_account_code}

    vulcain_num_to_member: dict[str, str] = {}
    for member_key, bucket in vulcain_pack_summary.items():
        for d in bucket["details"]:
            vulcain_num_to_member[d["num_ecriture"]] = member_key

    erp_uuid_to_member: dict[str, str] = {}
    for member_key, bucket in erp_pack_summary.items():
        for d in bucket["details"]:
            erp_uuid_to_member[d["entry_uuid"]] = member_key

    def is_pure_pack(lines) -> bool:
        codes = {code for code, _d, _c in lines}
        return bool(codes) and codes.issubset(allowed_codes)

    pack_validated: list[dict] = []

    new_missing = []
    for ve in result["missing_in_erp"]:
        member_key = vulcain_num_to_member.get(ve["num_ecriture"])
        if member_key is not None and member_key not in discrepant_members and is_pure_pack(ve["lines"]):
            pack_validated.append({"side": "vulcain", "member_key": member_key, "entry": ve})
        else:
            new_missing.append(ve)

    new_extra = []
    for e in result["extra_in_erp"]:
        member_key = erp_uuid_to_member.get(e["uuid"])
        if member_key is not None and member_key not in discrepant_members and is_pure_pack(e["lines"]):
            pack_validated.append({"side": "erp", "member_key": member_key, "entry": e})
        else:
            new_extra.append(e)

    return {
        **result,
        "missing_in_erp": new_missing,
        "extra_in_erp": new_extra,
        "pack_validated": pack_validated,
    }


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _fmt_lines(lines) -> str:
    return "; ".join(f"{code}:{d}:{c}" for code, d, c in sorted(lines))


def write_missing_csv(missing: list[dict], path: Path) -> None:
    fieldnames = [
        "num_ecriture", "date", "vulcain_journal", "erp_journal_expected",
        "description", "lines", "total_debit", "total_credit",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for ve in sorted(missing, key=lambda e: e["date"]):
            w.writerow({
                "num_ecriture": ve["num_ecriture"],
                "date": ve["date"],
                "vulcain_journal": ve["vulcain_journal"],
                "erp_journal_expected": ve["erp_journal_code"],
                "description": ve["description"],
                "lines": _fmt_lines(ve["lines"]),
                "total_debit": f"{ve['total_debit']:.2f}",
                "total_credit": f"{ve['total_credit']:.2f}",
            })


def write_extra_csv(extra: list[dict], path: Path) -> None:
    fieldnames = [
        "entry_uuid", "date", "journal", "reference", "external_id",
        "source_system", "description", "state", "lines", "total_debit", "total_credit",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for e in sorted(extra, key=lambda e: e["date"]):
            w.writerow({
                "entry_uuid": e["uuid"],
                "date": e["date"],
                "journal": e["journal_code"],
                "reference": e["reference"] or "",
                "external_id": e["external_id"] or "",
                "source_system": e["source_system"] or "",
                "description": e["description"],
                "state": ENTRY_STATE_LABELS.get(e["state"], str(e["state"])),
                "lines": _fmt_lines(e["lines"]),
                "total_debit": f"{e['total_debit']:.2f}",
                "total_credit": f"{e['total_credit']:.2f}",
            })


def write_mismatched_csv(mismatched: list[tuple], path: Path) -> None:
    fieldnames = [
        "num_ecriture", "entry_uuid", "matched_by", "date",
        "vulcain_journal", "erp_journal",
        "vulcain_lines", "erp_lines",
        "vulcain_total_debit", "erp_total_debit",
        "vulcain_total_credit", "erp_total_credit",
        "vulcain_description", "erp_description",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for ve, entry, match_kind in sorted(mismatched, key=lambda t: t[0]["date"]):
            w.writerow({
                "num_ecriture": ve["num_ecriture"],
                "entry_uuid": entry["uuid"],
                "matched_by": match_kind,
                "date": ve["date"],
                "vulcain_journal": ve["erp_journal_code"],
                "erp_journal": entry["journal_code"],
                "vulcain_lines": _fmt_lines(ve["lines"]),
                "erp_lines": _fmt_lines(entry["lines"]),
                "vulcain_total_debit": f"{ve['total_debit']:.2f}",
                "erp_total_debit": f"{entry['total_debit']:.2f}",
                "vulcain_total_credit": f"{ve['total_credit']:.2f}",
                "erp_total_credit": f"{entry['total_credit']:.2f}",
                "vulcain_description": ve["description"],
                "erp_description": entry["description"],
            })


def write_journal_differs_csv(journal_differs: list[tuple], path: Path) -> None:
    fieldnames = [
        "num_ecriture", "entry_uuid", "matched_by", "date",
        "erp_journal_expected", "erp_journal_actual",
        "lines", "total_debit", "total_credit", "description",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for ve, entry, match_kind in sorted(journal_differs, key=lambda t: t[0]["date"]):
            w.writerow({
                "num_ecriture": ve["num_ecriture"],
                "entry_uuid": entry["uuid"],
                "matched_by": match_kind,
                "date": ve["date"],
                "erp_journal_expected": ve["erp_journal_code"],
                "erp_journal_actual": entry["journal_code"],
                "lines": _fmt_lines(ve["lines"]),
                "total_debit": f"{ve['total_debit']:.2f}",
                "total_credit": f"{ve['total_credit']:.2f}",
                "description": ve["description"],
            })


def write_pack_by_member_csv(pack_diffs: list[dict], path: Path) -> None:
    fieldnames = [
        "member_account_id", "member_label",
        "vulcain_total", "vulcain_count", "erp_total", "erp_count", "diff",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in sorted(pack_diffs, key=lambda r: abs(r["diff"]), reverse=True):
            w.writerow({
                "member_account_id": row["member_key"],
                "member_label": row["member_label"],
                "vulcain_total": f"{row['vulcain_total']:.2f}",
                "vulcain_count": row["vulcain_count"],
                "erp_total": f"{row['erp_total']:.2f}",
                "erp_count": row["erp_count"],
                "diff": f"{row['diff']:.2f}",
            })


def write_pack_validated_csv(pack_validated: list[dict], path: Path) -> None:
    fieldnames = [
        "side", "member_key", "reference", "date", "journal", "description",
        "lines", "total_debit", "total_credit",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in sorted(pack_validated, key=lambda r: r["entry"]["date"]):
            entry = row["entry"]
            if row["side"] == "vulcain":
                reference, journal = entry["num_ecriture"], entry["erp_journal_code"]
            else:
                reference, journal = entry.get("reference") or entry["uuid"], entry["journal_code"]
            w.writerow({
                "side": row["side"],
                "member_key": row["member_key"],
                "reference": reference,
                "date": entry["date"],
                "journal": journal,
                "description": entry["description"],
                "lines": _fmt_lines(entry["lines"]),
                "total_debit": f"{entry['total_debit']:.2f}",
                "total_credit": f"{entry['total_credit']:.2f}",
            })


def print_daily_account_report(account_code: str, rows: list[dict]) -> None:
    total_erp_count = sum(r["erp_count"] for r in rows)
    total_erp_debit = sum(r["erp_debit"] for r in rows)
    total_erp_credit = sum(r["erp_credit"] for r in rows)
    total_vulcain_count = sum(r["vulcain_count"] for r in rows)
    total_vulcain_debit = sum(r["vulcain_debit"] for r in rows)
    total_vulcain_credit = sum(r["vulcain_credit"] for r in rows)
    flagged = [r for r in rows if r["flagged"]]

    print(f"\n=== Daily account totals: {account_code} ===")
    print(
        f"  Global — ERP:     {total_erp_count:>4} lines   D={total_erp_debit:>12.2f}  C={total_erp_credit:>12.2f}  "
        f"net={total_erp_debit - total_erp_credit:>12.2f}"
    )
    print(
        f"  Global — Vulcain: {total_vulcain_count:>4} lines   D={total_vulcain_debit:>12.2f}  C={total_vulcain_credit:>12.2f}  "
        f"net={total_vulcain_debit - total_vulcain_credit:>12.2f}"
    )
    print(f"  Days with a discrepancy: {len(flagged)} / {len(rows)} days with any activity")

    if flagged:
        print("\n  --- Flagged days ---")
        for r in flagged:
            print(
                f"    {r['date']}  ERP: {r['erp_count']:>3}x D={r['erp_debit']:>10.2f} C={r['erp_credit']:>10.2f}  |  "
                f"Vulcain: {r['vulcain_count']:>3}x D={r['vulcain_debit']:>10.2f} C={r['vulcain_credit']:>10.2f}  "
                f"diff={r['diff']:>+10.2f}"
            )
    else:
        print(f"  No day-level discrepancy for account {account_code}.")


def print_account_focus(account_code: str, focused: dict) -> None:
    print(f"\n=== Focused discrepancies: account {account_code} ===")
    print(
        f"  Missing in ERP: {len(focused['missing_in_erp'])}  "
        f"| Extra in ERP: {len(focused['extra_in_erp'])}  "
        f"| Mismatched: {len(focused['mismatched'])}  "
        f"| Journal differs: {len(focused['journal_differs'])}"
    )

    if focused["missing_in_erp"]:
        print(f"\n  --- MISSING_IN_ERP ({len(focused['missing_in_erp'])}) ---")
        for ve in sorted(focused["missing_in_erp"], key=lambda e: e["date"]):
            print(
                f"    n°{ve['num_ecriture']:<8} {ve['date']}  {ve['erp_journal_code']:<4}  "
                f"D={ve['total_debit']:.2f} C={ve['total_credit']:.2f}  {ve['description'][:60]}"
            )

    if focused["extra_in_erp"]:
        print(f"\n  --- EXTRA_IN_ERP ({len(focused['extra_in_erp'])}) ---")
        for e in sorted(focused["extra_in_erp"], key=lambda e: e["date"]):
            print(
                f"    {e['date']}  {e['journal_code']:<4}  D={e['total_debit']:.2f} C={e['total_credit']:.2f}  "
                f"[{e['source_system'] or '?'}]  {e['description'][:55]}"
            )

    if focused["mismatched"]:
        print(f"\n  --- MISMATCHED ({len(focused['mismatched'])}) ---")
        for ve, entry, match_kind in sorted(focused["mismatched"], key=lambda t: t[0]["date"]):
            print(
                f"    n°{ve['num_ecriture']:<8} ({match_kind})  {ve['date']}  "
                f"Vulcain: D={ve['total_debit']:.2f} C={ve['total_credit']:.2f}  |  "
                f"ERP: D={entry['total_debit']:.2f} C={entry['total_credit']:.2f}  {ve['description'][:40]}"
            )

    if focused["journal_differs"]:
        print(f"\n  --- JOURNAL_DIFFERS ({len(focused['journal_differs'])}) ---")
        for ve, entry, match_kind in sorted(focused["journal_differs"], key=lambda t: t[0]["date"]):
            print(
                f"    n°{ve['num_ecriture']:<8} ({match_kind})  {ve['date']}  "
                f"expected {ve['erp_journal_code']:<4} but ERP has {entry['journal_code']:<4}  "
                f"D={ve['total_debit']:.2f} C={ve['total_credit']:.2f}  {ve['description'][:40]}"
            )

    if not any(focused[k] for k in ("missing_in_erp", "extra_in_erp", "mismatched", "journal_differs")):
        print(f"  No discrepancies found for account {account_code}.")


def build_report(
    vulcain_stats: dict, erp_entries: list[dict], exclude_journals: set[str], result: dict, warnings: list[str],
    pack_account_code: str, pack_diffs: list[dict],
    dup_threshold: Decimal, erp_duplicate_groups: list[list[dict]],
) -> str:
    lines = [
        "=== ERP <-> Vulcain Ledger Reconciliation Report ===",
        "",
        "--- Scope ---",
        "  Vulcain side: all non-VVO (non-flight) entries in V_comptabilité_validée_2026.csv",
        f"  ERP side:     all FY2026 entries NOT cancelled, excluding journals {sorted(exclude_journals)}",
        "                (those are computed by the ERP itself from flights/VI/packs)",
        "",
        "--- Vulcain source ---",
        f"  Total num_écriture groups:  {vulcain_stats['total']}",
        f"  Skipped (VVO/flight):       {vulcain_stats['skipped_vvo']}",
        f"  Compared:                   {vulcain_stats['compared']}",
        f"  Warnings:                   {vulcain_stats['warnings']}",
        "",
        "--- ERP source ---",
        f"  Total entries (not cancelled): {len(erp_entries)}",
        f"  Excluded (ERP-computed journals): {sum(1 for e in erp_entries if e['journal_code'] in exclude_journals)}",
        f"  In scope for comparison:       {sum(1 for e in erp_entries if e['journal_code'] not in exclude_journals)}",
        "",
        f"--- ERP duplicate-posting check (same date/account/side/member, threshold {dup_threshold}) ---",
        "  Pure ERP data-quality check — no Vulcain data involved, no journal excluded.",
        "  Two lines from the SAME entry are never flagged against each other.",
        f"  Duplicate groups found: {len(erp_duplicate_groups)}  "
        f"({sum(len(g) for g in erp_duplicate_groups)} entries involved)",
        "",
    ]
    if erp_duplicate_groups:
        lines.append("  Sample groups:")
        for gidx, group in enumerate(sorted(erp_duplicate_groups, key=lambda g: g[0]["date"])[:15], 1):
            first = group[0]
            tiers_note = f"  tiers={first['tiers_label']}" if first["tiers_label"] else ""
            lines.append(
                f"    Group {gidx}: {first['date']}  {first['account_code']}  {first['side']}  "
                f"~{first['amount']:.2f}  ({len(group)} entries){tiers_note}"
            )
            for row in sorted(group, key=lambda r: r["entry_uuid"]):
                state_label = ENTRY_STATE_LABELS.get(row["state"], str(row["state"]))
                lines.append(
                    f"        {row['entry_uuid']}  [{row['journal_code']:<4}]  {state_label:<9}  "
                    f"{row['amount']:>10.2f}  {row['description'][:50]}"
                )
        if len(erp_duplicate_groups) > 15:
            lines.append(f"  … and {len(erp_duplicate_groups) - 15} more — see ledger_reconciliation_erp_duplicates.csv")
        lines.append("")

    lines += [
        "--- Result ---",
        f"  Matched (Vulcain <-> ERP):      {result['matched_count']}",
        f"  MISSING_IN_ERP (Vulcain only):  {len(result['missing_in_erp'])}",
        f"  EXTRA_IN_ERP (ERP only):        {len(result['extra_in_erp'])}",
        f"  MISMATCHED (paired, lines differ): {len(result['mismatched'])}",
        f"  JOURNAL_DIFFERS (matched, wrong journal): {len(result['journal_differs'])}",
        f"  PACK_VALIDATED (pure pack entry, member total confirmed OK): {len(result.get('pack_validated', []))}",
        f"  Ambiguous content matches (informational): {result['ambiguous_count']}",
        "",
    ]

    if result["missing_in_erp"]:
        lines.append("--- Sample: MISSING_IN_ERP (Vulcain entry has no ERP counterpart) ---")
        for ve in sorted(result["missing_in_erp"], key=lambda e: e["date"])[:25]:
            lines.append(
                f"  n°{ve['num_ecriture']:<8} {ve['date']}  {ve['erp_journal_code']:<4}  "
                f"D={ve['total_debit']:.2f} C={ve['total_credit']:.2f}  {ve['description'][:60]}"
            )
        if len(result["missing_in_erp"]) > 25:
            lines.append(f"  … and {len(result['missing_in_erp']) - 25} more — see ledger_reconciliation_missing_in_erp.csv")
        lines.append("")

    if result["extra_in_erp"]:
        lines.append("--- Sample: EXTRA_IN_ERP (ERP entry has no Vulcain counterpart) ---")
        for e in sorted(result["extra_in_erp"], key=lambda e: e["date"])[:25]:
            lines.append(
                f"  {e['date']}  {e['journal_code']:<4}  D={e['total_debit']:.2f} C={e['total_credit']:.2f}  "
                f"[{e['source_system'] or '?'}]  {e['description'][:55]}"
            )
        if len(result["extra_in_erp"]) > 25:
            lines.append(f"  … and {len(result['extra_in_erp']) - 25} more — see ledger_reconciliation_extra_in_erp.csv")
        lines.append("")

    if result["mismatched"]:
        lines.append("--- Sample: MISMATCHED (same entry, different lines) ---")
        for ve, entry, match_kind in sorted(result["mismatched"], key=lambda t: t[0]["date"])[:25]:
            lines.append(
                f"  n°{ve['num_ecriture']:<8} ({match_kind})  {ve['date']}  "
                f"Vulcain: D={ve['total_debit']:.2f} C={ve['total_credit']:.2f}  |  "
                f"ERP: D={entry['total_debit']:.2f} C={entry['total_credit']:.2f}  {ve['description'][:40]}"
            )
        if len(result["mismatched"]) > 25:
            lines.append(f"  … and {len(result['mismatched']) - 25} more — see ledger_reconciliation_mismatched.csv")
        lines.append("")

    if result["journal_differs"]:
        lines.append("--- Sample: JOURNAL_DIFFERS (content matches, but ERP journal is unexpected) ---")
        for ve, entry, match_kind in sorted(result["journal_differs"], key=lambda t: t[0]["date"])[:25]:
            lines.append(
                f"  n°{ve['num_ecriture']:<8} ({match_kind})  {ve['date']}  "
                f"expected {ve['erp_journal_code']:<4} but ERP has {entry['journal_code']:<4}  "
                f"D={ve['total_debit']:.2f} C={ve['total_credit']:.2f}  {ve['description'][:40]}"
            )
        if len(result["journal_differs"]) > 25:
            lines.append(f"  … and {len(result['journal_differs']) - 25} more — see ledger_reconciliation_journal_differs.csv")
        lines.append("")

    lines += [
        f"--- Pack-by-member reconciliation (account {pack_account_code}, date-ignored) ---",
        "  Pack purchases are recorded very differently on each side (Vulcain bundles them",
        "  into a multi-line membership entry; the ERP posts a standalone entry dated when",
        "  the pack module backfilled it, not the purchase date), so entry-level matching",
        "  above can never pair them. This sums the pack account per member instead, with",
        "  no date/journal/entry-grouping involved, to check whether the totals agree.",
        f"  Members with a discrepancy: {len(pack_diffs)}",
        "",
    ]
    if pack_diffs:
        lines.append("  member                                  vulcain_total  erp_total      diff")
        for row in sorted(pack_diffs, key=lambda r: abs(r["diff"]), reverse=True)[:25]:
            lines.append(
                f"  {row['member_label'][:38]:<38}  {row['vulcain_total']:>12.2f}  "
                f"{row['erp_total']:>10.2f}  {row['diff']:>+9.2f}  "
                f"(vulcain x{row['vulcain_count']}, erp x{row['erp_count']})"
            )
        if len(pack_diffs) > 25:
            lines.append(f"  … and {len(pack_diffs) - 25} more — see ledger_reconciliation_pack_by_member.csv")
        lines.append("")
    else:
        lines.append("  All members' pack totals agree between Vulcain and ERP.")
        lines.append("")

    if warnings:
        lines.append(f"--- Warnings: {len(warnings)} ---")
        for w in warnings[:20]:
            lines.append(f"  {w}")
        if len(warnings) > 20:
            lines.append(f"  … and {len(warnings) - 20} more")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare individual ERP entries against the Vulcain ledger export "
                    "(entry-level, not just account balances). Read-only — no fixes applied.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--account-file", metavar="PATH", help="Vulcain->ERP account mapping file")
    parser.add_argument(
        "--exclude-journals", metavar="CODES",
        help="Comma-separated ERP journal codes excluded from the 'extra in ERP' side "
             "(default: FL,REM,VI,AMO,PRO)",
    )
    parser.add_argument(
        "--pack-account", metavar="CODE", default=DEFAULT_PACK_ACCOUNT,
        help=f"ERP account code for pack sales, compared per-member ignoring date "
             f"(default: {DEFAULT_PACK_ACCOUNT})",
    )
    parser.add_argument(
        "--check-account", metavar="CODE",
        help="Focus the report on one ERP account code (e.g. 512) — narrows the "
             "missing/extra/mismatched/journal-differs results to entries with a "
             "line on this account, printed to console and written to dedicated "
             "ledger_reconciliation_account_<CODE>_*.csv files",
    )
    parser.add_argument(
        "--dup-threshold", metavar="AMOUNT", type=Decimal, default=Decimal("0.01"),
        help="ERP-side duplicate-posting check: flag entries sharing the same date, "
             "account, and side (debit/credit) whose amounts are within this tolerance "
             "of each other (default: 0.01). Independent of the Vulcain comparison — "
             "pure ERP data-quality check, no fix applied.",
    )
    parser.add_argument(
        "--daily-account", metavar="CODE", action="append",
        help="Compare ERP vs Vulcain day-by-day totals (debit/credit/count) for one ERP "
             "account code (repeatable — pass multiple times for several accounts). "
             "Useful when neither entry-level nor per-member matching works (e.g. VI "
             "419100/401): coarser than an entry match, but immune to structural "
             "differences, and flags which specific day(s) diverge for manual review. "
             "ERP-computed journals (--exclude-journals) are excluded from the ERP side.",
    )
    parser.add_argument(
        "--daily-threshold", metavar="AMOUNT", type=Decimal, default=Decimal("0.01"),
        help="Tolerance for the --daily-account day-level net diff (default: 0.01)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print summary only, no output files")
    args = parser.parse_args()

    exclude_journals = (
        {c.strip() for c in args.exclude_journals.split(",") if c.strip()}
        if args.exclude_journals else set(DEFAULT_EXCLUDED_JOURNALS)
    )

    print("=== ERP <-> Vulcain Ledger Reconciliation ===")
    print(f"  Excluded ERP journals (computed by ERP): {sorted(exclude_journals)}")
    if args.dry_run:
        print("  [DRY RUN — no output files written]")
    print()

    print("Connecting to ERP database…")
    conn = _connect()
    print("  Connected.")

    print("Loading ERP account lookups…")
    account_lookups = load_account_lookups(conn)

    account_mapping = None
    if args.account_file:
        mapping_path = Path(args.account_file)
        if not mapping_path.exists():
            raise SystemExit(f"ERROR: account mapping file not found: {mapping_path}")
    elif CANONICAL_MAPPING_FILE.exists():
        mapping_path = CANONICAL_MAPPING_FILE
    elif FALLBACK_MAPPING_FILE.exists():
        mapping_path = FALLBACK_MAPPING_FILE
    else:
        mapping_path = None
        print(
            f"  WARNING: no account mapping found ({CANONICAL_MAPPING_FILE} or "
            f"{FALLBACK_MAPPING_FILE}) — falling back to naive 3-digit prefix "
            f"truncation for every Vulcain account code. This misresolves any "
            f"account with curated sub-account mappings (e.g. Pack sales "
            f"706040300 -> 7066, not the generic 706)."
        )

    if mapping_path:
        print(f"  Loading account mapping from {mapping_path}…")
        account_mapping = load_account_mapping(str(mapping_path))
        print(f"  {len(account_mapping)} mapping entries loaded")

    print("Loading ERP entries for FY2026…")
    erp_entries = load_erp_entries(conn, account_lookups["fy_uuid"])
    print(f"  {len(erp_entries)} non-cancelled entries loaded")

    print("Loading member lookups…")
    member_lookups = load_member_match_lookups(conn)

    print(f"Checking for ERP duplicate postings (same date/account/side/member, threshold {args.dup_threshold})…")
    erp_duplicate_groups = find_erp_line_duplicates(
        erp_entries, args.dup_threshold, member_lookups["members_by_uuid"], exclude_journals
    )
    print(f"  {len(erp_duplicate_groups)} duplicate group(s) found "
          f"({sum(len(g) for g in erp_duplicate_groups)} entries involved)")

    print(f"Loading ERP pack summary (account {args.pack_account}) per member…")
    erp_pack_summary = build_erp_pack_summary(
        conn, account_lookups["fy_uuid"], member_lookups["members_by_uuid"], args.pack_account
    )
    print(f"  {len(erp_pack_summary)} members with a {args.pack_account} line in the ERP")
    conn.close()

    print("Loading Vulcain ledger CSV…")
    accounting_rows = _read_csv(LEGACY_DIR / "V_comptabilité_validée_2026.csv")
    print(f"  {len(accounting_rows)} accounting lines")

    daily_account_results: dict[str, list[dict]] = {}
    for daily_code in (args.daily_account or []):
        erp_daily = build_erp_daily_account_totals(erp_entries, daily_code, exclude_journals)
        vulcain_daily = build_vulcain_daily_account_totals(accounting_rows, account_lookups, account_mapping, daily_code)
        daily_account_results[daily_code] = reconcile_daily_account_totals(erp_daily, vulcain_daily, args.daily_threshold)
        print_daily_account_report(daily_code, daily_account_results[daily_code])

    print("Loading Vulcain pilots and building member map…")
    pilot_rows = _read_csv(LEGACY_DIR / "V_pilotes_2026.csv")
    member_map = build_member_map(pilot_rows, member_lookups)

    vulcain_pack_summary = build_vulcain_pack_summary(
        accounting_rows, account_lookups, account_mapping, member_map, args.pack_account
    )
    print(f"  {len(vulcain_pack_summary)} members with a {args.pack_account} line in Vulcain")

    pack_diffs = reconcile_pack_by_member(vulcain_pack_summary, erp_pack_summary)
    print(f"  Pack-by-member discrepancies: {len(pack_diffs)}")

    warnings: list[str] = []
    print("Building Vulcain-side entries…")
    vulcain_entries, vulcain_stats = build_vulcain_entries(
        accounting_rows, account_lookups, account_mapping, warnings
    )
    print(
        f"  {vulcain_stats['total']} groups  "
        f"| {vulcain_stats['skipped_vvo']} skipped (VVO)  "
        f"| {vulcain_stats['compared']} compared"
    )

    print("Reconciling…")
    result = reconcile(vulcain_entries, erp_entries, exclude_journals)
    print(
        f"  Matched: {result['matched_count']}  "
        f"| Missing in ERP: {len(result['missing_in_erp'])}  "
        f"| Extra in ERP: {len(result['extra_in_erp'])}  "
        f"| Mismatched: {len(result['mismatched'])}  "
        f"| Journal differs: {len(result['journal_differs'])}"
    )

    print(f"Validating pure pack entries against the per-member check (account {args.pack_account})…")
    result = apply_pack_validation(
        result, vulcain_pack_summary, erp_pack_summary, pack_diffs, args.pack_account
    )
    print(
        f"  Confirmed via pack check: {len(result['pack_validated'])}  "
        f"| Missing in ERP now: {len(result['missing_in_erp'])}  "
        f"| Extra in ERP now: {len(result['extra_in_erp'])}"
    )

    report_text = build_report(
        vulcain_stats, erp_entries, exclude_journals, result, warnings, args.pack_account, pack_diffs,
        args.dup_threshold, erp_duplicate_groups,
    )
    print("\n" + report_text)

    focused = None
    if args.check_account:
        focused = filter_by_account(result, args.check_account)
        print_account_focus(args.check_account, focused)

    if args.dry_run:
        print("\n[DRY RUN] No files written.")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    report_path = OUTPUT_DIR / "ledger_reconciliation_report.txt"
    report_path.write_text(report_text, encoding="utf-8")
    print(f"Written → {report_path.name}")

    missing_path = OUTPUT_DIR / "ledger_reconciliation_missing_in_erp.csv"
    write_missing_csv(result["missing_in_erp"], missing_path)
    print(f"Written {len(result['missing_in_erp'])} rows → {missing_path.name}")

    extra_path = OUTPUT_DIR / "ledger_reconciliation_extra_in_erp.csv"
    write_extra_csv(result["extra_in_erp"], extra_path)
    print(f"Written {len(result['extra_in_erp'])} rows → {extra_path.name}")

    mismatched_path = OUTPUT_DIR / "ledger_reconciliation_mismatched.csv"
    write_mismatched_csv(result["mismatched"], mismatched_path)
    print(f"Written {len(result['mismatched'])} rows → {mismatched_path.name}")

    journal_differs_path = OUTPUT_DIR / "ledger_reconciliation_journal_differs.csv"
    write_journal_differs_csv(result["journal_differs"], journal_differs_path)
    print(f"Written {len(result['journal_differs'])} rows → {journal_differs_path.name}")

    pack_path = OUTPUT_DIR / "ledger_reconciliation_pack_by_member.csv"
    write_pack_by_member_csv(pack_diffs, pack_path)
    print(f"Written {len(pack_diffs)} rows → {pack_path.name}")

    pack_validated_path = OUTPUT_DIR / "ledger_reconciliation_pack_validated.csv"
    write_pack_validated_csv(result["pack_validated"], pack_validated_path)
    print(f"Written {len(result['pack_validated'])} rows → {pack_validated_path.name}")

    erp_duplicates_path = OUTPUT_DIR / "ledger_reconciliation_erp_duplicates.csv"
    write_erp_duplicates_csv(erp_duplicate_groups, erp_duplicates_path)
    print(f"Written {sum(len(g) for g in erp_duplicate_groups)} rows → {erp_duplicates_path.name}")

    for daily_code, daily_rows in daily_account_results.items():
        daily_path = OUTPUT_DIR / f"ledger_reconciliation_daily_{daily_code}.csv"
        write_daily_account_csv(daily_rows, daily_path)
        print(f"Written {len(daily_rows)} rows → {daily_path.name}")

    if focused is not None:
        code = args.check_account
        prefix = f"ledger_reconciliation_account_{code}"
        write_missing_csv(focused["missing_in_erp"], OUTPUT_DIR / f"{prefix}_missing_in_erp.csv")
        write_extra_csv(focused["extra_in_erp"], OUTPUT_DIR / f"{prefix}_extra_in_erp.csv")
        write_mismatched_csv(focused["mismatched"], OUTPUT_DIR / f"{prefix}_mismatched.csv")
        write_journal_differs_csv(focused["journal_differs"], OUTPUT_DIR / f"{prefix}_journal_differs.csv")
        print(f"Written focused account {code} files → {prefix}_*.csv")

    print(f"\nDone. Review {OUTPUT_DIR}/ledger_reconciliation_report.txt")


if __name__ == "__main__":
    main()
