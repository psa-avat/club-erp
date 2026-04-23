"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Accounting module services
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
 """
import hashlib
import json
import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from models import (
    AccountingAccount,
    AccountingEntry,
    AccountingFiscalYear,
    AccountingJournal,
    AccountingLine,
    CostProvisionRule,
    PricingItem,
    PricingVersion,
    SystemSetting,
    User,
)
from schemas.accounting import (
    AccountingEntryCreateRequest,
    AccountingEntryUpdateRequest,
    AccountingLineCreateRequest,
    FiscalYearCreateRequest,
    PricingVersionCreateRequest,
    PricingVersionUpdateRequest,
    SystemSettingUpdateRequest,
)


_PCG_SEED_PATH = Path(__file__).parent.parent / "data" / "pcg_seed.json"
_pcg_logger = logging.getLogger(__name__)


def _load_pcg_seed() -> list[dict]:
    """Load PCG seed data from the JSON file on disk."""
    try:
        with _PCG_SEED_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        _pcg_logger.error("pcg_seed.json not found at %s", _PCG_SEED_PATH)
        return []
    except json.JSONDecodeError as exc:
        _pcg_logger.error("pcg_seed.json is invalid JSON: %s", exc)
        return []


# Keep module-level alias for backwards-compat references in tests / admin tools.
PCG_ASSOCIATION_SEED = _load_pcg_seed()


def export_pcg_seed() -> list[dict]:
    """Return the current PCG seed items from disk."""
    return _load_pcg_seed()


def validate_pcg_seed_items(items: list[dict]) -> list[str]:
    """Run semantic validation on a candidate PCG seed list.

    Returns a list of human-readable error strings (empty = valid).
    Rules:
    - Codes must be non-empty strings.
    - No duplicate codes within the list.
    - Each code's parent (all strict prefixes of decreasing length) must exist in the list
      unless it is a single-character root (e.g. "1", "4", "5", "6", "7").
    - type must be an integer in [1..5].
    """
    errors: list[str] = []
    all_codes: set[str] = set()
    duplicates: set[str] = set()

    for idx, item in enumerate(items):
        code = str(item.get("code", "")).strip()
        if not code:
            errors.append(f"Row {idx}: code is empty.")
            continue
        if code in all_codes:
            duplicates.add(code)
        all_codes.add(code)

        acct_type = item.get("type")
        if not isinstance(acct_type, int) or acct_type not in range(1, 6):
            errors.append(f"Row {idx} (code={code!r}): type must be an integer in [1..5], got {acct_type!r}.")

    for code in sorted(duplicates):
        errors.append(f"Duplicate code: {code!r}.")

    # Parent-check: every non-root code must have at least one ancestor in the list.
    for code in sorted(all_codes):
        if len(code) <= 1:
            continue  # root-level codes have no required parent
        has_parent = any(
            code[:i] in all_codes
            for i in range(len(code) - 1, 0, -1)
        )
        if not has_parent:
            errors.append(
                f"Code {code!r} has no parent prefix in the list "
                f"(expected one of {[code[:i] for i in range(len(code)-1, 0, -1)]!r})."
            )

    return errors


def import_pcg_seed(items: list[dict]) -> None:
    """Persist a new set of PCG seed items to disk, replacing the existing file."""
    _PCG_SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _PCG_SEED_PATH.open("w", encoding="utf-8") as fh:
        json.dump(items, fh, ensure_ascii=False, indent=2)
    # Refresh the module-level alias so the in-process seed stays consistent.
    global PCG_ASSOCIATION_SEED
    PCG_ASSOCIATION_SEED = items


DEFAULT_SYSTEM_SETTINGS: dict[str, dict] = {
    "accounting": {
        "posting": {
            "allow_reopen": True,
            "sequence_format": "{fy_code}-{seq:03d}",
            "hash_algorithm": "sha256",
        },
        "exports": {
            "default_format": "csv",
            "include_entry_hash": True,
        },
    },
    "pricing": {
        "versioning": {
            "overlap_policy": "forbidden",
            "require_fiscal_year": True,
        },
        "rounding": {
            "mode": "half_up",
            "scale": 4,
        },
    },
    "budget": {
        "lifecycle": {
            "allow_revision": True,
            "activation_mode": "manual",
        },
        "kpi": {
            "default_granularity": "account",
        },
    },
    "integrations": {
        "flight_sync": {
            "enabled": False,
            "retry_max": 3,
        },
        "dispatch": {
            "enabled": False,
        },
    },
}


def _safe_partition_suffix(fiscal_year_code: str) -> str:
    """Produce a safe SQL identifier suffix for partition table names."""
    return re.sub(r"[^a-z0-9_]", "_", fiscal_year_code.lower())


async def ensure_fiscal_year_partitions(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    fiscal_year_code: str,
) -> None:
    """Create and migrate year partitions when running on PostgreSQL."""
    bind = db.get_bind()
    if bind is None or bind.dialect.name != "postgresql":
        return

    suffix = _safe_partition_suffix(fiscal_year_code)
    fy_uuid_str = str(fiscal_year_uuid)

    await db.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS accounting_entries_{suffix} "
            f"PARTITION OF accounting_entries FOR VALUES IN ('{fy_uuid_str}')"
        )
    )
    await db.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS accounting_lines_{suffix} "
            f"PARTITION OF accounting_lines FOR VALUES IN ('{fy_uuid_str}')"
        )
    )

    await db.execute(
        text(
            "WITH moved AS ("
            " DELETE FROM ONLY accounting_entries_default"
            " WHERE fiscal_year_uuid = :fy_uuid RETURNING *"
            ") INSERT INTO accounting_entries SELECT * FROM moved"
        ),
        {"fy_uuid": fy_uuid_str},
    )
    await db.execute(
        text(
            "WITH moved AS ("
            " DELETE FROM ONLY accounting_lines_default"
            " WHERE fiscal_year_uuid = :fy_uuid RETURNING *"
            ") INSERT INTO accounting_lines SELECT * FROM moved"
        ),
        {"fy_uuid": fy_uuid_str},
    )


def _normal_balance_for_account_type(account_type: int) -> int:
    """Return default normal balance for account type enum."""
    return 1 if account_type in (1, 4) else 2


def _parent_code(code: str, existing_codes: set[str]) -> str | None:
    """Find the closest hierarchical parent code by prefix."""
    for i in range(len(code) - 1, 0, -1):
        candidate = code[:i]
        if candidate in existing_codes:
            return candidate
    return None


async def seed_association_pcg_accounts(db: AsyncSession) -> dict:
    """Seed a baseline French association PCG subset into accounting_accounts."""
    existing_result = await db.execute(select(AccountingAccount))
    existing_accounts = {account.code: account for account in existing_result.scalars().all()}

    inserted = 0
    updated = 0

    seed_data = _load_pcg_seed()
    for item in sorted(seed_data, key=lambda row: len(row["code"])):
        code = item["code"]
        account = existing_accounts.get(code)
        parent_code = _parent_code(code, set(existing_accounts.keys()) | {row["code"] for row in seed_data})
        parent_uuid = existing_accounts[parent_code].uuid if parent_code and parent_code in existing_accounts else None

        if account is None:
            account = AccountingAccount(
                uuid=uuid4(),
                code=code,
                name=item["name"],
                type=item["type"],
                parent_account_uuid=parent_uuid,
                is_posting_allowed=item.get("is_posting_allowed", True),
                normal_balance=_normal_balance_for_account_type(item["type"]),
                is_reconcilable=item.get("is_reconcilable", False),
                is_active=True,
            )
            db.add(account)
            await db.flush()
            existing_accounts[code] = account
            inserted += 1
        else:
            account.name = item["name"]
            account.type = item["type"]
            account.parent_account_uuid = parent_uuid
            account.is_posting_allowed = item.get("is_posting_allowed", True)
            account.normal_balance = _normal_balance_for_account_type(item["type"])
            account.is_reconcilable = item.get("is_reconcilable", False)
            updated += 1

    await db.commit()
    return {"inserted": inserted, "updated": updated, "total": len(PCG_ASSOCIATION_SEED)}


async def upsert_system_setting(
    db: AsyncSession,
    module_name: str,
    request: SystemSettingUpdateRequest,
    user_id: int,
) -> SystemSetting:
    """Create or update one module settings payload."""
    normalized_module = module_name.strip().lower()
    if not normalized_module:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="module_name must not be empty",
        )

    result = await db.execute(select(SystemSetting).where(SystemSetting.module_name == normalized_module))
    setting = result.scalar_one_or_none()

    if setting is None:
        setting = SystemSetting(
            module_name=normalized_module,
            settings=request.settings,
            updated_by=user_id,
        )
        db.add(setting)
    else:
        setting.settings = request.settings
        setting.updated_by = user_id

    await db.commit()
    await db.refresh(setting)
    return setting


async def get_system_setting(db: AsyncSession, module_name: str) -> SystemSetting:
    """Get one module settings payload by module name."""
    normalized_module = module_name.strip().lower()
    result = await db.execute(select(SystemSetting).where(SystemSetting.module_name == normalized_module))
    setting = result.scalar_one_or_none()
    if setting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"System setting module '{normalized_module}' not found",
        )
    return setting


async def list_system_settings(db: AsyncSession) -> list[SystemSetting]:
    """List all module settings payloads."""
    result = await db.execute(select(SystemSetting).order_by(SystemSetting.module_name.asc()))
    return result.scalars().all()


async def ensure_default_system_settings(db: AsyncSession) -> dict:
    """Ensure default module settings exist for first-run UX."""
    expected_modules = tuple(DEFAULT_SYSTEM_SETTINGS.keys())
    existing_result = await db.execute(
        select(SystemSetting).where(SystemSetting.module_name.in_(expected_modules))
    )
    existing = {row.module_name for row in existing_result.scalars().all()}

    inserted = 0
    for module_name, payload in DEFAULT_SYSTEM_SETTINGS.items():
        if module_name in existing:
            continue

        db.add(
            SystemSetting(
                module_name=module_name,
                settings=dict(payload),
                updated_by=None,
            )
        )
        inserted += 1

    if inserted > 0:
        await db.commit()

    return {
        "inserted": inserted,
        "total_defaults": len(DEFAULT_SYSTEM_SETTINGS),
    }


async def create_pricing_version(
    db: AsyncSession,
    request: PricingVersionCreateRequest,
    user_id: int,
    asset_type_uuid: "UUID | None" = None,
) -> PricingVersion:
    """Create pricing version with fiscal-year and date overlap constraints."""
    fy = await get_or_create_fiscal_year(db, request.fiscal_year_uuid)

    if request.to_date is not None and request.to_date < request.from_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="to_date must be greater than or equal to from_date",
        )

    if request.from_date < fy.start_date or request.from_date > fy.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"from_date {request.from_date} is outside fiscal year [{fy.start_date}, {fy.end_date}]",
        )

    if request.to_date is not None and (request.to_date < fy.start_date or request.to_date > fy.end_date):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"to_date {request.to_date} is outside fiscal year [{fy.start_date}, {fy.end_date}]",
        )

    existing_result = await db.execute(
        select(PricingVersion).where(
            PricingVersion.fiscal_year_uuid == request.fiscal_year_uuid,
            PricingVersion.asset_type_uuid == asset_type_uuid,
        )
    )
    existing_versions = existing_result.scalars().all()

    candidate_end = request.to_date or fy.end_date
    for version in existing_versions:
        existing_end = version.to_date or fy.end_date
        overlaps = request.from_date <= existing_end and candidate_end >= version.from_date
        if overlaps:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Pricing version date range overlaps with existing version {version.uuid} "
                    f"[{version.from_date}, {version.to_date or fy.end_date}]"
                ),
            )

    version = PricingVersion(
        fiscal_year_uuid=request.fiscal_year_uuid,
        name=request.name,
        from_date=request.from_date,
        to_date=request.to_date,
        status=request.status,
        asset_type_uuid=asset_type_uuid,
        created_by=user_id,
    )

    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version


async def get_pricing_version(db: AsyncSession, version_uuid: UUID) -> PricingVersion:
    """Get one pricing version by UUID."""
    result = await db.execute(select(PricingVersion).where(PricingVersion.uuid == version_uuid))
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pricing version {version_uuid} not found",
        )
    return version


def _pricing_ranges_overlap(start_a, end_a, start_b, end_b) -> bool:
    return start_a <= end_b and end_a >= start_b


async def update_pricing_version(
    db: AsyncSession,
    version_uuid: UUID,
    request: PricingVersionUpdateRequest,
    asset_type_uuid: UUID | None = None,
) -> PricingVersion:
    """Update pricing version and enforce fiscal-year and overlap constraints."""
    version = await get_pricing_version(db, version_uuid)
    fy = await get_or_create_fiscal_year(db, version.fiscal_year_uuid)

    next_from = request.from_date if request.from_date is not None else version.from_date
    next_to = request.to_date if request.to_date is not None else version.to_date

    if next_to is not None and next_to < next_from:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="to_date must be greater than or equal to from_date",
        )

    if next_from < fy.start_date or next_from > fy.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"from_date {next_from} is outside fiscal year [{fy.start_date}, {fy.end_date}]",
        )

    if next_to is not None and (next_to < fy.start_date or next_to > fy.end_date):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"to_date {next_to} is outside fiscal year [{fy.start_date}, {fy.end_date}]",
        )

    existing_result = await db.execute(
        select(PricingVersion).where(
            PricingVersion.fiscal_year_uuid == version.fiscal_year_uuid,
            PricingVersion.asset_type_uuid == version.asset_type_uuid,
        )
    )
    existing_versions = existing_result.scalars().all()
    candidate_end = next_to or fy.end_date

    for existing in existing_versions:
        if existing.uuid == version.uuid:
            continue

        existing_end = existing.to_date or fy.end_date
        overlaps = _pricing_ranges_overlap(next_from, candidate_end, existing.from_date, existing_end)
        if overlaps:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Pricing version date range overlaps with existing version {existing.uuid} "
                    f"[{existing.from_date}, {existing.to_date or fy.end_date}]"
                ),
            )

    if request.name is not None:
        version.name = request.name
    if request.from_date is not None:
        version.from_date = request.from_date
    if request.to_date is not None:
        version.to_date = request.to_date
    if request.status is not None:
        version.status = request.status
    if request.asset_type_uuid is not None:
        version.asset_type_uuid = request.asset_type_uuid

    await db.commit()
    await db.refresh(version)
    return version


async def delete_pricing_version(db: AsyncSession, version_uuid: UUID) -> None:
    """Delete one pricing version by UUID."""
    version = await get_pricing_version(db, version_uuid)
    await db.delete(version)
    await db.commit()


async def list_pricing_versions(
    db: AsyncSession,
    fiscal_year_uuid: UUID | None = None,
    asset_type_uuid: UUID | None = None,
) -> list[PricingVersion]:
    """List pricing versions, optionally filtered by fiscal year."""
    stmt = select(PricingVersion)
    if fiscal_year_uuid is not None:
        stmt = stmt.where(PricingVersion.fiscal_year_uuid == fiscal_year_uuid)
    if asset_type_uuid is not None:
        stmt = stmt.where(PricingVersion.asset_type_uuid == asset_type_uuid)
    stmt = stmt.order_by(PricingVersion.from_date.asc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def copy_pricing_versions_from_year(
    db: AsyncSession,
    source_fy_uuid: UUID,
    target_fy_uuid: UUID,
    user_id: int,
) -> dict:
    """Copy all pricing versions from source fiscal year to target fiscal year as Draft.

    Dates are shifted by the year difference between the two fiscal years.
    Versions that would fall outside the target FY boundary are clamped to it.
    Versions already present in the target FY are skipped (no duplicates).
    """
    source_fy = await get_or_create_fiscal_year(db, source_fy_uuid)
    target_fy = await get_or_create_fiscal_year(db, target_fy_uuid)

    if source_fy_uuid == target_fy_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and target fiscal years must be different",
        )

    year_delta = target_fy.year - source_fy.year

    source_versions_result = await db.execute(
        select(PricingVersion)
        .where(PricingVersion.fiscal_year_uuid == source_fy_uuid)
        .options(selectinload(PricingVersion.items))
        .order_by(PricingVersion.from_date.asc())
    )
    source_versions = source_versions_result.scalars().all()

    # Get existing target versions to detect overlaps before inserting
    target_versions_result = await db.execute(
        select(PricingVersion).where(PricingVersion.fiscal_year_uuid == target_fy_uuid)
    )
    existing_target = target_versions_result.scalars().all()

    created: list[PricingVersion] = []
    skipped = 0

    for sv in source_versions:
        # Shift dates by year delta
        try:
            new_from = sv.from_date.replace(year=sv.from_date.year + year_delta)
        except ValueError:
            # Edge case: Feb 29 shift to non-leap year → clamp to Feb 28
            new_from = sv.from_date.replace(year=sv.from_date.year + year_delta, day=28)

        new_to: "date | None" = None
        if sv.to_date is not None:
            try:
                new_to = sv.to_date.replace(year=sv.to_date.year + year_delta)
            except ValueError:
                new_to = sv.to_date.replace(year=sv.to_date.year + year_delta, day=28)

        # Clamp to target FY boundaries
        new_from = max(new_from, target_fy.start_date)
        if new_to is not None:
            new_to = min(new_to, target_fy.end_date)
        else:
            new_to = None  # keep open-ended

        # Check if shifted range fits within target FY
        if new_from > target_fy.end_date:
            skipped += 1
            continue

        # Check overlap with already-existing target versions
        eff_end = new_to or target_fy.end_date
        has_overlap = any(
            _pricing_ranges_overlap(
                new_from, eff_end,
                tv.from_date, tv.to_date or target_fy.end_date,
            )
            for tv in existing_target + created
        )
        if has_overlap:
            skipped += 1
            continue

        new_version = PricingVersion(
            fiscal_year_uuid=target_fy_uuid,
            asset_type_uuid=sv.asset_type_uuid,
            name=sv.name,
            from_date=new_from,
            to_date=new_to,
            status=1,  # always reset to Draft
            is_locked=False,
            created_by=user_id,
        )
        db.add(new_version)
        await db.flush()

        # Copy pricing items from source version
        for si in sv.items:
            new_item = PricingItem(
                pricing_version_uuid=new_version.uuid,
                asset_flight_type_uuid=si.asset_flight_type_uuid,
                name=si.name,
                unit=si.unit,
                base_price=si.base_price,
                threshold_unit_count=si.threshold_unit_count,
                threshold_price=si.threshold_price,
                pack_unit_count=si.pack_unit_count,
                pack_price=si.pack_price,
                include_insurance=si.include_insurance,
                include_fuel=si.include_fuel,
                created_by=user_id,
            )
            db.add(new_item)

        created.append(new_version)

    if created:
        await db.commit()
        for v in created:
            await db.refresh(v)

    return {"copied": len(created), "skipped": skipped, "versions": created}


async def copy_cost_provision_rules_from_year(
    db: AsyncSession,
    source_fy_uuid: UUID,
    target_fy_uuid: UUID,
    user_id: int,
) -> dict:
    """Copy cost provision rules from source fiscal year to target fiscal year.

    Rules are copied with is_active=False (inactive/draft) so they can be reviewed
    before activation. Rules that already exist in the target FY (same asset_type +
    metric_name combination) are skipped to avoid duplicates.
    """
    if source_fy_uuid == target_fy_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and target fiscal years must be different",
        )

    # Verify both fiscal years exist
    source_fy = await get_or_create_fiscal_year(db, source_fy_uuid)
    target_fy = await get_or_create_fiscal_year(db, target_fy_uuid)

    source_rules_result = await db.execute(
        select(CostProvisionRule)
        .where(CostProvisionRule.fiscal_year_uuid == source_fy_uuid)
        .order_by(CostProvisionRule.asset_type_uuid, CostProvisionRule.metric_name)
    )
    source_rules = source_rules_result.scalars().all()

    # Build a set of (asset_type_uuid, metric_name) already in the target FY
    existing_result = await db.execute(
        select(CostProvisionRule.asset_type_uuid, CostProvisionRule.metric_name)
        .where(CostProvisionRule.fiscal_year_uuid == target_fy_uuid)
    )
    existing_keys = {(row[0], row[1]) for row in existing_result.all()}

    created: list[CostProvisionRule] = []
    skipped = 0

    for sr in source_rules:
        key = (sr.asset_type_uuid, sr.metric_name)
        if key in existing_keys:
            skipped += 1
            continue

        new_rule = CostProvisionRule(
            asset_type_uuid=sr.asset_type_uuid,
            fiscal_year_uuid=target_fy_uuid,
            metric_name=sr.metric_name,
            cost_per_unit=sr.cost_per_unit,
            gl_account_debit_uuid=sr.gl_account_debit_uuid,
            gl_account_credit_uuid=sr.gl_account_credit_uuid,
            accrual_method=sr.accrual_method,
            is_active=False,  # reset to inactive — requires review before activation
            created_by=user_id,
        )
        db.add(new_rule)
        existing_keys.add(key)  # guard against duplicates in source data
        created.append(new_rule)

    if created:
        await db.commit()
        for r in created:
            await db.refresh(r)

    _ = source_fy  # suppress unused-variable warning (used for existence check)
    _ = target_fy

    return {"copied": len(created), "skipped": skipped, "rules": created}


async def create_fiscal_year(
    db: AsyncSession,
    request: FiscalYearCreateRequest,
) -> AccountingFiscalYear:

    """Create a new fiscal year."""
    # Validate that year doesn't already exist
    existing = await db.execute(
        select(AccountingFiscalYear).where(AccountingFiscalYear.year == request.year)
    )
    if existing.scalar():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fiscal year {request.year} already exists",
        )

    # Validate that code is unique
    existing_code = await db.execute(
        select(AccountingFiscalYear).where(AccountingFiscalYear.code == request.code)
    )
    if existing_code.scalar():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fiscal year code {request.code} already exists",
        )

    # Validate date range
    if request.end_date <= request.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be after start_date",
        )

    # Create new fiscal year
    fy = AccountingFiscalYear(
        uuid=uuid4(),
        code=request.code,
        label=request.label,
        year=request.year,
        start_date=request.start_date,
        end_date=request.end_date,
        state=1,  # Open
    )

    db.add(fy)
    await db.flush()
    await ensure_fiscal_year_partitions(db, fy.uuid, fy.code)
    await db.commit()
    await db.refresh(fy)
    return fy


async def close_fiscal_year(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    user_id: int,
) -> AccountingFiscalYear:
    """Close a fiscal year: blocks posting operations."""
    fy = await get_or_create_fiscal_year(db, fiscal_year_uuid)

    if fy.state == 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fiscal year {fy.code} is already closed",
        )

    fy.state = 2
    fy.closed_at = datetime.now(timezone.utc)
    fy.closed_by = user_id

    await db.commit()
    await db.refresh(fy)
    return fy


async def reopen_fiscal_year(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
) -> AccountingFiscalYear:
    """Reopen a fiscal year: allows posting operations."""
    fy = await get_or_create_fiscal_year(db, fiscal_year_uuid)

    if fy.state != 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Can only reopen a closed fiscal year (state=2), current={fy.state}",
        )

    fy.state = 3

    await db.commit()
    await db.refresh(fy)
    return fy


async def get_or_create_fiscal_year(db: AsyncSession, fiscal_year_uuid: UUID) -> AccountingFiscalYear:
    """Fetch a fiscal year by UUID; raise 404 if not found."""
    fy = await db.get(AccountingFiscalYear, fiscal_year_uuid)
    if not fy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fiscal year {fiscal_year_uuid} not found",
        )
    return fy


async def validate_fiscal_year_open(db: AsyncSession, fiscal_year_uuid: UUID) -> AccountingFiscalYear:
    """Ensure fiscal year exists and allows posting operations (Open/Reopened)."""
    fy = await get_or_create_fiscal_year(db, fiscal_year_uuid)
    if fy.state == 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fiscal year {fy.code} is closed (state={fy.state})",
        )
    return fy


def _canonical_decimal(value: Decimal) -> str:
    return f"{Decimal(value):.4f}"


def compute_entry_hash(entry: AccountingEntry) -> str:
    """Generate a deterministic SHA-256 digest for a posted entry and its lines."""
    header = [
        str(entry.uuid),
        str(entry.fiscal_year_uuid),
        str(entry.journal_uuid),
        str(entry.entry_date),
        str(entry.sequence_number or ""),
        str(entry.reference or ""),
        str(entry.description or ""),
        str(entry.state),
    ]

    lines = sorted(entry.lines, key=lambda line: str(line.uuid))
    line_payloads: list[str] = []
    for line in lines:
        line_payloads.append(
            "|".join(
                [
                    str(line.uuid),
                    str(line.account_uuid),
                    _canonical_decimal(line.debit),
                    _canonical_decimal(line.credit),
                    str(line.member_uuid or ""),
                    str(line.member_account_id_snapshot or ""),
                    str(line.analytical_asset_uuid or ""),
                    str(line.description or ""),
                ]
            )
        )

    payload = "\n".join(["|".join(header)] + line_payloads)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def get_journal(db: AsyncSession, journal_uuid: UUID) -> AccountingJournal:
    """Fetch a journal by UUID; raise 404 if not found."""
    journal = await db.get(AccountingJournal, journal_uuid)
    if not journal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Journal {journal_uuid} not found",
        )
    return journal


async def get_account(db: AsyncSession, account_uuid: UUID) -> AccountingAccount:
    """Fetch an account by UUID; raise 404 if not found."""
    account = await db.get(AccountingAccount, account_uuid)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account {account_uuid} not found",
        )
    return account


async def validate_entry_date_in_fy(
    entry_date_val,
    fiscal_year: AccountingFiscalYear,
) -> None:
    """Ensure entry_date falls within fiscal year boundaries."""
    if entry_date_val < fiscal_year.start_date or entry_date_val > fiscal_year.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry date {entry_date_val} is outside fiscal year [{fiscal_year.start_date}, {fiscal_year.end_date}]",
        )


async def validate_entry_balance(lines_data: list[AccountingLineCreateRequest]) -> None:
    """Ensure entry is balanced: sum(debit) == sum(credit)."""
    total_debit = sum(line.debit for line in lines_data)
    total_credit = sum(line.credit for line in lines_data)
    if total_debit != total_credit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry is not balanced: debit={total_debit} != credit={total_credit}",
        )




async def create_accounting_entry(
    db: AsyncSession,
    request: AccountingEntryCreateRequest,
    user_id: int,
) -> AccountingEntry:
    """Create a new accounting entry in Draft state."""

    # Validate fiscal year
    fy = await validate_fiscal_year_open(db, request.fiscal_year_uuid)

    # Validate journal
    journal = await get_journal(db, request.journal_uuid)

    # Validate entry_date in fiscal year
    await validate_entry_date_in_fy(request.entry_date, fy)

    # Validate all accounts exist
    for line_req in request.lines:
        await get_account(db, line_req.account_uuid)
    
    # Validate balance
    await validate_entry_balance(request.lines)

    # Create entry
    
    # Create entry
    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        journal_uuid=request.journal_uuid,
        entry_date=request.entry_date,
        reference=request.reference,
        description=request.description,
        state=1,  # Draft
        source_system=request.source_system,
        external_id=request.external_id,
        import_batch_id=request.import_batch_id,
        created_by=user_id,
    )

    # Create lines
    for line_req in request.lines:
        line = AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=request.fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=line_req.account_uuid,
            member_uuid=line_req.member_uuid,
            analytical_asset_uuid=line_req.analytical_asset_uuid,
            debit=line_req.debit,
            credit=line_req.credit,
            description=line_req.description,
            tax_code=line_req.tax_code,
            tax_rate=line_req.tax_rate,
            tax_base=line_req.tax_base,
            tax_amount=line_req.tax_amount,
        )
        entry.lines.append(line)

    db.add(entry)
    await db.commit()
    await db.refresh(entry, ["fiscal_year", "journal", "lines"])
    return entry


async def get_accounting_entry(
    db: AsyncSession,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
) -> AccountingEntry:
    """Fetch an accounting entry with its lines."""
    stmt = (
        select(AccountingEntry)
        .where(
            and_(
                AccountingEntry.uuid == entry_uuid,
                AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
            )
        )
        .options(
            joinedload(AccountingEntry.fiscal_year),
            joinedload(AccountingEntry.journal),
            joinedload(AccountingEntry.lines),
        )
    )
    entry = await db.scalar(stmt)
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entry {entry_uuid} not found in fiscal year {fiscal_year_uuid}",
        )
    return entry


async def update_accounting_entry(
    db: AsyncSession,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    request: AccountingEntryUpdateRequest,
    user_id: int,
) -> AccountingEntry:
    """Update a Draft accounting entry."""
    entry = await get_accounting_entry(db, entry_uuid, fiscal_year_uuid)

    if entry.state != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot update entry in state {entry.state} (Draft only)",
        )

    # Fetch fiscal year once
    fy = entry.fiscal_year or await get_or_create_fiscal_year(db, fiscal_year_uuid)
    if fy.state == 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot update entry in closed fiscal year {fy.code}",
        )

    # Update scalar fields if provided
    if request.journal_uuid is not None:
        journal = await get_journal(db, request.journal_uuid)
        entry.journal_uuid = request.journal_uuid
    if request.entry_date is not None:


        await validate_entry_date_in_fy(request.entry_date, fy)
        entry.entry_date = request.entry_date
    
    if request.description is not None:
        entry.description = request.description

    if request.reference is not None:
        entry.reference = request.reference

    # Update lines if provided
    if request.lines is not None:
        # Validate all accounts
        for line_req in request.lines:
            await get_account(db, line_req.account_uuid)

        # Validate balance
        await validate_entry_balance(request.lines)
        
        # Delete old lines
        await db.execute(
            select(AccountingLine)
            .where(
                and_(
                    AccountingLine.entry_uuid == entry_uuid,
                    AccountingLine.fiscal_year_uuid == fiscal_year_uuid,
                )
            )
        )

        entry.lines.clear()
        
        # Create new lines
        for line_req in request.lines:
            line = AccountingLine(
                uuid=uuid4(),
                fiscal_year_uuid=fiscal_year_uuid,
                entry_uuid=entry_uuid,
                account_uuid=line_req.account_uuid,
                member_uuid=line_req.member_uuid,
                analytical_asset_uuid=line_req.analytical_asset_uuid,
                debit=line_req.debit,
                credit=line_req.credit,
                description=line_req.description,
                tax_code=line_req.tax_code,
                tax_rate=line_req.tax_rate,
                tax_base=line_req.tax_base,
                tax_amount=line_req.tax_amount,
            )
            entry.lines.append(line)

    await db.commit()
    await db.refresh(entry, ["fiscal_year", "journal", "lines"])
    return entry


async def post_accounting_entry(
    db: AsyncSession,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
) -> AccountingEntry:
    """Post (lock) a Draft entry: validates balance and assigns sequence number."""
    entry = await get_accounting_entry(db, entry_uuid, fiscal_year_uuid)

    if entry.state != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entry is not in Draft state (state={entry.state})",
        )

    # Verify fiscal year is still open
    fy = entry.fiscal_year or await get_or_create_fiscal_year(db, fiscal_year_uuid)
    if fy.state == 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot post entry into closed fiscal year {fy.code}",
        )

    # Final balance check
    total_debit = sum(line.debit for line in entry.lines)
    total_credit = sum(line.credit for line in entry.lines)
    if total_debit != total_credit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry is not balanced: debit={total_debit} != credit={total_credit}",
        )

    # Assign sequence number (format: FY2026-001, FY2026-002, etc.)
    max_seq_result = await db.execute(
        select(AccountingEntry.sequence_number)
        .where(
            and_(
                AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
                AccountingEntry.sequence_number.isnot(None),
            )
        )
        .order_by(AccountingEntry.sequence_number.desc())
        .limit(1)
    )

    max_seq_row = max_seq_result.scalar()
    if max_seq_row:
        # Extract number from sequence like "FY2026-001"
        seq_num = int(max_seq_row.split("-")[-1]) + 1
    else:
        seq_num = 1

    entry.sequence_number = f"{fy.code}-{seq_num:03d}"
    entry.state = 2  # Posted
    entry.posted_at = datetime.now(timezone.utc)
    entry.entry_hash = compute_entry_hash(entry)
    
    await db.commit()
    await db.refresh(entry, ["fiscal_year", "journal", "lines"])
    return entry


async def list_fiscal_years(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[AccountingFiscalYear]:
    """List all fiscal years."""
    stmt = select(AccountingFiscalYear).offset(skip).limit(limit).order_by(AccountingFiscalYear.year.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def create_reversal_entry(
    db: AsyncSession,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    reversal_reason: str,
    user_id: int,
    entry_date=None,
) -> AccountingEntry:
    """Create a reversal Draft entry for a Posted source entry."""
    original = await get_accounting_entry(db, entry_uuid, fiscal_year_uuid)

    if original.state != 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Can only reverse a Posted entry (state=2), current={original.state}",
        )

    fy = original.fiscal_year or await get_or_create_fiscal_year(db, fiscal_year_uuid)
    if fy.state == 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot create reversal in closed fiscal year {fy.code}",
        )

    reversal_uuid = uuid4()
    effective_date = entry_date or original.entry_date
    await validate_entry_date_in_fy(effective_date, fy)

    reversal = AccountingEntry(
        uuid=reversal_uuid,
        fiscal_year_uuid=original.fiscal_year_uuid,
        journal_uuid=original.journal_uuid,
        entry_date=effective_date,
        reference=original.reference,
        description=f"Reversal of {original.sequence_number or original.uuid}",
        state=1,
        reversal_of_entry_uuid=original.uuid,
        reversal_reason=reversal_reason,
        created_by=user_id,
    )

    for line in original.lines:
        reversal_line = AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=original.fiscal_year_uuid,
            entry_uuid=reversal_uuid,
            account_uuid=line.account_uuid,
            member_uuid=line.member_uuid,
            member_account_id_snapshot=line.member_account_id_snapshot,
            analytical_asset_uuid=line.analytical_asset_uuid,
            debit=line.credit,
            credit=line.debit,
            description=line.description,
            tax_code=line.tax_code,
            tax_rate=line.tax_rate,
            tax_base=line.tax_base,
            tax_amount=line.tax_amount,
        )
        reversal.lines.append(reversal_line)

    db.add(reversal)
    await db.commit()
    await db.refresh(reversal, ["fiscal_year", "journal", "lines"])
    return reversal


async def list_accounts(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[AccountingAccount]:
    """List all accounts."""
    stmt = select(AccountingAccount).offset(skip).limit(limit).order_by(AccountingAccount.code)
    result = await db.execute(stmt)
    return result.scalars().all()


async def list_journals(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[AccountingJournal]:
    """List all journals."""
    stmt = select(AccountingJournal).offset(skip).limit(limit).order_by(AccountingJournal.code)
    result = await db.execute(stmt)
    return result.scalars().all()
