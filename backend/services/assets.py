"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - assets: business logic for asset families, flight types, assets and status transitions
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
import logging
import csv
import io
from uuid import UUID
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import Asset, AssetPrivateOwner, AssetStatusHistory, AssetFamily, CostProvisionRule, FlightType, AccountingAccount, Member, PricingItem, PricingVersion
from schemas.assets import (
    AssetChildResponse,
    AssetCreateRequest,
    AssetOwnerResponse,
    AssetResponse,
    AssetStatusTransitionRequest,
    AssetUpdateRequest,
    AssetFamilyResponse,
    AssetFamilyCreateRequest,
    AssetFamilyUpdateRequest,
    FlightTypeCreateRequest,
    FlightTypeUpdateRequest,
    ImportResultResponse,
    ImportRowError,
    PricingItemCreateRequest,
    PricingItemUpdateRequest,
)

logger = logging.getLogger(__name__)


def _family_account_options():
    return (
        selectinload(AssetFamily.acquisition_account),
        selectinload(AssetFamily.depreciation_account),
        selectinload(AssetFamily.charge_account),
        selectinload(AssetFamily.revenue_account),
    )


def _asset_query():
    return select(Asset).options(
        selectinload(Asset.private_owner_links).selectinload(AssetPrivateOwner.member),
        selectinload(Asset.asset_family).selectinload(AssetFamily.pricing_versions),
        selectinload(Asset.asset_family).selectinload(AssetFamily.acquisition_account),
        selectinload(Asset.asset_family).selectinload(AssetFamily.depreciation_account),
        selectinload(Asset.asset_family).selectinload(AssetFamily.charge_account),
        selectinload(Asset.asset_family).selectinload(AssetFamily.revenue_account),
        selectinload(Asset.parent_asset),
    )


def _normalize_owner_member_uuids(owner_member_uuids: list[UUID] | None) -> list[UUID]:
    ordered: list[UUID] = []
    for member_uuid in owner_member_uuids or []:
        if member_uuid not in ordered:
            ordered.append(member_uuid)
    return ordered


async def _assert_owner_members_exist(db: AsyncSession, member_uuids: list[UUID]) -> None:
    if not member_uuids:
        return
    rows = await db.execute(select(Member.uuid).where(Member.uuid.in_(member_uuids)))
    found = set(rows.scalars().all())
    missing = [member_uuid for member_uuid in member_uuids if member_uuid not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Owner members not found: {', '.join(str(member_uuid) for member_uuid in missing)}",
        )


async def _resolve_owner_account_ids(db: AsyncSession, owner_account_ids: list[str]) -> list[UUID]:
    if not owner_account_ids:
        return []
    rows = await db.execute(
        select(Member.uuid, Member.account_id).where(Member.account_id.in_(owner_account_ids))
    )
    pairs = rows.all()
    uuid_by_account_id = {account_id: member_uuid for member_uuid, account_id in pairs}
    missing = [account_id for account_id in owner_account_ids if account_id not in uuid_by_account_id]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Owner member account ids not found: {', '.join(missing)}",
        )
    return [uuid_by_account_id[account_id] for account_id in owner_account_ids]


