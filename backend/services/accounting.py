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
import csv
import hashlib
import io
import json
import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, exists, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from models import (
    AccountingAccount,
    AccountingEntry,
    AccountingEntryTemplate,
    AccountingEntryTemplateLine,
    AccountingFiscalYear,
    AccountingJournal,
    AccountingLine,
    CostProvisionRule,
    Member,
    PricingItem,
    PricingItemTier,
    PricingVersion,
    SystemSetting,
    User,
)
from schemas.accounting import (
    AccountingEntryCreateRequest,
    AccountingEntryTemplateCreateRequest,
    AccountingEntryTemplateLineCreateRequest,
    AccountingEntryTemplateUpdateRequest,
    AccountingEntryUpdateRequest,
    AccountingLineCreateRequest,
    FiscalYearCreateRequest,
    PricingItemCreateRequest,
    PricingItemTierCreate,
    PricingVersionCloneRequest,
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
    "flight_billing": {
        "discount_period_days": 30,
        "allow_post_purchase_recalculation": True,
        "max_days_for_post_purchase_discount": 30,
        "require_approval_for_late_discount": True,
    },
}


DEFAULT_ACCOUNTING_JOURNALS: tuple[dict[str, object], ...] = (
    {"code": "VT", "name": "Journal des ventes", "type": 1, "is_active": True},
    {"code": "HA", "name": "Journal des achats", "type": 2, "is_active": True},
    {"code": "BQ", "name": "Journal de banque", "type": 3, "is_active": True},
    {"code": "CS", "name": "Journal de caisse", "type": 4, "is_active": True},
    {"code": "OD", "name": "Opérations diverses", "type": 5, "is_active": True},
    {"code": "AN", "name": "Journal à-nouveaux", "type": 6, "is_active": True},
    {"code": "FL", "name": "Journal des vols", "type": 7, "is_active": True},
)

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


async def ensure_default_journals(db: AsyncSession) -> dict:
    """Ensure a baseline set of accounting journals exists for first-run UX."""
    expected_codes = tuple(journal["code"] for journal in DEFAULT_ACCOUNTING_JOURNALS)
    existing_result = await db.execute(
        select(AccountingJournal).where(AccountingJournal.code.in_(expected_codes))
    )
    existing_by_code = {row.code: row for row in existing_result.scalars().all()}

    inserted = 0
    reactivated = 0

    for payload in DEFAULT_ACCOUNTING_JOURNALS:
        code = str(payload["code"])
        journal = existing_by_code.get(code)

        if journal is None:
            db.add(
                AccountingJournal(
                    code=code,
                    name=str(payload["name"]),
                    type=int(payload["type"]),
                    is_active=bool(payload["is_active"]),
                )
            )
            inserted += 1
            continue

        if not journal.is_active:
            journal.is_active = True
            reactivated += 1

    if inserted > 0 or reactivated > 0:
        await db.commit()

    return {
        "inserted": inserted,
        "reactivated": reactivated,
        "total_defaults": len(DEFAULT_ACCOUNTING_JOURNALS),
    }


async def create_pricing_version(
    db: AsyncSession,
    request: PricingVersionCreateRequest,
    user_id: int,
    asset_type_uuid: "UUID | None" = None,
) -> PricingVersion:
    """Create pricing version with fiscal-year and date overlap constraints."""
    if request.status != PRICING_STATUS_DRAFT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Pricing versions must be created in Draft status.",
        )

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
        use_pack=request.use_pack,
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


PRICING_STATUS_DRAFT = 1
PRICING_STATUS_ACTIVE = 2
PRICING_STATUS_ARCHIVED = 3


def _pricing_status_label(status_code: int) -> str:
    labels = {
        PRICING_STATUS_DRAFT: "Draft",
        PRICING_STATUS_ACTIVE: "Active",
        PRICING_STATUS_ARCHIVED: "Archived",
    }
    return labels.get(status_code, f"Unknown({status_code})")


def _ensure_pricing_version_mutable(version: PricingVersion) -> None:
    if version.is_locked:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pricing version is locked.")
    if version.status != PRICING_STATUS_DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Only Draft pricing versions are editable. "
                f"Current status is {_pricing_status_label(version.status)}."
            ),
        )


def _validate_pricing_status_transition(current_status: int, next_status: int) -> None:
    if current_status == next_status:
        return
    allowed = {
        PRICING_STATUS_DRAFT: {PRICING_STATUS_ACTIVE, PRICING_STATUS_ARCHIVED},
        PRICING_STATUS_ACTIVE: {PRICING_STATUS_DRAFT, PRICING_STATUS_ARCHIVED},
        PRICING_STATUS_ARCHIVED: set(),
    }
    if next_status not in allowed.get(current_status, set()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Invalid pricing version status transition: "
                f"{_pricing_status_label(current_status)} -> {_pricing_status_label(next_status)}."
            ),
        )


async def _validate_pricing_version_activation(db: AsyncSession, version_uuid: UUID) -> None:
    missing_credit_query = await db.execute(
        select(PricingItem.uuid).where(
            PricingItem.pricing_version_uuid == version_uuid,
            PricingItem.gl_account_credit_uuid.is_(None),
        )
    )
    if missing_credit_query.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Cannot activate pricing version: all pricing items must define "
                "gl_account_credit_uuid before activation."
            ),
        )


