"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - flights: FastAPI routes for validated flight listing and Planche flight fetch
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

import logging
from datetime import UTC, date, datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_EDIT_FLIGHTS, CAP_MANAGE_PLANCHE, TYPE_OF_FLIGHT_LABELS, LAUNCH_METHOD_LABELS
from models import Member, User, ValidatedFlight
from schemas.flights import (
    FlightBillingApplyItem,
    FlightBillingApplyRequest,
    FlightBillingApplyResponse,
    FlightBillingBatchApplyResponse,
    FlightBillingBatchPreviewResponse,
    FlightBillingFieldsUpdate,
    FlightBillingPostRequest,
    FlightBillingPreviewRequest,
    FlightBillingPreviewResponse,
    FlightFetchRequest,
    FlightFetchResponse,
    FlightStatsResponse,
    ValidatedFlightItem,
    ValidatedFlightListResponse,
)
from schemas.accounting import SystemSettingUpdateRequest
from schemas.planche import PLANCHE_SETTINGS_MODULE, PlancheSettingsPayload
from services.accounting import get_system_setting, upsert_system_setting
from services.flight_billing import FlightBillingPreviewService
from services.flight_billing_apply import FlightBillingApplyService
from services.planche_integration import PlancheIntegrationService

router = APIRouter(prefix="/api/v1/flights", tags=["flights"])
logger = logging.getLogger(__name__)

flights_guard = Depends(require_capability(CAP_EDIT_FLIGHTS))
planche_guard = Depends(require_capability(CAP_MANAGE_PLANCHE))

DEFAULT_PLANCHE_SETTINGS: dict[str, Any] = {
    "base_url": "",
    "connection_id": "",
    "token": "",
    "user": "",
    "password": "",
    "environment": "test",
    "retry_max_attempts": 3,
    "retry_backoff_ms": 1000,
    "chunk_size": 10,
    "sync_cursor_flights": None,
    "sync_cursor_pilots": None,
    "sync_cursor_machines": None,
    "last_fetch_at": None,
}


