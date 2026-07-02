"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - assets: FastAPI routes for asset families, flight types, assets and status transitions
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
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_ASSETS, CAP_VIEW_FINANCIALS
from models import User
from schemas.assets import (
    AssetChildResponse,
    AssetCreateRequest,
    AssetFamilyCreateRequest,
    AssetFamilyResponse,
    AssetFamilyUpdateRequest,
    AssetResponse,
    AssetStatusHistoryResponse,
    AssetStatusTransitionRequest,
    AssetUpdateRequest,
    FlightTypeCreateRequest,
    FlightTypeResponse,
    FlightTypeUpdateRequest,
    ImportResultResponse,
    PricingItemCreateRequest,
    PricingItemResponse,
    PricingItemUpdateRequest,
    PricingLookupResponse,
)
from services.assets import (
    create_asset,
    create_asset_family,
    create_flight_type,
    create_pricing_item,
    delete_asset_family,
    delete_pricing_item,
    get_asset,
    get_asset_family,
    get_pricing_item,
    import_assets_from_csv,
    list_asset_families,
    list_asset_status_history,
    list_assets,
    list_child_assets,
    list_flight_types,
    list_pricing_items,
    lookup_pricing,
    transition_asset_status,
    update_asset,
    update_asset_family,
    update_flight_type,
    update_pricing_item,
)

router = APIRouter(prefix="/api/v1/assets", tags=["assets"])
logger = logging.getLogger(__name__)

# Capability guards
_manage_guard = Depends(require_capability(CAP_MANAGE_ASSETS))
_view_guard = Depends(require_capability(CAP_VIEW_FINANCIALS))


# ---------------------------------------------------------------------------
# Asset Families
# ---------------------------------------------------------------------------

