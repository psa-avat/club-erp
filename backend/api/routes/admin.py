"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - admin: CRUD endpoints for users, roles and capabilities
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

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import (
    get_user_capabilities,
    get_user_roles,
    hash_password,
    require_capability,
)
from constants import CAP_MANAGE_USERS
from models import Capability, Role, RoleCapability, User, UserRole, UserSettings

router = APIRouter()
admin_guard = Depends(require_capability(CAP_MANAGE_USERS))


class AdminUserResponse(BaseModel):
    id: int
    email: str
    prenom: Optional[str] = None
    nom: Optional[str] = None
    is_active: bool
    roles: list[str]
    capabilities: list[str]
    can_change_password: bool = True


class AdminUserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    prenom: Optional[str] = None
    nom: Optional[str] = None
    is_active: bool = True
    role_slugs: list[str] = Field(default_factory=list)


class AdminUserUpdateRequest(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(default=None, min_length=8)
    prenom: Optional[str] = None
    nom: Optional[str] = None
    is_active: Optional[bool] = None
    role_slugs: Optional[list[str]] = None
    can_change_password: Optional[bool] = None


class CapabilityResponse(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str] = None


class CapabilityCreateRequest(BaseModel):
    code: str
    name: str
    description: Optional[str] = None


class CapabilityUpdateRequest(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None


class RoleResponse(BaseModel):
    id: int
    code: int
    slug: str
    name: str
    is_active: bool
    capabilities: list[str]


class RoleCreateRequest(BaseModel):
    code: int
    slug: str
    name: str
    is_active: bool = True
    capability_codes: list[str] = Field(default_factory=list)


class RoleUpdateRequest(BaseModel):
    code: Optional[int] = None
    slug: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None
    capability_codes: Optional[list[str]] = None


async def _build_user_response(db: AsyncSession, user: User) -> AdminUserResponse:
    roles = await get_user_roles(db=db, user_id=user.id)
    capabilities = await get_user_capabilities(db=db, user_id=user.id)
    settings_result = await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    settings = settings_result.scalar_one_or_none()
    return AdminUserResponse(
        id=user.id,
        email=user.email,
        prenom=user.prenom,
        nom=user.nom,
        is_active=user.is_active,
        roles=roles,
        capabilities=capabilities,
        can_change_password=settings.can_change_password if settings is not None else True,
    )


async def _fetch_roles_by_slugs(db: AsyncSession, role_slugs: list[str]) -> list[Role]:
    if not role_slugs:
        return []

    result = await db.execute(select(Role).where(Role.slug.in_(role_slugs)))
    roles = result.scalars().all()
    existing_slugs = {role.slug for role in roles}
    missing = sorted(set(role_slugs) - existing_slugs)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown role slugs: {', '.join(missing)}",
        )
    return roles


async def _fetch_capabilities_by_codes(db: AsyncSession, capability_codes: list[str]) -> list[Capability]:
    if not capability_codes:
        return []

    result = await db.execute(select(Capability).where(Capability.code.in_(capability_codes)))
    capabilities = result.scalars().all()
    existing_codes = {capability.code for capability in capabilities}
    missing = sorted(set(capability_codes) - existing_codes)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown capability codes: {', '.join(missing)}",
        )
    return capabilities


async def _get_role_capabilities(db: AsyncSession, role_id: int) -> list[str]:
    result = await db.execute(
        select(Capability.code)
        .join(RoleCapability, RoleCapability.capability_id == Capability.id)
        .where(RoleCapability.role_id == role_id)
    )
    return list(result.scalars().all())


@router.get('/users', response_model=list[AdminUserResponse])
async def list_users(
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).order_by(User.id))
    users = result.scalars().all()
    return [await _build_user_response(db=db, user=user) for user in users]


