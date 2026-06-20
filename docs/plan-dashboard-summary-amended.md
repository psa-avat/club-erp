# Amended Plan: Data-Driven Dashboard Summary

## Purpose

Replace the current mock-heavy dashboard with a real, data-driven ERP overview. The dashboard should show six operational summary cards for the main work areas:

- Flights & Billing
- Members
- VI / HelloAsso
- RH & Planning (activités commissions)
- Finance
- Machines

> **Note de couverture :** Ce plan a été révisé pour aligner le dashboard sur les plans 052 (`bank_reconciliation`, `federal_sync_ffvp`) et 053 (`hr_planning`). La section `planning` du plan original (qui contenait des KPIs aéronefs) est remplacée par `rh_planning` avec les KPIs RH et planning d'activité ; les compteurs aéronefs migrent dans `machines`. La section `finance` intègre les métriques de rapprochement bancaire, et `flights` intègre les métriques de synchronisation fédérale GesAsso/OSRT.

This plan amends `/home/erpadmin/.claude/plans/rustling-zooming-widget.md` to match the current codebase, schema, import style, UI conventions, and verification commands.

## Current State

`frontend/src/modules/dashboard/components/DashboardPage.tsx` still contains hardcoded mock data (`MOCK_KPIS`, `MOCK_UNBILLED`, pipeline data, and alert items). The page is useful as a visual prototype, but not as an ERP dashboard.

Current dashboard module files are minimal:

- `frontend/src/modules/dashboard/components/DashboardPage.tsx`: mock UI
- `frontend/src/modules/dashboard/api/index.ts`: only query key root
- `frontend/src/modules/dashboard/types.ts`: stub `KpiCard` type

## Core Architecture Decision

Expose one frontend-facing endpoint:

```http
GET /api/v1/dashboard/summary
```

This is one HTTP request, not one database round-trip. The backend should run a small set of focused aggregate queries in a dashboard service and return a compact response. Do not try to force all module counts into one fragile SQL query.

Backend structure:

- `backend/schemas/dashboard.py`: response DTOs
- `backend/services/dashboard.py`: aggregation logic
- `backend/api/routes/dashboard.py`: thin FastAPI route
- `backend/main.py`: import/include dashboard router using the existing route import style

Frontend structure:

- `frontend/src/modules/dashboard/types.ts`: typed response contract
- `frontend/src/modules/dashboard/api/index.ts`: TanStack Query hook
- `frontend/src/components/ui/module-summary-card.tsx`: reusable card if it remains generic
- `frontend/src/modules/dashboard/components/DashboardPage.tsx`: render six cards from the query result
- `packages/i18n/src/resources/fr.ts` and `en.ts`: add card labels and alert text

---

## Backend Contract

Use schema fields that preserve the database's integer status model while still allowing display-friendly labels.

### Alertes (partagées)

```python
class DashboardAlert(BaseModel):
    code: str
    severity: str  # "blocking" | "warning" | "info"
    count: int | None = None
```

### Flights & Billing — enrichi sync fédéral GesAsso/OSRT

```python
class DashboardFlightsSummary(BaseModel):
    flights_this_month: int
    unbilled_count: int
    pending_revenue_eur: Decimal | None
    modified_after_transfer_count: int
    pending_planche_count: int | None = None
    # Sync fédéral (migration 052_federal_sync_columns)
    gesasso_pending_sync: int        # gesasso_status = 1
    gesasso_failed_sync: int         # gesasso_status = 3
    osrt_pending_sync: int           # osrt_status = 1
    osrt_failed_sync: int            # osrt_status = 3
    alerts: list[DashboardAlert] = []
```

### Members (inchangé)

```python
class DashboardMembersSummary(BaseModel):
    active_count: int
    registered_current_year: int
    instructors_count: int
    negative_balance_count: int | None = None
    unregistered_active_count: int
    alerts: list[DashboardAlert] = []
```

### VI / HelloAsso (inchangé)

```python
class DashboardViSummary(BaseModel):
    pending_count: int
    scheduled_count: int
    overdue_count: int
    staging_pending_count: int
    alerts: list[DashboardAlert] = []
```