def _serialize_asset(asset: Asset) -> AssetResponse:
    owner_members = [
        AssetOwnerResponse(
            uuid=link.member.uuid,
            account_id=link.member.account_id,
            first_name=link.member.first_name,
            last_name=link.member.last_name,
        )
        for link in sorted(
            asset.private_owner_links,
            key=lambda link: (link.member.last_name.lower(), link.member.first_name.lower()),
        )
        if link.member is not None
    ]
    owner_member_uuids = [owner.uuid for owner in owner_members]

    family = asset.asset_family
    asset_family = AssetFamilyResponse(
        uuid=family.uuid,
        code=family.code,
        name=family.name,
        pricing_strategy=family.pricing_strategy,
        is_active=family.is_active,
        is_priced=family.is_priced,
        acquisition_account_uuid=family.acquisition_account_uuid,
        acquisition_account_code=family.acquisition_account_code,
        depreciation_account_uuid=family.depreciation_account_uuid,
        depreciation_account_code=family.depreciation_account_code,
        charge_account_uuid=family.charge_account_uuid,
        charge_account_code=family.charge_account_code,
        revenue_account_uuid=family.revenue_account_uuid,
        revenue_account_code=family.revenue_account_code,
        updated_at=family.updated_at,
    )

    current_price_version = None
    current_price_version_name = None
    if asset.asset_family.pricing_versions:
        today = date.today()
        active_price_versions = [
            price_version
            for price_version in asset.asset_family.pricing_versions
            if price_version.status == 2
            and price_version.from_date <= today
            and (price_version.to_date is None or price_version.to_date >= today)
        ]
        selected_price_version = (
            max(active_price_versions, key=lambda pv: pv.from_date)
            if active_price_versions
            else max(asset.asset_family.pricing_versions, key=lambda pv: pv.created_at)
        )
        current_price_version = selected_price_version.uuid
        current_price_version_name = selected_price_version.name

    return AssetResponse(
        uuid=asset.uuid,
        asset_family_uuid=asset.asset_family_uuid,
        parent_asset_uuid=asset.parent_asset_uuid,
        parent_asset_code=asset.parent_asset.code if asset.parent_asset else None,
        parent_asset_name=asset.parent_asset.name if asset.parent_asset else None,
        code=asset.code,
        name=asset.name,
        registration=asset.registration,
        serial_number=asset.serial_number,
        manufacturer=asset.manufacturer,
        model=asset.model,
        year_of_manufacture=asset.year_of_manufacture,
        ownership=asset.ownership,
        owner_member_uuids=owner_member_uuids,
        owner_members=owner_members,
        status=asset.status,
        is_bookable=asset.is_bookable,
        purchase_date=asset.purchase_date,
        purchase_price=asset.purchase_price,
        depreciation_start_date=asset.depreciation_start_date,
        depreciation_years=asset.depreciation_years,
        residual_value=asset.residual_value,
        useful_life_years=asset.useful_life_years,
        notes=asset.notes,
        is_active=asset.is_active,
        osrt_sync_enabled=asset.osrt_sync_enabled,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        asset_family=asset_family,
        current_price_version=current_price_version,
        current_price_version_name=current_price_version_name,
    )


async def _sync_asset_private_owners(
    db: AsyncSession,
    asset: Asset,
    owner_member_uuids: list[UUID],
    *,
    user_id: int,
) -> None:
    await db.execute(
        AssetPrivateOwner.__table__.delete().where(AssetPrivateOwner.asset_uuid == asset.uuid)
    )
    for member_uuid in owner_member_uuids:
        db.add(
            AssetPrivateOwner(
                asset_uuid=asset.uuid,
                member_uuid=member_uuid,
                assigned_by=user_id,
            )
        )

# ---------------------------------------------------------------------------
# Allowed status transitions:
# 1=Operational → 2=UnderMaintenance, 3=OutOfService, 4=Disposed, 5=Sold
# 2=UnderMaintenance → 1=Operational, 3=OutOfService, 4=Disposed, 5=Sold
# 3=OutOfService → 1=Operational, 4=Disposed, 5=Sold
# 4=Disposed → (terminal – no transition allowed)
# 5=Sold → (terminal – no transition allowed)
# ---------------------------------------------------------------------------
_ALLOWED_TRANSITIONS: dict[int, set[int]] = {
    1: {2, 3, 4, 5},
    2: {1, 3, 4, 5},
    3: {1, 4, 5},
    4: set(),
    5: set(),
}

ASSET_STATUS_LABELS = {
    1: "Operational",
    2: "UnderMaintenance",
    3: "OutOfService",
    4: "Disposed",
    5: "Sold",
}


# ---------------------------------------------------------------------------
# Asset Families
# ---------------------------------------------------------------------------

async def _assert_accounting_account_exists(db: AsyncSession, account_uuid: UUID) -> str:
    """Return account code snapshot or raise 422 if not found. (Also used by asset validation below.)"""
    result = await db.execute(
        select(AccountingAccount.code).where(AccountingAccount.uuid == account_uuid)
    )
    code = result.scalar_one_or_none()
    if code is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Accounting account {account_uuid} not found.",
        )
    return code


async def _assert_family_gl_accounts_exist(db: AsyncSession, data: dict) -> None:
    for field in ("acquisition_account_uuid", "depreciation_account_uuid", "charge_account_uuid", "revenue_account_uuid"):
        value = data.get(field)
        if value is not None:
            await _assert_accounting_account_exists(db, value)


