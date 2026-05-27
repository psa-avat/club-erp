"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - planche: Schemas for the Planche de vol integration settings and test endpoints
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


PLANCHE_SETTINGS_MODULE = "planche"


class PlancheSettingsPayload(BaseModel):
    # Chunk size for batch sync (pilots/machines)
    chunk_size: int = Field(default=10, ge=1, le=100)
    base_url: str = Field(min_length=1)
    connection_id: str = Field(min_length=1)
    token: str = Field(min_length=1)
    user: str = Field(min_length=1)
    password: str = Field(min_length=1)
    environment: str = Field(default="test", min_length=1)
    # Sync cursor fields for incremental pulls (Phase 1+)
    sync_cursor_flights: Optional[str] = Field(default=None)  # Composite cursor for Planche flight changes
    sync_cursor_pilots: Optional[datetime] = Field(default=None)  # Last push timestamp for pilots
    sync_cursor_machines: Optional[datetime] = Field(default=None)  # Last push timestamp for machines
    # Retry configuration for failed operations
    retry_max_attempts: int = Field(default=3, ge=1, le=10)
    retry_backoff_ms: int = Field(default=1000, ge=100, le=60000)
    # Feature flags for enabling/disabling sync operations
    feature_flags: dict[str, bool] = Field(
        default_factory=lambda: {
            "enable_pilot_push": True,
            "enable_machine_push": True,
            "enable_flight_pull": True,
        }
    )


class PlancheSettingsResponse(BaseModel):
    module_name: str
    settings: dict[str, Any]
    updated_at: datetime
    updated_by: Optional[int] = None

    class Config:
        from_attributes = True


class PlancheConnectionTestResponse(BaseModel):
    success: bool
    message: str
    status_code: int | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class PlancheLoginTestResponse(BaseModel):
    success: bool
    message: str
    status_code: int | None = None
    user_id: int | None = None
    roles: list[str] = Field(default_factory=list)
    login_token: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)

# Flight schemas moved to schemas/flights.py