### RH & Planning — NOUVEAU (remplace l'ancien Planning aéronefs)

```python
class DashboardRhPlanningSummary(BaseModel):
    # RH
    active_employees_count: int        # hr_employee_profiles.is_active = true
    pending_leave_requests: int        # hr_leave_requests.workflow_state = 2 (Submitted)
    employees_on_leave_today: int      # approved leave covering today
    approved_leave_today: int          # hr_leave_requests state=3 AND date range contains today
    # Planning d'activité (commissions)
    upcoming_activities_count: int     # planning_activities.status=2 AND starts_at in next 30d
    activities_today: int              # planning_activities.status=2 AND starts_at::date=today
    unresolved_conflicts_count: int    # leave × activity assignment conflicts
    alerts: list[DashboardAlert] = []
```

### Finance — enrichi rapprochement bancaire

```python
class DashboardFinanceSummary(BaseModel):
    draft_entries_count: int
    active_pricing_count: int
    fiscal_year_label: str | None
    fiscal_year_state: int | None         # 1=Open, 2=Closed, 3=Reopened
    fiscal_year_state_label: str | None   # "open" | "closed" | "reopened"
    # Rapprochement bancaire
    pending_reconciliation_count: int     # bank_statements.status IN ('imported','matching')
    flagged_statements_count: int         # bank_statements.status = 'flagged'
    unmatched_lines_total: int            # bank_statement_lines.match_status = 'unmatched'
    discrepancies_total: int              # bank_statement_lines.match_status = 'discrepancy'
    alerts: list[DashboardAlert] = []
```

### Machines — enrichi aéronefs (ex-Planning)

```python
class DashboardMachinesSummary(BaseModel):
    # Parc toutes catégories (existants)
    operational_count: int
    in_maintenance_count: int
    out_of_service_count: int
    total_active: int
    # Aéronefs uniquement (ex-DashboardPlanningSummary)
    operational_aircraft: int
    in_maintenance_aircraft: int
    out_of_service_aircraft: int
    total_aircraft: int
    alerts: list[DashboardAlert] = []
```

### Response racine — 6 sections

```python
class DashboardSummaryResponse(BaseModel):
    flights: DashboardFlightsSummary
    members: DashboardMembersSummary
    vi: DashboardViSummary
    rh_planning: DashboardRhPlanningSummary    # ← remplace l'ancien "planning"
    finance: DashboardFinanceSummary
    machines: DashboardMachinesSummary
    generated_at: datetime
```

---

### Why Alerts Belong In The Backend

The first plan suggested evaluating alert conditions in the frontend. That is acceptable for purely visual thresholds, but this dashboard is an ERP control surface. Put alert codes in the backend response so business thresholds are testable and shared.

The frontend should translate alert codes into localized messages.

Example codes — complete list (existing + new from plans 052/053):

```
# Flights (existants + sync fédéral)
flights.modified_after_transfer
flights.unbilled_many
flights.gesasso_failed_sync        # NEW: échecs sync GesAsso
flights.osrt_failed_sync           # NEW: échecs sync OSRT

# Members (inchangés)
members.negative_balance
members.unregistered_active

# VI (inchangés)
vi.overdue
vi.staging_pending

# RH & Planning (NEW)
rh.pending_leave_approvals         # demandes de congés en attente
rh.planning_conflicts              # conflits congés / activités

# Finance (existants + rapprochement)
finance.no_active_pricing
finance.draft_entries
finance.fiscal_year_not_open
finance.bank_flagged               # NEW: relevés bancaires avec écarts bloquants
finance.bank_unmatched_lines       # NEW: lignes non rapprochées

# Machines (existants + aéronefs)
machines.out_of_service
machines.in_maintenance
machines.aircraft_out_of_service   # NEW: planeurs indisponibles
```

---

## Correct Schema Mappings

Use the current model definitions rather than inferred names.

### Accounting / Finance

- `AccountingEntry.state`: `1=Draft`, `2=Posted`, `3=Cancelled`
- `AccountingFiscalYear.state`: `1=Open`, `2=Closed`, `3=Reopened`
- `PricingVersion.status`: `1=Draft`, `2=Active`, `3=Archived`

