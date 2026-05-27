"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - flights: Pydantic schemas for flight data and Planche flight fetch
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
from typing import Optional

from pydantic import BaseModel, Field


class FlightFetchRequest(BaseModel):
    from_date: Optional[datetime] = None
    to_date: Optional[datetime] = None
    cursor: Optional[str] = None
    limit: int = Field(default=500, ge=1, le=5000)


class FlightFetchResponse(BaseModel):
    total: int
    created: int
    updated: int
    skipped: int
    idempotent: int = 0
    snapshots_created: int = 0
    modified_after_transfer: int = 0
    next_cursor: Optional[str] = None
    has_more: bool = False
    error_details: list[str] = Field(default_factory=list)
    failed_count: int = 0
    missing_required_field_count: int = 0
    constraint_violation_count: int = 0


class ValidatedFlightItem(BaseModel):
    """Lightweight validated flight row for the paginated listing."""

    uuid: str
    jour: str | None = None
    type_of_flight: int | None = None
    pilot_erp_id: str | None = None
    second_pilot_erp_id: str | None = None
    takeoff_time: str | None = None
    landing_time: str | None = None
    launch_method: int | None = None
    launch_asset_code: str | None = None
    launch_pilot_trigram: str | None = None
    charge_to_erp_id: str | None = None
    asset_code: str | None = None
    glider_erp_id: str | None = None
    launch_machine_erp_id: str | None = None
    instruction_split: int | None = None
    aero: str | None = None
    pilot_name: str | None = None
    second_pilot_name: str | None = None
    second_pilot_trigram: str | None = None

    class Config:
        from_attributes = True


class ValidatedFlightListResponse(BaseModel):
    items: list[ValidatedFlightItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0
    error_details: list[str] = Field(default_factory=list)


class FlightStatsResponse(BaseModel):
    """Aggregated KPIs for the flight operations dashboard."""

    total_flights: int = 0
    by_status: dict[str, int] = Field(default_factory=lambda: {"validated": 0, "transferred": 0, "modified": 0})
    by_type: dict[str, int] = Field(default_factory=dict)
    by_launch_method: dict[str, int] = Field(default_factory=dict)
    unbilled_count: int = 0
    instruction_split_count: int = 0
    modified_after_transfer_count: int = 0
    last_fetch_at: str | None = None
    cursor: str | None = None
    pending_planche_count: int | None = None
