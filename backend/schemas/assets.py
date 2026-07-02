"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - assets: Pydantic schemas for asset families, flight types, assets and status transitions
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
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Asset Family
# ---------------------------------------------------------------------------

class AssetFamilyCreateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    # 1=FlightHours 2=EngineTime 3=PerFlight 4=PerDuration 5=PerUnit 6=FlatRate
    pricing_strategy: int = Field(ge=1, le=6, default=1)
    is_active: bool = True
    is_priced: bool = Field(default=True, description="Whether this family is expected to carry a flight tariff (pricing_versions).")
    acquisition_account_uuid: Optional[UUID] = None
    depreciation_account_uuid: Optional[UUID] = None
    charge_account_uuid: Optional[UUID] = None
    revenue_account_uuid: Optional[UUID] = None


class AssetFamilyUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    pricing_strategy: Optional[int] = Field(default=None, ge=1, le=6)
    is_active: Optional[bool] = None
    is_priced: Optional[bool] = None
    acquisition_account_uuid: Optional[UUID] = None
    depreciation_account_uuid: Optional[UUID] = None
    charge_account_uuid: Optional[UUID] = None
    revenue_account_uuid: Optional[UUID] = None


class AssetFamilyResponse(BaseModel):
    uuid: UUID
    code: str
    name: str
    pricing_strategy: int
    is_active: bool
    is_priced: bool
    acquisition_account_uuid: Optional[UUID] = None
    acquisition_account_code: Optional[str] = None
    depreciation_account_uuid: Optional[UUID] = None
    depreciation_account_code: Optional[str] = None
    charge_account_uuid: Optional[UUID] = None
    charge_account_code: Optional[str] = None
    revenue_account_uuid: Optional[UUID] = None
    revenue_account_code: Optional[str] = None
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Flight Type
# ---------------------------------------------------------------------------

class FlightTypeCreateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = True
    launch_type: Optional[int] = Field(default=None, ge=0, description="Planche launch_type mapping (0, 1, 2…). Winch=raw, tow=+10, plane=+20")


class FlightTypeUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None
    launch_type: Optional[int] = Field(default=None, ge=0)


class FlightTypeResponse(BaseModel):
    uuid: UUID
    code: str
    name: str
    description: Optional[str]
    is_active: bool
    launch_type: Optional[int] = None
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Asset
# ---------------------------------------------------------------------------

class AssetCreateRequest(BaseModel):
    asset_family_uuid: UUID
    parent_asset_uuid: Optional[UUID] = Field(default=None, description="Parent asset for a sub-component (trailer, refit, engine). Parent must itself be a top-level asset (max depth 2).")
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=150)
    registration: Optional[str] = Field(default=None, max_length=32)
    serial_number: Optional[str] = Field(default=None, max_length=100)
    manufacturer: Optional[str] = Field(default=None, max_length=100)
    model: Optional[str] = Field(default=None, max_length=100)
    year_of_manufacture: Optional[int] = Field(default=None, ge=1900, le=2100)
    # 1=Club, 2=Private
    ownership: int = Field(ge=1, le=2, default=1)
    owner_member_uuids: list[UUID] = Field(default_factory=list)
    is_bookable: bool = Field(default=True, description="Whether this asset can appear in flight selection and is pushed to Planche.")
    purchase_date: Optional[date] = None
    purchase_price: Optional[Decimal] = Field(default=None, ge=0)
    depreciation_start_date: Optional[date] = None
    depreciation_years: Optional[int] = Field(default=None, ge=1, le=100)
    residual_value: Optional[Decimal] = Field(default=None, ge=0)
    useful_life_years: Optional[int] = Field(default=None, ge=1, le=100)
    notes: Optional[str] = None
    osrt_sync_enabled: bool = False

    @model_validator(mode="after")
    def check_private_owner(self) -> "AssetCreateRequest":
        if self.ownership == 2 and not self.owner_member_uuids:
            raise ValueError("At least one owner member is required for private assets (ownership=2)")
        return self


class AssetUpdateRequest(BaseModel):
    asset_family_uuid: Optional[UUID] = None
    parent_asset_uuid: Optional[UUID] = None
    clear_parent_asset: bool = Field(default=False, description="Set to true to detach this asset from its parent (clears parent_asset_uuid); required since a bare null is dropped by the partial-update semantics below.")
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    registration: Optional[str] = Field(default=None, max_length=32)
    serial_number: Optional[str] = Field(default=None, max_length=100)
    manufacturer: Optional[str] = Field(default=None, max_length=100)
    model: Optional[str] = Field(default=None, max_length=100)
    year_of_manufacture: Optional[int] = Field(default=None, ge=1900, le=2100)
    ownership: Optional[int] = Field(default=None, ge=1, le=2)
    owner_member_uuids: Optional[list[UUID]] = None
    is_bookable: Optional[bool] = None
    purchase_date: Optional[date] = None
    purchase_price: Optional[Decimal] = Field(default=None, ge=0)
    depreciation_start_date: Optional[date] = None
    depreciation_years: Optional[int] = Field(default=None, ge=1, le=100)
    residual_value: Optional[Decimal] = Field(default=None, ge=0)
    useful_life_years: Optional[int] = Field(default=None, ge=1, le=100)
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    osrt_sync_enabled: Optional[bool] = None


