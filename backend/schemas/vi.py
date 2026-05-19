"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Schemas for VI type catalog, entitlements, and HelloAsso staging payloads
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

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


VI_SETTINGS_MODULE = "vi"


class ViTypeCatalogPayload(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool = True


class ViTypeCatalogResponse(BaseModel):
    uuid: UUID
    code: str
    name: str
    description: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    updated_by: int | None = None

    class Config:
        from_attributes = True


class ViEntitlementPayload(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    vi_type_uuid: UUID
    description: str | None = None
    validity_date: date | None = None
    scheduled_date: date | None = None
    realisation_date: date | None = None
    partner_code: str | None = Field(default=None, max_length=64)
    origin_type: int = Field(default=4, ge=1, le=5)
    origin_ref: str | None = Field(default=None, max_length=128)
    notes: str | None = None
    status: int = Field(default=1, ge=1, le=5)


class ViEntitlementResponse(BaseModel):
    uuid: UUID
    code: str
    vi_type_uuid: UUID
    description: str | None = None
    validity_date: date | None = None
    scheduled_date: date | None = None
    realisation_date: date | None = None
    partner_code: str | None = None
    origin_type: int
    origin_ref: str | None = None
    notes: str | None = None
    status: int
    created_at: datetime
    updated_at: datetime
    updated_by: int | None = None

    class Config:
        from_attributes = True


class HelloAssoViStagingResponse(BaseModel):
    uuid: UUID
    order_id: int
    item_id: int
    payment_id: int
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    amount_cents: int | None = None
    campaign_type: str | None = None
    form_slug: str | None = None
    payment_state: str | None = None
    item_state: str | None = None
    purchased_at: datetime | None = None
    promoted_vi_uuid: UUID | None = None
    promoted_at: datetime | None = None
    status: int
    raw_payload: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ViTypeCatalogUpdateRequest(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


class ViEntitlementUpdateRequest(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    vi_type_uuid: UUID | None = None
    description: str | None = None
    validity_date: date | None = None
    scheduled_date: date | None = None
    realisation_date: date | None = None
    partner_code: str | None = Field(default=None, max_length=64)
    origin_type: int | None = Field(default=None, ge=1, le=5)
    origin_ref: str | None = Field(default=None, max_length=128)
    notes: str | None = None
    status: int | None = Field(default=None, ge=1, le=5)


class ViPlanningDatePatchRequest(BaseModel):
    value: date | None = None


class ViNotesPatchRequest(BaseModel):
    notes: str | None = None


class ViBulkScheduleRequest(BaseModel):
    entitlement_uuids: list[UUID] = Field(default_factory=list)
    scheduled_date: date | None = None


class ViHelloAssoImportRequest(BaseModel):
    status: str = Field(default="active")
    source: str = Field(default="items")
    campaign_type: str | None = None
    page_size: int = Field(default=100, ge=1, le=500)


class ViHelloAssoImportPreviewResponse(BaseModel):
    fetched_count: int
    net_new_count: int
    already_staged_count: int


class ViHelloAssoImportResponse(BaseModel):
    fetched_count: int
    created_count: int
    duplicate_count: int
    staging_total_count: int


class ViPromotionRequest(BaseModel):
    staging_uuids: list[UUID] = Field(default_factory=list)
    vi_type_uuid: UUID | None = None


class ViPromotionResponse(BaseModel):
    selected_count: int
    promoted_count: int
    already_promoted_count: int
    failed_count: int
    promoted_entitlement_uuids: list[UUID] = Field(default_factory=list)
