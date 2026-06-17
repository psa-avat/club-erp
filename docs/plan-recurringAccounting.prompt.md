# Plan 045 — Écritures Comptables Récurrentes (v4)

## TL;DR

Étendre `AccountingEntryTemplate` avec les champs de pilotage (dates de validité, prochaine échéance), ajouter les formules de calcul sur les lignes, créer le service de génération dynamique basé sur la date courante, intégrer APScheduler (single-process avec lock PostgreSQL), et exposer les endpoints + UI de prévisualisation.

**Persistance pluriannuelle** : le template n'est plus rattaché à un exercice comptable. Les modèles récurrents (cotisations, contrats, abonnements) traversent les années de façon transparente. L'exercice fiscal est résolu dynamiquement au runtime en fonction de la date cible — plus besoin de recréer les templates à chaque changement d'année.

**Ce plan ne crée pas de table `accounting_tasks`** — différé au moment où le besoin est avéré.

---

## Ce qui existe déjà

| Élément | Statut |
|---|---|
| `AccountingEntryTemplate` — champs de base | ✅ |
| `AccountingEntryTemplateLine` — comptes, montants, dimensions | ✅ |
| CRUD backend + 5 endpoints REST | ✅ |
| `JournalTemplatesScreen.tsx` + `LineEditor` | ✅ |
| Hooks API + clés i18n `banque.recurring.*` | ✅ |

---

## Phase A — Migration SQL

**Fichier** : `docs/migrations/045_recurring_entries_scheduling.sql`

```sql
-- ============================================================
-- Base de test : purge des templates existants avant extension
-- ============================================================
DELETE FROM accounting_entry_template_lines;
DELETE FROM accounting_entry_templates;

-- ============================================================
-- 1. Colonnes de pilotage (sans fiscal_year_uuid — pluriannuel)
-- ============================================================
ALTER TABLE accounting_entry_templates
  ADD COLUMN valid_from             DATE,
  ADD COLUMN valid_until            DATE,
  ADD COLUMN next_scheduled_date    DATE,
  ADD COLUMN cron_expression        VARCHAR(64),
  ADD COLUMN last_generated_at      TIMESTAMPTZ,
  -- Référence applicative — pas de FK DB car PK composite sur accounting_entries
  ADD COLUMN last_generated_entry_uuid UUID;

CREATE INDEX idx_entry_templates_scheduled
  ON accounting_entry_templates(next_scheduled_date)
  WHERE is_active = true AND next_scheduled_date IS NOT NULL;

-- ============================================================
-- 2. Colonnes de formule sur les lignes
-- ============================================================
ALTER TABLE accounting_entry_template_lines
  ADD COLUMN formula_type   VARCHAR(16) NOT NULL DEFAULT 'fixed',
  ADD COLUMN formula_params JSONB;

ALTER TABLE accounting_entry_template_lines
  ADD CONSTRAINT chk_template_line_formula_type
  CHECK (formula_type IN ('fixed', 'percentage', 'previous_period', 'rounding_adjustment'));

-- Assouplir la contrainte de montant (calculé au runtime pour rounding_adjustment)
ALTER TABLE accounting_entry_template_lines
  DROP CONSTRAINT chk_entry_template_line_at_least_one_amount;

ALTER TABLE accounting_entry_template_lines
  ADD CONSTRAINT chk_entry_template_line_at_least_one_amount
  CHECK (formula_type = 'rounding_adjustment' OR debit > 0 OR credit > 0);

-- ============================================================
-- 3. Lock distribué natif PostgreSQL pour le Scheduler
--    Protège contre les doublons : job automatique vs génération
--    manuelle déclenchée depuis l'UI en même temps
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduler_locks (
    job_id    VARCHAR(64) PRIMARY KEY,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by VARCHAR(128)  -- hostname du process
);
```

---

## Phase B — Modèle Python

**Fichier** : `backend/models.py`

### `AccountingEntryTemplate` — champs à ajouter

```python
# Pilotage de la récurrence (pluriannuel — pas de fiscal_year_uuid)
valid_from                = Column(Date, nullable=True)
valid_until               = Column(Date, nullable=True)
next_scheduled_date       = Column(Date, nullable=True)
cron_expression           = Column(String(64), nullable=True)
last_generated_at         = Column(DateTime(timezone=True), nullable=True)
last_generated_entry_uuid = Column(UUID(as_uuid=True), nullable=True)  # no DB FK, app-layer only
```

### `AccountingEntryTemplateLine` — champs à ajouter

```python
formula_type   = Column(String(16), nullable=False, default='fixed')
formula_params = Column(JSON, nullable=True)
```

---

## Phase C — Schémas Pydantic

**Fichier** : `backend/schemas/accounting.py`

