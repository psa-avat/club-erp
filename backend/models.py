"""    
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Backend API principale
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

"""SQLAlchemy models for authentication, authorization, user settings, and members."""

from datetime import datetime, timezone
from enum import IntEnum
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    JSON,
    Integer,
    Numeric,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID

from database import Base


class User(Base):
    """User account identity table."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    nom = Column(String(255), nullable=True)
    prenom = Column(String(255), nullable=True)
    auth_expiration_date = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    session_tokens = relationship("SessionToken", back_populates="user")
    user_settings = relationship("UserSettings", back_populates="user", uselist=False)
    user_roles = relationship("UserRole", back_populates="user")
    auth_challenges = relationship("AuthChallenge", back_populates="user")
    trusted_devices = relationship("TrustedDevice", back_populates="user")
    updated_members = relationship("Member", back_populates="updated_by_user")
    updated_committees = relationship("Committee", back_populates="updated_by_user")
    assigned_committee_memberships = relationship("CommitteeMember", back_populates="assigned_by_user")
    updated_member_sheets = relationship("MemberSheet", back_populates="updated_by_user")
    registered_member_registrations = relationship("MemberRegistration", back_populates="registered_by_user")

    def __repr__(self):
        return f"<User id={self.id} {self.prenom} {self.nom}>"


class Role(Base):
    """Role catalog (database-driven authorization)."""

    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(SmallInteger, nullable=False, unique=True, index=True)
    slug = Column(String(64), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user_roles = relationship("UserRole", back_populates="role")
    role_capabilities = relationship("RoleCapability", back_populates="role")


class Capability(Base):
    """Capability catalog."""

    __tablename__ = "capabilities"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(64), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    role_capabilities = relationship("RoleCapability", back_populates="capability")


class UserRole(Base):
    """Many-to-many assignment of roles to users."""

    __tablename__ = "user_roles"
    __table_args__ = (UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="user_roles")
    role = relationship("Role", back_populates="user_roles")


class RoleCapability(Base):
    """Many-to-many assignment of capabilities to roles."""

    __tablename__ = "role_capabilities"
    __table_args__ = (UniqueConstraint("role_id", "capability_id", name="uq_role_capabilities_role_cap"),)

    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True)
    capability_id = Column(Integer, ForeignKey("capabilities.id", ondelete="CASCADE"), nullable=False, index=True)
    scope = Column(String(32), nullable=False, default="all")
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    role = relationship("Role", back_populates="role_capabilities")
    capability = relationship("Capability", back_populates="role_capabilities")


class UserSettings(Base):
    """User-specific settings."""

    __tablename__ = "user_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    language = Column(String(10), default="fr")
    timezone = Column(String(50), default="Europe/Paris")
    can_change_password = Column(Boolean, default=True, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="user_settings")

    def __repr__(self):
        return f"<UserSettings user={self.user_id}>"


class SystemSetting(Base):
    """Module-scoped global settings payload."""

    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    module_name = Column(String(64), nullable=False, unique=True, index=True)
    settings = Column(JSON, nullable=False, default=dict)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    updated_by_user = relationship("User")

    def __repr__(self):
        return f"<SystemSetting module_name={self.module_name}>"


class FlightBillingSettings(Base):
    """
    Flight billing operational settings — one row per fiscal year.
    Each account is paired with its posting journal.
    """

    __tablename__ = "flight_billing_settings"

    id = Column(Integer, primary_key=True, index=True)
    fiscal_year_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )

    # FL journal → receivable account pair
    fl_journal_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_journals.uuid"), nullable=False)
    receivable_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=False)

    # VT journal → pack sales account pair
    vt_journal_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_journals.uuid"), nullable=False)
    default_pack_sales_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True)

    # REM journal → pack discount expense account pair
    rem_journal_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_journals.uuid"), nullable=False)
    default_pack_discount_expense_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True)

    # Initiation fallback (VI/initiation flights only — see vi_type_catalog for the
    # analytical VI mechanism). Club/entrainement/essai billing accounts and their
    # sentinel members live on flight_type_billing_accounts instead.
    default_initiation_charge_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Fallback charge account for initiation/VI flights when vi_type_catalog has no charge_account_uuid",
    )

    # Deposit settings
    deposit_journal_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_journals.uuid"), nullable=True,
        comment="Journal for member deposits (e.g. BQ or CAISSE)",
    )
    deposit_bank_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True,
        comment="Bank/cash account debited on member deposit",
    )
    deposit_receivable_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True,
        comment="Member receivable account credited on deposit (e.g. 411)",
    )

    # Operational settings
    rem_period_days = Column(Integer, nullable=False, default=30)
    allow_post_purchase_recalculation = Column(Boolean, nullable=False, default=True)
    max_days_for_post_purchase_discount = Column(Integer, nullable=True, default=30)
    require_approval_for_late_discount = Column(Boolean, nullable=False, default=True)

    # Metadata
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    fiscal_year = relationship("AccountingFiscalYear")
    fl_journal = relationship("AccountingJournal", foreign_keys=[fl_journal_uuid])
    vt_journal = relationship("AccountingJournal", foreign_keys=[vt_journal_uuid])
    rem_journal = relationship("AccountingJournal", foreign_keys=[rem_journal_uuid])
    receivable_account = relationship("AccountingAccount", foreign_keys=[receivable_account_uuid])
    pack_sales_account = relationship("AccountingAccount", foreign_keys=[default_pack_sales_account_uuid])
    pack_discount_expense_account = relationship("AccountingAccount", foreign_keys=[default_pack_discount_expense_account_uuid])
    deposit_journal = relationship("AccountingJournal", foreign_keys=[deposit_journal_uuid])
    deposit_bank_account = relationship("AccountingAccount", foreign_keys=[deposit_bank_account_uuid])
    deposit_receivable_account = relationship("AccountingAccount", foreign_keys=[deposit_receivable_account_uuid])
    updated_by_user = relationship("User")

    def __repr__(self):
        return f"<FlightBillingSettings fiscal_year={self.fiscal_year_uuid}>"


class FlightTypeBillingAccount(Base):
    """
    Per-billing-category analytical accounting override for club-billed flights —
    one row per (fiscal_year, billing_category). Each row is a self-contained
    "frame": the sentinel member whose charge_to_erp_id triggers this category,
    paired with its own analytical cost/reflection accounts. See
    FlightBillingCategory. Always analytical — no plain class-6 fallback account.
    """

    __tablename__ = "flight_type_billing_accounts"
    __table_args__ = (
        UniqueConstraint("fiscal_year_uuid", "billing_category", name="uq_flight_type_billing_accounts_category"),
        CheckConstraint("billing_category IN (1, 2, 3)", name="chk_flight_type_billing_accounts_category"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    fiscal_year_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid", ondelete="CASCADE"), nullable=False
    )
    billing_category = Column(
        SmallInteger, nullable=False,
        comment="FlightBillingCategory value: 1=club, 2=entrainement, 3=essai",
    )
    member_uuid = Column(
        UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="SET NULL"), nullable=True,
        comment="Sentinel member for this category — flights with charge_to_erp_id matching this member's account_id resolve to this row",
    )
    analytical_cost_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Debit account for analytical cost entry (e.g. 924 club, 922 entrainement, 923 essai). Requires analytical_reflection_account_uuid too.",
    )
    analytical_reflection_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Credit account for analytical reflection entry (e.g. 902).",
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    fiscal_year = relationship("AccountingFiscalYear")
    member = relationship("Member", foreign_keys=[member_uuid])
    analytical_cost_account = relationship("AccountingAccount", foreign_keys=[analytical_cost_account_uuid])
    analytical_reflection_account = relationship("AccountingAccount", foreign_keys=[analytical_reflection_account_uuid])
    updated_by_user = relationship("User")

    @property
    def analytical_cost_account_code(self) -> str | None:
        return self.analytical_cost_account.code if self.analytical_cost_account else None

    @property
    def analytical_reflection_account_code(self) -> str | None:
        return self.analytical_reflection_account.code if self.analytical_reflection_account else None

    def __repr__(self):
        return f"<FlightTypeBillingAccount fiscal_year={self.fiscal_year_uuid} billing_category={self.billing_category}>"


class AuthChallenge(Base):
    """One-time PIN challenge for 2FA."""

    __tablename__ = "auth_challenges"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    pin_hash = Column(String(255), nullable=False)
    attempts_count = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=5)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="auth_challenges")
    session_tokens = relationship("SessionToken", back_populates="auth_challenge")


class TrustedDevice(Base):
    """Trusted device records used to bypass PIN challenge for 30 days."""

    __tablename__ = "trusted_devices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)
    device_name = Column(String(255), nullable=True)
    ip_address = Column(Text, nullable=True)
    user_agent = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="trusted_devices")
    session_tokens = relationship("SessionToken", back_populates="trusted_device")


