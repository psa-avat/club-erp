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
        CheckConstraint("packs_bought_count >= 0", name="chk_member_sheets_packs_bought_count"),
        CheckConstraint("hours_done_in_pack >= 0", name="chk_member_sheets_hours_done_in_pack"),
        CheckConstraint("remaining_hours_in_pack >= 0", name="chk_member_sheets_remaining_hours_in_pack"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_uuid = Column(UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="CASCADE"), nullable=False, index=True)
    year = Column(SmallInteger, nullable=False, index=True)
    licence_number = Column(String(100), nullable=True)
    fare_type = Column(SmallInteger, nullable=False)
    hours_count = Column(Numeric(8, 2), nullable=False, default=0)
    packs_bought_count = Column(Integer, nullable=False, default=0)
    hours_done_in_pack = Column(Numeric(8, 2), nullable=False, default=0)
    remaining_hours_in_pack = Column(Numeric(8, 2), nullable=False, default=0)
    expense_access_token_hash = Column(String(255), nullable=True)
    expense_access_enabled = Column(Boolean, nullable=False, default=False)
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
    asset_type_uuid = Column(UUID(as_uuid=True), ForeignKey("asset_types.uuid", ondelete="SET NULL"), nullable=True, index=True)
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
    asset_type = relationship("AssetType", back_populates="pricing_versions")
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
        CheckConstraint("pack_price IS NULL OR pack_price >= 0", name="chk_pricing_items_pack_price"),
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
    # Price per unit when pilot has an active pack subscription
    pack_price = Column(Numeric(10, 4), nullable=True)
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
        CheckConstraint("pack_price IS NULL OR pack_price >= 0", name="chk_pricing_item_tiers_pack_price"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    pricing_item_uuid = Column(
        UUID(as_uuid=True), ForeignKey("pricing_items.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    from_qty = Column(Numeric(10, 4), nullable=False)
    price = Column(Numeric(10, 4), nullable=False)
    pack_price = Column(Numeric(10, 4), nullable=True)
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
        CheckConstraint("type IN (1, 2, 3, 4, 5)", name="chk_account_type"),
        CheckConstraint("normal_balance IN (1, 2)", name="chk_account_normal_balance"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    type = Column(SmallInteger, nullable=False)  # 1=Asset,2=Liability,3=Equity,4=Expense,5=Revenue
    parent_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True)
    is_posting_allowed = Column(Boolean, nullable=False, default=True)
    normal_balance = Column(SmallInteger, nullable=False)  # 1=Debit, 2=Credit
    is_reconcilable = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    replacement_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=True)

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
    # Member dimension
    member_uuid = Column(UUID(as_uuid=True), ForeignKey("members.uuid"), nullable=True, index=True)
    member_account_id_snapshot = Column(String(32), nullable=True)
    # Analytical dimension
    analytical_asset_uuid = Column(UUID(as_uuid=True), nullable=True, index=True)
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
    member = relationship("Member")

    def __repr__(self):
        return f"<AccountingLine uuid={self.uuid} entry={self.entry_uuid} account={self.account_uuid}>"


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
        CheckConstraint("debit > 0 OR credit > 0", name="chk_entry_template_line_at_least_one_amount"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    template_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_entry_templates.uuid", ondelete="CASCADE"), nullable=False, index=True)
    account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=False, index=True)
    sort_order = Column(SmallInteger, nullable=False, default=1)
    member_uuid = Column(UUID(as_uuid=True), nullable=True, index=True)
    analytical_asset_uuid = Column(UUID(as_uuid=True), nullable=True, index=True)
    debit = Column(Numeric(10, 4), nullable=False, default=0.0)
    credit = Column(Numeric(10, 4), nullable=False, default=0.0)
    description = Column(String(255), nullable=True)

    template = relationship("AccountingEntryTemplate", back_populates="lines")
    account = relationship("AccountingAccount", back_populates="template_lines")

    def __repr__(self):
        return f"<AccountingEntryTemplateLine uuid={self.uuid} template={self.template_uuid}>"


# ---------------------------------------------------------------------------
# Assets module
# ---------------------------------------------------------------------------

class AssetType(Base):
    """Asset type catalog: glider, tow plane, winch, trailer, engine, …"""

    __tablename__ = "asset_types"
    __table_args__ = (
        CheckConstraint("category IN (1, 2, 3, 4, 5)", name="chk_asset_types_category"),
        CheckConstraint("pricing_strategy IN (1, 2, 3, 4, 5, 6)", name="chk_asset_types_pricing_strategy"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=False)
    # 1=Aircraft, 2=LaunchEquipment, 3=Support, 4=Consumable, 5=Service
    category = Column(SmallInteger, nullable=False, default=1)
    # 1=FlightHours, 2=EngineTime, 3=PerFlight, 4=PerDuration, 5=PerUnit, 6=FlatRate
    pricing_strategy = Column(SmallInteger, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    assets = relationship("Asset", back_populates="asset_type")
    pricing_versions = relationship("PricingVersion", back_populates="asset_type")
    def __repr__(self):
        return f"<AssetType code={self.code} name={self.name}>"


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

    def __repr__(self):
        return f"<FlightType code={self.code}>"


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
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    asset_type_uuid = Column(UUID(as_uuid=True), ForeignKey("asset_types.uuid"), nullable=False, index=True)
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
    # Accounting integration (immobilisation)
    acquisition_account_uuid = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True, index=True)
    accounting_account_code_snapshot = Column(String(32), nullable=True)
    # Financial tracking
    purchase_date = Column(Date, nullable=True)
    purchase_price = Column(Numeric(10, 4), nullable=True)
    depreciation_start_date = Column(Date, nullable=True)
    depreciation_years = Column(SmallInteger, nullable=True)
    residual_value = Column(Numeric(10, 4), nullable=True)
    useful_life_years = Column(SmallInteger, nullable=True)
    notes = Column(Text, nullable=True)
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
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    asset_type = relationship("AssetType", back_populates="assets")
    acquisition_account = relationship("AccountingAccount")
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
    """Rule that drives cost accrual per asset type, metric, and fiscal year."""

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
    asset_type_uuid = Column(
        UUID(as_uuid=True), ForeignKey("asset_types.uuid", ondelete="CASCADE"), nullable=False, index=True
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

    asset_type = relationship("AssetType")
    fiscal_year = relationship("AccountingFiscalYear")
    gl_account_debit = relationship("AccountingAccount", foreign_keys=[gl_account_debit_uuid])
    gl_account_credit = relationship("AccountingAccount", foreign_keys=[gl_account_credit_uuid])

    def __repr__(self):
        return f"<CostProvisionRule asset_type={self.asset_type_uuid} metric={self.metric_name} fy={self.fiscal_year_uuid}>"


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
        CheckConstraint("erp_status IN (0, 1, 2)", name="chk_vf_erp_status"),
        CheckConstraint("landing_count >= 1", name="chk_vf_landing_count"),
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
    charge_to_erp_id = Column(String, nullable=True)  # Billing member
    charge_to_compta_id = Column(String, nullable=True)  # Planche/legacy billing ID
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
    # 0=validated (draft), 1=transferred (locked), 2=modified_after_transfer
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

    @property
    def vi_type_code(self) -> str | None:
        return self.vi_type.code if self.vi_type else None

    def __repr__(self):
        return f"<ViEntitlement code={self.code} status={self.status} type={self.vi_type_uuid}>"


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
    fiscal_year_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    pack_type = Column(String(32), nullable=False)
    quantity_allowance = Column(Numeric(10, 2), nullable=False)
    quantity_unit = Column(String(32), nullable=False, default="hours")
    eligible_asset_type_uuid = Column(
        UUID(as_uuid=True), ForeignKey("asset_types.uuid", ondelete="SET NULL"), nullable=True, index=True
    )
    pack_sales_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True, index=True
    )
    rem_discount_account_uuid = Column(
        UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid", ondelete="SET NULL"), nullable=True, index=True
    )
    priority = Column(Integer, nullable=False, default=0)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    fiscal_year = relationship("AccountingFiscalYear")
    eligible_asset_type = relationship("AssetType")
    pack_sales_account = relationship("AccountingAccount", foreign_keys=[pack_sales_account_uuid])
    rem_discount_account = relationship("AccountingAccount", foreign_keys=[rem_discount_account_uuid])
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
    member_uuid = Column(
        UUID(as_uuid=True), ForeignKey("members.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    flight_uuid = Column(
        UUID(as_uuid=True), ForeignKey("validated_flights.uuid", ondelete="CASCADE"), nullable=False, index=True
    )
    pack_type = Column(String(32), nullable=False)
    quantity_consumed = Column(Numeric(10, 2), nullable=False)
    discount_unit_price = Column(Numeric(10, 2), nullable=False)
    total_discount_amount = Column(Numeric(10, 2), nullable=False)
    accounting_entry_uuid = Column(
        UUID(as_uuid=True), nullable=True, index=True  # Link to GL entry (app-level integrity, no FK)
    )
    is_frozen = Column(Boolean, nullable=False, default=False)
    frozen_at = Column(DateTime(timezone=True), nullable=True)
    frozen_reason = Column(Text, nullable=True)
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
    accounting_entry = relationship("AccountingEntry")

    def __repr__(self):
        return f"<MemberPackConsumption member={self.member_uuid} flight={self.flight_uuid} type={self.pack_type}>"
