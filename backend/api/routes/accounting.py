"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Accounting module routes
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
import logging
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, status, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_PRICES, CAP_MANAGE_SYSTEM_SETTINGS, CAP_POST_ACCOUNTING_ENTRIES, CAP_VIEW_FINANCIALS
from models import AccountingAccount, AccountingEntry, AccountingFiscalYear, User, FlightBillingSettings
from schemas.accounting import (
    AccountBalanceResponse,
    AccountingEntriesBulkPostRequest,
    AccountingEntryCreateRequest,
    AccountingEntryTemplateCreateRequest,
    AccountingEntryTemplateGenerateRequest,
    AccountingEntryTemplateGenerateResponse,
    AccountingEntryTemplateGenerateDueResponse,
    AccountingEntryTemplatePreviewResponse,
    AccountingEntryTemplateResponse,
    AccountingEntryTemplateUpdateRequest,
    AccountingEntryPostRequest,
    AccountingEntryReverseRequest,
    AccountingEntryResponse,
    AccountingEntryUpdateRequest,
    AccountResponse,
    CopyCostProvisionRulesRequest,
    CopyCostProvisionRulesResponse,
    FiscalYearCreateRequest,
    FiscalYearResponse,
    JournalResponse,
    PricingItemCreateRequest,
    PricingItemResponse,
    PricingItemTierCreate,
    PricingItemUpdateRequest,
    PricingVersionCreateRequest,
    PricingVersionCloneRequest,
    PricingVersionResponse,
    PricingVersionUpdateRequest,
    SeedPcgResponse,
    PcgSeedExportResponse,
    PcgSeedImportRequest,
    AccountingImportPreviewResponse,
    AccountingImportApplyResponse,
    SystemSettingResponse,
    SystemSettingUpdateRequest,
)
from services.accounting import (
    close_fiscal_year,
    copy_cost_provision_rules_from_year,
    clone_pricing_version,
    get_account_balances,
    create_accounting_entry,
    count_accounting_entries,
    delete_accounting_entry,
    create_accounting_entry_template,
    create_fiscal_year,
    create_pricing_item,
    create_pricing_version,
    create_reversal_entry,
    delete_accounting_entry_template,
    delete_pricing_item,
    delete_pricing_version,
    get_system_setting,
    get_pricing_item,
    get_accounting_entry,
    get_accounting_entry_template,
    get_pricing_version,
    list_accounts,
    list_accounting_entries,
    list_accounting_entry_templates,
    get_active_fiscal_year,
    list_fiscal_years,
    list_journals,
    list_pricing_items,
    list_pricing_versions,
    list_system_settings,
    post_accounting_entry,
    post_accounting_entries_batch,
    reopen_fiscal_year,
    seed_association_pcg_accounts,
    export_pcg_seed,
    import_pcg_seed,
    validate_pcg_seed_items,
    upsert_system_setting,
    update_pricing_item,
    update_pricing_version,
    update_accounting_entry,
    update_accounting_entry_template,
    _replace_pricing_item_tiers,
    preview_accounting_import,
    apply_accounting_import,
)
from services.scheduled_entries import (
    generate_entry,
    generate_due_entries,
    preview_generation,
)

router = APIRouter(prefix="/api/v1/accounting", tags=["accounting"])
logger = logging.getLogger(__name__)

view_guard = Depends(require_capability(CAP_VIEW_FINANCIALS))
post_guard = Depends(require_capability(CAP_POST_ACCOUNTING_ENTRIES))
settings_guard = Depends(require_capability(CAP_MANAGE_SYSTEM_SETTINGS))
prices_guard = Depends(require_capability(CAP_MANAGE_PRICES))

FISCAL_YEAR_VALIDATION_ERRORS = {
    404: {
        "description": "Fiscal year not found",
        "content": {
            "application/json": {
                "example": {"detail": "Fiscal year 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found"}
            }
        },
    },
    409: {
        "description": "Invalid fiscal year transition",
        "content": {
            "application/json": {
                "examples": {
                    "already_closed": {"value": {"detail": "Fiscal year FY2026 is already closed"}},
                    "reopen_only_closed": {
                        "value": {"detail": "Can only reopen a closed fiscal year (state=2), current=1"}
                    },
                }
            }
        },
    },
}