```python
# Étendre AccountingEntryTemplateCreateRequest / UpdateRequest
# fiscal_year_uuid supprimé — résolution au runtime
valid_from      : Optional[date] = None
valid_until     : Optional[date] = None
cron_expression : Optional[str]  = None

# Étendre AccountingEntryTemplateLineCreateRequest
formula_type   : str = 'fixed'
formula_params : Optional[dict] = None

# Nouveau : requête de génération
class AccountingEntryTemplateGenerateRequest(BaseModel):
    target_date: date

# Nouveau : réponse de génération
class AccountingEntryTemplateGenerateResponse(BaseModel):
    entry_uuid            : UUID
    reference             : str
    fiscal_year_uuid      : UUID   # exercice résolu au runtime
    was_already_generated : bool
```

---

## Phase D — Service de Génération (Runtime Dynamique)

**Fichier** : `backend/services/scheduled_entries.py` (nouveau)

### Types de formules

| `formula_type` | Montant calculé | `formula_params` |
|---|---|---|
| `fixed` | `debit`/`credit` du template | `{}` |
| `percentage` | `source_amount × (percentage / 100)` | `{"percentage": 20, "source_line_index": 0}` |
| `previous_period` | Montants de la dernière génération | `{"fallback_amount": 100}` |
| `rounding_adjustment` | Écart débit/crédit résiduel pour équilibrer | `{}` |

### `generate_entry(db, template_uuid, target_date, user_id)`

```python
async def generate_entry(db, template_uuid, target_date, user_id):
    """
    1. Charger le template avec ses lignes
    2. Valider : template.is_active = True
    3. Valider bornes : valid_from <= target_date <= valid_until (si renseignées)
    4. Résolution de l'exercice fiscal au RUNTIME :
         fiscal_year = await db.execute(
             SELECT uuid FROM accounting_fiscal_years
             WHERE state = 1 AND :target_date BETWEEN start_date AND end_date
         )
         → Si aucun exercice ouvert → lever FiscalYearNotFoundError descriptive
           (génération bloquée, message explicite à l'utilisateur)
    5. Déduplication : écriture avec référence {code}-{YYYYMM} déjà existante ?
       → retourner (entry, was_already_generated=True)
    6. Calculer montants par ligne selon formula_type
    7. Vérifier sum(debits) == sum(credits)
       → ligne rounding_adjustment → calculer l'écart et l'appliquer
       → pas de rounding_adjustment + déséquilibre → lever ValueError
    8. Créer AccountingEntry (state=1 Draft) lié au fiscal_year_uuid résolu
    9. Créer les AccountingLine correspondantes
    10. Mettre à jour le template :
        last_generated_at = now()
        last_generated_entry_uuid = entry.uuid
        next_scheduled_date = compute_next_date(target_date, template)
    11. Retourner (entry, was_already_generated=False)
    """
```

### `generate_due_entries(db, user_id)`

```python
async def generate_due_entries(db, user_id):
    """
    SELECT templates WHERE is_active = true
      AND next_scheduled_date <= CURRENT_DATE
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
    ORDER BY next_scheduled_date ASC

    Pour chaque template : appeler generate_entry(db, template.uuid, CURRENT_DATE, user_id)
    L'exercice est résolu au runtime pour chaque template — pas de fiscal_year_uuid passé.
    Un échec n'interrompt pas les autres.
    Retourner { generated[], skipped[], errors[] }
    """
```

### `preview_generation(db, template_uuid, target_date)`

```python
async def preview_generation(db, template_uuid, target_date):
    """Simuler sans persister. Résoudre l'exercice au runtime.
    Retourner lignes calculées, totaux, référence, fiscal_year résolu,
    is_balanced, warnings[]."""
```

### `compute_next_date(current_date, template)`

| `recurrence_type` | Calcul |
|---|---|
| 2 — Monthly | `current_date + 1 month` (calendaire) |
| 3 — Quarterly | `current_date + 3 months` |
| 4 — Yearly | `current_date + 1 year` |
| avec `cron_expression` | `croniter` → prochaine occurrence après `current_date` |

---

## Phase E — APScheduler

**Fichier** : `backend/main.py`

> **Contrainte single-process** : `AsyncIOScheduler` démarre un job par worker. Avec Docker Compose single-container, aucun risque. Le lock PG est un filet de sécurité contre les chevauchements run-manuel / job automatique (même en single-process).

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from contextlib import asynccontextmanager

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(
        check_due_entries_job,
        CronTrigger(hour=6, minute=0),
        id="generate_due_entries",
        replace_existing=True,
    )
    scheduler.add_job(
        check_pending_approvals_job,
        CronTrigger(day_of_week="mon", hour=9, minute=0),
        id="pending_approvals",
        replace_existing=True,
    )
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)
# NB : on_event("startup") est déprécié depuis FastAPI 0.93 — lifespan est le pattern actuel

