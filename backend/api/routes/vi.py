"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: FastAPI routes for VI type catalog, entitlements, planning, and staging promotion
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

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_VI, CAP_PLAN_VI, CAP_POST_ACCOUNTING_ENTRIES
from models import AccountingEntry, AccountingLine, AccountingAccount, Member, User, ValidatedFlight, ViEntitlement, ViFlightLink, ViTypeCatalog
from schemas.vi import (
    HelloAssoViStagingResponse,
    ViBulkScheduleRequest,
    ViAccountingSummaryResponse,
    ViAccountingEntryRef,
    ViCancelRealizationRequest,
    ViConversionEntryRequest,
    ViEntitlementAmountPatch,
    ViEntitlementPayload,
    ViEntitlementResponse,
    ViEntitlementUpdateRequest,
    ViFlightLinkCreate,
    ViEntryLineDisplay,
    ViFlightLinkResponse,
    ViNotesPatchRequest,
    ViPlanningDatePatchRequest,
    ViPromotionRequest,
    ViPromotionResponse,
    ViPurchaseEntryRequest,
    ViRealizationEntryRequest,
    ViReimbursementEntryRequest,
    ViTypeCatalogPayload,
    ViTypeCatalogResponse,
    ViTypeCatalogUpdateRequest,
)
from services.vi import (
    add_vi_flight_link,
    bulk_schedule_vi,
    create_vi_entitlement,
    create_vi_type,
    get_vi_entitlement,
    get_vi_type,
    list_vi_entitlements,
    list_vi_flight_links,
    discard_vi_staging_row,
    list_vi_staging,
    list_vi_types,
    patch_vi_notes,
    patch_vi_realisation_date,
    patch_vi_scheduled_date,
    promote_staging_rows_to_entitlements,
    remove_vi_flight_link,
    update_vi_entitlement,
    update_vi_type,
)
from services.vi_accounting import (
    cancel_vi_realization_entry,
    create_vi_conversion_entry,
    create_vi_purchase_entry,
    create_vi_realization_entry,
    create_vi_reimbursement_entry,
)

router = APIRouter(prefix="/api/v1/vi", tags=["vi"])

_manage_guard = Depends(require_capability(CAP_MANAGE_VI))
_plan_guard = Depends(require_capability(CAP_PLAN_VI))


