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
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_ACCOUNTING_SETTINGS, CAP_MANAGE_PRICES, CAP_POST_ACCOUNTING_ENTRIES, CAP_VIEW_FINANCIALS
from models import User
from schemas.accounting import (
    AccountingEntryCreateRequest,
    AccountingEntryPostRequest,
    AccountingEntryReverseRequest,
    AccountingEntryResponse,
    AccountingEntryUpdateRequest,
    AccountResponse,
    CopyCostProvisionRulesRequest,
    CopyCostProvisionRulesResponse,
    CopyPricingVersionsRequest,
    CopyPricingVersionsResponse,
    FiscalYearCreateRequest,
    FiscalYearResponse,
    JournalResponse,
    PricingItemCreateRequest,
    PricingItemResponse,
    PricingItemTierCreate,
    PricingItemUpdateRequest,
    PricingVersionCreateRequest,
    PricingVersionResponse,
    PricingVersionUpdateRequest,
    SeedPcgResponse,
    PcgSeedExportResponse,
    PcgSeedImportRequest,
    SystemSettingResponse,
    SystemSettingUpdateRequest,
)
from services.accounting import (
    close_fiscal_year,
    copy_cost_provision_rules_from_year,
    copy_pricing_versions_from_year,
    create_accounting_entry,
    create_fiscal_year,
    create_pricing_item,
    create_pricing_version,
    create_reversal_entry,
    delete_pricing_item,
    delete_pricing_version,
    get_system_setting,
    get_pricing_item,
    get_accounting_entry,
    get_pricing_version,
    list_accounts,
    list_fiscal_years,
    list_journals,
    list_pricing_items,
    list_pricing_versions,
    list_system_settings,
    post_accounting_entry,
    reopen_fiscal_year,
    seed_association_pcg_accounts,
    export_pcg_seed,
    import_pcg_seed,
    validate_pcg_seed_items,
    upsert_system_setting,
    update_pricing_item,
    update_pricing_version,
    update_accounting_entry,
    _replace_pricing_item_tiers,
)

router = APIRouter(prefix="/api/v1/accounting", tags=["accounting"])
logger = logging.getLogger(__name__)

view_guard = Depends(require_capability(CAP_VIEW_FINANCIALS))
post_guard = Depends(require_capability(CAP_POST_ACCOUNTING_ENTRIES))
settings_guard = Depends(require_capability(CAP_MANAGE_ACCOUNTING_SETTINGS))
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


@router.get("/pricing/versions", response_model=list[PricingVersionResponse])
async def list_pricing_versions_endpoint(
    fiscal_year_uuid: UUID | None = None,
    asset_type_uuid: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard, # This guard should be for MANAGE_PRICES
    current_user: User = Depends(get_current_user),
):
    """List pricing versions, optionally filtered by fiscal year and/or asset type."""
    return await list_pricing_versions(db, fiscal_year_uuid, asset_type_uuid)


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
    "/pricing/versions/copy",
    response_model=CopyPricingVersionsResponse,
    status_code=status.HTTP_201_CREATED,
)
async def copy_pricing_versions_endpoint(
    request: CopyPricingVersionsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = prices_guard,
    current_user: User = Depends(get_current_user),
):
    """Copy all pricing versions from a source fiscal year to a target fiscal year as Draft.

    Dates are shifted by the year difference. Overlapping versions are skipped.
    """
    result = await copy_pricing_versions_from_year(
        db,
        source_fy_uuid=request.source_fiscal_year_uuid,
        target_fy_uuid=request.target_fiscal_year_uuid,
        user_id=current_user.id,
    )
    _log_accounting_audit(
        action="copy_pricing_versions",
        user_id=current_user.id,
        source_fiscal_year_uuid=request.source_fiscal_year_uuid,
        target_fiscal_year_uuid=request.target_fiscal_year_uuid,
        copied=result["copied"],
        skipped=result["skipped"],
    )
    return result


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
    _: User = view_guard,
    current_user: User = Depends(get_current_user),
):
    """Create a new accounting entry in Draft state."""
    entry = await create_accounting_entry(db, request, current_user.id)
    return entry


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


@router.put("/entries/{entry_uuid}", response_model=AccountingEntryResponse, responses=ENTRY_VALIDATION_ERRORS)
async def update_entry_endpoint(
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    request: AccountingEntryUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
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
