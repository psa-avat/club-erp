from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import (
    cleanup_expired_tokens,
    create_access_token,
    get_current_user,
    hash_password,
    revoke_session_token,
    store_session_token,
    verify_password,
)
from constants import ROLE_ADMIN
from models import User

router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    prenom: Optional[str] = None
    nom: Optional[str] = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str
    user: dict


@router.post("/login")
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    await cleanup_expired_tokens(db)

    user_count_result = await db.execute(select(User.id))
    users_exist = user_count_result.first() is not None

    if not users_exist:
        bootstrap_user = User(
            email=payload.email,
            password_hash=hash_password(payload.password),
            nom=payload.nom or "Admin",
            prenom=payload.prenom or "Initial",
            role=ROLE_ADMIN,
            is_active=True,
            auth_expiration_date=None,
        )
        db.add(bootstrap_user)
        await db.commit()
        await db.refresh(bootstrap_user)
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

    token, expires_at = create_access_token(user.id, user.role)
    await store_session_token(
        db=db,
        user_id=user.id,
        token=token,
        expires_at=expires_at,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return LoginResponse(
        access_token=token,
        expires_at=expires_at.isoformat(),
        user={
            "id": user.id,
            "email": user.email,
            "prenom": user.prenom,
            "nom": user.nom,
            "role": user.role,
        },
    )


@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_user),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
):
    auth_header = request.headers.get("authorization") if request else None
    if auth_header and auth_header.lower().startswith("bearer "):
        await revoke_session_token(db, auth_header[7:])

    return {"message": "Logged out", "user_id": current_user.id}


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "prenom": current_user.prenom,
        "nom": current_user.nom,
        "role": current_user.role,
        "is_active": current_user.is_active,
        "auth_expiration_date": current_user.auth_expiration_date.isoformat()
        if current_user.auth_expiration_date
        else None,
    }