Dashboard finance queries:

- Draft entries: `AccountingEntry.state == 1`
- Active pricing: `PricingVersion.status == 2`
- Current fiscal year: prefer date-contained open/reopened fiscal year; otherwise latest by `start_date`/`year`

### Bank Reconciliation (plan 052)

```python
# bank_statements.status
# 'imported' | 'matching' | 'reconciled' | 'flagged'

# bank_statement_lines.match_status
# 'unmatched' | 'auto_matched' | 'manually_matched' | 'excluded' | 'discrepancy'

# Pending = non clôturés + non flaggés
pending_reconciliation = bank_statements.count(
    status.in_(['imported', 'matching'])
)

# Flagged = écart détecté par detect_discrepancies()
flagged = bank_statements.count(status == 'flagged')
```

### Federal Sync (plan 052)

```python
# validated_flights.gesasso_status / osrt_status
# 0=pas envoyé, 1=en attente, 2=succès, 3=échec, 4=exclu

gesasso_pending = ValidatedFlight.count(gesasso_status == 1)
gesasso_failed  = ValidatedFlight.count(gesasso_status == 3)
```

### RH & Planning (plan 053)

```python
# hr_employee_profiles.is_active
active_employees = HrEmployeeProfile.count(is_active == True)

# hr_leave_requests.workflow_state: 1=Draft, 2=Submitted, 3=Approved, 4=Rejected, 5=Cancelled
pending_leaves = HrLeaveRequest.count(workflow_state == 2)  # Submitted
approved_today = HrLeaveRequest.count(
    workflow_state == 3
    AND start_date <= today
    AND end_date >= today
)

# planning_activities.status: 1=Draft, 2=Confirmed, 3=Cancelled
upcoming = PlanningActivity.count(
    status == 2
    AND starts_at BETWEEN now() AND now() + interval '30 days'
)

# Conflits : participant assigné à une activité confirmée mais en congé approuvé
# Logique à implémenter dans services/dashboard.py avec une requête SQL dédiée
```

### Assets / Machines

- `AssetType.category`: `1=Aircraft`, `2=LaunchEquipment`, `3=Support`, `4=Consumable`, `5=Service`
- `Asset.status`: `1=Operational`, `2=Maintenance`, `3=OutOfService`, `4=Disposed`, `5=Sold`
- `Asset.is_active`: active inventory flag

Aircraft-only counts:

```python
Asset.is_active == True
AssetType.category == 1  # category 1 = Aircraft
```

All-asset counts include all categories. Avoid filtering by `asset_type.code`; codes are catalog data, not the stable category discriminator.

### Flights

Use `ValidatedFlight`:

- `erp_status == 0`: validated/draft
- `erp_status == 1`: transferred/locked
- `erp_status == 2`: modified after transfer
- `accounting_entry_uuid is None`: not linked to an accounting entry
- `jour`: flight date
- `source_status`: active/updated/deleted Planche source status

Unbilled flights should likely exclude deleted source rows:

```python
ValidatedFlight.accounting_entry_uuid.is_(None)
ValidatedFlight.source_status != "deleted"
```

Pending revenue is not trivial. If it cannot reuse existing billing preview logic cheaply and correctly, return `None` for the first version.

### VI / HelloAsso

`ViEntitlementStatus`:

- `LOADED = 1`
- `SCHEDULED = 2`
- `REALIZED = 3`
- `EXPIRED = 4`
- `CANCELLED = 5`

`HelloAssoViStaging.status`:

- `1=staged`
- `2=promoted`
- `3=discarded`

Staging pending should use:

```python
HelloAssoViStaging.promoted_at.is_(None)
HelloAssoViStaging.status == 1
```

Overdue VI should be defined carefully. Recommended first version:

```python
ViEntitlement.validity_date < today
ViEntitlement.status.in_([1, 2])
```

Do not include already expired/cancelled/realized items in overdue action counts.

### Members

Use `Member.status == 1` for active members.

Use `Member.is_instructor == True` for instructors.

Current-year registration must align with accounting/fiscal year expectations. Prefer the active fiscal year's `year` when available; otherwise use calendar year as fallback.

