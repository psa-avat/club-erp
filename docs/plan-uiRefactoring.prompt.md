# Plan de Refactoring UI — ERP Club — V2 Révisée

> **TL;DR** — Évolution pragmatique de la navigation (14 modules techniques) vers un cockpit orienté workflows, **sans renommer les dossiers modules** et en **capitalisant sur l'existant**. 8 phases, ~12-14 semaines. Le chantier clé est **l'enrichissement de `banque/` et `flights/`** plutôt que leur démantèlement, l'ajout du système d'alertes, du reporting, et la finalisation du workspace membre unifié.

---

## Principes directeurs (fusionnés)

| Principe | Application |
|----------|-------------|
| **Workflow d'abord** | La navigation suit les chaînes de valeur : facturation, trésorerie, suivi membre. |
| **Une seule vérité par écran** | Chaque entité (membre, vol, écriture) dispose d'un espace dédié et complet. |
| **Conserver les noms techniques** | Les dossiers `banque/`, `flights/`, `members/` ne sont pas renommés. Seule la navigation utilisateur (labels + groupes) change. |
| **Capitaliser sur l'existant** | `MemberWorkspaceShell`, `FlightsPage`, `BanqueDailyOpsPage`, `SupplierInvoicePage` etc. sont adaptés/réorganisés, pas réécrits. |
| **Suppressions prouvées** | Un module n'est supprimé qu'après vérification `grep` garantissant zéro référence. |
| **Mobile-first pour le portail** | Le portail membre responsive ; l'ERP reste desktop-first avec adaptation tablette. |
| **A11y par défaut** | Navigation clavier, contraste minimum, attributs ARIA, focus visible. |

---

## Architecture cible

Deux applications partageant le même design system (`packages/ui/`) :

- **ERP Club** → utilisateurs internes (bureau + tablette)
- **Portail Membre** → tous les membres (mobile + desktop)

### Structure technique conservée (pas de renommage)

```
frontend/src/modules/
├── admin/        ← conserve
├── assets/       ← enrichi (pricing, VI)
├── banque/       ← conserve (le cœur finance reste ici)
├── club/         ← conservé temporairement, redirigé dans la nav
├── dashboard/    ← conserve
├── flights/      ← enrichi (cockpit billing)
├── helloasso/    ← conserve
├── member-portal/← conserve
├── members/      ← enrichi (workspace tabs finis)
├── planche/      ← conserve
├── planning/     ← conserve
├── pricing/      ← absorbé par assets/ (après vérification)
├── storage/      ← absorbé par admin/ (après vérification)
├── vi/           ← absorbé par assets/ (après vérification)
├── reporting/    ← NOUVEAU (KPI, graphiques)
└── daily-ops/    ← NOUVEAU (alerts banner + page)
```

**Règle** : Aucun déplacement de code d'un module existant vers un nouveau module. Les nouvelles fonctionnalités (alertes, reporting) s'ajoutent dans les nouveaux modules. Les pages existantes restent dans leurs modules et sont simplement ré-exposées via la nouvelle navigation.

---

## Navigation cible — ERP Club

Menu latéral **collapsible** structuré par groupes métier. La `Sidebar.tsx` actuelle est déjà générique — seuls `shell/navigation.ts` et les `labelKey` i18n changent.