async def list_asset_families(db: AsyncSession, *, active_only: bool = False) -> list[AssetFamily]:
    stmt = select(AssetFamily).options(*_family_account_options()).order_by(AssetFamily.code)
    if active_only:
        stmt = stmt.where(AssetFamily.is_active.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_asset_family(db: AsyncSession, asset_family_uuid: UUID) -> AssetFamily:
    result = await db.execute(
        select(AssetFamily)
        .options(*_family_account_options())
        .where(AssetFamily.uuid == asset_family_uuid)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset family not found.")
    return obj


async def create_asset_family(db: AsyncSession, request: AssetFamilyCreateRequest) -> AssetFamily:
    existing = await db.execute(select(AssetFamily).where(AssetFamily.code == request.code))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Asset family code {request.code!r} already exists.")

    data = request.model_dump()
    await _assert_family_gl_accounts_exist(db, data)

    obj = AssetFamily(**data)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    logger.info("Created asset family code=%s uuid=%s", obj.code, obj.uuid)
    return await get_asset_family(db, obj.uuid)


async def update_asset_family(db: AsyncSession, asset_family_uuid: UUID, request: AssetFamilyUpdateRequest) -> AssetFamily:
    obj = await get_asset_family(db, asset_family_uuid)
    data = request.model_dump(exclude_none=True)
    await _assert_family_gl_accounts_exist(db, data)
    for field, value in data.items():
        setattr(obj, field, value)
    await db.commit()
    await db.refresh(obj)
    return await get_asset_family(db, asset_family_uuid)


async def delete_asset_family(db: AsyncSession, asset_family_uuid: UUID) -> None:
    obj = await get_asset_family(db, asset_family_uuid)

    asset_in_use = await db.execute(
        select(Asset.uuid).where(Asset.asset_family_uuid == asset_family_uuid).limit(1)
    )
    if asset_in_use.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a family that is still assigned to an asset.",
        )

    pricing_in_use = await db.execute(
        select(PricingVersion.uuid).where(PricingVersion.asset_family_uuid == asset_family_uuid).limit(1)
    )
    if pricing_in_use.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a family that still has pricing versions configured.",
        )

    cost_rule_in_use = await db.execute(
        select(CostProvisionRule.uuid).where(CostProvisionRule.asset_family_uuid == asset_family_uuid).limit(1)
    )
    if cost_rule_in_use.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a family that still has cost provisioning rules configured.",
        )

    await db.delete(obj)
    await db.commit()


# ---------------------------------------------------------------------------
# Flight Types
# ---------------------------------------------------------------------------

async def list_flight_types(db: AsyncSession, *, active_only: bool = False) -> list[FlightType]:
    stmt = select(FlightType).order_by(FlightType.code)
    if active_only:
        stmt = stmt.where(FlightType.is_active.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_flight_type(db: AsyncSession, flight_type_uuid: UUID) -> FlightType:
    result = await db.execute(select(FlightType).where(FlightType.uuid == flight_type_uuid))
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flight type not found.")
    return obj


async def create_flight_type(
    db: AsyncSession, request: FlightTypeCreateRequest
) -> FlightType:
    existing = await db.execute(
        select(FlightType).where(FlightType.code == request.code)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Flight type code {request.code!r} already exists.",
        )

    obj = FlightType(**request.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    logger.info("Created flight type code=%s uuid=%s", obj.code, obj.uuid)
    return obj


async def update_flight_type(db: AsyncSession, flight_type_uuid: UUID, request: FlightTypeUpdateRequest) -> FlightType:
    obj = await get_flight_type(db, flight_type_uuid)
    for field, value in request.model_dump(exclude_none=True).items():
        setattr(obj, field, value)
    await db.commit()
    await db.refresh(obj)
    return obj


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

async def _assert_owner_member_exists(db: AsyncSession, member_uuid: UUID) -> None:
    result = await db.execute(select(Member.uuid).where(Member.uuid == member_uuid))
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Owner member {member_uuid} not found.",
        )


async def list_assets(
    db: AsyncSession,
    *,
    asset_family_uuid: UUID | None = None,
    parent_asset_uuid: UUID | None = None,
    is_bookable: bool | None = None,
    status: int | None = None,
    ownership: int | None = None,
    active_only: bool = False,
) -> list[AssetResponse]:
    stmt = _asset_query().order_by(Asset.code)
    if asset_family_uuid is not None:
        stmt = stmt.where(Asset.asset_family_uuid == asset_family_uuid)
    if parent_asset_uuid is not None:
        stmt = stmt.where(Asset.parent_asset_uuid == parent_asset_uuid)
    if is_bookable is not None:
        stmt = stmt.where(Asset.is_bookable == is_bookable)
    if status is not None:
        stmt = stmt.where(Asset.status == status)
    if ownership is not None:
        stmt = stmt.where(Asset.ownership == ownership)
    if active_only:
        stmt = stmt.where(Asset.is_active.is_(True))
    result = await db.execute(stmt)
    return [_serialize_asset(asset) for asset in result.scalars().all()]


async def _get_asset_model(db: AsyncSession, asset_uuid: UUID) -> Asset:
    result = await db.execute(_asset_query().where(Asset.uuid == asset_uuid))
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return obj


async def get_asset(db: AsyncSession, asset_uuid: UUID) -> AssetResponse:
    obj = await _get_asset_model(db, asset_uuid)
    return _serialize_asset(obj)


async def list_child_assets(db: AsyncSession, parent_asset_uuid: UUID) -> list[AssetChildResponse]:
    result = await db.execute(
        select(Asset).where(Asset.parent_asset_uuid == parent_asset_uuid).order_by(Asset.code)
    )
    return [AssetChildResponse.model_validate(child) for child in result.scalars().all()]


async def _validate_parent_asset_uuid(db: AsyncSession, parent_asset_uuid: UUID, *, self_uuid: UUID | None = None) -> None:
    """Enforce a strict 2-level asset hierarchy: no self-reference, no grandchildren."""
    if self_uuid is not None and parent_asset_uuid == self_uuid:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An asset cannot be its own parent.")

    parent_result = await db.execute(select(Asset.parent_asset_uuid).where(Asset.uuid == parent_asset_uuid))
    parent_row = parent_result.first()
    if parent_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent asset not found.")
    if parent_row[0] is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot attach a child asset to an asset that is itself a child (maximum 2-level hierarchy).",
        )

    if self_uuid is not None:
        has_children = await db.execute(
            select(Asset.uuid).where(Asset.parent_asset_uuid == self_uuid).limit(1)
        )
        if has_children.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot make this asset a child: it already has child assets of its own.",
            )


