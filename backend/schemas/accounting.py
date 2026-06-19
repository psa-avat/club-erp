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
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
    require_id: int = 0  # 0=none,1=member,2=asset,3=supplier


class AccountResponse(AccountBase):
    """Account response."""
    uuid: UUID
    parent_account_uuid: Optional[UUID] = None
    archived_at: Optional[datetime] = None
    replacement_account_uuid: Optional[UUID] = None
    require_id: int = 0  # 0=none,1=member,2=asset,3=supplier

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
    tiers_uuid: Optional[UUID] = None
    tax_code: Optional[str] = Field(default=None, max_length=64)
    tax_rate: Optional[Decimal] = Field(default=None, decimal_places=4)
    tax_base: Optional[Decimal] = Field(default=None, decimal_places=4)
    tax_amount: Optional[Decimal] = Field(default=None, decimal_places=4)


class AccountingLineResponse(AccountingLineBase):
    """Line response."""
    uuid: UUID
    entry_uuid: UUID
    fiscal_year_uuid: UUID
    tiers_uuid: Optional[UUID] = None
    # Display fields resolved by join (semantics depend on account.require_id)
    tiers_display_ref: Optional[str] = None   # account_id for members, registration for assets
    tiers_display_name: Optional[str] = None  # full name for members, asset name for assets
    analytical_asset_code: Optional[str] = None
    analytical_asset_name: Optional[str] = None
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
    entry_hash: Optional[str] = None
    posted_at: Optional[datetime] = None
    created_at: datetime
    created_by: int
    lines: list[AccountingLineResponse] = []

    class Config:
        from_attributes = True


class AccountingEntryPostRequest(BaseModel):
    """Request to post (lock) a Draft entry."""
    pass


class AccountingEntriesBulkPostRequest(BaseModel):
    """Request to post multiple Draft entries in one fiscal year."""
    fiscal_year_uuid: UUID
    entry_uuids: list[UUID] = Field(min_length=1)


class AccountingEntryReverseRequest(BaseModel):
    """Request to create a reversal Draft entry from a Posted entry."""
    fiscal_year_uuid: UUID
    reversal_reason: str = Field(min_length=1, max_length=255)
    entry_date: Optional[date] = None


class AccountingEntryTemplateLineBase(BaseModel):
    """Shared line fields for reusable entry templates."""
    account_uuid: UUID
    debit: Decimal = Field(decimal_places=4, ge=0)
    credit: Decimal = Field(decimal_places=4, ge=0)
    description: Optional[str] = Field(default=None, max_length=255)
    # Formula
    formula_type: str = Field(default='fixed', pattern=r'^(fixed|percentage|previous_period|rounding_adjustment)$')
    formula_params: Optional[dict] = None


class AccountingEntryTemplateLineCreateRequest(AccountingEntryTemplateLineBase):
    """Request line for a reusable entry template."""
    tiers_uuid: Optional[UUID] = None


class AccountingEntryTemplateLineResponse(AccountingEntryTemplateLineBase):
    """Response line for a reusable entry template."""
    uuid: UUID
    template_uuid: UUID
    sort_order: int
    tiers_uuid: Optional[UUID] = None

    class Config:
        from_attributes = True


class AccountingEntryTemplateCreateRequest(BaseModel):
    """Create request for a reusable recurring entry model."""
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=120)
    journal_uuid: UUID
    description: Optional[str] = Field(default=None, max_length=255)
    default_reference: Optional[str] = Field(default=None, max_length=255)
    recurrence_type: int = Field(default=1, ge=1, le=4)
    is_active: bool = True
    # Scheduling (pluriannual — fiscal_year resolved at runtime)
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    lines: list[AccountingEntryTemplateLineCreateRequest] = Field(min_length=1)


class AccountingEntryTemplateUpdateRequest(BaseModel):
    """Update request for a reusable recurring entry model."""
    code: Optional[str] = Field(default=None, min_length=1, max_length=32)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    journal_uuid: Optional[UUID] = None
    description: Optional[str] = Field(default=None, max_length=255)
    default_reference: Optional[str] = Field(default=None, max_length=255)
    recurrence_type: Optional[int] = Field(default=None, ge=1, le=4)
    is_active: Optional[bool] = None
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    lines: Optional[list[AccountingEntryTemplateLineCreateRequest]] = None


class AccountingEntryTemplateResponse(BaseModel):
    """Response for a reusable recurring entry model."""
    uuid: UUID
    code: str
    name: str
    journal_uuid: UUID
    description: Optional[str] = None
    default_reference: Optional[str] = None
    recurrence_type: int
    is_active: bool
    # Scheduling
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    next_scheduled_date: Optional[date] = None
    last_generated_at: Optional[datetime] = None
    last_generated_entry_uuid: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    created_by: int
    lines: list[AccountingEntryTemplateLineResponse] = []

    class Config:
        from_attributes = True


# ── Generate / Preview schemas ──────────────────────────────────────────────


