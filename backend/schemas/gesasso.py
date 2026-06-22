"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - gesasso: Schemas for the GesAsso (FFVP) integration settings and API responses
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
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


GESASSO_SETTINGS_MODULE = "gesasso"


class GesAssoSettingsPayload(BaseModel):
    base_url: str = Field(default="https://api.gesasso.ffvp.fr", min_length=1)
    username: str = Field(min_length=1)
    secret: str = Field(min_length=1)


class GesAssoSettingsResponse(BaseModel):
    module_name: str
    settings: dict[str, Any]
    updated_at: Optional[datetime] = None
    updated_by: Optional[int] = None


# --- GesAsso API response shapes ---

class GesAssoLicenceInfo(BaseModel):
    licenceNumber: Optional[str] = None
    seasonStartDate: Optional[str] = None
    seasonEndDate: Optional[str] = None


class GesAssoPilotPersonalInfo(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone_number: Optional[str] = None
    mobile_phone_number: Optional[str] = None
    civility: Optional[str] = None
    birth_date: Optional[str] = None
    licence: Optional[GesAssoLicenceInfo] = None


class GesAssoPilotLookupResponse(BaseModel):
    ffvp_id: int
    personal_info: dict[str, Any]