Negative balance is high risk. It depends on the accounting line `tiers_uuid` model and account normal balance. For the first implementation:

- Either return `negative_balance_count: None`
- Or implement a tested helper in `services.dashboard` that mirrors the member balance logic already used elsewhere

Do not hand-roll this in the route.

---

## Backend Implementation Steps

1. Create `backend/schemas/dashboard.py`.
2. Create `backend/services/dashboard.py`.
3. Create `backend/api/routes/dashboard.py`.
4. Update `backend/api/routes/__init__.py` to import `dashboard`.
5. Update `backend/main.py` using the current import style:

```python
from api.routes import auth, admin, members, accounting, assets, flights, flight_packs, helloasso, member_portal, planche, storage, vi, dashboard

app.include_router(dashboard.router)
```

6. Add backend tests for the aggregation service.

Route sketch:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user
from models import User
from schemas.dashboard import DashboardSummaryResponse
from services.dashboard import get_dashboard_summary

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummaryResponse)
async def dashboard_summary_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await get_dashboard_summary(db)
```

Authentication is enough for the first version because the dashboard spans multiple modules. If per-module capability filtering is required later, hide or null out sections based on capabilities instead of failing the whole endpoint.

---

## Frontend Implementation Steps

### Types

Rewrite `frontend/src/modules/dashboard/types.ts` with the DTOs matching the backend response.

Use strings for decimal values as returned by JSON:

```ts
export type DashboardAlertSeverity = 'blocking' | 'warning' | 'info'

export type DashboardAlert = {
  code: string
  severity: DashboardAlertSeverity
  count: number | null
}

export type DashboardSummaryResponse = {
  generated_at: string
  flights: {
    flights_this_month: number
    unbilled_count: number
    pending_revenue_eur: string | null
    modified_after_transfer_count: number
    pending_planche_count: number | null
    gesasso_pending_sync: number
    gesasso_failed_sync: number
    osrt_pending_sync: number
    osrt_failed_sync: number
    alerts: DashboardAlert[]
  }
  members: {
    active_count: number
    registered_current_year: number
    instructors_count: number
    negative_balance_count: number | null
    unregistered_active_count: number
    alerts: DashboardAlert[]
  }
  vi: {
    pending_count: number
    scheduled_count: number
    overdue_count: number
    staging_pending_count: number
    alerts: DashboardAlert[]
  }
  rh_planning: {
    active_employees_count: number
    pending_leave_requests: number
    employees_on_leave_today: number
    approved_leave_today: number
    upcoming_activities_count: number
    activities_today: number
    unresolved_conflicts_count: number
    alerts: DashboardAlert[]
  }
  finance: {
    draft_entries_count: number
    active_pricing_count: number
    fiscal_year_label: string | null
    fiscal_year_state: number | null
    fiscal_year_state_label: 'open' | 'closed' | 'reopened' | null
    pending_reconciliation_count: number
    flagged_statements_count: number
    unmatched_lines_total: number
    discrepancies_total: number
    alerts: DashboardAlert[]
  }
  machines: {
    operational_count: number
    in_maintenance_count: number
    out_of_service_count: number
    total_active: number
    operational_aircraft: number
    in_maintenance_aircraft: number
    out_of_service_aircraft: number
    total_aircraft: number
    alerts: DashboardAlert[]
  }
}
```

### Query Hook

Extend `frontend/src/modules/dashboard/api/index.ts`:

```ts
import { useQuery } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '@/api/client'
import type { DashboardSummaryResponse } from '../types'

export const dashboardQueryKeys = {
  root: ['dashboard'] as const,
  summary: () => ['dashboard', 'summary'] as const,
}

export function useDashboardSummaryQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardQueryKeys.summary(),
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get<DashboardSummaryResponse>(
        '/api/v1/dashboard/summary',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}
