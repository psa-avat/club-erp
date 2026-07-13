"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation module schemas
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
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class BankStatementLineResponse(BaseModel):
    uuid: UUID
    statement_uuid: UUID
    line_index: int
    line_date: date
    description: Optional[str] = None
    amount: Decimal = Field(decimal_places=4)
    reference: Optional[str] = None
    counterparty: Optional[str] = None
    match_status: str
    matched_entry_uuid: Optional[UUID] = None
    matched_line_uuid: Optional[UUID] = None
    matched_fiscal_year_uuid: Optional[UUID] = None
    match_confidence: Optional[Decimal] = Field(default=None, decimal_places=3)
    discrepancy_type: Optional[str] = None
    discrepancy_notes: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BankStatementResponse(BaseModel):
    uuid: UUID
    fiscal_year_uuid: UUID
    journal_uuid: UUID
    account_uuid: UUID
    import_date: datetime
    statement_date: date
    statement_period_start: Optional[date] = None
    statement_period_end: Optional[date] = None
    source_format: str
    raw_filename: Optional[str] = None
    opening_balance: Decimal = Field(decimal_places=4)
    closing_balance: Decimal = Field(decimal_places=4)
    total_debits: Decimal = Field(decimal_places=4)
    total_credits: Decimal = Field(decimal_places=4)
    line_count: int
    status: str
    reconciled_balance: Optional[Decimal] = Field(default=None, decimal_places=4)
    balance_difference: Optional[Decimal] = Field(default=None, decimal_places=4)
    reconciled_at: Optional[datetime] = None
    reconciled_by: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BankStatementSummaryResponse(BankStatementResponse):
    """BankStatementResponse plus lightweight, SQL-aggregated progress data for the
    statement inbox — status_counts/unresolved_count/live_balance_difference are
    computed from bank_statement_lines, not from a per-statement full report load."""

    status_counts: dict[str, int] = Field(default_factory=dict)
    unresolved_count: int = 0
    live_balance_difference: Decimal = Field(decimal_places=4)


class BankStatementSummaryListResponse(BaseModel):
    items: list[BankStatementSummaryResponse]
    total: int


class BankStatementLineListResponse(BaseModel):
    items: list[BankStatementLineResponse]
    total: int


class MatchResultResponse(BaseModel):
    auto_matched: int
    flagged_review: int
    unmatched: int


class CandidateEntryResponse(BaseModel):
    entry_uuid: UUID
    entry_line_uuid: UUID
    fiscal_year_uuid: UUID
    entry_date: date
    description: Optional[str] = None
    reference: Optional[str] = None
    state: int
    amount: Decimal = Field(decimal_places=4)
    amount_diff: Decimal = Field(decimal_places=4)
    date_diff: int
    description_score: Decimal = Field(decimal_places=4)
    score: Decimal = Field(decimal_places=3)
    is_internal_transfer: bool


class ManualMatchRequest(BaseModel):
    line_uuid: UUID
    entry_uuid: UUID
    entry_line_uuid: Optional[UUID] = None
    fiscal_year_uuid: UUID
    include_drafts: bool = True


class UnmatchRequest(BaseModel):
    line_uuid: UUID
    reason: str = Field(min_length=1, max_length=500)


class DiscrepancyResponse(BaseModel):
    line_uuid: UUID
    type: Literal["missing_entry", "amount_variance", "timing", "duplicate"]
    description: str


class ResolveDiscrepancyRequest(BaseModel):
    line_uuid: UUID
    action: Literal["accept", "exclude", "create_correcting_entry"]
    counter_account_uuid: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=500)


class ReconciliationUnresolvedLine(BaseModel):
    uuid: UUID
    line_date: date
    description: Optional[str] = None
    amount: Decimal = Field(decimal_places=4)
    match_status: str
    discrepancy_type: Optional[str] = None
    discrepancy_notes: Optional[str] = None


class ReconciliationCorrectingEntry(BaseModel):
    line_uuid: UUID
    entry_uuid: UUID
    fiscal_year_uuid: UUID
    reference: Optional[str] = None
    description: Optional[str] = None


class ReconciliationReportResponse(BaseModel):
    statement_uuid: UUID
    fiscal_year_uuid: UUID
    journal_uuid: UUID
    account_uuid: UUID
    statement_date: date
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    opening_balance: Decimal = Field(decimal_places=4)
    closing_balance: Decimal = Field(decimal_places=4)
    reconciled_balance: Optional[Decimal] = Field(default=None, decimal_places=4)
    balance_difference: Optional[Decimal] = Field(default=None, decimal_places=4)
    live_balance_difference: Decimal = Field(decimal_places=4)
    status: str
    line_count: int
    status_counts: dict[str, int]
    correcting_entries: list[ReconciliationCorrectingEntry]
    unresolved_lines: list[ReconciliationUnresolvedLine]
    reconciled_at: Optional[datetime] = None
    reconciled_by: Optional[int] = None


class BankCsvMappingCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    column_mapping: dict[str, Any]
    separator: Optional[str] = Field(default=None, max_length=4)
    encoding: Optional[str] = Field(default=None, max_length=16)
    date_format: str = Field(default="DD/MM/YYYY", max_length=16)


class BankCsvMappingResponse(BaseModel):
    uuid: UUID
    name: str
    created_by: int
    column_mapping: dict[str, Any]
    separator: Optional[str] = None
    encoding: Optional[str] = None
    date_format: str
    created_at: datetime

    class Config:
        from_attributes = True