@router.get("/families", response_model=list[AssetFamilyResponse])
async def list_asset_families_endpoint(
    active_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """List all asset families."""
    return await list_asset_families(db, active_only=active_only)


@router.post("/families", response_model=AssetFamilyResponse, status_code=201)
async def create_asset_family_endpoint(
    request: AssetFamilyCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    """Create a new asset family."""
    return await create_asset_family(db, request)


@router.get("/families/{family_uuid}", response_model=AssetFamilyResponse)
async def get_asset_family_endpoint(
    family_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """Get a single asset family."""
    return await get_asset_family(db, family_uuid)


@router.patch("/families/{family_uuid}", response_model=AssetFamilyResponse)
async def update_asset_family_endpoint(
    family_uuid: UUID,
    request: AssetFamilyUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    """Update an asset family."""
    return await update_asset_family(db, family_uuid, request)


@router.delete("/families/{family_uuid}", status_code=204)
async def delete_asset_family_endpoint(
    family_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    """Delete an asset family. Rejected if any asset, pricing version, or cost rule still references it."""
    await delete_asset_family(db, family_uuid)


# ---------------------------------------------------------------------------
# Flight Types (global)
# ---------------------------------------------------------------------------

@router.get("/flight-types", response_model=list[FlightTypeResponse])
async def list_flight_types_endpoint(
    active_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """List all global flight types."""
    return await list_flight_types(db, active_only=active_only)


@router.post("/flight-types", response_model=FlightTypeResponse, status_code=201)
async def create_flight_type_endpoint(
    request: FlightTypeCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    """Create a global flight type."""
    return await create_flight_type(db, request)


@router.patch("/flight-types/{flight_type_uuid}", response_model=FlightTypeResponse)
async def update_flight_type_endpoint(
    flight_type_uuid: UUID,
    request: FlightTypeUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    """Update a flight type."""
    return await update_flight_type(db, flight_type_uuid, request)


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

@router.get("", response_model=list[AssetResponse])
async def list_assets_endpoint(
    asset_family_uuid: Optional[UUID] = Query(default=None),
    parent_asset_uuid: Optional[UUID] = Query(default=None),
    is_bookable: Optional[bool] = Query(default=None),
    status: Optional[int] = Query(default=None, ge=1, le=5),
    ownership: Optional[int] = Query(default=None, ge=1, le=2),
    active_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """List assets with optional filters."""
    return await list_assets(
        db,
        asset_family_uuid=asset_family_uuid,
        parent_asset_uuid=parent_asset_uuid,
        is_bookable=is_bookable,
        status=status,
        ownership=ownership,
        active_only=active_only,
    )


@router.post("", response_model=AssetResponse, status_code=201)
async def create_asset_endpoint(
    request: AssetCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    """Create a new asset."""
    return await create_asset(db, request, user_id=current_user.id)


@router.get("/{asset_uuid}", response_model=AssetResponse)
async def get_asset_endpoint(
    asset_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """Get a single asset."""
    return await get_asset(db, asset_uuid)


@router.patch("/{asset_uuid}", response_model=AssetResponse)
async def update_asset_endpoint(
    asset_uuid: UUID,
    request: AssetUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    """Update asset master data."""
    return await update_asset(db, asset_uuid, request, user_id=current_user.id)


@router.post("/{asset_uuid}/status", response_model=AssetResponse)
async def transition_asset_status_endpoint(
    asset_uuid: UUID,
    request: AssetStatusTransitionRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    """Transition an asset to a new status."""
    return await transition_asset_status(db, asset_uuid, request, user_id=current_user.id)


@router.get("/{asset_uuid}/status-history", response_model=list[AssetStatusHistoryResponse])
async def list_asset_status_history_endpoint(
    asset_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """List the status change history for an asset."""
    return await list_asset_status_history(db, asset_uuid)


@router.get("/{asset_uuid}/children", response_model=list[AssetChildResponse])
async def list_asset_children_endpoint(
    asset_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """List the direct child assets (sub-components) of an asset."""
    return await list_child_assets(db, asset_uuid)


# ---------------------------------------------------------------------------
# Pricing Items (per pricing version)
# ---------------------------------------------------------------------------

@router.get("/pricing/versions/{version_uuid}/items", response_model=list[PricingItemResponse])
async def list_pricing_items_endpoint(
    version_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """List all pricing items for a given pricing version."""
    return await list_pricing_items(db, version_uuid)


@router.post("/pricing/versions/{version_uuid}/items", response_model=PricingItemResponse, status_code=201)
async def create_pricing_item_endpoint(
    version_uuid: UUID,
    request: PricingItemCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    """Add a pricing item to a pricing version."""
    return await create_pricing_item(db, version_uuid, request)


@router.get("/pricing/items/{item_uuid}", response_model=PricingItemResponse)
async def get_pricing_item_endpoint(
    item_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """Get a single pricing item."""
    return await get_pricing_item(db, item_uuid)


@router.patch("/pricing/items/{item_uuid}", response_model=PricingItemResponse)
async def update_pricing_item_endpoint(
    item_uuid: UUID,
    request: PricingItemUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    """Update a pricing item."""
    return await update_pricing_item(db, item_uuid, request)


@router.delete("/pricing/items/{item_uuid}", status_code=204)
async def delete_pricing_item_endpoint(
    item_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    """Delete a pricing item (only if version is not locked)."""
    await delete_pricing_item(db, item_uuid)


# ---------------------------------------------------------------------------
# Pricing Lookup
# ---------------------------------------------------------------------------

@router.get("/pricing/lookup", response_model=PricingLookupResponse)
async def lookup_pricing_endpoint(
    asset_uuid: UUID = Query(...),
    lookup_date: str = Query(..., description="ISO date YYYY-MM-DD"),
    flight_type_uuid: Optional[UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = _view_guard,
):
    """Find the active pricing item for an asset on a given date."""
    from datetime import date as date_type
    try:
        parsed_date = date_type.fromisoformat(lookup_date)
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="lookup_date must be in ISO format YYYY-MM-DD.")

    version, item = await lookup_pricing(db, asset_uuid, parsed_date, flight_type_uuid)
    return PricingLookupResponse(
        pricing_version_uuid=version.uuid,
        pricing_version_name=version.name,
        item=item,
    )


# ---------------------------------------------------------------------------
# CSV bulk import
# ---------------------------------------------------------------------------

@router.post("/import", response_model=ImportResultResponse)
async def import_assets_endpoint(
    file: UploadFile = File(..., description="UTF-8 (or latin-1) CSV file with asset data"),
    current_user: User = _manage_guard,
    db: AsyncSession = Depends(get_db),
):
    """Bulk-import assets from a CSV file.

    Asset families are resolved by their `asset_family_code` column value.
    Rows that pass validation are created immediately.
    Rows with errors are skipped and reported in the response.
    """
    content = await file.read()
    return await import_assets_from_csv(db=db, content=content, user_id=current_user.id)


# ---------------------------------------------------------------------------
# Assets with Asset Family and Current Pricing Version
# ---------------------------------------------------------------------------
# NOTE: pre-existing dead code — `date`, `Asset`, `AssetFamily`, `PricingVersion` are not
# imported in this module and `db` is an AsyncSession here, so `db.query(...)` raises at
# call time. Unreachable in practice; left as-is (renamed only for textual consistency),
# fixing it is out of scope for this change.

@router.get("/assets", response_model=list[AssetResponse])
def get_assets(db: AsyncSession = Depends(get_db)):
    today = date.today()
    assets = db.query(Asset).all()
    asset_responses = []

    for asset in assets:
        asset_family = db.query(AssetFamily).filter(AssetFamily.uuid == asset.asset_family_uuid).first()
        pricing_version = (
            db.query(PricingVersion)
            .filter(
                PricingVersion.asset_family_uuid == asset.asset_family_uuid,
                PricingVersion.from_date <= today,
                (PricingVersion.to_date == None) | (PricingVersion.to_date >= today),
                PricingVersion.status == 2  # Active
            )
            .first()
        )

        asset_responses.append(
            AssetResponse(
                uuid=asset.uuid,
                code=asset.code,
                name=asset.name,
                status=asset.status,
                asset_family=asset_family.name if asset_family else None,
                pricing_version=pricing_version.name if pricing_version else None
            )
        )

    return asset_responses