```

### Card Component

Create `frontend/src/components/ui/module-summary-card.tsx` only if it stays generic and reusable.

Follow `frontend/DESIGN_SYSTEM.md`:

- Use `rounded-xl border bg-card`
- Use `text-foreground`, `text-muted-foreground`, `border`
- Use existing `Badge` variants/classes
- Use `lucide-react` icons
- Avoid hardcoded visible text
- Keep cards compact; `KpiCard` is intentionally too large for nested metrics here

Card props:

```ts
import type { LucideIcon } from 'lucide-react'

export type ModuleSummaryCardKpi = {
  label: string
  value: string
  hint?: string
  accent?: 'default' | 'success' | 'warning' | 'destructive'
}

export type ModuleSummaryCardAlert = {
  message: string
  severity: 'blocking' | 'warning' | 'info'
}

export type ModuleSummaryCardProps = {
  title: string
  icon: LucideIcon
  href: string
  kpis: ModuleSummaryCardKpi[]
  alerts: ModuleSummaryCardAlert[]
  isLoading?: boolean
}
```

### Dashboard Page

Rewrite `DashboardPage.tsx` to:

- Remove `MOCK_KPIS`, `MOCK_UNBILLED`, `PIPELINE_DATA`, and `ALERT_ITEMS`
- Use `useDashboardSummaryQuery`
- Render a responsive `grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3`
- Keep `PageHeader` with `dashboard.home.title` and `dashboard.home.description`
- Use routes that match the current app:
  - `/workspace/flights`
  - `/workspace/members`
  - `/workspace/vi`
  - `/workspace/rh` (route existante)
  - `/workspace/finance`
  - `/workspace/machines`
- Translate alert codes and KPI labels through i18n

Prefer a global "requires attention" strip above the cards if there are blocking alerts. A dashboard should answer "what needs action now?" before it shows neutral counts.

---

## I18n Plan

Do not delete existing `dashboard.home.*` keys unless every usage is migrated in the same change.

Add in `packages/i18n/src/resources/fr.ts`:

```ts
dashboard: {
  home: {
    title: 'Tableau de bord',
    description: 'Vue d\'ensemble de l\'activit\u00E9 du club',
    updatedAt: 'Derni\u00E8re mise \u00E0 jour',
  },
  cards: {
    flights: {
      title: 'Vols & Facturation',
      kpis: {
        unbilled: 'Non factur\u00E9s',
        pendingRevenue: 'CA en attente',
        thisMonth: 'Vols ce mois',
        gesassoPending: 'GesAsso en attente',
        gesassoFailed: 'GesAsso \u00E9chou\u00E9',
        osrtPending: 'OSRT en attente',
        osrtFailed: 'OSRT \u00E9chou\u00E9',
      },
    },
    members: {
      title: 'Membres',
      kpis: {
        active: 'Actifs',
        registered: 'Inscrits cette ann\u00E9e',
        instructors: 'Instructeurs',
        unregistered: 'Non r\u00E9-inscrits',
      },
    },
    vi: {
      title: 'VI / HelloAsso',
      kpis: {
        pending: 'En attente',
        scheduled: 'Planifi\u00E9s',
        overdue: 'En retard',
        staging: 'HelloAsso en staging',
      },
    },
    rh_planning: {
      title: 'RH & Planning',
      kpis: {
        activeEmployees: 'Employ\u00E9s actifs',
        pendingLeaves: 'Cong\u00E9s en attente',
        onLeaveToday: 'En cong\u00E9s aujourd\'hui',
        upcomingActivities: 'Activit\u00E9s \u00E0 venir',
        activitiesToday: 'Aujourd\'hui',
        conflicts: 'Conflits',
      },
    },
    finance: {
      title: 'Finance',
      kpis: {
        draftEntries: 'Brouillons',
        activePricing: 'Tarifs actifs',
        fiscalYear: 'Exercice',
        pendingReconcil: 'Rapproch. en attente',
        flaggedStatements: 'Relev\u00E9s flagg\u00E9s',
        unmatchedLines: 'Lignes non rapproch\u00E9es',
      },
    },
    machines: {
      title: 'Machines',
      kpis: {
        operational: 'En service',
        inMaintenance: 'En maintenance',
        outOfService: 'Hors service',
        totalActive: 'Total actifs',
        aircraftOps: 'Planeurs OK',
        aircraftDown: 'Planeurs indispo',
      },
    },
  },
  alerts: {
    'flights.modified_after_transfer': 'Vols modifi\u00E9s apr\u00E8s transfert',
    'flights.unbilled_many': 'Nombreux vols non factur\u00E9s',
    'flights.gesasso_failed_sync': '\u00C9chec synchronisation GesAsso',
    'flights.osrt_failed_sync': '\u00C9chec synchronisation OSRT',
    'members.negative_balance': 'Membres avec solde n\u00E9gatif',
    'members.unregistered_active': 'Membres actifs non r\u00E9-inscrits',
    'vi.overdue': 'Bons VI arriv\u00E9s \u00E0 expiration',
    'vi.staging_pending': 'VI HelloAsso en attente de promotion',
    'rh.pending_leave_approvals': 'Demandes de cong\u00E9s en attente',
    'rh.planning_conflicts': 'Conflits cong\u00E9s / planning',
    'finance.no_active_pricing': 'Aucun tarif actif',
    'finance.draft_entries': '\u00C9critures en brouillon',
    'finance.fiscal_year_not_open': 'Exercice comptable non ouvert',
    'finance.bank_flagged': 'Relev\u00E9s bancaires avec \u00E9carts',
    'finance.bank_unmatched_lines': 'Lignes bancaires non rapproch\u00E9es',
    'machines.out_of_service': 'Machines hors service',
    'machines.in_maintenance': 'Machines en maintenance',
    'machines.aircraft_out_of_service': 'Planeurs indisponibles',
  },
  severity: {
    blocking: 'Bloquant',
    warning: 'Attention',
    info: 'Information',
  },
}
```

Add equivalent English keys in `packages/i18n/src/resources/en.ts`.

---

## Test Plan

Backend:

```bash
backend/venv/bin/python -m pytest backend/tests
```

Prefer adding targeted tests:

```bash
backend/venv/bin/python -m pytest backend/tests/test_dashboard_summary.py
```

Specific test cases for new sections:

1. **Flights** — `flights_this_month`, unbilled avec/sans deleted source, `gesasso_pending_sync`, `gesasso_failed_sync`
2. **RH & Planning** — `active_employees_count`, `pending_leave_requests`, `employees_on_leave_today`
3. **RH & Planning** — `upcoming_activities_count`, `activities_today`, `unresolved_conflicts_count`
4. **Finance** — `pending_reconciliation_count`, `flagged_statements_count`, `unmatched_lines_total`
5. **Machines** — `operational_aircraft` vs `operational_count` (all categories)
6. Alerte `finance.bank_flagged` déclenchée quand `flagged_statements_count > 0`
7. Alerte `rh.pending_leave_approvals` déclenchée quand `pending_leave_requests > 0`
8. Alerte `flights.gesasso_failed_sync` déclenchée quand `gesasso_failed_sync > 0`
9. Tables manquantes (HR / Bank pas encore créées) → champs à 0, pas d'erreur 500

Frontend:

```bash
pnpm --filter @club-erp/web build
pnpm --filter @club-erp/web lint
```

Manual verification:

1. Start backend with the project's normal local setup.
2. Hit `GET /api/v1/dashboard/summary` as an authenticated user.
3. Confirm all six sections exist and counts are non-negative.
4. Confirm `pending_revenue_eur` and `negative_balance_count` can be `null`.
5. Confirm `gesasso_pending_sync`, `osrt_pending_sync` appear as 0+ integers.
6. Confirm `pending_reconciliation_count`, `flagged_statements_count` are present.
7. Confirm `active_employees_count`, `pending_leave_requests` are present.
8. Start frontend with `pnpm --filter @club-erp/web dev`.
9. Visit `/dashboard`.
10. Confirm six cards render from API data (Vols, Membres, VI, RH & Planning, Finance, Machines).
11. Confirm loading, empty, and error states are visible.
12. Confirm card links navigate to the correct workspace routes.

---

## Risks And Mitigations

### Risk: Slow Dashboard Query

Mitigation:

- Keep each aggregate query simple and indexed.
- Avoid joining large accounting tables for optional metrics in v1.
- Return `null` for expensive metrics until a tested service exists.
- Consider caching the summary response for 60s (matching frontend staleTime).

### Risk: Incorrect Accounting Or Member Balance

Mitigation:

- Do not compute negative member balances unless the query mirrors existing account summary logic.
- Add tests with debit-normal and credit-normal accounts.

### Risk: HR Data Not Yet Seeded (plan 053 not implemented)

Mitigation:

- If `hr_employee_profiles` table doesn't exist yet, the dashboard service should return 0 for all `rh_planning` fields rather than failing.
- Use try/except around HR queries or check table existence via SQLAlchemy reflection.
- Same approach for `planning_activities` table.

### Risk: Bank Reconciliation Data Not Yet Seeded (plan 052 not implemented)

Mitigation:

- Same as HR: if `bank_statements` table doesn't exist, return 0 for reconciliation fields.
- The dashboard should gracefully handle missing tables since 052 and 053 may be deployed concurrently or not yet deployed.

### Risk: Federal Sync Columns Not Yet Added (plan 052 not implemented)

Mitigation:

- If `gesasso_status` column doesn't exist on `validated_flights`, return 0 for sync fields.
- The dashboard service should be resilient to schema drift during concurrent feature development.

### Risk: Capability Leakage

Mitigation:

- First version requires an authenticated user.
- If needed, filter individual sections by capabilities in a later iteration.

### Risk: UI Becomes Six Equal "Info Cards"

Mitigation:

- Add a top attention strip for blocking alerts.
- Sort or visually emphasize cards with blocking alerts.
- Keep card KPIs compact and scannable.
- RH & Planning card should show pending leave approvals prominently with a badge.

---

## Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `backend/schemas/dashboard.py` | **Créer** — 6 sections Pydantic |
| `backend/services/dashboard.py` | **Créer** — aggregation queries avec graceful degradation |
| `backend/api/routes/dashboard.py` | **Créer** — GET /summary |
| `backend/api/routes/__init__.py` | **Modifier** — ajouter import |
| `backend/main.py` | **Modifier** — include router |
| `frontend/src/modules/dashboard/types.ts` | **Modifier** — nouveau contrat TypeScript |
| `frontend/src/modules/dashboard/api/index.ts` | **Modifier** — ajouter hooks TanStack Query |
| `frontend/src/components/ui/module-summary-card.tsx` | **Créer** (si générique et réutilisable) |
| `frontend/src/modules/dashboard/components/DashboardPage.tsx` | **Modifier** — remplacer mocks par données live |
| `packages/i18n/src/resources/fr.ts` | **Modifier** — ajouter clés dashboard (vols+membres+vi+rh+finance+machines) |
| `packages/i18n/src/resources/en.ts` | **Modifier** — ajouter clés dashboard |
| `backend/tests/test_dashboard_summary.py` | **Créer** — tests aggregation + résilience tables manquantes |

---

## Acceptance Criteria

- Dashboard no longer uses mock data.
- `GET /api/v1/dashboard/summary` returns a typed response with **six sections**: `flights`, `members`, `vi`, `rh_planning`, `finance`, `machines`.
- `flights` includes `gesasso_pending_sync`, `gesasso_failed_sync`, `osrt_pending_sync`, `osrt_failed_sync`.
- `rh_planning` includes `active_employees_count`, `pending_leave_requests`, `employees_on_leave_today`, `upcoming_activities_count`, `unresolved_conflicts_count`.
- `finance` includes `pending_reconciliation_count`, `flagged_statements_count`, `unmatched_lines_total`, `discrepancies_total`.
- `machines` includes `operational_aircraft`, `in_maintenance_aircraft`, `out_of_service_aircraft`, `total_aircraft`.
- Existing route import style still works under `uvicorn main:app`.
- Frontend compiles with `pnpm --filter @club-erp/web build`.
- User-facing dashboard text exists in both `fr.ts` and `en.ts`.
- Financial/pricing numbers are formatted safely; no frontend floating point math for money.
- Expensive or uncertain metrics return `null` rather than misleading values.
- Missing HR / Bank / Sync tables don't crash the endpoint — return 0 with no alerts.
