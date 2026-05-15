"""Pydantic schemas for the members module."""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class MemberRoleFlags(BaseModel):
    """Operational flags that can coexist on a member."""

    is_instructor: bool = False
    is_employee: bool = False
    is_executive: bool = False
    is_board_member: bool = False


class MemberBase(MemberRoleFlags):
    """Shared mutable member fields."""

    genre: int = Field(default=0, ge=0, le=3)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    date_of_birth: Optional[date] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=50)
    member_category: int = Field(ge=1, le=8)
    first_subscription_year: Optional[int] = Field(default=None, ge=1950, le=9999)
    ffvp_id: Optional[int] = Field(default=None, ge=1)
    photo_url: Optional[str] = None
    status: int = Field(default=1, ge=1, le=4)
    registration_status: int = Field(default=1, ge=1, le=4)
    can_fly: bool = False
    external_auth_enabled: bool = False
    last_registration_date: Optional[date] = None
    trigram: Optional[str] = Field(default=None, max_length=3)
    notes: Optional[str] = None


class MemberCreateRequest(MemberBase):
    """Payload for member creation."""

    account_id: Optional[str] = Field(
        default=None,
        pattern=r"^(?:ME\d{4}-\d{4}|EXT-\d{4}|FO-\d{4})$",
    )
    legacy_account_id: Optional[str] = Field(default=None, max_length=32)


class MemberUpdateRequest(BaseModel):
    """Payload for member updates."""

    genre: Optional[int] = Field(default=None, ge=0, le=3)
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    date_of_birth: Optional[date] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=50)
    member_category: Optional[int] = Field(default=None, ge=1, le=8)
    first_subscription_year: Optional[int] = Field(default=None, ge=1950, le=9999)
    ffvp_id: Optional[int] = Field(default=None, ge=1)
    account_id: Optional[str] = Field(
        default=None,
        pattern=r"^(?:ME\d{4}-\d{4}|EXT-\d{4}|FO-\d{4})$",
    )
    photo_url: Optional[str] = None
    status: Optional[int] = Field(default=None, ge=1, le=4)
    registration_status: Optional[int] = Field(default=None, ge=1, le=4)
    is_instructor: Optional[bool] = None
    is_employee: Optional[bool] = None
    is_executive: Optional[bool] = None
    is_board_member: Optional[bool] = None
    can_fly: Optional[bool] = None
    external_auth_enabled: Optional[bool] = None
    last_registration_date: Optional[date] = None
    trigram: Optional[str] = Field(default=None, max_length=3)
    legacy_account_id: Optional[str] = Field(default=None, max_length=32)
    notes: Optional[str] = None


class MemberListFilters(BaseModel):
    """Filter contract for member list queries."""

    search: Optional[str] = None
    status: Optional[int] = Field(default=None, ge=1, le=4)
    member_category: Optional[int] = Field(default=None, ge=1, le=8)
    member_categories: Optional[list[int]] = None
    registration_status: Optional[int] = Field(default=None, ge=1, le=4)
    committee_uuid: Optional[UUID] = None
    can_fly: Optional[bool] = None
    is_instructor: Optional[bool] = None
    is_employee: Optional[bool] = None
    is_executive: Optional[bool] = None
    is_board_member: Optional[bool] = None
    year: Optional[int] = Field(default=None, ge=2000, le=9999)
    registration_state: Optional[str] = Field(default=None, pattern="^(registered|unregistered)$")


class CommitteeCreateRequest(BaseModel):
    """Payload for committee creation."""

    code: str = Field(min_length=1, max_length=32)
    description: str = Field(min_length=1, max_length=255)
    budget_amount: Optional[Decimal] = Field(default=None, ge=0)
    last_meeting_date: Optional[date] = None
    budget_status: Optional[int] = Field(default=None, ge=1, le=3)
    manager_member_uuid: Optional[UUID] = None
    is_active: bool = True


class CommitteeUpdateRequest(BaseModel):
    """Payload for committee updates."""

    code: Optional[str] = Field(default=None, min_length=1, max_length=32)
    description: Optional[str] = Field(default=None, min_length=1, max_length=255)
    budget_amount: Optional[Decimal] = Field(default=None, ge=0)
    last_meeting_date: Optional[date] = None
    budget_status: Optional[int] = Field(default=None, ge=1, le=3)
    manager_member_uuid: Optional[UUID] = None
    is_active: Optional[bool] = None


class CommitteeMembershipReplaceRequest(BaseModel):
    """Full replacement of a committee roster for a year."""

    member_uuids: list[UUID] = Field(default_factory=list)


class MemberSheetUpsertRequest(BaseModel):
    """Payload for yearly member sheet upsert."""

    licence_number: Optional[str] = Field(default=None, max_length=100)
    fare_type: int = Field(ge=1, le=5)
    hours_count: Decimal = Field(default=Decimal("0"), ge=0)
    packs_bought_count: int = Field(default=0, ge=0)
    hours_done_in_pack: Decimal = Field(default=Decimal("0"), ge=0)
    remaining_hours_in_pack: Decimal = Field(default=Decimal("0"), ge=0)
    expense_access_enabled: bool = False