```
📊 Dashboard
──────────────────
✈️ Daily Operations
├── Flights           → /flights (exist.)
├── Packs             → /banque/packs (exist.)
├── Planning          → /planning (exist.)
└── Alerts & Tasks    → /daily-ops/alerts (NOUVEAU)

👥 Members
├── Directory         → /club/members (exist.)
├── Member workspace  → /club/members/:uuid/workspace (exist.)
├── Committees        → /club/commissions (exist.)
└── Sheets            → /club/sheets (exist.)

💰 Finance & Accounting
├── Overview          → /banque (exist.)
├── Operations        → /banque/operations (exist.)
├── Journal           → /banque/journal (exist.)
├── Fiscal Years      → /banque/fiscal-years (exist.)
├── Chart of Accounts → /banque/pcg (exist.)
├── Pricing           → /banque/pricing (exist.)
├── Reports           → /banque/reports (exist.)
└── Settings          → /banque/settings (exist.)

🛠️ Assets & Pricing
├── Equipment         → /assets (exist.)
├── Asset Types       → /assets/types (exist.)
├── Pricing           → /assets/:uuid/pricing (exist.)
└── VI Types          → /vi/types (exist., absorption future)

🧾 Sales & Suppliers
├── Member Sales      → /banque/operations?tab=sales (exist.)
└── Supplier Invoices → /banque/factures-fournisseurs (exist.)

🔌 Integrations
├── Planche           → /planche (exist.)
└── HelloAsso         → /helloasso (exist.)

📈 Reporting          → /reporting (NOUVEAU)

⚙️ Admin
├── Admin             → /admin (exist.)
├── System Settings   → /admin (exist.)
└── Audit Log         → /admin (exist.)
```

---

## Design system (évolutif à partir de l'existant)

### État des lieux
- 18 composants UI existants dans `frontend/src/components/ui/` (button, data-table, dialog, tabs, card, input, label, alert, banner, filter-bar, etc.)
- Packages workspace `packages/ui/` créé mais quasi vide

### Actions Phase 0

| # | Action |
|---|--------|
| D0.1 | Peupler `packages/ui/` en y déplaçant les composats génériques depuis `frontend/src/components/ui/` (pour partage ERP + Portail) |
| D0.2 | Ajouter les tokens CSS (couleurs, typographie, espacements) dans `packages/ui/src/tokens.css` |
| D0.3 | Ajouter Storybook pour le catalogue de composants |
| D0.4 | Créer les composants manquants : `Skeleton` (loading), `ErrorBoundary`, `EmptyState` (générique), `PageHeader` (unifié) |
| D0.5 | Audit a11y des composants existants : focus ring, contraste, rôles ARIA |

### Palette de couleurs (tokens)