async def update_pricing_version(
    db: AsyncSession,
    version_uuid: UUID,
    request: PricingVersionUpdateRequest,
    asset_type_uuid: UUID | None = None,
) -> PricingVersion:
    """Update pricing version and enforce fiscal-year and overlap constraints."""
    version = await get_pricing_version(db, version_uuid)
    fy = await get_or_create_fiscal_year(db, version.fiscal_year_uuid)

    if version.is_locked:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pricing version is locked.")

    current_status = version.status
    next_status = request.status if request.status is not None else current_status
    _validate_pricing_status_transition(current_status, next_status)

    requested_mutable_fields = {
        field_name
        for field_name, field_value in (
            ("name", request.name),
            ("from_date", request.from_date),
            ("to_date", request.to_date),
            ("asset_type_uuid", request.asset_type_uuid),
            ("use_pack", request.use_pack),
        )
        if field_value is not None
    }
    mutable_fields_requested = len(requested_mutable_fields) > 0
    if mutable_fields_requested and current_status != PRICING_STATUS_DRAFT:
        allow_archiving_end_date_update = (
            current_status == PRICING_STATUS_ACTIVE
            and next_status == PRICING_STATUS_ARCHIVED
            and requested_mutable_fields.issubset({"to_date"})
        )
        if not allow_archiving_end_date_update:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Only Draft pricing versions can modify name/date/scope/options. "
                    f"Current status is {_pricing_status_label(current_status)}."
                ),
            )

    next_from = request.from_date if request.from_date is not None else version.from_date
    if current_status == PRICING_STATUS_ACTIVE and next_status == PRICING_STATUS_ARCHIVED and request.to_date is None:
        # Archiving an active version closes its validity period at today by default.
        next_to = date.today()
    else:
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
    if request.use_pack is not None:
        version.use_pack = request.use_pack

    if current_status != PRICING_STATUS_ACTIVE and next_status == PRICING_STATUS_ACTIVE:
        await _validate_pricing_version_activation(db, version.uuid)

    await db.commit()
    await db.refresh(version)
    return version


async def clone_pricing_version(
    db: AsyncSession,
    source_version_uuid: UUID,
    request: PricingVersionCloneRequest,
    user_id: int,
) -> PricingVersion:
    """Clone one pricing version into a new Draft version with copied items and tiers."""
    source_version = await get_pricing_version(db, source_version_uuid)
    clone_request = PricingVersionCreateRequest(
        fiscal_year_uuid=source_version.fiscal_year_uuid,
        asset_type_uuid=source_version.asset_type_uuid,
        name=request.name,
        from_date=request.from_date,
        to_date=request.to_date,
        status=PRICING_STATUS_DRAFT,
        use_pack=request.use_pack if request.use_pack is not None else source_version.use_pack,
    )

    cloned_version = await create_pricing_version(
        db,
        clone_request,
        user_id=user_id,
        asset_type_uuid=source_version.asset_type_uuid,
    )

    source_items_result = await db.execute(
        select(PricingItem)
        .where(PricingItem.pricing_version_uuid == source_version_uuid)
        .options(selectinload(PricingItem.tiers))
        .order_by(PricingItem.name.asc())
    )
    source_items = source_items_result.scalars().all()

    for source_item in source_items:
        item_request = PricingItemCreateRequest(
            flight_type_uuid=source_item.flight_type_uuid,
            name=source_item.name,
            unit=source_item.unit,
            base_price=source_item.base_price,
            age_discount_percent=source_item.age_discount_percent,
            gl_account_credit_uuid=source_item.gl_account_credit_uuid,
            tiers=[
                PricingItemTierCreate(
                    from_qty=tier.from_qty,
                    price=tier.price,
                )
                for tier in sorted(source_item.tiers, key=lambda t: t.sort_order)
            ],
        )
        await create_pricing_item(db, cloned_version.uuid, item_request)

    return cloned_version


async def delete_pricing_version(db: AsyncSession, version_uuid: UUID) -> None:
    """Delete one pricing version by UUID."""
    version = await get_pricing_version(db, version_uuid)
    _ensure_pricing_version_mutable(version)
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


async def list_pricing_items(db: AsyncSession, version_uuid: UUID) -> list[PricingItem]:
    """List all pricing items for a given pricing version (tiers eager-loaded)."""
    await get_pricing_version(db, version_uuid)
    result = await db.execute(
        select(PricingItem)
        .where(PricingItem.pricing_version_uuid == version_uuid)
        .options(selectinload(PricingItem.tiers))
        .order_by(PricingItem.name)
    )
    return result.scalars().all()


async def get_pricing_item(db: AsyncSession, item_uuid: UUID) -> PricingItem:
    """Fetch one pricing item (tiers eager-loaded) or raise 404."""
    result = await db.execute(
        select(PricingItem)
        .where(PricingItem.uuid == item_uuid)
        .options(selectinload(PricingItem.tiers))
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pricing item not found.")
    return obj


def _decimal_places(value: Decimal) -> int:
    exponent = value.as_tuple().exponent
    return -exponent if exponent < 0 else 0


def _unit_label(unit: int) -> str:
    labels = {
        1: "flight time",
        2: "engine time (minute)",
        3: "engine time (1/100 h)",
        4: "flight duration",
        5: "per flight",
        6: "fixed",
    }
    return labels.get(unit, f"unit={unit}")


def _from_qty_max_decimals(unit: int) -> int:
    # FlightTime (unit=1) is in hours (1 decimal max); FlightDuration (unit=4) is in integer minutes.
    if unit in {1}:
        return 1
    return 0


def _validate_pricing_precision(
    *,
    unit: int,
    base_price: Decimal | None,
    age_discount_percent: Decimal | None,
    tiers: list | None,
) -> None:
    if base_price is not None and _decimal_places(base_price) > 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="base_price must have at most 2 decimal places.",
        )
    if age_discount_percent is not None:
        if _decimal_places(age_discount_percent) > 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="age_discount_percent must have at most 2 decimal places.",
            )
        if age_discount_percent < 0 or age_discount_percent > 100:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="age_discount_percent must be between 0 and 100.",
            )

    if tiers is None:
        return

    max_decimals = _from_qty_max_decimals(unit)
    for tier in tiers:
        if _decimal_places(tier.price) > 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="tier.price must have at most 2 decimal places.",
            )
        if tier.from_qty <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="tier.from_qty must be greater than 0 because base_price is the implicit threshold at 0.",
            )
        if _decimal_places(tier.from_qty) > max_decimals:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"tier.from_qty for {_unit_label(unit)} must have at most "
                    f"{max_decimals} decimal place(s)."
                ),
            )


async def _replace_pricing_item_tiers(
    db: AsyncSession,
    item: PricingItem,
    tier_payloads: list,
) -> None:
    """Delete existing tiers and insert new ones sorted by from_qty."""
    _validate_pricing_precision(
        unit=item.unit,
        base_price=None,
        age_discount_percent=None,
        tiers=tier_payloads,
    )
    await db.execute(
        delete(PricingItemTier).where(
            PricingItemTier.pricing_item_uuid == item.uuid
        )
    )
    sorted_tiers = sorted(tier_payloads, key=lambda t: t.from_qty)
    for i, tier in enumerate(sorted_tiers):
        db.add(PricingItemTier(
            pricing_item_uuid=item.uuid,
            from_qty=tier.from_qty,
            price=tier.price,
            sort_order=i,
        ))


