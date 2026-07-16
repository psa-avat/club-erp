"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant: business logic for the fuel tracking module (pumps, declared fill-ups, refills)
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

from __future__ import annotations

import io
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import qrcode
import qrcode.image.svg
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Asset, MouvementCarburant, Pompe
from schemas.carburant import MouvementCarburantCreateRequest, PompeCreateRequest, PompeUpdateRequest

# Minimum delay between two submissions from the same IP for the same pump.
RATE_LIMIT_WINDOW_MINUTES = 10


async def get_pompe_by_token(db: AsyncSession, token: str) -> Pompe:
    """Resolve an active pump from its opaque QR token, 404 if missing/inactive."""
    result = await db.execute(select(Pompe).where(Pompe.token == token))
    pompe = result.scalar_one_or_none()
    if pompe is None or not pompe.actif:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pompe introuvable")
    return pompe


async def list_active_assets(db: AsyncSession) -> list[Asset]:
    """List bookable, active assets for the public fill-up form's aircraft picker."""
    result = await db.execute(
        select(Asset)
        .where(Asset.is_active.is_(True), Asset.is_bookable.is_(True))
        .order_by(Asset.registration, Asset.name)
    )
    return list(result.scalars().all())


async def _recent_submission_exists(db: AsyncSession, pompe_uuid, ip_source: Optional[str]) -> bool:
    if not ip_source:
        return False
    threshold = datetime.now(timezone.utc) - timedelta(minutes=RATE_LIMIT_WINDOW_MINUTES)
    result = await db.execute(
        select(MouvementCarburant.uuid)
        .where(
            MouvementCarburant.pompe_uuid == pompe_uuid,
            MouvementCarburant.ip_source == ip_source,
            MouvementCarburant.date_saisie >= threshold,
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def create_mouvement(
    db: AsyncSession,
    token: str,
    request: MouvementCarburantCreateRequest,
    ip_source: Optional[str],
    user_agent: Optional[str],
) -> MouvementCarburant:
    """Record a declared fill-up as a brouillon movement, after a per-pump/IP rate-limit check."""
    pompe = await get_pompe_by_token(db, token)

    if await _recent_submission_exists(db, pompe.uuid, ip_source):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Une déclaration a déjà été enregistrée récemment pour cette pompe. Merci de patienter.",
        )

    asset_result = await db.execute(
        select(Asset).where(Asset.uuid == request.asset_uuid, Asset.is_active.is_(True))
    )
    if asset_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Avion invalide")

    flag_anomalie = bool(
        pompe.capacite_cuve_l is not None and request.quantite_l > pompe.capacite_cuve_l
    )

    mouvement = MouvementCarburant(
        pompe_uuid=pompe.uuid,
        asset_uuid=request.asset_uuid,
        quantite_l=request.quantite_l,
        index_compteur=request.index_compteur,
        membre_declarant=request.membre_declarant,
        ip_source=ip_source,
        user_agent=user_agent,
        flag_anomalie=flag_anomalie,
        statut=1,
    )
    db.add(mouvement)
    await db.commit()
    await db.refresh(mouvement)
    return mouvement


# ---------------------------------------------------------------------------
# Admin: pompes
# ---------------------------------------------------------------------------

async def list_pompes(db: AsyncSession) -> list[Pompe]:
    result = await db.execute(select(Pompe).order_by(Pompe.nom))
    return list(result.scalars().all())


async def get_pompe(db: AsyncSession, pompe_uuid: UUID) -> Pompe:
    """Resolve a pump by uuid for admin use (no actif filter), 404 if missing."""
    result = await db.execute(select(Pompe).where(Pompe.uuid == pompe_uuid))
    pompe = result.scalar_one_or_none()
    if pompe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pompe introuvable")
    return pompe


async def create_pompe(db: AsyncSession, request: PompeCreateRequest) -> Pompe:
    pompe = Pompe(
        nom=request.nom,
        type_carburant=request.type_carburant,
        actif=request.actif,
        capacite_cuve_l=request.capacite_cuve_l,
        index_initial=request.index_initial,
        index_initial_date=request.index_initial_date,
        token=secrets.token_urlsafe(24),
    )
    db.add(pompe)
    await db.commit()
    await db.refresh(pompe)
    return pompe


async def update_pompe(db: AsyncSession, pompe_uuid: UUID, request: PompeUpdateRequest) -> Pompe:
    pompe = await get_pompe(db, pompe_uuid)
    updates = request.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(pompe, field, value)
    await db.commit()
    await db.refresh(pompe)
    return pompe


async def rotate_pompe_token(db: AsyncSession, pompe_uuid: UUID) -> Pompe:
    """Issue a new opaque token, invalidating the old QR code/URL."""
    pompe = await get_pompe(db, pompe_uuid)
    pompe.token = secrets.token_urlsafe(24)
    await db.commit()
    await db.refresh(pompe)
    return pompe


def generate_pompe_qrcode_svg(pompe: Pompe, base_url: str) -> bytes:
    """Render an SVG QR code encoding the pump's public declaration URL."""
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        image_factory=qrcode.image.svg.SvgPathImage,
    )
    qr.add_data(f"{base_url.rstrip('/')}/plein/{pompe.token}")
    qr.make(fit=True)
    image = qr.make_image()

    buffer = io.BytesIO()
    image.save(buffer)
    return buffer.getvalue()
