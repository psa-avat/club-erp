# Feature Implementation Specification: Manual Federal Synchronization (GesAsso & OSRT)
**Project:** club-erp / PlancheDeVol
**Target Components:** PostgreSQL, FastAPI Backend, React Admin Interface
**Date:** 2026-06-20 (révisé après analyse de l'API GesAsso réelle et du code existant)

This specification details the architecture, database schema, backend API routes, and frontend design required to implement a user-guided, manual synchronization workspace within **club-erp**. This enables administrative users to inspect flight log status metrics, check error returns from external federation endpoints, correct profiles locally, and trigger updates on demand.

---
> **Note de révision (v3 — 2026-06-21) :**
> - **Auth GesAsso : WSSE** (pas Digest) — `X-WSSE: UsernameToken Username, PasswordDigest=SHA1(nonce+created+secret), Nonce, Created`
> - **L'ERP lit GesAsso directement** via `GET /people/{ffvp_id}.json` — aucune dépendance à PlancheBack pour les données membres.
> - **Champs lus depuis GesAsso** : `first_name`, `last_name`, `email`, téléphone (mobile prioritaire), `licence.licenceNumber`, `licence.seasonStartDate`, `licence.seasonEndDate`.
> - **Qualifications** : non gérées par l'ERP — domaine exclusif de PlancheBack.
> - **Backend implémenté** : `backend/services/gesasso_client.py` (`WsseAuth` + `GesAssoClient`), `backend/schemas/gesasso.py`, `backend/api/routes/gesasso.py`.
> - **Sync manuelle uniquement** : aucun déclenchement automatique ; vols déjà transférés (status=2) ignorés sauf `force=True`.

## 1. Objectives & User Workflow
1. **Synchronisation 100% manuelle** : l'admin choisit explicitement quels vols envoyer et quand. Aucun déclenchement automatique.
2. **Statut de transfert persistant** : chaque tentative d'envoi est tracée dans `federal_sync_logs`. L'admin voit immédiatement quels vols sont déjà transférés (status=2), en attente, ou en échec.
3. **Protection contre les doublons** : un vol déjà transféré (status=2) est signalé comme "Déjà transféré" et **non renvoyé** sauf action explicite de forçage de l'admin.
4. **Audit des échecs** : les erreurs HTTP/réseau sont stockées pour permettre la correction et le renvoi ciblé.

---

## 2. Structural Schema Extensions (SQL Migration)

### 2.1. Principe

On remplace les colonnes directes sur `validated_flights` par **une table de logs générique** `federal_sync_logs`. Chaque tentative de synchronisation (réussie ou échouée) est une ligne. Cela permet :

- **Traçabilité** : historique complet des tentatives (utile pour déboguer les échecs récurrents)
- **Extensibilité** : ajouter une plateforme (FFA, FFPLUM…) = une nouvelle valeur dans la contrainte `platform`
- **Découplage** : `validated_flights` ne porte pas la complexité des synchronisations externes
- **Nettoyage** : on peut purger les vieux logs sans toucher aux vols

**Migration :** `052_federal_sync_logs.sql`

```sql
-- ============================================================================
-- MIGRATION 052 : Federal sync logs table (replaces direct columns on validated_flights)
-- ============================================================================

-- 1. Nouvelle table de logs de synchronisation fédérale
CREATE TABLE public.federal_sync_logs (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    validated_flight_uuid UUID NOT NULL REFERENCES public.validated_flights(uuid) ON DELETE CASCADE,
    platform VARCHAR(16) NOT NULL,
    status SMALLINT NOT NULL DEFAULT 0,
    external_id VARCHAR(64),
    attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT chk_fsl_platform CHECK (platform IN ('gesasso', 'osrt')),
    CONSTRAINT chk_fsl_status CHECK (status IN (0, 1, 2, 3, 4))
);

COMMENT ON TABLE public.federal_sync_logs IS 'Historique des tentatives de synchronisation fédérale (GesAsso, OSRT, …)';
COMMENT ON COLUMN public.federal_sync_logs.status IS '0=pas envoyé, 1=en attente, 2=succès, 3=échec, 4=exclu';
COMMENT ON COLUMN public.federal_sync_logs.external_id IS 'ID du vol côté plateforme (gesasso_id / osrt_id)';

-- 2. Index pour le dashboard (vols en attente ou en échec par plateforme)
CREATE INDEX idx_fsl_sync_queue 
    ON public.federal_sync_logs (platform, status)
    WHERE status IN (1, 3);

-- 3. Index pour retrouver rapidement le dernier statut d''un vol sur une plateforme
CREATE INDEX idx_fsl_flight_platform_attempt
    ON public.federal_sync_logs (validated_flight_uuid, platform, attempt_at DESC);

-- 4. Vue pratique : dernier statut connu par vol × plateforme
CREATE VIEW public.federal_sync_status AS
SELECT DISTINCT ON (validated_flight_uuid, platform)
    validated_flight_uuid,
    platform,
    status,
    external_id,
    attempt_at AS last_attempt_at
FROM public.federal_sync_logs
ORDER BY validated_flight_uuid, platform, attempt_at DESC;

COMMENT ON VIEW public.federal_sync_status IS 'Dernier statut de synchronisation par vol et par plateforme (utilisé par le dashboard)';
```

### 2.2. Statuts (inchangés)

| Code | Signification | Badge |
|------|--------------|-------|
| 0    | Pas encore traité | Gris "Pas envoyé" |
| 1    | En attente d'envoi | Orange "En attente" |
| 2    | Synchronisé | Vert "Synchronisé" |
| 3    | Échec | Rouge "Échec" |
| 4    | Exclu (forcé par admin) | Gris barré "Ignoré" |

> **Périmètre** : Les qualifications GesAsso (SPL, FI, TMG…) sont gérées exclusivement par PlancheBack. L'ERP gère : (1) les données personnelles des membres via lecture directe GesAsso, (2) le push des vols validés vers GesAsso.

### 2.3. Données membres lues depuis GesAsso (lecture directe ERP)

L'ERP appelle `GET /people/{ffvp_id}.json` (WSSE) et mappe les champs comme suit :

| Champ GesAsso | Chemin JSON | Champ ERP | Modèle ERP | Note |
|---|---|---|---|---|
| Prénom | `personal_info.first_name` | `first_name` | `Member` | |
| Nom | `personal_info.last_name` | `last_name` | `Member` | |
| Email | `personal_info.email` | `email` | `Member` | |
| Téléphone | `personal_info.mobile_phone_number` | `phone` | `Member` | Mobile prioritaire ; fallback sur `phone_number` si absent |
| N° licence | `personal_info.licence.licenceNumber` | `licence_number` | `MemberSheet` (année courante) | |
| Début saison | `personal_info.licence.seasonStartDate` | `season_start_date` | `MemberSheet` | **Nouvelle colonne — migration 053** |
| Fin saison | `personal_info.licence.seasonEndDate` | `season_end_date` | `MemberSheet` | **Nouvelle colonne — migration 053** ; badge `Expirée` si < aujourd'hui |

Flux admin :
1. Admin ouvre "Synchronisation GesAsso membres" (workspace membres)
2. Pour chaque membre avec un `ffvp_id`, l'ERP appelle `GET /api/v1/gesasso/members/{uuid}/pilot-data`
3. Le backend interroge GesAsso (WSSE) et retourne `personal_info`
4. L'admin sélectionne les membres → "Appliquer" met à jour `Member` + `MemberSheet` (année courante)
5. Push vols GesAsso → `person_one_licence_number` = `MemberSheet.licence_number`

Endpoints backend (déjà implémentés) :
- `GET /api/v1/gesasso/pilot/{ffvp_id}` — lookup direct par FFVP ID
- `GET /api/v1/gesasso/members/{member_uuid}/pilot-data` — lookup via UUID membre ERP
- `GET/PUT /api/v1/gesasso/settings` — configuration credentials WSSE

---

## 3. Backend Implementation

### 3.1. Nouvelle Capability

Dans `backend/constants.py` :

```python
CAP_FEDERAL_SYNC = "FEDERAL_SYNC"  # "Synchronisation fédérale (GesAsso/OSRT)"
```

Ajouter dans `CAPABILITY_SEEDS` :
```python
(CAP_FEDERAL_SYNC, "Synchronisation fédérale (GesAsso/OSRT)"),
```

### 3.2. Service : `backend/services/federal_sync.py`

**Changement clé :** Au lieu d'écrire directement sur `validated_flights` (pas de colonnes dédiées), on crée une entrée `FederalSyncLog` par tentative. Le dernier statut se déduit par `attempt_at DESC` — pas besoin de colonne "courante".

Pattern à suivre : `services/planche_integration.py` (classe asynchrone avec `httpx`, AuditLog, savepoint isolation).

```python
"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - federal_sync: Service de synchronisation des vols vers les APIs fédérales (GesAsso, OSRT, …)
    Copyright (C) 2026  SAFORCADA Patrick
    ...
"""

from datetime import datetime, timezone
from typing import Any
from uuid import UUID
import logging

import httpx
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models import ValidatedFlight, AuditLog, FederalSyncLog
from constants import CAP_FEDERAL_SYNC

logger = logging.getLogger(__name__)


class FederalSyncService:
    """
    Service générique de synchronisation fédérale.
    
    Une instance par plateforme (gesasso, osrt, …), configurée avec
    un mapping d'endpoints et une fonction de transformation du vol.
    
    Pour GesAsso (WSSE Auth — X-WSSE header, SHA1) :
      - GET  /people/{ffvp_id}.json                → Infos pilote (nom, licence)
      - GET  /people/{ffvp_id}/qualifications.json → Qualifications (SPL, FI, TMG…)
      - POST /flights-collection.json              → Création batch de vols
      - PUT  /flights/{id}.json                    → Mise à jour (si external_id connu)
    """

    PLATFORM = "gesasso"  # Surchargé par les sous-classes ou instances
    
    def __init__(
        self,
        platform: str,
        base_url: str,
        auth: httpx.Auth,
        association_code: str,
    ):
        self.platform = platform
        self.base_url = base_url.rstrip("/")
        self.auth = auth
        self.association_code = association_code

    # ------------------------------------------------------------------
    # Helpers : dernier statut connu
    # ------------------------------------------------------------------
    async def get_latest_log(
        self, db: AsyncSession, flight_uuid: UUID
    ) -> FederalSyncLog | None:
        """Retourne le dernier log de sync pour un vol sur cette plateforme."""
        result = await db.execute(
            select(FederalSyncLog)
            .where(
                FederalSyncLog.validated_flight_uuid == flight_uuid,
                FederalSyncLog.platform == self.platform,
            )
            .order_by(desc(FederalSyncLog.attempt_at))
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_external_id(
        self, db: AsyncSession, flight_uuid: UUID
    ) -> str | None:
        """Récupère le dernier external_id connu pour un vol (gesasso_id / osrt_id)."""
        log = await self.get_latest_log(db, flight_uuid)
        return log.external_id if log and log.external_id else None

    # ------------------------------------------------------------------
    # Log writing
    # ------------------------------------------------------------------
    async def _write_log(
        self,
        db: AsyncSession,
        flight_uuid: UUID,
        status: int,
        external_id: str | None = None,
    ) -> FederalSyncLog:
        """Crée une entrée de log de synchronisation."""
        log = FederalSyncLog(
            validated_flight_uuid=flight_uuid,
            platform=self.platform,
            status=status,
            external_id=external_id,
            attempt_at=datetime.now(timezone.utc),
        )
        db.add(log)
        return log

    # ------------------------------------------------------------------
    # Mapping ERP → Plateforme (à surcharger)
    # ------------------------------------------------------------------
    def map_flight(self, flight: ValidatedFlight) -> dict[str, Any]:
        """Transforme un vol en payload pour la plateforme."""
        raise NotImplementedError

    # ------------------------------------------------------------------
    # API Calls (à surcharger)
    # ------------------------------------------------------------------
    async def post_flight_collection(
        self, client: httpx.AsyncClient, flights: list[ValidatedFlight]
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    async def put_flight(
        self, client: httpx.AsyncClient, external_id: str, flight: ValidatedFlight
    ) -> dict[str, Any]:
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Sync Orchestration
    # ------------------------------------------------------------------
    async def batch_sync_flights(
        self, db: AsyncSession, flight_uuids: list[UUID],
        triggered_by: str = "system", force: bool = False,
    ) -> dict[str, Any]:
        """
        Synchronise manuellement une liste de vols.
        
        Stratégie :
        1. Vols déjà transférés (dernier log status=2) → signalés "already_transferred",
           non renvoyés sauf si force=True.
        2. Vols sans external_id connu → POST batch (création).
        3. Vols avec external_id connu (renvoi forcé) → PUT (mise à jour).
        4. Stocke un FederalSyncLog par tentative.
        """
        result = await db.execute(
            select(ValidatedFlight).where(ValidatedFlight.uuid.in_(flight_uuids))
        )
        flights = result.scalars().all()

        if not flights:
            return {"status": "error", "detail": "No flights found", "synced": 0, "failed": 0, "already_transferred": 0}

        synced = 0
        failed = 0
        already_transferred = 0
        errors: list[str] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            new_flights: list[ValidatedFlight] = []
            update_flights: list[ValidatedFlight] = []

            for flight in flights:
                last_log = await self.get_latest_log(db, flight.uuid)
                # Vol déjà transféré avec succès → skip sauf forçage explicite
                if last_log and last_log.status == 2 and not force:
                    already_transferred += 1
                    continue
                ext_id = last_log.external_id if last_log else None
                if ext_id:
                    update_flights.append(flight)
                else:
                    new_flights.append(flight)

            # --- Nouveaux vols : POST batch ---
            if new_flights:
                try:
                    resp_data = await self.post_flight_collection(client, new_flights)
                    for i, flight in enumerate(new_flights):
                        if i < len(resp_data.get("flight_collection", [])):
                            created = resp_data["flight_collection"][i]
                            await self._write_log(
                                db, flight.uuid,
                                status=2,  # succès
                                external_id=str(created.get("id", "")),
                            )
                            synced += 1
                        else:
                            await self._write_log(db, flight.uuid, status=3)
                            failed += 1
                except httpx.HTTPStatusError as e:
                    for flight in new_flights:
                        await self._write_log(db, flight.uuid, status=3)
                        failed += 1
                    errors.append(f"POST batch failed: {e.response.status_code}")
                except httpx.RequestError as e:
                    for flight in new_flights:
                        await self._write_log(db, flight.uuid, status=3)
                        failed += 1
                    errors.append(f"Network error: {str(e)[:200]}")

            # --- Mises à jour : PUT ---
            for flight in update_flights:
                ext_id = await self.get_external_id(db, flight.uuid)
                try:
                    await self.put_flight(client, ext_id, flight)
                    await self._write_log(
                        db, flight.uuid, status=2, external_id=ext_id,
                    )
                    synced += 1
                except httpx.HTTPStatusError as e:
                    await self._write_log(
                        db, flight.uuid, status=3, external_id=ext_id,
                    )
                    failed += 1
                except httpx.RequestError as e:
                    await self._write_log(
                        db, flight.uuid, status=3, external_id=ext_id,
                    )
                    failed += 1

            await db.commit()

        # Audit log (pattern existant)
        audit = AuditLog(
            operation_type=f"{self.platform}_sync_push",
            status=1 if failed > 0 else 0,
            result_summary=f"synced={synced}, failed={failed}",
            total_records=len(flight_uuids),
            success_count=synced,
            failure_count=failed,
            error_message="; ".join(errors) if errors else None,
            triggered_by=triggered_by,
        )
        db.add(audit)
        await db.commit()

        return {
            "status": "complete",
            "platform": self.platform,
            "total": len(flight_uuids),
            "synced": synced,
            "failed": failed,
            "already_transferred": already_transferred,
            "errors": errors,
        }


def _make_wsse_headers(username: str, secret: str) -> dict[str, str]:
    """
    Génère un header WSSE UsernameToken pour l'API GesAsso.
    
    Format : X-WSSE: UsernameToken Username="...", PasswordDigest="...", Nonce="...", Created="..."
    PasswordDigest = base64( SHA1( nonce_bytes + created_str + secret_str ) )
    """
    import os, hashlib, base64
    nonce_bytes = os.urandom(16)
    b64_nonce = base64.b64encode(nonce_bytes).decode()
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sha1_input = nonce_bytes + created.encode() + secret.encode()
    password_digest = base64.b64encode(hashlib.sha1(sha1_input).digest()).decode()
    return {
        "X-WSSE": (
            f'UsernameToken Username="{username}", '
            f'PasswordDigest="{password_digest}", '
            f'Nonce="{b64_nonce}", '
            f'Created="{created}"'
        )
    }


class GesassoSyncService(FederalSyncService):
    """Implémentation GesAsso avec WSSE Auth et mapping spécifique."""

    PLATFORM = "gesasso"

    def __init__(self, base_url: str, username: str, password: str, association_code: str):
        self._username = username
        self._password = password
        # GesAsso utilise WSSE, pas Digest — on passe auth=None et on gère les headers manuellement
        super().__init__(platform="gesasso", base_url=base_url, auth=None, association_code=association_code)

    def _wsse_headers(self) -> dict[str, str]:
        return _make_wsse_headers(self._username, self._password)

    def map_flight(self, flight: ValidatedFlight) -> dict[str, Any]:
        """
        Transforme un ValidatedFlight ERP en payload pour l'API GesAsso.
        
        Mapping validé sur l'API réelle (POST /flights-collection.json) :
        
        Champs GesAsso            | Source ERP
        --------------------------|------------------------------------
        date                      | flight.jour (YYYY-MM-DD)
        association_code          | self.association_code
        aircraft_registration     | flight.asset_code
        person_one_licence_number | MemberSheet.licence_number du pilote
                                  |   (peuplé via la sync pilotes Planche — voir ci-dessous)
        person_two_licence_number | MemberSheet.licence_number du second pilote
        instruction_flight        | type_of_flight IN (0, 5, 6)
        takeoff_time              | flight.takeoff_time (HH:MM)
        landing_time              | flight.landing_time (HH:MM)
        takeoff_count             | flight.landing_count
        launching_mode            | flight.launch_method → enum
        engine_duration           | flight.engine_time (minutes)
        tow_aircraft_registration | flight.launch_asset_code
        takeoff_oaci_code         | flight.takeoff_location
        landing_oaci_code         | flight.landed_location
        comment                   | flight.observations
        """
        launching_mode_map = {
            0: "AUTONOMOUS",
            1: "WINCH",
            2: "AIRCRAFT_TOWING",
            3: "CAR_TOWING",
        }
        is_instruction = flight.type_of_flight in (0, 5, 6)
        payload: dict[str, Any] = {
            "date": flight.jour.isoformat() if flight.jour else None,
            "association_code": self.association_code,
            "instruction_flight": is_instruction,
            "takeoff_count": flight.landing_count or 1,
        }
        if flight.asset_code:
            payload["aircraft_registration"] = flight.asset_code
        if flight.takeoff_time:
            payload["takeoff_time"] = flight.takeoff_time
        if flight.landing_time:
            payload["landing_time"] = flight.landing_time
        if flight.launch_method is not None:
            payload["launching_mode"] = launching_mode_map.get(flight.launch_method, "AUTONOMOUS")
        if flight.engine_time is not None:
            payload["engine_duration"] = int(flight.engine_time)
        if flight.launch_asset_code:
            payload["tow_aircraft_registration"] = flight.launch_asset_code
        if flight.takeoff_location:
            payload["takeoff_oaci_code"] = flight.takeoff_location
        if flight.landed_location:
            payload["landed_oaci_code"] = flight.landed_location
        if flight.observations:
            payload["comment"] = flight.observations
        return payload

    async def post_flight_collection(
        self, client: httpx.AsyncClient, flights: list[ValidatedFlight]
    ) -> list[dict[str, Any]]:
        url = f"{self.base_url}/flights-collection.json"
        payloads = [self.map_flight(f) for f in flights]
        response = await client.post(
            url, json={"flight_collection": payloads}, headers=self._wsse_headers()
        )
        response.raise_for_status()
        return response.json()

    async def put_flight(
        self, client: httpx.AsyncClient, external_id: str, flight: ValidatedFlight
    ) -> dict[str, Any]:
        url = f"{self.base_url}/flights/{external_id}.json"
        response = await client.put(
            url, json=self.map_flight(flight), headers=self._wsse_headers()
        )
        response.raise_for_status()
        return response.json()
```

### 3.3. Route : `backend/api/routes/federal_sync.py`

```python
"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - federal_sync: Routes de synchronisation fédérale (GesAsso / OSRT)
    Copyright (C) 2026  SAFORCADA Patrick
    ...
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_FEDERAL_SYNC
from models import User, FederalSyncLog
from services.federal_sync import GesassoSyncService
from services.accounting import get_system_setting

router = APIRouter(prefix="/api/v1/flights", tags=["flights"])
logger = logging.getLogger(__name__)

federal_sync_guard = Depends(require_capability(CAP_FEDERAL_SYNC))


class SyncRequest(BaseModel):
    flight_uuids: list[UUID]
    force: bool = False  # Si True, renvoie même les vols déjà transférés (status=2)


class SyncStatusItem(BaseModel):
    flight_uuid: str
    platform: str
    status: int
    external_id: str | None
    last_attempt_at: str | None


@router.post("/sync-gesasso")
async def trigger_gesasso_sync(
    payload: SyncRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(federal_sync_guard),
):
    """Déclenche la synchronisation des vols sélectionnés vers GesAsso."""
    settings = await get_system_setting(db, "GESASSO_SETTINGS")
    if not settings:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="GesAsso settings not configured")

    service = GesassoSyncService(
        base_url=settings.get("url", "https://api.gesasso.ffvp.fr"),
        username=settings["user"],
        password=settings["secret"],
        association_code=settings.get("association_code", ""),
    )

    result = await service.batch_sync_flights(
        db=db,
        flight_uuids=payload.flight_uuids,
        triggered_by=current_user.email or str(current_user.id),
        force=payload.force,
    )
    return result


@router.get("/sync-status", response_model=list[SyncStatusItem])
async def list_sync_status(
    platform: str = Query(..., description="Plateforme: 'gesasso' or 'osrt'"),
    status_filter: int | None = Query(None, description="Filtrer par statut (0-4)"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(federal_sync_guard),
):
    """
    Retourne le dernier statut de synchronisation pour tous les vols
    sur une plateforme donnée.
    """
    # Dernier log par vol × plateforme via DISTINCT ON
    subq = (
        select(
            FederalSyncLog.validated_flight_uuid,
            FederalSyncLog.platform,
            FederalSyncLog.status,
            FederalSyncLog.external_id,
            FederalSyncLog.attempt_at,
        )
        .distinct(FederalSyncLog.validated_flight_uuid, FederalSyncLog.platform)
        .where(FederalSyncLog.platform == platform)
        .order_by(
            FederalSyncLog.validated_flight_uuid,
            FederalSyncLog.platform,
            desc(FederalSyncLog.attempt_at),
        )
        .subquery()
    )

    query = select(subq)
    if status_filter is not None:
        query = query.where(subq.c.status == status_filter)
    query = query.order_by(desc(subq.c.attempt_at)).limit(200)

    result = await db.execute(query)
    rows = result.all()

    return [
        SyncStatusItem(
            flight_uuid=str(r.validated_flight_uuid),
            platform=r.platform,
            status=r.status or 0,
            external_id=r.external_id,
            last_attempt_at=r.attempt_at.isoformat() if r.attempt_at else None,
        )
        for r in rows
    ]
```

### 3.4. Configuration des plateformes externes (SystemSetting)

Chaque plateforme externe (GesAsso, OSRT, et toute future) a sa propre configuration stockée dans `system_settings` sous une clé dédiée.

**Structure générique par plateforme :**

| Clé | Exemple | Description |
|-----|---------|-------------|
| `url` | `https://api.gesasso.ffvp.fr` | URL de base de l'API |
| `user` | `monClub` | Identifiant de connexion |
| `secret` | `xxxxxxxx` | Mot de passe / clé secrète (stocké en clair dans le JSON — à migrer vers un vault si nécessaire) |

**Exemple pour GesAsso (`system_settings` key = `GESASSO_SETTINGS`) :**

```json
{
  "url": "https://api.gesasso.ffvp.fr",
  "user": "monClub",
  "secret": "xxxxxxxx",
  "association_code": "XXXXXXXX"
}
```

> `association_code` est le code club FFVP, requis dans chaque payload de vol (`association_code` dans `POST /flights-collection.json`). Il n'est pas nécessaire pour la synchronisation des données pilotes (`/people/{id}.json`).

**Exemple pour OSRT (`system_settings` key = `OSRT_SETTINGS`) :**

```json
{
  "url": "https://osrt.ffvp.fr/api",
  "user": "monClub",
  "secret": "xxxxxxxx"
}
```

> Les champs `url`, `user`, `secret` sont communs à toutes les plateformes. Si une plateforme nécessite des paramètres supplémentaires (ex : `association_code`), ils sont ajoutés dans le même objet JSON.

### 3.5. Route d'administration des configurations

Dans `backend/api/routes/admin.py` (ou un nouveau `backend/api/routes/federal_sync_admin.py`) :

```python
"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - federal_sync_admin: Configuration des plateformes de synchronisation fédérale
    Copyright (C) 2026  SAFORCADA Patrick
    ...
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_FEDERAL_SYNC
from models import SystemSetting, User

router = APIRouter(prefix="/api/v1/admin/federal-sync", tags=["admin"])
admin_guard = Depends(require_capability(CAP_FEDERAL_SYNC))


class PlatformConfig(BaseModel):
    url: str
    user: str
    secret: str
    association_code: str | None = None  # requis pour GesAsso (code club FFVP)
    extra: dict | None = None  # params supplémentaires futurs


class FederalSyncConfigResponse(BaseModel):
    gesasso: PlatformConfig | None
    osrt: PlatformConfig | None


def _build_config(value: dict | None) -> PlatformConfig | None:
    if not value:
        return None
    return PlatformConfig(
        url=value.get("url", ""),
        user=value.get("user", ""),
        secret=value.get("secret", ""),
        extra={k: v for k, v in value.items() if k not in ("url", "user", "secret")},
    )


@router.get("/config", response_model=FederalSyncConfigResponse)
async def get_federal_sync_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_guard),
):
    """Retourne la configuration de toutes les plateformes."""
    from services.accounting import get_system_settings_batch
    settings = await get_system_settings_batch(db, ["GESASSO_SETTINGS", "OSRT_SETTINGS"])
    return FederalSyncConfigResponse(
        gesasso=_build_config(settings.get("GESASSO_SETTINGS")),
        osrt=_build_config(settings.get("OSRT_SETTINGS")),
    )


class UpdatePlatformConfigRequest(BaseModel):
    platform: str  # "gesasso" ou "osrt"
    config: PlatformConfig


@router.put("/config")
async def update_platform_config(
    payload: UpdatePlatformConfigRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_guard),
):
    """Met à jour la configuration d'une plateforme."""
    if payload.platform not in ("gesasso", "osrt"):
        raise HTTPException(400, detail="Plateforme invalide. Utilisez 'gesasso' ou 'osrt'.")

    settings_key = f"{payload.platform.upper()}_SETTINGS"
    config_dict = payload.config.model_dump(exclude_none=True)
    # Ne pas exposer le secret en clair dans les logs — le frontend ne renvoie
    # le secret que s'il a été modifié (sinon valeur "********")
    if config_dict.get("secret") == "********":
        # Conserver l'ancienne valeur
        from services.accounting import get_system_setting
        current = await get_system_setting(db, settings_key)
        if current:
            config_dict["secret"] = current.get("secret", config_dict["secret"])

    # upsert via la logique existante de SystemSetting
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == settings_key)
    )
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = config_dict
    else:
        db.add(SystemSetting(key=settings_key, value=config_dict))
    await db.commit()

    return {"status": "ok", "platform": payload.platform}


# Supprimer les paramètres de connexion du code métier :
# La route /sync-gesasso lis désormais la configuration depuis SystemSetting
```

> **Stockage du secret :** Pour l'instant stocké en JSON dans `system_settings.value`. À terme, on pourra migrer vers une colonne chiffrée ou un vault. Le frontend masque le secret par `"********"` et ne l'envoie que s'il a été modifié.

---

## 4. Frontend Implementation

### 4.1. Architecture existante à réutiliser

Le workspace flights (`FlightsWorkspacePage.tsx`) contient **déjà** des tabs placeholders pour Gesasso et OSRT :

```tsx
{
  value: "gesasso",
  label: t("workspace.tabs.gesasso", "Envoi Gesasso"),
  icon: ArrowLeftRight,
  content: <PlaceholderPage eta="Phase 8" />,
},
{
  value: "osrt",
  label: t("workspace.tabs.osrt", "Envoi OSRT"),
  icon: Plug,
  content: <PlaceholderPage eta="Phase 8" />,
},
```

Les entrées de navigation existent déjà dans `frontend/src/shell/navigation.ts` :
```typescript
{ to: '/workspace/flights?tab=gesasso', labelKey: 'nav.gesassoSync', requiredCapability: 'FEDERAL_SYNC' },
{ to: '/workspace/flights?tab=osrt', labelKey: 'nav.osrtSync', requiredCapability: 'FEDERAL_SYNC' },
```

### 4.2. Composant générique : `FederalSyncPage.tsx`

Créer dans `frontend/src/modules/flights/components/FederalSyncPage.tsx`.  
Ce composant est réutilisable pour GesAsso et OSRT via une prop `platform`.

```tsx
/*
    ERP-CLUB - ERP pour Club de vol à voile
    - FederalSyncPage: Tableau de bord synchronisation fédérale générique
    Copyright (C) 2026  SAFORCADA Patrick
    ...
 */

import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { apiClient } from "@/api/client";
import { toast } from "sonner";

interface SyncStatusItem {
  flight_uuid: string;
  platform: string;
  status: number;
  external_id: string | null;
  last_attempt_at: string | null;
}

/** Statuts de synchronisation */
const STATUS_MAP: Record<number, { label: string; icon: React.ElementType; variant: "outline" | "warning" | "success" | "destructive" | "secondary" }> = {
  0: { label: "Non envoyé",      icon: Clock,         variant: "outline" },
  1: { label: "En attente",      icon: Clock,         variant: "warning" },
  2: { label: "Transféré",       icon: CheckCircle2,  variant: "success" },
  3: { label: "Échec",           icon: AlertCircle,   variant: "destructive" },
  4: { label: "Ignoré",          icon: XCircle,       variant: "secondary" },
};

// Les vols status=2 sont affichés "Transféré" et exclus de la sélection par défaut.
// Le bouton "Forcer le renvoi" envoie SyncRequest avec force=true pour les réenvoyer.

interface FederalSyncPageProps {
  platform: "gesasso" | "osrt";
  label: string;
}

export function FederalSyncPage({ platform, label }: FederalSyncPageProps) {
  const { t } = useTranslation("flights");
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // GET /api/v1/flights/sync-status?platform=...
  const { data: syncStatus, isLoading } = useQuery<SyncStatusItem[]>({
    queryKey: ["flights", "sync-status", platform],
    queryFn: () => apiClient.get(`/flights/sync-status?platform=${platform}`).then(r => r.data),
  });

  // POST /api/v1/flights/sync-{platform}
  const syncMutation = useMutation({
    mutationFn: ({ flightUuids, force = false }: { flightUuids: string[]; force?: boolean }) =>
      apiClient.post(`/flights/sync-${platform}`, { flight_uuids: flightUuids, force }).then(r => r.data),
    onSuccess: (result) => {
      const parts = [`${result.synced} transféré(s)`];
      if (result.already_transferred > 0) parts.push(`${result.already_transferred} déjà transféré(s) (ignorés)`);
      if (result.failed > 0) parts.push(`${result.failed} échec(s)`);
      toast.success(parts.join(" · "));
      queryClient.invalidateQueries({ queryKey: ["flights", "sync-status"] });
    },
    onError: () => toast.error("Erreur lors de la synchronisation"),
  });

  const columns = [
    {
      id: "select",
      header: ({ table }: any) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          onCheckedChange={(v: boolean) => table.toggleAllRowsSelected(v)}
        />
      ),
      cell: ({ row }: any) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v: boolean) => row.toggleSelected(v)}
        />
      ),
    },
    { accessorKey: "flight_uuid", header: "Vol" },
    {
      accessorKey: "status",
      header: `Statut ${label}`,
      cell: ({ row }: any) => {
        const status: number = row.original.status;
        const s = STATUS_MAP[status] || STATUS_MAP[0];
        const Icon = s.icon;
        return <Badge variant={s.variant}><Icon className="w-3 h-3 mr-1" />{s.label}</Badge>;
      },
    },
    {
      id: "actions",
      cell: ({ row }: any) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => syncMutation.mutate([row.original.flight_uuid])}
          disabled={syncMutation.isPending}
        >
          Envoyer
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Synchronisation {label}</h2>
        <Button
          onClick={() => syncMutation.mutate({ flightUuids: Array.from(selected) })}
          disabled={selected.size === 0 || syncMutation.isPending}
        >
          Lancer la synchronisation ({selected.size} vols)
        </Button>
        <Button
          variant="outline"
          onClick={() => syncMutation.mutate({ flightUuids: Array.from(selected), force: true })}
          disabled={selected.size === 0 || syncMutation.isPending}
        >
          Forcer le renvoi
        </Button>
      </div>
      <DataTable columns={columns} data={syncStatus || []} loading={isLoading} />
    </div>
  );
}
```

### 4.3. Intégration dans FlightsWorkspacePage

```tsx
import { FederalSyncPage } from "./FederalSyncPage";

// Dans le tableau tabs :
{
  value: "gesasso",
  label: t("workspace.tabs.gesasso", "Envoi GesAsso"),
  icon: ArrowLeftRight,
  content: <FederalSyncPage platform="gesasso" label="GesAsso" />,
},
{
  value: "osrt",
  label: t("workspace.tabs.osrt", "Envoi OSRT"),
  icon: Plug,
  content: <FederalSyncPage platform="osrt" label="OSRT" />,
},
```

### 4.4. API Hooks

Dans `frontend/src/modules/flights/api/index.ts`, ajouter :

```typescript
export const flightsQueryKeys = {
  // ... existants ...
  syncStatus: (platform: string) => ['flights', 'sync-status', platform] as const,
};
```

`OsrtSyncPage.tsx` — Structure identique, endpoints à adapter quand l'API OSRT sera spécifiée.

### 4.4. Intégration dans FlightsWorkspacePage

Remplacer les `PlaceholderPage` par les vrais composants :

```tsx
import { GesassoSyncPage } from "./GesassoSyncPage";
import { OsrtSyncPage } from "./OsrtSyncPage";

// Dans le tableau tabs :
{
  value: "gesasso",
  label: t("workspace.tabs.gesasso", "Envoi Gesasso"),
  icon: ArrowLeftRight,
  content: <GesassoSyncPage />,
},
{
  value: "osrt",
  label: t("workspace.tabs.osrt", "Envoi OSRT"),
  icon: Plug,
  content: <OsrtSyncPage />,
},
```

### 4.5. API Hooks

Dans `frontend/src/modules/flights/api/index.ts`, ajouter :

```typescript
export const flightsQueryKeys = {
  // ... existants ...
  syncStatus: ['flights', 'sync-status'],
  gesassoSync: ['flights', 'sync-gesasso'],
};

export function useSyncStatusQuery(platform?: string) {
  return useQuery({
    queryKey: flightsQueryKeys.syncStatus,
    queryFn: () => apiClient.get(`/flights/sync-status${platform ? `?platform=${platform}` : ''}`).then(r => r.data),
  });
}

export function useGesassoSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flightUuids: string[]) =>
      apiClient.post('/flights/sync-gesasso', { flight_uuids: flightUuids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: flightsQueryKeys.syncStatus });
    },
  });
}
```

---

## 5. OSRT — API SOAP

**Endpoint WSDL :** `https://gnav.g-nav.org/webService/osrt.php?wsdl`
**Service :** NuSOAP (PHP), SOAP 1.1, RPC style encodé

L'API OSRT est un **service SOAP** (pas REST) qui permet de transmettre les activités aéronefs vers le registre OSRT du club.

### 5.1. Méthodes Disponibles

| Méthode | SOAPAction | Entrée | Sortie |
|---|---|---|---|
| `setAeronefActivite` | `.../setAeronefActivite` | `aeronefActivite` | `xsd:string` |
| `getDetailsMateriel` | `.../getDetailsMateriel` | `immat: string` | `detailsMateriel` |
| `getListeAeronefs` | `.../getListeAeronefs` | `code_osrt: string` | `listeAeronefs[]` |

**Namespace SOAP :** `http://osrt.g-nav.org`
**Encodage :** `http://schemas.xmlsoap.org/soap/encoding/`

### 5.2. Types de Données

#### `aeronefActivite` — Envoi d'un vol

```xml
<xsd:complexType name="aeronefActivite">
  <xsd:all>
    <xsd:element name="code_gnav" type="xsd:string"/>     <!-- code club OSRT -->
    <xsd:element name="mot_de_passe" type="xsd:string"/>  <!-- password OSRT -->
    <xsd:element name="data" type="xsd:string"/>           <!-- données du vol (format à déterminer) -->
  </xsd:all>
</xsd:complexType>
```

> **Note :** Le champ `data` est une chaîne. Le format exact (XML, CSV, ou texte structuré) n'est pas documenté dans le WSDL. À déterminer par analyse d'un appel SOAP existant ou documentation club.

#### `detailsMateriel` — Détails d'un aéronef

```xml
<xsd:complexType name="detailsMateriel">
  <xsd:all>
    <xsd:element name="type" type="xsd:string"/>          <!-- type d'aéronef -->
    <xsd:element name="variante" type="xsd:string"/>      <!-- variante -->
    <xsd:element name="date_fabrication" type="xsd:string"/>
    <xsd:element name="situation" type="xsd:string"/>     <!-- situation/propriétaire -->
    <xsd:element name="nom_prenom" type="xsd:string"/>    <!-- nom propriétaire -->
    <xsd:element name="co_proprio" type="xsd:boolean"/>   <!-- copropriété -->
    <xsd:element name="mono_bi_rem" type="xsd:string"/>   <!-- mono/bi/remorqueur -->
    <xsd:element name="actif" type="xsd:boolean"/>
  </xsd:all>
</xsd:complexType>
```

#### `detailsAeronefs` — Aéronef dans une liste

```xml
<xsd:complexType name="detailsAeronefs">
  <xsd:all>
    <xsd:element name="immat" type="xsd:string"/>         <!-- immatriculation -->
    <xsd:element name="type" type="xsd:string"/>
    <xsd:element name="variante" type="xsd:string"/>
    <xsd:element name="date_fabrication" type="xsd:string"/>
    <xsd:element name="situation" type="xsd:string"/>
    <xsd:element name="nom_prenom" type="xsd:string"/>
    <xsd:element name="co_proprio" type="xsd:boolean"/>
    <xsd:element name="mono_bi_rem" type="xsd:string"/>
    <xsd:element name="actif" type="xsd:boolean"/>
  </xsd:all>
</xsd:complexType>
```

### 5.3. Authentification

L'authentification OSRT est **intégrée dans chaque appel SOAP** via les champs `code_gnav` et `mot_de_passe` de la structure `aeronefActivite`. Contre-mesures de sécurité :

- Stocker les credentials OSRT dans `SystemSetting` (`OSRT_SETTINGS` module), au même titre que les credentials GesAsso.
- Ne pas logguer `mot_de_passe` en clair.
- Utiliser `httpx` avec construction manuelle de l'enveloppe SOAP XML (via `xml.etree.ElementTree` ou bibliothèque dédiée).

### 5.4. Appel SOAP — Exemple

```python
import httpx
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

async def call_set_aeronef_activite(
    code_gnav: str,
    mot_de_passe: str,
    data_xml: str,
) -> str:
    """
    Appelle setAeronefActivite via SOAP 1.1 RPC encodé.
    
    Construit manuellement l'enveloppe SOAP car le service NuSOAP
    utilise le style RPC encodé (namespace http://osrt.g-nav.org).
    """
    envelope = f"""<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
    xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:tns="http://gnav.g-nav.org/soap/osrt">
  <SOAP-ENV:Body>
    <ns1:setAeronefActivite xmlns:ns1="http://osrt.g-nav.org"
        SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <aeronefActivite xsi:type="tns:aeronefActivite">
        <code_gnav xsi:type="xsd:string">{escape(code_gnav)}</code_gnav>
        <mot_de_passe xsi:type="xsd:string">{escape(mot_de_passe)}</mot_de_passe>
        <data xsi:type="xsd:string">{escape(data_xml)}</data>
      </aeronefActivite>
    </ns1:setAeronefActivite>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>"""
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://gnav.g-nav.org/webService/osrt.php",
            content=envelope,
            headers={"Content-Type": "text/xml; charset=UTF-8",
                      "SOAPAction": "http://gnav.g-nav.org/webService/osrt.php/setAeronefActivite"},
        )
        response.raise_for_status()
        return response.text
```

### 5.5. Mapping ERP → OSRT

Le champ `data` de `aeronefActivite` contient les données du vol dans un format qui reste à déterminer. Hypothèses par ordre de probabilité :

1. **Format propriétaire texte** — lignes avec délimiteurs (le plus probable pour un service PHP historique)
2. **Format XML** avec schéma non documenté dans le WSDL
3. **CSV** avec séparateur spécifique

**Action requise :** Avant d'implémenter le service OSRT, effectuer un appel de test à `setAeronefActivite` avec des données réelles fournies par le club pour déterminer le format attendu du champ `data`.

Utiliser `getListeAeronefs` pour vérifier la connectivité :

```python
async def get_liste_aeronefs(code_osrt: str) -> list[dict]:
    """Récupère la liste des aéronefs enregistrés sur OSRT."""
    envelope = f"""<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope ...>
  <SOAP-ENV:Body>
    <ns1:getListeAeronefs xmlns:ns1="http://osrt.g-nav.org"
        SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <code_osrt xsi:type="xsd:string">{escape(code_osrt)}</code_osrt>
    </ns1:getListeAeronefs>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://gnav.g-nav.org/webService/osrt.php",
            content=envelope,
            headers={"Content-Type": "text/xml",
                      "SOAPAction": "http://gnav.g-nav.org/webService/osrt.php/getListeAeronefs"},
        )
        # Parser la réponse SOAP XML pour extraire le tableau d'aéronefs
        root = ET.fromstring(response.content)
        # Naviguer dans l'enveloppe SOAP pour trouver les données
        ...
```

### 5.6. Architecture OSRT Sync Service

`backend/services/osrt_sync.py` — Pattern identique à `gesasso_sync.py` :

```python
class OsrtSyncService:
    def __init__(self, code_gnav: str, mot_de_passe: str):
        self.code_gnav = code_gnav
        self.mot_de_passe = mot_de_passe
        self.soap_endpoint = "https://gnav.g-nav.org/webService/osrt.php"

    def _map_flight_to_osrt_data(self, flight: ValidatedFlight) -> str:
        """Transforme un vol ERP en chaîne data OSRT (format à définir)."""
        ...
    
    async def send_flight(self, flight: ValidatedFlight) -> str:
        """Envoie un vol vers OSRT via setAeronefActivite."""
        data = self._map_flight_to_osrt_data(flight)
        return await call_set_aeronef_activite(
            self.code_gnav, self.mot_de_passe, data
        )
    
    async def get_aircraft_list(self) -> list[dict]:
        """Récupère la liste des aéronefs OSRT."""
        ...
```

### 5.7. Configuration OSRT (SystemSetting)

Module `OSRT_SETTINGS` :

```json
{
  "code_gnav": "xxx",
  "mot_de_passe": "xxx",
  "endpoint": "https://gnav.g-nav.org/webService/osrt.php"
}
```

---

## 6. Plan d'Implémentation

### Phase 1 — Foundation (jour 1-2)
1. Migration SQL `052_federal_sync_logs.sql` (table `federal_sync_logs` + vue `federal_sync_status`)
2. Nouvelle capability `CAP_FEDERAL_SYNC` dans `constants.py`
3. Modèle ORM : ajouter `FederalSyncLog` dans `models.py`
4. `SystemSetting` pour la configuration GesAsso (`GESASSO_SETTINGS` avec `association_code`) + OSRT
5. **PlancheBack** : ajouter `licence_number` dans `ErpPilotListItem` (issu de `gesasso_data.licence_number`)
6. **ERP** : lors de la sync pilotes (`GET /erp/pilots`), sauvegarder `licence_number` dans `MemberSheet.licence_number`

### Phase 2 — Backend Sync vols GesAsso (jour 2-4)
1. Service `GesassoSyncService` (vol push) dans `services/federal_sync.py`
   - WSSE auth (`_make_wsse_headers`), **pas** DigestAuth
   - `map_flight` lit `MemberSheet.licence_number` pour `person_one_licence_number`
   - Vols déjà transférés (status=2) : skip sauf `force=True`
   - Validation pré-envoi : rejet + log status=3 si `licence_number` manquant
2. Routes `POST /flights/sync-gesasso`, `GET /flights/sync-status`
3. Route de configuration (GET/PUT `/admin/federal-sync/config`)
4. Tests unitaires (`backend/tests/test_gesasso_flight_sync.py`)

### Phase 3 — Backend Sync OSRT (jour 4-6)
1. Déterminer le format du champ `data` de `setAeronefActivite` (test réel avec club)
2. Service `OsrtSyncService` dans `services/osrt_sync.py`
3. Routes `POST /flights/sync-osrt`
4. Route de configuration OSRT (GET/PUT)
5. Tests unitaires (`backend/tests/test_osrt_sync.py`)

### Phase 4 — Frontend (jour 6-10)
1. `GesassoSyncPage.tsx` — grille vols avec sélection, badges statut, bouton "Lancer" et "Forcer le renvoi"
2. `OsrtSyncPage.tsx` — grille identique adaptée OSRT
3. Intégration dans `FlightsWorkspacePage.tsx`
4. Hooks API dans `modules/flights/api/index.ts`

---

## 7. Références

- API GesAsso documentée : `https://api.gesasso.ffvp.fr/admin/doc` (auth Digest admin/doc ; WSSE pour les appels API)
- Implémentation de référence : `docs/gesasso.py` (PlancheBack — authentification WSSE, endpoints pilotes, qualifications)
- Code existant Planche : `backend/services/planche_integration.py` (pattern async + AuditLog à suivre)
- Modèles ORM : `backend/models.py` (`ValidatedFlight`, `Member`, `MemberSheet`)
- Routes existantes : `backend/api/routes/flights.py`, `backend/api/routes/planche.py`
- Frontend existant : `frontend/src/modules/flights/components/FlightsWorkspacePage.tsx`

---

## 8. Checklist de Conformité

> **Mise à jour 2026-06-22** — État d'avancement basé sur le code en branche `main`.

**Schéma & modèles**
- [x] Migration `052_federal_sync_logs.sql` appliquée (table `federal_sync_logs` + vue `federal_sync_status`)
- [x] ORM `FederalSyncLog` ajouté dans `models.py`
- [x] `MemberSheet.season_start_date` + `season_end_date` dans `models.py` (migration 053)
- [x] Types TS `MemberSheet` mis à jour (`season_start_date`, `season_end_date`) dans `frontend/src/modules/members/types/index.ts`

**Configuration**
- [x] `CAP_FEDERAL_SYNC` définie et seedée dans `constants.py`
- [x] `GESASSO_SETTINGS` stocké dans `system_settings` (module `gesasso`) — clés : `base_url`, `username`, `secret`
- [ ] `OSRT_SETTINGS` — à configurer quand le format `data` SOAP est connu
- [x] Page de configuration GesAsso dans l'admin (`/admin?tab=parametres&subtab=gesasso`) — `GesAssoIntegrationPage.tsx`
- [x] Navigation `nav.configGesasso` ajoutée dans `navigation.ts` sous Administration

**Auth GesAsso (WSSE — pas Digest)**
- [x] `WsseAuth(httpx.Auth)` implémenté dans `services/gesasso_client.py` — nonce frais par requête
- [x] `_make_wsse_headers(username, secret)` dans `services/federal_sync.py`
- [x] Tous les appels GesAsso (flight push + lookup pilote) utilisent WSSE
- [x] `httpx.DigestAuth` **absent** du code GesAsso

**Sync vols GesAsso (push — 100% manuelle)**
- [x] Aucun déclenchement automatique — uniquement via action admin dans l'UI
- [x] `batch_sync_flights` vérifie le dernier log : si status=2 et `force=False` → `already_transferred++`, vol ignoré
- [x] `SyncRequest` expose `force: bool = False` ; frontend bouton "Forcer le renvoi"
- [x] La réponse inclut `already_transferred` + `synced` + `failed`
- [x] Toast frontend affiche les 3 compteurs distinctement (`FederalSyncPage.tsx`)
- [x] `map_flight` lit `MemberSheet.licence_number` pour `person_one_licence_number` (via `_licence_map` dans `GesassoSyncService`)
- [x] Vols rejetés (`licence_number` manquant) → statut=3 dans `federal_sync_logs`, pas d'appel API
- [x] Payloads GesAsso utilisent `POST /flights-collection.json` pour le batch
- [x] Vols avec `external_id` connu (renvoi forcé) → `PUT /flights/{id}.json`
- [x] Tabs GesAsso et OSRT dans `FlightsWorkspacePage.tsx` pointent vers `FederalSyncPage`
- [x] Capability guard corrigé : `FEDERAL_SYNC` (était `MANAGE_SYSTEM_SETTINGS`) dans `navigation.ts`
- [ ] **PlancheBack** : `ErpPilotListItem` inclut `licence_number` (de `gesasso_data.licence_number`) — dépend de PlancheBack
- [ ] **ERP** : sync pilotes Planche (`GET /erp/pilots`) sauvegarde `licence_number` → `MemberSheet.licence_number` — à implémenter dans le service Planche

**Lookup pilotes & import membre**
- [x] `GET /api/v1/gesasso/pilot/{ffvp_id}` — lookup direct par FFVP ID
- [x] `GET /api/v1/gesasso/members/{uuid}/pilot-data` — lookup via UUID membre ERP
- [x] `GET/PUT /api/v1/gesasso/settings` — configuration credentials WSSE
- [x] Bouton "Importer GesAsso" dans `MemberFormPage.tsx` (à côté du champ FFVP ID)
  - Visible uniquement en mode édition quand `ffvp_id` est renseigné
  - Pré-remplit `first_name`, `last_name`, `email`, `phone` (mobile prioritaire)
  - Mise en surbrillance ambre des champs modifiés
  - Toast d'erreur distinctif selon le code HTTP (404 / 503 / 502)
- [x] Hooks frontend dans `frontend/src/modules/gesasso/api/index.ts` :
  - `useGesAssoSettingsQuery`, `useUpdateGesAssoSettingsMutation`
  - `useGesAssoPilotLookupMutation`, `useGesAssoMemberPilotDataMutation`

**OSRT**
- [ ] Service OSRT utilise SOAP 1.1 RPC encodé (`httpx` + XML manuel)
- [ ] Format du champ `data` de `setAeronefActivite` déterminé par test réel avec le club
- [ ] `OsrtSyncService` dans `services/osrt_sync.py`

**Frontend membres — page sync batch GesAsso**
- [ ] `GesAssoSyncPage.tsx` dans le workspace membres — tableau membres × données GesAsso
- [ ] Colonnes : nom, email, téléphone, licence, validité saison, statut (Conforme / Différent / Non trouvé)
- [ ] Badge `Expirée` si `season_end_date` < aujourd'hui
- [ ] Batch "Récupérer tout" + sélection + "Appliquer"
- [ ] Navigation `nav.gesassoMemberSync` dans `navigation.ts` (sous workspace/members)
- [ ] `UpsertMemberSheetPayload` étendu avec `season_start_date` + `season_end_date` ✅ (types TS mis à jour)
- [ ] Backend `MemberSheetUpsertRequest` + `MemberSheetResponse` dans `schemas/members.py` (à vérifier / compléter)

**i18n**
- [x] `nav.configGesasso` ajouté (`fr` + `en`)
- [x] `admin.settings.gesasso` ajouté (`fr` + `en`)
- [x] Clés `admin.gesasso.*` (settings page) ajoutées (`fr` + `en`)
- [x] Clés `members.form.importGesasso*` ajoutées (`fr` + `en`)

**Qualité**
- [x] Les routes utilisent `AsyncSession` et `require_capability(...)`
- [x] Les imports suivent `from api.dependencies import get_db`
- [x] AuditLog créé pour chaque batch de vols (dans `batch_sync_flights`)
- [ ] Tests : `test_gesasso_flight_sync.py`, `test_osrt_sync.py`

---

## 7. GesAsso Member Data Sync (v3 — Direct ERP Integration)

> **Contexte :** PlancheBack n'est plus utilisé pour remonter les données membres. L'ERP lit GesAsso directement via `GesAssoClient` (WSSE). Cette section couvre le backend déjà livré et le frontend à implémenter.

### 7.1. Backend livré (2026-06-21) ✅

| Fichier | Contenu |
|---------|---------|
| `backend/services/gesasso_client.py` | `WsseAuth(httpx.Auth)` + `GesAssoClient.get_pilot_personal_info` — appel unique `GET /people/{ffvp_id}.json` |
| `backend/schemas/gesasso.py` | `GesAssoSettingsPayload`, `GesAssoSettingsResponse`, `GesAssoPilotLookupResponse` |
| `backend/api/routes/gesasso.py` | `GET/PUT /api/v1/gesasso/settings`, `GET /api/v1/gesasso/pilot/{ffvp_id}`, `GET /api/v1/gesasso/members/{uuid}/pilot-data` |
| `backend/main.py` | Router `gesasso` enregistré |

Credentials stockés dans `system_settings` sous le module `gesasso` : `{ base_url, username, secret }`.

### 7.2. Frontend — API module `frontend/src/modules/members/api/index.ts`

Ajouter les hooks suivants dans le module members (ou dans un fichier `gesasso.ts` dédié dans `frontend/src/modules/integrations/`) :

```typescript
// Types
export type GesAssoPilotData = {
  ffvp_id: number
  personal_info: {
    first_name: string | null
    last_name: string | null
    email: string | null
    phone_number: string | null        // fixe
    mobile_phone_number: string | null // prioritaire pour le champ ERP phone
    licence: {
      licenceNumber: string | null
      seasonStartDate: string | null   // → MemberSheet.season_start_date
      seasonEndDate: string | null     // → MemberSheet.season_end_date
    } | null
  }
}

// Hook: lookup par UUID membre ERP
export function useGesAssoPilotDataQuery(memberUuid: string | null, enabled = false) {
  return useQuery<GesAssoPilotData>({
    queryKey: ['gesasso', 'member', memberUuid],
    queryFn: async () => {
      const { data } = await apiClient.get(
        `/api/v1/gesasso/members/${memberUuid}/pilot-data`,
        getAuthRequestConfig()
      )
      return data
    },
    enabled: enabled && !!memberUuid,
    staleTime: 60_000,
    retry: false,
  })
}

// Hook: lookup direct par FFVP ID
export function useGesAssoPilotByFfvpQuery(ffvpId: number | null, enabled = false) {
  return useQuery<GesAssoPilotData>({
    queryKey: ['gesasso', 'pilot', ffvpId],
    queryFn: async () => {
      const { data } = await apiClient.get(
        `/api/v1/gesasso/pilot/${ffvpId}`,
        getAuthRequestConfig()
      )
      return data
    },
    enabled: enabled && ffvpId != null,
    staleTime: 60_000,
    retry: false,
  })
}
```

### 7.3. Frontend — Page "Synchronisation GesAsso membres"

**Fichier :** `frontend/src/modules/members/components/GesAssoSyncPage.tsx`

**Route :** Ajouter un tab `gesasso` dans `MemberWorkspaceShell` ou une entrée de navigation dédiée `nav.gesassoMemberSync` dans `navigation.ts` (sous workspace/members) avec `requiredCapability: 'MANAGE_USERS'`.

**Comportement :**

1. Charge tous les membres (`useAllMembersQuery` ou filtre `has_ffvp_id=true`)
2. Affiche un tableau avec colonnes :
   - Membre (nom ERP / prénom ERP)
   - FFVP ID (badge "Manquant" si null)
   - Email ERP vs GesAsso
   - Téléphone ERP vs GesAsso (`mobile_phone_number` prioritaire, fallback `phone_number`)
   - N° licence ERP (`MemberSheet.licence_number`) vs GesAsso (`licenceNumber`)
   - Validité saison GesAsso (`seasonStartDate` → `seasonEndDate`) — badge `badge-destructive` "Expirée" si `seasonEndDate` < aujourd'hui
   - Bouton "Récupérer" par ligne → déclenche le lookup individuel
   - Statut : `Conforme` / `Différent` / `Non trouvé` / `Sans FFVP ID`
   - Checkbox pour sélection batch
3. Bouton "Récupérer tout" → lance les lookups pour tous les membres avec `ffvp_id`
4. Bouton "Appliquer la sélection" → pour chaque membre sélectionné :
   - `PATCH /api/v1/members/{uuid}` avec `{ first_name, last_name, email, phone }`
   - `PUT /api/v1/members/{uuid}/sheets` avec `{ licence_number, season_start_date, season_end_date, year: currentYear }`
5. Erreurs inline par ligne : 404 → "Pilote non trouvé sur GesAsso", 502 → "API GesAsso inaccessible", 422 → "Aucun FFVP ID"

**Structure de la colonne statut :**

| Condition | Badge | Action disponible |
|-----------|-------|-------------------|
| `ffvp_id` null | `badge-warning` "Sans FFVP ID" | — |
| Lookup non déclenché | gris "Non vérifié" | Bouton "Récupérer" |
| Lookup en cours | spinner | — |
| Erreur 404 | `badge-destructive` "Non trouvé" | — |
| Erreur 502 | `badge-destructive` "API hors ligne" | — |
| Données identiques | `badge-success` "Conforme" | — |
| Données différentes | `badge-warning` "Différent" | Checkbox + "Appliquer" |

### 7.4. Frontend — Bouton "Importer depuis GesAsso" dans le formulaire membre

**Fichier :** `frontend/src/modules/members/components/MemberFormPage.tsx`

Ajouter un bouton à côté du champ `ffvp_id`. Quand `ffvp_id` est renseigné :

1. Bouton "Importer GesAsso" (icône `Download`, état `loading` pendant le fetch)
2. Au clic → appelle `GET /api/v1/gesasso/pilot/{ffvp_id}`
3. Si succès : pré-remplit les champs du formulaire ERP :
   - `first_name` ← `personal_info.first_name`
   - `last_name` ← `personal_info.last_name`
   - `email` ← `personal_info.email`
   - `phone` ← `personal_info.mobile_phone_number` (fallback : `personal_info.phone_number`)
   - `licence_number` (MemberSheet année courante) ← `personal_info.licence.licenceNumber`
   - `season_start_date` (MemberSheet) ← `personal_info.licence.seasonStartDate`
   - `season_end_date` (MemberSheet) ← `personal_info.licence.seasonEndDate`
4. Affiche un diff visuel (champ surligné en jaune si la valeur GesAsso diffère de la valeur ERP actuelle)
5. Si erreur 404 : toast "Pilote non trouvé sur GesAsso (FFVP ID: {id})"
6. Si erreur 502 : toast "API GesAsso inaccessible — vérifiez les paramètres de connexion"

### 7.5. Navigation et i18n

**`frontend/src/shell/navigation.ts`** — ajouter sous le groupe membres :
```typescript
{ to: '/workspace/members?tab=gesasso', labelKey: 'nav.gesassoMemberSync', requiredCapability: 'MANAGE_USERS' },
```

**`packages/i18n/src/resources/fr.ts`** (namespace `members`) :
```typescript
'gesassoSync.title': 'Synchronisation GesAsso membres',
'gesassoSync.fetchAll': 'Récupérer tout',
'gesassoSync.applySelected': 'Appliquer la sélection',
'gesassoSync.status.noFfvpId': 'Sans FFVP ID',
'gesassoSync.status.notChecked': 'Non vérifié',
'gesassoSync.status.ok': 'Conforme',
'gesassoSync.status.diff': 'Différent',
'gesassoSync.status.notFound': 'Non trouvé',
'gesassoSync.status.apiDown': 'API hors ligne',
'gesassoSync.importButton': 'Importer GesAsso',
'gesassoSync.licenceFederal': 'Licence fédérale',
'gesassoSync.licenceValidity': 'Validité',
```

**`packages/i18n/src/resources/en.ts`** (namespace `members`) :
```typescript
'gesassoSync.title': 'GesAsso member sync',
'gesassoSync.fetchAll': 'Fetch all',
'gesassoSync.applySelected': 'Apply selected',
'gesassoSync.status.noFfvpId': 'No FFVP ID',
'gesassoSync.status.notChecked': 'Not checked',
'gesassoSync.status.ok': 'Up to date',
'gesassoSync.status.diff': 'Different',
'gesassoSync.status.notFound': 'Not found',
'gesassoSync.status.apiDown': 'API offline',
'gesassoSync.importButton': 'Import from GesAsso',
'gesassoSync.licenceFederal': 'Federal licence',
'gesassoSync.licenceValidity': 'Validity',
```

### 7.6. Settings page — GesAsso credentials

**Fichier :** `frontend/src/modules/admin/` ou `frontend/src/modules/integrations/`

Dans la page d'administration des intégrations (ou en onglet dans la page Planche), ajouter un panneau "GesAsso" :
- Champ `base_url` (URL de l'API, défaut `https://api.gesasso.ffvp.fr`)
- Champ `username` (ex: `wsse_avat`)
- Champ `secret` (mot de passe, masqué, envoyé seulement si modifié)
- Bouton "Tester la connexion" → `GET /api/v1/gesasso/pilot/{test_ffvp_id}` pour valider les credentials

Hooks :
```typescript
export function useGesAssoSettingsQuery() {
  return useQuery({
    queryKey: ['gesasso', 'settings'],
    queryFn: async () => {
      const { data } = await apiClient.get('/api/v1/gesasso/settings', getAuthRequestConfig())
      return data
    },
  })
}

export function useUpdateGesAssoSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { base_url: string; username: string; secret: string }) => {
      const { data } = await apiClient.put('/api/v1/gesasso/settings', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gesasso', 'settings'] }),
  })
}
```

### 7.7. Checklist v3 (mise à jour 2026-06-22)

**Backend (✅ livré)**
- [x] `WsseAuth` implémenté comme `httpx.Auth` — nonce frais par requête
- [x] `GesAssoClient.get_pilot_personal_info` — `GET /people/{ffvp_id}.json` uniquement (pas de qualifications)
- [x] `GET /api/v1/gesasso/pilot/{ffvp_id}` — lookup direct
- [x] `GET /api/v1/gesasso/members/{uuid}/pilot-data` — lookup via membre ERP
- [x] `GET/PUT /api/v1/gesasso/settings` — configuration credentials
- [x] Erreurs HTTP mappées : 404 → 404, autres → 502, réseau → 502
- [x] Credentials non configurés → 503 avec message explicite
- [x] Route enregistrée dans `main.py`
- [x] `MemberSheet.season_start_date` + `season_end_date` dans `backend/models.py` (migration 053)

**Backend (à implémenter)**
- [ ] Champs `season_start_date` + `season_end_date` dans `MemberSheetUpsertRequest` et `MemberSheetResponse` (`backend/schemas/members.py`)

**Frontend (✅ livré — 2026-06-22)**
- [x] Types `GesAssoSettings`, `GesAssoPilotData`, `GesAssoPilotPersonalInfo` dans `frontend/src/modules/gesasso/api/index.ts`
- [x] `useGesAssoMemberPilotDataMutation` — fetch par UUID membre ERP
- [x] `useGesAssoPilotLookupMutation` — fetch direct par FFVP ID
- [x] `useGesAssoSettingsQuery` + `useUpdateGesAssoSettingsMutation`
- [x] `GesAssoIntegrationPage.tsx` — page paramètres (URL, username, secret masqué, bouton test avec FFVP ID)
- [x] Intégrée dans `AdminPage.tsx` sous l'onglet `parametres > gesasso`
- [x] Bouton "Importer GesAsso" dans `MemberFormPage.tsx` à côté du champ FFVP ID
- [x] Pré-remplissage : `first_name`, `last_name`, `email`, `phone` (mobile prioritaire)
- [x] Diff visuel : surbrillance ambre (outline amber-400) sur les champs modifiés
- [x] Erreurs : toast 404 / 503 / 502 avec messages distincts
- [x] `MemberSheet` TS étendu avec `season_start_date` + `season_end_date`
- [x] `UpsertMemberSheetPayload` étendu avec `season_start_date` + `season_end_date`
- [x] Capability guard nav corrigé : `FEDERAL_SYNC` (était `MANAGE_SYSTEM_SETTINGS`)
- [x] Navigation `nav.configGesasso` ajoutée (admin settings)
- [x] Clés i18n `admin.gesasso.*` + `members.form.importGesasso*` ajoutées (`fr` + `en`)

**Frontend (à implémenter)**
- [ ] Page `GesAssoSyncPage.tsx` (workspace membres) — tableau batch membres × données GesAsso
  - Colonnes : nom, email, téléphone, licence, validité saison, statut (Conforme / Différent / Non trouvé)
  - Badge `Expirée` si `season_end_date` < aujourd'hui
  - Batch "Récupérer tout" + sélection + "Appliquer" (met à jour `Member` + `MemberSheet` avec les dates de saison)
- [ ] Navigation `nav.gesassoMemberSync` dans `navigation.ts` (sous workspace/members)