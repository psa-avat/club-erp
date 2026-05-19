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

from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from models import HelloAssoViStaging, ViEntitlement, ViEntitlementStatus, ViOriginType, ViTypeCatalog
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


async def list_vi_types(db: AsyncSession, active_only: bool = False) -> list[ViTypeCatalog]:
    stmt = select(ViTypeCatalog)
    if active_only:
        stmt = stmt.where(ViTypeCatalog.is_active.is_(True))
    stmt = stmt.order_by(ViTypeCatalog.code)
    result = await db.execute(stmt)
    return list(result.scalars().all())


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
        updated_by=user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def get_vi_type(db: AsyncSession, type_uuid: UUID) -> ViTypeCatalog:
    result = await db.execute(select(ViTypeCatalog).where(ViTypeCatalog.uuid == type_uuid))
    row = result.scalar_one_or_none()
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

    row.updated_by = user_id
    await db.commit()
    await db.refresh(row)
    return row


async def list_vi_entitlements(
    db: AsyncSession,
    status_filter: int | None = None,
    type_uuid: UUID | None = None,
    scheduled_from: date | None = None,
    scheduled_to: date | None = None,
) -> list[ViEntitlement]:
    stmt = select(ViEntitlement).order_by(ViEntitlement.created_at.desc())

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
    result = await db.execute(select(ViEntitlement).where(ViEntitlement.uuid == entitlement_uuid))
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
        validity_date=payload.validity_date,
        scheduled_date=payload.scheduled_date,
        realisation_date=payload.realisation_date,
        partner_code=payload.partner_code,
        origin_type=payload.origin_type,
        origin_ref=payload.origin_ref,
        notes=payload.notes,
        status=payload.status,
        updated_by=user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
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
    if payload.scheduled_date is not None:
        row.scheduled_date = payload.scheduled_date
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

    _assert_date_consistency(row.scheduled_date, row.realisation_date)

    row.updated_by = user_id
    await db.commit()
    await db.refresh(row)
    return row


async def patch_vi_scheduled_date(
    db: AsyncSession,
    entitlement_uuid: UUID,
    scheduled_date: date | None,
    user_id: int | None,
) -> ViEntitlement:
    row = await get_vi_entitlement(db, entitlement_uuid)
    _assert_date_consistency(scheduled_date, row.realisation_date)
    row.scheduled_date = scheduled_date
    if row.status in (int(ViEntitlementStatus.LOADED), int(ViEntitlementStatus.SCHEDULED)):
        row.status = int(ViEntitlementStatus.SCHEDULED if scheduled_date else ViEntitlementStatus.LOADED)
    row.updated_by = user_id
    await db.commit()
    await db.refresh(row)
    return row


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
    elif row.scheduled_date is not None:
        row.status = int(ViEntitlementStatus.SCHEDULED)
    else:
        row.status = int(ViEntitlementStatus.LOADED)
    row.updated_by = user_id
    await db.commit()
    await db.refresh(row)
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
    await db.refresh(row)
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


async def preview_staging_net_new(
    db: AsyncSession,
    records: list[HelloAssoPurchaseRecord],
) -> dict[str, int]:
    keys: list[tuple[int, int, int]] = []
    for record in records:
        if record.order_id is None or record.item_id is None:
            continue
        payment_ids = record.payment_ids if record.payment_ids else [0]
        for payment_id in payment_ids:
            if isinstance(payment_id, int):
                keys.append((record.order_id, record.item_id, payment_id))

    if not keys:
        return {"fetched_count": len(records), "net_new_count": 0, "already_staged_count": 0}

    existing_stmt = select(func.count()).select_from(HelloAssoViStaging).where(
        tuple_(HelloAssoViStaging.order_id, HelloAssoViStaging.item_id, HelloAssoViStaging.payment_id).in_(keys)
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
) -> dict[str, int]:
    if not records:
        total_stmt = select(func.count()).select_from(HelloAssoViStaging)
        return {
            "fetched_count": 0,
            "created_count": 0,
            "duplicate_count": 0,
            "staging_total_count": int((await db.execute(total_stmt)).scalar_one() or 0),
        }

    keys: list[tuple[int, int, int]] = []
    candidates: list[dict[str, Any]] = []

    for record in records:
        if record.order_id is None or record.item_id is None:
            continue
        payment_ids = record.payment_ids if record.payment_ids else [0]
        for payment_id in payment_ids:
            if not isinstance(payment_id, int):
                continue
            key = (record.order_id, record.item_id, payment_id)
            keys.append(key)
            candidates.append(
                {
                    "key": key,
                    "record": record,
                    "payment_id": payment_id,
                }
            )

    if not keys:
        total_stmt = select(func.count()).select_from(HelloAssoViStaging)
        return {
            "fetched_count": len(records),
            "created_count": 0,
            "duplicate_count": 0,
            "staging_total_count": int((await db.execute(total_stmt)).scalar_one() or 0),
        }

    existing_result = await db.execute(
        select(
            HelloAssoViStaging.order_id,
            HelloAssoViStaging.item_id,
            HelloAssoViStaging.payment_id,
        ).where(tuple_(HelloAssoViStaging.order_id, HelloAssoViStaging.item_id, HelloAssoViStaging.payment_id).in_(keys))
    )
    existing_keys = set(existing_result.all())

    created_count = 0
    duplicate_count = 0

    for candidate in candidates:
        key = candidate["key"]
        record = candidate["record"]
        payment_id = candidate["payment_id"]

        if key in existing_keys:
            duplicate_count += 1
            continue

        staging = HelloAssoViStaging(
            order_id=record.order_id,
            item_id=record.item_id,
            payment_id=payment_id,
            full_name=record.full_name,
            email=record.email,
            phone=record.phone,
            amount_cents=record.amount_cents,
            campaign_type=record.campaign_type,
            form_slug=record.form_slug,
            payment_state=record.payment_state,
            item_state=record.item_state,
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
    else:
        vi_type_result = await db.execute(select(ViTypeCatalog).where(ViTypeCatalog.uuid == vi_type_uuid))
        if vi_type_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown VI type")

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
            already_promoted_count += 1
            continue

        code = _normalize_code(f"HA-{row.order_id}-{row.item_id}-{row.payment_id}")
        existing_entitlement_result = await db.execute(select(ViEntitlement).where(ViEntitlement.code == code))
        existing_entitlement = existing_entitlement_result.scalar_one_or_none()

        if existing_entitlement is None:
            entitlement = ViEntitlement(
                code=code,
                vi_type_uuid=vi_type_uuid,
                description=row.full_name,
                validity_date=None,
                scheduled_date=None,
                realisation_date=None,
                partner_code=None,
                origin_type=int(ViOriginType.HELLOASSO),
                origin_ref=f"order:{row.order_id}|item:{row.item_id}|payment:{row.payment_id}",
                notes=row.phone,
                status=int(ViEntitlementStatus.LOADED),
                updated_by=user_id,
            )
            db.add(entitlement)
            await db.flush()
            promoted_uuid = entitlement.uuid
        else:
            promoted_uuid = existing_entitlement.uuid

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
