"""    
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Authentication and authorization routes for ERP-CLUB API
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

import os
import logging
from typing import Optional

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import (
    cleanup_expired_challenges,
    cleanup_expired_trusted_devices,
    cleanup_expired_tokens,
    create_auth_challenge,
    create_access_token,
    create_trusted_device,
    decode_token,
    generate_pin_code,
    generate_trusted_device_token,
    get_active_session_by_token,
    get_current_user,
    get_user_capabilities,
    get_user_roles,
    get_valid_trusted_device,
    hash_password,
    hash_pin,
    revoke_session_token,
    revoke_trusted_device,
    is_pre_auth_payload,
    store_session_token,
    verify_password,
)
from constants import (
    AUTH_LEVEL_FULL_AUTH,
    AUTH_LEVEL_PRE_AUTH,
    PIN_EXPIRATION_MINUTES,
    PIN_MAX_ATTEMPTS,
    ROLE_CODE_ADMIN,
    ROLE_SEEDS,
    TOKEN_KIND_FULL_AUTH,
    TOKEN_KIND_PRE_AUTH,
    TRUSTED_DEVICE_COOKIE_NAME,
    TRUSTED_DEVICE_DAYS,
)
from models import AuthChallenge, Capability, Role, RoleCapability, User, UserRole, UserSettings
from services.email import send_pin_email

router = APIRouter()
logger = logging.getLogger(__name__)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    prenom: Optional[str] = None
    nom: Optional[str] = None


class LoginResponse(BaseModel):
    auth_state: str
    access_token: Optional[str] = None
    pre_auth_token: Optional[str] = None
    requires_pin: bool = False
    token_type: str = "bearer"
    expires_at: str
    user: Optional[dict] = None


class VerifyPinRequest(BaseModel):
    pre_auth_token: str
    pin: str
    device_name: Optional[str] = None


async def ensure_seeded_roles_and_capabilities(db: AsyncSession) -> None:
    existing_roles_result = await db.execute(select(Role.slug))
    existing_roles = set(existing_roles_result.scalars().all())
    for code, slug, name in ROLE_SEEDS:
        if slug not in existing_roles:
            db.add(Role(code=code, slug=slug, name=name, is_active=True))

    if db.new:
        await db.commit()

    capabilities = [
        ("EDIT_FLIGHTS", "Gestion des vols"),
        ("MANAGE_PRICES", "Gestion des tarifs"),
        ("VIEW_FINANCIALS", "Lecture finance"),
        ("MANAGE_USERS", "Gestion des utilisateurs"),
        ("MEMBER_PORTAL", "Acces portail membre"),
    ]
    existing_caps_result = await db.execute(select(Capability.code))
    existing_caps = set(existing_caps_result.scalars().all())
    for code, name in capabilities:
        if code not in existing_caps:
            db.add(Capability(code=code, name=name))

    if db.new:
        await db.commit()

    # Admin gets all capabilities by default.
    admin_role_result = await db.execute(select(Role).where(Role.code == ROLE_CODE_ADMIN))
    admin_role = admin_role_result.scalar_one_or_none()
    if admin_role is None:
        return

    all_caps_result = await db.execute(select(Capability))
    all_caps = all_caps_result.scalars().all()
    for cap in all_caps:
        link_result = await db.execute(
            select(RoleCapability).where(
                RoleCapability.role_id == admin_role.id,
                RoleCapability.capability_id == cap.id,
            )
        )
        if link_result.scalar_one_or_none() is None:
            db.add(RoleCapability(role_id=admin_role.id, capability_id=cap.id, scope="all"))

    if db.new:
        await db.commit()


async def ensure_user_has_admin_role(db: AsyncSession, user: User) -> None:
    admin_role_result = await db.execute(select(Role).where(Role.code == ROLE_CODE_ADMIN))
    admin_role = admin_role_result.scalar_one_or_none()
    if admin_role is None:
        return

    existing_result = await db.execute(
        select(UserRole).where(UserRole.user_id == user.id, UserRole.role_id == admin_role.id)
    )
    if existing_result.scalar_one_or_none() is None:
        db.add(UserRole(user_id=user.id, role_id=admin_role.id))
        await db.commit()


async def build_user_payload(db: AsyncSession, user: User) -> dict:
    roles = await get_user_roles(db=db, user_id=user.id)
    capabilities = await get_user_capabilities(db=db, user_id=user.id)
    return {
        "id": user.id,
        "email": user.email,
        "prenom": user.prenom,
        "nom": user.nom,
        "roles": roles,
        "capabilities": capabilities,
    }


def get_request_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


@router.post("/login")
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    await ensure_seeded_roles_and_capabilities(db)
    await cleanup_expired_tokens(db)
    await cleanup_expired_challenges(db)
    await cleanup_expired_trusted_devices(db)

    user_count_result = await db.execute(select(User.id))
    users_exist = user_count_result.first() is not None

    if not users_exist:
        bootstrap_user = User(
            email=payload.email,
            password_hash=hash_password(payload.password),
            nom=payload.nom or "Admin",
            prenom=payload.prenom or "Initial",
            is_active=True,
            auth_expiration_date=None,
        )
        db.add(bootstrap_user)
        await db.commit()
        await db.refresh(bootstrap_user)
        await ensure_user_has_admin_role(db=db, user=bootstrap_user)
        user = bootstrap_user
    else:
        result = await db.execute(select(User).where(User.email == payload.email))
        user = result.scalar_one_or_none()

        if user is None or not verify_password(payload.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive",
            )

    trusted_cookie = request.cookies.get(TRUSTED_DEVICE_COOKIE_NAME)
    if trusted_cookie:
        trusted_device = await get_valid_trusted_device(db=db, user_id=user.id, device_token=trusted_cookie)
    else:
        trusted_device = None

    roles = await get_user_roles(db=db, user_id=user.id)
    capabilities = await get_user_capabilities(db=db, user_id=user.id)

    if trusted_device is not None:
        token, expires_at = create_access_token(
            user_id=user.id,
            token_kind=TOKEN_KIND_FULL_AUTH,
            auth_level=AUTH_LEVEL_FULL_AUTH,
            roles=roles,
            capabilities=capabilities,
        )
        await store_session_token(
            db=db,
            user_id=user.id,
            token=token,
            expires_at=expires_at,
            token_kind=TOKEN_KIND_FULL_AUTH,
            auth_level=AUTH_LEVEL_FULL_AUTH,
            trusted_device_id=trusted_device.id,
            ip_address=get_request_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        return LoginResponse(
            auth_state="full_auth",
            access_token=token,
            expires_at=expires_at.isoformat(),
            user=await build_user_payload(db=db, user=user),
        )

    pre_auth_token, expires_at = create_access_token(
        user_id=user.id,
        token_kind=TOKEN_KIND_PRE_AUTH,
        auth_level=AUTH_LEVEL_PRE_AUTH,
    )
    pre_auth_session = await store_session_token(
        db=db,
        user_id=user.id,
        token=pre_auth_token,
        expires_at=expires_at,
        token_kind=TOKEN_KIND_PRE_AUTH,
        auth_level=AUTH_LEVEL_PRE_AUTH,
        ip_address=get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    pin_code = generate_pin_code()
    challenge = await create_auth_challenge(
        db=db,
        user_id=user.id,
        pin_code=pin_code,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=PIN_EXPIRATION_MINUTES),
        max_attempts=PIN_MAX_ATTEMPTS,
    )
    pre_auth_session.challenge_id = challenge.id
    await db.commit()

    pin_sent = await send_pin_email(email_to=user.email, pin_code=pin_code)
    if not pin_sent:
        # Log warning but allow pre-auth to continue - client can still verify PIN manually
        # or admin can help with verification
        logger.warning(f"Failed to send PIN email to {user.email}, but allowing pre-auth to continue")

    return LoginResponse(
        auth_state="pre_auth",
        pre_auth_token=pre_auth_token,
        requires_pin=True,
        expires_at=expires_at.isoformat(),
    )


@router.post("/verify-pin")
async def verify_pin(payload: VerifyPinRequest, request: Request, db: AsyncSession = Depends(get_db)):
    token_payload = decode_token(payload.pre_auth_token)
    if not is_pre_auth_payload(token_payload):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid pre-auth token",
        )

    user_id = int(token_payload.get("sub"))
    pre_auth_session = await get_active_session_by_token(
        db=db,
        token=payload.pre_auth_token,
        token_kind=TOKEN_KIND_PRE_AUTH,
        auth_level=AUTH_LEVEL_PRE_AUTH,
    )
    if pre_auth_session is None or pre_auth_session.challenge_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Pre-auth session not found or expired",
        )

    challenge_result = await db.execute(
        select(AuthChallenge).where(
            AuthChallenge.id == pre_auth_session.challenge_id,
            AuthChallenge.user_id == user_id,
        )
    )
    challenge = challenge_result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if challenge is None or challenge.consumed_at is not None or challenge.expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="PIN challenge expired or invalid",
        )

    if challenge.attempts_count >= challenge.max_attempts:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Maximum PIN attempts reached",
        )

    if hash_pin(payload.pin) != challenge.pin_hash:
        challenge.attempts_count += 1
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid PIN code",
        )

    challenge.consumed_at = now
    await db.commit()

    user_result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    device_token = generate_trusted_device_token()
    trusted_device = await create_trusted_device(
        db=db,
        user_id=user.id,
        device_token=device_token,
        device_name=payload.device_name,
        ip_address=get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
        expires_at=now + timedelta(days=TRUSTED_DEVICE_DAYS),
    )

    roles = await get_user_roles(db=db, user_id=user.id)
    capabilities = await get_user_capabilities(db=db, user_id=user.id)
    full_token, full_expires_at = create_access_token(
        user_id=user.id,
        token_kind=TOKEN_KIND_FULL_AUTH,
        auth_level=AUTH_LEVEL_FULL_AUTH,
        roles=roles,
        capabilities=capabilities,
    )
    await store_session_token(
        db=db,
        user_id=user.id,
        token=full_token,
        expires_at=full_expires_at,
        token_kind=TOKEN_KIND_FULL_AUTH,
        auth_level=AUTH_LEVEL_FULL_AUTH,
        trusted_device_id=trusted_device.id,
        ip_address=get_request_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    response = Response(
        content=LoginResponse(
            auth_state="full_auth",
            access_token=full_token,
            expires_at=full_expires_at.isoformat(),
            user=await build_user_payload(db=db, user=user),
        ).model_dump_json(),
        media_type="application/json",
    )
    response.set_cookie(
        key=TRUSTED_DEVICE_COOKIE_NAME,
        value=device_token,
        max_age=TRUSTED_DEVICE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=os.getenv("ENVIRONMENT", "DEV").upper() == "PROD",
        samesite="lax",
        path="/",
    )
    return response


@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_user),
    request: Request = None,
    forget_device: bool = False,
    db: AsyncSession = Depends(get_db),
):
    response = Response(
        content=f'{{"message":"Logged out","user_id":{current_user.id}}}',
        media_type="application/json",
    )

    auth_header = request.headers.get("authorization") if request else None
    if auth_header and auth_header.lower().startswith("bearer "):
        await revoke_session_token(db, auth_header[7:])

    # Keep trusted-device by default so users are not prompted for PIN on every logout/login cycle.
    # Clients can explicitly revoke trusted-device with /logout?forget_device=true.
    trusted_cookie = request.cookies.get(TRUSTED_DEVICE_COOKIE_NAME) if request else None
    if forget_device and trusted_cookie:
        await revoke_trusted_device(db=db, user_id=current_user.id, device_token=trusted_cookie)
        response.delete_cookie(TRUSTED_DEVICE_COOKIE_NAME, path="/")

    return response


@router.get("/me")
async def me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    roles = await get_user_roles(db=db, user_id=current_user.id)
    capabilities = await get_user_capabilities(db=db, user_id=current_user.id)
    settings_result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )
    settings = settings_result.scalar_one_or_none()
    can_change_password = settings.can_change_password if settings is not None else True
    return {
        "id": current_user.id,
        "email": current_user.email,
        "prenom": current_user.prenom,
        "nom": current_user.nom,
        "roles": roles,
        "capabilities": capabilities,
        "is_active": current_user.is_active,
        "auth_expiration_date": current_user.auth_expiration_date.isoformat()
        if current_user.auth_expiration_date
        else None,
        "can_change_password": can_change_password,
    }


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    settings_result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )
    settings = settings_result.scalar_one_or_none()
    can_change = settings.can_change_password if settings is not None else True

    if not can_change:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change is not allowed for this account",
        )

    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )

    current_user.password_hash = hash_password(payload.new_password)
    await db.commit()