class AccountingEntryTemplateGenerateRequest(BaseModel):
    """Request to generate an entry from a template."""
    target_date: date


class GeneratePreviewLine(BaseModel):
    """A single calculated line in a preview response."""
    account_code: str
    debit: Decimal = Field(decimal_places=4)
    credit: Decimal = Field(decimal_places=4)
    description: Optional[str] = None


class AccountingEntryTemplatePreviewResponse(BaseModel):
    """Preview of a generated entry without persisting."""
    template_code: str
    reference: str
    description: Optional[str] = None
    fiscal_year_uuid: UUID
    fiscal_year_label: str
    lines: list[GeneratePreviewLine]
    total_debit: Decimal = Field(decimal_places=4)
    total_credit: Decimal = Field(decimal_places=4)
    is_balanced: bool
    warnings: list[str] = []


class AccountingEntryTemplateGenerateResponse(BaseModel):
    """Response after generating an entry from a template."""
    entry_uuid: UUID
    reference: str
    fiscal_year_uuid: UUID
    state: int
    was_already_generated: bool


class GenerateDueItem(BaseModel):
    """Item in the generate-due response."""
    template_code: str
    entry_uuid: Optional[UUID] = None
    reference: Optional[str] = None
    fiscal_year_uuid: Optional[UUID] = None


class GenerateDueSkipped(BaseModel):
    """Skipped template in generate-due."""
    template_code: str
    reason: str


class GenerateDueError(BaseModel):
    """Error item in generate-due."""
    template_code: str
    reason: str


class AccountingEntryTemplateGenerateDueResponse(BaseModel):
    """Response after generating all due entries."""
    generated: list[GenerateDueItem] = []
    skipped: list[GenerateDueSkipped] = []
    errors: list[GenerateDueError] = []


class SeedPcgResponse(BaseModel):
    """Response summary for PCG seed operation."""
    inserted: int
    updated: int
    total: int


class AccountBalanceResponse(BaseModel):
    """Account balance aggregated from posted lines in a fiscal year."""
    account_uuid: UUID
    code: str
    name: str
    type: int            # 1=Asset 2=Liability 3=Equity 4=Expense 5=Revenue
    normal_balance: int  # 1=Debit 2=Credit
    parent_account_uuid: Optional[UUID] = None
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")
    balance: Decimal = Decimal("0")  # debit − credit (signed)

    class Config:
        from_attributes = True


class PcgSeedItem(BaseModel):
    """One entry in the PCG seed file."""
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    type: int = Field(ge=1, le=5)          # 1=Asset,2=Liability,3=Equity,4=Expense,5=Revenue
    is_posting_allowed: bool = True
    is_reconcilable: bool = False


class PcgSeedExportResponse(BaseModel):
    """Full export of the current PCG seed file."""
    items: list[PcgSeedItem]
    total: int


class PcgSeedImportRequest(BaseModel):
    """Replace the PCG seed file with the provided items."""
    items: list[PcgSeedItem] = Field(min_length=1)


class SystemSettingUpdateRequest(BaseModel):
    """Upsert request for module-scoped global settings."""
    settings: dict[str, Any]


class SystemSettingResponse(BaseModel):
    """Module-scoped global settings response."""
    module_name: str
    settings: dict[str, Any]
    updated_at: datetime
    updated_by: Optional[int] = None

    class Config:
        from_attributes = True


class PricingVersionCreateRequest(BaseModel):
    """Create request for pricing version governance."""
    fiscal_year_uuid: Optional[UUID] = None
    # NULL = global pricing; set to scope this version to a specific asset type
    asset_type_uuid: Optional[UUID] = None
    name: str = Field(min_length=1, max_length=100)
    from_date: date
    to_date: Optional[date] = None
    status: int = Field(default=1, ge=1, le=3)  # 1=Draft, 2=Active, 3=Archived
    use_pack: bool = True


class PricingVersionResponse(BaseModel):
    """Pricing version response."""
    uuid: UUID
    fiscal_year_uuid: Optional[UUID] = None
    name: str
    from_date: date
    to_date: Optional[date] = None
    status: int
    is_locked: bool
    use_pack: bool
    asset_type_uuid: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None

    class Config:
        from_attributes = True


class PricingVersionUpdateRequest(BaseModel):
    """Update request for pricing version governance."""
    asset_type_uuid: Optional[UUID] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    status: Optional[int] = Field(default=None, ge=1, le=3)
    use_pack: Optional[bool] = None


class PricingVersionCloneRequest(BaseModel):
    """Request to clone an existing pricing version into a new Draft version."""
    name: str = Field(min_length=1, max_length=100)
    from_date: date
    to_date: Optional[date] = None
    use_pack: Optional[bool] = None


class CopyPricingVersionsRequest(BaseModel):
    """Request to copy pricing versions from one fiscal year to another as Draft."""
    source_fiscal_year_uuid: UUID
    target_fiscal_year_uuid: UUID