class AssetStatusTransitionRequest(BaseModel):
    # 1=Operational, 2=UnderMaintenance, 3=OutOfService, 4=Disposed, 5=Sold
    status: int = Field(ge=1, le=5)
    reason: Optional[str] = Field(default=None, max_length=255)


class AssetStatusHistoryResponse(BaseModel):
    uuid: UUID
    status: int
    reason: Optional[str]
    changed_at: datetime
    changed_by: Optional[int]

    class Config:
        from_attributes = True


class AssetOwnerResponse(BaseModel):
    uuid: UUID
    account_id: str
    first_name: str
    last_name: str

    class Config:
        from_attributes = True


class AssetChildResponse(BaseModel):
    """Minimal shape for an asset's children, used by GET /assets/{uuid}/children."""

    uuid: UUID
    code: str
    name: str
    purchase_price: Optional[Decimal] = None
    status: int
    is_bookable: bool

    class Config:
        from_attributes = True


class AssetResponse(BaseModel):
    uuid: UUID
    asset_family_uuid: UUID
    parent_asset_uuid: Optional[UUID] = None
    parent_asset_code: Optional[str] = None
    parent_asset_name: Optional[str] = None
    code: str
    name: str
    registration: Optional[str]
    serial_number: Optional[str]
    manufacturer: Optional[str]
    model: Optional[str]
    year_of_manufacture: Optional[int]
    ownership: int
    owner_member_uuids: list[UUID] = Field(default_factory=list)
    owner_members: list[AssetOwnerResponse] = Field(default_factory=list)
    status: int
    is_bookable: bool
    purchase_date: Optional[date]
    purchase_price: Optional[Decimal]
    depreciation_start_date: Optional[date]
    depreciation_years: Optional[int]
    residual_value: Optional[Decimal]
    useful_life_years: Optional[int]
    notes: Optional[str]
    is_active: bool
    osrt_sync_enabled: bool
    created_at: datetime
    updated_at: datetime
    asset_family: Optional[AssetFamilyResponse] = None
    current_price_version: Optional[UUID] = None
    current_price_version_name: Optional[str] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Pricing Items
# ---------------------------------------------------------------------------


class PricingItemCreateRequest(BaseModel):
    # NULL = applies to all flight types within the version's asset type
    flight_type_uuid: Optional[UUID] = None
    name: str = Field(min_length=1, max_length=120)
    # 1=FlightTime(h), 2=EngineTimeMinute, 3=EngineTime1_100h, 4=FlightDuration, 5=PerFlight, 6=Fixed, 7=FixedDurationTranche
    unit: int = Field(ge=1, le=7)
    base_price: Decimal = Field(ge=0, decimal_places=2)
    # Threshold pricing: price per unit drops after threshold_unit_count units
    threshold_unit_count: Optional[int] = Field(default=None, ge=1)
    threshold_price: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    include_insurance: bool = False
    include_fuel: bool = False

    @model_validator(mode="after")
    def check_threshold_pair(self) -> "PricingItemCreateRequest":
        has_count = self.threshold_unit_count is not None
        has_price = self.threshold_price is not None
        if has_count != has_price:
            raise ValueError("threshold_unit_count and threshold_price must both be set or both be null.")
        return self


class PricingItemUpdateRequest(BaseModel):
    flight_type_uuid: Optional[UUID] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    unit: Optional[int] = Field(default=None, ge=1, le=6)
    base_price: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    threshold_unit_count: Optional[int] = Field(default=None, ge=1)
    threshold_price: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    include_insurance: Optional[bool] = None
    include_fuel: Optional[bool] = None


class PricingItemResponse(BaseModel):
    uuid: UUID
    pricing_version_uuid: UUID
    flight_type_uuid: Optional[UUID]
    name: str
    unit: int
    base_price: Decimal
    threshold_unit_count: Optional[int]
    threshold_price: Optional[Decimal]
    include_insurance: bool
    include_fuel: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Pricing Lookup
# ---------------------------------------------------------------------------


class PricingLookupRequest(BaseModel):
    asset_uuid: UUID
    lookup_date: date
    flight_type_uuid: Optional[UUID] = None


class PricingLookupResponse(BaseModel):
    pricing_version_uuid: UUID
    pricing_version_name: str
    item: PricingItemResponse


# ---------------------------------------------------------------------------
# CSV bulk import
# ---------------------------------------------------------------------------

class ImportRowError(BaseModel):
    """One validation or persistence error tied to a specific CSV row."""

    row: int
    field: Optional[str] = None
    message: str


class ImportResultResponse(BaseModel):
    """Summary returned after a CSV bulk import."""

    created: int
    skipped: int
    errors: list[ImportRowError]
