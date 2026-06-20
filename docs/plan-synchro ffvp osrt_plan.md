# Feature Implementation Specification: Manual Federal Synchronization (GesAsso & OSRT)
**Project:** club-erp / PlancheDeVol
**Target Components:** PostgreSQL, FastAPI Backend, React Admin Interface
**Date:** 2026-06-20 (révisé après analyse de l'API GesAsso réelle et du code existant)

This specification details the architecture, database schema, backend API routes, and frontend design required to implement a user-guided, manual synchronization workspace within **club-erp**. This enables administrative users to inspect flight log status metrics, check error returns from external federation endpoints, correct profiles locally, and trigger updates on demand.

---
> **Note de révision:** Ce plan a été **corrigé** après analyse de l'API `https://api.gesasso.ffvp.fr/admin/doc` (authentification Digest, endpoints réels) et du code existant (modèles, routes, services, UI). Les sections 2 (schéma), 3 (backend) et 4 (frontend) ont été réécrites pour s'aligner sur l'architecture réelle du projet.

## 1. Objectives & User Workflow
1. **Human-in-the-Loop Validation:** Provide absolute transparency before pushing data into the French Gliding Federation (FFVP) infrastructure.
2. **Detailed Failure Auditing:** Store and display raw server errors (`JSONB` responses) to immediately expose missing data points (such as incomplete federal pilot license tokens or aircraft registration indices).
3. **Idempotent Controls:** Enable targeted single-row or bulk-row overrides that replay synchronization tasks safely without duplicating ledger entries on GesAsso or OSRT.

---

## 2. Structural Schema Extensions (SQL Migration)

### 2.1. Principe

Plutôt qu'une table séparée (ce qui forcerait une jointure systématique avec `validated_flights`), on ajoute les colonnes de statut fédéral **directement** dans `validated_flights`. Cette approche suit le pattern existant (`erp_status`, `accounting_entry_uuid`, `billing_quote_state` déjà sur cette table) et évite la redondance.

**Migration :** `052_federal_sync_columns.sql`

```sql
-- ============================================================================
-- MIGRATION 052 : Add federal synchronization status columns to validated_flights
-- ============================================================================

-- GesAsso tracking columns
ALTER TABLE public.validated_flights
    ADD COLUMN gesasso_status SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN gesasso_id VARCHAR(64),
    ADD COLUMN gesasso_error_message TEXT,
    ADD COLUMN gesasso_payload JSONB,
    ADD COLUMN gesasso_response_raw JSONB,
    ADD COLUMN gesasso_last_attempt TIMESTAMP WITH TIME ZONE;

-- OSRT tracking columns
ALTER TABLE public.validated_flights
    ADD COLUMN osrt_status SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN osrt_id VARCHAR(64),
    ADD COLUMN osrt_error_message TEXT,
    ADD COLUMN osrt_payload JSONB,
    ADD COLUMN osrt_response_raw JSONB,
    ADD COLUMN osrt_last_attempt TIMESTAMP WITH TIME ZONE;

-- Status check constraints
ALTER TABLE public.validated_flights
    ADD CONSTRAINT chk_vf_gesasso_status CHECK (gesasso_status IN (0, 1, 2, 3, 4)),
    ADD CONSTRAINT chk_vf_osrt_status CHECK (osrt_status IN (0, 1, 2, 3, 4));

COMMENT ON COLUMN public.validated_flights.gesasso_status IS '0=pas envoyé, 1=en attente, 2=succès, 3=échec, 4=exclu';
COMMENT ON COLUMN public.validated_flights.gesasso_id IS 'ID du vol dans GesAsso (retourné par POST /flights)';
COMMENT ON COLUMN public.validated_flights.gesasso_response_raw IS 'Réponse JSON brute de l''API GesAsso pour débogage';
COMMENT ON COLUMN public.validated_flights.osrt_status IS '0=pas envoyé, 1=en attente, 2=succès, 3=échec, 4=exclu';
COMMENT ON COLUMN public.validated_flights.osrt_id IS 'ID du vol dans OSRT';
COMMENT ON COLUMN public.validated_flights.osrt_response_raw IS 'Réponse JSON brute de l''API OSRT pour débogage';

-- Index partiels pour le dashboard de sync (uniquement les vols en attente/échec)
CREATE INDEX idx_vf_gesasso_sync_queue 
    ON public.validated_flights (gesasso_status) 
    WHERE gesasso_status IN (1, 3);

CREATE INDEX idx_vf_osrt_sync_queue 
    ON public.validated_flights (osrt_status) 
    WHERE osrt_status IN (1, 3);
```

### 2.2. Statuts

| Code | Signification | Badge |
|------|--------------|-------|
| 0    | Pas encore traité | Gris "Pas envoyé" |
| 1    | En attente d'envoi | Orange "En attente" |
| 2    | Synchronisé | Vert "Synchronisé" |
| 3    | Échec | Rouge "Échec" |
| 4    | Exclu (forcé par admin) | Gris barré "Ignoré" |

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

### 3.2. Service : `backend/services/gesasso_sync.py`

Pattern à suivre : `services/planche_integration.py` (classe asynchrone avec `httpx`, AuditLog, savepoint isolation).

```python
"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - gesasso_sync: Service de synchronisation des vols vers l'API GesAsso FFVP
    Copyright (C) 2026  SAFORCADA Patrick
    ...
"""

from datetime import date, datetime, timezone
from typing import Any, Optional
from uuid import UUID
import json
import logging

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ValidatedFlight, AuditLog, Member, Asset
from constants import CAP_FEDERAL_SYNC

logger = logging.getLogger(__name__)


class GesassoSyncService:
    """
    Service de synchronisation des vols validés vers l'API GesAsso.
    
    Utilise Digest Authentication (httpx.DigestAuth).
    Endpoints (d'après https://api.gesasso.ffvp.fr/admin/doc) :
      - POST /flights-collection.json  → Création batch (recommandé)
      - POST /flights.json             → Création unitaire
      - PUT  /flights/{id}.json        → Mise à jour (si gesasso_id connu)
      - GET  /people/{licenceNumber}.json → Recherche personne
    """

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        association_code: str,
        retry_max_attempts: int = 3,
        retry_backoff_ms: int = 1000,
    ):
        self.base_url = base_url.rstrip("/")
        self.auth = httpx.DigestAuth(username=username, password=password)
        self.association_code = association_code
        self.retry_max_attempts = retry_max_attempts
        self.retry_backoff_ms = retry_backoff_ms

    # ------------------------------------------------------------------
    # Mapping ERP → GesAsso
    # ------------------------------------------------------------------
    def _map_flight_to_gesasso(self, flight: ValidatedFlight) -> dict[str, Any]:
        """
        Transforme un ValidatedFlight ERP en payload pour l'API GesAsso.
        
        Mapping validé sur l'API réelle (POST /flights-collection.json) :
        
        Champs GesAsso            | Source ERP
        --------------------------|------------------------------------
        date                      | flight.jour (YYYY-MM-DD)
        association_code          | self.association_code (depuis SystemSetting)
        aircraft_registration     | flight.asset_code
        person_one_licence_number | licence du pilote (via Member.ffvp_id ou trigram)
        person_two_licence_number | licence du second pilote
        instruction_flight        | type_of_flight IN (0=instruction, 5=lacher, 6=supervise)
        takeoff_time              | flight.takeoff_time (HH:MM)
        landing_time              | flight.landing_time (HH:MM)
        takeoff_count             | flight.landing_count
        launching_mode            | flight.launch_method → enum GesAsso
        engine_duration           | flight.engine_time (minutes)
        tow_aircraft_registration | flight.launch_asset_code (si launch_method=2)
        takeoff_oaci_code         | flight.takeoff_location
        landing_oaci_code         | flight.landed_location
        comment                   | flight.observations
        """
        launching_mode_map = {
            0: "AUTONOMOUS",    # exterieur
            1: "WINCH",         # treuil
            2: "AIRCRAFT_TOWING", # remorqueur
            3: "CAR_TOWING",    # autonome (treuil mobile)
        }
        
        is_instruction = flight.type_of_flight in (0, 5, 6)  # instruction, lacher, supervise
        
        payload: dict[str, Any] = {
            "date": flight.jour.isoformat() if flight.jour else None,
            "association_code": self.association_code,
            "instruction_flight": is_instruction,
            "takeoff_count": flight.landing_count or 1,
        }
        
        if flight.asset_code:
            payload["aircraft_registration"] = flight.asset_code
        
        if flight.pilot_erp_id:
            # Résoudre le numéro de licence FFVP depuis Member.ffvp_id
            pass  # À implémenter avec une requête Member
        
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

    # ------------------------------------------------------------------
    # API Calls
    # ------------------------------------------------------------------
    async def _post_flight_collection(
        self, client: httpx.AsyncClient, flights: list[ValidatedFlight]
    ) -> list[dict[str, Any]]:
        """POST /flights-collection.json — Création batch (endpoint recommandé)."""
        payloads = [self._map_flight_to_gesasso(f) for f in flights]
        url = f"{self.base_url}/flights-collection.json"
        response = await client.post(url, json={"flight_collection": payloads})
        response.raise_for_status()
        return response.json()

    async def _put_flight(
        self, client: httpx.AsyncClient, gesasso_id: str, flight: ValidatedFlight
    ) -> dict[str, Any]:
        """PUT /flights/{id}.json — Mise à jour d'un vol existant."""
        payload = self._map_flight_to_gesasso(flight)
        url = f"{self.base_url}/flights/{gesasso_id}.json"
        response = await client.put(url, json=payload)
        response.raise_for_status()
        return response.json()

    async def _lookup_person(self, client: httpx.AsyncClient, licence_number: str) -> dict[str, Any] | None:
        """GET /people/{licenceNumber}.json — Vérifie l'existence d'une personne sur GesAsso."""
        url = f"{self.base_url}/people/{licence_number}.json"
        try:
            response = await client.get(url)
            if response.status_code == 200:
                return response.json()
        except httpx.HTTPError:
            pass
        return None

    # ------------------------------------------------------------------
    # Sync Orchestration
    # ------------------------------------------------------------------
    async def batch_sync_flights(
        self, db: AsyncSession, flight_uuids: list[UUID], triggered_by: str = "system"
    ) -> dict[str, Any]:
        """
        Synchronise une liste de vols vers GesAsso.
        
        Stratégie :
        1. Si gesasso_id est NULL → POST /flights-collection (création batch)
        2. Si gesasso_id est connu → PUT /flights/{id} (mise à jour)
        3. Stocke gesasso_id, gesasso_status, gesasso_response_raw, gesasso_last_attempt
        
        Retourne un résumé similaire à PlancheIntegrationService (success_count, failure_count, ...).
        """
        # 1. Charger les vols avec leurs relations pilotes/associations
        result = await db.execute(
            select(ValidatedFlight).where(
                ValidatedFlight.uuid.in_(flight_uuids)
            )
        )
        flights = result.scalars().all()
        
        if not flights:
            return {"status": "error", "detail": "No flights found", "synced": 0, "failed": 0}
        
        synced = 0
        failed = 0
        errors: list[str] = []
        
        async with httpx.AsyncClient(auth=self.auth, timeout=30.0) as client:
            # Séparer les nouveaux vols (POST batch) des mises à jour (PUT individuel)
            new_flights = [f for f in flights if not f.gesasso_id]
            update_flights = [f for f in flights if f.gesasso_id]
            
            # --- Nouveaux vols : POST /flights-collection ---
            if new_flights:
                gesasso_payload = [self._map_flight_to_gesasso(f) for f in new_flights]
                try:
                    resp_data = await self._post_flight_collection(client, new_flights)
                    # Le mapping de réponse doit associer chaque vol créé à son ID GesAsso
                    # La réponse de /flights-collection retourne les vols créés avec leurs IDs
                    for i, flight in enumerate(new_flights):
                        if i < len(resp_data.get("flight_collection", [])):
                            created = resp_data["flight_collection"][i]
                            flight.gesasso_id = str(created.get("id", ""))
                            flight.gesasso_status = 2
                            flight.gesasso_last_attempt = datetime.now(timezone.utc)
                            flight.gesasso_response_raw = created
                            synced += 1
                        else:
                            flight.gesasso_status = 3
                            flight.gesasso_last_attempt = datetime.now(timezone.utc)
                            failed += 1
                except httpx.HTTPStatusError as e:
                    for flight in new_flights:
                        flight.gesasso_status = 3
                        flight.gesasso_last_attempt = datetime.now(timezone.utc)
                        flight.gesasso_response_raw = {"error": str(e), "response_text": e.response.text[:2000]}
                        failed += 1
                    errors.append(f"POST /flights-collection failed: {e.response.status_code}")
                except httpx.RequestError as e:
                    for flight in new_flights:
                        flight.gesasso_status = 3
                        flight.gesasso_last_attempt = datetime.now(timezone.utc)
                        flight.gesasso_error_message = str(e)[:1000]
                        failed += 1
                    errors.append(f"Network error: {str(e)[:200]}")
            
            # --- Mises à jour : PUT /flights/{id} ---
            for flight in update_flights:
                try:
                    await self._put_flight(client, flight.gesasso_id, flight)
                    flight.gesasso_status = 2
                    flight.gesasso_last_attempt = datetime.now(timezone.utc)
                    synced += 1
                except httpx.HTTPStatusError as e:
                    flight.gesasso_status = 3
                    flight.gesasso_last_attempt = datetime.now(timezone.utc)
                    flight.gesasso_error_message = e.response.text[:1000]
                    flight.gesasso_response_raw = {"error": str(e), "response_text": e.response.text[:2000]}
                    failed += 1
                except httpx.RequestError as e:
                    flight.gesasso_status = 3
                    flight.gesasso_last_attempt = datetime.now(timezone.utc)
                    flight.gesasso_error_message = str(e)[:1000]
                    failed += 1
            
            await db.commit()
        
        # Audit log (pattern existant)
        audit = AuditLog(
            operation_type="gesasso_sync_push",
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
            "total": len(flight_uuids),
            "synced": synced,
            "failed": failed,
            "errors": errors,
        }
```

### 3.3. Route : `backend/api/routes/gesasso_sync.py`

```python
"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - gesasso_sync: Routes de synchronisation fédérale GesAsso
    Copyright (C) 2026  SAFORCADA Patrick
    ...
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_FEDERAL_SYNC, CAP_EDIT_FLIGHTS
from models import User, ValidatedFlight
from services.gesasso_sync import GesassoSyncService
from services.accounting import get_system_setting

router = APIRouter(prefix="/api/v1/flights", tags=["flights"])
logger = logging.getLogger(__name__)

federal_sync_guard = Depends(require_capability(CAP_FEDERAL_SYNC))


class SyncGesassoRequest(BaseModel):
    flight_uuids: list[UUID]


class SyncStatusItem(BaseModel):
    flight_uuid: str
    gesasso_status: int
    gesasso_id: str | None
    gesasso_error_message: str | None
    gesasso_last_attempt: str | None
    osrt_status: int
    osrt_id: str | None
    osrt_error_message: str | None
    osrt_last_attempt: str | None


@router.post("/sync-gesasso")
async def trigger_gesasso_sync(
    payload: SyncGesassoRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(federal_sync_guard),
):
    """
    Déclenche la synchronisation des vols sélectionnés vers GesAsso.
    
    - Si gesasso_id est NULL → POST /flights-collection (création batch)
    - Si gesasso_id est connu → PUT /flights/{id} (mise à jour)
    """
    # Récupérer les paramètres de connexion GesAsso (stockés dans SystemSetting)
    settings = await get_system_setting(db, "GESASSO_SETTINGS")
    if not settings:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="GesAsso settings not configured")
    
    service = GesassoSyncService(
        base_url=settings.get("base_url", "https://api.gesasso.ffvp.fr"),
        username=settings["username"],
        password=settings["password"],
        association_code=settings["association_code"],
    )
    
    result = await service.batch_sync_flights(
        db=db,
        flight_uuids=payload.flight_uuids,
        triggered_by=current_user.email or current_user.id,
    )
    
    return result


@router.get("/sync-status", response_model=list[SyncStatusItem])
async def list_sync_status(
    status_filter: int | None = Query(None, description="Filter by status (0-4)"),
    platform: str | None = Query(None, description="'gesasso' or 'osrt'"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(federal_sync_guard),
):
    """
    Retourne l'état de synchronisation fédérale pour tous les vols.
    
    Paramètres optionnels :
    - status_filter : filtrer par statut (1=en attente, 3=échec)
    - platform : 'gesasso' ou 'osrt' pour filtrer par plateforme
    """
    query = select(ValidatedFlight).order_by(ValidatedFlight.jour.desc()).limit(200)
    
    if status_filter is not None and platform == "gesasso":
        query = query.where(ValidatedFlight.gesasso_status == status_filter)
    elif status_filter is not None and platform == "osrt":
        query = query.where(ValidatedFlight.osrt_status == status_filter)
    elif status_filter is not None:
        query = query.where(
            (ValidatedFlight.gesasso_status == status_filter) |
            (ValidatedFlight.osrt_status == status_filter)
        )
    
    result = await db.execute(query)
    flights = result.scalars().all()
    
    return [
        SyncStatusItem(
            flight_uuid=str(f.uuid),
            gesasso_status=f.gesasso_status or 0,
            gesasso_id=f.gesasso_id,
            gesasso_error_message=f.gesasso_error_message,
            gesasso_last_attempt=f.gesasso_last_attempt.isoformat() if f.gesasso_last_attempt else None,
            osrt_status=f.osrt_status or 0,
            osrt_id=f.osrt_id,
            osrt_error_message=f.osrt_error_message,
            osrt_last_attempt=f.osrt_last_attempt.isoformat() if f.osrt_last_attempt else None,
        )
        for f in flights
    ]
```

### 3.4. Configuration GesAsso (SystemSetting)

Les paramètres de connexion GesAsso sont stockés dans la table `system_settings` (module `GESASSO_SETTINGS`) :

```json
{
  "base_url": "https://api.gesasso.ffvp.fr",
  "username": "xxx",
  "password": "xxx",
  "association_code": "LFIT"
}
```

Interface de configuration à ajouter dans le module **Planche** ou **Administration** (route GET/PUT existante dans `api/routes/planche.py` ou nouveau endpoint dans `api/routes/admin.py`).

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

### 4.2. Nouveau composant : `GesassoSyncPage.tsx`

Créer dans `frontend/src/modules/flights/components/GesassoSyncPage.tsx`.

```tsx
/*
    ERP-CLUB - ERP pour Club de vol à voile
    - GesassoSyncPage: Tableau de bord synchronisation GesAsso
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

/** Statuts de synchronisation */
const STATUS_MAP = {
  0: { label: "Non envoyé",     icon: Clock,         variant: "outline" as const },
  1: { label: "En attente",     icon: Clock,         variant: "warning" as const },
  2: { label: "Synchronisé",     icon: CheckCircle2,  variant: "success" as const },
  3: { label: "Échec",          icon: AlertCircle,    variant: "destructive" as const },
  4: { label: "Ignoré",         icon: XCircle,        variant: "secondary" as const },
};

export function GesassoSyncPage() {
  const { t } = useTranslation("flights");
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // GET /api/v1/flights/sync-status
  const { data: syncStatus, isLoading } = useQuery({
    queryKey: ["flights", "sync-status", "gesasso"],
    queryFn: () => apiClient.get("/flights/sync-status?platform=gesasso").then(r => r.data),
  });

  // POST /api/v1/flights/sync-gesasso
  const syncMutation = useMutation({
    mutationFn: (flightUuids: string[]) =>
      apiClient.post("/flights/sync-gesasso", { flight_uuids: flightUuids }),
    onSuccess: (result) => {
      toast.success(`${result.synced} vol(s) synchronisé(s)`);
      if (result.failed > 0) {
        toast.error(`${result.failed} échec(s)`);
      }
      queryClient.invalidateQueries({ queryKey: ["flights", "sync-status"] });
    },
    onError: () => toast.error("Erreur lors de la synchronisation"),
  });

  const columns = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
        />
      ),
    },
    { accessorKey: "flight_uuid", header: "Vol" },
    { accessorKey: "jour", header: "Date" },
    {
      accessorKey: "gesasso_status",
      header: "Statut GesAsso",
      cell: ({ row }) => {
        const status = row.original.gesasso_status;
        const s = STATUS_MAP[status] || STATUS_MAP[0];
        return <Badge variant={s.variant}><s.icon className="w-3 h-3 mr-1" />{s.label}</Badge>;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
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
        <h2 className="text-lg font-semibold">Synchronisation GesAsso</h2>
        <Button
          onClick={() => syncMutation.mutate(Array.from(selected))}
          disabled={selected.size === 0 || syncMutation.isPending}
        >
          🚀 Lancer la synchronisation ({selected.size} vols)
        </Button>
      </div>
      <DataTable columns={columns} data={syncStatus || []} loading={isLoading} />
    </div>
  );
}
```

### 4.3. Composant OSRT (template)

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
1. Migration SQL `052_federal_sync_columns.sql`
2. Nouvelle capability `CAP_FEDERAL_SYNC` dans `constants.py`
3. Modèle : ajouter les champs Python dans `ValidatedFlight` (SQLAlchemy)
4. `SystemSetting` pour la configuration GesAsso + OSRT

### Phase 2 — Backend Sync GesAsso (jour 3-5)
1. Service `GesassoSyncService` dans `services/gesasso_sync.py`
2. Routes `POST /flights/sync-gesasso` et `GET /flights/sync-status`
3. Route de configuration GesAsso (GET/PUT)
4. Tests unitaires (`backend/tests/test_gesasso_sync.py`)

### Phase 3 — Backend Sync OSRT (jour 5-7)
1. Déterminer le format du champ `data` de `setAeronefActivite` (test réel)
2. Service `OsrtSyncService` dans `services/osrt_sync.py`
3. Routes `POST /flights/sync-osrt`
4. Route de configuration OSRT (GET/PUT)
5. Tests unitaires (`backend/tests/test_osrt_sync.py`)

### Phase 4 — Frontend (jour 7-10)
1. `GesassoSyncPage.tsx` — grille avec sélection, statuts, envoi
2. `OsrtSyncPage.tsx` — grille identique, adaptée aux statuts OSRT
3. Intégration dans `FlightsWorkspacePage.tsx`
4. Hooks API dans `modules/flights/api/index.ts`

---

## 7. Références

---

## 7. Références

- API GesAsso documentée : `https://api.gesasso.ffvp.fr/admin/doc`
- Code existant Planche : `backend/services/planche_integration.py` (pattern à suivre)
- Modèle validé : `backend/models.py` (class `ValidatedFlight`)
- Routes existantes : `backend/api/routes/flights.py`, `backend/api/routes/planche.py`
- Frontend existant : `frontend/src/modules/flights/components/FlightsWorkspacePage.tsx`

---

## 8. Checklist de Conformité

Avant de merger :

- [ ] Les colonnes de statut sont sur `validated_flights` (pas une table séparée)
- [ ] La capability `CAP_FEDERAL_SYNC` est définie et seedée
- [ ] Le service GesAsso utilise `httpx.DigestAuth` (authentification Digest)
- [ ] Le service OSRT utilise SOAP 1.1 RPC encodé (`httpx` + construction XML manuelle)
- [ ] Les routes utilisent `AsyncSession` et `require_capability`
- [ ] Les imports suivent le chemin `from api.dependencies import get_db` (pas `app.`)
- [ ] Les payloads GesAsso utilisent `/flights-collection` pour le batch
- [ ] Les vols existants sont envoyés en PUT avec leur `gesasso_id`
- [ ] L'association_code GesAsso est stocké dans `SystemSetting` (module GESASSO_SETTINGS)
- [ ] Les credentials OSRT sont stockés dans `SystemSetting` (module OSRT_SETTINGS)
- [ ] Le format du champ `data` de `setAeronefActivite` a été déterminé par test réel
- [ ] Les erreurs réseau et HTTP sont capturées avec savepoint isolation
- [ ] Le frontend utilise les hooks TanStack Query existants
- [ ] Les clés i18n existantes (`nav.gesassoSync`, `nav.osrtSync`) sont réutilisées
- [ ] Les placeholders UI sont remplacés par les vrais composants (GesassoSyncPage, OsrtSyncPage)
- [ ] Les tests backend couvrent le mapping, l'envoi, et les guards de capacité (GesAsso + OSRT)