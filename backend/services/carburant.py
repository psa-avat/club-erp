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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import Asset, AssetFamily, MouvementCarburant, Pompe, RavitaillementCarburant
from schemas.carburant import (
    MouvementCarburantCreateRequest,
    MouvementCarburantResponse,
    PompeCreateRequest,
    PompeUpdateRequest,
    RavitaillementCreateRequest,
    RavitaillementResponse,
    StockCarburantEntry,
)

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
    """List bookable, active, fuel-consuming assets for the public fill-up form's aircraft picker."""
    result = await db.execute(
        select(Asset)
        .join(AssetFamily, Asset.asset_family_uuid == AssetFamily.uuid)
        .where(
            Asset.is_active.is_(True),
            Asset.is_bookable.is_(True),
            AssetFamily.uses_fuel.is_(True),
        )
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


# ---------------------------------------------------------------------------
# Admin: validation queue
# ---------------------------------------------------------------------------

def _mouvement_eager_options():
    return (selectinload(MouvementCarburant.pompe), selectinload(MouvementCarburant.asset))


def _build_mouvement_response(mouvement: MouvementCarburant) -> MouvementCarburantResponse:
    return MouvementCarburantResponse(
        uuid=mouvement.uuid,
        pompe_uuid=mouvement.pompe_uuid,
        pompe_nom=mouvement.pompe.nom,
        asset_uuid=mouvement.asset_uuid,
        asset_registration=mouvement.asset.registration if mouvement.asset else None,
        asset_name=mouvement.asset.name if mouvement.asset else "",
        quantite_l=mouvement.quantite_l,
        index_compteur=mouvement.index_compteur,
        membre_declarant=mouvement.membre_declarant,
        date_saisie=mouvement.date_saisie,
        statut=mouvement.statut,
        ip_source=mouvement.ip_source,
        flag_anomalie=mouvement.flag_anomalie,
        commentaire_validation=mouvement.commentaire_validation,
        validated_at=mouvement.validated_at,
    )


async def _get_mouvement_orm(db: AsyncSession, mouvement_uuid: UUID) -> MouvementCarburant:
    stmt = (
        select(MouvementCarburant)
        .where(MouvementCarburant.uuid == mouvement_uuid)
        .options(*_mouvement_eager_options())
    )
    result = await db.execute(stmt)
    mouvement = result.scalar_one_or_none()
    if mouvement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mouvement introuvable")
    return mouvement


async def list_mouvements(
    db: AsyncSession,
    statut: Optional[int] = None,
    pompe_uuid: Optional[UUID] = None,
) -> list[MouvementCarburantResponse]:
    stmt = select(MouvementCarburant).options(*_mouvement_eager_options())
    if statut is not None:
        stmt = stmt.where(MouvementCarburant.statut == statut)
    if pompe_uuid is not None:
        stmt = stmt.where(MouvementCarburant.pompe_uuid == pompe_uuid)
    stmt = stmt.order_by(MouvementCarburant.date_saisie.desc())
    result = await db.execute(stmt)
    mouvements = result.scalars().all()
    return [_build_mouvement_response(m) for m in mouvements]


async def get_mouvement(db: AsyncSession, mouvement_uuid: UUID) -> MouvementCarburantResponse:
    mouvement = await _get_mouvement_orm(db, mouvement_uuid)
    return _build_mouvement_response(mouvement)


async def valider_mouvement(
    db: AsyncSession,
    mouvement_uuid: UUID,
    user_id: int,
    commentaire: Optional[str] = None,
) -> MouvementCarburantResponse:
    """Brouillon -> valide. Immutable otherwise: only statut and validation metadata change."""
    mouvement = await _get_mouvement_orm(db, mouvement_uuid)
    if mouvement.statut != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ce mouvement n'est plus en attente de validation",
        )
    mouvement.statut = 2
    mouvement.validated_by = user_id
    mouvement.validated_at = datetime.now(timezone.utc)
    if commentaire:
        mouvement.commentaire_validation = commentaire
    response = _build_mouvement_response(mouvement)
    await db.commit()
    return response