async def create_asset(db: AsyncSession, request: AssetCreateRequest, user_id: int) -> AssetResponse:
    # Validate asset family exists
    await get_asset_family(db, request.asset_family_uuid)

    # Unique code check
    dup = await db.execute(select(Asset.uuid).where(Asset.code == request.code))
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Asset code {request.code!r} already exists.")

    # Unique registration check if provided
    if request.registration:
        dup_reg = await db.execute(select(Asset.uuid).where(Asset.registration == request.registration))
        if dup_reg.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Registration {request.registration!r} already used by another asset.",
            )

    # Parent asset validation (max 2-level hierarchy)
    if request.parent_asset_uuid is not None:
        await _validate_parent_asset_uuid(db, request.parent_asset_uuid)

    owner_member_uuids = _normalize_owner_member_uuids(request.owner_member_uuids)
    if request.ownership == 2:
        await _assert_owner_members_exist(db, owner_member_uuids)

    payload = request.model_dump(exclude={"owner_member_uuids"})
    obj = Asset(
        **payload,
        updated_by=user_id,
    )
    db.add(obj)

    # Materialize PK/default values (uuid/status) before creating dependent history row.
    await db.flush()

    # Record initial status in history
    history = AssetStatusHistory(
        asset_uuid=obj.uuid,
        status=obj.status or 1,
        reason="Initial creation",
        changed_by=user_id,
    )
    db.add(history)
    if request.ownership == 2 and owner_member_uuids:
        await _sync_asset_private_owners(db, obj, owner_member_uuids, user_id=user_id)

    await db.commit()
    obj = await _get_asset_model(db, obj.uuid)
    logger.info("Created asset code=%s uuid=%s user=%s", obj.code, obj.uuid, user_id)
    return _serialize_asset(obj)