async def check_due_entries_job():
    async with async_session_factory() as db:
        try:
            await db.execute(
                "INSERT INTO scheduler_locks(job_id, locked_by) "
                "VALUES(:job, :host) ON CONFLICT DO NOTHING",
                {"job": "generate_due_entries", "host": socket.gethostname()}
            )
            # Pas de fiscal_year_uuid — résolu au runtime dans generate_entry()
            result = await generate_due_entries(db, SYSTEM_USER_ID)
            logger.info(f"Scheduler: {len(result['generated'])} écritures générées")
        except Exception as e:
            logger.error(f"Scheduler error: {e}")
        finally:
            await db.execute(
                "DELETE FROM scheduler_locks WHERE job_id = 'generate_due_entries'"
            )

async def check_pending_approvals_job():
    """Lundi 9h : log des Draft > 7 jours."""
    async with async_session_factory() as db:
        stale = await db.execute(
            "SELECT uuid FROM accounting_entries "
            "WHERE state = 1 AND entry_date < now() - interval '7 days'"
        )
        if stale.rowcount:
            logger.warning(f"Scheduler: {stale.rowcount} écritures Draft en attente > 7j")
```

---

## Phase F — Endpoints API

**Fichier** : `backend/api/routes/accounting.py` (à étendre)

| Méthode | Endpoint | Description | Guard |
|---|---|---|---|
| `POST` | `/api/v1/accounting/entry-models/{uuid}/preview` | Prévisualiser sans persister | `view_guard` |
| `POST` | `/api/v1/accounting/entry-models/{uuid}/generate` | Générer manuellement | `post_guard` |
| `POST` | `/api/v1/accounting/entry-models/generate-due` | Générer toutes les échéances | `post_guard` |

### Réponses

**Preview** `→ 200`
```json
{
  "template_code": "COTIS-MENSUELLE",
  "reference": "COTIS-MENSUELLE-202607",
  "description": "Cotisation mensuelle - 07/2026",
  "fiscal_year_uuid": "...",
  "fiscal_year_label": "2025/2026",
  "lines": [
    { "account_code": "411", "debit": "100.0000", "credit": "0.0000" },
    { "account_code": "756", "debit": "0.0000",   "credit": "100.0000" }
  ],
  "total_debit": "100.0000",
  "total_credit": "100.0000",
  "is_balanced": true,
  "warnings": []
}
```

**Generate** `→ 201`
```json
{
  "entry_uuid": "...",
  "reference": "COTIS-MENSUELLE-202607",
  "fiscal_year_uuid": "...",
  "state": 1,
  "was_already_generated": false
}
```

**Generate-due** `→ 200`
```json
{
  "generated": [{ "template_code": "COTIS-MENSUELLE", "entry_uuid": "...", "reference": "...", "fiscal_year_uuid": "..." }],
  "skipped":   [{ "template_code": "AMORT", "reason": "already_generated" }],
  "errors":    [{ "template_code": "TVA", "reason": "no_open_fiscal_year" }]
}
```

---

## Phase G — Frontend

**Fichiers** : `frontend/src/modules/banque/components/JournalTemplatesScreen.tsx` + `journalShared.tsx`

### G1. Formulaire template

Le sélecteur d'exercice fiscal a été retiré — les templates sont désormais pluriannuels.
L'exercice résolu au runtime est affiché en lecture seule dans l'aperçu de génération.

```
┌──────────────────────────────────────────────────┐
│  [Code]          [Nom]                           │
│  [Journal ▼]     [Récurrence ▼]                  │
│                                                  │
│  [Valide du  📅]   [au  📅]       ← NOUVEAU      │
│  [Expression CRON]  (optionnel)   ← NOUVEAU      │
│                                                  │
│  Prochaine échéance : 01/07/2026  (lecture seule)│
│  Dernière génération : 01/06/2026 (lecture seule)│
│  [✅ Actif]                                      │
└──────────────────────────────────────────────────┘
```

- `<DatePicker>` pour `valid_from` / `valid_until`
- Infobulle CRON : `0 6 1 * *` = 1er du mois à 6h
- Pas de `<ComboboxFiscalYear>` — supprimé

### G2. Extension `LineEditor` — sélecteur de formule

```
┌── Ligne ──────────────────────────────────────────────────┐
│ [Compte]  [Débit]  [Crédit]  [Description]                │
│ [Formule ▼ = fixed]  [Membre]  [Machine]  [× Suppr.]     │
└───────────────────────────────────────────────────────────┘

Si formula_type = percentage :
│ [Formule ▼ = percentage]  [% ___]  [Ligne source ▼]