@router.post('/users', response_model=AdminUserResponse)
async def create_user(
    payload: AdminUserCreateRequest,
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    existing_result = await db.execute(select(User).where(User.email == payload.email))
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Email already exists')

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        prenom=payload.prenom,
        nom=payload.nom,
        is_active=payload.is_active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    roles = await _fetch_roles_by_slugs(db=db, role_slugs=payload.role_slugs)
    for role in roles:
        db.add(UserRole(user_id=user.id, role_id=role.id))

    if roles:
        await db.commit()

    return await _build_user_response(db=db, user=user)


@router.put('/users/{user_id}', response_model=AdminUserResponse)
async def update_user(
    user_id: int,
    payload: AdminUserUpdateRequest,
    current_user: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    if payload.email is not None and payload.email != user.email:
        existing_result = await db.execute(select(User).where(User.email == payload.email, User.id != user_id))
        if existing_result.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Email already exists')
        user.email = payload.email

    if payload.password:
        user.password_hash = hash_password(payload.password)

    if payload.prenom is not None:
        user.prenom = payload.prenom

    if payload.nom is not None:
        user.nom = payload.nom

    if payload.is_active is not None:
        user.is_active = payload.is_active

    if payload.role_slugs is not None:
        if current_user.id == user_id and not payload.role_slugs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Current user must keep at least one role',
            )

        roles = await _fetch_roles_by_slugs(db=db, role_slugs=payload.role_slugs)
        await db.execute(delete(UserRole).where(UserRole.user_id == user_id))
        for role in roles:
            db.add(UserRole(user_id=user_id, role_id=role.id))

    if payload.can_change_password is not None:
        settings_result = await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
        settings = settings_result.scalar_one_or_none()
        if settings is None:
            db.add(UserSettings(user_id=user_id, can_change_password=payload.can_change_password))
        else:
            settings.can_change_password = payload.can_change_password

    await db.commit()
    await db.refresh(user)

    return await _build_user_response(db=db, user=user)


@router.delete('/users/{user_id}')
async def delete_user(
    user_id: int,
    current_user: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    if current_user.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Cannot delete current user')

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    await db.delete(user)
    await db.commit()
    return {'message': 'User deleted', 'user_id': user_id}


@router.get('/roles', response_model=list[RoleResponse])
async def list_roles(
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Role).order_by(Role.code))
    roles = result.scalars().all()
    response: list[RoleResponse] = []
    for role in roles:
        response.append(
            RoleResponse(
                id=role.id,
                code=role.code,
                slug=role.slug,
                name=role.name,
                is_active=role.is_active,
                capabilities=await _get_role_capabilities(db=db, role_id=role.id),
            )
        )
    return response


@router.post('/roles', response_model=RoleResponse)
async def create_role(
    payload: RoleCreateRequest,
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    existing_result = await db.execute(select(Role).where((Role.code == payload.code) | (Role.slug == payload.slug)))
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Role code or slug already exists')

    role = Role(code=payload.code, slug=payload.slug, name=payload.name, is_active=payload.is_active)
    db.add(role)
    await db.commit()
    await db.refresh(role)

    capabilities = await _fetch_capabilities_by_codes(db=db, capability_codes=payload.capability_codes)
    for capability in capabilities:
        db.add(RoleCapability(role_id=role.id, capability_id=capability.id, scope='all'))

    if capabilities:
        await db.commit()

    return RoleResponse(
        id=role.id,
        code=role.code,
        slug=role.slug,
        name=role.name,
        is_active=role.is_active,
        capabilities=await _get_role_capabilities(db=db, role_id=role.id),
    )


@router.put('/roles/{role_id}', response_model=RoleResponse)
async def update_role(
    role_id: int,
    payload: RoleUpdateRequest,
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Role not found')

    if payload.code is not None and payload.code != role.code:
        existing_result = await db.execute(select(Role).where(Role.code == payload.code, Role.id != role_id))
        if existing_result.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Role code already exists')
        role.code = payload.code

    if payload.slug is not None and payload.slug != role.slug:
        existing_result = await db.execute(select(Role).where(Role.slug == payload.slug, Role.id != role_id))
        if existing_result.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Role slug already exists')
        role.slug = payload.slug

    if payload.name is not None:
        role.name = payload.name

    if payload.is_active is not None:
        role.is_active = payload.is_active

    if payload.capability_codes is not None:
        capabilities = await _fetch_capabilities_by_codes(db=db, capability_codes=payload.capability_codes)
        await db.execute(delete(RoleCapability).where(RoleCapability.role_id == role_id))
        for capability in capabilities:
            db.add(RoleCapability(role_id=role_id, capability_id=capability.id, scope='all'))

    await db.commit()
    await db.refresh(role)

    return RoleResponse(
        id=role.id,
        code=role.code,
        slug=role.slug,
        name=role.name,
        is_active=role.is_active,
        capabilities=await _get_role_capabilities(db=db, role_id=role.id),
    )


@router.delete('/roles/{role_id}')
async def delete_role(
    role_id: int,
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Role not found')

    await db.delete(role)
    await db.commit()
    return {'message': 'Role deleted', 'role_id': role_id}


@router.get('/capabilities', response_model=list[CapabilityResponse])
async def list_capabilities(
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Capability).order_by(Capability.code))
    capabilities = result.scalars().all()
    return [
        CapabilityResponse(
            id=capability.id,
            code=capability.code,
            name=capability.name,
            description=capability.description,
        )
        for capability in capabilities
    ]


@router.post('/capabilities', response_model=CapabilityResponse)
async def create_capability(
    payload: CapabilityCreateRequest,
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    existing_result = await db.execute(select(Capability).where(Capability.code == payload.code))
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Capability code already exists')

    capability = Capability(code=payload.code, name=payload.name, description=payload.description)
    db.add(capability)
    await db.commit()
    await db.refresh(capability)

    return CapabilityResponse(
        id=capability.id,
        code=capability.code,
        name=capability.name,
        description=capability.description,
    )


@router.put('/capabilities/{capability_id}', response_model=CapabilityResponse)
async def update_capability(
    capability_id: int,
    payload: CapabilityUpdateRequest,
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Capability).where(Capability.id == capability_id))
    capability = result.scalar_one_or_none()
    if capability is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Capability not found')

    if payload.code is not None and payload.code != capability.code:
        existing_result = await db.execute(
            select(Capability).where(Capability.code == payload.code, Capability.id != capability_id)
        )
        if existing_result.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Capability code already exists')
        capability.code = payload.code

    if payload.name is not None:
        capability.name = payload.name

    if payload.description is not None:
        capability.description = payload.description

    await db.commit()
    await db.refresh(capability)

    return CapabilityResponse(
        id=capability.id,
        code=capability.code,
        name=capability.name,
        description=capability.description,
    )


@router.delete('/capabilities/{capability_id}')
async def delete_capability(
    capability_id: int,
    _: User = admin_guard,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Capability).where(Capability.id == capability_id))
    capability = result.scalar_one_or_none()
    if capability is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Capability not found')

    await db.delete(capability)
    await db.commit()
    return {'message': 'Capability deleted', 'capability_id': capability_id}