class SessionToken(Base):
    """JWT session tokens with PRE_AUTH/FULL_AUTH levels."""

    __tablename__ = "session_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)
    token_kind = Column(SmallInteger, nullable=False, default=2)
    auth_level = Column(SmallInteger, nullable=False, default=2)
    challenge_id = Column(Integer, ForeignKey("auth_challenges.id", ondelete="SET NULL"), nullable=True, index=True)
    trusted_device_id = Column(Integer, ForeignKey("trusted_devices.id", ondelete="SET NULL"), nullable=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    ip_address = Column(Text, nullable=True)
    user_agent = Column(Text, nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="session_tokens")
    auth_challenge = relationship("AuthChallenge", back_populates="session_tokens")
    trusted_device = relationship("TrustedDevice", back_populates="session_tokens")

    def __repr__(self):
        return f"<SessionToken user={self.user_id} expires={self.expires_at}>"


class MemberAccountCounter(Base):
    """Yearly counter used to generate member account ids."""

    __tablename__ = "member_account_counters"

    year = Column(SmallInteger, primary_key=True)
    next_value = Column(Integer, nullable=False, default=1)


class Member(Base):
    """Club member master record."""

    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint("genre BETWEEN 0 AND 3", name="chk_members_genre"),
        CheckConstraint("member_category BETWEEN 1 AND 8", name="chk_members_category"),
        CheckConstraint("status BETWEEN 1 AND 3", name="chk_members_status"),
        CheckConstraint("registration_status BETWEEN 1 AND 2", name="chk_members_registration_status"),
        CheckConstraint("first_subscription_year IS NULL OR first_subscription_year BETWEEN 1950 AND 9999", name="chk_members_first_subscription_year"),
        CheckConstraint("NOT (is_employee AND is_executive)", name="chk_members_role_employee_executive"),
        CheckConstraint("NOT (is_employee AND is_board_member)", name="chk_members_role_employee_board"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    genre = Column(SmallInteger, nullable=False, default=0)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    date_of_birth = Column(Date, nullable=True)
    email = Column(String(255), nullable=True, unique=True, index=True)
    phone = Column(String(50), nullable=True)
    member_category = Column(SmallInteger, nullable=False, index=True)
    first_subscription_year = Column(SmallInteger, nullable=True)
    ffvp_id = Column(BigInteger, nullable=True, unique=True, index=True)
    account_id = Column(String(32), nullable=False, unique=True, index=True)
    photo_url = Column(Text, nullable=True)
    status = Column(SmallInteger, nullable=False, default=1, index=True)
    registration_status = Column(SmallInteger, nullable=False, default=1, index=True)
    is_instructor = Column(Boolean, default=False, nullable=False)
    is_employee = Column(Boolean, default=False, nullable=False)
    is_executive = Column(Boolean, default=False, nullable=False)
    is_board_member = Column(Boolean, default=False, nullable=False)
    can_fly = Column(Boolean, default=False, nullable=False, index=True)
    external_auth_enabled = Column(Boolean, default=False, nullable=False)
    last_registration_date = Column(Date, nullable=True, index=True)
    trigram = Column(String(3), nullable=True)
    legacy_account_id = Column(String(32), nullable=True, unique=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    updated_by_user = relationship("User", back_populates="updated_members")
    managed_committees = relationship("Committee", back_populates="manager_member")
    committee_memberships = relationship("CommitteeMember", back_populates="member", cascade="all, delete-orphan")
    private_asset_owner_links = relationship("AssetPrivateOwner", back_populates="member", cascade="all, delete-orphan")
    member_sheets = relationship("MemberSheet", back_populates="member", cascade="all, delete-orphan")
    registrations = relationship("MemberRegistration", back_populates="member", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Member uuid={self.uuid} account_id={self.account_id} {self.first_name} {self.last_name}>"


class Committee(Base):
    """Committee definition with optional manager and budget."""

    __tablename__ = "committees"
    __table_args__ = (
        CheckConstraint("budget_amount IS NULL OR budget_amount >= 0", name="chk_committees_budget_amount"),
        CheckConstraint("budget_status IS NULL OR budget_status BETWEEN 1 AND 3", name="chk_committees_budget_status"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, unique=True, index=True)
    description = Column(String(255), nullable=False)
    budget_amount = Column(Numeric(12, 2), nullable=True)
    last_meeting_date = Column(Date, nullable=True)
    budget_status = Column(SmallInteger, nullable=True)
    manager_member_uuid = Column(UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="SET NULL"), nullable=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    manager_member = relationship("Member", back_populates="managed_committees")
    updated_by_user = relationship("User", back_populates="updated_committees")
    memberships = relationship("CommitteeMember", back_populates="committee", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Committee uuid={self.uuid} code={self.code}>"


class CommitteeMember(Base):
    """Yearly assignment of a member to a committee."""

    __tablename__ = "committee_members"
    __table_args__ = (
        PrimaryKeyConstraint("committee_uuid", "member_uuid", "membership_year", name="pk_committee_members"),
        CheckConstraint("membership_year BETWEEN 2000 AND 9999", name="chk_committee_members_membership_year"),
    )

    committee_uuid = Column(UUID(as_uuid=True), ForeignKey("committees.uuid", ondelete="CASCADE"), nullable=False)
    member_uuid = Column(UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="CASCADE"), nullable=False)
    membership_year = Column(SmallInteger, nullable=False)
    assigned_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    assigned_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    committee = relationship("Committee", back_populates="memberships")
    member = relationship("Member", back_populates="committee_memberships")
    assigned_by_user = relationship("User", back_populates="assigned_committee_memberships")

    def __repr__(self):
        return (
            f"<CommitteeMember committee_uuid={self.committee_uuid} "
            f"member_uuid={self.member_uuid} year={self.membership_year}>"
        )


class MemberSheet(Base):
    """Yearly flying summary and expense access state for a member."""

    __tablename__ = "member_sheets"
    __table_args__ = (
        UniqueConstraint("member_uuid", "year", name="uq_member_sheets_member_year"),
        CheckConstraint("year BETWEEN 2000 AND 9999", name="chk_member_sheets_year"),
        CheckConstraint("fare_type BETWEEN 1 AND 5", name="chk_member_sheets_fare_type"),
        CheckConstraint("hours_count >= 0", name="chk_member_sheets_hours_count"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_uuid = Column(UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="CASCADE"), nullable=False, index=True)
    year = Column(SmallInteger, nullable=False, index=True)
    licence_number = Column(String(100), nullable=True)
    fare_type = Column(SmallInteger, nullable=False)
    hours_count = Column(Numeric(8, 2), nullable=False, default=0)
    expense_access_token_hash = Column(String(255), nullable=True)
    expense_access_enabled = Column(Boolean, nullable=False, default=False)
    portal_password_hash = Column(String(255), nullable=True, comment="SHA256 hash of portal password; if NULL, default = ffvp_id_YYYYMMDD")
    season_start_date = Column(Date, nullable=True)
    season_end_date = Column(Date, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    member = relationship("Member", back_populates="member_sheets")
    updated_by_user = relationship("User", back_populates="updated_member_sheets")

    def __repr__(self):
        return f"<MemberSheet uuid={self.uuid} member_uuid={self.member_uuid} year={self.year}>"


class MemberRegistration(Base):
    """Dated registration validity period for a member."""

    __tablename__ = "member_registrations"
    __table_args__ = (
        UniqueConstraint("member_uuid", "start_date", "end_date", name="uq_member_registrations_period"),
        CheckConstraint("registered_for_year BETWEEN 2000 AND 9999", name="chk_member_registrations_year"),
        CheckConstraint("registration_type BETWEEN 1 AND 8", name="chk_member_registrations_type"),
        CheckConstraint("status BETWEEN 1 AND 3", name="chk_member_registrations_status"),
        CheckConstraint("end_date >= start_date", name="chk_member_registrations_date_range"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_uuid = Column(UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="CASCADE"), nullable=False, index=True)
    start_date = Column(Date, nullable=False, index=True)
    end_date = Column(Date, nullable=False, index=True)
    registered_for_year = Column(SmallInteger, nullable=False, index=True)
    registration_type = Column(SmallInteger, nullable=False)
    status = Column(SmallInteger, nullable=False, default=1, index=True)
    registered_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    registered_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, nullable=True)

    member = relationship("Member", back_populates="registrations")
    registered_by_user = relationship("User", back_populates="registered_member_registrations")

    def __repr__(self):
        return (
            f"<MemberRegistration uuid={self.uuid} member_uuid={self.member_uuid} "
            f"{self.start_date}..{self.end_date}>"
        )


# ============================================================================
# Accounting Module Models
# ============================================================================


class AccountingFiscalYear(Base):
    """Fiscal year for accounting: posting period, locking, partitioning key."""

    __tablename__ = "accounting_fiscal_years"
    __table_args__ = (
        CheckConstraint("end_date > start_date", name="chk_fy_dates"),
        CheckConstraint("state IN (1, 2, 3)", name="chk_fy_state"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(16), nullable=False, unique=True, index=True)
    label = Column(String(64), nullable=False)
    year = Column(SmallInteger, nullable=False, unique=True, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    state = Column(SmallInteger, nullable=False, default=1)  # 1=Open, 2=Closed, 3=Reopened
    closed_at = Column(DateTime(timezone=True), nullable=True)
    closed_by = Column(Integer, nullable=True)  # references users.id
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    accounting_entries = relationship("AccountingEntry", back_populates="fiscal_year")

    def __repr__(self):
        return f"<AccountingFiscalYear code={self.code} year={self.year} state={self.state}>"


class PricingVersion(Base):
    """Pricing version scoped by fiscal year with date validity window."""

    __tablename__ = "pricing_versions"
    __table_args__ = (
        CheckConstraint("status IN (1, 2, 3)", name="chk_pricing_version_status"),
        CheckConstraint("to_date IS NULL OR to_date >= from_date", name="chk_pricing_version_dates"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    fiscal_year_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid"), nullable=False, index=True)
    # NULL = global pricing; set to scope this version to a specific asset type
    asset_family_uuid = Column(UUID(as_uuid=True), ForeignKey("asset_families.uuid", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=True)
    status = Column(SmallInteger, nullable=False, default=1)  # 1=Draft, 2=Active, 3=Archived
    is_locked = Column(Boolean, nullable=False, default=False)
    use_pack = Column(Boolean, nullable=False, default=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    fiscal_year = relationship("AccountingFiscalYear")
    asset_family = relationship("AssetFamily", back_populates="pricing_versions")
    created_by_user = relationship("User")
    items = relationship("PricingItem", back_populates="pricing_version", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<PricingVersion uuid={self.uuid} fiscal_year={self.fiscal_year_uuid} from={self.from_date} to={self.to_date}>"


class PricingItem(Base):
    """Individual priced item within a pricing version."""

    __tablename__ = "pricing_items"
    __table_args__ = (
        CheckConstraint("unit IN (1, 2, 3, 4, 5, 6, 7)", name="chk_pricing_items_unit"),
        CheckConstraint("base_price >= 0", name="chk_pricing_items_base_price"),
        CheckConstraint(
            "age_discount_percent >= 0 AND age_discount_percent <= 100",
            name="chk_pricing_items_age_discount",
        ),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    pricing_version_uuid = Column(
        UUID(as_uuid=True), ForeignKey("pricing_versions.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    # NULL = applies to all flight types; set to restrict to a specific flight type
    flight_type_uuid = Column(
        UUID(as_uuid=True), ForeignKey("asset_flight_types.uuid", ondelete="SET NULL"), nullable=True, index=True
    )
    name = Column(String(120), nullable=False)
    # 1=FlightTime(h), 2=EngineTimeMinute, 3=EngineTime1_100h, 4=FlightDuration, 5=PerFlight, 6=Fixed, 7=FixedDurationTranche
    unit = Column(SmallInteger, nullable=False)
    base_price = Column(Numeric(10, 4), nullable=False)
    # When True, tiers are applied progressively (each bracket priced at its own rate)
    is_progressive = Column(Boolean, nullable=False, default=False)
    # Percentage discount applied to this item when the member is under-25 eligible (0 = no discount)
    age_discount_percent = Column(Numeric(5, 2), nullable=False, default=0)
    # Revenue account credited at billing time (NULL allowed during setup)
    gl_account_credit_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    pricing_version = relationship("PricingVersion", back_populates="items")
    flight_type = relationship("FlightType")
    gl_account_credit = relationship("AccountingAccount", foreign_keys=[gl_account_credit_uuid])
    tiers = relationship(
        "PricingItemTier",
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="PricingItemTier.sort_order",
    )

    def __repr__(self):
        return f"<PricingItem uuid={self.uuid} version={self.pricing_version_uuid} unit={self.unit}>"


class PricingItemTier(Base):
    """Pricing bracket for a pricing item.

    Two modes controlled by ``PricingItem.is_progressive``:

    * **Non-progressive** (default): the last bracket whose ``from_qty <=``
      cumulative consumption sets the unit price for **all** units.
      Example: base=18€, tiers [(3, 9€), (5, 0€)] => free after 5 units.

    * **Progressive**: each bracket contributes its own portion.
      Example: base=18€, tiers [(12, 10€)] => first 12 units at 18€,
      remaining units at 10€.
    """

    __tablename__ = "pricing_item_tiers"
    __table_args__ = (
        CheckConstraint("from_qty > 0", name="chk_pricing_item_tiers_from_qty"),
        CheckConstraint("price >= 0", name="chk_pricing_item_tiers_price"),

    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    pricing_item_uuid = Column(
        UUID(as_uuid=True), ForeignKey("pricing_items.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    from_qty = Column(Numeric(10, 4), nullable=False)
    price = Column(Numeric(10, 4), nullable=False)
    sort_order = Column(SmallInteger, nullable=False, default=0)

    item = relationship("PricingItem", back_populates="tiers")

    def __repr__(self):
        return f"<PricingItemTier item={self.pricing_item_uuid} from_qty={self.from_qty}>"


class AccountingJournal(Base):
    """Journal classification for accounting entries."""

    __tablename__ = "accounting_journals"
    __table_args__ = (CheckConstraint("type IN (1, 2, 3, 4, 5, 6, 7)", name="chk_journal_type"),)

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(10), nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=False)
    type = Column(SmallInteger, nullable=False)  # 1=Sale,2=Purchase,3=Bank,4=Cash,5=General,6=Opening,7=Flights
    default_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    entries = relationship("AccountingEntry", back_populates="journal")
    entry_templates = relationship("AccountingEntryTemplate", back_populates="journal")

    def __repr__(self):
        return f"<AccountingJournal code={self.code} name={self.name}>"


class AccountingAccount(Base):
    """Chart of accounts: PCG-based hierarchical account structure."""

    __tablename__ = "accounting_accounts"
    __table_args__ = (
        CheckConstraint("type IN (1, 2, 3, 4, 5, 9)", name="chk_account_type"),
        CheckConstraint("normal_balance IN (1, 2)", name="chk_account_normal_balance"),
        CheckConstraint("require_id IN (0, 1, 2, 3)", name="chk_account_require_id"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    type = Column(SmallInteger, nullable=False)  # 1=Asset,2=Liability,3=Equity,4=Expense,5=Revenue,9=Analytical
    parent_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True)
    is_posting_allowed = Column(Boolean, nullable=False, default=True)
    normal_balance = Column(SmallInteger, nullable=False)  # 1=Debit, 2=Credit
    is_reconcilable = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    replacement_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True)
    # 0=none, 1=member, 2=asset, 3=supplier — declares what entity tiers_uuid must reference on lines
    require_id = Column(SmallInteger, nullable=False, default=0)

    entries_lines = relationship("AccountingLine", back_populates="account")
    template_lines = relationship("AccountingEntryTemplateLine", back_populates="account")

    def __repr__(self):
        return f"<AccountingAccount code={self.code} name={self.name}>"


class AccountingEntry(Base):
    """Accounting transaction header: double-entry ledger entry."""

    __tablename__ = "accounting_entries"
    __table_args__ = (
        PrimaryKeyConstraint("uuid", "fiscal_year_uuid", name="pk_accounting_entries"),
        CheckConstraint("state IN (1, 2, 3)", name="chk_entry_state"),
        UniqueConstraint("fiscal_year_uuid", "sequence_number", name="uix_entry_sequence"),
    )

    uuid = Column(UUID(as_uuid=True), nullable=False, default=uuid4, index=True)
    fiscal_year_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid"), nullable=False, index=True)
    journal_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_journals.uuid"), nullable=False, index=True)
    entry_date = Column(Date, nullable=False)
    sequence_number = Column(String(64), nullable=True)  # assigned on posting, immutable
    reference = Column(String(255), nullable=True)
    source_document_ref = Column(String(255), nullable=True)
    source_document_date = Column(Date, nullable=True)
    description = Column(String(255), nullable=False)
    state = Column(SmallInteger, nullable=False, default=1)  # 1=Draft, 2=Posted, 3=Cancelled
    # Provenance
    source_system = Column(String(64), nullable=True)
    external_id = Column(String(255), nullable=True)
    import_batch_id = Column(String(64), nullable=True, index=True)
    original_created_at = Column(DateTime(timezone=True), nullable=True)
    original_posted_at = Column(DateTime(timezone=True), nullable=True)
    # Reversal
    reversal_of_entry_uuid = Column(UUID(as_uuid=True), nullable=True)  # no DB FK; enforced at app layer
    reversal_reason = Column(String(255), nullable=True)
    entry_hash = Column(String(64), nullable=True)
    # Audit
    posted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    fiscal_year = relationship("AccountingFiscalYear", back_populates="accounting_entries")
    journal = relationship("AccountingJournal", back_populates="entries")
    lines = relationship("AccountingLine", back_populates="entry", cascade="all, delete-orphan")
    created_by_user = relationship("User")

    def __repr__(self):
        return f"<AccountingEntry uuid={self.uuid} fiscal_year={self.fiscal_year_uuid} state={self.state}>"


class AccountingLine(Base):
    """Double-entry ledger line: debit or credit side of an entry."""

    __tablename__ = "accounting_lines"
    __table_args__ = (
        PrimaryKeyConstraint("uuid", "fiscal_year_uuid", name="pk_accounting_lines"),
        ForeignKeyConstraint(
            ["entry_uuid", "fiscal_year_uuid"],
            ["accounting_entries.uuid", "accounting_entries.fiscal_year_uuid"],
            name="fk_lines_entry",
            ondelete="CASCADE",
        ),
        CheckConstraint("debit >= 0 AND credit >= 0", name="chk_line_amounts_positive"),
        CheckConstraint("debit > 0 OR credit > 0", name="chk_line_at_least_one_amount"),
    )

    uuid = Column(UUID(as_uuid=True), nullable=False, default=uuid4, index=True)
    fiscal_year_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid"), nullable=False, index=True)
    entry_uuid = Column(UUID(as_uuid=True), nullable=False, index=True)
    account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=False, index=True)
    # Entity dimension — interpreted via account.require_id (0=none,1=member,2=asset,3=supplier)
    tiers_uuid = Column(UUID(as_uuid=True), nullable=True, index=True)
    # Amounts
    debit = Column(Numeric(10, 4), nullable=False, default=0.0)
    credit = Column(Numeric(10, 4), nullable=False, default=0.0)
    description = Column(String(255), nullable=True)
    # VAT snapshot
    tax_id = Column(UUID(as_uuid=True), nullable=True)
    tax_code = Column(String(64), nullable=True)
    tax_rate = Column(Numeric(10, 4), nullable=True)
    tax_base = Column(Numeric(10, 4), nullable=True)
    tax_amount = Column(Numeric(10, 4), nullable=True)

    entry = relationship("AccountingEntry", back_populates="lines")
    account = relationship("AccountingAccount", back_populates="entries_lines")

    def __repr__(self):
        return f"<AccountingLine uuid={self.uuid} entry={self.entry_uuid} account={self.account_uuid}>"


class BankStatement(Base):
    """Imported bank/cash statement, scoped to a Banque (3) or Caisse (4) journal + account."""

    __tablename__ = "bank_statements"
    __table_args__ = (
        CheckConstraint(
            "source_format IN ('ofx', 'qfx', 'csv', 'qif', 'mt940')", name="chk_bank_statement_source_format"
        ),
        CheckConstraint(
            "status IN ('imported', 'matching', 'reconciled', 'flagged')", name="chk_bank_statement_status"
        ),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    fiscal_year_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid", ondelete="CASCADE"), nullable=False, index=True)
    journal_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_journals.uuid"), nullable=False, index=True)
    account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=False, index=True)
    import_date = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    statement_date = Column(Date, nullable=False)
    statement_period_start = Column(Date, nullable=True)
    statement_period_end = Column(Date, nullable=True)
    source_format = Column(String(8), nullable=False)
    raw_filename = Column(String(255), nullable=True)
    raw_content_hash = Column(String(64), nullable=True, index=True)
    opening_balance = Column(Numeric(10, 4), default=0)
    closing_balance = Column(Numeric(10, 4), default=0)
    total_debits = Column(Numeric(10, 4), default=0)
    total_credits = Column(Numeric(10, 4), default=0)
    line_count = Column(Integer, default=0)
    status = Column(String(16), nullable=False, default="imported")
    reconciled_balance = Column(Numeric(10, 4), nullable=True)
    balance_difference = Column(Numeric(10, 4), nullable=True)
    reconciled_at = Column(DateTime(timezone=True), nullable=True)
    reconciled_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    fiscal_year = relationship("AccountingFiscalYear")
    journal = relationship("AccountingJournal")
    account = relationship("AccountingAccount")
    lines = relationship("BankStatementLine", back_populates="statement", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<BankStatement uuid={self.uuid} date={self.statement_date} status={self.status}>"


class BankStatementLine(Base):
    """Single transaction line of an imported bank statement, carrying its own reconciliation state.

    accounting_lines is never modified: reconciliation state lives entirely here to preserve
    posted-entry immutability. matched_entry_uuid/matched_fiscal_year_uuid have no DB FK because
    accounting_entries has a composite primary key (uuid, fiscal_year_uuid) — same pattern as
    AccountingEntry.reversal_of_entry_uuid.
    """

    __tablename__ = "bank_statement_lines"
    __table_args__ = (
        CheckConstraint(
            "match_status IN ('unmatched', 'auto_matched', 'manually_matched', 'excluded', 'discrepancy')",
            name="chk_bank_lines_match_status",
        ),
        CheckConstraint(
            "discrepancy_type IS NULL OR discrepancy_type IN ('missing_entry', 'amount_variance', 'timing', 'duplicate')",
            name="chk_bank_lines_discrepancy_type",
        ),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    statement_uuid = Column(UUID(as_uuid=True), ForeignKey("bank_statements.uuid", ondelete="CASCADE"), nullable=False, index=True)
    line_index = Column(Integer, nullable=False, default=0)
    line_date = Column(Date, nullable=False)
    description = Column(Text, nullable=True)
    amount = Column(Numeric(10, 4), nullable=False)  # positive = credit, negative = debit
    reference = Column(String(255), nullable=True)
    counterparty = Column(String(255), nullable=True)
    bank_raw_data = Column(JSON, nullable=True)
    match_status = Column(String(20), nullable=False, default="unmatched")
    matched_entry_uuid = Column(UUID(as_uuid=True), nullable=True, index=True)  # no DB FK
    matched_fiscal_year_uuid = Column(UUID(as_uuid=True), nullable=True)
    # Which specific AccountingLine of the matched entry this statement line reconciles
    # against — an entry can have several lines on the reconciled account (e.g. a payroll
    # entry with multiple distinct 512 withdrawals), each matchable to a different
    # statement line. No DB FK for the same reason as matched_entry_uuid.
    matched_line_uuid = Column(UUID(as_uuid=True), nullable=True, index=True)
    match_confidence = Column(Numeric(4, 3), nullable=True)
    discrepancy_type = Column(String(32), nullable=True)
    discrepancy_notes = Column(Text, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    statement = relationship("BankStatement", back_populates="lines")

    def __repr__(self):
        return f"<BankStatementLine uuid={self.uuid} date={self.line_date} amount={self.amount} status={self.match_status}>"


class BankCsvMapping(Base):
    """Per-user saved CSV column mapping for bank statement imports."""

    __tablename__ = "bank_csv_mappings"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(100), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    column_mapping = Column(JSON, nullable=False)
    separator = Column(String(4), nullable=True)
    encoding = Column(String(16), nullable=True)
    date_format = Column(String(16), nullable=False, default="DD/MM/YYYY")
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<BankCsvMapping uuid={self.uuid} name={self.name}>"


class ChequeRemittance(Base):
    """A 'remise de chèque' — a batch deposit of previously-received cheques.

    Mirrors BankStatement/BankStatementLine's approach of tracking external
    matching state outside accounting_entries/accounting_lines to preserve
    posted-entry immutability: which cheque-receipt entries were consumed by
    a deposit is recorded here, not on the entries themselves.
    """

    __tablename__ = "cheque_remittances"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    fiscal_year_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid", ondelete="CASCADE"), nullable=False, index=True)
    remittance_date = Column(Date, nullable=False)
    deposit_entry_uuid = Column(UUID(as_uuid=True), nullable=False)  # no DB FK — accounting_entries has a composite PK
    total_amount = Column(Numeric(10, 4), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    lines = relationship("ChequeRemittanceLine", back_populates="remittance", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<ChequeRemittance uuid={self.uuid} date={self.remittance_date} total={self.total_amount}>"


class ChequeRemittanceLine(Base):
    """One cheque-receipt entry consumed by a ChequeRemittance (entry-granularity, not line-granularity)."""

    __tablename__ = "cheque_remittance_lines"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    remittance_uuid = Column(UUID(as_uuid=True), ForeignKey("cheque_remittances.uuid", ondelete="CASCADE"), nullable=False, index=True)
    source_entry_uuid = Column(UUID(as_uuid=True), nullable=False, index=True)  # no DB FK, see ChequeRemittance
    source_fiscal_year_uuid = Column(UUID(as_uuid=True), nullable=False)
    amount = Column(Numeric(10, 4), nullable=False)

    remittance = relationship("ChequeRemittance", back_populates="lines")

    def __repr__(self):
        return f"<ChequeRemittanceLine uuid={self.uuid} source_entry={self.source_entry_uuid}>"


class AccountingEntryTemplate(Base):
    """Reusable journal entry model for recurring or manual prefills."""

    __tablename__ = "accounting_entry_templates"
    __table_args__ = (
        CheckConstraint("recurrence_type IN (1, 2, 3, 4)", name="chk_entry_template_recurrence_type"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(120), nullable=False)
    journal_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_journals.uuid"), nullable=False, index=True)
    description = Column(String(255), nullable=True)
    default_reference = Column(String(255), nullable=True)
    recurrence_type = Column(SmallInteger, nullable=False, default=1)  # 1=Manual, 2=Monthly, 3=Quarterly, 4=Yearly
    is_active = Column(Boolean, nullable=False, default=True)
    # Scheduling (pluriannual — no fiscal_year_uuid)
    valid_from = Column(Date, nullable=True)
    valid_until = Column(Date, nullable=True)
    next_scheduled_date = Column(Date, nullable=True)
    last_generated_at = Column(DateTime(timezone=True), nullable=True)
    last_generated_entry_uuid = Column(UUID(as_uuid=True), nullable=True)  # no DB FK, app-layer only
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    journal = relationship("AccountingJournal", back_populates="entry_templates")
    lines = relationship("AccountingEntryTemplateLine", back_populates="template", cascade="all, delete-orphan")
    created_by_user = relationship("User")

    def __repr__(self):
        return f"<AccountingEntryTemplate code={self.code} name={self.name}>"


class AccountingEntryTemplateLine(Base):
    """Stored line definition for a reusable entry template."""

    __tablename__ = "accounting_entry_template_lines"
    __table_args__ = (
        CheckConstraint("debit >= 0 AND credit >= 0", name="chk_entry_template_line_amounts_positive"),
        CheckConstraint(
            "formula_type = 'rounding_adjustment' OR debit > 0 OR credit > 0",
            name="chk_entry_template_line_at_least_one_amount",
        ),
        CheckConstraint(
            "formula_type IN ('fixed', 'percentage', 'previous_period', 'rounding_adjustment')",
            name="chk_template_line_formula_type",
        ),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    template_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_entry_templates.uuid", ondelete="CASCADE"), nullable=False, index=True)
    account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=False, index=True)
    sort_order = Column(SmallInteger, nullable=False, default=1)
    tiers_uuid = Column(UUID(as_uuid=True), nullable=True)
    debit = Column(Numeric(10, 4), nullable=False, default=0.0)
    credit = Column(Numeric(10, 4), nullable=False, default=0.0)
    description = Column(String(255), nullable=True)
    formula_type = Column(String(16), nullable=False, default='fixed')
    formula_params = Column(JSON, nullable=True)

    template = relationship("AccountingEntryTemplate", back_populates="lines")
    account = relationship("AccountingAccount", back_populates="template_lines")

    def __repr__(self):
        return f"<AccountingEntryTemplateLine uuid={self.uuid} template={self.template_uuid}>"


# ---------------------------------------------------------------------------
# Assets module
# ---------------------------------------------------------------------------

class AssetFamily(Base):
    """Asset family catalog: glider, tow plane, winch, trailer, engine, …

    Carries 4 optional GL account defaults (acquisition/depreciation/charge/revenue) used by
    individual assets in the family unless overridden per-asset, and an `is_priced` flag marking
    whether the family is expected to carry a flight tariff (pricing_versions) at all — most
    accounting-only families (trailers, refits, ground equipment) are not priced.
    """

    __tablename__ = "asset_families"
    __table_args__ = (
        CheckConstraint("pricing_strategy IN (1, 2, 3, 4, 5, 6)", name="chk_asset_families_pricing_strategy"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=False)
    # 1=FlightHours, 2=EngineTime, 3=PerFlight, 4=PerDuration, 5=PerUnit, 6=FlatRate
    pricing_strategy = Column(SmallInteger, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)
    is_priced = Column(Boolean, nullable=False, default=True, comment="Whether this family is expected to carry a flight tariff (pricing_versions).")

    acquisition_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Default fixed-asset account for acquisition cost (class 2, e.g. 218xx). Overridable per-asset.",
    )
    depreciation_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Default accumulated depreciation account, contra-asset (class 28). Overridable per-asset.",
    )
    charge_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Default general expense account (class 6, e.g. 681 dotation aux amortissements). Overridable per-asset.",
    )
    revenue_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Default revenue account (class 7). Overridable per-asset.",
    )

    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    assets = relationship("Asset", back_populates="asset_family")
    pricing_versions = relationship("PricingVersion", back_populates="asset_family")
    acquisition_account = relationship("AccountingAccount", foreign_keys=[acquisition_account_uuid])
    depreciation_account = relationship("AccountingAccount", foreign_keys=[depreciation_account_uuid])
    charge_account = relationship("AccountingAccount", foreign_keys=[charge_account_uuid])
    revenue_account = relationship("AccountingAccount", foreign_keys=[revenue_account_uuid])

    @property
    def acquisition_account_code(self) -> str | None:
        return self.acquisition_account.code if self.acquisition_account else None

    @property
    def depreciation_account_code(self) -> str | None:
        return self.depreciation_account.code if self.depreciation_account else None

    @property
    def charge_account_code(self) -> str | None:
        return self.charge_account.code if self.charge_account else None

    @property
    def revenue_account_code(self) -> str | None:
        return self.revenue_account.code if self.revenue_account else None

    def __repr__(self):
        return f"<AssetFamily code={self.code} name={self.name}>"


class FlightType(Base):
    """Global flight/usage types (e.g. solo, dual, cross-country, tow) — not tied to a specific asset type."""

    __tablename__ = "asset_flight_types"
    __table_args__ = (
        UniqueConstraint("code", name="uq_asset_flight_types_code"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    launch_type = Column(Integer, nullable=True, unique=True, comment="Planche launch_type integer (0, 1, 2…). Enables pricing per launch type (remorquage, dépannage, convoyage…)")

    def __repr__(self):
        return f"<FlightType code={self.code} launch_type={self.launch_type}>"


class Asset(Base):
    """Individual asset record: glider, tow plane, winch, trailer, engine, etc."""

    __tablename__ = "assets"
    __table_args__ = (
        CheckConstraint("status IN (1, 2, 3, 4, 5)", name="chk_asset_status"),
        CheckConstraint("ownership IN (1, 2)", name="chk_asset_ownership"),
        CheckConstraint(
            "purchase_price IS NULL OR purchase_price >= 0",
            name="chk_assets_price_positive",
        ),
        CheckConstraint(
            "residual_value IS NULL OR residual_value >= 0",
            name="chk_assets_residual_positive",
        ),
        CheckConstraint(
            "parent_asset_uuid IS NULL OR parent_asset_uuid <> uuid",
            name="chk_assets_no_self_parent",
        ),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    asset_family_uuid = Column(UUID(as_uuid=True), ForeignKey("asset_families.uuid"), nullable=False, index=True)
    parent_asset_uuid = Column(
        UUID(as_uuid=True), ForeignKey("assets.uuid"), nullable=True, index=True,
        comment="Self-reference to a parent asset (e.g. a glider) for sub-components (trailer, refit, engine). Max depth 2, enforced in the service layer.",
    )
    code = Column(String(64), nullable=False, unique=True, index=True)
    name = Column(String(150), nullable=False)
    registration = Column(String(32), nullable=True, unique=True, index=True)
    serial_number = Column(String(100), nullable=True)
    manufacturer = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    year_of_manufacture = Column(SmallInteger, nullable=True)
    # 1=Club, 2=Private
    ownership = Column(SmallInteger, nullable=False, default=1)
    # 1=Operational, 2=Maintenance, 3=OutOfService, 4=Disposed, 5=Sold
    status = Column(SmallInteger, nullable=False, default=1, index=True)
    is_bookable = Column(Boolean, nullable=False, default=True, comment="Whether this asset can appear in flight selection and is pushed to Planche. False for accounting-only sub-components.")
    # Financial tracking — GL accounts are configured once on the asset's family (AssetFamily), not here.
    purchase_date = Column(Date, nullable=True)
    purchase_price = Column(Numeric(10, 4), nullable=True)
    depreciation_start_date = Column(Date, nullable=True)
    depreciation_years = Column(SmallInteger, nullable=True)
    residual_value = Column(Numeric(10, 4), nullable=True)
    useful_life_years = Column(SmallInteger, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    osrt_sync_enabled = Column(Boolean, nullable=False, default=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    asset_family = relationship("AssetFamily", back_populates="assets")
    parent_asset = relationship("Asset", remote_side=[uuid], back_populates="child_assets")
    child_assets = relationship("Asset", back_populates="parent_asset")
    updated_by_user = relationship("User")
    status_history = relationship("AssetStatusHistory", back_populates="asset", cascade="all, delete-orphan")
    private_owner_links = relationship("AssetPrivateOwner", back_populates="asset", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Asset code={self.code} registration={self.registration} status={self.status}>"


class AssetPrivateOwner(Base):
    """Current private ownership links between an asset and one or more members."""

    __tablename__ = "asset_private_owners"
    __table_args__ = (
        PrimaryKeyConstraint("asset_uuid", "member_uuid", name="pk_asset_private_owners"),
    )

    asset_uuid = Column(UUID(as_uuid=True), ForeignKey("assets.uuid", ondelete="CASCADE"), nullable=False)
    member_uuid = Column(UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="CASCADE"), nullable=False)
    assigned_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    assigned_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    asset = relationship("Asset", back_populates="private_owner_links")
    member = relationship("Member", back_populates="private_asset_owner_links")
    assigned_by_user = relationship("User")

    def __repr__(self):
        return f"<AssetPrivateOwner asset_uuid={self.asset_uuid} member_uuid={self.member_uuid}>"


class AssetStatusHistory(Base):
    """Immutable audit trail for asset status changes."""

    __tablename__ = "asset_status_history"
    __table_args__ = (
        CheckConstraint("status IN (1, 2, 3, 4, 5)", name="chk_asset_sh_status"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    asset_uuid = Column(UUID(as_uuid=True), ForeignKey("assets.uuid", ondelete="CASCADE"), nullable=False, index=True)
    # 1=Operational, 2=UnderMaintenance, 3=OutOfService, 4=Disposed, 5=Sold
    status = Column(SmallInteger, nullable=False)
    reason = Column(String(255), nullable=True)
    changed_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    changed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    asset = relationship("Asset", back_populates="status_history")
    changed_by_user = relationship("User")

    def __repr__(self):
        return f"<AssetStatusHistory asset={self.asset_uuid} status={self.status} at={self.changed_at}>"


class CostProvisionRule(Base):
    """Rule that drives cost accrual per asset family, metric, and fiscal year."""

    __tablename__ = "cost_provision_rules"
    __table_args__ = (
        CheckConstraint(
            "metric_name IN ('engine_hours','winch_launches','flight_hours','landings')",
            name="chk_cost_rules_metric",
        ),
        CheckConstraint("cost_per_unit > 0", name="chk_cost_rules_cost_per_unit"),
        CheckConstraint("accrual_method IN (1,2,3)", name="chk_cost_rules_accrual_method"),
        CheckConstraint(
            "gl_account_debit_uuid <> gl_account_credit_uuid",
            name="chk_cost_rules_distinct_gl",
        ),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    asset_family_uuid = Column(
        UUID(as_uuid=True), ForeignKey("asset_families.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    fiscal_year_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    # engine_hours, winch_launches, flight_hours, landings
    metric_name = Column(String(32), nullable=False)
    cost_per_unit = Column(Numeric(10, 4), nullable=False)
    gl_account_debit_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="RESTRICT"), nullable=False
    )
    gl_account_credit_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="RESTRICT"), nullable=False
    )
    # 1=RealTime, 2=BatchDaily, 3=BatchMonthly
    accrual_method = Column(SmallInteger, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    asset_family = relationship("AssetFamily")
    fiscal_year = relationship("AccountingFiscalYear")
    gl_account_debit = relationship("AccountingAccount", foreign_keys=[gl_account_debit_uuid])
    gl_account_credit = relationship("AccountingAccount", foreign_keys=[gl_account_credit_uuid])

    def __repr__(self):
        return f"<CostProvisionRule asset_family={self.asset_family_uuid} metric={self.metric_name} fy={self.fiscal_year_uuid}>"


class TypeOfFlight(IntEnum):
    """Enum for type of flight."""

    INSTRUCTION = 0
    SOLO = 1
    INITIATION = 2
    PARTAGE = 3
    PASSAGER = 4
    LACHER = 5
    SUPERVISE = 6
    ESSAI = 7


class LaunchMethod(IntEnum):
    """Enum for launch method."""

    EXTERNE = 0
    TREUIL = 1
    REMORQUEUR = 2
    AUTONOME = 3


class FlightBillingCategory(IntEnum):
    """Analytical billing category for club-billed flights (flight_type_billing_accounts)."""

    CLUB = 1
    ENTRAINEMENT = 2
    ESSAI = 3


class PlancheFlightSnapshot(Base):
    """
    Immutable source payload received from Planche for one flight revision.

    `validated_flights` keeps the current normalized ERP view. This table keeps
    the source-of-truth history keyed by Planche UUID + revision.
    """

    __tablename__ = "planche_flight_snapshots"
    __table_args__ = (
        UniqueConstraint("planche_uuid", "planche_revision", name="uq_planche_flight_snapshot_revision"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    planche_uuid = Column(String, nullable=False, index=True)
    planche_revision = Column(Integer, nullable=False, default=1)
    source_hash = Column(String(64), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="active", index=True)
    payload_json = Column(JSON, nullable=False, default=dict)
    updated_at_source = Column(DateTime(timezone=True), nullable=True, index=True)
    corrected_at = Column(DateTime(timezone=True), nullable=True)
    corrected_by = Column(String, nullable=True)
    correction_reason = Column(Text, nullable=True)
    ack_status = Column(String(32), nullable=False, default="not_acknowledged", index=True)
    ack_at = Column(DateTime(timezone=True), nullable=True)
    ack_error = Column(Text, nullable=True)
    received_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    def __repr__(self):
        return f"<PlancheFlightSnapshot planche_uuid={self.planche_uuid} revision={self.planche_revision}>"


class ValidatedFlight(Base):
    """
    Validated flights imported from Planche backend.

    Status tracking enables modification detection and draft/validated lifecycle.
    Flight prices are calculated and stored in accounting_entries (GL lines) when transferred.
    Links to GL entry via accounting_entry_uuid (single source of truth for pricing).
    """

    __tablename__ = "validated_flights"
    __table_args__ = (
        UniqueConstraint("uuid", name="uq_validated_flights_uuid"),
        UniqueConstraint("planche_uuid", name="uq_validated_flights_planche_uuid"),
        CheckConstraint("type_of_flight BETWEEN 0 AND 7", name="chk_vf_type_of_flight"),
        CheckConstraint("launch_method BETWEEN 0 AND 3", name="chk_vf_launch_method"),
        CheckConstraint("erp_status IN (0, 1, 2, 3)", name="chk_vf_erp_status"),
        CheckConstraint(
            "(erp_status = 3 AND landing_count >= 0) OR (erp_status != 3 AND landing_count >= 1)",
            name="chk_vf_landing_count",
        ),
    )

    # Identifiers
    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    planche_uuid = Column(String, nullable=False, index=True)  # Planche flight UUID (sync key)
    source_snapshot_uuid = Column(
        UUID(as_uuid=True), ForeignKey("planche_flight_snapshots.uuid", ondelete="SET NULL"), nullable=True, index=True
    )

    # Flight context (required)
    aero = Column(String, nullable=True)  # Planche aerodrome code
    jour = Column(Date, nullable=False)  # Flight date
    asset_code = Column(String, nullable=False)  # Glider registration snapshot (Planche glider_immat)
    glider_erp_id = Column(String, nullable=True)  # ERP asset UUID for the glider

    # Pilots (ERP member IDs)
    pilot_erp_id = Column(String, nullable=False)  # Main pilot (ERP member UUID)
    pilot_compta_id = Column(String, nullable=True)  # Planche/legacy accounting ID
    second_pilot_erp_id = Column(String, nullable=True)  # Second pilot/instructor
    second_pilot_id = Column(String, nullable=True)  # Planche/legacy second pilot ID
    charge_to_erp_id = Column(String, nullable=True)  # Billing member (editable, can be CLUB sentinel)
    charge_to_compta_id = Column(String, nullable=True)  # Planche/legacy billing ID
    charge_comment = Column(Text, nullable=True)  # User comment for charge_to selection
    instruction_split = Column(Integer, nullable=False, default=0)  # Instruction split

    vi_erp_id = Column(String, nullable=True)  # VI assignment (ERP identifier)

    # Flight details (required)
    type_of_flight = Column("type_of_flight", Integer, nullable=False)  # Enum: INSTRUCTION, SOLO, etc.
    launch_method = Column("launch_method", Integer, nullable=False)  # Enum: EXTERNE, TREUIL, etc.
    launch_type = Column("launch_type", Integer, nullable=True)  # Launch type (see plan for mapping)

    # Tow/Winch details (optional)
    launch_asset_code = Column(String, nullable=True)  # Tow/winch registration
    launch_machine_erp_id = Column(String, nullable=True)  # ERP asset UUID for the launch machine
    launch_pilot_trigram = Column(String, nullable=True)  # Tow pilot trigram
    launch_instructor_trigram = Column(String, nullable=True)  # Launch instructor trigram

    # Timing & Indexes (required times, optional indices)
    takeoff_time = Column("takeoff_time", String, nullable=False)  # HH:MM format
    landing_time = Column("landing_time", String, nullable=False)  # HH:MM format
    start_index = Column("start_index", Float, nullable=True)  # TMG/tow plane index
    stop_index = Column("stop_index", Float, nullable=True)  # TMG/tow plane index
    engine_time = Column("engine_time", Float, nullable=True)  # Engine time in 1/100ths of hours
    landing_count = Column("landing_count", Integer, nullable=False, default=1)

    # Flight metrics (optional)
    flight_km = Column("flight_km", Float, nullable=True)  # Distance in km
    takeoff_location = Column("takeoff_location", String, nullable=True)  # ICAO code
    landed_location = Column("landed_location", String, nullable=True)  # ICAO code
    observations = Column(Text, nullable=True)  # Free text

    # ERP status and audit metadata
    # 0=validated (draft), 1=transferred (locked), 2=modified_after_transfer, 3=deleted
    erp_status = Column(Integer, nullable=False, default=0, index=True)
    validated_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    validated_by = Column(String, nullable=False)  # User/device ID who validated
    transferred_at = Column(DateTime(timezone=True), nullable=True)  # When transferred to accounting
    transferred_by = Column(String, nullable=True)  # User/device who transferred
    last_export_hash = Column(String, nullable=True)  # Change marker for modification detection
    revision = Column(Integer, nullable=False, default=1)  # Planche revision counter
    source_status = Column(String(32), nullable=False, default="active")  # active/updated/deleted from Planche changes API
    corrected_at = Column(DateTime(timezone=True), nullable=True)
    corrected_by = Column(String, nullable=True)
    correction_reason = Column(Text, nullable=True)

    source_snapshot = relationship("PlancheFlightSnapshot")

    # Accounting entry linkage
    accounting_entry_uuid = Column(UUID(as_uuid=True), nullable=True, unique=True, index=True)  # Link to GL entry
    billing_quote_state = Column(String(16), nullable=True, default="pending")
    has_discount = Column(
        Boolean, nullable=True, default=None,
        comment="Pack discount review outcome for this flight: NULL=never reviewed, "
                "False=reviewed without discount, True=reviewed with discount. "
                "NULL vs False lets discount_review_for_member resume incrementally "
                "instead of re-reviewing every billed flight.",
    )

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self):
        return f"<ValidatedFlight uuid={self.uuid} planche_uuid={self.planche_uuid} asset_code={self.asset_code} jour={self.jour}>"


class AuditLog(Base):
    """
    Immutable audit trail for all Planche sync, import, and validation operations.
    Accessible via dedicated page and droppable by admin.
    """

    __tablename__ = "planche_audit_log"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Operation type: pilot_push, machine_push, flights_pull, flights_validate, flights_transfer, etc.
    operation_type = Column(String, nullable=False, index=True)
    # Affected record UUID (planche_uuid for flights, pilot_id for pilots, etc.)
    affected_record_id = Column(String, nullable=True, index=True)
    # Success/failure status
    status = Column(SmallInteger, nullable=False, default=0)  # 0=success, 1=error, 2=partial
    # Result summary (JSON-like description)
    result_summary = Column(String, nullable=True)
    # Detailed error message if applicable
    error_message = Column(Text, nullable=True)
    # Counts for batch operations
    total_records = Column(Integer, nullable=True, default=0)
    success_count = Column(Integer, nullable=True, default=0)
    failure_count = Column(Integer, nullable=True, default=0)
    # User/system that triggered the operation
    triggered_by = Column(String, nullable=True)
    # Operation metadata (JSON-like)
    audit_metadata = Column(Text, nullable=True)  # JSON string with operation-specific data
    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    def __repr__(self):
        return f"<AuditLog operation={self.operation_type} status={self.status} at={self.created_at}>"


class FederalSyncLog(Base):
    """
    One row per synchronisation attempt for a validated flight toward a federal platform.
    The latest row (by attempt_at DESC) per (validated_flight_uuid, platform) is the current status.
    """

    __tablename__ = "federal_sync_logs"
    __table_args__ = (
        CheckConstraint("platform IN ('gesasso', 'osrt')", name="chk_fsl_platform"),
        CheckConstraint("status IN (0, 1, 2, 3, 4)", name="chk_fsl_status"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    validated_flight_uuid = Column(
        UUID(as_uuid=True),
        ForeignKey("validated_flights.uuid", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    platform = Column(String(16), nullable=False)
    # 0=pas envoyé, 1=en attente, 2=succès, 3=échec, 4=exclu
    status = Column(SmallInteger, nullable=False, default=0)
    external_id = Column(String(64), nullable=True)
    attempt_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    flight = relationship("ValidatedFlight")

    def __repr__(self):
        return f"<FederalSyncLog flight={self.validated_flight_uuid} platform={self.platform} status={self.status}>"


class ViOriginType(IntEnum):
    """Origin/source for VI entitlement ownership and traceability."""

    HELLOASSO = 1
    CLUB = 2
    COMPLEMENTARY = 3
    MANUAL = 4
    PARTNER = 5


class ViEntitlementStatus(IntEnum):
    """Lifecycle status for VI entitlement records."""

    LOADED = 1
    SCHEDULED = 2
    REALIZED = 3
    EXPIRED = 4
    CANCELLED = 5
    CONVERTED = 6


class ViTypeCatalog(Base):
    """Dynamic catalog of VI type codes (VI, JD, STAGE, ...)."""

    __tablename__ = "vi_type_catalog"
    __table_args__ = (
        UniqueConstraint("code", name="uq_vi_type_catalog_code"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    charge_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Charge account for club-billed flights (initiation VI). Overrides flight_billing_settings.default_initiation_charge_account_uuid",
    )
    # --- VI accounting configuration (Steps 1–4) ---
    client_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Advance/liability account for VI payments (e.g. 419100). C in Step 1, D in Steps 2a+2b.",
    )
    revenue_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Revenue account for the flight portion of the voucher (e.g. 7067). C in Step 2a.",
    )
    insurance_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Supplier payable for insurance (e.g. 401-FFVP). C in Step 2b.",
    )
    insurance_tiers_uuid = Column(
        UUID(as_uuid=True), nullable=True,
        comment="Supplier entity UUID for insurance line tiers (e.g. FFVP). No FK — cross-entity.",
    )
    insurance_amount = Column(
        Numeric(10, 4), nullable=True,
        comment="Fixed insurance fee per VI voucher. Deducted from amount_ttc to compute flight portion.",
    )
    insurance_expense_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Expense account for insurance cost (e.g. 616). D in Step 2b alongside C insurance_account. When set, D 419xxx is reduced to flight_portion only.",
    )
    insurance_revenue_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Revenue account for the insurance portion of the voucher (e.g. 7069). C in Step 2a alongside C revenue_account, which is reduced to flight_portion only.",
    )
    max_flights = Column(
        SmallInteger, nullable=False, default=1,
        comment="Maximum number of flights allowed under one entitlement (VI=2, JD=2, future types=N).",
    )
    analytical_cost_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Debit account for analytical cost entry (e.g. 921). Step 3.",
    )
    analytical_reflection_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True,
        comment="Credit account for analytical reflection entry (e.g. 902). Step 3.",
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    updated_by_user = relationship("User")
    entitlements = relationship("ViEntitlement", back_populates="vi_type")
    charge_account = relationship("AccountingAccount", foreign_keys=[charge_account_uuid])
    client_account = relationship("AccountingAccount", foreign_keys=[client_account_uuid])
    revenue_account = relationship("AccountingAccount", foreign_keys=[revenue_account_uuid])
    insurance_account = relationship("AccountingAccount", foreign_keys=[insurance_account_uuid])
    insurance_expense_account = relationship("AccountingAccount", foreign_keys=[insurance_expense_account_uuid])
    insurance_revenue_account = relationship("AccountingAccount", foreign_keys=[insurance_revenue_account_uuid])
    analytical_cost_account = relationship("AccountingAccount", foreign_keys=[analytical_cost_account_uuid])
    analytical_reflection_account = relationship("AccountingAccount", foreign_keys=[analytical_reflection_account_uuid])

    @property
    def charge_account_code(self) -> str | None:
        return self.charge_account.code if self.charge_account else None

    @property
    def client_account_code(self) -> str | None:
        return self.client_account.code if self.client_account else None

    @property
    def revenue_account_code(self) -> str | None:
        return self.revenue_account.code if self.revenue_account else None

    @property
    def insurance_account_code(self) -> str | None:
        return self.insurance_account.code if self.insurance_account else None

    @property
    def insurance_expense_account_code(self) -> str | None:
        return self.insurance_expense_account.code if self.insurance_expense_account else None

    @property
    def insurance_revenue_account_code(self) -> str | None:
        return self.insurance_revenue_account.code if self.insurance_revenue_account else None

    @property
    def analytical_cost_account_code(self) -> str | None:
        return self.analytical_cost_account.code if self.analytical_cost_account else None

    @property
    def analytical_reflection_account_code(self) -> str | None:
        return self.analytical_reflection_account.code if self.analytical_reflection_account else None

    def __repr__(self):
        return f"<ViTypeCatalog code={self.code} active={self.is_active}>"


class ViEntitlement(Base):
    """ERP source-of-truth entitlement record for VI/JD/STAGE planning lifecycle."""

    __tablename__ = "vi_entitlements"
    __table_args__ = (
        UniqueConstraint("code", name="uq_vi_entitlements_code"),
        CheckConstraint("origin_type BETWEEN 1 AND 5", name="chk_vi_entitlements_origin_type"),
        CheckConstraint("status BETWEEN 1 AND 5", name="chk_vi_entitlements_status"),
        CheckConstraint(
            "realisation_date IS NULL OR scheduled_date IS NULL OR realisation_date >= scheduled_date",
            name="chk_vi_entitlements_date_consistency",
        ),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(64), nullable=False, index=True)
    vi_type_uuid = Column(
        UUID(as_uuid=True),
        ForeignKey("vi_type_catalog.uuid", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    description = Column(Text, nullable=True)
    validity_date = Column(Date, nullable=True, index=True)
    scheduled_date = Column(Date, nullable=True, index=True)
    realisation_date = Column(Date, nullable=True, index=True)
    partner_code = Column(String(64), nullable=True, index=True)
    origin_type = Column(SmallInteger, nullable=False, default=int(ViOriginType.MANUAL))
    origin_ref = Column(String(128), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    status = Column(SmallInteger, nullable=False, default=int(ViEntitlementStatus.LOADED), index=True)
    is_generic = Column(
        Boolean, nullable=False, default=False,
        comment="Catch-all placeholder voucher: bypasses individual flight-link and realization accounting.",
    )
    # --- VI accounting fields (Steps 1–4) ---
    amount_ttc = Column(
        Numeric(10, 4), nullable=True,
        comment="Total voucher amount paid by buyer TTC (flight + insurance). From HelloAsso or manual.",
    )
    insurance_amount_override = Column(
        Numeric(10, 4), nullable=True,
        comment="Per-entitlement insurance override. When set, supersedes vi_type.insurance_amount for realization.",
    )
    buyer_member_uuid = Column(
        UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="SET NULL"), nullable=True, index=True,
        comment="Member who purchased the VI (may be EXT-NNNN before membership).",
    )
    purchase_entry_uuid = Column(
        UUID(as_uuid=True), nullable=True,
        comment="VI entry UUID for Step 1 (D bank / C 419100). Plain UUID — no FK across partitions.",
    )
    realization_entry_uuid = Column(
        UUID(as_uuid=True), nullable=True,
        comment="VI entry UUID for Steps 2a+2b (D 419100 / C 7067 + C 401-FFVP). Plain UUID.",
    )
    registered_member_uuid = Column(
        UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="SET NULL"), nullable=True, index=True,
        comment="Member UUID after buyer registers (for Step 4 conversion). May differ from buyer_member_uuid.",
    )
    conversion_entry_uuid = Column(
        UUID(as_uuid=True), nullable=True,
        comment="OD entry UUID for Step 4 member conversion. Plain UUID.",
    )
    planche_synced_at = Column(
        DateTime(timezone=True), nullable=True,
        comment="Timestamp of the last successful push to Planche. Once set, `code` is locked (it is the Planche join key).",
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    vi_type = relationship("ViTypeCatalog", back_populates="entitlements")
    updated_by_user = relationship("User")
    helloasso_staging_rows = relationship("HelloAssoViStaging", back_populates="promoted_vi")
    buyer_member = relationship("Member", foreign_keys=[buyer_member_uuid])
    registered_member = relationship("Member", foreign_keys=[registered_member_uuid])
    flight_links = relationship("ViFlightLink", back_populates="entitlement", cascade="all, delete-orphan")

    @property
    def vi_type_code(self) -> str | None:
        return self.vi_type.code if self.vi_type else None

    def __repr__(self):
        return f"<ViEntitlement code={self.code} status={self.status} type={self.vi_type_uuid}>"


class ViFlightLink(Base):
    """One-to-many: each flight attached to a VI entitlement, with its own analytical entry."""

    __tablename__ = "vi_flight_links"
    __table_args__ = (
        UniqueConstraint("entitlement_uuid", "flight_uuid", name="uq_vi_flight_link"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    entitlement_uuid = Column(
        UUID(as_uuid=True), ForeignKey("vi_entitlements.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    flight_uuid = Column(
        UUID(as_uuid=True), ForeignKey("validated_flights.uuid", ondelete="SET NULL"), nullable=True, index=True,
        comment="NULL if the slot is reserved but the flight not yet identified.",
    )
    sequence = Column(
        SmallInteger, nullable=False, default=1,
        comment="Flight number within this entitlement (1st, 2nd…).",
    )
    analytical_entry_uuid = Column(
        UUID(as_uuid=True), nullable=True,
        comment="OD analytical entry for this flight (D 921 / C 902). Plain UUID — no FK across partitions.",
    )
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    entitlement = relationship("ViEntitlement", back_populates="flight_links")
    flight = relationship("ValidatedFlight")

    def __repr__(self):
        return f"<ViFlightLink entitlement={self.entitlement_uuid} flight={self.flight_uuid} seq={self.sequence}>"


class HelloAssoViStaging(Base):
    """Staging table for HelloAsso import rows before promotion to ERP entitlements."""

    __tablename__ = "helloasso_vi_staging"
    __table_args__ = (
        UniqueConstraint("item_id", name="uq_helloasso_vi_staging_item_id"),
        CheckConstraint("amount_cents IS NULL OR amount_cents >= 0", name="chk_helloasso_vi_staging_amount_cents"),
        CheckConstraint("status BETWEEN 1 AND 3", name="chk_helloasso_vi_staging_status"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    item_id = Column(BigInteger, nullable=False, index=True)
    full_name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True, index=True)
    phone = Column(String(64), nullable=True)
    amount_cents = Column(Integer, nullable=True)
    form_slug = Column(String(128), nullable=True, index=True)
    purchased_at = Column(DateTime(timezone=True), nullable=True, index=True)
    promoted_vi_uuid = Column(
        UUID(as_uuid=True),
        ForeignKey("vi_entitlements.uuid", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    promoted_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(SmallInteger, nullable=False, default=1, index=True)  # 1=staged, 2=promoted, 3=discarded
    raw_payload = Column(JSON, nullable=False, default=dict)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    promoted_vi = relationship("ViEntitlement", back_populates="helloasso_staging_rows")

    def __repr__(self):
        return f"<HelloAssoViStaging item={self.item_id}>"


# ---------------------------------------------------------------------------
# Pack management (catalog, applicability, consumption)
# ---------------------------------------------------------------------------


class PackDefinition(Base):
    """Pack catalog template: defines type, quantity allowance, and accounts."""

    __tablename__ = "pack_definitions"
    __table_args__ = (
        UniqueConstraint("code", name="uq_pack_definitions_code"),
        CheckConstraint(
            "pack_type IN ('flight_hours','winch_launches','tow_launches','engine_time')",
            name="chk_pack_definitions_type",
        ),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    pack_type = Column(String(32), nullable=False)
    quantity_allowance = Column(Numeric(10, 2), nullable=False)
    quantity_unit = Column(String(32), nullable=False, default="hours")
    pack_sales_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True, index=True
    )
    pack_discount_expense_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True, index=True,
        comment="Debit account for REM pack discount expense, normally class 6 (overrides default)",
    )
    priority = Column(Integer, nullable=False, default=0)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    pack_sales_account = relationship("AccountingAccount", foreign_keys=[pack_sales_account_uuid])
    pack_discount_expense_account = relationship("AccountingAccount", foreign_keys=[pack_discount_expense_account_uuid])
    applicability = relationship("PackApplicability", back_populates="pack_definition", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<PackDefinition code={self.code} type={self.pack_type}>"


class PackApplicability(Base):
    """Links a pack definition to a pricing item with a discounted unit price."""

    __tablename__ = "pack_applicability"
    __table_args__ = (
        UniqueConstraint("pack_definition_uuid", "pricing_item_uuid", name="uq_pack_applicability_item"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    pack_definition_uuid = Column(
        UUID(as_uuid=True), ForeignKey("pack_definitions.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    pricing_item_uuid = Column(
        UUID(as_uuid=True), ForeignKey("pricing_items.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    discounted_unit_price = Column(Numeric(10, 4), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    pack_definition = relationship("PackDefinition", back_populates="applicability")
    pricing_item = relationship("PricingItem")

    def __repr__(self):
        return f"<PackApplicability pack={self.pack_definition_uuid} item={self.pricing_item_uuid}>"


class MemberPackConsumption(Base):
    """
    Operational discount tracking: one row per flight line consuming pack units.
    This is NOT an accounting table — it tracks discount eligibility for REM adjustment.
    """

    __tablename__ = "member_pack_consumptions"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    tiers_uuid = Column(
        UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    flight_uuid = Column(
        UUID(as_uuid=True), ForeignKey("validated_flights.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    pack_type = Column(String(32), nullable=False)
    pack_definition_uuid = Column(
        UUID(as_uuid=True), ForeignKey("pack_definitions.uuid", ondelete="SET NULL"), nullable=True, index=True,
        comment="Which pack definition this consumption was applied to (for multi-pack sequencing)",
    )
    purchase_entry_uuid = Column(
        UUID(as_uuid=True), nullable=True, index=True,  # Link to the VT purchase entry (app-level integrity, no FK)
        comment="Which specific pack purchase (VT accounting entry) this consumption was drawn from — "
                "disambiguates consecutive purchases of the same pack_definition_uuid (e.g. 2x25h)",
    )
    valid_from = Column(DateTime(timezone=True), nullable=False, comment="Pack is applicable only to flights on or after this date")
    quantity_consumed = Column(Numeric(10, 2), nullable=False)
    discount_unit_price = Column(Numeric(10, 2), nullable=False)
    total_discount_amount = Column(Numeric(10, 2), nullable=False)
    accounting_entry_uuid = Column(
        UUID(as_uuid=True), nullable=True, index=True  # Link to GL entry (app-level integrity, no FK)
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    member = relationship("Member")
    flight = relationship("ValidatedFlight")
    accounting_entry = relationship(
        "AccountingEntry",
        foreign_keys=[accounting_entry_uuid],
        primaryjoin="MemberPackConsumption.accounting_entry_uuid == AccountingEntry.uuid",
    )

    def __repr__(self):
        return f"<MemberPackConsumption member={self.tiers_uuid} flight={self.flight_uuid} type={self.pack_type}>"


# ==========================================================================
# HR Module — employee profiles, seasons, work calendars, calendar assignments
# ==========================================================================

class HrEmployeeProfile(Base):
    """Employee HR profile linked to an existing member."""

    __tablename__ = "hr_employee_profiles"

    member_uuid = Column(UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="RESTRICT"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    contract_type = Column(String(16), nullable=False)
    hire_date = Column(Date, nullable=False)
    termination_date = Column(Date, nullable=True)
    weekly_hours = Column(Numeric(5, 2), nullable=False, default=35.00)
    annual_work_hours = Column(Numeric(6, 2), nullable=False, default=1607.00)
    current_leave_balance = Column(Numeric(5, 2), nullable=False, default=0)
    last_leave_balance_update = Column(Date, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    member = relationship("Member", foreign_keys=[member_uuid])
    user = relationship("User", foreign_keys=[user_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by])

    def __repr__(self):
        return f"<HrEmployeeProfile member={self.member_uuid} contract={self.contract_type}>"


class HrWorkingTimeCalendar(Base):
    """A working time calendar composed of annual phases, assigned to employees."""

    __tablename__ = "hr_working_time_calendars"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    phases = relationship(
        "HrCalendarPhase",
        back_populates="calendar",
        cascade="all, delete-orphan",
        order_by="HrCalendarPhase.start_month, HrCalendarPhase.start_day",
    )
    employee_assignments = relationship(
        "HrEmployeeCalendarAssignment",
        back_populates="calendar",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<HrWorkingTimeCalendar name={self.name}>"


class HrCalendarPhase(Base):
    """Annual recurring date range (MM-DD) within a working time calendar."""

    __tablename__ = "hr_calendar_phases"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    calendar_uuid = Column(
        UUID(as_uuid=True), ForeignKey("hr_working_time_calendars.uuid", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(100), nullable=False)
    start_month = Column(SmallInteger, nullable=False)
    start_day = Column(SmallInteger, nullable=False)
    end_month = Column(SmallInteger, nullable=False)
    end_day = Column(SmallInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    calendar = relationship("HrWorkingTimeCalendar", back_populates="phases")
    day_rules = relationship(
        "HrPhaseDayRule",
        back_populates="phase",
        cascade="all, delete-orphan",
        order_by="HrPhaseDayRule.day_of_week, HrPhaseDayRule.apply_on_week",
    )

    def __repr__(self):
        return (
            f"<HrCalendarPhase name={self.name} "
            f"{self.start_month:02d}/{self.start_day:02d}–{self.end_month:02d}/{self.end_day:02d}>"
        )


class HrPhaseDayRule(Base):
    """Weekly schedule rule for one day-of-week within a calendar phase."""

    __tablename__ = "hr_phase_day_rules"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    phase_uuid = Column(
        UUID(as_uuid=True), ForeignKey("hr_calendar_phases.uuid", ondelete="CASCADE"), nullable=False
    )
    day_of_week = Column(SmallInteger, nullable=False)  # 1=Monday … 7=Sunday
    is_working = Column(Boolean, nullable=False, default=True)
    expected_hours = Column(Numeric(4, 2), nullable=False, default=0)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    apply_on_week = Column(SmallInteger, nullable=False, default=0)  # 0=all weeks, 1..5=Nth week of month

    phase = relationship("HrCalendarPhase", back_populates="day_rules")

    def __repr__(self):
        return f"<HrPhaseDayRule phase={self.phase_uuid} dow={self.day_of_week} week={self.apply_on_week}>"


class HrEmployeeCalendarAssignment(Base):
    """Links an employee to a working time calendar with optional effective date range."""

    __tablename__ = "hr_employee_calendar_assignments"

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_uuid = Column(
        UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="CASCADE"), nullable=False
    )
    calendar_uuid = Column(
        UUID(as_uuid=True), ForeignKey("hr_working_time_calendars.uuid", ondelete="RESTRICT"), nullable=False
    )
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    member = relationship("Member", foreign_keys=[member_uuid])
    calendar = relationship("HrWorkingTimeCalendar", back_populates="employee_assignments")

    def __repr__(self):
        return f"<HrEmployeeCalendarAssignment member={self.member_uuid} calendar={self.calendar_uuid}>"


# ---- Carburant (fuel) module ----


class Pompe(Base):
    """Fuel pump/tank dispensing point, identified by an opaque QR token used on the public declaration page."""

    __tablename__ = "carburant_pompes"
    __table_args__ = (
        CheckConstraint("type_carburant IN (1, 2)", name="chk_pompe_type_carburant"),
        CheckConstraint("capacite_cuve_l IS NULL OR capacite_cuve_l > 0", name="chk_pompe_capacite_positive"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    nom = Column(String(100), nullable=False)
    # 1=100LL, 2=UL91
    type_carburant = Column(SmallInteger, nullable=False)
    token = Column(String(64), nullable=False, unique=True, index=True)
    actif = Column(Boolean, nullable=False, default=True)
    capacite_cuve_l = Column(Numeric(10, 2), nullable=True)
    # Baseline mechanical counter reading captured when the pump is onboarded into the app,
    # used to cross-check later index_compteur readings — not part of the stock volume calc.
    index_initial = Column(Numeric(10, 2), nullable=True)
    index_initial_date = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    mouvements = relationship("MouvementCarburant", back_populates="pompe")
    ravitaillements = relationship("RavitaillementCarburant", back_populates="pompe")

    def __repr__(self):
        return f"<Pompe nom={self.nom} type_carburant={self.type_carburant} actif={self.actif}>"


class MouvementCarburant(Base):
    """Declared fuel fill-up. Immutable journal: corrections are new rows, never UPDATEs of quantite_l/asset_uuid."""

    __tablename__ = "carburant_mouvements"
    __table_args__ = (
        CheckConstraint("statut IN (1, 2, 3)", name="chk_mvt_carburant_statut"),  # 1=brouillon, 2=valide, 3=rejete
        CheckConstraint("quantite_l > 0", name="chk_mvt_carburant_quantite_positive"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    pompe_uuid = Column(UUID(as_uuid=True), ForeignKey("carburant_pompes.uuid"), nullable=False, index=True)
    asset_uuid = Column(UUID(as_uuid=True), ForeignKey("assets.uuid"), nullable=False, index=True)
    quantite_l = Column(Numeric(8, 2), nullable=False)
    index_compteur = Column(Numeric(10, 2), nullable=True)
    # Free-text, declarative only — captured on an unauthenticated public page, never resolved to a Member.
    membre_declarant = Column(String(150), nullable=False)
    date_saisie = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    statut = Column(SmallInteger, nullable=False, default=1)  # 1=brouillon
    ip_source = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)
    # Set when quantite_l exceeds the pompe's capacite_cuve_l — informational only, does not block validation.
    flag_anomalie = Column(Boolean, nullable=False, default=False)
    commentaire_validation = Column(Text, nullable=True)
    validated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    validated_at = Column(DateTime(timezone=True), nullable=True)

    pompe = relationship("Pompe", back_populates="mouvements")
    asset = relationship("Asset")
    validated_by_user = relationship("User")

    def __repr__(self):
        return (
            f"<MouvementCarburant pompe={self.pompe_uuid} asset={self.asset_uuid} "
            f"quantite_l={self.quantite_l} statut={self.statut}>"
        )


class RavitaillementCarburant(Base):
    """Pump/tank replenishment (e.g. a supplier delivery), entered directly by an admin.

    Unlike MouvementCarburant, this is admin-entered only (never via the public form) and
    counts toward stock immediately — no brouillon/valide/rejete workflow.
    """

    __tablename__ = "carburant_ravitaillements"
    __table_args__ = (
        CheckConstraint("quantite_l > 0", name="chk_ravitaillement_quantite_positive"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    pompe_uuid = Column(UUID(as_uuid=True), ForeignKey("carburant_pompes.uuid"), nullable=False, index=True)
    quantite_l = Column(Numeric(10, 2), nullable=False)
    date_ravitaillement = Column(Date, nullable=False)
    note = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    pompe = relationship("Pompe", back_populates="ravitaillements")
    created_by_user = relationship("User")

    def __repr__(self):
        return f"<RavitaillementCarburant pompe={self.pompe_uuid} quantite_l={self.quantite_l} date={self.date_ravitaillement}>"
