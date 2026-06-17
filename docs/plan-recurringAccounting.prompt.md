# Plan 045 — Écritures Comptables Récurrentes (v5)

## TL;DR

Étendre `AccountingEntryTemplate` avec les champs de pilotage (dates de validité, prochaine échéance), ajouter les formules de calcul sur les lignes, créer le service de génération dynamique basé sur la date courante, exposer les endpoints + **refonte UI complète** inspirée du projet `ask-create-glow` (shadcn moderne, KPI cards, Table, Dialog modaux, toast Sonner).

**Génération manuelle uniquement** : pas de scheduler automatique. Les échéances sont déclenchées depuis l'UI ou via un bouton dédié. Un indicateur `À générer` dans les KPI et une alerte dashboard alertent l'utilisateur des modèles en attente.

**Persistance pluriannuelle** : le template n'est plus rattaché à un exercice comptable. Les modèles récurrents (cotisations, contrats, abonnements) traversent les années de façon transparente. L'exercice fiscal est résolu dynamiquement au runtime en fonction de la date cible — plus besoin de recréer les templates à chaque changement d'année.

**Ce plan ne crée pas de table `accounting_tasks`** — différé au moment où le besoin est avéré.

---

## Ce qui existe déjà

| Élément | Statut |
|---|---|
| `AccountingEntryTemplate` — champs de base (code, name, journal_uuid, recurrence_type...) | ✅ |
| `AccountingEntryTemplateLine` — comptes, montants, dimensions | ✅ |
| CRUD backend + 5 endpoints REST | ✅ |
| `JournalTemplatesScreen.tsx` + `journalShared.tsx` (LineEditor, helpers) | ✅ |
| Hooks API (useAccountingEntryModelsQuery, useCreate/Update/Delete) | ✅ |
| Clés i18n `banque.journal.models.*` | ✅ |
| Routing: `/banque/journal/templates` → `BanqueJournalTemplatesPage` | ✅ |

---

## Phase A — Migration SQL

**Fichier** : `docs/migrations/049_recurring_entries_scheduling.sql`

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

---

## Phase E — Génération manuelle (pas de scheduler)

**Pas de scheduler automatique** — la génération est **exclusivement manuelle**, déclenchée depuis l'UI :
- **Bouton "Générer maintenant"** sur un template : appel `POST /generate` avec date cible
- **Bouton "Générer les échéances"** en haut de page : appel `POST /generate-due` pour tous les templates échus en une fois
- L'alerte (alerts-banner ou KPI) sur le dashboard signalera les modèles avec `next_scheduled_date <= today`

La table `scheduler_locks` est conservée pour éviter les doublons en cas de double-clic utilisateur (filet de sécurité applicatif).

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

## Phase G — Frontend : Refonte UI complète

**Inspiration** : `ask-create-glow/src/routes/recurring-entries.tsx` — structure page moderne avec KPI, Table shadcn, Dialog modaux, toasts Sonner.

### G0. Composants UI requis

Vérifier la présence dans `frontend/src/components/ui/` de :
- `dialog.tsx`, `select.tsx`, `switch.tsx`, `sonner.tsx`, `badge.tsx`, `separator.tsx`
- Si manquants → `pnpm dlx shadcn@latest add dialog select switch sonner badge separator`

### G1. Nouveau layout — `JournalTemplatesScreen.tsx`