async def rejeter_mouvement(
    db: AsyncSession,
    mouvement_uuid: UUID,
    user_id: int,
    commentaire: str,
) -> MouvementCarburantResponse:
    """Brouillon -> rejete. A rejected movement stays rejected; corrections are new declarations."""
    mouvement = await _get_mouvement_orm(db, mouvement_uuid)
    if mouvement.statut != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ce mouvement n'est plus en attente de validation",
        )
    mouvement.statut = 3
    mouvement.validated_by = user_id
    mouvement.validated_at = datetime.now(timezone.utc)
    mouvement.commentaire_validation = commentaire
    response = _build_mouvement_response(mouvement)
    await db.commit()
    return response


# ---------------------------------------------------------------------------
# Admin: ravitaillements (pump replenishments — count toward stock immediately)
# ---------------------------------------------------------------------------

async def list_ravitaillements(
    db: AsyncSession, pompe_uuid: Optional[UUID] = None
) -> list[RavitaillementResponse]:
    stmt = select(RavitaillementCarburant).options(selectinload(RavitaillementCarburant.pompe))
    if pompe_uuid is not None:
        stmt = stmt.where(RavitaillementCarburant.pompe_uuid == pompe_uuid)
    stmt = stmt.order_by(RavitaillementCarburant.date_ravitaillement.desc())
    result = await db.execute(stmt)
    ravitaillements = result.scalars().all()
    return [
        RavitaillementResponse(
            uuid=r.uuid,
            pompe_uuid=r.pompe_uuid,
            pompe_nom=r.pompe.nom,
            quantite_l=r.quantite_l,
            date_ravitaillement=r.date_ravitaillement,
            note=r.note,
            created_at=r.created_at,
        )
        for r in ravitaillements
    ]


async def create_ravitaillement(
    db: AsyncSession, request: RavitaillementCreateRequest, user_id: int
) -> RavitaillementResponse:
    pompe = await get_pompe(db, request.pompe_uuid)
    ravitaillement = RavitaillementCarburant(
        pompe_uuid=request.pompe_uuid,
        quantite_l=request.quantite_l,
        date_ravitaillement=request.date_ravitaillement,
        note=request.note,
        created_by=user_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(ravitaillement)
    await db.flush()
    response = RavitaillementResponse(
        uuid=ravitaillement.uuid,
        pompe_uuid=ravitaillement.pompe_uuid,
        pompe_nom=pompe.nom,
        quantite_l=ravitaillement.quantite_l,
        date_ravitaillement=ravitaillement.date_ravitaillement,
        note=ravitaillement.note,
        created_at=ravitaillement.created_at,
    )
    await db.commit()
    return response


# ---------------------------------------------------------------------------
# Admin: stock (cumulative per pompe: ravitaillements - validated mouvements)
# ---------------------------------------------------------------------------

async def get_stock_carburant(db: AsyncSession) -> list[StockCarburantEntry]:
    ravitaillements_totals = dict(
        (
            await db.execute(
                select(
                    RavitaillementCarburant.pompe_uuid,
                    func.coalesce(func.sum(RavitaillementCarburant.quantite_l), 0),
                ).group_by(RavitaillementCarburant.pompe_uuid)
            )
        ).all()
    )
    consommation_totals = dict(
        (
            await db.execute(
                select(
                    MouvementCarburant.pompe_uuid,
                    func.coalesce(func.sum(MouvementCarburant.quantite_l), 0),
                )
                .where(MouvementCarburant.statut == 2)
                .group_by(MouvementCarburant.pompe_uuid)
            )
        ).all()
    )
    derniere_activite: dict[UUID, datetime] = {}
    for pompe_uuid, last_date in (
        await db.execute(
            select(MouvementCarburant.pompe_uuid, func.max(MouvementCarburant.date_saisie))
            .where(MouvementCarburant.statut == 2)
            .group_by(MouvementCarburant.pompe_uuid)
        )
    ).all():
        derniere_activite[pompe_uuid] = last_date

    pompes = await list_pompes(db)
    entries = []
    for pompe in pompes:
        total_ravitaillements = ravitaillements_totals.get(pompe.uuid, 0)
        total_consommation = consommation_totals.get(pompe.uuid, 0)
        entries.append(
            StockCarburantEntry(
                pompe_uuid=pompe.uuid,
                pompe_nom=pompe.nom,
                type_carburant=pompe.type_carburant,
                actif=pompe.actif,
                total_ravitaillements_l=total_ravitaillements,
                total_consommation_l=total_consommation,
                stock_l=total_ravitaillements - total_consommation,
                derniere_activite=derniere_activite.get(pompe.uuid),
            )
        )
    return entries
