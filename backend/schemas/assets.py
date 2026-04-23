"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - assets: Pydantic schemas for asset types, flight types, assets and status transitions
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
# Asset Type
# ---------------------------------------------------------------------------

class AssetTypeCreateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    # 1=Aircraft 2=LaunchEquipment 3=Support 4=Consumable 5=Service
    category: int = Field(ge=1, le=5, default=1)
    # 1=FlightHours 2=EngineTime 3=PerFlight 4=PerDuration 5=PerUnit 6=FlatRate
    pricing_strategy: int = Field(ge=1, le=6, default=1)
    is_active: bool = True


class AssetTypeUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    category: Optional[int] = Field(default=None, ge=1, le=5)
    pricing_strategy: Optional[int] = Field(default=None, ge=1, le=6)
    is_active: Optional[bool] = None


class AssetTypeResponse(BaseModel):
    uuid: UUID
    code: str
    name: str
    category: int
    pricing_strategy: int
    is_active: bool
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


class FlightTypeUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None


class FlightTypeResponse(BaseModel):
    uuid: UUID
    asset_type_uuid: UUID
    code: str
    name: str
    description: Optional[str]
    is_active: bool
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Asset
# ---------------------------------------------------------------------------

class AssetCreateRequest(BaseModel):
    asset_type_uuid: UUID
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=150)
    registration: Optional[str] = Field(default=None, max_length=32)
    serial_number: Optional[str] = Field(default=None, max_length=100)
    manufacturer: Optional[str] = Field(default=None, max_length=100)
    model: Optional[str] = Field(default=None, max_length=100)
    year_of_manufacture: Optional[int] = Field(default=None, ge=1900, le=2100)
    # 1=Club, 2=Private
    ownership: int = Field(ge=1, le=2, default=1)
    owner_member_uuid: Optional[UUID] = None
    acquisition_account_uuid: Optional[UUID] = None
    purchase_date: Optional[date] = None
    purchase_price: Optional[Decimal] = Field(default=None, ge=0)
    depreciation_start_date: Optional[date] = None
    depreciation_years: Optional[int] = Field(default=None, ge=1, le=100)
    residual_value: Optional[Decimal] = Field(default=None, ge=0)
    useful_life_years: Optional[int] = Field(default=None, ge=1, le=100)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def check_private_owner(self) -> "AssetCreateRequest":
        if self.ownership == 2 and self.owner_member_uuid is None:
            raise ValueError("owner_member_uuid is required for private assets (ownership=2)")
        return self


class AssetUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    registration: Optional[str] = Field(default=None, max_length=32)
    serial_number: Optional[str] = Field(default=None, max_length=100)
    manufacturer: Optional[str] = Field(default=None, max_length=100)
    model: Optional[str] = Field(default=None, max_length=100)
    year_of_manufacture: Optional[int] = Field(default=None, ge=1900, le=2100)
    ownership: Optional[int] = Field(default=None, ge=1, le=2)
    owner_member_uuid: Optional[UUID] = None
    acquisition_account_uuid: Optional[UUID] = None
    purchase_date: Optional[date] = None
    purchase_price: Optional[Decimal] = Field(default=None, ge=0)
    depreciation_start_date: Optional[date] = None
    depreciation_years: Optional[int] = Field(default=None, ge=1, le=100)
    residual_value: Optional[Decimal] = Field(default=None, ge=0)
    useful_life_years: Optional[int] = Field(default=None, ge=1, le=100)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class AssetStatusTransitionRequest(BaseModel):
    # 1=Operational, 2=UnderMaintenance, 3=OutOfService, 4=Disposed
    status: int = Field(ge=1, le=4)
    reason: Optional[str] = Field(default=None, max_length=255)


class AssetStatusHistoryResponse(BaseModel):
    uuid: UUID
    status: int
    reason: Optional[str]
    changed_at: datetime
    changed_by: Optional[int]

    class Config:
        from_attributes = True


class AssetResponse(BaseModel):
    uuid: UUID
    asset_type_uuid: UUID
    code: str
    name: str
    registration: Optional[str]
    serial_number: Optional[str]
    manufacturer: Optional[str]
    model: Optional[str]
    year_of_manufacture: Optional[int]
    ownership: int
    owner_member_uuid: Optional[UUID]
    status: int
    acquisition_account_uuid: Optional[UUID]
    accounting_account_code_snapshot: Optional[str]
    purchase_date: Optional[date]
    purchase_price: Optional[Decimal]
    depreciation_start_date: Optional[date]
    depreciation_years: Optional[int]
    residual_value: Optional[Decimal]
    useful_life_years: Optional[int]
    notes: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Pricing Items
# ---------------------------------------------------------------------------


class PricingItemCreateRequest(BaseModel):
    # NULL = applies to all flight types within the version's asset type
    flight_type_uuid: Optional[UUID] = None
    name: str = Field(min_length=1, max_length=120)
    # 1=Hour, 2=Flight, 3=Minute, 4=Kilometer, 5=Unit
    unit: int = Field(ge=1, le=5)
    base_price: Decimal = Field(ge=0)
    # Threshold pricing: price per unit drops after threshold_unit_count units
    threshold_unit_count: Optional[int] = Field(default=None, ge=1)
    threshold_price: Optional[Decimal] = Field(default=None, ge=0)
    # Pack pricing: flat price for a bundle of pack_unit_count units
    pack_unit_count: Optional[int] = Field(default=None, ge=1)
    pack_price: Optional[Decimal] = Field(default=None, ge=0)
    include_insurance: bool = False
    include_fuel: bool = False

    @model_validator(mode="after")
    def check_threshold_pair(self) -> "PricingItemCreateRequest":
        has_count = self.threshold_unit_count is not None
        has_price = self.threshold_price is not None
        if has_count != has_price:
            raise ValueError("threshold_unit_count and threshold_price must both be set or both be null.")
        return self

    @model_validator(mode="after")
    def check_pack_pair(self) -> "PricingItemCreateRequest":
        has_count = self.pack_unit_count is not None
        has_price = self.pack_price is not None
        if has_count != has_price:
            raise ValueError("pack_unit_count and pack_price must both be set or both be null.")
        return self


class PricingItemUpdateRequest(BaseModel):
    flight_type_uuid: Optional[UUID] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    unit: Optional[int] = Field(default=None, ge=1, le=5)
    base_price: Optional[Decimal] = Field(default=None, ge=0)
    threshold_unit_count: Optional[int] = Field(default=None, ge=1)
    threshold_price: Optional[Decimal] = Field(default=None, ge=0)
    pack_unit_count: Optional[int] = Field(default=None, ge=1)
    pack_price: Optional[Decimal] = Field(default=None, ge=0)
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
    pack_unit_count: Optional[int]
    pack_price: Optional[Decimal]
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