ENTRY_VALIDATION_ERRORS = {
    400: {
        "description": "Posting/date/balance validation failed",
        "content": {
            "application/json": {
                "examples": {
                    "date_out_of_range": {
                        "value": {
                            "detail": "Entry date 2027-01-01 is outside fiscal year [2026-01-01, 2026-12-31]"
                        }
                    },
                    "unbalanced": {
                        "value": {"detail": "Entry is not balanced: debit=10.0000 != credit=9.0000"}
                    },
                }
            }
        },
    },
    404: {
        "description": "Resource not found",
        "content": {
            "application/json": {
                "examples": {
                    "entry_not_found": {
                        "value": {
                            "detail": "Entry 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found in fiscal year 3fa85f64-5717-4562-b3fc-2c963f66afa6"
                        }
                    },
                    "fiscal_year_not_found": {
                        "value": {"detail": "Fiscal year 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found"}
                    },
                }
            }
        },
    },
    409: {
        "description": "State/fiscal-year conflict",
        "content": {
            "application/json": {
                "examples": {
                    "closed_year": {"value": {"detail": "Cannot post entry into closed fiscal year FY2026"}},
                    "not_draft": {"value": {"detail": "Entry is not in Draft state (state=2)"}},
                    "update_not_draft": {"value": {"detail": "Cannot update entry in state 2 (Draft only)"}},
                }
            }
        },
    },
}

PRICING_VALIDATION_ERRORS = {
    400: {
        "description": "Date/fiscal-year validation failed",
        "content": {
            "application/json": {
                "examples": {
                    "invalid_range": {
                        "value": {"detail": "to_date must be greater than or equal to from_date"}
                    },
                    "outside_fiscal_year": {
                        "value": {
                            "detail": "from_date 2027-01-01 is outside fiscal year [2026-01-01, 2026-12-31]"
                        }
                    },
                }
            }
        },
    },
    409: {
        "description": "Pricing date overlap conflict",
        "content": {
            "application/json": {
                "example": {
                    "detail": "Pricing version date range overlaps with existing version 3fa85f64-5717-4562-b3fc-2c963f66afa6 [2026-01-01, 2026-12-31]"
                }
            }
        },
    },
}


def _log_accounting_audit(action: str, user_id: int, **context) -> None:
    """Emit audit-style log lines for privileged accounting actions."""
    safe_context = " ".join(f"{key}={value}" for key, value in context.items())
    logger.info("[ACCOUNTING_AUDIT] action=%s user_id=%s %s", action, user_id, safe_context)


