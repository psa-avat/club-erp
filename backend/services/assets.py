"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - assets: business logic for asset types, flight types, assets and status transitions
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
from uuid import UUID
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from models import Asset, AssetStatusHistory, AssetType, FlightType, AccountingAccount, Member, PricingItem, PricingVersion
from schemas.assets import (
    AssetCreateRequest,
    AssetStatusTransitionRequest,
    AssetUpdateRequest,
    AssetTypeCreateRequest,
    AssetTypeUpdateRequest,
    FlightTypeCreateRequest,
    FlightTypeUpdateRequest,
    PricingItemCreateRequest,
    PricingItemUpdateRequest,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Allowed status transitions:
# 1=Operational → 2=UnderMaintenance, 3=OutOfService, 4=Disposed
# 2=UnderMaintenance → 1=Operational, 3=OutOfService, 4=Disposed
# 3=OutOfService → 1=Operational, 4=Disposed
# 4=Disposed → (terminal – no transition allowed)
# ---------------------------------------------------------------------------
_ALLOWED_TRANSITIONS: dict[int, set[int]] = {
    1: {2, 3, 4},
    2: {1, 3, 4},
    3: {1, 4},
    4: set(),
}

ASSET_STATUS_LABELS = {1: "Operational", 2: "UnderMaintenance", 3: "OutOfService", 4: "Disposed"}


# ---------------------------------------------------------------------------
# Asset Types
# ---------------------------------------------------------------------------

async def list_asset_types(db: AsyncSession, *, active_only: bool = False) -> list[AssetType]:
    stmt = select(AssetType).order_by(AssetType.code)
    if active_only:
        stmt = stmt.where(AssetType.is_active.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_asset_type(db: AsyncSession, asset_type_uuid: UUID) -> AssetType:
    result = await db.execute(select(AssetType).where(AssetType.uuid == asset_type_uuid))
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset type not found.")
    return obj


async def create_asset_type(db: AsyncSession, request: AssetTypeCreateRequest) -> AssetType:
    existing = await db.execute(select(AssetType).where(AssetType.code == request.code))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Asset type code {request.code!r} already exists.")

    obj = AssetType(**request.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    logger.info("Created asset type code=%s uuid=%s", obj.code, obj.uuid)
    return obj


async def update_asset_type(db: AsyncSession, asset_type_uuid: UUID, request: AssetTypeUpdateRequest) -> AssetType:
    obj = await get_asset_type(db, asset_type_uuid)
    for field, value in request.model_dump(exclude_none=True).items():
        setattr(obj, field, value)
    await db.commit()
    await db.refresh(obj)
    return obj


# ---------------------------------------------------------------------------
# Flight Types
# ---------------------------------------------------------------------------

async def list_flight_types(db: AsyncSession, asset_type_uuid: UUID, *, active_only: bool = False) -> list[FlightType]:
    stmt = select(FlightType).where(FlightType.asset_type_uuid == asset_type_uuid).order_by(FlightType.code)
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
    db: AsyncSession, asset_type_uuid: UUID, request: FlightTypeCreateRequest
) -> FlightType:
    # Verify parent asset type exists
    await get_asset_type(db, asset_type_uuid)

    existing = await db.execute(
        select(FlightType).where(
            FlightType.asset_type_uuid == asset_type_uuid,
            FlightType.code == request.code,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Flight type code {request.code!r} already exists for this asset type.",
        )

    obj = FlightType(asset_type_uuid=asset_type_uuid, **request.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    logger.info("Created flight type code=%s uuid=%s asset_type=%s", obj.code, obj.uuid, asset_type_uuid)
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

async def _assert_accounting_account_exists(db: AsyncSession, account_uuid: UUID) -> str:
    """Return account code snapshot or raise 422 if not found."""
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
    asset_type_uuid: UUID | None = None,
    status: int | None = None,
    ownership: int | None = None,
    active_only: bool = False,
) -> list[Asset]:
    stmt = select(Asset).order_by(Asset.code)
    if asset_type_uuid is not None:
        stmt = stmt.where(Asset.asset_type_uuid == asset_type_uuid)
    if status is not None:
        stmt = stmt.where(Asset.status == status)
    if ownership is not None:
        stmt = stmt.where(Asset.ownership == ownership)
    if active_only:
        stmt = stmt.where(Asset.is_active.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_asset(db: AsyncSession, asset_uuid: UUID) -> Asset:
    result = await db.execute(select(Asset).where(Asset.uuid == asset_uuid))
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return obj


async def create_asset(db: AsyncSession, request: AssetCreateRequest, user_id: int) -> Asset:
    # Validate asset type exists
    await get_asset_type(db, request.asset_type_uuid)

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

    # Validate owner member if private
    if request.ownership == 2 and request.owner_member_uuid:
        await _assert_owner_member_exists(db, request.owner_member_uuid)

    # Resolve accounting account snapshot
    account_snapshot: str | None = None
    if request.acquisition_account_uuid:
        account_snapshot = await _assert_accounting_account_exists(db, request.acquisition_account_uuid)

    payload = request.model_dump()
    obj = Asset(
        **payload,
        accounting_account_code_snapshot=account_snapshot,
        updated_by=user_id,
    )
    db.add(obj)

    # Record initial status in history
    history = AssetStatusHistory(
        asset_uuid=obj.uuid,
        status=obj.status,
        reason="Initial creation",
        changed_by=user_id,
    )
    db.add(history)

    await db.commit()
    await db.refresh(obj)
    logger.info("Created asset code=%s uuid=%s user=%s", obj.code, obj.uuid, user_id)
    return obj


async def update_asset(db: AsyncSession, asset_uuid: UUID, request: AssetUpdateRequest, user_id: int) -> Asset:
    obj = await get_asset(db, asset_uuid)

    data = request.model_dump(exclude_none=True)

    # Validate owner member if ownership being set to private
    new_ownership = data.get("ownership", obj.ownership)
    new_owner = data.get("owner_member_uuid", obj.owner_member_uuid)
    if new_ownership == 2 and new_owner is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="owner_member_uuid is required for private assets.",
        )
    if "owner_member_uuid" in data and data["owner_member_uuid"] is not None:
        await _assert_owner_member_exists(db, data["owner_member_uuid"])

    # Resolve accounting account snapshot if being updated
    if "acquisition_account_uuid" in data and data["acquisition_account_uuid"] is not None:
        data["accounting_account_code_snapshot"] = await _assert_accounting_account_exists(
            db, data["acquisition_account_uuid"]
        )

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

    data["updated_by"] = user_id
    for field, value in data.items():
        setattr(obj, field, value)

    await db.commit()
    await db.refresh(obj)
    return obj


async def transition_asset_status(
    db: AsyncSession,
    asset_uuid: UUID,
    request: AssetStatusTransitionRequest,
    user_id: int,
) -> Asset:
    obj = await get_asset(db, asset_uuid)

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
    await db.refresh(obj)
    logger.info("Asset %s status → %s by user %s", asset_uuid, request.status, user_id)
    return obj


async def list_asset_status_history(db: AsyncSession, asset_uuid: UUID) -> list[AssetStatusHistory]:
    # Verify asset exists
    await get_asset(db, asset_uuid)
    result = await db.execute(
        select(AssetStatusHistory)
        .where(AssetStatusHistory.asset_uuid == asset_uuid)
        .order_by(AssetStatusHistory.changed_at)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Pricing Items
# ---------------------------------------------------------------------------

async def _get_pricing_version_for_asset_type(
    db: AsyncSession,
    version_uuid: UUID,
    asset_type_uuid: UUID,
) -> PricingVersion:
    """Return version and validate it belongs to the given asset type."""
    result = await db.execute(select(PricingVersion).where(PricingVersion.uuid == version_uuid))
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pricing version not found.")
    if version.asset_type_uuid != asset_type_uuid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pricing version does not belong to the specified asset type.",
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

    # Active versions for this asset type on the given date
    stmt = (
        select(PricingVersion)
        .where(
            PricingVersion.asset_type_uuid == asset.asset_type_uuid,
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