class CopyPricingVersionsResponse(BaseModel):
    """Summary of pricing version copy operation."""
    copied: int
    skipped: int
    versions: list[PricingVersionResponse]


class CostProvisionRuleResponse(BaseModel):
    """Response schema for a cost provision rule."""
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    asset_type_uuid: UUID
    fiscal_year_uuid: UUID
    metric_name: str
    cost_per_unit: Decimal
    gl_account_debit_uuid: UUID
    gl_account_credit_uuid: UUID
    accrual_method: int
    is_active: bool


class CopyCostProvisionRulesRequest(BaseModel):
    """Request to copy cost provision rules from one fiscal year to another."""
    source_fiscal_year_uuid: UUID
    target_fiscal_year_uuid: UUID


class CopyCostProvisionRulesResponse(BaseModel):
    """Summary of cost provision rules copy operation."""
    copied: int
    skipped: int
    rules: list[CostProvisionRuleResponse]


# ---------------------------------------------------------------------------
# Pricing Item Tiers
# ---------------------------------------------------------------------------

class PricingItemTierCreate(BaseModel):
    """One progressive pricing bracket: applies from from_qty units onward."""
    from_qty: Decimal = Field(gt=0, decimal_places=4)
    price: Decimal = Field(ge=0, decimal_places=2)


class PricingItemTierResponse(BaseModel):
    """Pricing item tier response."""
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    from_qty: Decimal
    price: Decimal
    sort_order: int


# ---------------------------------------------------------------------------
# Pricing Items
# ---------------------------------------------------------------------------

class PricingItemCreateRequest(BaseModel):
    """Create request for a pricing item within a pricing version."""
    flight_type_uuid: Optional[UUID] = None
    name: str = Field(min_length=1, max_length=120)
    # 1=FlightTime(h), 2=EngineTimeMinute, 3=EngineTime1_100h, 4=FlightDuration, 5=PerFlight, 6=Fixed, 7=FixedDurationTranche
    unit: int = Field(ge=1, le=7)
    base_price: Decimal = Field(ge=0, decimal_places=2)
    # When True, tiers are applied progressively (each bracket at its own rate)
    is_progressive: bool = False
    # Percentage discount applied when the member is under-25 eligible (0 = no discount)
    age_discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100, decimal_places=2)
    # Revenue account credited at billing time (NULL allowed during setup)
    gl_account_credit_uuid: Optional[UUID] = None
    # Progressive price brackets; replaces the former single threshold pair
    tiers: list[PricingItemTierCreate] = []


class PricingItemUpdateRequest(BaseModel):
    """Partial update request for a pricing item."""
    flight_type_uuid: Optional[UUID] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    unit: Optional[int] = Field(default=None, ge=1, le=7)
    base_price: Optional[Decimal] = Field(default=None, ge=0, decimal_places=2)
    is_progressive: Optional[bool] = None
    # When provided, overrides the existing age discount percentage
    age_discount_percent: Optional[Decimal] = Field(default=None, ge=0, le=100, decimal_places=2)
    # When provided, updates the revenue account linked to this item
    gl_account_credit_uuid: Optional[UUID] = None
    # When provided, replaces all existing tiers atomically
    tiers: Optional[list[PricingItemTierCreate]] = None


class PricingItemResponse(BaseModel):
    """Pricing item response."""
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    pricing_version_uuid: UUID
    flight_type_uuid: Optional[UUID] = None
    name: str
    unit: int
    base_price: Decimal
    is_progressive: bool = False
    age_discount_percent: Decimal
    gl_account_credit_uuid: Optional[UUID] = None
    tiers: list[PricingItemTierResponse] = []
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Legacy CSV Import (fiscal year initialization)
# ---------------------------------------------------------------------------

class AccountingImportPreviewLineResponse(BaseModel):
    """One line within a preview accounting entry from CSV import."""
    account_code: str
    account_uuid: Optional[UUID] = None
    description: Optional[str] = None
    member_account_id: Optional[str] = None
    member_uuid: Optional[UUID] = None
    debit: Decimal
    credit: Decimal
    errors: list[str] = []


class AccountingImportPreviewEntryResponse(BaseModel):
    """One grouped balanced entry from a CSV import preview."""
    entry_key: str
    entry_date: date
    description: str
    row_start: int
    row_end: int
    total_debit: Decimal
    total_credit: Decimal
    importable: bool
    already_imported: bool = False
    errors: list[str] = []
    lines: list[AccountingImportPreviewLineResponse]


class AccountingImportPreviewResponse(BaseModel):
    """Full preview of a CSV accounting import before committing."""
    source_system: str
    fiscal_year_uuid: UUID
    journal_uuid: UUID
    entries: list[AccountingImportPreviewEntryResponse]
    importable_count: int
    blocked_count: int


class AccountingImportApplyResponse(BaseModel):
    """Result after applying a selective CSV accounting import."""
    source_system: str
    import_batch_id: str
    imported_count: int
    skipped_count: int
    created_entry_uuids: list[UUID]
