"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - helloasso: Schemas for HelloAsso integration settings and connection testing
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

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


HELLOASSO_SETTINGS_MODULE = "helloasso"


class HelloAssoSettingsPayload(BaseModel):
    client_id: str = Field(min_length=1)
    client_secret: str = Field(min_length=1)
    environment: str = Field(default="production", min_length=1)


class HelloAssoSettingsResponse(BaseModel):
    module_name: str
    settings: dict[str, Any]
    updated_at: datetime
    updated_by: Optional[int] = None

    class Config:
        from_attributes = True


class HelloAssoConnectionTestResponse(BaseModel):
    success: bool
    message: str
    status_code: int | None = None
    organizations_count: int = 0
    organization_slug: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class HelloAssoPurchasesQuery(BaseModel):
    status: Literal["active", "done"] = "active"
    source: Literal["items", "orders"] = "items"
    campaign_type: str | None = None
    page_size: int = Field(default=100, ge=1, le=500)


class HelloAssoPurchaseRecord(BaseModel):
    id: int
    order_id: int | None = None
    item_id: int | None = None
    source: Literal["items", "orders"]
    campaign_type: str | None = None
    form_slug: str | None = None
    item_state: str | None = None
    payment_state: str | None = None
    date: datetime | None = None
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    amount_cents: int | None = None
    payment_ids: list[int] = Field(default_factory=list)


class HelloAssoPurchasesResponse(BaseModel):
    organization_slug: str
    status: Literal["active", "done"]
    source: Literal["items", "orders"]
    campaign_type: str | None = None
    count: int
    purchases: list[HelloAssoPurchaseRecord] = Field(default_factory=list)
