"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Accounting module services
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
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from models import (
    AccountingAccount,
    AccountingEntry,
    AccountingFiscalYear,
    AccountingJournal,
    AccountingLine,
    User,
)
from schemas.accounting import (
    AccountingEntryCreateRequest,
    AccountingEntryUpdateRequest,
    AccountingLineCreateRequest,
    FiscalYearCreateRequest,
)


async def create_fiscal_year(
    db: AsyncSession,
    request: FiscalYearCreateRequest,
) -> AccountingFiscalYear:
    """Create a new fiscal year."""
    # Validate that year doesn't already exist
    existing = await db.execute(
        select(AccountingFiscalYear).where(AccountingFiscalYear.year == request.year)
    )
    if existing.scalar():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fiscal year {request.year} already exists",
        )
    
    # Validate that code is unique
    existing_code = await db.execute(
        select(AccountingFiscalYear).where(AccountingFiscalYear.code == request.code)
    )
    if existing_code.scalar():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fiscal year code {request.code} already exists",
        )
    
    # Validate date range
    if request.end_date <= request.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be after start_date",
        )
    
    # Create new fiscal year
    fy = AccountingFiscalYear(
        uuid=uuid4(),
        code=request.code,
        label=request.label,
        year=request.year,
        start_date=request.start_date,
        end_date=request.end_date,
        state=1,  # Open
    )
    
    db.add(fy)
    await db.commit()
    await db.refresh(fy)
    return fy


async def get_or_create_fiscal_year(db: AsyncSession, fiscal_year_uuid: UUID) -> AccountingFiscalYear:
    """Fetch a fiscal year by UUID; raise 404 if not found."""
    fy = await db.get(AccountingFiscalYear, fiscal_year_uuid)
    if not fy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fiscal year {fiscal_year_uuid} not found",
        )
    return fy


async def validate_fiscal_year_open(db: AsyncSession, fiscal_year_uuid: UUID) -> AccountingFiscalYear:
    """Ensure fiscal year exists and is open (state=1)."""
    fy = await get_or_create_fiscal_year(db, fiscal_year_uuid)
    if fy.state != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fiscal year {fy.code} is not open (state={fy.state})",
        )
    return fy


async def get_journal(db: AsyncSession, journal_uuid: UUID) -> AccountingJournal:
    """Fetch a journal by UUID; raise 404 if not found."""
    journal = await db.get(AccountingJournal, journal_uuid)
    if not journal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Journal {journal_uuid} not found",
        )
    return journal


async def get_account(db: AsyncSession, account_uuid: UUID) -> AccountingAccount:
    """Fetch an account by UUID; raise 404 if not found."""
    account = await db.get(AccountingAccount, account_uuid)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account {account_uuid} not found",
        )
    return account


async def validate_entry_date_in_fy(
    entry_date_val,
    fiscal_year: AccountingFiscalYear,
) -> None:
    """Ensure entry_date falls within fiscal year boundaries."""
    if entry_date_val < fiscal_year.start_date or entry_date_val > fiscal_year.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry date {entry_date_val} is outside fiscal year [{fiscal_year.start_date}, {fiscal_year.end_date}]",
        )


async def validate_entry_balance(lines_data: list[AccountingLineCreateRequest]) -> None:
    """Ensure entry is balanced: sum(debit) == sum(credit)."""
    total_debit = sum(line.debit for line in lines_data)
    total_credit = sum(line.credit for line in lines_data)
    if total_debit != total_credit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry is not balanced: debit={total_debit} != credit={total_credit}",
        )


async def create_accounting_entry(
    db: AsyncSession,
    request: AccountingEntryCreateRequest,
    user_id: int,
) -> AccountingEntry:
    """Create a new accounting entry in Draft state."""
    # Validate fiscal year
    fy = await validate_fiscal_year_open(db, request.fiscal_year_uuid)
    
    # Validate journal
    journal = await get_journal(db, request.journal_uuid)
    
    # Validate entry_date in fiscal year
    await validate_entry_date_in_fy(request.entry_date, fy)
    
    # Validate all accounts exist
    for line_req in request.lines:
        await get_account(db, line_req.account_uuid)
    
    # Validate balance
    await validate_entry_balance(request.lines)
    
    # Create entry
    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid,
        fiscal_year_uuid=request.fiscal_year_uuid,
        journal_uuid=request.journal_uuid,
        entry_date=request.entry_date,
        reference=request.reference,
        description=request.description,
        state=1,  # Draft
        source_system=request.source_system,
        external_id=request.external_id,
        import_batch_id=request.import_batch_id,
        created_by=user_id,
    )
    
    # Create lines
    for line_req in request.lines:
        line = AccountingLine(
            uuid=uuid4(),
            fiscal_year_uuid=request.fiscal_year_uuid,
            entry_uuid=entry_uuid,
            account_uuid=line_req.account_uuid,
            member_uuid=line_req.member_uuid,
            analytical_asset_uuid=line_req.analytical_asset_uuid,
            debit=line_req.debit,
            credit=line_req.credit,
            description=line_req.description,
            tax_code=line_req.tax_code,
            tax_rate=line_req.tax_rate,
            tax_base=line_req.tax_base,
            tax_amount=line_req.tax_amount,
        )
        entry.lines.append(line)
    
    db.add(entry)
    await db.commit()
    await db.refresh(entry, ["fiscal_year", "journal", "lines"])
    return entry