@router.post("/fiscal-years", response_model=FiscalYearResponse, status_code=status.HTTP_201_CREATED)
async def create_fiscal_year_endpoint(
    request: FiscalYearCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Create a new fiscal year."""
    fy = await create_fiscal_year(db, request)
    _log_accounting_audit(
        action="create_fiscal_year",
        user_id=current_user.id,
        fiscal_year_uuid=fy.uuid,
        fiscal_year_code=fy.code,
    )
    return fy


@router.get("/fiscal-years", response_model=list[FiscalYearResponse])
async def list_fiscal_years_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100,
):
    """List all fiscal years."""
    fiscal_years = await list_fiscal_years(db, skip=skip, limit=limit)
    return fiscal_years


@router.get("/fiscal-years/active", response_model=FiscalYearResponse)
async def get_active_fiscal_year_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """Return the currently open fiscal year, or the most recent one if none is open."""
    return await get_active_fiscal_year(db)


@router.patch(
    "/fiscal-years/{fiscal_year_uuid}/close",
    response_model=FiscalYearResponse,
    responses=FISCAL_YEAR_VALIDATION_ERRORS,
)
async def close_fiscal_year_endpoint(
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Close a fiscal year and block new posting operations."""
    fy = await close_fiscal_year(db, fiscal_year_uuid, current_user.id)
    _log_accounting_audit(
        action="close_fiscal_year",
        user_id=current_user.id,
        fiscal_year_uuid=fy.uuid,
        fiscal_year_code=fy.code,
        state=fy.state,
    )
    return fy


@router.patch(
    "/fiscal-years/{fiscal_year_uuid}/reopen",
    response_model=FiscalYearResponse,
    responses=FISCAL_YEAR_VALIDATION_ERRORS,
)
async def reopen_fiscal_year_endpoint(
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Reopen a closed fiscal year."""
    fy = await reopen_fiscal_year(db, fiscal_year_uuid)
    _log_accounting_audit(
        action="reopen_fiscal_year",
        user_id=current_user.id,
        fiscal_year_uuid=fy.uuid,
        fiscal_year_code=fy.code,
        state=fy.state,
    )
    return fy


@router.get("/accounts", response_model=list[AccountResponse])
async def list_accounts_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100,
):
    """List all accounts (chart of accounts)."""
    accounts = await list_accounts(db, skip=skip, limit=limit)
    return accounts


@router.post("/accounts/seed-pcg", response_model=SeedPcgResponse)
async def seed_pcg_accounts_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Seed/update the baseline French association PCG subset."""
    result = await seed_association_pcg_accounts(db)
    _log_accounting_audit(
        action="seed_pcg_accounts",
        user_id=current_user.id,
        inserted=result.get("inserted"),
        updated=result.get("updated"),
        total=result.get("total"),
    )
    return result


@router.get("/accounts/pcg-seed", response_model=PcgSeedExportResponse)
async def export_pcg_seed_endpoint(
    _: User = settings_guard,
):
    """Export the current PCG seed file as JSON."""
    items = export_pcg_seed()
    return {"items": items, "total": len(items)}


@router.put("/accounts/pcg-seed", response_model=PcgSeedExportResponse)
async def import_pcg_seed_endpoint(
    request: PcgSeedImportRequest,
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Replace the PCG seed file with the provided items."""
    items_payload = [item.model_dump() for item in request.items]
    validation_errors = validate_pcg_seed_items(items_payload)
    if validation_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"errors": validation_errors},
        )
    import_pcg_seed(items_payload)
    _log_accounting_audit(
        action="import_pcg_seed",
        user_id=current_user.id,
        total=len(items_payload),
    )
    return {"items": items_payload, "total": len(items_payload)}


@router.get("/settings", response_model=list[SystemSettingResponse])
async def list_system_settings_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """List all module-scoped system settings."""
    return await list_system_settings(db)


from schemas.flight_billing import (
    CloseRemPeriodRequest,
    CloseRemPeriodResponse,
    FlightBillingSettingsDefaults,
    FlightBillingSettingsResponse,
    FlightBillingSettingsUpdate,
    RemAdjustmentApplyRequest,
    RemAdjustmentApplyResponse,
    RemAdjustmentPreviewRequest,
    RemAdjustmentPreviewResponse,
)
from services.flight_billing_apply import FlightBillingApplyService
from services.flight_billing_settings import (
    delete_flight_billing_settings,
    get_flight_billing_settings,
    get_flight_billing_settings_defaults,
    upsert_flight_billing_settings,
)
from services.flight_packs import (
    compute_rem_adjustment,
    get_member_pack_balance,
    list_consumptions_for_member,
)

billing_settings_guard = Depends(require_capability(CAP_MANAGE_PRICES))


@router.get("/settings/flight-billing", response_model=FlightBillingSettingsResponse)
async def get_flight_billing_settings_endpoint(
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = billing_settings_guard,
):
    """Get flight billing settings for a fiscal year."""
    return await get_flight_billing_settings(db, fiscal_year_uuid)


@router.put("/settings/flight-billing", response_model=FlightBillingSettingsResponse)
async def upsert_flight_billing_settings_endpoint(
    payload: FlightBillingSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = billing_settings_guard,
):
    """Create or update flight billing settings (typed, not JSON blob)."""
    return await upsert_flight_billing_settings(db, payload, current_user.id)


@router.delete("/settings/flight-billing", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flight_billing_settings_endpoint(
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = billing_settings_guard,
):
    """Reset flight billing settings to defaults (delete row)."""
    await delete_flight_billing_settings(db, fiscal_year_uuid)


@router.get("/settings/flight-billing/defaults", response_model=FlightBillingSettingsDefaults)
async def get_flight_billing_settings_defaults_endpoint(
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = billing_settings_guard,
):
    """Return sensible defaults for a new fiscal year (UI pre-fill)."""
    return await get_flight_billing_settings_defaults(db, fiscal_year_uuid)


# ── REM Adjustments ────────────────────────────────────────────────────────

post_guard = Depends(require_capability(CAP_POST_ACCOUNTING_ENTRIES))


@router.post("/rem-adjustments/preview", response_model=RemAdjustmentPreviewResponse)
async def preview_rem_adjustment(
    request: RemAdjustmentPreviewRequest,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """Preview REM adjustment for a member/period — list consumptions and total discount."""
    total_discount = await compute_rem_adjustment(
        db, request.member_uuid, request.fiscal_year_uuid,
        datetime.combine(request.period_start, datetime.min.time()),
        datetime.combine(request.period_end, datetime.max.time()),
    )
    consumptions = await list_consumptions_for_member(db, request.member_uuid)
    # Check if a Draft REM entry already exists
    from models import AccountingEntry
    existing = await db.execute(
        select(AccountingEntry).where(
            AccountingEntry.journal_uuid.in_(
                select(FlightBillingSettings.rem_journal_uuid).where(
                    FlightBillingSettings.fiscal_year_uuid == request.fiscal_year_uuid
                )
            ),
            AccountingEntry.fiscal_year_uuid == request.fiscal_year_uuid,
            AccountingEntry.state == 1,
            AccountingEntry.description.ilike(f"%{request.member_uuid}%"),
        )
    )
    existing_draft = existing.scalar_one_or_none()

    return RemAdjustmentPreviewResponse(
        member_uuid=request.member_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        period_start=request.period_start,
        period_end=request.period_end,
        total_discount=total_discount,
        consumptions=[
            {
                "consumption_uuid": c.uuid,
                "flight_uuid": c.flight_uuid,
                "pack_type": c.pack_type,
                "quantity_consumed": c.quantity_consumed,
                "discount_unit_price": c.discount_unit_price,
                "total_discount_amount": c.total_discount_amount,
            }
            for c in consumptions
        ],
        has_existing_draft=existing_draft is not None,
        existing_draft_entry_uuid=existing_draft.uuid if existing_draft else None,
    )


@router.post("/rem-adjustments/apply", response_model=RemAdjustmentApplyResponse)
async def apply_rem_adjustment(
    request: RemAdjustmentApplyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = post_guard,
):
    """Create or update the REM Draft entry for a member/period."""
    # Load settings to get REM journal and discount account
    settings_result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == request.fiscal_year_uuid
        )
    )
    settings = settings_result.scalar_one_or_none()
    if settings is None:
        raise HTTPException(status_code=400, detail="Flight billing settings not configured.")

    discount_account_uuid = settings.default_pack_discount_expense_account_uuid
    if discount_account_uuid is None:
        # Fallback to 658
        acct = await get_account_by_code(db, "658")
        if acct is None:
            raise HTTPException(status_code=500, detail="Default discount account 658 not found.")
        discount_account_uuid = acct.uuid
    else:
        acct = await db.get(AccountingAccount, discount_account_uuid)

    total_discount = await compute_rem_adjustment(
        db, request.member_uuid, request.fiscal_year_uuid,
        datetime.combine(request.period_start, datetime.min.time()),
        datetime.combine(request.period_end, datetime.max.time()),
    )

    entry = await upsert_rem_entry(
        db, request.member_uuid, request.fiscal_year_uuid,
        settings.rem_journal_uuid, discount_account_uuid,
        total_discount,
        datetime.combine(request.period_start, datetime.min.time()),
        datetime.combine(request.period_end, datetime.max.time()),
        current_user.id,
    )

    return RemAdjustmentApplyResponse(
        entry_uuid=entry.uuid,
        reference=entry.reference or "",
        description=entry.description or "",
        state=entry.state,
        total_discount=total_discount,
    )


@router.post("/rem-adjustments/close-period", response_model=CloseRemPeriodResponse)
async def close_rem_period_endpoint(
    request: CloseRemPeriodRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = post_guard,
):
    """Post all Draft REM entries for the period, opening new Drafts for next period."""
    service = FlightBillingApplyService(db)
    return await service.close_rem_period(
        request.fiscal_year_uuid, request.period_end, current_user.id
    )


@router.get("/settings/{module_name}", response_model=SystemSettingResponse)
async def get_system_setting_endpoint(
    module_name: str,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Get one module settings payload."""
    return await get_system_setting(db, module_name)


@router.put("/settings/{module_name}", response_model=SystemSettingResponse)
async def update_system_setting_endpoint(
    module_name: str,
    request: SystemSettingUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Create or update one module settings payload."""
    setting = await upsert_system_setting(db, module_name, request, current_user.id)
    _log_accounting_audit(
        action="upsert_system_setting",
        user_id=current_user.id,
        module_name=setting.module_name,
    )
    return setting

@router.get("/journals", response_model=list[JournalResponse])
async def list_journals_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100,
):
    """List all journals."""
    journals = await list_journals(db, skip=skip, limit=limit)
    return journals


@router.post(
    "/pricing/versions",
    response_model=PricingVersionResponse,
    status_code=status.HTTP_201_CREATED,
    responses=PRICING_VALIDATION_ERRORS,
)
async def create_pricing_version_endpoint(
    request: PricingVersionCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard, # This guard should be for MANAGE_PRICES
    current_user: User = Depends(get_current_user),
):
    """Create a pricing version for a fiscal year with non-overlapping dates.
    Optionally, link to an asset type for asset-specific pricing.
    """
    version = await create_pricing_version(db, request, current_user.id, request.asset_type_uuid)
    _log_accounting_audit(
        action="create_pricing_version",
        user_id=current_user.id,
        pricing_version_uuid=version.uuid,
        fiscal_year_uuid=version.fiscal_year_uuid,
    )
    return version


@router.post(
    "/pricing/versions/{version_uuid}/clone",
    response_model=PricingVersionResponse,
    status_code=status.HTTP_201_CREATED,
    responses=PRICING_VALIDATION_ERRORS,
)
async def clone_pricing_version_endpoint(
    version_uuid: UUID,
    request: PricingVersionCloneRequest,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Clone a pricing version into a new Draft version with copied items and tiers."""
    version = await clone_pricing_version(db, version_uuid, request, current_user.id)
    _log_accounting_audit(
        action="clone_pricing_version",
        user_id=current_user.id,
        source_pricing_version_uuid=version_uuid,
        cloned_pricing_version_uuid=version.uuid,
        fiscal_year_uuid=version.fiscal_year_uuid,
    )
    return version


@router.get("/pricing/versions", response_model=list[PricingVersionResponse])
async def list_pricing_versions_endpoint(
    fiscal_year_uuid: UUID | None = None,
    asset_type_uuid: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard, # This guard should be for MANAGE_PRICES
    current_user: User = Depends(get_current_user),
):
    """List pricing versions, optionally filtered by asset type."""
    return await list_pricing_versions(db, asset_type_uuid=asset_type_uuid)


@router.get("/pricing/versions/{version_uuid}", response_model=PricingVersionResponse)
async def get_pricing_version_endpoint(
    version_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Get one pricing version by UUID."""
    return await get_pricing_version(db, version_uuid)


@router.patch(
    "/pricing/versions/{version_uuid}",
    response_model=PricingVersionResponse,
    responses=PRICING_VALIDATION_ERRORS,
)
async def update_pricing_version_endpoint(
    version_uuid: UUID,
    request: PricingVersionUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard, # This guard should be for MANAGE_PRICES
    current_user: User = Depends(get_current_user),
):
    """Update one pricing version and enforce date overlap constraints.
    Can also update the associated asset type.
    """
    version = await update_pricing_version(db, version_uuid, request, request.asset_type_uuid)
    _log_accounting_audit(
        action="update_pricing_version",
        user_id=current_user.id,
        pricing_version_uuid=version.uuid,
        fiscal_year_uuid=version.fiscal_year_uuid,
    )
    return version


@router.delete("/pricing/versions/{version_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pricing_version_endpoint(
    version_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Delete one pricing version."""
    await delete_pricing_version(db, version_uuid)
    _log_accounting_audit(
        action="delete_pricing_version",
        user_id=current_user.id,
        pricing_version_uuid=version_uuid,
    )
    return None


@router.get("/pricing/versions/{version_uuid}/items", response_model=list[PricingItemResponse])
async def list_pricing_items_endpoint(
    version_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """List all pricing items for a pricing version."""
    return await list_pricing_items(db, version_uuid)


@router.post(
    "/pricing/versions/{version_uuid}/items",
    response_model=PricingItemResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_pricing_item_endpoint(
    version_uuid: UUID,
    request: PricingItemCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Add a pricing item to a (non-locked) pricing version."""
    return await create_pricing_item(db, version_uuid, request)


@router.patch("/pricing/items/{item_uuid}", response_model=PricingItemResponse)
async def update_pricing_item_endpoint(
    item_uuid: UUID,
    request: PricingItemUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Partially update a pricing item (version must not be locked)."""
    return await update_pricing_item(db, item_uuid, request)


@router.delete("/pricing/items/{item_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pricing_item_endpoint(
    item_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Delete a pricing item (version must not be locked)."""
    await delete_pricing_item(db, item_uuid)
    return None


@router.put(
    "/pricing/items/{item_uuid}/tiers",
    response_model=PricingItemResponse,
)
async def replace_pricing_item_tiers_endpoint(
    item_uuid: UUID,
    tiers: list[PricingItemTierCreate],
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Replace all progressive pricing brackets for an item (version must not be locked)."""
    item = await get_pricing_item(db, item_uuid)
    version = await get_pricing_version(db, item.pricing_version_uuid)
    if version.is_locked:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pricing version is locked.")
    await _replace_pricing_item_tiers(db, item, tiers)
    await db.commit()
    await db.refresh(item, ['tiers'])
    return item




@router.post(
    "/cost-provision-rules/copy",
    response_model=CopyCostProvisionRulesResponse,
    status_code=status.HTTP_201_CREATED,
)
async def copy_cost_provision_rules_endpoint(
    request: CopyCostProvisionRulesRequest,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Copy cost provision rules from a source fiscal year to a target fiscal year.

    Copied rules are set to inactive (is_active=False) so they can be reviewed
    before being activated. Rules already present in the target FY are skipped.
    """
    result = await copy_cost_provision_rules_from_year(
        db,
        source_fy_uuid=request.source_fiscal_year_uuid,
        target_fy_uuid=request.target_fiscal_year_uuid,
        user_id=current_user.id,
    )
    _log_accounting_audit(
        action="copy_cost_provision_rules",
        user_id=current_user.id,
        source_fiscal_year_uuid=request.source_fiscal_year_uuid,
        target_fiscal_year_uuid=request.target_fiscal_year_uuid,
        copied=result["copied"],
        skipped=result["skipped"],
    )
    return result


@router.post(
    "/entries",
    response_model=AccountingEntryResponse,
    status_code=status.HTTP_201_CREATED,
    responses=ENTRY_VALIDATION_ERRORS,
)
async def create_entry_endpoint(
    request: AccountingEntryCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Create a new accounting entry in Draft state."""
    entry = await create_accounting_entry(db, request, current_user.id)
    return entry


@router.get("/entries/count")
async def count_entries_endpoint(
    fiscal_year_uuid: UUID | None = None,
    journal_uuid: UUID | None = None,
    state: int | None = None,
    search: str | None = None,
    member_uuid: UUID | None = None,
    member: str | None = None,
    account_code: str | None = None,
    description: str | None = None,
    entry_date_from: date | None = None,
    entry_date_to: date | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
    null_tiers: bool | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """Return the total number of entries matching the given filters."""
    total = await count_accounting_entries(
        db,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
        state=state,
        search=search,
        member_uuid=member_uuid,
        member=member,
        account_code=account_code,
        description=description,
        entry_date_from=entry_date_from,
        entry_date_to=entry_date_to,
        amount_min=amount_min,
        amount_max=amount_max,
        null_tiers=null_tiers,
    )
    return {"total": total}


@router.get("/entries", response_model=list[AccountingEntryResponse])
async def list_entries_endpoint(
    fiscal_year_uuid: UUID | None = None,
    journal_uuid: UUID | None = None,
    state: int | None = None,
    search: str | None = None,
    member_uuid: UUID | None = None,
    member: str | None = None,
    account_code: str | None = None,
    description: str | None = None,
    entry_date_from: date | None = None,
    entry_date_to: date | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
    null_tiers: bool | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """List accounting entries for the ledger/journal screen."""
    return await list_accounting_entries(
        db,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
        state=state,
        search=search,
        member_uuid=member_uuid,
        member=member,
        account_code=account_code,
        description=description,
        entry_date_from=entry_date_from,
        entry_date_to=entry_date_to,
        amount_min=amount_min,
        amount_max=amount_max,
        null_tiers=null_tiers,
        limit=limit,
        offset=offset,
    )


@router.get("/entries/{entry_uuid}", response_model=AccountingEntryResponse, responses=ENTRY_VALIDATION_ERRORS)
async def get_entry_endpoint(
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
    current_user: User = Depends(get_current_user),
):
    """Retrieve an accounting entry by UUID."""
    entry = await get_accounting_entry(db, entry_uuid, fiscal_year_uuid)
    return entry


@router.delete("/entries/{entry_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry_endpoint(
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Delete a Draft or Cancelled accounting entry."""
    await delete_accounting_entry(db, entry_uuid, fiscal_year_uuid)
    _log_accounting_audit(
        action="delete_entry",
        user_id=current_user.id,
        entry_uuid=entry_uuid,
        fiscal_year_uuid=fiscal_year_uuid,
    )


@router.put("/entries/{entry_uuid}", response_model=AccountingEntryResponse, responses=ENTRY_VALIDATION_ERRORS)
async def update_entry_endpoint(
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    request: AccountingEntryUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Update a Draft accounting entry."""
    entry = await update_accounting_entry(db, entry_uuid, fiscal_year_uuid, request, current_user.id)
    return entry


@router.patch("/entries/{entry_uuid}/post", response_model=AccountingEntryResponse, responses=ENTRY_VALIDATION_ERRORS)
async def post_entry_endpoint(
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    request: AccountingEntryPostRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Post (lock) a Draft accounting entry."""
    entry = await post_accounting_entry(db, entry_uuid, fiscal_year_uuid)
    _log_accounting_audit(
        action="post_entry",
        user_id=current_user.id,
        entry_uuid=entry.uuid,
        fiscal_year_uuid=entry.fiscal_year_uuid,
        sequence_number=entry.sequence_number,
        state=entry.state,
    )
    return entry


@router.patch("/entries/post-bulk", response_model=list[AccountingEntryResponse], responses=ENTRY_VALIDATION_ERRORS)
async def post_entries_bulk_endpoint(
    request: AccountingEntriesBulkPostRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Post multiple Draft accounting entries in the same fiscal year."""
    entries = await post_accounting_entries_batch(
        db=db,
        fiscal_year_uuid=request.fiscal_year_uuid,
        entry_uuids=request.entry_uuids,
    )
    _log_accounting_audit(
        action="post_entries_batch",
        user_id=current_user.id,
        fiscal_year_uuid=request.fiscal_year_uuid,
        entry_count=len(entries),
    )
    return entries


@router.post("/entries/{entry_uuid}/reverse", response_model=AccountingEntryResponse, status_code=status.HTTP_201_CREATED)
async def reverse_entry_endpoint(
    entry_uuid: UUID,
    request: AccountingEntryReverseRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Create a reversal Draft entry from a Posted entry."""
    reversal_entry = await create_reversal_entry(
        db=db,
        entry_uuid=entry_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        reversal_reason=request.reversal_reason,
        user_id=current_user.id,
        entry_date=request.entry_date,
    )
    _log_accounting_audit(
        action="reverse_entry",
        user_id=current_user.id,
        entry_uuid=reversal_entry.uuid,
        fiscal_year_uuid=reversal_entry.fiscal_year_uuid,
        reversal_of_entry_uuid=reversal_entry.reversal_of_entry_uuid,
    )
    return reversal_entry


@router.get("/entry-models", response_model=list[AccountingEntryTemplateResponse])
async def list_entry_models_endpoint(
    journal_uuid: UUID | None = None,
    is_active: bool | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """List reusable recurring entry models."""
    return await list_accounting_entry_templates(db, journal_uuid=journal_uuid, is_active=is_active)


@router.get("/entry-models/{template_uuid}", response_model=AccountingEntryTemplateResponse)
async def get_entry_model_endpoint(
    template_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """Fetch one recurring entry model."""
    return await get_accounting_entry_template(db, template_uuid)


@router.post("/entry-models", response_model=AccountingEntryTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_entry_model_endpoint(
    request: AccountingEntryTemplateCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Create a recurring entry model."""
    template = await create_accounting_entry_template(db, request, current_user.id)
    _log_accounting_audit(action="create_entry_model", user_id=current_user.id, template_uuid=template.uuid)
    return template


@router.patch("/entry-models/{template_uuid}", response_model=AccountingEntryTemplateResponse)
async def update_entry_model_endpoint(
    template_uuid: UUID,
    request: AccountingEntryTemplateUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Update a recurring entry model."""
    template = await update_accounting_entry_template(db, template_uuid, request)
    _log_accounting_audit(action="update_entry_model", user_id=current_user.id, template_uuid=template.uuid)
    return template


@router.delete("/entry-models/{template_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry_model_endpoint(
    template_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Delete a recurring entry model."""
    await delete_accounting_entry_template(db, template_uuid)
    _log_accounting_audit(action="delete_entry_model", user_id=current_user.id, template_uuid=template_uuid)
    return None


# ---------------------------------------------------------------------------
# Recurring entries — Generate & Preview endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/entry-models/{template_uuid}/preview",
    response_model=AccountingEntryTemplatePreviewResponse,
)
async def preview_entry_model_generation_endpoint(
    template_uuid: UUID,
    request: AccountingEntryTemplateGenerateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """Preview entry generation from a template without persisting.

    Resolves the fiscal year at runtime. Returns calculated lines,
    totals, balance status, and warnings.
    """
    return await preview_generation(db, template_uuid, request.target_date)


@router.post(
    "/entry-models/{template_uuid}/generate",
    response_model=AccountingEntryTemplateGenerateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def generate_entry_model_endpoint(
    template_uuid: UUID,
    request: AccountingEntryTemplateGenerateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Generate a single accounting entry from a template.

    The fiscal year is resolved at runtime. If the entry already exists
    (deduplication by reference), returns it with was_already_generated=True.
    """
    entry, was_already = await generate_entry(db, template_uuid, request.target_date, current_user.id)
    return AccountingEntryTemplateGenerateResponse(
        entry_uuid=entry.uuid,
        reference=entry.reference,
        fiscal_year_uuid=entry.fiscal_year_uuid,
        state=entry.state,
        was_already_generated=was_already,
    )


@router.post(
    "/entry-models/generate-due",
    response_model=AccountingEntryTemplateGenerateDueResponse,
)
async def generate_due_entry_models_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Generate entries for ALL due templates at once.

    Each template resolves its own fiscal year at runtime.
    Returns a summary of generated, skipped, and errored entries.
    """
    return await generate_due_entries(db, current_user.id)


# ---------------------------------------------------------------------------
# Legacy CSV Import endpoints
# ---------------------------------------------------------------------------

@router.post("/entries/import/preview", response_model=AccountingImportPreviewResponse)
async def preview_entry_import_endpoint(
    file: UploadFile = File(...),
    fiscal_year_uuid: UUID = Form(...),
    journal_uuid: UUID = Form(...),
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
):
    """Preview a legacy CSV accounting import without persisting any entries."""
    content = await file.read()
    return await preview_accounting_import(
        db,
        content=content,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
    )


@router.post(
    "/entries/import",
    response_model=AccountingImportApplyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def apply_entry_import_endpoint(
    file: UploadFile = File(...),
    fiscal_year_uuid: UUID = Form(...),
    journal_uuid: UUID = Form(...),
    selected_keys: str = Form(...),
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Import selected entries from a legacy CSV as Draft accounting entries.

    ``selected_keys`` must be a JSON-encoded list of entry key strings returned
    by the preview endpoint (e.g. ``'["abc123...", "def456..."]'``).
    """
    import json as _json
    try:
        keys: list[str] = _json.loads(selected_keys)
        if not isinstance(keys, list):
            raise ValueError
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="selected_keys must be a JSON-encoded list of entry key strings",
        )
    content = await file.read()
    result = await apply_accounting_import(
        db,
        content=content,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
        selected_keys=keys,
        user_id=current_user.id,
    )
    _log_accounting_audit(
        action="csv_import",
        user_id=current_user.id,
        import_batch_id=result.import_batch_id,
        imported_count=result.imported_count,
    )
    return result


@router.get("/reports/account-balances", response_model=list[AccountBalanceResponse])
async def get_account_balances_endpoint(
    fiscal_year_uuid: UUID,
    posted_only: bool = True,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_capability(CAP_VIEW_FINANCIALS)),
):
    """Return aggregated debit/credit/balance per account for a fiscal year.

    Use ``posted_only=false`` to include draft entries as well.
    """
    return await get_account_balances(db, fiscal_year_uuid=fiscal_year_uuid, posted_only=posted_only)