Si formula_type = rounding_adjustment :
│ [Formule ▼ = rounding_adjustment]  (débit/crédit calculés auto)
```

### G3. Actions par template

- **Aperçu** → dialog : lignes calculées, exercice résolu, is_balanced, warnings
- **Générer maintenant** → date picker pré-rempli au mois courant → toast `"Écriture COTIS-202607 créée en Draft (exercice 2025/2026)"`

---

## Phase H — Hooks API

**Fichier** : `frontend/src/modules/banque/api/index.ts`

```typescript
export function usePreviewEntryGeneration(templateUuid: string) { ... }
export function useGenerateEntryMutation(templateUuid: string) { ... }
export function useGenerateDueEntriesMutation() { ... }
```

---

## Phase I — i18n

**Fichiers** : `packages/i18n/src/resources/fr.ts` + `en.ts`

```typescript
recurring: {
  validFrom:     'Valide du',
  validUntil:    'au',
  cronExpression:'Expression CRON',
  cronHelp:      'Optionnel. Ex: 0 6 1 * * = 1er du mois à 6h',
  nextScheduled: 'Prochaine échéance',
  lastGenerated: 'Dernière génération',
  generateNow:   'Générer maintenant',
  preview:       'Aperçu',
  formulaType: {
    fixed:          'Montant fixe',
    percentage:     'Pourcentage',
    previousPeriod: 'Période précédente',
    rounding:       "Ajustement d'arrondi",
  },
  result: {
    success:      'Écriture {reference} créée en Draft (exercice {fiscalYear})',
    alreadyExists:"L'écriture {reference} existe déjà",
    noFiscalYear: "Aucun exercice ouvert pour la date {date} — génération bloquée",
    error:        'Erreur : {message}',
  },
}
```

---

## Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `docs/migrations/045_recurring_entries_scheduling.sql` | **Créer** |
| `backend/models.py` | **Modifier** — champs template + template_line (sans fiscal_year_uuid) |
| `backend/schemas/accounting.py` | **Modifier** — étendre + nouveaux schémas generate |
| `backend/services/scheduled_entries.py` | **Créer** |
| `backend/services/accounting.py` | **Modifier** — CRUD étendu |
| `backend/api/routes/accounting.py` | **Modifier** — 3 endpoints |
| `backend/main.py` | **Modifier** — lifespan + APScheduler |
| `backend/requirements.txt` | **Modifier** — APScheduler, croniter |
| `frontend/src/modules/banque/api/index.ts` | **Modifier** |
| `frontend/src/modules/banque/components/JournalTemplatesScreen.tsx` | **Modifier** |
| `frontend/src/modules/banque/components/journalShared.tsx` | **Modifier** |
| `packages/i18n/src/resources/fr.ts` | **Modifier** |
| `packages/i18n/src/resources/en.ts` | **Modifier** |

---

## Tests

### Backend

1. Génération `fixed` → montants exacts du template
2. Génération `percentage` → `source × % / 100`, arrondi 4 décimales
3. Génération `previous_period` → montants identiques à la dernière génération
4. Déduplication → deuxième appel retourne `was_already_generated=true`
5. `rounding_adjustment` → écriture équilibrée malgré écart résiduel
6. Aucun exercice ouvert pour `target_date` → `FiscalYearNotFoundError`
7. `valid_until` dépassé → template ignoré par le scheduler
8. Template couvrant deux exercices → exercice résolu correctement selon `target_date`

### Frontend

9. Formulaire → pas de sélecteur exercice → sauvegarde OK
10. Aperçu → exercice résolu affiché en lecture seule
11. Générer maintenant → toast avec nom de l'exercice résolu
12. Aucun exercice ouvert → message d'erreur explicite

---

## Décisions architecturales

| Décision | Choix | Raison |
|---|---|---|
| `fiscal_year_uuid` sur template | **Supprimé** | Persistance pluriannuelle — évite de recréer les templates à chaque exercice |
| Résolution exercice | Runtime via `state = 1 AND target_date BETWEEN start_date AND end_date` | Écriture toujours injectée dans l'exercice actif et réglementaire |
| `template_config` | **Supprimé** | Aucune clé documentée — YAGNI |
| `accounting_tasks` | **Différé** | Besoin non avéré à ce stade |
| `last_generated_entry_uuid` | Pas de FK DB | PK composite sur `accounting_entries` — pattern existant |
| APScheduler multi-worker | Non supporté | Single-container Docker Compose ; lock PG filet de sécurité |
| `on_event` → `lifespan` | **Corrigé** | `on_event` déprécié FastAPI ≥ 0.93 |
| `generate_due_entries` | Sans `fiscal_year_uuid` | Chaque template résout son exercice indépendamment |
