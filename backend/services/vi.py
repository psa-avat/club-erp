"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Service layer for VI type catalog, entitlements, and HelloAsso staging workflow
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

from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from decimal import Decimal

from models import HelloAssoViStaging, ValidatedFlight, ViEntitlement, ViEntitlementStatus, ViFlightLink, ViOriginType, ViTypeCatalog
from schemas.helloasso import HelloAssoPurchaseRecord
from schemas.vi import ViEntitlementPayload, ViEntitlementUpdateRequest, ViTypeCatalogPayload, ViTypeCatalogUpdateRequest


def _normalize_code(value: str) -> str:
    return value.strip().upper()


def _assert_date_consistency(scheduled_date: date | None, realisation_date: date | None) -> None:
    if scheduled_date is not None and realisation_date is not None and realisation_date < scheduled_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="realisation_date cannot be earlier than scheduled_date",
        )


_VI_TYPE_LOADS = [
    joinedload(ViTypeCatalog.charge_account),
    joinedload(ViTypeCatalog.client_account),
    joinedload(ViTypeCatalog.revenue_account),
    joinedload(ViTypeCatalog.insurance_account),
    joinedload(ViTypeCatalog.insurance_expense_account),
    joinedload(ViTypeCatalog.analytical_cost_account),
    joinedload(ViTypeCatalog.analytical_reflection_account),
]


async def list_vi_types(db: AsyncSession, active_only: bool = False) -> list[ViTypeCatalog]:
    stmt = select(ViTypeCatalog).options(*_VI_TYPE_LOADS)
    if active_only:
        stmt = stmt.where(ViTypeCatalog.is_active.is_(True))
    stmt = stmt.order_by(ViTypeCatalog.code)
    result = await db.execute(stmt)
    return list(result.unique().scalars().all())


async def create_vi_type(
    db: AsyncSession,
    payload: ViTypeCatalogPayload,
    user_id: int | None,
) -> ViTypeCatalog:
    code = _normalize_code(payload.code)
    existing = await db.execute(select(ViTypeCatalog).where(ViTypeCatalog.code == code))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VI type code already exists")

    row = ViTypeCatalog(
        code=code,
        name=payload.name.strip(),
        description=payload.description.strip() if isinstance(payload.description, str) else None,
        is_active=payload.is_active,
        charge_account_uuid=payload.charge_account_uuid,
        updated_by=user_id,
    )
    db.add(row)
    await db.commit()
    result = await db.execute(
        select(ViTypeCatalog).options(*_VI_TYPE_LOADS).where(ViTypeCatalog.uuid == row.uuid)
    )
    return result.unique().scalar_one()


async def get_vi_type(db: AsyncSession, type_uuid: UUID) -> ViTypeCatalog:
    result = await db.execute(
        select(ViTypeCatalog)
        .options(*_VI_TYPE_LOADS)
        .where(ViTypeCatalog.uuid == type_uuid)
    )
    row = result.unique().scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VI type not found")
    return row


