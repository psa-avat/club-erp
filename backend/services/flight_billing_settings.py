"""
    ERP-CLUB - ERP pour Club de vol a voile 
    - Logiciel libre de gestion d'un club de vol a voile
    - flight_billing_settings: Typed CRUD for the flight_billing_settings table
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
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import FLIGHT_BILLING_CATEGORY_LABELS
from models import (
    AccountingAccount,
    AccountingFiscalYear,
    AccountingJournal,
    FlightBillingSettings,
    FlightTypeBillingAccount,
    Member,
)
from schemas.flight_billing import (
    FlightBillingSettingsDefaults,
    FlightBillingSettingsResponse,
    FlightBillingSettingsUpdate,
    FlightTypeBillingAccountResponse,
    FlightTypeBillingAccountsBulkUpsert,
)

logger = logging.getLogger(__name__)


async def get_flight_billing_settings(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
) -> FlightBillingSettingsResponse:
    """Get flight billing settings for a fiscal year."""
    result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flight billing settings not found for this fiscal year.",
        )
    return FlightBillingSettingsResponse.model_validate(settings)


async def upsert_flight_billing_settings(
    db: AsyncSession,
    payload: FlightBillingSettingsUpdate,
    user_id: int,
) -> FlightBillingSettingsResponse:
    """Create or update flight billing settings. Validates all FK references."""
    # Validate fiscal year exists
    fy_result = await db.execute(
        select(AccountingFiscalYear).where(AccountingFiscalYear.uuid == payload.fiscal_year_uuid)
    )
    if fy_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fiscal year {payload.fiscal_year_uuid} not found.",
        )

    # Validate all journal and account FKs
    await _validate_fk(db, AccountingJournal, payload.fl_journal_uuid, "FL journal")
    await _validate_fk(db, AccountingJournal, payload.vt_journal_uuid, "VT journal")
    await _validate_fk(db, AccountingJournal, payload.rem_journal_uuid, "REM journal")
    await _validate_fk(db, AccountingAccount, payload.receivable_account_uuid, "Receivable account")
    if payload.default_pack_sales_account_uuid:
        await _validate_fk(db, AccountingAccount, payload.default_pack_sales_account_uuid, "Pack sales account")
    if payload.default_pack_discount_expense_account_uuid:
        await _validate_fk(db, AccountingAccount, payload.default_pack_discount_expense_account_uuid, "Pack discount expense account")
    if payload.default_initiation_charge_account_uuid:
        await _validate_fk(db, AccountingAccount, payload.default_initiation_charge_account_uuid, "Initiation charge account")

    # Upsert
    result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == payload.fiscal_year_uuid
        )
    )
    settings = result.scalar_one_or_none()

    if settings is None:
        settings = FlightBillingSettings(
            fiscal_year_uuid=payload.fiscal_year_uuid,
            fl_journal_uuid=payload.fl_journal_uuid,
            receivable_account_uuid=payload.receivable_account_uuid,
            vt_journal_uuid=payload.vt_journal_uuid,
            default_pack_sales_account_uuid=payload.default_pack_sales_account_uuid,
            rem_journal_uuid=payload.rem_journal_uuid,
            default_pack_discount_expense_account_uuid=payload.default_pack_discount_expense_account_uuid,
            default_initiation_charge_account_uuid=payload.default_initiation_charge_account_uuid,
            rem_period_days=payload.rem_period_days,
            allow_post_purchase_recalculation=payload.allow_post_purchase_recalculation,
            max_days_for_post_purchase_discount=payload.max_days_for_post_purchase_discount,
            require_approval_for_late_discount=payload.require_approval_for_late_discount,
            updated_by=user_id,
        )
        db.add(settings)
    else:
        settings.fl_journal_uuid = payload.fl_journal_uuid
        settings.receivable_account_uuid = payload.receivable_account_uuid
        settings.vt_journal_uuid = payload.vt_journal_uuid
        settings.default_pack_sales_account_uuid = payload.default_pack_sales_account_uuid
        settings.rem_journal_uuid = payload.rem_journal_uuid
        settings.default_pack_discount_expense_account_uuid = payload.default_pack_discount_expense_account_uuid
        settings.default_initiation_charge_account_uuid = payload.default_initiation_charge_account_uuid
        settings.rem_period_days = payload.rem_period_days
        settings.allow_post_purchase_recalculation = payload.allow_post_purchase_recalculation
        settings.max_days_for_post_purchase_discount = payload.max_days_for_post_purchase_discount
        settings.require_approval_for_late_discount = payload.require_approval_for_late_discount
        settings.updated_by = user_id

    await db.commit()
    await db.refresh(settings)
    return FlightBillingSettingsResponse.model_validate(settings)


async def get_flight_billing_settings_defaults(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
) -> FlightBillingSettingsDefaults:
    """
    Return sensible defaults for a new fiscal year.
    Journals looked up by code (FL, VT, REM), accounts by code (411, 706, 658).
    """
    fl_journal = await _find_journal_by_code(db, "FL")
    vt_journal = await _find_journal_by_code(db, "VT")
    rem_journal = await _find_journal_by_code(db, "REM")
    receivable = await _find_account_by_code(db, "411")
    pack_sales = await _find_account_by_code(db, "706")
    discount_expense = await _find_account_by_code(db, "658")
    club_contra = await _find_account_by_code(db, "658")

    return FlightBillingSettingsDefaults(
        fiscal_year_uuid=fiscal_year_uuid,
        fl_journal_uuid=fl_journal.uuid if fl_journal else None,
        receivable_account_uuid=receivable.uuid if receivable else None,
        vt_journal_uuid=vt_journal.uuid if vt_journal else None,
        default_pack_sales_account_uuid=pack_sales.uuid if pack_sales else None,
        rem_journal_uuid=rem_journal.uuid if rem_journal else None,
        default_pack_discount_expense_account_uuid=discount_expense.uuid if discount_expense else None,
        default_initiation_charge_account_uuid=club_contra.uuid if club_contra else None,
    )


async def delete_flight_billing_settings(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
) -> None:
    """Reset (delete) flight billing settings for a fiscal year."""
    result = await db.execute(
        select(FlightBillingSettings).where(
            FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
        )
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flight billing settings not found.",
        )
    await db.delete(settings)
    await db.commit()


# ── Flight type billing accounts (club/entrainement/essai analytical override) ──


def _to_type_billing_account_response(row: FlightTypeBillingAccount) -> FlightTypeBillingAccountResponse:
    return FlightTypeBillingAccountResponse(
        uuid=row.uuid,
        fiscal_year_uuid=row.fiscal_year_uuid,
        billing_category=row.billing_category,
        billing_category_label=FLIGHT_BILLING_CATEGORY_LABELS.get(row.billing_category),
        member_uuid=row.member_uuid,
        analytical_cost_account_uuid=row.analytical_cost_account_uuid,
        analytical_cost_account_code=row.analytical_cost_account_code,
        analytical_reflection_account_uuid=row.analytical_reflection_account_uuid,
        analytical_reflection_account_code=row.analytical_reflection_account_code,
    )


async def list_flight_type_billing_accounts(
    db: AsyncSession,
    fiscal_year_uuid: UUID,
) -> list[FlightTypeBillingAccountResponse]:
    """List per-billing-category billing account rows for a fiscal year."""
    result = await db.execute(
        select(FlightTypeBillingAccount)
        .where(FlightTypeBillingAccount.fiscal_year_uuid == fiscal_year_uuid)
        .order_by(FlightTypeBillingAccount.billing_category.asc())
    )
    return [_to_type_billing_account_response(row) for row in result.scalars().all()]


async def upsert_flight_type_billing_accounts(
    db: AsyncSession,
    payload: FlightTypeBillingAccountsBulkUpsert,
    user_id: int,
) -> list[FlightTypeBillingAccountResponse]:
    """Create/update/clear the flight-type billing account rows for a fiscal year."""
    fy_result = await db.execute(
        select(AccountingFiscalYear).where(AccountingFiscalYear.uuid == payload.fiscal_year_uuid)
    )
    if fy_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fiscal year {payload.fiscal_year_uuid} not found.",
        )

    result = await db.execute(
        select(FlightTypeBillingAccount).where(
            FlightTypeBillingAccount.fiscal_year_uuid == payload.fiscal_year_uuid
        )
    )
    existing_by_category = {row.billing_category: row for row in result.scalars().all()}

    member_categories: dict[UUID, int] = {}

    for entry in payload.accounts:
        if entry.member_uuid:
            await _validate_fk(db, Member, entry.member_uuid, "Sentinel member")
            other_category = member_categories.get(entry.member_uuid)
            if other_category is not None and other_category != entry.billing_category:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This member is already assigned to another billing category.",
                )
            member_categories[entry.member_uuid] = entry.billing_category
        if entry.analytical_cost_account_uuid:
            await _validate_fk(db, AccountingAccount, entry.analytical_cost_account_uuid, "Analytical cost account")
        if entry.analytical_reflection_account_uuid:
            await _validate_fk(db, AccountingAccount, entry.analytical_reflection_account_uuid, "Analytical reflection account")

        row = existing_by_category.pop(entry.billing_category, None)
        is_empty = not (
            entry.member_uuid
            or entry.analytical_cost_account_uuid
            or entry.analytical_reflection_account_uuid
        )
        if is_empty:
            if row is not None:
                await db.delete(row)
            continue

        if row is None:
            row = FlightTypeBillingAccount(
                fiscal_year_uuid=payload.fiscal_year_uuid,
                billing_category=entry.billing_category,
            )
            db.add(row)
        row.member_uuid = entry.member_uuid
        row.analytical_cost_account_uuid = entry.analytical_cost_account_uuid
        row.analytical_reflection_account_uuid = entry.analytical_reflection_account_uuid
        row.updated_by = user_id

    await db.commit()
    return await list_flight_type_billing_accounts(db, payload.fiscal_year_uuid)


# ── Helpers ──────────────────────────────────────────────────────────────


async def _validate_fk(db: AsyncSession, model, uuid: UUID, label: str) -> None:
    result = await db.execute(select(model).where(model.uuid == uuid))
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{label} with UUID {uuid} not found.",
        )


async def _find_journal_by_code(db: AsyncSession, code: str) -> AccountingJournal | None:
    result = await db.execute(
        select(AccountingJournal).where(AccountingJournal.code == code)
    )
    return result.scalar_one_or_none()


async def _find_account_by_code(db: AsyncSession, code: str) -> AccountingAccount | None:
    result = await db.execute(
        select(AccountingAccount).where(AccountingAccount.code == code)
    )
    return result.scalar_one_or_none()