| Rôle | Valeur |
|------|--------|
| Primaire | Blue 700 (#1E40AF) |
| Secondaire | Slate 50-900 |
| Succès | Green 600 (#16A34A) |
| Warning | Orange 500 (#F97316) |
| Erreur | Red 600 (#DC2626) |
| Fond | Slate 50 |

### Typographie
- Famille : Inter (sans-serif)
- Tailles : 14px défaut, 12px petit, 16/20/24px titres

---

## Layout standard — ERP Club
```
[LOGO] [Sidebar collapsible] [Top bar]
[Recherche globale | FY selector | Langue | Notifications | Avatar]
┌────────────────────────────────────────────────────────────┐
│ Breadcrumbs: Daily Operations > Flights                     │
│ [AlertsBanner — permanent, contextual]                      │
│                                                             │
│ [Filtres] [Actions batch] [Export]                          │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Content (tableau / formulaire / workspace)              │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Contextual side panel — optionnel]                         │
└────────────────────────────────────────────────────────────┘
```

---

## Écrans clés — description et état existant

### 1. Daily Operations > Flights (cockpit facturation)

**Existant** : `FlightsPage.tsx` — tableau des vols, preview facturation, expansion, filtres date/aéronef/pilote/statut, calcul durée, détail tarifs, hash de billing.

**Δ à faire** (Phase 2) :
- Ajouter les onglets `pending` / `applied` / `posted` en haut du tableau
- Ajouter les actions batch (« Apply billing », « Post to accounting ») sur sélection multiple
- Ajouter les KPIs de tête (montant total par statut, nombre de vols)
- Améliorer le `FlightDetailDialog` existant

### 2. Members > Member Workspace (unifié club + portail)

**Existant** : `MemberWorkspaceShell.tsx` — tabs (logbook, balance, expenses, volunteer-fiscal, documents), header avec avatar/infos, mode club/portal, changement mot de passe, `MemberLogbookTab`, `MemberBalanceTab`.

**Δ à faire** (Phase 3) :
- Remplacer les 3 placeholders (`TabPlaceholder`) par du contenu réel :
  - **Expenses** : formulaire de dépôt + liste + validation/rejet admin → auto-remboursement
  - **Volunteer fiscal** : déclaration annuelle, upload preuve, validation club
  - **Documents** : upload/download (certificats, factures) — stockage S3
- Ajouter l'onglet **Packs** (solde des packs, historique consommation)
- En mode club : sélecteur de membre + boutons « Modifier fiche », « Envoyer accès portail »

### 3. Finance > Journal (écritures)

**Existant** : `BanqueJournalEntriesPage`, `BanqueJournalEntryWorkspacePage`, `BanqueJournalTemplatesPage` — tableaux, création, posting, filtres exercice/journal/état/date.

**Δ à faire** : Aucun changement de code prévu. La page reste dans `banque/`. La nouvelle navigation pointe simplement vers les mêmes routes.

### 4. Alerts & Tasks (transverse — NOUVEAU)

**Existant** : Rien.

**Δ à faire** (Phase 4) :
- `AlertsBanner` : bandeau persistant dans `AppShell.tsx` (entre breadcrumbs et contenu)
- `AlertsPage` : page dédiée avec liste exhaustive, acquittement, report
- Hook `useAlerts` : polling 5 min ou SSE
- Types d'alertes : vols non facturés (>7j), vols modifiés après facturation, tarification manquante, solde membre négatif, pack incohérent, erreurs sync Planche/HelloAsso

### 5. Sales & Suppliers

**Existant** : `SupplierInvoicePage`, `OpsSalesTab`, `OpsSupplierTab` dans `BanqueDailyOpsPage`.

**Δ à faire** (Phase 5) :
- Créer une page standalone `SalesPage` pour les ventes aux membres (avec formulaire article → génération écriture + mise à jour compte membre)
- Créer une page standalone `SupplierInvoicePage` (existe déjà, à wrapper)
- Les onglets dans `BanqueDailyOpsPage` restent inchangés

### 6. Planning

**Existant** : `PlanningPage` (existe).

**Δ à faire** (Phase 6) :
- Enrichir la vue calendrier (jour, semaine, mois) avec créneaux Planche, disponibilités membres, assignation instructeurs
- Actions : créer événement, assigner instructeur, publier planning

### 7. Reporting / KPIs (NOUVEAU)

**Existant** : `FinancialReportsPage` dans `banque/`, `DashboardPage`.

**Δ à faire** (Phase 7) :
- Créer `reporting/` module avec `ReportingPage` (grille KPI)
- Graphiques : revenus vols, usage machines, tendances comptes membres, consommation packs
- Déplacer `FinancialReportsPage` de `banque/` vers `reporting/` avec ré-export temporaire

### 8. Portail Membre — nouvelle UI

**Existant** : `member-portal/` avec `PortalShell`, `LoginPage`, `DashboardPage`, `FlightsPage`, `AccountPage`, `ExpensesPage`, `WorkspacePage`.

**Δ à faire** (Phase 8) :
- Réconcilier avec le design system partagé (`packages/ui/`)
- Navigation par onglets (bas sur mobile, gauche sur desktop) : Mes vols, Mon compte, Notes de frais, Déclarations, Documents, Disponibilité
- Sécurité : changement token/mot de passe, visualisation dernières connexions

---

## Phases d'implémentation (révisées)

### Phase 0 — Design System & Fondations (semaine 1)

| # | Action | Fichiers |
|---|--------|----------|
| 0.1 | Peupler `packages/ui/` avec composants partagés + tokens CSS | `packages/ui/src/` |
| 0.2 | Installer Storybook, cataloguer les composants existants | `packages/ui/.storybook/` |
| 0.3 | Créer `Skeleton`, `ErrorBoundary`, `EmptyState` génériques | `packages/ui/src/` |
| 0.4 | Audit a11y : focus ring, contraste, rôles ARIA sur tous les composants | `packages/ui/src/*` |
| 0.5 | Ajouter les clés i18n pour la nouvelle navigation (fr + en) | `packages/i18n/src/resources/` |
| 0.6 | Créer les nouveaux modules vides (`reporting/`, `daily-ops/`) | `frontend/src/modules/reporting/`, `daily-ops/` |

### Phase 1 — Navigation & Layout (semaine 2)

| # | Action | Fichiers |
|---|--------|----------|
| 1.1 | Réécrire `shell/navigation.ts` — nouveaux groupes + labels métier | `frontend/src/shell/navigation.ts` |
| 1.2 | Mettre à jour `App.tsx` — nouvel ordre des routes, pas de renommage de paths | `frontend/src/App.tsx` |
| 1.3 | Ajouter `AlertsBanner` placeholder dans `AppShell.tsx` | `frontend/src/shell/components/AppShell.tsx` |
| 1.4 | Intégrer `PageHeader` unifié (breadcrumbs + titre + actions) | `packages/ui/src/` |
| 1.5 | Tests : `tsc --noEmit`, test manuel de chaque lien de navigation | — |

**Sidebar.tsx inchangée** — elle lit déjà `shellNavItems` dynamiquement et gère les capability gates.

### Phase 2 — Cockpit Flights (semaine 3-4)

| # | Action | Fichiers |
|---|--------|----------|
| 2.1 | Ajouter les onglets de statut (pending/applied/posted) à `FlightsPage.tsx` | `flights/components/FlightsPage.tsx` |
| 2.2 | Ajouter KPI strip (montant total par statut, nombre de vols) | `flights/components/FlightsPage.tsx` |
| 2.3 | Implémenter les actions batch (apply billing, post) sur sélection | `flights/components/FlightsPage.tsx` |
| 2.4 | Rendre les lignes expansibles avec détail tarifaire (utiliser `FlightDetailDialog` existant) | `flights/components/FlightsPage.tsx` |

### Phase 3 — Member Workspace — Finalisation (semaine 4-5)

| # | Action | Fichiers |
|---|--------|----------|
| 3.1 | Implémenter le tab Club Expenses (dépôt note de frais + liste + workflow validation) | `members/components/MemberExpensesTab.tsx` |
| 3.2 | Implémenter le tab Volunteer Fiscal Declarations (upload + validation) | `members/components/MemberFiscalTab.tsx` |
| 3.3 | Implémenter le tab Documents (upload/download S3) | `members/components/MemberDocumentsTab.tsx` |
| 3.4 | Ajouter le tab Packs (solde, historique consommation) | `members/components/MemberPacksTab.tsx` |
| 3.5 | Mode club : sélecteur de membre + boutons « Modifier » / « Envoyer accès portail » | `members/components/MemberWorkspaceShell.tsx` |

### Phase 4 — Système d'Alertes (semaine 5-6)

| # | Action | Fichiers |
|---|--------|----------|
| 4.1 | Créer le hook `useAlerts` (TanStack Query + polling 5min) | `daily-ops/api/alerts.ts` |
| 4.2 | Créer `AlertsBanner` (bandeau permanent dans AppShell) | `daily-ops/components/AlertsBanner.tsx` |
| 4.3 | Créer `AlertsPage` (liste exhaustive + acquittement + report) | `daily-ops/components/AlertsPage.tsx` |
| 4.4 | Intégrer `AlertsBanner` dans `AppShell.tsx` | `shell/components/AppShell.tsx` |

### Phase 5 — Sales & Suppliers (semaine 6-7)

| # | Action | Fichiers |
|---|--------|----------|
| 5.1 | Créer `SalesPage` (ventes aux membres) dans `banque/` (pas de nouveau module) | `banque/components/SalesPage.tsx` |
| 5.2 | Wrapper `SupplierInvoicePage` pour navigation autonome | `banque/components/SupplierInvoicePage.tsx` |
| 5.3 | Ajouter les routes dans `App.tsx` | `frontend/src/App.tsx` |

### Phase 6 — Planning enrichi (semaine 7-8)

| # | Action | Fichiers |
|---|--------|----------|
| 6.1 | Enrichir `PlanningPage` avec vues jour/semaine/mois | `planning/components/PlanningPage.tsx` |
| 6.2 | Ajout créneaux Planche + disponibilités membres | `planning/api/` |
| 6.3 | Actions : créer événement, assigner instructeur | `planning/components/` |

### Phase 7 — Reporting (semaine 8-10)

| # | Action | Fichiers |
|---|--------|----------|
| 7.1 | Créer le module `reporting/` avec barrel exports | `reporting/index.ts` |
| 7.2 | Créer `ReportingPage` (grille KPI) | `reporting/components/ReportingPage.tsx` |
| 7.3 | Créer les graphiques (FlightRevenue, MachineUsage, PackConsumption, MemberBalance) | `reporting/components/*.tsx` |
| 7.4 | Déplacer `FinancialReportsPage` de `banque/` vers `reporting/` | `reporting/components/FinancialReportsPage.tsx` |
| 7.5 | Ré-export temporaire depuis `banque/` | `banque/index.ts` |

### Phase 8 — Portail Membre (semaine 10-12)

| # | Action | Fichiers |
|---|--------|----------|
| 8.1 | Réconcilier le portail avec le design system partagé | `member-portal/components/` |
| 8.2 | Navigation responsive (tabs bas mobile, latéral desktop) | `member-portal/components/PortalShell.tsx` |
| 8.3 | Finaliser les écrans (compte, documents, disponibilité) | `member-portal/pages/` |

### Phase 9 — Nettoyage & Finalisation (semaine 12-14)

| # | Action | Fichiers | Condition |
|---|--------|----------|-----------|
| 9.1 | Vérifier `grep -r` pour chaque module candidat à la suppression | — | Aucune référence |
| 9.2 | Supprimer `pricing/` si aucune référence | `frontend/src/modules/pricing/` | Vérifié 9.1 |
| 9.3 | Supprimer `vi/` si aucune référence | `frontend/src/modules/vi/` | Vérifié 9.1 |
| 9.4 | Supprimer `storage/` si aucune référence | `frontend/src/modules/storage/` | Vérifié 9.1 |
| 9.5 | Supprimer `club/` si aucune référence (shell uniquement) | `frontend/src/modules/club/` | Vérifié 9.1 |
| 9.6 | Nettoyer les clés i18n obsolètes | `packages/i18n/src/resources/` | — |
| 9.7 | Supprimer les ré-exports temporaires | `banque/index.ts`, `assets/index.ts` | — |
| 9.8 | Validation finale : `tsc --noEmit` + `vite build` + test toutes les routes | — | — |

---

## Calendrier révisé

```
Semaine  1  2  3  4  5  6  7  8  9  10 11 12 13 14
Phase 0  ██
Phase 1     ██
Phase 2        ███
Phase 3            ███
Phase 4                ██
Phase 5                  ██
Phase 6                    ██
Phase 7                      ███
Phase 8                         ███
Phase 9                            ███
```

---

## Stratégie de migration sans casse

1. **Aucune route existante ne change** pendant les phases 0-8. Les URLs restent identiques.
2. **Phase 1 uniquement** : la sidebar change, mais les liens pointent vers les mêmes routes.
3. **Pour les déplacements de code** (Phase 7, Phase 9) : les anciens modules ré-exportent temporairement depuis les nouveaux via leur `index.ts`.
4. **Feature flags** : hook `useFeatureFlag(key: string)` basé sur `localStorage` pour déployer progressivement les nouvelles pages (cockpit flights, reporting).
5. **Mise à jour i18n** : les anciennes clés sont conservées dans les fichiers de traduction pendant toute la durée du refactoring. Les nouvelles clés (`nav.*`) sont ajoutées sans supprimer les anciennes.
6. **Rollback plan** : chaque phase doit pouvoir être revert en ≤ 1h (une seule PR par phase).

---

## Fichiers impactés (récapitulatif)

| Fichier | Changement | Phase |
|---------|-----------|-------|
| `packages/ui/src/` | Création tokens + composants mutualisés | 0 |
| `frontend/src/shell/navigation.ts` | Réécriture des groupes, labels conservés | 1 |
| `frontend/src/App.tsx` | Réorganisation des routes, pas de renommage | 1 |
| `frontend/src/shell/components/AppShell.tsx` | Ajout `AlertsBanner` | 4 |
| `packages/i18n/src/resources/*.ts` | Nouvelles clés `nav.*` | 1 |
| `flights/components/FlightsPage.tsx` | Onglets + KPIs + batch actions | 2 |
| `members/components/MemberWorkspaceShell.tsx` | 3 placeholders → contenu réel + tab Packs | 3 |
| `members/components/Member*Tab.tsx` | 4 nouveaux fichiers tabs | 3 |
| `daily-ops/components/AlertsBanner.tsx` | Nouveau | 4 |
| `daily-ops/components/AlertsPage.tsx` | Nouveau | 4 |
| `daily-ops/api/alerts.ts` | Nouveau | 4 |
| `banque/components/SalesPage.tsx` | Nouveau | 5 |
| `planning/components/PlanningPage.tsx` | Enrichissement calendrier | 6 |
| `reporting/` (4 fichiers) | Nouveau module | 7 |
| `member-portal/` | Réconciliation design system | 8 |
| `frontend/src/modules/{pricing,vi,storage,club}` | Suppression (après vérification) | 9 |
| `banque/index.ts` | Ré-exports temporaires puis cleanup | 7→9 |

---

## Critères d'acceptation

| ID | Critère | Phase de validation |
|----|---------|---------------------|
| V1 | La nouvelle navigation est accessible, tous les liens mènent à des pages fonctionnelles | 1 |
| V2 | Le cockpit Vols affiche les vols avec leurs statuts, les KPIs sont corrects, les actions batch fonctionnent | 2 |
| V3 | L'espace membre unifié (club + portail) montre les mêmes données que l'ancienne fiche pilote, tous les tabs sont fonctionnels | 3 |
| V4 | Le bandeau d'alertes affiche des alertes réelles, chaque alerte a un lien actionnable | 4 |
| V5 | Les pages Ventes et Factures fournisseurs sont accessibles et produisent les écritures attendues | 5 |
| V6 | Le planning affiche créneaux + disponibilités, les actions de base fonctionnent | 6 |
| V7 | Les graphiques KPI sont chargés avec données réelles, aucun export CSV régressé | 7 |
| V8 | Le portail membre (nouvelle UI) est responsive, permet logbook/solde/dépôt/doc/changement token | 8 |
| V9 | Aucune régression sur Planche, HelloAsso, exports, intégrations | 9 |
| V10 | a11y : navigation clavier possible, contraste minimum respecté, lecteur d'écran navigable | 0, 9 |
| V11 | Build production : `vite build` OK, pas de warning, pas de clé i18n manquante | 9 |

---

## Dépendances backend

Ce plan est **uniquement frontend**. Les routes API backend restent inchangées. Aucune nouvelle API n'est requise pour :
- Vols : `/api/v1/flights/*` (existe)
- Membres : `/api/v1/members/*` (existe)
- Écritures : `/api/v1/accounting/entries/*` (existe)
- Alertes : endpoint à créer (GET /api/v1/alerts) — nécessite implémentation backend
- Reporting : endpoints à créer ou réutiliser (GET /api/v1/reports/kpi) — nécessite implémentation backend

---