class RegistrationCompletionRequest(BaseModel):
    """Payload for registration completion."""

    year: int = Field(ge=2000, le=9999)
    start_date: date
    end_date: date
    registration_type: Optional[int] = Field(default=None, ge=1, le=8)
    accounting_template_uuid: Optional[UUID] = None
    pricing_item_uuids: Optional[list[UUID]] = None
    accounting_entry_date: Optional[date] = None
    committee_uuids: Optional[list[UUID]] = None
    status: int = Field(default=1, ge=1, le=3)
    notes: Optional[str] = None


class MemberRegistrationCreateRequest(BaseModel):
    """Payload for creating a member registration period."""

    start_date: date
    end_date: date
    registered_for_year: int = Field(ge=2000, le=9999)
    registration_type: Optional[int] = Field(default=None, ge=1, le=8)
    status: int = Field(default=1, ge=1, le=3)
    notes: Optional[str] = None


class MemberRegistrationUpdateRequest(BaseModel):
    """Payload for updating a member registration period."""

    start_date: Optional[date] = None
    end_date: Optional[date] = None
    registered_for_year: Optional[int] = Field(default=None, ge=2000, le=9999)
    registration_type: Optional[int] = Field(default=None, ge=1, le=8)
    status: Optional[int] = Field(default=None, ge=1, le=3)
    notes: Optional[str] = None


class CommitteeMembershipResponse(BaseModel):
    """Serialized yearly committee membership."""

    committee_uuid: UUID
    member_uuid: UUID
    membership_year: int
    assigned_at: datetime
    assigned_by: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class CommitteeResponse(BaseModel):
    """Serialized committee."""

    uuid: UUID
    code: str
    description: str
    budget_amount: Optional[Decimal] = None
    last_meeting_date: Optional[date] = None
    budget_status: Optional[int] = Field(default=None, ge=1, le=3)
    manager_member_uuid: Optional[UUID] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MemberSheetResponse(BaseModel):
    """Serialized yearly member sheet."""

    uuid: UUID
    member_uuid: UUID
    year: int
    licence_number: Optional[str] = None
    fare_type: int
    hours_count: Decimal
    packs_bought_count: int
    hours_done_in_pack: Decimal
    remaining_hours_in_pack: Decimal
    expense_access_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MemberRegistrationResponse(BaseModel):
    """Serialized dated member registration."""

    uuid: UUID
    member_uuid: UUID
    start_date: date
    end_date: date
    registered_for_year: int
    registration_type: int
    status: int
    registered_at: datetime
    registered_by: Optional[int] = None
    notes: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class MemberSummaryResponse(BaseModel):
    """Serialized member summary for list views."""

    uuid: UUID
    account_id: str
    ffvp_id: Optional[int] = None
    first_name: str
    last_name: str
    email: Optional[EmailStr] = None
    member_category: int
    status: int
    registration_status: int
    can_fly: bool
    is_instructor: bool
    is_employee: bool
    is_executive: bool
    is_board_member: bool
    committee_count: int = 0
    has_member_sheet_for_year: bool = False
    is_registered_for_year: bool = False


class MemberOptionResponse(BaseModel):
    """Lightweight member option for selectors and cached lookups."""

    uuid: UUID
    account_id: str
    first_name: str
    last_name: str


class MemberDetailResponse(BaseModel):
    """Serialized member detail."""

    uuid: UUID
    genre: int
    first_name: str
    last_name: str
    date_of_birth: Optional[date] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    member_category: int
    first_subscription_year: Optional[int] = None
    ffvp_id: Optional[int] = None
    account_id: str
    legacy_account_id: Optional[str] = None
    photo_url: Optional[str] = None
    status: int
    registration_status: int
    is_instructor: bool
    is_employee: bool
    is_executive: bool
    is_board_member: bool
    can_fly: bool
    external_auth_enabled: bool
    last_registration_date: Optional[date] = None
    trigram: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    committees: list[CommitteeMembershipResponse] = Field(default_factory=list)
    member_sheets: list[MemberSheetResponse] = Field(default_factory=list)
    registrations: list[MemberRegistrationResponse] = Field(default_factory=list)


class ExpenseAccessResponse(BaseModel):
    """Response returned after expense access token operations."""

    member_uuid: UUID
    year: int
    expense_access_enabled: bool
    generated_token: Optional[str] = None


# ---------------------------------------------------------------------------
# CSV bulk import
# ---------------------------------------------------------------------------

class ImportRowError(BaseModel):
    """One validation or persistence error tied to a specific CSV row."""

    row: int
    field: Optional[str] = None
    message: str


class ImportResultResponse(BaseModel):
    """Summary returned after a CSV bulk import."""

    created: int
    updated: int = 0
    skipped: int
    errors: list[ImportRowError]


class AnonymizationResultResponse(BaseModel):
    """Summary returned after applying inactive-member anonymization."""

    anonymized: int
    threshold_year: int