async def create_pricing_item(
    db: AsyncSession,
    version_uuid: UUID,
    request,
) -> PricingItem:
    """Create a pricing item inside a mutable (Draft + unlocked) pricing version."""
    version = await get_pricing_version(db, version_uuid)
    _ensure_pricing_version_mutable(version)
    tier_payloads = request.tiers or []
    _validate_pricing_precision(
        unit=request.unit,
        base_price=request.base_price,
        age_discount_percent=request.age_discount_percent,
        tiers=tier_payloads,
    )
    if request.gl_account_credit_uuid is not None:
        credit_account = await get_account(db, request.gl_account_credit_uuid)
        if not credit_account.is_posting_allowed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Account {credit_account.code} is a grouping account and does not allow posting.",
            )
    item_data = request.model_dump(exclude={'tiers'})
    obj = PricingItem(
        pricing_version_uuid=version_uuid,
        **item_data,
    )
    db.add(obj)
    await db.flush()
    if tier_payloads:
        await _replace_pricing_item_tiers(db, obj, tier_payloads)
    await db.commit()
    await db.refresh(obj, ['tiers'])
    return obj


async def update_pricing_item(
    db: AsyncSession,
    item_uuid: UUID,
    request,
) -> PricingItem:
    """Partially update a pricing item; version must be mutable (Draft + unlocked)."""
    obj = await get_pricing_item(db, item_uuid)
    version = await get_pricing_version(db, obj.pricing_version_uuid)
    _ensure_pricing_version_mutable(version)
    update_data = request.model_dump(exclude_unset=True)
    tier_payloads = update_data.pop('tiers', None)

    effective_unit = update_data.get('unit', obj.unit)
    _validate_pricing_precision(
        unit=effective_unit,
        base_price=update_data.get('base_price'),
        age_discount_percent=update_data.get('age_discount_percent'),
        tiers=request.tiers if tier_payloads is not None else None,
    )
    if 'gl_account_credit_uuid' in update_data and update_data['gl_account_credit_uuid'] is not None:
        credit_account = await get_account(db, update_data['gl_account_credit_uuid'])
        if not credit_account.is_posting_allowed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Account {credit_account.code} is a grouping account and does not allow posting.",
            )

    for field, value in update_data.items():
        setattr(obj, field, value)
    if tier_payloads is not None:
        await _replace_pricing_item_tiers(db, obj, request.tiers)
    await db.commit()
    await db.refresh(obj, ['tiers'])
    return obj


async def delete_pricing_item(db: AsyncSession, item_uuid: UUID) -> None:
    """Delete a pricing item; version must be mutable (Draft + unlocked)."""
    obj = await get_pricing_item(db, item_uuid)
    version = await get_pricing_version(db, obj.pricing_version_uuid)
    _ensure_pricing_version_mutable(version)
    await db.delete(obj)
    await db.commit()


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
        .options(selectinload(PricingVersion.items).selectinload(PricingItem.tiers))
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
                flight_type_uuid=si.flight_type_uuid,
                name=si.name,
                unit=si.unit,
                base_price=si.base_price,
                age_discount_percent=si.age_discount_percent,
                gl_account_credit_uuid=si.gl_account_credit_uuid,
                created_by=user_id,
            )
            db.add(new_item)
            await db.flush()
            for tier in si.tiers:
                db.add(PricingItemTier(
                    pricing_item_uuid=new_item.uuid,
                    from_qty=tier.from_qty,
                    price=tier.price,
                    sort_order=tier.sort_order,
                ))

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


async def validate_entry_balance(lines_data: list[AccountingLineCreateRequest | AccountingEntryTemplateLineCreateRequest]) -> None:
    """Ensure entry is balanced: sum(debit) == sum(credit).

    Lines with formula_type 'rounding_adjustment' are excluded from
    the balance check — they will be calculated at generation time.
    """
    non_rounding = [l for l in lines_data if getattr(l, 'formula_type', 'fixed') != 'rounding_adjustment']
    if not non_rounding:
        return  # Only rounding_adjustment lines — balance will be computed at generation
    total_debit = sum(line.debit for line in non_rounding)
    total_credit = sum(line.credit for line in non_rounding)
    if total_debit != total_credit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry is not balanced: debit={total_debit} != credit={total_credit}",
        )


