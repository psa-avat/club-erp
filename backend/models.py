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

"""SQLAlchemy models for authentication, authorization, and user settings."""

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

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


