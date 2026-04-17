"""    
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - security utilities for authentication, authorization, and session management
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

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from constants import (
    AUTH_LEVEL_FULL_AUTH,
    AUTH_LEVEL_PRE_AUTH,
    PIN_LENGTH,
    TOKEN_KIND_FULL_AUTH,
    TOKEN_KIND_PRE_AUTH,
)
from models import AuthChallenge, Capability, Role, RoleCapability, SessionToken, TrustedDevice, User, UserRole

argon2_hasher = PasswordHasher()
bearer_scheme = HTTPBearer(auto_error=False)

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-me-in-env")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))


def hash_password(password: str) -> Optional[str]:
    """Hash password using argon2."""
    if not password:
        return None
    return argon2_hasher.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password using argon2."""
    if not plain_password or not hashed_password:
        return False
    try:
        argon2_hasher.verify(hashed_password, plain_password)
        return True
    except (VerifyMismatchError, InvalidHash):
        return False
    except Exception:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode("utf-8")).hexdigest()


def generate_pin_code() -> str:
    return f"{secrets.randbelow(10**PIN_LENGTH):0{PIN_LENGTH}d}"


def generate_trusted_device_token() -> str:
    return secrets.token_urlsafe(48)


async def get_user_roles(db: AsyncSession, user_id: int) -> list[str]:
    result = await db.execute(
        select(Role.slug)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id, Role.is_active == True)
    )
    return list(result.scalars().all())


async def get_user_capabilities(db: AsyncSession, user_id: int) -> list[str]:
    result = await db.execute(
        select(Capability.code)
        .join(RoleCapability, RoleCapability.capability_id == Capability.id)
        .join(Role, Role.id == RoleCapability.role_id)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id, Role.is_active == True)
        .distinct()
    )
    return list(result.scalars().all())


def create_access_token(
    user_id: int,
    token_kind: int,
    auth_level: int,
    roles: Optional[list[str]] = None,
    capabilities: Optional[list[str]] = None,
) -> tuple[str, datetime]:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        "sub": str(user_id),
        "token_kind": token_kind,
        "auth_level": auth_level,
        "exp": expires_at,
        "iat": datetime.now(timezone.utc),
    }
    if roles is not None:
        payload["roles"] = roles
    if capabilities is not None:
        payload["capabilities"] = capabilities

    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token, expires_at


async def store_session_token(
    db: AsyncSession,
    user_id: int,
    token: str,
    expires_at: datetime,
    token_kind: int,
    auth_level: int,
    challenge_id: Optional[int] = None,
    trusted_device_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> SessionToken:
    session_token = SessionToken(
        user_id=user_id,
        token_hash=hash_token(token),
        token_kind=token_kind,
        auth_level=auth_level,
        challenge_id=challenge_id,
        trusted_device_id=trusted_device_id,
        expires_at=expires_at,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(session_token)
    await db.commit()
    await db.refresh(session_token)
    return session_token


async def get_active_session_by_token(
    db: AsyncSession,
    token: str,
    token_kind: Optional[int] = None,
    auth_level: Optional[int] = None,
) -> Optional[SessionToken]:
    now = datetime.now(timezone.utc)
    conditions = [
        SessionToken.token_hash == hash_token(token),
        SessionToken.expires_at >= now,
        SessionToken.revoked_at.is_(None),
    ]
    if token_kind is not None:
        conditions.append(SessionToken.token_kind == token_kind)
    if auth_level is not None:
        conditions.append(SessionToken.auth_level == auth_level)

    result = await db.execute(select(SessionToken).where(*conditions))
    return result.scalar_one_or_none()


async def revoke_session_token(db: AsyncSession, token: str) -> None:
    session = await get_active_session_by_token(db=db, token=token)
    if session is not None:
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()


async def cleanup_expired_tokens(db: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(delete(SessionToken).where(SessionToken.expires_at < now))
    await db.commit()


async def create_auth_challenge(
    db: AsyncSession,
    user_id: int,
    pin_code: str,
    expires_at: datetime,
    max_attempts: int,
) -> AuthChallenge:
    challenge = AuthChallenge(
        user_id=user_id,
        pin_hash=hash_pin(pin_code),
        max_attempts=max_attempts,
        expires_at=expires_at,
    )
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)
    return challenge


async def cleanup_expired_challenges(db: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(delete(AuthChallenge).where(AuthChallenge.expires_at < now))
    await db.commit()


async def create_trusted_device(
    db: AsyncSession,
    user_id: int,
    device_token: str,
    expires_at: datetime,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    device_name: Optional[str] = None,
) -> TrustedDevice:
    trusted_device = TrustedDevice(
        user_id=user_id,
        token_hash=hash_token(device_token),
        device_name=device_name,
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=expires_at,
    )
    db.add(trusted_device)
    await db.commit()
    await db.refresh(trusted_device)
    return trusted_device


async def get_valid_trusted_device(db: AsyncSession, user_id: int, device_token: str) -> Optional[TrustedDevice]:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(TrustedDevice).where(
            TrustedDevice.user_id == user_id,
            TrustedDevice.token_hash == hash_token(device_token),
            TrustedDevice.revoked_at.is_(None),
            TrustedDevice.expires_at >= now,
        )
    )
    return result.scalar_one_or_none()


async def revoke_trusted_device(db: AsyncSession, user_id: int, device_token: str) -> None:
    trusted_device = await get_valid_trusted_device(db=db, user_id=user_id, device_token=device_token)
    if trusted_device is not None:
        trusted_device.revoked_at = datetime.now(timezone.utc)
        await db.commit()


async def cleanup_expired_trusted_devices(db: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(delete(TrustedDevice).where(TrustedDevice.expires_at < now))
    await db.commit()


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required",
        )

    token = credentials.credentials
    payload = decode_token(token)

    user_id = int(payload.get("sub"))
    token_kind = int(payload.get("token_kind", 0))
    auth_level = int(payload.get("auth_level", 0))

    session_token = await get_active_session_by_token(
        db=db,
        token=token,
        token_kind=TOKEN_KIND_FULL_AUTH,
        auth_level=AUTH_LEVEL_FULL_AUTH,
    )
    if session_token is None or token_kind != TOKEN_KIND_FULL_AUTH or auth_level != AUTH_LEVEL_FULL_AUTH:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Full authentication required",
        )

    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


def require_capability(capability_code: str):
    async def _capability_guard(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        capabilities = await get_user_capabilities(db=db, user_id=current_user.id)
        if capability_code not in capabilities:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing capability: {capability_code}",
            )
        return current_user

    return _capability_guard


def is_pre_auth_payload(payload: dict) -> bool:
    return (
        int(payload.get("token_kind", 0)) == TOKEN_KIND_PRE_AUTH
        and int(payload.get("auth_level", 0)) == AUTH_LEVEL_PRE_AUTH
    )