async def update_vi_type(
    db: AsyncSession,
    type_uuid: UUID,
    payload: ViTypeCatalogUpdateRequest,
    user_id: int | None,
) -> ViTypeCatalog:
    row = await get_vi_type(db, type_uuid)

    if payload.code is not None:
        new_code = _normalize_code(payload.code)
        existing = await db.execute(
            select(ViTypeCatalog).where(and_(ViTypeCatalog.code == new_code, ViTypeCatalog.uuid != type_uuid))
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VI type code already exists")
        row.code = new_code

    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.description is not None:
        row.description = payload.description.strip() if payload.description else None
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.charge_account_uuid is not None:
        row.charge_account_uuid = payload.charge_account_uuid

    # Accounting configuration — use model_fields_set so explicit null clears the field
    _set = payload.model_fields_set
    if "client_account_uuid" in _set:
        row.client_account_uuid = payload.client_account_uuid
    if "revenue_account_uuid" in _set:
        row.revenue_account_uuid = payload.revenue_account_uuid
    if "insurance_account_uuid" in _set:
        row.insurance_account_uuid = payload.insurance_account_uuid
    if "insurance_tiers_uuid" in _set:
        row.insurance_tiers_uuid = payload.insurance_tiers_uuid
    if "insurance_amount" in _set:
        row.insurance_amount = payload.insurance_amount
    if "max_flights" in _set and payload.max_flights is not None:
        row.max_flights = payload.max_flights
    if "analytical_cost_account_uuid" in _set:
        row.analytical_cost_account_uuid = payload.analytical_cost_account_uuid
    if "analytical_reflection_account_uuid" in _set:
        row.analytical_reflection_account_uuid = payload.analytical_reflection_account_uuid
    if "insurance_expense_account_uuid" in _set:
        row.insurance_expense_account_uuid = payload.insurance_expense_account_uuid

    row.updated_by = user_id
    await db.commit()
    result = await db.execute(
        select(ViTypeCatalog).options(*_VI_TYPE_LOADS).where(ViTypeCatalog.uuid == row.uuid)
    )
    return result.unique().scalar_one()


async def list_vi_entitlements(
    db: AsyncSession,
    status_filter: int | None = None,
    type_uuid: UUID | None = None,
    scheduled_from: date | None = None,
    scheduled_to: date | None = None,
) -> list[ViEntitlement]:
    stmt = (
        select(ViEntitlement)
        .options(joinedload(ViEntitlement.vi_type), selectinload(ViEntitlement.flight_links))
        .order_by(ViEntitlement.created_at.desc())
    )

    if status_filter is not None:
        stmt = stmt.where(ViEntitlement.status == status_filter)
    if type_uuid is not None:
        stmt = stmt.where(ViEntitlement.vi_type_uuid == type_uuid)
    if scheduled_from is not None:
        stmt = stmt.where(ViEntitlement.scheduled_date >= scheduled_from)
    if scheduled_to is not None:
        stmt = stmt.where(ViEntitlement.scheduled_date <= scheduled_to)

    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_vi_entitlement(db: AsyncSession, entitlement_uuid: UUID) -> ViEntitlement:
    result = await db.execute(
        select(ViEntitlement).options(joinedload(ViEntitlement.vi_type)).where(ViEntitlement.uuid == entitlement_uuid)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VI entitlement not found")
    return row


async def create_vi_entitlement(
    db: AsyncSession,
    payload: ViEntitlementPayload,
    user_id: int | None,
) -> ViEntitlement:
    code = _normalize_code(payload.code)
    existing = await db.execute(select(ViEntitlement).where(ViEntitlement.code == code))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VI entitlement code already exists")

    _assert_date_consistency(payload.scheduled_date, payload.realisation_date)

    vi_type = await db.execute(select(ViTypeCatalog).where(ViTypeCatalog.uuid == payload.vi_type_uuid))
    if vi_type.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown VI type")

    row = ViEntitlement(
        code=code,
        vi_type_uuid=payload.vi_type_uuid,
        description=payload.description,
        amount_ttc=payload.amount_ttc,
        validity_date=payload.validity_date,
        scheduled_date=payload.scheduled_date,
        realisation_date=payload.realisation_date,
        partner_code=payload.partner_code,
        origin_type=payload.origin_type,
        origin_ref=payload.origin_ref,
        notes=payload.notes,
        status=payload.status,
        is_generic=payload.is_generic,
        updated_by=user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row, attribute_names=["vi_type"])
    return row


async def update_vi_entitlement(
    db: AsyncSession,
    entitlement_uuid: UUID,
    payload: ViEntitlementUpdateRequest,
    user_id: int | None,
) -> ViEntitlement:
    row = await get_vi_entitlement(db, entitlement_uuid)

    if payload.code is not None:
        new_code = _normalize_code(payload.code)
        if new_code != row.code and row.planche_synced_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot change code: this VI entitlement has already been sent to Planche",
            )
        existing = await db.execute(
            select(ViEntitlement).where(and_(ViEntitlement.code == new_code, ViEntitlement.uuid != entitlement_uuid))
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VI entitlement code already exists")
        row.code = new_code

    if payload.vi_type_uuid is not None:
        vi_type = await db.execute(select(ViTypeCatalog).where(ViTypeCatalog.uuid == payload.vi_type_uuid))
        if vi_type.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown VI type")
        row.vi_type_uuid = payload.vi_type_uuid

    if payload.description is not None:
        row.description = payload.description
    if payload.validity_date is not None:
        row.validity_date = payload.validity_date
    if 'scheduled_date' in payload.model_fields_set:
        if payload.scheduled_date != row.scheduled_date and row.status == int(ViEntitlementStatus.REALIZED):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot reschedule: this VI entitlement has already been realized",
            )
        row.scheduled_date = payload.scheduled_date
        if payload.status is None and row.status in (int(ViEntitlementStatus.LOADED), int(ViEntitlementStatus.SCHEDULED)):
            row.status = int(ViEntitlementStatus.SCHEDULED if payload.scheduled_date else ViEntitlementStatus.LOADED)
    if payload.realisation_date is not None:
        row.realisation_date = payload.realisation_date
    if payload.partner_code is not None:
        row.partner_code = payload.partner_code
    if payload.origin_type is not None:
        row.origin_type = payload.origin_type
    if payload.origin_ref is not None:
        row.origin_ref = payload.origin_ref
    if payload.notes is not None:
        row.notes = payload.notes
    if payload.status is not None:
        row.status = payload.status
    if payload.is_generic is not None:
        row.is_generic = payload.is_generic
    if payload.amount_ttc is not None:
        row.amount_ttc = payload.amount_ttc
    if 'insurance_amount_override' in payload.model_fields_set:
        row.insurance_amount_override = payload.insurance_amount_override

    _assert_date_consistency(row.scheduled_date, row.realisation_date)

    row.updated_by = user_id
    await db.commit()
    await db.refresh(row, attribute_names=["vi_type"])
    return row


async def patch_vi_scheduled_date(
    db: AsyncSession,
    entitlement_uuid: UUID,
    scheduled_date: date | None,
    user_id: int | None,
) -> ViEntitlement:
    row = await get_vi_entitlement(db, entitlement_uuid)
    if scheduled_date != row.scheduled_date and row.status == int(ViEntitlementStatus.REALIZED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot reschedule: this VI entitlement has already been realized",
        )
    _assert_date_consistency(scheduled_date, row.realisation_date)
    row.scheduled_date = scheduled_date
    if row.status in (int(ViEntitlementStatus.LOADED), int(ViEntitlementStatus.SCHEDULED)):
        row.status = int(ViEntitlementStatus.SCHEDULED if scheduled_date else ViEntitlementStatus.LOADED)
    row.updated_by = user_id
    await db.commit()
    await db.refresh(row, attribute_names=["vi_type"])
    return row


async def _max_linked_flight_date(db: AsyncSession, entitlement_uuid: UUID) -> date | None:
    """Latest flight date among this entitlement's linked flights (None if none linked)."""
    result = await db.execute(
        select(func.max(ValidatedFlight.jour))
        .select_from(ViFlightLink)
        .join(ValidatedFlight, ViFlightLink.flight_uuid == ValidatedFlight.uuid)
        .where(ViFlightLink.entitlement_uuid == entitlement_uuid, ViFlightLink.flight_uuid.isnot(None))
    )
    return result.scalar_one_or_none()


async def patch_vi_realisation_date(
    db: AsyncSession,
    entitlement_uuid: UUID,
    realisation_date: date | None,
    user_id: int | None,
) -> ViEntitlement:
    row = await get_vi_entitlement(db, entitlement_uuid)
    _assert_date_consistency(row.scheduled_date, realisation_date)
    row.realisation_date = realisation_date
    if realisation_date is not None:
        row.status = int(ViEntitlementStatus.REALIZED)
        # validity_date must reflect the actual flight date, not the archiving
        # date passed here — take the latest linked flight when there are several.
        max_flight_date = await _max_linked_flight_date(db, entitlement_uuid)
        row.validity_date = max_flight_date or realisation_date
    elif row.scheduled_date is not None:
        row.status = int(ViEntitlementStatus.SCHEDULED)
    else:
        row.status = int(ViEntitlementStatus.LOADED)
    row.updated_by = user_id
    await db.commit()
    await db.refresh(row, attribute_names=["vi_type"])
    return row


async def patch_vi_notes(
    db: AsyncSession,
    entitlement_uuid: UUID,
    notes: str | None,
    user_id: int | None,
) -> ViEntitlement:
    row = await get_vi_entitlement(db, entitlement_uuid)
    row.notes = notes
    row.updated_by = user_id
    await db.commit()
    await db.refresh(row, attribute_names=["vi_type"])
    return row


async def bulk_schedule_vi(
    db: AsyncSession,
    entitlement_uuids: list[UUID],
    scheduled_date: date | None,
    user_id: int | None,
) -> dict[str, int]:
    if not entitlement_uuids:
        return {"updated_count": 0}

    result = await db.execute(select(ViEntitlement).where(ViEntitlement.uuid.in_(entitlement_uuids)))
    rows = list(result.scalars().all())
    by_uuid = {row.uuid for row in rows}
    missing = [value for value in entitlement_uuids if value not in by_uuid]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Some VI entitlements were not found", "missing": [str(value) for value in missing]},
        )

    updated_count = 0
    for row in rows:
        _assert_date_consistency(scheduled_date, row.realisation_date)
        row.scheduled_date = scheduled_date
        if row.status in (int(ViEntitlementStatus.LOADED), int(ViEntitlementStatus.SCHEDULED)):
            row.status = int(ViEntitlementStatus.SCHEDULED if scheduled_date else ViEntitlementStatus.LOADED)
        row.updated_by = user_id
        updated_count += 1

    await db.commit()
    return {"updated_count": updated_count}


