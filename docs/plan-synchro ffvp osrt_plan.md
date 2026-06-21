# Feature Implementation Specification: Manual Federal Synchronization (GesAsso & OSRT)
**Project:** club-erp / PlancheDeVol
**Target Components:** PostgreSQL, FastAPI Backend, React Admin Interface
**Date:** 2026-06-20 (révisé après analyse de l'API GesAsso réelle et du code existant)

This specification details the architecture, database schema, backend API routes, and frontend design required to implement a user-guided, manual synchronization workspace within **club-erp**. This enables administrative users to inspect flight log status metrics, check error returns from external federation endpoints, correct profiles locally, and trigger updates on demand.

---
> **Note de révision (v2):** Ce plan a été **corrigé** après analyse de l'API `https://api.gesasso.ffvp.fr/admin/doc` et du code `gesasso.py` (PlancheBack). Corrections clés :
> - **Authentification WSSE** (pas Digest) — `X-WSSE: UsernameToken Username, PasswordDigest=SHA1(nonce+created+secret), Nonce, Created`
> - **`person_one_licence_number`** vient de `MemberSheet.licence_number`, peuplé via `GET /erp/pilots` (PlancheBack expose `licence_number` depuis `gesasso_data`, mis à jour chaque nuit)
> - **Pas d'email disponible via GesAsso** — l'API retourne uniquement prénom, nom et infos de licence
> - **Périmètre ERP** : push des vols validés + suivi du statut de transfert uniquement. La synchronisation des données membres/qualifications GesAsso est gérée exclusivement par **PlancheBack**
> - **Sync manuelle** : aucun déclenchement automatique ; vols déjà transférés (status=2) ignorés sauf `force=True`

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

> **Périmètre** : La synchronisation des données membres/pilotes depuis GesAsso (qualifications, validité de licence) est gérée exclusivement par **PlancheBack**, pas par l'ERP. L'ERP se limite au push des vols validés vers GesAsso et au suivi de leur statut de transfert.

### 2.3. Source du numéro de licence GesAsso

PlancheBack synchronise chaque nuit les données GesAsso de chaque pilote (via `gesasso.py`) et stocke `licence_number` dans sa table `gesasso_data`. L'ERP récupère ce numéro via la route ERP existante **`GET /erp/pilots`**.

**Action requise côté PlancheBack :** ajouter `licence_number: str | null` dans le schéma `ErpPilotListItem` (valeur issue de `gesasso_data.licence_number` joint sur `ffvp_id`).

Flux :
1. PlancheBack sync GesAsso chaque nuit → `gesasso_data.licence_number` peuplé
2. ERP sync pilotes (`POST /erp/pilots/sync` + `GET /erp/pilots`) → reçoit `licence_number` dans chaque `ErpPilotListItem`
3. ERP sauvegarde `licence_number` dans `MemberSheet.licence_number` lors de la sync pilotes
4. Push GesAsso ERP → `person_one_licence_number` = `MemberSheet.licence_number`

Aucune nouvelle route Planche n'est nécessaire — uniquement l'ajout du champ dans la réponse existante.

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

Avant de merger :

**Schéma & modèles**
- [ ] Migration `052_federal_sync_logs.sql` appliquée (table `federal_sync_logs` + vue `federal_sync_status`)
- [ ] ORM `FederalSyncLog` ajouté dans `models.py`

**Configuration**
- [ ] `CAP_FEDERAL_SYNC` définie et seedée dans `constants.py`
- [ ] `GESASSO_SETTINGS` contient `url`, `user`, `secret`, `association_code`
- [ ] `OSRT_SETTINGS` contient `code_gnav`, `mot_de_passe`, `endpoint`

**Auth GesAsso (WSSE — pas Digest)**
- [ ] `_make_wsse_headers(username, secret)` implémenté avec SHA1 + base64
- [ ] Tous les appels GesAsso (flight push) utilisent WSSE
- [ ] `httpx.DigestAuth` **absent** du code GesAsso

**Sync vols (push — 100% manuelle, hors PlancheBack)**
- [ ] Aucun déclenchement automatique — uniquement via action admin dans l'UI
- [ ] `batch_sync_flights` vérifie le dernier log : si status=2 et `force=False` → `already_transferred++`, vol ignoré
- [ ] `SyncRequest` expose `force: bool = False` ; le frontend a un bouton "Forcer le renvoi"
- [ ] La réponse inclut `already_transferred` en plus de `synced` / `failed`
- [ ] Toast frontend affiche les 3 compteurs distinctement
- [ ] **PlancheBack** : `ErpPilotListItem` inclut `licence_number` (de `gesasso_data.licence_number`)
- [ ] **ERP** : sync pilotes Planche (`GET /erp/pilots`) sauvegarde `licence_number` → `MemberSheet.licence_number`
- [ ] `map_flight` lit `MemberSheet.licence_number` pour `person_one_licence_number`
- [ ] Vols rejetés (`licence_number` manquant) → statut=3 dans `federal_sync_logs`, pas d'appel API
- [ ] Payloads GesAsso utilisent `/flights-collection.json` pour le batch
- [ ] Vols avec external_id connu (renvoi forcé) → `PUT /flights/{id}.json`

**OSRT**
- [ ] Service OSRT utilise SOAP 1.1 RPC encodé (`httpx` + XML manuel)
- [ ] Format du champ `data` de `setAeronefActivite` déterminé par test réel avec le club

**Qualité**
- [ ] Les routes utilisent `AsyncSession` et `require_capability(CAP_FEDERAL_SYNC)`
- [ ] Les imports suivent `from api.dependencies import get_db`
- [ ] AuditLog créé pour chaque batch (membres et vols)
- [ ] Tests : `test_gesasso_flight_sync.py`, `test_osrt_sync.py`
- [ ] Le frontend utilise les hooks TanStack Query existants
- [ ] Les clés i18n existantes (`nav.gesassoSync`, `nav.osrtSync`) sont réutilisées
- [ ] Les placeholders UI sont remplacés par les vrais composants