async def update_asset(db: AsyncSession, asset_uuid: UUID, request: AssetUpdateRequest, user_id: int) -> AssetResponse:
    obj = await _get_asset_model(db, asset_uuid)

    data = request.model_dump(exclude_none=True)
    data.pop("clear_parent_asset", None)

    # Validate asset family when changed
    if "asset_family_uuid" in data and data["asset_family_uuid"] != obj.asset_family_uuid:
        await get_asset_family(db, data["asset_family_uuid"])

    # Parent asset validation (max 2-level hierarchy), including explicit detach
    if request.clear_parent_asset:
        data["parent_asset_uuid"] = None
    elif "parent_asset_uuid" in data and data["parent_asset_uuid"] != obj.parent_asset_uuid:
        await _validate_parent_asset_uuid(db, data["parent_asset_uuid"], self_uuid=asset_uuid)

    # Validate owner member if ownership being set to private
    new_ownership = data.get("ownership", obj.ownership)
    owner_member_uuids = _normalize_owner_member_uuids(data.get("owner_member_uuids"))
    if not owner_member_uuids and new_ownership == 2:
        owner_member_uuids = [link.member_uuid for link in obj.private_owner_links]
    if new_ownership == 2 and not owner_member_uuids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one owner member is required for private assets.",
        )
    if new_ownership == 2:
        await _assert_owner_members_exist(db, owner_member_uuids)

    # Unique registration check if changing registration
    if "registration" in data and data["registration"] != obj.registration:
        dup = await db.execute(
            select(Asset.uuid).where(Asset.registration == data["registration"], Asset.uuid != asset_uuid)
        )
        if dup.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Registration {data['registration']!r} already used by another asset.",
            )

    data.pop("owner_member_uuids", None)
    data["updated_by"] = user_id
    for field, value in data.items():
        setattr(obj, field, value)

    if new_ownership == 2:
        await _sync_asset_private_owners(db, obj, owner_member_uuids, user_id=user_id)
    else:
        await _sync_asset_private_owners(db, obj, [], user_id=user_id)

    await db.commit()
    obj = await _get_asset_model(db, asset_uuid)
    return _serialize_asset(obj)


async def transition_asset_status(
    db: AsyncSession,
    asset_uuid: UUID,
    request: AssetStatusTransitionRequest,
    user_id: int,
) -> Asset:
    obj = await _get_asset_model(db, asset_uuid)

    allowed = _ALLOWED_TRANSITIONS.get(obj.status, set())
    if request.status not in allowed:
        current_label = ASSET_STATUS_LABELS.get(obj.status, str(obj.status))
        target_label = ASSET_STATUS_LABELS.get(request.status, str(request.status))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot transition from {current_label!r} to {target_label!r}.",
        )

    obj.status = request.status
    obj.updated_by = user_id

    history = AssetStatusHistory(
        asset_uuid=asset_uuid,
        status=request.status,
        reason=request.reason,
        changed_by=user_id,
    )
    db.add(history)
    await db.commit()
    obj = await _get_asset_model(db, asset_uuid)
    logger.info("Asset %s status → %s by user %s", asset_uuid, request.status, user_id)
    return _serialize_asset(obj)


async def list_asset_status_history(db: AsyncSession, asset_uuid: UUID) -> list[AssetStatusHistory]:
    # Verify asset exists
    await _get_asset_model(db, asset_uuid)
    result = await db.execute(
        select(AssetStatusHistory)
        .where(AssetStatusHistory.asset_uuid == asset_uuid)
        .order_by(AssetStatusHistory.changed_at)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Pricing Items
# ---------------------------------------------------------------------------

async def _get_pricing_version_for_asset_family(
    db: AsyncSession,
    version_uuid: UUID,
    asset_family_uuid: UUID,
) -> PricingVersion:
    """Return version and validate it belongs to the given asset family."""
    result = await db.execute(select(PricingVersion).where(PricingVersion.uuid == version_uuid))
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pricing version not found.")
    if version.asset_family_uuid != asset_family_uuid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pricing version does not belong to the specified asset family.",
        )
    return version


async def list_pricing_items(
    db: AsyncSession,
    version_uuid: UUID,
) -> list[PricingItem]:
    result = await db.execute(
        select(PricingItem)
        .where(PricingItem.pricing_version_uuid == version_uuid)
        .order_by(PricingItem.name)
    )
    return list(result.scalars().all())


async def get_pricing_item(db: AsyncSession, item_uuid: UUID) -> PricingItem:
    result = await db.execute(select(PricingItem).where(PricingItem.uuid == item_uuid))
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pricing item not found.")
    return obj


