"""
ERP-CLUB - Member Account ID Rename Tool
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
Rename a member's account_id (e.g. ME2024-0042 → ME2025-0001) across all
database tables that store it as a plain string:

  • members.account_id                    (primary field)
  • validated_flights.pilot_erp_id
  • validated_flights.second_pilot_erp_id
  • validated_flights.charge_to_erp_id

Tables that reference members by UUID (committee_members, member_sheets,
member_registrations, asset_private_owners, accounting_lines.tiers_uuid,
vi_entitlements, member_pack_consumptions, …) are NOT touched — their FK
already points to the immutable members.uuid primary key.

────────────────────────────────────────────────────────────────────────────
Usage
  python rename_member.py OLD_ID NEW_ID [--dry-run] [--yes]

Arguments
  OLD_ID      Current account_id of the member (e.g. ME2024-0042)
  NEW_ID      Desired new account_id (e.g. ME2025-0001)

Options
  --dry-run   Show impact counts without making any changes (no confirmation
              prompt is shown; safe to run at any time)
  --yes       Skip the interactive confirmation prompt and apply immediately
────────────────────────────────────────────────────────────────────────────
"""

import os
import sys
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TOOLS_DIR = Path(__file__).parent.resolve()

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
        "See backend/tools/.env.example for a template."
    )


def _connect() -> psycopg2.extensions.connection:
    url = _load_db_url()
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return psycopg2.connect(url)


# ---------------------------------------------------------------------------
# Impact check
# ---------------------------------------------------------------------------

# (table, column, label)
STRING_ID_COLUMNS = [
    ("validated_flights", "pilot_erp_id",        "validated_flights.pilot_erp_id"),
    ("validated_flights", "second_pilot_erp_id",  "validated_flights.second_pilot_erp_id"),
    ("validated_flights", "charge_to_erp_id",     "validated_flights.charge_to_erp_id"),
]


def check_impact(cur, old_id: str) -> dict:
    """Return row counts per affected location for old_id."""
    impact = {}

    # members row (should always be 1 after existence check)
    cur.execute("SELECT COUNT(*) FROM members WHERE account_id = %s", (old_id,))
    impact["members.account_id"] = cur.fetchone()[0]

    for table, column, label in STRING_ID_COLUMNS:
        cur.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {column} = %s",  # noqa: S608
            (old_id,),
        )
        impact[label] = cur.fetchone()[0]

    return impact


# ---------------------------------------------------------------------------
# Rename (runs inside a single transaction)
# ---------------------------------------------------------------------------

def apply_rename(conn, old_id: str, new_id: str) -> dict:
    """Execute the rename in one transaction; return actual updated counts."""
    updated = {}
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE members SET account_id = %s WHERE account_id = %s",
                (new_id, old_id),
            )
            updated["members.account_id"] = cur.rowcount

            for table, column, label in STRING_ID_COLUMNS:
                cur.execute(
                    f"UPDATE {table} SET {column} = %s WHERE {column} = %s",  # noqa: S608
                    (new_id, old_id),
                )
                updated[label] = cur.rowcount

    return updated


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_impact(impact: dict, verb: str = "will update") -> None:
    total = sum(impact.values())
    print(f"\n  {'Location':<45}  {'Rows':>6}")
    print(f"  {'-'*45}  {'-'*6}")
    for label, count in impact.items():
        marker = "  " if count == 0 else "* "
        print(f"  {marker}{label:<43}  {count:>6}")
    print(f"  {'─'*45}  {'─'*6}")
    print(f"  {'TOTAL':<45}  {total:>6}")
    print()


def main() -> None:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    yes = "--yes" in args
    positional = [a for a in args if not a.startswith("--")]

    if len(positional) != 2:
        print(__doc__)
        sys.exit(1)

    old_id, new_id = positional

    if old_id == new_id:
        print(f"ERROR: OLD_ID and NEW_ID are identical ({old_id!r}).")
        sys.exit(1)

    conn = _connect()
    try:
        with conn.cursor() as cur:
            # --- existence checks ---
            cur.execute(
                "SELECT uuid, first_name, last_name, status FROM members WHERE account_id = %s",
                (old_id,),
            )
            row = cur.fetchone()
            if row is None:
                print(f"ERROR: No member found with account_id = {old_id!r}.")
                sys.exit(1)
            member_uuid, first_name, last_name, status = row
            status_label = {1: "active", 2: "inactive", 3: "archived"}.get(status, str(status))

            cur.execute(
                "SELECT 1 FROM members WHERE account_id = %s",
                (new_id,),
            )
            if cur.fetchone() is not None:
                print(f"ERROR: A member with account_id = {new_id!r} already exists.")
                sys.exit(1)

            # --- impact count ---
            impact = check_impact(cur, old_id)

        print(f"\nRename member account_id")
        print(f"  FROM : {old_id}")
        print(f"  TO   : {new_id}")
        print(f"  Who  : {first_name} {last_name}  (uuid={member_uuid}, status={status_label})")

        _print_impact(impact)

        if dry_run:
            print("Dry-run mode — no changes were made.")
            return

        if not yes:
            try:
                answer = input("Apply rename? [y/N] ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                print("\nAborted.")
                sys.exit(0)
            if answer not in ("y", "yes"):
                print("Aborted.")
                sys.exit(0)

        # --- apply ---
        updated = apply_rename(conn, old_id, new_id)
        print("\nDone. Rows updated:")
        _print_impact(updated, verb="updated")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