```
┌─ mx-auto flex max-w-7xl flex-col gap-6 ──────────────────────────┐
│  ┌─ PageHeader ─────────────────────────────────────────────────┐ │
│  │  Titre : "Écritures comptables récurrentes"                 │ │
│  │  Descr.: "Modèles d'écritures générées automatiquement..."  │ │
│  │  Actions: [Générer échéances (N)] [Nouveau modèle]          │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Grid: 3 KPI Cards ──────────────────────────────────────────┐ │
│  │  [Modèles: N]  [Actifs: N]  [À générer: N]                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Card: Table des modèles ─────────────────────────────────────┐ │
│  │  ┌─ shadcn Table ───────────────────────────────────────────┐ │ │
│  │  │ Code │ Nom │ Récurrence │ Échéance │ État │ Actions     │ │ │
│  │  │ ...  │ ... │ badge      │ date     │ badge│ [👁][▶][✏] │ │ │
│  │  └──────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Dialog: TemplateEditor ──────────────────────────────────────┐ │
│  │  Grille 2 colonnes (Code, Nom, Journal, Récurrence,           │ │
│  │  Valide du/au) + Switch Actif + LineEditor + Totaux          │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Dialog: Preview ────────────────────────────────────────────┐ │
│  │  Lignes calculées (Table) + Totaux + Badge Équilibré         │ │
│  │  + infos exercice résolu en lecture seule                    │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Dialog: Generate ───────────────────────────────────────────┐ │
│  │  Date picker (pré-rempli prochaine échéance/aujourd'hui)     │ │
│  │  + [Annuler] [Générer]                                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

**Détails UI :**

1. **PageHeader** : Utiliser `PageHeader` du design system (`@club-erp/ui` ou `src/components/ui/`) avec `title`, `description`, `actions` (deux boutons)
2. **KPI Cards** : Grille 3 colonnes responsive `grid grid-cols-1 sm:grid-cols-3` avec `KpiCard` du design system (label, valeur, icône, accent `"warning"` pour "À générer" si > 0)
3. **Table** : shadcn `<Table>` avec colonnes : Code (font-mono text-xs), Nom (font-medium), Récurrence (`<Badge variant="secondary">`), Prochaine échéance (text-xs), État (badge `bg-emerald-500/15` / `variant="outline"`), Actions (3 × `<Button variant="ghost" size="sm">`)
4. **TemplateEditor** (Dialog) : `max-w-4xl max-h-[90vh] overflow-y-auto`. Grille `md:grid-cols-2` pour les champs (Code, Nom, Journal, Récurrence, Valide du, Valide jusqu'au). Switch pour actif/inactif. `<Separator />` avant les lignes. Totaux en bas avec badge équilibré/déséquilibré. Boutons Annuler/Enregistrer en footer.
5. **PreviewDialog** (Dialog) : `max-w-2xl`. Table en lecture seule des lignes avec montants formatés en EUR. Totaux + badge équilibré. Infos exercice résolu.
6. **GenerateDialog** (Dialog) : Date picker `<Input type="date">` pré-rempli. Confirmation avec toast.
7. **Toasts** : Utiliser `toast.success()` / `toast.error()` de `sonner` pour tous les retours utilisateur (succès sauvegarde, génération, erreurs)

### G2. Extension `LineEditor` — `journalShared.tsx`

**Extension de `LineFormState`** :
```typescript
export type LineFormState = {
  account_uuid: string
  amount: string
  description: string
  member_uuid: string
  // NOUVEAU
  formula_type: 'fixed' | 'percentage' | 'previous_period' | 'rounding_adjustment'
  formula_params?: {
    percentage?: number
    source_line_index?: number
    fallback_amount?: number
  }
}
```

**Extension de `ModelFormState`** :
```typescript
export type ModelFormState = {
  code: string
  name: string
  journal_uuid: string
  description: string
  default_reference: string
  recurrence_type: number
  is_active: boolean
  // NOUVEAU
  valid_from: string
  valid_until: string
  next_scheduled_date: string
  last_generated_at: string
  last_generated_entry_uuid: string
  lines: LineFormState[]
}
```

**Extension du rendu `LineEditor`** — ajouter sur chaque ligne :
- Un sélecteur `<Select>` pour `formula_type` avec 4 options (fixed, percentage, previous_period, rounding_adjustment)
- Si `percentage` → deux champs additionnels : `%` (Input number) et `Ligne source #` (Input number)
- Si `previous_period` → texte indicatif : "Montant basé sur la période précédente"
- Si `rounding_adjustment` → texte indicatif : "Calculé automatiquement pour équilibrer l'écriture"

**Nouveaux helpers** :
```typescript
export function formulaTypeLabel(type: string, t: (key: string) => string): string
export function emptyLineWithFormula(): LineFormState
export function buildModelLinesWithFormula(lines: LineFormState[]): AccountingEntryModelLinePayload[]
```

### G3. Hooks API

**Fichier** : `frontend/src/modules/banque/api/index.ts`

Nouveaux query keys :
```typescript
entryModelPreview: (templateUuid: string) => ['banque', 'entry-models', templateUuid, 'preview'] as const
```

