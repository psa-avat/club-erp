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
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
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
        CheckConstraint("member_category BETWEEN 1 AND 6", name="chk_members_category"),
        CheckConstraint("status BETWEEN 1 AND 4", name="chk_members_status"),
        CheckConstraint("registration_status BETWEEN 1 AND 4", name="chk_members_registration_status"),
        CheckConstraint("seniority IS NULL OR seniority >= 0", name="chk_members_seniority"),
        CheckConstraint(
            "last_registration_year IS NULL OR last_registration_year BETWEEN 2000 AND 9999",
            name="chk_members_last_registration_year",
        ),
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
    seniority = Column(SmallInteger, nullable=True)
    ffvp_id = Column(BigInteger, nullable=True, unique=True, index=True)
    account_id = Column(String(32), nullable=False, unique=True, index=True)
    photo_url = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    status = Column(SmallInteger, nullable=False, default=1, index=True)
    registration_status = Column(SmallInteger, nullable=False, default=1, index=True)
    is_instructor = Column(Boolean, default=False, nullable=False)
    is_employee = Column(Boolean, default=False, nullable=False)
    is_executive = Column(Boolean, default=False, nullable=False)
    is_board_member = Column(Boolean, default=False, nullable=False)
    can_fly = Column(Boolean, default=False, nullable=False, index=True)
    external_auth_enabled = Column(Boolean, default=False, nullable=False)
    last_registration_year = Column(SmallInteger, nullable=True, index=True)
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
    member_sheets = relationship("MemberSheet", back_populates="member", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Member uuid={self.uuid} account_id={self.account_id} {self.first_name} {self.last_name}>"


class Committee(Base):
    """Committee definition with optional manager and budget."""

    __tablename__ = "committees"
    __table_args__ = (
        CheckConstraint("budget_amount IS NULL OR budget_amount >= 0", name="chk_committees_budget_amount"),
    )

    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(32), nullable=False, unique=True, index=True)
    description = Column(String(255), nullable=False)
    budget_amount = Column(Numeric(12, 2), nullable=True)
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