async def get_accounting_entry(
    db: AsyncSession,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
) -> AccountingEntry:
    """Fetch an accounting entry with its lines."""
    stmt = (
        select(AccountingEntry)
        .where(
            and_(
                AccountingEntry.uuid == entry_uuid,
                AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
            )
        )
        .options(
            joinedload(AccountingEntry.fiscal_year),
            joinedload(AccountingEntry.journal),
            joinedload(AccountingEntry.lines),
        )
    )
    entry = await db.scalar(stmt)
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entry {entry_uuid} not found in fiscal year {fiscal_year_uuid}",
        )
    return entry


async def update_accounting_entry(
    db: AsyncSession,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
    request: AccountingEntryUpdateRequest,
    user_id: int,
) -> AccountingEntry:
    """Update a Draft accounting entry."""
    entry = await get_accounting_entry(db, entry_uuid, fiscal_year_uuid)
    
    if entry.state != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot update entry in state {entry.state} (Draft only)",
        )
    
    # Fetch fiscal year once
    fy = entry.fiscal_year or await get_or_create_fiscal_year(db, fiscal_year_uuid)
    
    # Update scalar fields if provided
    if request.journal_uuid is not None:
        journal = await get_journal(db, request.journal_uuid)
        entry.journal_uuid = request.journal_uuid
    
    if request.entry_date is not None:
        await validate_entry_date_in_fy(request.entry_date, fy)
        entry.entry_date = request.entry_date
    
    if request.description is not None:
        entry.description = request.description
    
    if request.reference is not None:
        entry.reference = request.reference
    
    # Update lines if provided
    if request.lines is not None:
        # Validate all accounts
        for line_req in request.lines:
            await get_account(db, line_req.account_uuid)
        
        # Validate balance
        await validate_entry_balance(request.lines)
        
        # Delete old lines
        await db.execute(
            select(AccountingLine)
            .where(
                and_(
                    AccountingLine.entry_uuid == entry_uuid,
                    AccountingLine.fiscal_year_uuid == fiscal_year_uuid,
                )
            )
        )
        
        entry.lines.clear()
        
        # Create new lines
        for line_req in request.lines:
            line = AccountingLine(
                uuid=uuid4(),
                fiscal_year_uuid=fiscal_year_uuid,
                entry_uuid=entry_uuid,
                account_uuid=line_req.account_uuid,
                member_uuid=line_req.member_uuid,
                analytical_asset_uuid=line_req.analytical_asset_uuid,
                debit=line_req.debit,
                credit=line_req.credit,
                description=line_req.description,
                tax_code=line_req.tax_code,
                tax_rate=line_req.tax_rate,
                tax_base=line_req.tax_base,
                tax_amount=line_req.tax_amount,
            )
            entry.lines.append(line)
    
    await db.commit()
    await db.refresh(entry, ["fiscal_year", "journal", "lines"])
    return entry


async def post_accounting_entry(
    db: AsyncSession,
    entry_uuid: UUID,
    fiscal_year_uuid: UUID,
) -> AccountingEntry:
    """Post (lock) a Draft entry: validates balance and assigns sequence number."""
    entry = await get_accounting_entry(db, entry_uuid, fiscal_year_uuid)
    
    if entry.state != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entry is not in Draft state (state={entry.state})",
        )
    
    # Verify fiscal year is still open
    fy = entry.fiscal_year or await get_or_create_fiscal_year(db, fiscal_year_uuid)
    if fy.state == 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot post entry into closed fiscal year {fy.code}",
        )
    
    # Final balance check
    total_debit = sum(line.debit for line in entry.lines)
    total_credit = sum(line.credit for line in entry.lines)
    if total_debit != total_credit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry is not balanced: debit={total_debit} != credit={total_credit}",
        )
    
    # Assign sequence number (format: FY2026-001, FY2026-002, etc.)
    max_seq_result = await db.execute(
        select(AccountingEntry.sequence_number)
        .where(
            and_(
                AccountingEntry.fiscal_year_uuid == fiscal_year_uuid,
                AccountingEntry.sequence_number.isnot(None),
            )
        )
        .order_by(AccountingEntry.sequence_number.desc())
        .limit(1)
    )
    
    max_seq_row = max_seq_result.scalar()
    if max_seq_row:
        # Extract number from sequence like "FY2026-001"
        seq_num = int(max_seq_row.split("-")[-1]) + 1
    else:
        seq_num = 1
    
    entry.sequence_number = f"{fy.code}-{seq_num:03d}"
    entry.state = 2  # Posted
    entry.posted_at = datetime.now(timezone.utc)
    
    await db.commit()
    await db.refresh(entry, ["fiscal_year", "journal", "lines"])
    return entry


async def list_fiscal_years(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[AccountingFiscalYear]:
    """List all fiscal years."""
    stmt = select(AccountingFiscalYear).offset(skip).limit(limit).order_by(AccountingFiscalYear.year.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def list_accounts(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[AccountingAccount]:
    """List all accounts."""
    stmt = select(AccountingAccount).offset(skip).limit(limit).order_by(AccountingAccount.code)
    result = await db.execute(stmt)
    return result.scalars().all()


async def list_journals(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[AccountingJournal]:
    """List all journals."""
    stmt = select(AccountingJournal).offset(skip).limit(limit).order_by(AccountingJournal.code)
    result = await db.execute(stmt)
    return result.scalars().all()