def _get_planche_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Helper to extract Planche settings dict with defaults."""
    allowed_keys = PlancheSettingsPayload.model_fields.keys()
    return {key: settings.get(key, DEFAULT_PLANCHE_SETTINGS.get(key)) for key in allowed_keys}


async def _get_planche_service(db: AsyncSession) -> PlancheIntegrationService:
    setting = await get_system_setting(db, PLANCHE_SETTINGS_MODULE)
    settings = _get_planche_settings(setting.settings if setting else {})
    return PlancheIntegrationService(
        base_url=settings["base_url"],
        connection_id=settings["connection_id"],
        token=settings["token"],
        user=settings["user"],
        password=settings["password"],
        retry_max_attempts=settings.get("retry_max_attempts", 3),
        retry_backoff_ms=settings.get("retry_backoff_ms", 1000),
        chunk_size=settings.get("chunk_size", 10),
    )


@router.get("", response_model=ValidatedFlightListResponse)
async def list_validated_flights(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    # Filters
    date_from: Optional[date] = Query(default=None, description="Filter: flight date >= date_from"),
    date_to: Optional[date] = Query(default=None, description="Filter: flight date <= date_to"),
    type_of_flight: Optional[int] = Query(default=None, ge=0, le=7, description="Filter: type_of_flight (0-7)"),
    launch_method: Optional[int] = Query(default=None, ge=0, le=3, description="Filter: launch_method (0-3)"),
    pilot_query: Optional[str] = Query(default=None, min_length=2, description="Search pilot by name or trigram"),
    asset_code: Optional[str] = Query(default=None, min_length=1, description="Filter: glider registration (partial match)"),
    erp_status: Optional[int] = Query(default=None, ge=0, le=2, description="Filter: erp_status (0=validated, 1=transferred, 2=modified)"),
    db: AsyncSession = Depends(get_db),
    _: User = flights_guard,
):
    """Return a paginated list of validated flights for the UI table view."""
    # Build dynamic filters
    filters: list = []

    if date_from is not None:
        filters.append(ValidatedFlight.jour >= date_from)
    if date_to is not None:
        filters.append(ValidatedFlight.jour <= date_to)
    if type_of_flight is not None:
        filters.append(ValidatedFlight.type_of_flight == type_of_flight)
    if launch_method is not None:
        filters.append(ValidatedFlight.launch_method == launch_method)
    if asset_code is not None:
        filters.append(ValidatedFlight.asset_code.ilike(f"%{asset_code}%"))
    if erp_status is not None:
        filters.append(ValidatedFlight.erp_status == erp_status)

    # Pilot search: resolve member UUIDs first, then filter by pilot_erp_id OR second_pilot_erp_id
    pilot_member_uuids: list[str] = []
    if pilot_query is not None and pilot_query.strip():
        search = f"%{pilot_query.strip()}%"
        member_rows = await db.execute(
            select(Member.account_id).where(
                or_(
                    Member.first_name.ilike(search),
                    Member.last_name.ilike(search),
                    Member.trigram.ilike(search),
                )
            )
        )
        pilot_member_uuids = [str(row[0]) for row in member_rows.all()]
        if pilot_member_uuids:
            filters.append(
                or_(
                    ValidatedFlight.pilot_erp_id.in_(pilot_member_uuids),
                    ValidatedFlight.second_pilot_erp_id.in_(pilot_member_uuids),
                )
            )
        else:
            # No matching members → return empty result
            return ValidatedFlightListResponse(
                items=[],
                total=0,
                page=page,
                page_size=page_size,
                total_pages=0,
            )

    # Count total (with filters)
    count_q = select(func.count(ValidatedFlight.uuid))
    if filters:
        count_q = count_q.where(*filters)
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    # Fetch page (with filters)
    offset = (page - 1) * page_size
    query = (
        select(ValidatedFlight)
        .where(*filters)
        .order_by(ValidatedFlight.jour.desc(), ValidatedFlight.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    rows_result = await db.execute(query)
    rows = rows_result.scalars().all()

    # Batch-fetch member names for pilot/second/charge_to columns
    member_uuids: set[str] = set()
    for r in rows:
        if r.pilot_erp_id:
            member_uuids.add(r.pilot_erp_id)
        if r.second_pilot_erp_id:
            member_uuids.add(r.second_pilot_erp_id)
        if r.charge_to_erp_id:
            member_uuids.add(r.charge_to_erp_id)

    member_map: dict[str, tuple[str | None, str | None]] = {}  # account_id -> (full_name, trigram)
    if member_uuids:
        member_result = await db.execute(
            select(Member.account_id, Member.first_name, Member.last_name, Member.trigram).where(
                Member.account_id.in_(list(member_uuids))
            )
        )
        for row in member_result.all():
            uid = str(row.account_id)
            name = f"{row.first_name} {row.last_name}" if row.first_name and row.last_name else None
            member_map[uid] = (name, row.trigram)

    items = []
    for r in rows:
        pilot_name = member_map.get(r.pilot_erp_id, (None, None))[0] if r.pilot_erp_id else None
        second_name = member_map.get(r.second_pilot_erp_id, (None, None))[0] if r.second_pilot_erp_id else None
        second_trigram = member_map.get(r.second_pilot_erp_id, (None, None))[1] if r.second_pilot_erp_id else None
        items.append(ValidatedFlightItem(
            uuid=str(r.uuid),
            jour=r.jour.isoformat() if r.jour else None,
            type_of_flight=r.type_of_flight,
            pilot_erp_id=r.pilot_erp_id,
            second_pilot_erp_id=r.second_pilot_erp_id,
            pilot_name=pilot_name,
            second_pilot_name=second_name,
            second_pilot_trigram=second_trigram,
            takeoff_time=r.takeoff_time,
            landing_time=r.landing_time,
            launch_method=r.launch_method,
            launch_asset_code=r.launch_asset_code,
            launch_pilot_trigram=r.launch_pilot_trigram,
            charge_to_erp_id=r.charge_to_erp_id,
            asset_code=r.asset_code,
            glider_erp_id=r.glider_erp_id,
            launch_machine_erp_id=r.launch_machine_erp_id,
            instruction_split=r.instruction_split,
            aero=r.aero,
            observations=r.observations,
            correction_reason=r.correction_reason,
        ))
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return ValidatedFlightListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post("/{flight_uuid}/billing-preview", response_model=FlightBillingPreviewResponse)
async def preview_flight_billing(
    flight_uuid: UUID,
    fiscal_year_uuid: UUID | None = Query(None, description="Required for club billing detection"),
    db: AsyncSession = Depends(get_db),
    _: User = flights_guard,
):
    """Calculate one imported flight billing preview without applying it."""
    service = FlightBillingPreviewService(db)
    try:
        return await service.preview_flight(flight_uuid, fiscal_year_uuid=fiscal_year_uuid)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/billing-preview", response_model=FlightBillingBatchPreviewResponse)
async def preview_flights_billing(
    request: FlightBillingPreviewRequest,
    fiscal_year_uuid: UUID | None = Query(None, description="Required for club billing detection"),
    db: AsyncSession = Depends(get_db),
    _: User = flights_guard,
):
    """Calculate imported flight billing previews without applying accounting."""
    service = FlightBillingPreviewService(db)
    return await service.preview_batch(request, fiscal_year_uuid=fiscal_year_uuid)


TYPE_OF_FLIGHT_LABELS: dict[int, str] = {
    0: "instruction", 1: "solo", 2: "initiation", 3: "partage",
    4: "passager", 5: "lacher", 6: "supervise", 7: "essai",
}
LAUNCH_METHOD_LABELS: dict[int, str] = {
    0: "exterieur", 1: "treuil", 2: "remorqueur", 3: "autonome",
}
STATUS_LABELS: dict[int, str] = {0: "validated", 1: "transferred", 2: "modified"}


@router.get("/stats", response_model=FlightStatsResponse)
async def flight_stats(
    db: AsyncSession = Depends(get_db),
    _: User = flights_guard,
):
    """Return aggregated KPI stats for the flight dashboard."""
    # Total count
    total_q = await db.execute(select(func.count(ValidatedFlight.uuid)))
    total_flights = total_q.scalar() or 0

    # By status
    status_rows = await db.execute(
        select(ValidatedFlight.erp_status, func.count(ValidatedFlight.uuid))
        .group_by(ValidatedFlight.erp_status)
    )
    by_status: dict[str, int] = {"validated": 0, "transferred": 0, "modified": 0}
    for row in status_rows.all():
        label = STATUS_LABELS.get(int(row[0]), "unknown")
        by_status[label] = int(row[1])

    # By flight type
    type_rows = await db.execute(
        select(ValidatedFlight.type_of_flight, func.count(ValidatedFlight.uuid))
        .group_by(ValidatedFlight.type_of_flight)
    )
    by_type: dict[str, int] = {}
    for row in type_rows.all():
        label = TYPE_OF_FLIGHT_LABELS.get(int(row[0]), f"type_{row[0]}")
        by_type[label] = int(row[1])

    # By launch method
    launch_rows = await db.execute(
        select(ValidatedFlight.launch_method, func.count(ValidatedFlight.uuid))
        .group_by(ValidatedFlight.launch_method)
    )
    by_launch_method: dict[str, int] = {}
    for row in launch_rows.all():
        label = LAUNCH_METHOD_LABELS.get(int(row[0]), f"method_{row[0]}")
        by_launch_method[label] = int(row[1])

    # Unbilled flights
    unbilled_q = await db.execute(
        select(func.count(ValidatedFlight.uuid)).where(ValidatedFlight.accounting_entry_uuid.is_(None))
    )
    unbilled_count = unbilled_q.scalar() or 0

    # Instruction splits
    split_q = await db.execute(
        select(func.count(ValidatedFlight.uuid)).where(ValidatedFlight.instruction_split > 0)
    )
    instruction_split_count = split_q.scalar() or 0

    # Modified after transfer
    modified_q = await db.execute(
        select(func.count(ValidatedFlight.uuid)).where(ValidatedFlight.erp_status == 2)
    )
    modified_after_transfer_count = modified_q.scalar() or 0

    # Settings (cursor + last_fetch_at) and Planche pending count
    last_fetch_at: str | None = None
    cursor: str | None = None
    pending_planche_count: int | None = None
    try:
        setting = await get_system_setting(db, PLANCHE_SETTINGS_MODULE)
        s = setting.settings if isinstance(setting.settings, dict) else {}
        last_fetch_at = s.get("last_fetch_at")
        cursor = s.get("sync_cursor_flights")

        # Lightweight Planche counters and KPI
        try:
            service = await _get_planche_service(db)
            pending = await service.get_pending_flights_count(db, cursor=cursor)
            pending_planche_count = pending
        except Exception:
            pending_planche_count = None
    except (HTTPException, Exception):
        pass

    return FlightStatsResponse(
        total_flights=total_flights,
        by_status=by_status,
        by_type=by_type,
        by_launch_method=by_launch_method,
        unbilled_count=unbilled_count,
        instruction_split_count=instruction_split_count,
        modified_after_transfer_count=modified_after_transfer_count,
        last_fetch_at=last_fetch_at,
        cursor=cursor,
        pending_planche_count=pending_planche_count,
    )


@router.post("/fetch", response_model=FlightFetchResponse)
async def fetch_validated_flights_from_planche(
    request: FlightFetchRequest | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = planche_guard,
    current_user: User = Depends(get_current_user),
):
    """Fetch Planche validated flight revisions into ERP current flight storage."""
    payload = request or FlightFetchRequest()
    service = await _get_planche_service(db)
    result = await service.pull_validated_flights(
        db=db,
        from_date=payload.from_date,
        to_date=payload.to_date,
        cursor=payload.cursor,
        limit=payload.limit,
        triggered_by=str(current_user.id),
    )

    # Persist next_cursor + timestamp into Planche settings so they survive page reload
    try:
        current_setting = await get_system_setting(db, PLANCHE_SETTINGS_MODULE)
        current_settings = dict(current_setting.settings) if isinstance(current_setting.settings, dict) else {}
        next_cursor = result.get("next_cursor")
        if next_cursor is not None:
            current_settings["sync_cursor_flights"] = next_cursor
        current_settings["last_fetch_at"] = datetime.now(UTC).isoformat()
        await upsert_system_setting(
            db,
            PLANCHE_SETTINGS_MODULE,
            SystemSettingUpdateRequest(settings=current_settings),
            current_user.id,
        )
    except HTTPException:
        # Settings may not exist yet — that's acceptable
        pass

    return result


# ---------------------------------------------------------------------------
# Billable Flights (Phase 4)
# ---------------------------------------------------------------------------

class BillableFlightItem(BaseModel):
    uuid: str
    planche_uuid: str | None
    jour: date | None
    pilot_erp_id: str | None
    pilot_name: str | None
    second_pilot_erp_id: str | None = None
    second_pilot_name: str | None = None
    charge_to_erp_id: str | None = None
    charge_to_name: str | None = None
    asset_code: str | None
    type_of_flight: int | None
    type_label: str | None
    total_preview: str | None
    status: str  # pending | applied | posted
    has_discount: bool = False
    errors: list[str] = []
    warnings: list[str] = []
    observations: str | None = None
    correction_reason: str | None = None


class BillableFlightListResponse(BaseModel):
    items: list[BillableFlightItem]
    total: int


class PendingBillingSummaryResponse(BaseModel):
    total_flights: int
    total_amount: str
    pending_count: int
    error_count: int


@router.get("/billable", response_model=BillableFlightListResponse)
async def list_billable_flights(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    type_of_flight: int | None = Query(None, ge=0, le=7, description="Filter by flight type (0-7)"),
    launch_method: int | None = Query(None, ge=0, le=3, description="Filter by launch method (0-3)"),
    status: str | None = Query(None, pattern="^(pending|applied|posted|all)$", description="Filter by billing status"),
    db: AsyncSession = Depends(get_db),
    _: User = flights_guard,
):
    """List flights with billing status info. Default returns only unbilled (pending) flights."""
    filters: list = []
    if status is None or status == "pending":
        filters.append(ValidatedFlight.accounting_entry_uuid.is_(None))
    elif status == "applied":
        filters.append(ValidatedFlight.billing_quote_state == "applied")
    elif status == "posted":
        filters.append(ValidatedFlight.billing_quote_state == "posted")
    # status=all → no accounting_entry_uuid filter
    if date_from is not None:
        filters.append(ValidatedFlight.jour >= date_from)
    if date_to is not None:
        filters.append(ValidatedFlight.jour <= date_to)
    if type_of_flight is not None:
        filters.append(ValidatedFlight.type_of_flight == type_of_flight)
    if launch_method is not None:
        filters.append(ValidatedFlight.launch_method == launch_method)

    stmt = select(ValidatedFlight).where(*filters).order_by(ValidatedFlight.jour.asc())
    result = await db.execute(stmt)
    flights = result.scalars().all()

    # Batch-fetch member names
    member_uuids: set[str] = set()
    for f in flights:
        if f.pilot_erp_id:
            member_uuids.add(f.pilot_erp_id)
        if f.second_pilot_erp_id:
            member_uuids.add(f.second_pilot_erp_id)
        if f.charge_to_erp_id:
            member_uuids.add(f.charge_to_erp_id)

    member_map: dict[str, tuple[str | None, str | None]] = {}
    if member_uuids:
        member_result = await db.execute(
            select(Member.account_id, Member.first_name, Member.last_name, Member.trigram).where(
                Member.account_id.in_(list(member_uuids))
            )
        )
        for row in member_result.all():
            uid = str(row.account_id)
            name = f"{row.first_name} {row.last_name}" if row.first_name and row.last_name else None
            member_map[uid] = (name, row.trigram)

    items: list[BillableFlightItem] = []
    for f in flights:
        pilot_name = member_map.get(f.pilot_erp_id, (None, None))[0] if f.pilot_erp_id else None
        second_name = member_map.get(f.second_pilot_erp_id, (None, None))[0] if f.second_pilot_erp_id else None
        charge_to_name = member_map.get(f.charge_to_erp_id, (None, None))[0] if f.charge_to_erp_id else None
        items.append(BillableFlightItem(
            uuid=str(f.uuid),
            planche_uuid=f.planche_uuid,
            jour=f.jour,
            pilot_erp_id=f.pilot_erp_id,
            pilot_name=pilot_name,
            second_pilot_erp_id=f.second_pilot_erp_id,
            second_pilot_name=second_name,
            charge_to_erp_id=f.charge_to_erp_id,
            charge_to_name=charge_to_name,
            asset_code=f.asset_code or f.glider_erp_id,
            type_of_flight=f.type_of_flight,
            type_label=TYPE_OF_FLIGHT_LABELS.get(f.type_of_flight) if f.type_of_flight is not None else None,
            total_preview=None,
            status=f.billing_quote_state or "pending",
            has_discount=f.has_discount or False,
            observations=f.observations,
            correction_reason=f.correction_reason,
        ))

    return BillableFlightListResponse(items=items, total=len(items))


@router.get("/billing-summary", response_model=PendingBillingSummaryResponse)
async def pending_billing_summary(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = flights_guard,
):
    """Aggregate stats for flights pending billing."""
    filters = [ValidatedFlight.accounting_entry_uuid.is_(None)]
    if date_from is not None:
        filters.append(ValidatedFlight.jour >= date_from)
    if date_to is not None:
        filters.append(ValidatedFlight.jour <= date_to)

    count_stmt = select(func.count()).select_from(ValidatedFlight).where(*filters)
    count_result = await db.execute(count_stmt)
    total = count_result.scalar() or 0

    return PendingBillingSummaryResponse(
        total_flights=total,
        total_amount="0",
        pending_count=total,
        error_count=0,
    )


# ── Flight field update (PATCH) ────────────────────────────────────────────


@router.patch("/{flight_uuid}/billing-fields", response_model=ValidatedFlightItem)
async def patch_flight_billing_fields(
    flight_uuid: UUID,
    request: FlightBillingFieldsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = flights_guard,
):
    """Update billable fields (charge_to_erp_id, charge_comment) on a flight."""
    result = await db.execute(select(ValidatedFlight).where(ValidatedFlight.uuid == flight_uuid))
    flight = result.scalar_one_or_none()
    if flight is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flight not found")

    if request.charge_to_erp_id is not None:
        flight.charge_to_erp_id = request.charge_to_erp_id
    if request.charge_comment is not None:
        flight.charge_comment = request.charge_comment

    await db.commit()
    await db.refresh(flight)

    return ValidatedFlightItem(
        uuid=str(flight.uuid),
        planche_uuid=flight.planche_uuid,
        jour=flight.jour,
        pilot_erp_id=flight.pilot_erp_id,
        second_pilot_erp_id=flight.second_pilot_erp_id,
        charge_to_erp_id=flight.charge_to_erp_id,
        charge_comment=flight.charge_comment,
        asset_code=flight.asset_code or flight.glider_erp_id,
        type_of_flight=flight.type_of_flight,
        launch_method=flight.launch_method,
        takeoff_time=flight.takeoff_time,
        landing_time=flight.landing_time,
        engine_time=flight.engine_time,
        landing_count=flight.landing_count,
        flight_km=flight.flight_km,
        observations=flight.observations,
    )


# ── Billing Apply (Phase 5) ────────────────────────────────────────────────


@router.post("/{flight_uuid}/billing-apply", response_model=FlightBillingApplyResponse)
async def apply_flight_billing(
    flight_uuid: UUID,
    request: FlightBillingPostRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = flights_guard,
):
    """Run billing preview and create a Draft accounting entry for a single flight."""
    service = FlightBillingApplyService(db)
    try:
        entry = await service.apply_flight_billing(
            flight_uuid,
            UUID(request.fiscal_year_uuid),
            current_user.id,
        )
        return FlightBillingApplyResponse(
            entry_uuid=str(entry.uuid),
            reference=entry.reference or "",
            description=entry.description or "",
            state=entry.state,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{flight_uuid}/billing-post", response_model=FlightBillingApplyResponse)
async def post_flight_billing(
    flight_uuid: UUID,
    request: FlightBillingPostRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = flights_guard,
):
    """Run billing preview, create a Draft entry, and immediately post it."""
    service = FlightBillingApplyService(db)
    try:
        entry = await service.post_flight_billing(
            flight_uuid,
            UUID(request.fiscal_year_uuid),
            current_user.id,
        )
        return FlightBillingApplyResponse(
            entry_uuid=str(entry.uuid),
            reference=entry.reference or "",
            description=entry.description or "",
            state=entry.state,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/billing-batch-apply", response_model=FlightBillingBatchApplyResponse)
async def batch_apply_flights_billing(
    request: FlightBillingApplyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = flights_guard,
):
    """Apply billing for multiple flights in batch."""
    service = FlightBillingApplyService(db)
    flight_uuids = [UUID(f) for f in request.flight_uuids]
    entries = await service.batch_apply(flight_uuids, UUID(request.fiscal_year_uuid), current_user.id)

    items = []
    for fuuid, entry in entries:
        items.append(
            FlightBillingApplyItem(
                flight_uuid=str(fuuid),
                entry_uuid=str(entry.uuid),
                entry_state=entry.state,
                reference=entry.reference or "",
                description=entry.description or "",
            )
        )
    return FlightBillingBatchApplyResponse(
        items=items,
        total=len(items),
        success_count=len(items),
        error_count=0,
    )


# ---------------------------------------------------------------------------
# Raw Flight Details (DB-level dump with decoded enums)
# ---------------------------------------------------------------------------

ERP_STATUS_LABELS: dict[int, str] = {
    0: "validated",
    1: "transferred",
    2: "modified_after_transfer",
}


class RawFlightDetailsResponse(BaseModel):
    """Full ValidatedFlight record with decoded enum labels, grouped by category."""

    # ── Identification ──
    uuid: str
    planche_uuid: str | None = None
    aero: str | None = None
    source_snapshot_uuid: str | None = None

    # ── Date & Aéronef ──
    jour: date | None = None
    asset_code: str | None = None
    glider_erp_id: str | None = None

    # ── Pilotes & Facturation ──
    pilot_erp_id: str | None = None
    pilot_name: str | None = None
    pilot_compta_id: str | None = None
    second_pilot_erp_id: str | None = None
    second_pilot_name: str | None = None
    second_pilot_id: str | None = None
    charge_to_erp_id: str | None = None
    charge_to_name: str | None = None
    charge_to_compta_id: str | None = None
    charge_comment: str | None = None
    instruction_split: int = 0
    vi_erp_id: str | None = None
    vi_name: str | None = None

    # ── Type de vol & Lancement ──
    type_of_flight: int | None = None
    type_label: str | None = None
    launch_method: int | None = None
    launch_method_label: str | None = None
    launch_type: int | None = None

    # ── Machine de lancement ──
    launch_asset_code: str | None = None
    launch_machine_erp_id: str | None = None
    launch_pilot_trigram: str | None = None
    launch_instructor_trigram: str | None = None

    # ── Temps & Mesures ──
    takeoff_time: str | None = None
    landing_time: str | None = None
    start_index: float | None = None
    stop_index: float | None = None
    engine_time: float | None = None
    landing_count: int = 1
    flight_km: float | None = None
    takeoff_location: str | None = None
    landed_location: str | None = None
    observations: str | None = None

    # ── Statut ERP ──
    erp_status: int = 0
    erp_status_label: str | None = None
    validated_at: datetime | None = None
    validated_by: str | None = None
    transferred_at: datetime | None = None
    transferred_by: str | None = None
    revision: int = 1
    source_status: str = "active"
    corrected_at: datetime | None = None
    corrected_by: str | None = None
    correction_reason: str | None = None
    last_export_hash: str | None = None

    # ── Comptabilité ──
    accounting_entry_uuid: str | None = None
    billing_quote_state: str | None = None
    has_discount: bool = False


@router.get("/{flight_uuid}/raw-details", response_model=RawFlightDetailsResponse)
async def get_flight_raw_details(
    flight_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = flights_guard,
):
    """Return the complete ValidatedFlight record as-is with decoded enum labels."""
    result = await db.execute(select(ValidatedFlight).where(ValidatedFlight.uuid == flight_uuid))
    flight = result.scalar_one_or_none()
    if flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")

    # Resolve member names
    member_uuids: set[str] = set()
    if flight.pilot_erp_id:
        member_uuids.add(flight.pilot_erp_id)
    if flight.second_pilot_erp_id:
        member_uuids.add(flight.second_pilot_erp_id)
    if flight.charge_to_erp_id:
        member_uuids.add(flight.charge_to_erp_id)
    if flight.vi_erp_id:
        member_uuids.add(flight.vi_erp_id)

    member_map: dict[str, str | None] = {}
    if member_uuids:
        member_result = await db.execute(
            select(Member.account_id, Member.first_name, Member.last_name).where(
                Member.account_id.in_(list(member_uuids))
            )
        )
        for row in member_result.all():
            uid = str(row.account_id)
            name = f"{row.first_name} {row.last_name}" if row.first_name and row.last_name else None
            member_map[uid] = name

    return RawFlightDetailsResponse(
        # ── Identification ──
        uuid=str(flight.uuid),
        planche_uuid=flight.planche_uuid,
        aero=flight.aero,
        source_snapshot_uuid=str(flight.source_snapshot_uuid) if flight.source_snapshot_uuid else None,
        # ── Date & Aéronef ──
        jour=flight.jour,
        asset_code=flight.asset_code,
        glider_erp_id=flight.glider_erp_id,
        # ── Pilotes & Facturation ──
        pilot_erp_id=flight.pilot_erp_id,
        pilot_name=member_map.get(flight.pilot_erp_id) if flight.pilot_erp_id else None,
        pilot_compta_id=flight.pilot_compta_id,
        second_pilot_erp_id=flight.second_pilot_erp_id,
        second_pilot_name=member_map.get(flight.second_pilot_erp_id) if flight.second_pilot_erp_id else None,
        second_pilot_id=flight.second_pilot_id,
        charge_to_erp_id=flight.charge_to_erp_id,
        charge_to_name=member_map.get(flight.charge_to_erp_id) if flight.charge_to_erp_id else None,
        charge_to_compta_id=flight.charge_to_compta_id,
        charge_comment=flight.charge_comment,
        instruction_split=flight.instruction_split or 0,
        vi_erp_id=flight.vi_erp_id,
        vi_name=member_map.get(flight.vi_erp_id) if flight.vi_erp_id else None,
        # ── Type de vol & Lancement ──
        type_of_flight=flight.type_of_flight,
        type_label=TYPE_OF_FLIGHT_LABELS.get(flight.type_of_flight) if flight.type_of_flight is not None else None,
        launch_method=flight.launch_method,
        launch_method_label=LAUNCH_METHOD_LABELS.get(flight.launch_method) if flight.launch_method is not None else None,
        launch_type=flight.launch_type,
        # ── Machine de lancement ──
        launch_asset_code=flight.launch_asset_code,
        launch_machine_erp_id=flight.launch_machine_erp_id,
        launch_pilot_trigram=flight.launch_pilot_trigram,
        launch_instructor_trigram=flight.launch_instructor_trigram,
        # ── Temps & Mesures ──
        takeoff_time=flight.takeoff_time,
        landing_time=flight.landing_time,
        start_index=flight.start_index,
        stop_index=flight.stop_index,
        engine_time=flight.engine_time,
        landing_count=flight.landing_count or 1,
        flight_km=flight.flight_km,
        takeoff_location=flight.takeoff_location,
        landed_location=flight.landed_location,
        observations=flight.observations,
        # ── Statut ERP ──
        erp_status=flight.erp_status,
        erp_status_label=ERP_STATUS_LABELS.get(flight.erp_status),
        validated_at=flight.validated_at,
        validated_by=flight.validated_by,
        transferred_at=flight.transferred_at,
        transferred_by=flight.transferred_by,
        revision=flight.revision or 1,
        source_status=flight.source_status or "active",
        corrected_at=flight.corrected_at,
        corrected_by=flight.corrected_by,
        correction_reason=flight.correction_reason,
        last_export_hash=flight.last_export_hash,
        # ── Comptabilité ──
        accounting_entry_uuid=str(flight.accounting_entry_uuid) if flight.accounting_entry_uuid else None,
        billing_quote_state=flight.billing_quote_state,
        has_discount=flight.has_discount or False,
    )
