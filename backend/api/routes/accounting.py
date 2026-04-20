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
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user
from models import User
from schemas.accounting import (
    AccountingEntryCreateRequest,
    AccountingEntryPostRequest,
    AccountingEntryResponse,
    AccountingEntryUpdateRequest,
    AccountingLineResponse,
    AccountingLineCreateRequest,
    AccountResponse,
    FiscalYearCreateRequest,
    FiscalYearResponse,
    JournalResponse,
)
from services.accounting import (
    create_accounting_entry,
    create_fiscal_year,
    get_accounting_entry,
    get_or_create_fiscal_year,
    list_accounts,
    list_fiscal_years,
    list_journals,
    post_accounting_entry,
    update_accounting_entry,
)

router = APIRouter(prefix="/api/v1/accounting", tags=["accounting"])


@router.post("/fiscal-years", response_model=FiscalYearResponse, status_code=status.HTTP_201_CREATED)
async def create_fiscal_year_endpoint(
    request: FiscalYearCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new fiscal year."""
    fy = await create_fiscal_year(db, request)
    return fy


@router.get("/fiscal-years", response_model=list[FiscalYearResponse])
async def list_fiscal_years_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100,
):
    """List all fiscal years."""
    fiscal_years = await list_fiscal_years(db, skip=skip, limit=limit)
    return fiscal_years


@router.get("/accounts", response_model=list[AccountResponse])
async def list_accounts_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100,
):
    """List all accounts (chart of accounts)."""
    accounts = await list_accounts(db, skip=skip, limit=limit)
    return accounts


@router.get("/journals", response_model=list[JournalResponse])
async def list_journals_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100,
):
    """List all journals."""
    journals = await list_journals(db, skip=skip, limit=limit)
    return journals


@router.post("/entries", response_model=AccountingEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_entry_endpoint(
    request: AccountingEntryCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new accounting entry in Draft state."""
    entry = await create_accounting_entry(db, request, current_user.id)
    return entry


@router.get("/entries/{entry_uuid}", response_model=AccountingEntryResponse)
async def get_entry_endpoint(
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve an accounting entry by UUID."""
    entry = await get_accounting_entry(db, entry_uuid, fiscal_year_uuid)
    return entry


@router.put("/entries/{entry_uuid}", response_model=AccountingEntryResponse)
async def update_entry_endpoint(
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    request: AccountingEntryUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a Draft accounting entry."""
    entry = await update_accounting_entry(db, entry_uuid, fiscal_year_uuid, request, current_user.id)
    return entry


@router.patch("/entries/{entry_uuid}/post", response_model=AccountingEntryResponse)
async def post_entry_endpoint(
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    request: AccountingEntryPostRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Post (lock) a Draft accounting entry."""
    entry = await post_accounting_entry(db, entry_uuid, fiscal_year_uuid)
    return entry
