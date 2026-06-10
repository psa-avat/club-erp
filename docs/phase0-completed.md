# Phase 0 — Design System & Fondations — Rapport de Completion

## Statut par action

| # | Action | Statut |
|---|--------|--------|
| **0.1** | Peupler `packages/ui/` avec composants partagés + tokens CSS | ✅ Complété |
| **0.2** | Installer Storybook, cataloguer les composants existants | ✅ Complété |
| **0.3** | Créer `Skeleton`, `ErrorBoundary`, `EmptyState` génériques | ✅ Complété |
| **0.4** | Audit a11y : focus ring, contraste, rôles ARIA sur tous les composants | ✅ Complété |
| **0.5** | Ajouter les clés i18n `nav.*` pour la nouvelle navigation (fr + en) | ✅ Complété |
| **0.6** | Réécrire `shell/navigation.ts` — 14 modules → 9 groupes workflow | ✅ Complété |
| **0.7** | Créer les modules vides (`daily-ops/`, `reporting/`, `integrations/`) | ✅ Complété |

## Détail des livrables

### 0.1 — packages/ui/ peuplé

Fichiers créés dans `packages/ui/src/` :

| Fichier | Rôle |
|---------|------|
| `tokens.css` | Tokens CSS : couleurs, ombres, rayons, typographie, espacements |
| `cn.ts` | Utilitaire `cn()` basé sur `clsx` + `tailwind-merge` |
| `Skeleton.tsx` | Placeholder de chargement (pulse animation, variantes text/circular/rectangular) |
| `ErrorBoundary.tsx` | Capture d'erreurs React avec fallback UI par défaut + customisable |
| `EmptyState.tsx` | Vue vide générique avec icône, titre, description et CTA |
| `button.tsx` | Composant Button avec variantes (default/secondary/ghost/destructive/sizes) |
| `alert.tsx` | Composant Alert avec variantes (error/success/warning/info) |
| `index.ts` | Barrel exports de tous les composants |

`packages/ui/package.json` mis à jour avec :
- Scripts `storybook` et `build-storybook`
- Dépendances : `clsx`, `tailwind-merge`, `class-variance-authority`
- Peer deps : `react`, `react-dom`
- Dev deps Storybook (v8.6)

### 0.2 — Storybook installé et configuré

Configuration dans `packages/ui/.storybook/` :

| Fichier | Rôle |
|---------|------|
| `main.ts` | Config Storybook avec Vite, addons essentiels + a11y + interactions, alias `@` → frontend/src |
| `preview.ts` | Preview globale, import des tokens CSS, désactivation contraste pour états disabled |

Stories créées (8 fichiers) :

| Story | Composants couverts |
|-------|-------------------|
| `Button.stories.tsx` | Button (default, secondary, ghost, destructive, sizes, disabled) |
| `Alert.stories.tsx` | Alert (info, success, warning, error) |
| `Dialog.stories.tsx` | Dialog (default, large, avec état d'ouverture) |
| `Tabs.stories.tsx` | Tabs (default, disabled tab) |
| `DataTable.stories.tsx` | DataTable (default, row click, actions, empty) |
| `SearchableSelect.stories.tsx` | SearchableSelect (default, clearable, preselected) |
| `Skeleton.stories.tsx` | Skeleton (text, circular, rectangular, card skeleton) |
| `EmptyState.stories.tsx` | EmptyState (default, with action, with custom icon) |
| `ErrorBoundary.stories.tsx` | ErrorBoundary (default fallback, custom fallback, no error) |

### 0.3 — Composants génériques créés

- ✅ `Skeleton.tsx` — avec variante `text`, `circular`, `rectangular`
- ✅ `ErrorBoundary.tsx` — avec props `fallback(error, reset)` optionnel
- ✅ `EmptyState.tsx` — avec props `icon`, `title`, `description`, `action`

### 0.4 — Audit a11y

Audit réalisé sur 18 composants dans `frontend/src/components/ui/` et `packages/ui/src/`.

**Rapport complet** : `docs/a11y-audit-phase0.md`

**Correctifs appliqués** :

| Composant | Problème | Correctif |
|-----------|----------|-----------|
| `ImportDialog.tsx` | Pas de `role="dialog"`, pas d'`aria-modal`, pas de gestion Escape | Ajout de `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-live="polite"` sur résultats, gestion Escape |
| `searchable-select.tsx` | Pas de navigation clavier (flèches), pas d'`aria-activedescendant` | Ajout de `role="combobox"`, `aria-activedescendant`, `aria-controls`, navigation ArrowDown/ArrowUp/Home/End/Enter, scrollIntoView |
| `data-table.tsx` | `thead` et `tbody` sans `role="rowgroup"` | Ajout de `role="rowgroup"` |
| `empty-state.tsx` | Titre en `<p>` au lieu de `<h3>` | Passage à `<h3>` pour meilleure hiérarchie |
| `AppShell.tsx` | Bug : `w-full w-full` dupliqué | Correction en `w-full` unique |

### 0.5 — Clés i18n `nav.*`

Clés ajoutées (vérifié par `grep`) dans `packages/i18n/src/resources/{fr,en}.ts` :

- `nav.dashboard`
- `nav.dailyOps`, `nav.flights`, `nav.packs`, `nav.planning`, `nav.alerts`
- `nav.members`, `nav.directory`, `nav.committees`, `nav.sheets`, `nav.onlineRenewal`
- `nav.finance`, `nav.banqueOverview`, `nav.banqueOps`, `nav.banqueJournal`, etc.
- `nav.assets`, `nav.equipment`, `nav.assetTypes`, `nav.assetPricing`
- `nav.salesSuppliers`, `nav.memberSales`, `nav.supplierInvoices`
- `nav.integrations` et sous-routes Planche/HelloAsso/Gesasso/OSRT
- `nav.reporting`
- `nav.administration` et sous-routes

### 0.6 — Navigation réécrite

`frontend/src/shell/navigation.ts` : 14 modules techniques → 9 groupes workflow :
1. Dashboard
2. Daily Operations (flights, packs, planning, alerts)
3. Members 360 (directory, committees, sheets, online renewal)
4. Finance (banque overview, ops, journal, fiscal years, PCG, pricing, reports, settings)
5. Assets (equipment, types, pricing)
6. Sales & Suppliers (member sales, supplier invoices)
7. Integrations (Planche, HelloAsso, Gesasso, OSRT)
8. Reporting
9. Administration (admin, config HelloAsso/Planche/Storage/Banque)

### 0.7 — Modules vides

- `frontend/src/modules/daily-ops/` — Phase 4 (alertes) et Phase 2 (cockpit vols)
- `frontend/src/modules/reporting/` — Phase 7 (KPIs, graphiques)
- `frontend/src/modules/integrations/` — Phase 9 (Gesasso, OSRT)

Chaque module a :
- `index.ts` avec licence AGPL et commentaire de phase cible
- `components/index.ts`
- `api/index.ts`

## Validation

- ⬜ `tsc --noEmit` — à exécuter (terminal non disponible)
- ⬜ `vite build` — à exécuter (terminal non disponible)
- ⬜ Test navigation — à effectuer manuellement