@router.get("/types", response_model=list[ViTypeCatalogResponse])
async def list_vi_types_endpoint(
    active_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    return await list_vi_types(db=db, active_only=active_only)


@router.post("/types", response_model=ViTypeCatalogResponse, status_code=201)
async def create_vi_type_endpoint(
    request: ViTypeCatalogPayload,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await create_vi_type(db=db, payload=request, user_id=current_user.id)


@router.get("/types/{type_uuid}", response_model=ViTypeCatalogResponse)
async def get_vi_type_endpoint(
    type_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    return await get_vi_type(db=db, type_uuid=type_uuid)


@router.patch("/types/{type_uuid}", response_model=ViTypeCatalogResponse)
async def update_vi_type_endpoint(
    type_uuid: UUID,
    request: ViTypeCatalogUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await update_vi_type(db=db, type_uuid=type_uuid, payload=request, user_id=current_user.id)


@router.get("/entitlements", response_model=list[ViEntitlementResponse])
async def list_vi_entitlements_endpoint(
    status_filter: int | None = Query(default=None, alias="status", ge=1, le=5),
    vi_type_uuid: UUID | None = Query(default=None),
    scheduled_from: date | None = Query(default=None),
    scheduled_to: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    rows = await list_vi_entitlements(
        db=db,
        status_filter=status_filter,
        type_uuid=vi_type_uuid,
        scheduled_from=scheduled_from,
        scheduled_to=scheduled_to,
    )
    return [
        ViEntitlementResponse(
            **{
                k: getattr(ent, k)
                for k in ViEntitlementResponse.model_fields
                if k not in ("vi_type_code", "flight_link_count", "linked_flight_count")
            },
            vi_type_code=ent.vi_type.code if ent.vi_type else None,
            flight_link_count=len(ent.flight_links),
            # Excludes reserved-but-unmatched slots (flight_uuid IS NULL) — used to flag
            # realized vouchers that were never actually attached to a real flight.
            linked_flight_count=sum(1 for link in ent.flight_links if link.flight_uuid is not None),
        )
        for ent in rows
    ]


@router.post("/entitlements", response_model=ViEntitlementResponse, status_code=201)
async def create_vi_entitlement_endpoint(
    request: ViEntitlementPayload,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await create_vi_entitlement(db=db, payload=request, user_id=current_user.id)


@router.get("/entitlements/{entitlement_uuid}", response_model=ViEntitlementResponse)
async def get_vi_entitlement_endpoint(
    entitlement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    return await get_vi_entitlement(db=db, entitlement_uuid=entitlement_uuid)


@router.patch("/entitlements/{entitlement_uuid}", response_model=ViEntitlementResponse)
async def update_vi_entitlement_endpoint(
    entitlement_uuid: UUID,
    request: ViEntitlementUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await update_vi_entitlement(
        db=db,
        entitlement_uuid=entitlement_uuid,
        payload=request,
        user_id=current_user.id,
    )


@router.patch("/entitlements/{entitlement_uuid}/scheduled-date", response_model=ViEntitlementResponse)
async def patch_vi_entitlement_scheduled_date_endpoint(
    entitlement_uuid: UUID,
    request: ViPlanningDatePatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    return await patch_vi_scheduled_date(
        db=db,
        entitlement_uuid=entitlement_uuid,
        scheduled_date=request.value,
        user_id=current_user.id,
    )


@router.patch("/entitlements/{entitlement_uuid}/realisation-date", response_model=ViEntitlementResponse)
async def patch_vi_entitlement_realisation_date_endpoint(
    entitlement_uuid: UUID,
    request: ViPlanningDatePatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    return await patch_vi_realisation_date(
        db=db,
        entitlement_uuid=entitlement_uuid,
        realisation_date=request.value,
        user_id=current_user.id,
    )


@router.patch("/entitlements/{entitlement_uuid}/notes", response_model=ViEntitlementResponse)
async def patch_vi_entitlement_notes_endpoint(
    entitlement_uuid: UUID,
    request: ViNotesPatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    return await patch_vi_notes(
        db=db,
        entitlement_uuid=entitlement_uuid,
        notes=request.notes,
        user_id=current_user.id,
    )


@router.post("/planning/bulk-schedule")
async def bulk_schedule_vi_endpoint(
    request: ViBulkScheduleRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    result = await bulk_schedule_vi(
        db=db,
        entitlement_uuids=request.entitlement_uuids,
        scheduled_date=request.scheduled_date,
        user_id=current_user.id,
    )
    return {"success": True, **result}


@router.get("/staging", response_model=list[HelloAssoViStagingResponse])
async def list_vi_staging_endpoint(
    status_filter: int | None = Query(default=None, alias="status", ge=1, le=3),
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    return await list_vi_staging(db=db, status_filter=status_filter)


@router.post("/staging/promote", response_model=ViPromotionResponse)
async def promote_vi_staging_endpoint(
    request: ViPromotionRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
    current_user: User = Depends(get_current_user),
):
    return await promote_staging_rows_to_entitlements(
        db=db,
        staging_uuids=request.staging_uuids,
        vi_type_uuid=request.vi_type_uuid,
        user_id=current_user.id,
    )


@router.post("/staging/{staging_uuid}/discard", response_model=HelloAssoViStagingResponse)
async def discard_vi_staging_endpoint(
    staging_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _manage_guard,
):
    return await discard_vi_staging_row(db=db, staging_uuid=staging_uuid)


# ── VI Accounting endpoints (Steps 2a+2b) ─────────────────────────────────

_accounting_guard = Depends(require_capability(CAP_POST_ACCOUNTING_ENTRIES))


def _parse_duration_minutes(takeoff: str | None, landing: str | None) -> int | None:
    try:
        th, tm = (takeoff or "").split(":")
        lh, lm = (landing or "").split(":")
        start = int(th) * 60 + int(tm)
        end = int(lh) * 60 + int(lm)
        return end - start if end > start else None
    except (ValueError, TypeError, AttributeError):
        return None


def _build_flight_link_response(link: ViFlightLink) -> ViFlightLinkResponse:
    flight = link.flight
    return ViFlightLinkResponse(
        uuid=link.uuid,
        entitlement_uuid=link.entitlement_uuid,
        flight_uuid=link.flight_uuid,
        sequence=link.sequence,
        analytical_entry_uuid=link.analytical_entry_uuid,
        analytical_state=None,  # loaded separately if needed
        notes=link.notes,
        flight_date=flight.jour if flight else None,
        aircraft_code=flight.asset_code if flight else None,
        duration_minutes=_parse_duration_minutes(
            flight.takeoff_time if flight else None,
            flight.landing_time if flight else None,
        ),
    )


@router.get("/entitlements/{entitlement_uuid}/accounting", response_model=ViAccountingSummaryResponse)
async def get_vi_accounting_summary(
    entitlement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    result = await db.execute(
        select(ViEntitlement)
        .options(
            joinedload(ViEntitlement.vi_type).options(
                joinedload(ViTypeCatalog.client_account),
                joinedload(ViTypeCatalog.revenue_account),
                joinedload(ViTypeCatalog.insurance_account),
            ),
            joinedload(ViEntitlement.buyer_member),
            joinedload(ViEntitlement.registered_member),
            joinedload(ViEntitlement.flight_links).joinedload(ViFlightLink.flight),
        )
        .where(ViEntitlement.uuid == entitlement_uuid)
    )
    ent = result.unique().scalar_one_or_none()
    if ent is None:
        from fastapi import HTTPException, status as http_status
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="VI entitlement not found")

    vi_type = ent.vi_type
    # Effective insurance: per-entitlement override takes priority over vi_type amount
    insurance_amount_override = Decimal(str(ent.insurance_amount_override)) if ent.insurance_amount_override is not None else None
    insurance_amount = insurance_amount_override if insurance_amount_override is not None else (
        Decimal(str(vi_type.insurance_amount)) if (vi_type and vi_type.insurance_amount) else None
    )
    flight_portion = (
        Decimal(str(ent.amount_ttc)) - insurance_amount
        if ent.amount_ttc is not None and insurance_amount is not None
        else (Decimal(str(ent.amount_ttc)) if ent.amount_ttc is not None else None)
    )

    async def _load_entry_ref(entry_uuid) -> ViAccountingEntryRef:
        entry_result = await db.execute(
            select(AccountingEntry)
            .options(joinedload(AccountingEntry.lines).joinedload(AccountingLine.account))
            .where(AccountingEntry.uuid == entry_uuid)
        )
        entry = entry_result.unique().scalar_one_or_none()
        if entry is None:
            return ViAccountingEntryRef()
        lines = [
            ViEntryLineDisplay(
                account_code=ln.account.code if ln.account else "?",
                account_name=ln.account.name if ln.account else None,
                debit=Decimal(str(ln.debit)),
                credit=Decimal(str(ln.credit)),
                description=ln.description,
            )
            for ln in entry.lines
        ]
        return ViAccountingEntryRef(
            entry_uuid=entry.uuid,
            fiscal_year_uuid=entry.fiscal_year_uuid,
            state=entry.state,
            entry_date=entry.entry_date,
            lines=lines,
        )

    realization_ref = await _load_entry_ref(ent.realization_entry_uuid) if ent.realization_entry_uuid else ViAccountingEntryRef()
    conversion_ref = await _load_entry_ref(ent.conversion_entry_uuid) if ent.conversion_entry_uuid else ViAccountingEntryRef()

    buyer_name: str | None = None
    if ent.buyer_member:
        buyer_name = f"{ent.buyer_member.first_name} {ent.buyer_member.last_name}".strip()

    registered_name: str | None = None
    if ent.registered_member:
        registered_name = f"{ent.registered_member.first_name} {ent.registered_member.last_name}".strip()

    sorted_links = sorted(ent.flight_links or [], key=lambda lk: lk.sequence)
    flight_link_responses = [_build_flight_link_response(lk) for lk in sorted_links]

    return ViAccountingSummaryResponse(
        entitlement_uuid=ent.uuid,
        entitlement_code=ent.code,
        vi_type_code=vi_type.code if vi_type else None,
        amount_ttc=Decimal(str(ent.amount_ttc)) if ent.amount_ttc is not None else None,
        insurance_amount=insurance_amount,
        insurance_amount_override=insurance_amount_override,
        flight_portion=flight_portion,
        buyer_member_uuid=ent.buyer_member_uuid,
        buyer_member_name=buyer_name,
        registered_member_uuid=ent.registered_member_uuid,
        registered_member_name=registered_name,
        is_generic=ent.is_generic,
        max_flights=vi_type.max_flights if vi_type else 1,
        flight_links=flight_link_responses,
        realization=realization_ref,
        conversion=conversion_ref,
    )


@router.patch("/entitlements/{entitlement_uuid}/accounting-meta", response_model=ViEntitlementResponse)
async def patch_vi_accounting_meta(
    entitlement_uuid: UUID,
    request: ViEntitlementAmountPatch,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ViEntitlement).where(ViEntitlement.uuid == entitlement_uuid)
    )
    ent = result.scalar_one_or_none()
    if ent is None:
        from fastapi import HTTPException, status as http_status
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="VI entitlement not found")

    if request.amount_ttc is not None:
        ent.amount_ttc = request.amount_ttc
    if request.buyer_member_uuid is not None:
        ent.buyer_member_uuid = request.buyer_member_uuid

    await db.commit()
    await db.refresh(ent, attribute_names=["vi_type"])
    return ent


@router.post("/entitlements/{entitlement_uuid}/realization-entry", response_model=ViAccountingSummaryResponse)
async def create_vi_realization_entry_endpoint(
    entitlement_uuid: UUID,
    request: ViRealizationEntryRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _accounting_guard,
    current_user: User = Depends(get_current_user),
):
    await create_vi_realization_entry(
        db=db,
        entitlement_uuid=entitlement_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        user_id=current_user.id,
        entry_date=request.entry_date,
    )
    await db.commit()
    db.expire_all()
    return await get_vi_accounting_summary(entitlement_uuid=entitlement_uuid, db=db, _=_)


@router.post("/entitlements/{entitlement_uuid}/cancel-realization-entry", response_model=ViAccountingSummaryResponse)
async def cancel_vi_realization_entry_endpoint(
    entitlement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _accounting_guard,
    current_user: User = Depends(get_current_user),
):
    await cancel_vi_realization_entry(
        db=db,
        entitlement_uuid=entitlement_uuid,
        fiscal_year_uuid=None,
        user_id=current_user.id,
    )
    await db.commit()
    db.expire_all()
    return await get_vi_accounting_summary(entitlement_uuid=entitlement_uuid, db=db, _=_)


@router.post("/entitlements/{entitlement_uuid}/conversion-entry", response_model=ViAccountingSummaryResponse)
async def create_vi_conversion_entry_endpoint(
    entitlement_uuid: UUID,
    request: ViConversionEntryRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _accounting_guard,
    current_user: User = Depends(get_current_user),
):
    """
    Step 4 – Convert VI buyer to member.

    Creates an OD entry (D 7067 [+ D 7069] + D 401 / C 411-member), sets the entitlement status
    to CONVERTED, then for each linked flight: unbills it (if in Draft/applied state)
    and sets charge_to_erp_id to the registered member's account_id so it can be
    re-billed manually from the flights module.
    """
    from services.flight_billing_apply import FlightBillingApplyService

    _, linked_flight_uuids = await create_vi_conversion_entry(
        db=db,
        entitlement_uuid=entitlement_uuid,
        registered_member_uuid=request.registered_member_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        user_id=current_user.id,
    )
    await db.commit()

    if linked_flight_uuids:
        member_result = await db.execute(
            select(Member).where(Member.uuid == request.registered_member_uuid)
        )
        member = member_result.scalar_one()
        billing_svc = FlightBillingApplyService(db)

        for flight_uuid in linked_flight_uuids:
            flight_result = await db.execute(
                select(ValidatedFlight).where(ValidatedFlight.uuid == flight_uuid)
            )
            flight = flight_result.scalar_one_or_none()
            if flight is None:
                continue
            if flight.billing_quote_state == "applied" and flight.accounting_entry_uuid is not None:
                try:
                    await billing_svc.unbill_flight(flight_uuid)  # commits internally
                except Exception:
                    logger.warning("VI conversion: could not unbill flight %s — skipping unbill", flight_uuid)
                    await db.rollback()
            # Reload flight after potential unbill commit, then update charge_to
            flight_result2 = await db.execute(
                select(ValidatedFlight).where(ValidatedFlight.uuid == flight_uuid)
            )
            flight2 = flight_result2.scalar_one_or_none()
            if flight2 is not None:
                flight2.charge_to_erp_id = member.account_id
                await db.commit()

    db.expire_all()
    return await get_vi_accounting_summary(entitlement_uuid=entitlement_uuid, db=db, _=_)


@router.post("/entitlements/{entitlement_uuid}/reimbursement-entry", response_model=ViEntitlementResponse)
async def create_vi_reimbursement_entry_endpoint(
    entitlement_uuid: UUID,
    request: ViReimbursementEntryRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _accounting_guard,
    current_user: User = Depends(get_current_user),
):
    """Create a reimbursement accounting entry (D 419 / C 512) and cancel the entitlement."""
    await create_vi_reimbursement_entry(
        db=db,
        entitlement_uuid=entitlement_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        bank_account_uuid=request.bank_account_uuid,
        amount_override=request.amount_ttc,
        notes=request.notes,
        user_id=current_user.id,
    )
    await db.commit()
    ent = await get_vi_entitlement(db=db, entitlement_uuid=entitlement_uuid)
    await db.refresh(ent, attribute_names=["vi_type"])
    return ent


@router.post("/entitlements/{entitlement_uuid}/purchase-entry", response_model=ViEntitlementResponse)
async def create_vi_purchase_entry_endpoint(
    entitlement_uuid: UUID,
    request: ViPurchaseEntryRequest,
    db: AsyncSession = Depends(get_db),
    _: User = _accounting_guard,
    current_user: User = Depends(get_current_user),
):
    """Create an encaissement entry (D Banque/Caisse / C 419) for the VI entitlement (Step 1)."""
    await create_vi_purchase_entry(
        db=db,
        entitlement_uuid=entitlement_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        bank_account_uuid=request.bank_account_uuid,
        entry_date=request.entry_date,
        amount_override=request.amount_ttc,
        notes=request.notes,
        user_id=current_user.id,
    )
    await db.commit()
    ent = await get_vi_entitlement(db=db, entitlement_uuid=entitlement_uuid)
    await db.refresh(ent, attribute_names=["vi_type"])
    return ent


# ── VI Flight Link endpoints ───────────────────────────────────────────────

@router.get("/entitlements/{entitlement_uuid}/flight-links", response_model=list[ViFlightLinkResponse])
async def list_vi_flight_links_endpoint(
    entitlement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
):
    links = await list_vi_flight_links(db=db, entitlement_uuid=entitlement_uuid)
    return [_build_flight_link_response(lk) for lk in links]


@router.post("/entitlements/{entitlement_uuid}/flight-links", response_model=ViAccountingSummaryResponse, status_code=201)
async def add_vi_flight_link_endpoint(
    entitlement_uuid: UUID,
    request: ViFlightLinkCreate,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    await add_vi_flight_link(
        db=db,
        entitlement_uuid=entitlement_uuid,
        flight_uuid=request.flight_uuid,
        user_id=current_user.id,
    )
    await db.commit()
    db.expire_all()
    return await get_vi_accounting_summary(entitlement_uuid=entitlement_uuid, db=db, _=_)


@router.delete("/entitlements/{entitlement_uuid}/flight-links/{link_uuid}", response_model=ViAccountingSummaryResponse)
async def remove_vi_flight_link_endpoint(
    entitlement_uuid: UUID,
    link_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _plan_guard,
    current_user: User = Depends(get_current_user),
):
    await remove_vi_flight_link(db=db, entitlement_uuid=entitlement_uuid, link_uuid=link_uuid)
    await db.commit()
    db.expire_all()
    return await get_vi_accounting_summary(entitlement_uuid=entitlement_uuid, db=db, _=_)