Nouveaux hooks :
```typescript
// Preview — POST sans mutation d'état
export function usePreviewEntryGenerationMutation() {
  return useMutation({
    mutationFn: async ({ templateUuid, targetDate }: { templateUuid: string; targetDate: string }) => {
      const { data } = await apiClient.post<PreviewResponse>(
        `/api/v1/accounting/entry-models/${templateUuid}/preview`,
        { target_date: targetDate },
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

// Generate single
export function useGenerateEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ templateUuid, targetDate }: { templateUuid: string; targetDate: string }) => {
      const { data } = await apiClient.post<GenerateResponse>(
        `/api/v1/accounting/entry-models/${templateUuid}/generate`,
        { target_date: targetDate },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entryModels() })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entries({}) })
    },
  })
}

// Generate due
export function useGenerateDueEntriesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<GenerateDueResponse>(
        '/api/v1/accounting/entry-models/generate-due',
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entryModels() })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entries({}) })
    },
  })
}
```

Types de réponse :
```typescript
export type PreviewLine = {
  account_code: string
  debit: string
  credit: string
  description: string | null
}

export type PreviewResponse = {
  template_code: string
  reference: string
  description: string | null
  fiscal_year_uuid: string
  fiscal_year_label: string
  lines: PreviewLine[]
  total_debit: string
  total_credit: string
  is_balanced: boolean
  warnings: string[]
}

export type GenerateResponse = {
  entry_uuid: string
  reference: string
  fiscal_year_uuid: string
  state: number
  was_already_generated: boolean
}

export type GenerateDueItem = {
  template_code: string
  entry_uuid: string | null
  reference: string | null
  fiscal_year_uuid: string | null
}

export type GenerateDueResponse = {
  generated: GenerateDueItem[]
  skipped: { template_code: string; reason: string }[]
  errors: { template_code: string; reason: string }[]
}
```

### G4. Schémas TypeScript — extensions

Étendre `AccountingEntryModel` et `AccountingEntryModelLine` avec les nouveaux champs (voir Phase C pour le mapping backend→frontend).

Étendre les payloads `AccountingEntryModelLinePayload` pour inclure `formula_type` et `formula_params`.

### G5. Mise à jour `emptyModelForm()`, `mapModelToForm()`, `buildModelLines()`

Dans `journalShared.tsx` :
- `emptyModelForm()` → initialiser `valid_from`, `valid_until` à `''`, `formula_type` à `'fixed'`
- `mapModelToForm(model)` → mapper les nouveaux champs depuis la réponse API
- `buildModelLines(lines)` → inclure `formula_type` et `formula_params` dans le payload

---

## Phase H — i18n

**Fichiers** : `packages/i18n/src/resources/fr.ts` + `en.ts`

Nouvelles clés sous `banque.journal.models` :
```typescript
recurring: {
  validFrom: 'Valide du',
  validUntil: 'au',
  nextScheduled: 'Prochaine échéance',
  lastGenerated: 'Dernière génération',
  generateNow: 'Générer maintenant',
  preview: 'Aperçu',
  generateDue: 'Générer les échéances ({count})',
  newModel: 'Nouveau modèle',
  formulaType: {
    fixed: 'Montant fixe',
    percentage: 'Pourcentage',
    previousPeriod: 'Période précédente',
    rounding: "Ajustement d'arrondi",
  },
  kpi: {
    total: 'Modèles',
    active: 'Actifs',
    due: 'À générer',
  },
  result: {
    success: 'Écriture {reference} créée en Draft (exercice {fiscalYear})',
    alreadyExists: "L'écriture {reference} existe déjà",
    noFiscalYear: "Aucun exercice ouvert pour la date {date} — génération bloquée",
    error: 'Erreur : {message}',
  },
}
```

---

## Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `docs/migrations/045_recurring_entries_scheduling.sql` | **Créer** |
| `backend/models.py` | **Modifier** — champs template + template_line |
| `backend/schemas/accounting.py` | **Modifier** — étendre + nouveaux schémas generate |
| `backend/services/scheduled_entries.py` | **Créer** |
| `backend/services/accounting.py` | **Modifier** — CRUD étendu |
| `backend/api/routes/accounting.py` | **Modifier** — 3 endpoints |
| `frontend/src/modules/banque/api/index.ts` | **Modifier** — nouveaux types + hooks + query keys |
| `frontend/src/modules/banque/components/journalShared.tsx` | **Modifier** — étendre LineFormState, ModelFormState, LineEditor, helpers |
| `frontend/src/modules/banque/components/JournalTemplatesScreen.tsx` | **Réécrire** — refonte UI complète (PageHeader + KPI + Table + 3 Dialog) |
| `packages/i18n/src/resources/fr.ts` | **Modifier** — nouvelles clés recurring.* |
| `packages/i18n/src/resources/en.ts` | **Modifier** — idem |

---

## Ordre d'implémentation

```
Phase A (SQL) ──→ Phase B (Models) ──→ Phase C (Schemas) ──→ Phase D (Service)
                                                                      │
                                    Phase E (Endpoints) ←─────────────┘
                                           │
                     ┌─────────────────────┼─────────────────────┐
                     │                     │                     │
              Phase F (Frontend)   Phase G (i18n)       Phase H (Tests)
```

- Les phases A→E sont **séquentielles** (backend d'abord)
- La phase F (frontend) peut débuter **en parallèle de E** une fois les schémas Python connus (C terminé)
- La phase G (i18n) peut être **anticipée** dès le début (les clés sont connues)
- La phase H (tests) est **finale**

---

## Décisions architecturales

### Backend

| Décision | Choix | Raison |
|---|---|---|
| `fiscal_year_uuid` sur template | **Supprimé** | Persistance pluriannuelle — évite de recréer les templates à chaque exercice |
| Résolution exercice | Runtime via `state = 1 AND target_date BETWEEN start_date AND end_date` | Écriture toujours injectée dans l'exercice actif et réglementaire |
| `template_config` | **Supprimé** | Aucune clé documentée — YAGNI |
| `accounting_tasks` | **Différé** | Besoin non avéré à ce stade |
| `last_generated_entry_uuid` | Pas de FK DB | PK composite sur `accounting_entries` — pattern existant |

| `generate_due_entries` | Sans `fiscal_year_uuid` | Chaque template résout son exercice indépendamment |

### Frontend

| Décision | Choix | Raison |
|---|---|---|
| Type de formulaire | **Dialog modal** | Cohérent avec le design system (Dialog pour < 10 champs). L'éditeur inline actuel force le scroll. |
| Emplacement LineEditor | **Dans le Dialog** | Réutilise le composant existant avec extension formula_type |
| KPI en haut de page | **Oui, 3 colonnes** | Donne un aperçu immédiat de l'état — pattern ask-create-glow validé |
| Table vs DataTable | **shadcn Table** | Pas besoin de tri/filtre avancé pour cette liste |
| Notifications | **Sonner toast** | Pattern moderne non-bloquant, utilisé dans ask-create-glow |
| Exercice dans le template | **Supprimé** | Résolu au runtime — affiché en lecture seule dans preview/generate |
| Tokens CSS | **shadcn** (`text-foreground`, `bg-card`, etc.) | Conforme au design system — pas de tokens M3 |

---

## Tests

### Backend

1. Génération `fixed` → montants exacts du template
2. Génération `percentage` → `source × % / 100`, arrondi 4 décimales
3. Génération `previous_period` → montants identiques à la dernière génération
4. Déduplication → deuxième appel retourne `was_already_generated=true`
5. `rounding_adjustment` → écriture équilibrée malgré écart résiduel
6. Aucun exercice ouvert pour `target_date` → `FiscalYearNotFoundError`
7. `valid_until` dépassé → template ignoré lors de la génération
8. Template couvrant deux exercices → exercice résolu correctement selon `target_date`

### Frontend

9. KPI affichés correctement (total, actifs, à générer avec valeurs)
10. Dialog TemplateEditor s'ouvre depuis "Nouveau modèle" — pas de sélecteur exercice
11. Preview dialog montre lignes calculées + exercice résolu en lecture seule
12. Generate dialog → toast succès avec nom exercice résolu
13. Formule `percentage` → champs % et source line # visibles dans LineEditor
14. Formule `rounding_adjustment` → champ montant désactivé + texte indicatif
15. Bouton "Générer les échéances" désactivé si `due === 0`
16. Aucun exercice ouvert → message d'erreur explicite dans toast/alert