async def create_pricing_item(
    db: AsyncSession,
    version_uuid: UUID,
    request: PricingItemCreateRequest,
) -> PricingItem:
    # Validate version exists and is not locked
    v_result = await db.execute(select(PricingVersion).where(PricingVersion.uuid == version_uuid))
    version = v_result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pricing version not found.")
    if version.is_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot add items to a locked pricing version.",
        )
    if version.status != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot add items unless pricing version is Draft.",
        )

    # Validate flight type if provided
    if request.flight_type_uuid is not None:
        ft_result = await db.execute(
            select(FlightType).where(FlightType.uuid == request.flight_type_uuid)
        )
        if ft_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Flight type {request.flight_type_uuid} not found.",
            )

    obj = PricingItem(pricing_version_uuid=version_uuid, **request.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    logger.info("Created pricing item uuid=%s version=%s", obj.uuid, version_uuid)
    return obj


async def update_pricing_item(
    db: AsyncSession,
    item_uuid: UUID,
    request: PricingItemUpdateRequest,
) -> PricingItem:
    obj = await get_pricing_item(db, item_uuid)

    # Check version lock
    v_result = await db.execute(select(PricingVersion).where(PricingVersion.uuid == obj.pricing_version_uuid))
    version = v_result.scalar_one_or_none()
    if version and version.is_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot modify items in a locked pricing version.",
        )
    if version and version.status != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot modify items unless pricing version is Draft.",
        )

    # Validate flight type if being changed
    data = request.model_dump(exclude_unset=True)
    if "flight_type_uuid" in data and data["flight_type_uuid"] is not None:
        ft_result = await db.execute(
            select(FlightType).where(FlightType.uuid == data["flight_type_uuid"])
        )
        if ft_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Flight type {data['flight_type_uuid']} not found.",
            )

    for field, value in data.items():
        setattr(obj, field, value)
    await db.commit()
    await db.refresh(obj)
    return obj


async def delete_pricing_item(db: AsyncSession, item_uuid: UUID) -> None:
    obj = await get_pricing_item(db, item_uuid)

    # Check version lock
    v_result = await db.execute(select(PricingVersion).where(PricingVersion.uuid == obj.pricing_version_uuid))
    version = v_result.scalar_one_or_none()
    if version and version.is_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete items from a locked pricing version.",
        )
    if version and version.status != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete items unless pricing version is Draft.",
        )

    await db.delete(obj)
    await db.commit()


# ---------------------------------------------------------------------------
# Pricing Lookup
# ---------------------------------------------------------------------------

async def lookup_pricing(
    db: AsyncSession,
    asset_uuid: UUID,
    lookup_date: "date",
    flight_type_uuid: UUID | None = None,
) -> tuple[PricingVersion, PricingItem]:
    asset = await get_asset(db, asset_uuid)

    # Active versions for this asset family on the given date
    stmt = (
        select(PricingVersion)
        .where(
            PricingVersion.asset_family_uuid == asset.asset_family_uuid,
            PricingVersion.status == 2,  # Active
            PricingVersion.from_date <= lookup_date,
            or_(PricingVersion.to_date.is_(None), PricingVersion.to_date >= lookup_date),
        )
        .order_by(PricingVersion.from_date.desc())
    )
    v_result = await db.execute(stmt)
    versions = v_result.scalars().all()

    if not versions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active pricing version found for asset {asset_uuid} on {lookup_date}.",
        )

    for version in versions:
        # Try exact flight-type match first
        if flight_type_uuid is not None:
            items_stmt = select(PricingItem).where(
                PricingItem.pricing_version_uuid == version.uuid,
                PricingItem.flight_type_uuid == flight_type_uuid,
            )
            item_result = await db.execute(items_stmt)
            item = item_result.scalars().first()
            if item:
                return version, item

        # Fall back to generic (NULL flight_type) item
        generic_stmt = select(PricingItem).where(
            PricingItem.pricing_version_uuid == version.uuid,
            PricingItem.flight_type_uuid.is_(None),
        )
        generic_result = await db.execute(generic_stmt)
        generic = generic_result.scalars().first()
        if generic:
            return version, generic

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"No pricing item found for asset {asset_uuid} on {lookup_date}.",
    )


# ---------------------------------------------------------------------------
# CSV bulk import
# ---------------------------------------------------------------------------

_ASSET_OWNERSHIP_MAP: dict[str, int] = {
    "1": 1, "club": 1,
    "2": 2, "private": 2, "privé": 2, "prive": 2,
}

_ASSET_STATUS_MAP: dict[str, int] = {
    "1": 1, "operational": 1, "opérationnel": 1,
    "2": 2, "maintenance": 2,
    "3": 3, "out_of_service": 3, "hors_service": 3,
    "4": 4, "disposed": 4, "réformé": 4, "reforme": 4,
    "5": 5, "sold": 5, "vendu": 5,
}