async def list_accounting_entries(
    db: AsyncSession,
    *,
    fiscal_year_uuid: UUID | None = None,
    journal_uuid: UUID | None = None,
    state: int | None = None,
    search: str | None = None,
    member_uuid: UUID | None = None,
    member: str | None = None,
    account_code: str | None = None,
    description: str | None = None,
    entry_date_from: date | None = None,
    entry_date_to: date | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[AccountingEntry]:
    """List accounting entries with optional fiscal year, journal, state, member, and text filters."""
    stmt = (
        select(AccountingEntry)
        .options(
            joinedload(AccountingEntry.fiscal_year),
            joinedload(AccountingEntry.journal),
            joinedload(AccountingEntry.lines).joinedload(AccountingLine.member),
        )
        .order_by(AccountingEntry.entry_date.desc(), AccountingEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    stmt = _apply_accounting_entry_filters(
        stmt,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
        state=state,
        search=search,
        member_uuid=member_uuid,
        member=member,
        account_code=account_code,
        description=description,
        entry_date_from=entry_date_from,
        entry_date_to=entry_date_to,
        amount_min=amount_min,
        amount_max=amount_max,
    )

    result = await db.scalars(stmt)
    entries = result.unique().all()
    
    # Populate member_first_name and member_last_name from loaded member relationship
    for entry in entries:
        for line in entry.lines:
            if hasattr(line, 'member') and line.member:
                line.member_first_name = line.member.first_name
                line.member_last_name = line.member.last_name
    
    # Batch-fetch asset codes/names for all lines across all entries
    all_asset_uuids = set()
    for entry in entries:
        for line in entry.lines:
            if line.analytical_asset_uuid:
                all_asset_uuids.add(line.analytical_asset_uuid)
    if all_asset_uuids:
        from models import Asset
        asset_result = await db.execute(
            select(Asset.uuid, Asset.code, Asset.name).where(Asset.uuid.in_(list(all_asset_uuids)))
        )
        asset_map = {row.uuid: (row.code, row.name) for row in asset_result.all()}
        for entry in entries:
            for line in entry.lines:
                if line.analytical_asset_uuid and line.analytical_asset_uuid in asset_map:
                    line.analytical_asset_code, line.analytical_asset_name = asset_map[line.analytical_asset_uuid]
    
    return entries

async def count_accounting_entries(
    db: AsyncSession,
    *,
    fiscal_year_uuid: UUID | None = None,
    journal_uuid: UUID | None = None,
    state: int | None = None,
    search: str | None = None,
    member_uuid: UUID | None = None,
    member: str | None = None,
    account_code: str | None = None,
    description: str | None = None,
    entry_date_from: date | None = None,
    entry_date_to: date | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
) -> int:
    """Return the total count of accounting entries matching the given filters."""
    stmt = select(func.count()).select_from(AccountingEntry)
    stmt = _apply_accounting_entry_filters(
        stmt,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
        state=state,
        search=search,
        member_uuid=member_uuid,
        member=member,
        account_code=account_code,
        description=description,
        entry_date_from=entry_date_from,
        entry_date_to=entry_date_to,
        amount_min=amount_min,
        amount_max=amount_max,
    )
    result = await db.scalar(stmt)
    return result or 0


def _apply_accounting_entry_filters(
    stmt,
    *,
    fiscal_year_uuid: UUID | None = None,
    journal_uuid: UUID | None = None,
    state: int | None = None,
    search: str | None = None,
    member_uuid: UUID | None = None,
    member: str | None = None,
    account_code: str | None = None,
    description: str | None = None,
    entry_date_from: date | None = None,
    entry_date_to: date | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
):
    if fiscal_year_uuid is not None:
        stmt = stmt.where(AccountingEntry.fiscal_year_uuid == fiscal_year_uuid)
    if journal_uuid is not None:
        stmt = stmt.where(AccountingEntry.journal_uuid == journal_uuid)
    if state is not None:
        stmt = stmt.where(AccountingEntry.state == state)
    if member_uuid is not None:
        stmt = stmt.where(
            exists(
                select(AccountingLine.uuid)
                .where(
                    AccountingLine.entry_uuid == AccountingEntry.uuid,
                    AccountingLine.member_uuid == member_uuid,
                )
                .correlate(AccountingEntry)
            )
        )

    if member:
        term = f"%{member.strip()}%"
        if term != "%%":
            stmt = stmt.where(
                exists(
                    select(AccountingLine.uuid)
                    .select_from(AccountingLine)
                    .outerjoin(Member, Member.uuid == AccountingLine.member_uuid)
                    .where(
                        AccountingLine.entry_uuid == AccountingEntry.uuid,
                        (
                            AccountingLine.member_account_id_snapshot.ilike(term)
                            | Member.account_id.ilike(term)
                            | Member.first_name.ilike(term)
                            | Member.last_name.ilike(term)
                        ),
                    )
                    .correlate(AccountingEntry)
                )
            )

    if account_code:
        code_term = f"%{account_code.strip()}%"
        if code_term != "%%":
            stmt = stmt.where(
                exists(
                    select(AccountingLine.uuid)
                    .select_from(AccountingLine)
                    .join(AccountingAccount, AccountingAccount.uuid == AccountingLine.account_uuid)
                    .where(
                        AccountingLine.entry_uuid == AccountingEntry.uuid,
                        AccountingAccount.code.ilike(code_term),
                    )
                    .correlate(AccountingEntry)
                )
            )

    if description:
        description_term = f"%{description.strip()}%"
        if description_term != "%%":
            stmt = stmt.where(
                AccountingEntry.description.ilike(description_term)
                | exists(
                    select(AccountingLine.uuid)
                    .where(
                        AccountingLine.entry_uuid == AccountingEntry.uuid,
                        AccountingLine.description.ilike(description_term),
                    )
                    .correlate(AccountingEntry)
                )
            )

    if entry_date_from is not None:
        stmt = stmt.where(AccountingEntry.entry_date >= entry_date_from)
    if entry_date_to is not None:
        stmt = stmt.where(AccountingEntry.entry_date <= entry_date_to)

    if amount_min is not None or amount_max is not None:
        # Amount displayed in the journal list uses the total debit side per entry.
        amount_expr = (
            select(func.coalesce(func.sum(AccountingLine.debit), Decimal("0.0000")))
            .where(AccountingLine.entry_uuid == AccountingEntry.uuid)
            .correlate(AccountingEntry)
            .scalar_subquery()
        )
        if amount_min is not None:
            stmt = stmt.where(amount_expr >= amount_min)
        if amount_max is not None:
            stmt = stmt.where(amount_expr <= amount_max)

    if search:
        term = f"%{search.strip()}%"
        if term != "%%":
            stmt = stmt.where(
                AccountingEntry.description.ilike(term)
                | AccountingEntry.reference.ilike(term)
                | AccountingEntry.sequence_number.ilike(term)
            )

    return stmt


async def list_accounting_entry_templates(
    db: AsyncSession,
    *,
    journal_uuid: UUID | None = None,
    is_active: bool | None = None,
) -> list[AccountingEntryTemplate]:
    """List reusable accounting entry models."""
    stmt = (
        select(AccountingEntryTemplate)
        .options(
            joinedload(AccountingEntryTemplate.journal),
            joinedload(AccountingEntryTemplate.lines),
        )
        .order_by(AccountingEntryTemplate.name.asc())
    )
    if journal_uuid is not None:
        stmt = stmt.where(AccountingEntryTemplate.journal_uuid == journal_uuid)
    if is_active is not None:
        stmt = stmt.where(AccountingEntryTemplate.is_active == is_active)

    result = await db.scalars(stmt)
    return result.unique().all()


async def get_accounting_entry_template(db: AsyncSession, template_uuid: UUID) -> AccountingEntryTemplate:
    """Fetch an entry model by UUID."""
    stmt = (
        select(AccountingEntryTemplate)
        .where(AccountingEntryTemplate.uuid == template_uuid)
        .options(
            joinedload(AccountingEntryTemplate.journal),
            joinedload(AccountingEntryTemplate.lines),
        )
    )
    template = await db.scalar(stmt)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entry model {template_uuid} not found",
        )
    return template


async def create_accounting_entry_template(
    db: AsyncSession,
    request: AccountingEntryTemplateCreateRequest,
    user_id: int,
) -> AccountingEntryTemplate:
    """Create a reusable recurring entry model."""
    await get_journal(db, request.journal_uuid)
    for line_req in request.lines:
        await get_account(db, line_req.account_uuid)
    await validate_entry_balance(request.lines)

    existing = await db.scalar(select(AccountingEntryTemplate).where(AccountingEntryTemplate.code == request.code.strip()))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Entry model code {request.code!r} already exists")

    template = AccountingEntryTemplate(
        code=request.code.strip(),
        name=request.name.strip(),
        journal_uuid=request.journal_uuid,
        description=request.description,
        default_reference=request.default_reference,
        recurrence_type=request.recurrence_type,
        is_active=request.is_active,
        valid_from=request.valid_from,
        valid_until=request.valid_until,
        created_by=user_id,
    )
    for index, line_req in enumerate(request.lines, start=1):
        template.lines.append(
            AccountingEntryTemplateLine(
                account_uuid=line_req.account_uuid,
                sort_order=index,
                member_uuid=line_req.member_uuid,
                analytical_asset_uuid=line_req.analytical_asset_uuid,
                debit=line_req.debit,
                credit=line_req.credit,
                description=line_req.description,
                formula_type=line_req.formula_type,
                formula_params=line_req.formula_params,
            )
        )

    db.add(template)
    await db.commit()
    await db.refresh(template, ["journal", "lines"])
    return template


async def update_accounting_entry_template(
    db: AsyncSession,
    template_uuid: UUID,
    request: AccountingEntryTemplateUpdateRequest,
) -> AccountingEntryTemplate:
    """Update a reusable recurring entry model."""
    template = await get_accounting_entry_template(db, template_uuid)

    if request.code is not None:
        normalized_code = request.code.strip()
        existing = await db.scalar(
            select(AccountingEntryTemplate).where(
                and_(AccountingEntryTemplate.code == normalized_code, AccountingEntryTemplate.uuid != template_uuid)
            )
        )
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Entry model code {normalized_code!r} already exists")
        template.code = normalized_code
    if request.name is not None:
        template.name = request.name.strip()
    if request.journal_uuid is not None:
        await get_journal(db, request.journal_uuid)
        template.journal_uuid = request.journal_uuid
    if request.description is not None:
        template.description = request.description
    if request.default_reference is not None:
        template.default_reference = request.default_reference
    if request.recurrence_type is not None:
        template.recurrence_type = request.recurrence_type
    if request.is_active is not None:
        template.is_active = request.is_active
    if request.valid_from is not None:
        template.valid_from = request.valid_from
    if request.valid_until is not None:
        template.valid_until = request.valid_until
    if request.lines is not None:
        for line_req in request.lines:
            await get_account(db, line_req.account_uuid)
        await validate_entry_balance(request.lines)
        template.lines.clear()
        for index, line_req in enumerate(request.lines, start=1):
            template.lines.append(
                AccountingEntryTemplateLine(
                    account_uuid=line_req.account_uuid,
                    sort_order=index,
                    member_uuid=line_req.member_uuid,
                    analytical_asset_uuid=line_req.analytical_asset_uuid,
                    debit=line_req.debit,
                    credit=line_req.credit,
                    description=line_req.description,
                    formula_type=line_req.formula_type,
                    formula_params=line_req.formula_params,
                )
            )

    await db.commit()
    await db.refresh(template, ["journal", "lines"])
    return template


async def delete_accounting_entry_template(db: AsyncSession, template_uuid: UUID) -> None:
    """Delete a reusable recurring entry model."""
    template = await get_accounting_entry_template(db, template_uuid)
    await db.delete(template)
    await db.commit()




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

    # Batch-fetch asset codes/names for lines with analytical_asset_uuid
    asset_uuids = {line.analytical_asset_uuid for line in entry.lines if line.analytical_asset_uuid}
    if asset_uuids:
        from models import Asset
        asset_result = await db.execute(
            select(Asset.uuid, Asset.code, Asset.name).where(Asset.uuid.in_(list(asset_uuids)))
        )
        asset_map = {row.uuid: (row.code, row.name) for row in asset_result.all()}
        for line in entry.lines:
            if line.analytical_asset_uuid and line.analytical_asset_uuid in asset_map:
                line.analytical_asset_code, line.analytical_asset_name = asset_map[line.analytical_asset_uuid]

    return entry


async def delete_accounting_entry(
    db: AsyncSession,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
) -> None:
    """Delete a Draft accounting entry and all its lines.

    Note: validated_flights referencing this entry are auto-unlinked by
    database trigger trg_unlink_flights_on_entry_delete on accounting_entries.
    """
    entry = await get_accounting_entry(db, entry_uuid, fiscal_year_uuid)
    if entry.state != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete entry in state {entry.state} (Draft only)",
        )

    # Clean up member_pack_consumptions rows that reference this entry
    # (safety net in case DB trigger hasn't been updated yet).
    from models import MemberPackConsumption
    existing_consumptions = await db.execute(
        select(MemberPackConsumption).where(
            MemberPackConsumption.accounting_entry_uuid == entry_uuid
        )
    )
    for consumption in existing_consumptions.scalars().all():
        await db.delete(consumption)

    await db.delete(entry)
    await db.commit()


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


async def post_accounting_entries_batch(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    entry_uuids: list[UUID],
) -> list[AccountingEntry]:
    """Post multiple Draft entries sequentially using the same single-entry rules."""
    posted_entries: list[AccountingEntry] = []

    for entry_uuid in dict.fromkeys(entry_uuids):
        posted_entries.append(
            await post_accounting_entry(
                db=db,
                entry_uuid=entry_uuid,
                fiscal_year_uuid=fiscal_year_uuid,
            )
        )

    return posted_entries


async def list_fiscal_years(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[AccountingFiscalYear]:
    """List all fiscal years."""
    stmt = select(AccountingFiscalYear).offset(skip).limit(limit).order_by(AccountingFiscalYear.year.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_active_fiscal_year(db: AsyncSession) -> AccountingFiscalYear:
    """Return the currently open fiscal year, or the most recent one if none is open."""
    # First: try state=Open (1) or state=Reopened (3)
    stmt_open = (
        select(AccountingFiscalYear)
        .where(AccountingFiscalYear.state.in_([1, 3]))
        .order_by(AccountingFiscalYear.year.desc())
        .limit(1)
    )
    result = await db.execute(stmt_open)
    fy = result.scalar_one_or_none()
    if fy is not None:
        return fy

    # Fallback: most recent closed fiscal year
    stmt_latest = (
        select(AccountingFiscalYear)
        .order_by(AccountingFiscalYear.end_date.desc())
        .limit(1)
    )
    result = await db.execute(stmt_latest)
    fy = result.scalar_one_or_none()
    if fy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No fiscal year found. Create one first.",
        )
    return fy


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


async def get_account_balances(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
    posted_only: bool = True,
) -> list[dict]:
    """Return aggregated debit/credit/balance per account for a fiscal year.

    Only posted entries (state=2) are included when ``posted_only`` is True.
    Accounts with no lines are omitted from the result.
    """
    from decimal import Decimal as D
    from sqlalchemy import func as sa_func

    state_filter = [AccountingEntry.fiscal_year_uuid == fiscal_year_uuid]
    if posted_only:
        state_filter.append(AccountingEntry.state == 2)

    stmt = (
        select(
            AccountingAccount.uuid,
            AccountingAccount.code,
            AccountingAccount.name,
            AccountingAccount.type,
            AccountingAccount.normal_balance,
            AccountingAccount.parent_account_uuid,
            sa_func.coalesce(sa_func.sum(AccountingLine.debit), D("0")).label("total_debit"),
            sa_func.coalesce(sa_func.sum(AccountingLine.credit), D("0")).label("total_credit"),
        )
        .join(AccountingLine, AccountingLine.account_uuid == AccountingAccount.uuid)
        .join(AccountingEntry, AccountingEntry.uuid == AccountingLine.entry_uuid)
        .where(and_(*state_filter))
        .group_by(
            AccountingAccount.uuid,
            AccountingAccount.code,
            AccountingAccount.name,
            AccountingAccount.type,
            AccountingAccount.normal_balance,
            AccountingAccount.parent_account_uuid,
        )
        .order_by(AccountingAccount.code)
    )
    rows = (await db.execute(stmt)).all()
    result = []
    for row in rows:
        debit = row.total_debit or D("0")
        credit = row.total_credit or D("0")
        result.append({
            "account_uuid": row.uuid,
            "code": row.code,
            "name": row.name,
            "type": row.type,
            "normal_balance": row.normal_balance,
            "parent_account_uuid": row.parent_account_uuid,
            "total_debit": debit,
            "total_credit": credit,
            "balance": debit - credit,
        })
    return result


async def list_journals(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[AccountingJournal]:
    """List all journals."""
    stmt = select(AccountingJournal).offset(skip).limit(limit).order_by(AccountingJournal.code)
    result = await db.execute(stmt)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Legacy CSV Import helpers
# ---------------------------------------------------------------------------

_IMPORT_SOURCE_SYSTEM = "legacy-accounting-csv"
_MEMBER_ACCOUNT_PREFIX = "411"
_IMPORT_ENTRY_REFERENCE_PATTERN = re.compile(r"N[°ºo]\s*([A-Za-z0-9-]+)", re.IGNORECASE)


def _parse_accounting_import_date(raw: str) -> date:
    """Accept dd/mm/YYYY or dd/mm/YY."""
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date format: {raw!r}")


def _make_entry_key(rows: list[dict]) -> str:
    """Deterministic SHA-256 key from the raw CSV rows of one balanced group."""
    # Include entry number when present to avoid hash collisions between entries
    # that share identical amounts/labels (e.g. two members with the same balance).
    def _entry_num(r: dict) -> str:
        for col in ("num_ecriture", "entry_number", "entry_num"):
            for k, v in r.items():
                if k.strip().lower() == col and v:
                    return v.strip()
        return ""

    payload = "\n".join(
        "|".join([
            _entry_num(r),
            r.get("date", ""),
            r.get("journal", ""),
            r.get("label", ""),
            r.get("account_code", ""),
            r.get("member_account_id", ""),
            r.get("debit", ""),
            r.get("credit", ""),
        ])
        for r in rows
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _parse_csv_rows(content: bytes) -> list[dict]:
    """Decode and parse the CSV bytes into a list of row dicts."""
    text = content.decode("utf-8-sig")  # strip BOM if present
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        rows.append({k.strip(): (v or "").strip() for k, v in row.items()})
    return rows


def _extract_accounting_import_reference(label: str | None) -> str | None:
    """Extract the trailing legacy entry reference (e.g. ``N°175``) from a CSV label."""
    if not label:
        return None
    matches = _IMPORT_ENTRY_REFERENCE_PATTERN.findall(label)
    if not matches:
        return None
    return matches[-1].upper()


def _group_into_entries(rows: list[dict]) -> list[list[dict]]:
    """Group CSV rows into logical legacy accounting entries.

    Legacy exports often encode an entry reference in labels (for example
    ``N°175``) and some lines of the same entry may be separated in the file.
    When such a reference exists, rows are grouped by ``(date, journal, ref)``
    regardless of adjacency. Rows without a detectable reference fall back to a
    balance-based grouping, but that fallback is constrained to a single date
    and journal so one incomplete entry cannot absorb later days.
    """

    # 1. If a column like 'num_ecriture' or 'entry_number' is present, group by it first
    entry_num_col = None
    for candidate in ("num_ecriture", "entry_number", "entry_num"):
        if any(candidate in k.lower() for k in rows[0].keys()):
            # Find the actual column name (case-insensitive)
            for k in rows[0].keys():
                if candidate in k.lower():
                    entry_num_col = k
                    break
            if entry_num_col:
                break

    if entry_num_col:
        # Group all rows by entry number value
        entry_groups: dict[str, list[tuple[int, dict]]] = {}
        for idx, row in enumerate(rows):
            entry_num = (row.get(entry_num_col, "") or "").strip()
            if not entry_num:
                # fallback: use row index as unique key
                entry_num = f"ROW_{idx}"
            entry_groups.setdefault(entry_num, []).append((idx, row))

        ordered_groups = [(group[0][0], [row for _, row in group]) for group in entry_groups.values()]
        ordered_groups.sort(key=lambda item: item[0])
        return [group for _, group in ordered_groups]

    # 2. Otherwise, use legacy reference in label (old behavior)
    referenced_groups: dict[tuple[str, str, str], list[tuple[int, dict]]] = {}
    fallback_rows: list[tuple[int, dict]] = []

    for idx, row in enumerate(rows):
        row_date = (row.get("date", "") or "").strip()
        row_journal = (row.get("journal", "") or "").strip()
        row_reference = _extract_accounting_import_reference(row.get("label"))

        if row_reference:
            key = (row_date, row_journal, row_reference)
            referenced_groups.setdefault(key, []).append((idx, row))
            continue

        fallback_rows.append((idx, row))

    ordered_groups: list[tuple[int, list[dict]]] = []

    for indexed_rows in referenced_groups.values():
        ordered_groups.append((indexed_rows[0][0], [row for _, row in indexed_rows]))

    current: list[tuple[int, dict]] = []
    debit_acc = Decimal("0")
    credit_acc = Decimal("0")
    current_journal = ""
    current_date = ""

    for idx, row in fallback_rows:
        row_journal = (row.get("journal", "") or "").strip()
        row_date = (row.get("date", "") or "").strip()
        if current and (row_journal != current_journal or row_date != current_date):
            ordered_groups.append((current[0][0], [group_row for _, group_row in current]))
            current = []
            debit_acc = Decimal("0")
            credit_acc = Decimal("0")

        try:
            d = Decimal(row.get("debit", "0") or "0")
            c = Decimal(row.get("credit", "0") or "0")
        except Exception:
            d, c = Decimal("0"), Decimal("0")

        current.append((idx, row))
        current_journal = row_journal
        current_date = row_date
        debit_acc += d
        credit_acc += c

        if debit_acc > 0 and debit_acc == credit_acc:
            ordered_groups.append((current[0][0], [group_row for _, group_row in current]))
            current = []
            debit_acc = Decimal("0")
            credit_acc = Decimal("0")
            current_journal = ""
            current_date = ""

    if current:
        ordered_groups.append((current[0][0], [group_row for _, group_row in current]))

    ordered_groups.sort(key=lambda item: item[0])
    return [group for _, group in ordered_groups]


def _resolve_group_journal_code(group: list[dict], fallback_journal_code: str | None) -> tuple[str | None, list[str]]:
    """Resolve the journal code for one grouped entry.

    CSV-provided journal codes take precedence. When absent, the caller-provided
    fallback journal code is used to preserve backward compatibility.
    """
    journal_codes = sorted(
        {
            code
            for code in ((row.get("journal", "") or "").strip() for row in group)
            if code
        }
    )

    if len(journal_codes) > 1:
        return None, [f"Entry spans multiple journals: {', '.join(journal_codes)}"]
    if journal_codes:
        return journal_codes[0], []
    if fallback_journal_code:
        return fallback_journal_code, []
    return None, ["Journal code is missing from CSV and no fallback journal was provided"]


async def preview_accounting_import(
    db: AsyncSession,
    *,
    content: bytes,
    fiscal_year_uuid: UUID,
    journal_uuid: UUID,
):
    """Parse a CSV file and return a structured preview without persisting anything."""
    from schemas.accounting import (
        AccountingImportPreviewLineResponse,
        AccountingImportPreviewEntryResponse,
        AccountingImportPreviewResponse,
    )

    fy = await validate_fiscal_year_open(db, fiscal_year_uuid)
    fallback_journal = await get_journal(db, journal_uuid)

    journal_result = await db.execute(select(AccountingJournal))
    journals_by_code: dict[str, AccountingJournal] = {
        journal.code: journal for journal in journal_result.scalars().all()
    }

    acct_result = await db.execute(select(AccountingAccount))
    accounts_by_code: dict[str, AccountingAccount] = {
        a.code: a for a in acct_result.scalars().all()
    }

    mem_result = await db.execute(select(Member))
    members_by_account_id: dict[str, Member] = {}
    members_by_legacy_id: dict[str, Member] = {}
    for m in mem_result.scalars().all():
        members_by_account_id[m.account_id] = m
        if m.legacy_account_id:
            members_by_legacy_id[m.legacy_account_id] = m

    existing_result = await db.execute(
        select(AccountingEntry.external_id).where(
            AccountingEntry.source_system == _IMPORT_SOURCE_SYSTEM,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
        )
    )
    already_imported_keys: set[str] = {row[0] for row in existing_result.all() if row[0]}

    rows = _parse_csv_rows(content)
    groups = _group_into_entries(rows)

    preview_entries: list[AccountingImportPreviewEntryResponse] = []
    row_cursor = 0

    for group in groups:
        row_start = row_cursor + 1
        row_end = row_cursor + len(group)
        row_cursor += len(group)

        entry_key = _make_entry_key(group)
        group_errors: list[str] = []
        already_imported = entry_key in already_imported_keys

        journal_code, journal_errors = _resolve_group_journal_code(group, fallback_journal.code)
        group_errors.extend(journal_errors)
        if journal_code and journal_code not in journals_by_code:
            group_errors.append(f"Journal code {journal_code!r} not found")

        description = next((r.get("label", "") for r in group if r.get("label")), "")

        entry_date: date | None = None
        raw_date = group[0].get("date", "")
        try:
            entry_date = _parse_accounting_import_date(raw_date)
        except ValueError:
            group_errors.append(f"Invalid date {raw_date!r} on row {row_start}")

        if entry_date is not None:
            if entry_date < fy.start_date or entry_date > fy.end_date:
                group_errors.append(
                    f"Entry date {entry_date} outside fiscal year [{fy.start_date}, {fy.end_date}]"
                )

        total_debit = Decimal("0")
        total_credit = Decimal("0")
        for r in group:
            try:
                total_debit += Decimal(r.get("debit", "0") or "0")
                total_credit += Decimal(r.get("credit", "0") or "0")
            except Exception:
                pass
        if total_debit != total_credit:
            group_errors.append(
                f"Entry not balanced: debit={total_debit} credit={total_credit}"
            )

        preview_lines: list[AccountingImportPreviewLineResponse] = []
        for r in group:
            code = r.get("account_code", "").strip()
            raw_mid = r.get("member_account_id", "").strip()
            line_errors: list[str] = []

            account = accounts_by_code.get(code)
            if not account:
                line_errors.append(f"Account code {code!r} not found")

            member: Member | None = None
            if code.startswith(_MEMBER_ACCOUNT_PREFIX) and raw_mid:
                member = members_by_account_id.get(raw_mid) or members_by_legacy_id.get(raw_mid)
                if not member:
                    line_errors.append(
                        f"Member {raw_mid!r} not found (checked account_id and legacy_account_id)"
                    )

            try:
                line_debit = Decimal(r.get("debit", "0") or "0")
                line_credit = Decimal(r.get("credit", "0") or "0")
            except Exception:
                line_debit = Decimal("0")
                line_credit = Decimal("0")
                line_errors.append("Invalid debit/credit value")

            preview_lines.append(
                AccountingImportPreviewLineResponse(
                    account_code=code,
                    account_uuid=account.uuid if account else None,
                    description=r.get("label") or None,
                    member_account_id=raw_mid or None,
                    member_uuid=member.uuid if member else None,
                    debit=line_debit,
                    credit=line_credit,
                    errors=line_errors,
                )
            )
            group_errors.extend(line_errors)

        importable = len(group_errors) == 0 and not already_imported

        preview_entries.append(
            AccountingImportPreviewEntryResponse(
                entry_key=entry_key,
                entry_date=entry_date or fy.start_date,
                description=description,
                row_start=row_start,
                row_end=row_end,
                total_debit=total_debit,
                total_credit=total_credit,
                importable=importable,
                already_imported=already_imported,
                errors=group_errors,
                lines=preview_lines,
            )
        )

    importable_count = sum(1 for e in preview_entries if e.importable)
    blocked_count = len(preview_entries) - importable_count

    return AccountingImportPreviewResponse(
        source_system=_IMPORT_SOURCE_SYSTEM,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
        entries=preview_entries,
        importable_count=importable_count,
        blocked_count=blocked_count,
    )


async def apply_accounting_import(
    db: AsyncSession,
    *,
    content: bytes,
    fiscal_year_uuid: UUID,
    journal_uuid: UUID,
    selected_keys: list[str],
    user_id: int,
):
    """Import selected preview entries from a CSV file as Draft accounting entries."""
    from schemas.accounting import AccountingImportApplyResponse

    import_batch_id = f"csv-import-{uuid4().hex[:12]}"

    fy = await validate_fiscal_year_open(db, fiscal_year_uuid)
    fallback_journal = await get_journal(db, journal_uuid)

    journal_result = await db.execute(select(AccountingJournal))
    journals_by_code: dict[str, AccountingJournal] = {
        journal.code: journal for journal in journal_result.scalars().all()
    }

    acct_result = await db.execute(select(AccountingAccount))
    accounts_by_code: dict[str, AccountingAccount] = {
        a.code: a for a in acct_result.scalars().all()
    }

    mem_result = await db.execute(select(Member))
    members_by_account_id: dict[str, Member] = {}
    members_by_legacy_id: dict[str, Member] = {}
    for m in mem_result.scalars().all():
        members_by_account_id[m.account_id] = m
        if m.legacy_account_id:
            members_by_legacy_id[m.legacy_account_id] = m

    existing_result = await db.execute(
        select(AccountingEntry.external_id).where(
            AccountingEntry.source_system == _IMPORT_SOURCE_SYSTEM,
            AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
        )
    )
    already_imported_keys: set[str] = {row[0] for row in existing_result.all() if row[0]}

    selected_set = set(selected_keys)
    rows = _parse_csv_rows(content)
    groups = _group_into_entries(rows)

    created_uuids: list[UUID] = []
    skipped = 0

    for group in groups:
        entry_key = _make_entry_key(group)
        if entry_key not in selected_set or entry_key in already_imported_keys:
            skipped += 1
            continue

        journal_code, journal_errors = _resolve_group_journal_code(group, fallback_journal.code)
        resolved_journal = journals_by_code.get(journal_code) if journal_code else None
        if journal_errors or resolved_journal is None:
            skipped += 1
            continue

        raw_date = group[0].get("date", "")
        entry_date = _parse_accounting_import_date(raw_date)
        description = next((r.get("label", "") for r in group if r.get("label")), "")

        entry_uuid = uuid4()
        entry = AccountingEntry(
            uuid=entry_uuid,
            fiscal_year_uuid=fiscal_year_uuid,
            journal_uuid=resolved_journal.uuid,
            entry_date=entry_date,
            description=description,
            state=1,  # Draft
            source_system=_IMPORT_SOURCE_SYSTEM,
            external_id=entry_key,
            import_batch_id=import_batch_id,
            created_by=user_id,
        )

        for r in group:
            code = r.get("account_code", "").strip()
            raw_mid = r.get("member_account_id", "").strip()
            account = accounts_by_code[code]

            member: Member | None = None
            if code.startswith(_MEMBER_ACCOUNT_PREFIX) and raw_mid:
                member = (
                    members_by_account_id.get(raw_mid)
                    or members_by_legacy_id.get(raw_mid)
                )

            line = AccountingLine(
                uuid=uuid4(),
                fiscal_year_uuid=fiscal_year_uuid,
                entry_uuid=entry_uuid,
                account_uuid=account.uuid,
                member_uuid=member.uuid if member else None,
                member_account_id_snapshot=raw_mid if member else None,
                debit=Decimal(r.get("debit", "0") or "0"),
                credit=Decimal(r.get("credit", "0") or "0"),
                description=r.get("label") or None,
            )
            entry.lines.append(line)

        db.add(entry)
        already_imported_keys.add(entry_key)
        created_uuids.append(entry_uuid)

    if created_uuids:
        await db.commit()

    _ = fy  # suppress unused-variable warning

    return AccountingImportApplyResponse(
        source_system=_IMPORT_SOURCE_SYSTEM,
        import_batch_id=import_batch_id,
        imported_count=len(created_uuids),
        skipped_count=skipped,
        created_entry_uuids=created_uuids,
    )
