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
from typing import Any, Optional

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