_ASSET_BOOKABLE_MAP: dict[str, bool] = {
    "1": True, "true": True, "yes": True, "oui": True,
    "0": False, "false": False, "no": False, "non": False,
}


async def import_assets_from_csv(
    db: AsyncSession,
    content: bytes,
    *,
    user_id: int,
) -> ImportResultResponse:
    """Parse a CSV file and bulk-create assets, collecting per-row errors.

    Asset families are resolved by their `code` column (case-insensitive). A row's optional
    `parent_asset_code` is resolved against assets that already exist in the database — parent
    assets must be imported (or created) before their children; a CSV cannot create a parent and
    its child in the same run.
    Rows with errors are skipped; valid rows are committed individually.
    """
    errors: list[ImportRowError] = []
    created = 0
    skipped = 0

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    required_columns = {"code", "name", "asset_family_code"}
    if reader.fieldnames:
        missing = required_columns - {c.strip().lower() for c in reader.fieldnames}
        if missing:
            return ImportResultResponse(
                created=0,
                skipped=0,
                errors=[ImportRowError(row=0, field=None, message=f"Missing required columns: {', '.join(sorted(missing))}")],
            )

    # Pre-fetch asset family map (code → uuid) once for the whole import
    af_rows = (await db.execute(select(AssetFamily.code, AssetFamily.uuid))).all()
    asset_family_map: dict[str, str] = {r[0].lower(): str(r[1]) for r in af_rows}

    # Pre-fetch existing asset code → uuid map, for resolving parent_asset_code. Parents must
    # already exist in the DB — this map is not refreshed mid-loop, so a CSV cannot create a
    # parent and its child in the same run.
    asset_rows = (await db.execute(select(Asset.code, Asset.uuid))).all()
    asset_code_map: dict[str, str] = {r[0].lower(): str(r[1]) for r in asset_rows}

    for row_index, raw in enumerate(reader, start=2):
        row = {k.strip().lower(): (v or "").strip() for k, v in raw.items()}

        code = row.get("code", "")
        name = row.get("name", "")
        raw_af_code = row.get("asset_family_code", "").lower()

        if not code:
            errors.append(ImportRowError(row=row_index, field="code", message="Required"))
            skipped += 1
            continue
        if not name:
            errors.append(ImportRowError(row=row_index, field="name", message="Required"))
            skipped += 1
            continue
        if raw_af_code not in asset_family_map:
            errors.append(ImportRowError(row=row_index, field="asset_family_code", message=f"Unknown asset family code {raw_af_code!r}"))
            skipped += 1
            continue

        from uuid import UUID as _UUID
        asset_family_uuid = _UUID(asset_family_map[raw_af_code])

        parent_asset_uuid = None
        raw_parent_code = row.get("parent_asset_code", "").lower()
        if raw_parent_code:
            if raw_parent_code not in asset_code_map:
                errors.append(
                    ImportRowError(
                        row=row_index,
                        field="parent_asset_code",
                        message=f"Unknown parent asset code {raw_parent_code!r} — parent assets must be imported before their children.",
                    )
                )
                skipped += 1
                continue
            parent_asset_uuid = _UUID(asset_code_map[raw_parent_code])

        raw_bookable = row.get("is_bookable", "")
        is_bookable = _ASSET_BOOKABLE_MAP.get(raw_bookable.lower(), True) if raw_bookable else True

        raw_ownership = row.get("ownership", "club").lower()
        ownership = _ASSET_OWNERSHIP_MAP.get(raw_ownership, 1)

        raw_status_val = row.get("status", "operational").lower()
        asset_status = _ASSET_STATUS_MAP.get(raw_status_val, 1)
        if asset_status is None:
            errors.append(ImportRowError(row=row_index, field="status", message=f"Unknown status {raw_status_val!r}"))
            skipped += 1
            continue

        raw_owner_account_ids = row.get("owner_account_ids", "") or row.get("owner_member_ids", "")
        owner_account_ids = [
            chunk.strip()
            for chunk in raw_owner_account_ids.replace("|", ",").replace(";", ",").split(",")
            if chunk.strip()
        ]
        if ownership == 2 and not owner_account_ids:
            errors.append(
                ImportRowError(
                    row=row_index,
                    field="owner_account_ids",
                    message="Required for private assets. Use one or more member account ids separated by commas.",
                )
            )
            skipped += 1
            continue

        try:
            owner_member_uuids = await _resolve_owner_account_ids(db, owner_account_ids)
        except HTTPException as exc:
            errors.append(ImportRowError(row=row_index, field="owner_account_ids", message=str(exc.detail)))
            skipped += 1
            continue

        year_of_manufacture = None
        raw_yom = row.get("year_of_manufacture", "")
        if raw_yom:
            try:
                year_of_manufacture = int(raw_yom)
                if not (1900 <= year_of_manufacture <= 2100):
                    raise ValueError
            except ValueError:
                errors.append(ImportRowError(row=row_index, field="year_of_manufacture", message="Must be a year between 1900 and 2100"))
                skipped += 1
                continue

        def _parse_date_cell(field_name: str) -> "date | None":
            raw = row.get(field_name, "")
            if not raw:
                return None
            try:
                return date.fromisoformat(raw)
            except ValueError:
                return None  # caller appends error

        purchase_date = None
        raw_pd = row.get("purchase_date", "")
        if raw_pd:
            try:
                purchase_date = date.fromisoformat(raw_pd)
            except ValueError:
                errors.append(ImportRowError(row=row_index, field="purchase_date", message=f"Invalid date {raw_pd!r}. Use YYYY-MM-DD."))
                skipped += 1
                continue

        depreciation_start_date = None
        raw_dsd = row.get("depreciation_start_date", "")
        if raw_dsd:
            try:
                depreciation_start_date = date.fromisoformat(raw_dsd)
            except ValueError:
                errors.append(ImportRowError(row=row_index, field="depreciation_start_date", message=f"Invalid date {raw_dsd!r}. Use YYYY-MM-DD."))
                skipped += 1
                continue

        def _parse_decimal_cell(field_name: str):
            from decimal import Decimal, InvalidOperation
            raw = row.get(field_name, "")
            if not raw:
                return None
            try:
                return Decimal(raw)
            except InvalidOperation:
                return "ERROR"

        purchase_price = _parse_decimal_cell("purchase_price")
        if purchase_price == "ERROR":
            errors.append(ImportRowError(row=row_index, field="purchase_price", message="Must be a decimal number"))
            skipped += 1
            continue

        residual_value = _parse_decimal_cell("residual_value")
        if residual_value == "ERROR":
            errors.append(ImportRowError(row=row_index, field="residual_value", message="Must be a decimal number"))
            skipped += 1
            continue

        def _parse_int_cell(field_name: str, ge: int, le: int):
            raw = row.get(field_name, "")
            if not raw:
                return None
            try:
                v = int(raw)
                if not (ge <= v <= le):
                    raise ValueError
                return v
            except ValueError:
                return "ERROR"

        dep_years = _parse_int_cell("depreciation_years", 1, 100)
        if dep_years == "ERROR":
            errors.append(ImportRowError(row=row_index, field="depreciation_years", message="Must be an integer between 1 and 100"))
            skipped += 1
            continue

        useful_life = _parse_int_cell("useful_life_years", 1, 100)
        if useful_life == "ERROR":
            errors.append(ImportRowError(row=row_index, field="useful_life_years", message="Must be an integer between 1 and 100"))
            skipped += 1
            continue

        request = AssetCreateRequest(
            asset_family_uuid=asset_family_uuid,
            parent_asset_uuid=parent_asset_uuid,
            is_bookable=is_bookable,
            code=code,
            name=name,
            registration=row.get("registration", "") or None,
            serial_number=row.get("serial_number", "") or None,
            manufacturer=row.get("manufacturer", "") or None,
            model=row.get("model", "") or None,
            year_of_manufacture=year_of_manufacture,
            ownership=ownership,
            owner_member_uuids=owner_member_uuids,
            purchase_date=purchase_date,
            purchase_price=purchase_price,
            depreciation_start_date=depreciation_start_date,
            depreciation_years=dep_years,
            residual_value=residual_value,
            useful_life_years=useful_life,
            notes=row.get("notes", "") or None,
        )

        try:
            await create_asset(db=db, request=request, user_id=user_id)
            created += 1
        except HTTPException as exc:
            errors.append(ImportRowError(row=row_index, field=None, message=exc.detail))
            skipped += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("assets_csv_import row=%d error=%s", row_index, exc)
            errors.append(ImportRowError(row=row_index, field=None, message="Unexpected error — row skipped"))
            skipped += 1

    return ImportResultResponse(created=created, skipped=skipped, errors=errors)