async def list_vi_staging(
    db: AsyncSession,
    status_filter: int | None = None,
) -> list[HelloAssoViStaging]:
    stmt = select(HelloAssoViStaging).order_by(HelloAssoViStaging.created_at.desc())
    if status_filter is not None:
        stmt = stmt.where(HelloAssoViStaging.status == status_filter)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def discard_vi_staging_row(db: AsyncSession, staging_uuid: UUID) -> HelloAssoViStaging:
    """Set a staging row status to 3 (discarded). Guard: must be status=1 (staged)."""
    result = await db.execute(select(HelloAssoViStaging).where(HelloAssoViStaging.uuid == staging_uuid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staging row not found")
    if row.status != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot discard staging row with status {row.status} (must be 1=staged)",
        )
    row.status = 3
    await db.commit()
    return row


async def preview_staging_net_new(
    db: AsyncSession,
    records: list[HelloAssoPurchaseRecord],
    purchased_from_year: int = 2025,
) -> dict[str, int]:
    records = [r for r in records if r.date is None or r.date.year >= purchased_from_year]
    keys: list[int] = []
    for record in records:
        if record.item_id is not None:
            keys.append(record.item_id)

    if not keys:
        return {"fetched_count": len(records), "net_new_count": 0, "already_staged_count": 0}

    existing_stmt = select(func.count()).select_from(HelloAssoViStaging).where(
        HelloAssoViStaging.item_id.in_(keys)
    )
    existing_count = int((await db.execute(existing_stmt)).scalar_one() or 0)
    return {
        "fetched_count": len(records),
        "net_new_count": max(len(keys) - existing_count, 0),
        "already_staged_count": existing_count,
    }


async def import_helloasso_records_to_staging(
    db: AsyncSession,
    records: list[HelloAssoPurchaseRecord],
    purchased_from_year: int = 2025,
) -> dict[str, int]:
    records = [r for r in records if r.date is None or r.date.year >= purchased_from_year]
    if not records:
        total_stmt = select(func.count()).select_from(HelloAssoViStaging)
        return {
            "fetched_count": 0,
            "created_count": 0,
            "duplicate_count": 0,
            "staging_total_count": int((await db.execute(total_stmt)).scalar_one() or 0),
        }

    keys: list[int] = []
    candidates: list[dict[str, Any]] = []

    for record in records:
        if record.item_id is None:
            continue
        key = record.item_id
        keys.append(key)
        candidates.append({"key": key, "record": record})

    if not keys:
        total_stmt = select(func.count()).select_from(HelloAssoViStaging)
        return {
            "fetched_count": len(records),
            "created_count": 0,
            "duplicate_count": 0,
            "staging_total_count": int((await db.execute(total_stmt)).scalar_one() or 0),
        }

    existing_result = await db.execute(
        select(HelloAssoViStaging.item_id).where(HelloAssoViStaging.item_id.in_(keys))
    )
    existing_keys = {row[0] for row in existing_result.all()}

    created_count = 0
    duplicate_count = 0

    for candidate in candidates:
        key = candidate["key"]
        record = candidate["record"]

        if key in existing_keys:
            duplicate_count += 1
            continue

        staging = HelloAssoViStaging(
            item_id=record.item_id,
            full_name=record.full_name,
            email=record.email,
            phone=record.phone,
            amount_cents=record.amount_cents,
            form_slug=record.form_slug,
            purchased_at=record.date,
            status=1,
            raw_payload=record.model_dump(mode="json"),
        )
        db.add(staging)
        existing_keys.add(key)
        created_count += 1

    await db.commit()

    total_stmt = select(func.count()).select_from(HelloAssoViStaging)
    total_count = int((await db.execute(total_stmt)).scalar_one() or 0)

    return {
        "fetched_count": len(records),
        "created_count": created_count,
        "duplicate_count": duplicate_count,
        "staging_total_count": total_count,
    }


async def promote_staging_rows_to_entitlements(
    db: AsyncSession,
    staging_uuids: list[UUID],
    vi_type_uuid: UUID | None,
    user_id: int | None,
) -> dict[str, Any]:
    if not staging_uuids:
        return {
            "selected_count": 0,
            "promoted_count": 0,
            "already_promoted_count": 0,
            "failed_count": 0,
            "promoted_entitlement_uuids": [],
        }

    if vi_type_uuid is None:
        vi_type_result = await db.execute(select(ViTypeCatalog).where(ViTypeCatalog.code == "VI"))
        vi_type = vi_type_result.scalar_one_or_none()
        if vi_type is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Default VI type is missing")
        vi_type_uuid = vi_type.uuid
        vi_type_code = vi_type.code
    else:
        vi_type_result = await db.execute(select(ViTypeCatalog).where(ViTypeCatalog.uuid == vi_type_uuid))
        vi_type = vi_type_result.scalar_one_or_none()
        if vi_type is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown VI type")
        vi_type_code = vi_type.code

    rows_result = await db.execute(select(HelloAssoViStaging).where(HelloAssoViStaging.uuid.in_(staging_uuids)))
    rows = list(rows_result.scalars().all())

    found = {row.uuid for row in rows}
    missing = [value for value in staging_uuids if value not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Some staging rows were not found", "missing": [str(value) for value in missing]},
        )

    promoted_count = 0
    already_promoted_count = 0
    failed_count = 0
    promoted_entitlement_uuids: list[UUID] = []

    for row in rows:
        if row.promoted_vi_uuid is not None or row.status == 2:
            # Already promoted — backfill amount_ttc if the entitlement still has none
            if row.promoted_vi_uuid is not None and row.amount_cents is not None:
                ent_result = await db.execute(
                    select(ViEntitlement).where(ViEntitlement.uuid == row.promoted_vi_uuid)
                )
                ent = ent_result.scalar_one_or_none()
                if ent is not None and ent.amount_ttc is None:
                    ent.amount_ttc = Decimal(row.amount_cents) / 100
            already_promoted_count += 1
            continue

        code = _normalize_code(f"HA-{row.item_id}")
        existing_entitlement_result = await db.execute(select(ViEntitlement).where(ViEntitlement.code == code))
        existing_entitlement = existing_entitlement_result.scalar_one_or_none()

        if existing_entitlement is None:
            # Compute validity_date: purchased_at + 1 year (date only, no time)
            computed_validity: date | None = None
            if row.purchased_at is not None:
                computed_validity = row.purchased_at.date() + timedelta(days=365)

            entitlement = ViEntitlement(
                code=code,
                vi_type_uuid=vi_type_uuid,
                description=f"{vi_type_code} - {row.full_name}" if row.full_name else vi_type_code,
                validity_date=computed_validity,
                scheduled_date=None,
                realisation_date=None,
                partner_code=None,
                origin_type=int(ViOriginType.HELLOASSO),
                origin_ref=f"item:{row.item_id}",
                notes=row.phone,
                status=int(ViEntitlementStatus.LOADED),
                amount_ttc=Decimal(row.amount_cents) / 100 if row.amount_cents is not None else None,
                updated_by=user_id,
            )
            db.add(entitlement)
            await db.flush()
            promoted_uuid = entitlement.uuid
        else:
            promoted_uuid = existing_entitlement.uuid
            if existing_entitlement.amount_ttc is None and row.amount_cents is not None:
                existing_entitlement.amount_ttc = Decimal(row.amount_cents) / 100

        row.promoted_vi_uuid = promoted_uuid
        row.promoted_at = datetime.now(timezone.utc)
        row.status = 2

        promoted_entitlement_uuids.append(promoted_uuid)
        promoted_count += 1

    await db.commit()

    return {
        "selected_count": len(staging_uuids),
        "promoted_count": promoted_count,
        "already_promoted_count": already_promoted_count,
        "failed_count": failed_count,
        "promoted_entitlement_uuids": promoted_entitlement_uuids,
    }


# ── VI Flight Link CRUD ────────────────────────────────────────────────────

def _parse_duration_minutes(takeoff: str | None, landing: str | None) -> int | None:
    """Return flight duration in whole minutes from HH:MM strings, or None."""
    try:
        th, tm = (takeoff or "").split(":")
        lh, lm = (landing or "").split(":")
        start = int(th) * 60 + int(tm)
        end = int(lh) * 60 + int(lm)
        return end - start if end > start else None
    except (ValueError, TypeError, AttributeError):
        return None


async def list_vi_flight_links(db: AsyncSession, entitlement_uuid: UUID) -> list[ViFlightLink]:
    result = await db.execute(
        select(ViFlightLink)
        .options(joinedload(ViFlightLink.flight))
        .where(ViFlightLink.entitlement_uuid == entitlement_uuid)
        .order_by(ViFlightLink.sequence)
    )
    return list(result.unique().scalars().all())


async def add_vi_flight_link(
    db: AsyncSession,
    entitlement_uuid: UUID,
    flight_uuid: UUID,
    user_id: int,
) -> ViFlightLink:
    # Load entitlement with vi_type to check max_flights
    ent_result = await db.execute(
        select(ViEntitlement)
        .options(joinedload(ViEntitlement.vi_type))
        .where(ViEntitlement.uuid == entitlement_uuid)
    )
    entitlement = ent_result.unique().scalar_one_or_none()
    if entitlement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VI entitlement not found")

    max_flights = entitlement.vi_type.max_flights if entitlement.vi_type else 1

    # Count existing links
    count_result = await db.execute(
        select(func.count()).select_from(ViFlightLink).where(ViFlightLink.entitlement_uuid == entitlement_uuid)
    )
    current_count = int(count_result.scalar_one() or 0)
    if current_count >= max_flights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Max flights ({max_flights}) already reached for this entitlement",
        )

    # Check flight exists
    flight_result = await db.execute(select(ValidatedFlight).where(ValidatedFlight.uuid == flight_uuid))
    flight = flight_result.scalar_one_or_none()
    if flight is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flight not found")

    # Check this flight is not already linked to any entitlement (one flight → one voucher)
    dup_result = await db.execute(
        select(func.count()).select_from(ViFlightLink).where(
            ViFlightLink.flight_uuid == flight_uuid,
        )
    )
    if int(dup_result.scalar_one() or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ce vol est déjà associé à un bon VI",
        )

    sequence = current_count + 1
    link = ViFlightLink(
        entitlement_uuid=entitlement_uuid,
        flight_uuid=flight_uuid,
        sequence=sequence,
    )
    db.add(link)
    # Load flight into link for response building
    link.flight = flight
    return link


async def remove_vi_flight_link(
    db: AsyncSession,
    entitlement_uuid: UUID,
    link_uuid: UUID,
) -> None:
    result = await db.execute(
        select(ViFlightLink).where(
            ViFlightLink.uuid == link_uuid,
            ViFlightLink.entitlement_uuid == entitlement_uuid,
        )
    )
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flight link not found")

    if link.analytical_entry_uuid is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot remove a flight link that has an analytical accounting entry — cancel the entry first",
        )

    await db.delete(link)
