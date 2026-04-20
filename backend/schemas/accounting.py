"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Accounting module schemas
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
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# Fiscal Year schemas
class FiscalYearBase(BaseModel):
    """Shared fiscal year fields."""
    code: str = Field(min_length=3, max_length=16)
    label: str = Field(min_length=1, max_length=64)
    year: int = Field(ge=2000, le=9999)
    start_date: date
    end_date: date


class FiscalYearCreateRequest(FiscalYearBase):
    """Request to create a new fiscal year."""
    pass


class FiscalYearResponse(FiscalYearBase):
    """Fiscal year response."""
    uuid: UUID
    state: int  # 1=Open, 2=Closed, 3=Reopened
    closed_at: Optional[datetime] = None
    closed_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Account schemas
class AccountBase(BaseModel):
    """Shared account fields."""
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    type: int  # 1=Asset, 2=Liability, 3=Equity, 4=Expense, 5=Revenue
    is_posting_allowed: bool = True
    normal_balance: int  # 1=Debit, 2=Credit
    is_reconcilable: bool = False
    is_active: bool = True


class AccountCreateRequest(AccountBase):
    """Request to create an account."""
    parent_account_uuid: Optional[UUID] = None
    replacement_account_uuid: Optional[UUID] = None


class AccountResponse(AccountBase):
    """Account response."""
    uuid: UUID
    parent_account_uuid: Optional[UUID] = None
    archived_at: Optional[datetime] = None
    replacement_account_uuid: Optional[UUID] = None

    class Config:
        from_attributes = True


# Journal schemas
class JournalBase(BaseModel):
    """Shared journal fields."""
    code: str = Field(min_length=1, max_length=10)
    name: str = Field(min_length=1, max_length=100)
    type: int  # 1=Sale, 2=Purchase, 3=Bank, 4=Cash, 5=General, 6=Opening
    is_active: bool = True


class JournalCreateRequest(JournalBase):
    """Request to create a journal."""
    default_account_uuid: Optional[UUID] = None


class JournalResponse(JournalBase):
    """Journal response."""
    uuid: UUID
    default_account_uuid: Optional[UUID] = None

    class Config:
        from_attributes = True


# Accounting Line schemas
class AccountingLineBase(BaseModel):
    """Shared line fields."""
    account_uuid: UUID
    debit: Decimal = Field(decimal_places=4, ge=0)
    credit: Decimal = Field(decimal_places=4, ge=0)
    description: Optional[str] = Field(default=None, max_length=255)


class AccountingLineCreateRequest(AccountingLineBase):
    """Request to add a line to an entry."""
    member_uuid: Optional[UUID] = None
    analytical_asset_uuid: Optional[UUID] = None
    tax_code: Optional[str] = Field(default=None, max_length=64)
    tax_rate: Optional[Decimal] = Field(default=None, decimal_places=4)
    tax_base: Optional[Decimal] = Field(default=None, decimal_places=4)
    tax_amount: Optional[Decimal] = Field(default=None, decimal_places=4)


class AccountingLineResponse(AccountingLineBase):
    """Line response."""
    uuid: UUID
    entry_uuid: UUID
    fiscal_year_uuid: UUID
    member_uuid: Optional[UUID] = None
    member_account_id_snapshot: Optional[str] = None
    analytical_asset_uuid: Optional[UUID] = None
    tax_code: Optional[str] = None
    tax_rate: Optional[Decimal] = None
    tax_base: Optional[Decimal] = None
    tax_amount: Optional[Decimal] = None

    class Config:
        from_attributes = True


# Accounting Entry schemas
class AccountingEntryBase(BaseModel):
    """Shared entry fields."""
    journal_uuid: UUID
    entry_date: date
    description: str = Field(min_length=1, max_length=255)
    reference: Optional[str] = Field(default=None, max_length=255)


class AccountingEntryCreateRequest(AccountingEntryBase):
    """Request to create an entry in Draft state."""
    fiscal_year_uuid: UUID
    lines: list[AccountingLineCreateRequest] = Field(min_items=1)
    source_system: Optional[str] = Field(default=None, max_length=64)
    external_id: Optional[str] = Field(default=None, max_length=255)
    import_batch_id: Optional[str] = Field(default=None, max_length=64)


class AccountingEntryUpdateRequest(BaseModel):
    """Request to update a Draft entry."""
    journal_uuid: Optional[UUID] = None
    entry_date: Optional[date] = None
    description: Optional[str] = Field(default=None, min_length=1, max_length=255)
    reference: Optional[str] = Field(default=None, max_length=255)
    lines: Optional[list[AccountingLineCreateRequest]] = None


class AccountingEntryResponse(AccountingEntryBase):
    """Entry response."""
    uuid: UUID
    fiscal_year_uuid: UUID
    state: int  # 1=Draft, 2=Posted, 3=Cancelled
    sequence_number: Optional[str] = None
    source_document_ref: Optional[str] = None
    source_document_date: Optional[date] = None
    source_system: Optional[str] = None
    external_id: Optional[str] = None
    import_batch_id: Optional[str] = None
    reversal_of_entry_uuid: Optional[UUID] = None
    reversal_reason: Optional[str] = None
    posted_at: Optional[datetime] = None
    created_at: datetime
    created_by: int
    lines: list[AccountingLineResponse] = []

    class Config:
        from_attributes = True


class AccountingEntryPostRequest(BaseModel):
    """Request to post (lock) a Draft entry."""
    pass
