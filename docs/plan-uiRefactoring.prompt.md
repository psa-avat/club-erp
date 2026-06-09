# Plan de Refactoring UI — ERP Club — V2 Révisée

> **TL;DR** — Évolution pragmatique de la navigation (14 modules techniques) vers un cockpit orienté workflows, **sans renommer les dossiers modules** et en **capitalisant sur l'existant**. 10 phases, ~14-16 semaines. Le chantier clé est **l'enrichissement de `banque/` et `flights/`** plutôt que leur démantèlement, l'ajout du système d'alertes, du reporting, l'intégration des envois fédéraux (Gesasso/OSRT), le module de réinscription dans le portail membre, et la finalisation du workspace membre unifié.

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
| **Menu adaptatif aux rôles** | La sidebar et les pages accessibles s'adaptent aux capabilities de l'utilisateur connecté (déjà en place via `requiredCapability` dans `shellNavItems`). |
| **Pas de rétrocompatibilité frontend** | L'application n'étant pas déployée, les routes et structures existantes peuvent être modifiées librement. Aucune redirection 301 ni ré-export temporaire nécessaire. |
| **Migration BD avec préservation des données** | Tout changement de schéma de table doit être accompagné d'un script de migration SQL preservant l'intégrité des données existantes. |

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

> **Note** : L'application n'étant pas encore déployée en production, les modifications de chemins et de structure sont possibles sans contrainte de rétrocompatibilité. En revanche, les scripts de migration SQL sont obligatoires pour tout changement de schéma.

---

## Navigation cible — ERP Club

Menu latéral **collapsible** structuré par groupes métier. La `Sidebar.tsx` actuelle est déjà générique — seuls `shell/navigation.ts` et les `labelKey` i18n changent.

> **Adaptation aux rôles** : chaque entrée de navigation peut être conditionnée par une `requiredCapability` (ex: `VIEW_FINANCIALS`, `MANAGE_USERS`). Le mécanisme est déjà implémenté dans `Sidebar.tsx` et `Header.tsx` via le filtre sur les capabilities de l'utilisateur connecté. La nouvelle navigation conserve et enrichit ce principe — un membre non-admin ne verra que les sections auxquelles il a accès.

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
├── Sheets            → /club/sheets (exist.)
└── Online renewal    → /member-portal/renewal (NOUVEAU)

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
├── HelloAsso         → /helloasso (exist.)
├── Gesasso sync      → /integrations/gesasso (NOUVEAU)
└── OSRT sync         → /integrations/osrt (NOUVEAU)

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

### 4b. HelloAsso — Achats & Synchronisation

**Rôle** : HelloAsso est utilisé pour trois types d'achats :
1. **Vols d'initiation (VI)** — achetés par des tiers (non-membres) via un billet HelloAsso
2. **Souscriptions membres** — adhésions annuelles, packs, recharges de compte
3. **Paiements divers** — toute transaction membre passant par HelloAsso

**Existant** : Module `helloasso/` avec `HelloAssoPurchasesPage`, `HelloAssoViImportPage`, `HelloAssoIntegrationPage`.

**Δ à faire** (Phase 5) :
- Créer un module de **réinscription en ligne** dans le portail membre (renouvellement annuel) :
  - Détection membre existant vs nouveau
  - Sélection de la catégorie d'adhésion
  - Paiement via HelloAsso (redirection ou embed)
  - Confirmation + mise à jour statut membre dans l'ERP
- Consolider les pages de vues des achats (VI + membres) dans une interface unique
- Rafraîchir les écrans d'intégration (paramètres de connexion, mapping comptable)

### 4c. Gesasso & OSRT — Envois fédéraux

**Rôle** : Après facturation et validation, les vols doivent être transmis aux systèmes fédéraux :
- **Gesasso** : licence pilote — chaque vol validé est envoyé pour mettre à jour les heures de vol du pilote (obligatoire pour le suivi de licence)
- **OSRT** : navigabilité machine — chaque vol validé est transmis pour le suivi du temps de vol par machine (obligatoire pour le maintien de la navigabilité)

**Existant** : Rien. Nouveau module à créer.

**Δ à faire** (Phase 9) :
- Créer le module `integrations/` avec deux sous-sections :
  - **Gesasso sync** : envoi des vols vers l'API Gesasso, dashboard d'état (succès/échec), historique des envois, file de rattrapage
  - **OSRT sync** : envoi des temps machines vers l'API OSRT, dashboard d'état, file de rattrapage
- Logique d'envoi : déclenché automatiquement après le posting des écritures de vol, avec file de réessai et alerte en cas d'échec
- Configuration des endpoints, clés d'API et mapping dans la page de paramètres d'intégration
- Page de statut des synchronisations (dernier envoi, nombre de vols en attente, échecs)

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

### Phase 8 — Portail Membre & Réinscription (semaine 10-12)

| # | Action | Fichiers |
|---|--------|----------|
| 8.1 | Réconcilier le portail avec le design system partagé | `member-portal/components/` |
| 8.2 | Navigation responsive (tabs bas mobile, latéral desktop) | `member-portal/components/PortalShell.tsx` |
| 8.3 | Finaliser les écrans (compte, documents, disponibilité) | `member-portal/pages/` |
| 8.4 | **Créer le module de réinscription en ligne** : détection membre existant/nouveau, sélection catégorie, paiement HelloAsso, confirmation + mise à jour statut | `member-portal/pages/RenewalPage.tsx` + `member-portal/api/renewal.ts` |
| 8.5 | Workflow renouvellement : notification par email avant échéance, lien direct vers le formulaire | `member-portal/api/renewal.ts`, backend endpoint |

### Phase 9 — Intégrations Gesasso & OSRT (semaine 12-14)

**Objectif** : Envoyer les vols validés aux systèmes fédéraux.

| # | Action | Fichiers |
|---|--------|----------|
| 9.1 | Créer le module `integrations/` (api, components, types, index.ts) | `frontend/src/modules/integrations/` |
| 9.2 | Créer la page **Gesasso sync** : dashboard envois, historique, file de rattrapage | `integrations/components/GesassoSyncPage.tsx` |
| 9.3 | Créer la page **OSRT sync** : dashboard envois temps machine, historique | `integrations/components/OsrtSyncPage.tsx` |
| 9.4 | Créer le hook `useGesassoSync` / `useOsrtSync` (TanStack Query) | `integrations/api/sync.ts` |
| 9.5 | Page de configuration des endpoints et clés d'API | `integrations/components/SyncSettingsPage.tsx` |
| 9.6 | Alerte automatique en cas d'échec de synchronisation (intégré au système d'alertes Phase 4) | `integrations/api/sync.ts` + `daily-ops/api/alerts.ts` |
| 9.7 | Routes dans `App.tsx` | `frontend/src/App.tsx` |

### Phase 10 — Nettoyage & Finalisation (semaine 14-16)

| # | Action | Fichiers | Condition |
|---|--------|----------|-----------|
| 10.1 | Vérifier `grep -r` pour chaque module candidat à la suppression | — | Aucune référence |
| 10.2 | Supprimer `pricing/` si aucune référence | `frontend/src/modules/pricing/` | Vérifié 10.1 |
| 10.3 | Supprimer `vi/` si aucune référence | `frontend/src/modules/vi/` | Vérifié 10.1 |
| 10.4 | Supprimer `storage/` si aucune référence | `frontend/src/modules/storage/` | Vérifié 10.1 |
| 10.5 | Supprimer `club/` si aucune référence (shell uniquement) | `frontend/src/modules/club/` | Vérifié 10.1 |
| 10.6 | Nettoyer les clés i18n obsolètes | `packages/i18n/src/resources/` | — |
| 10.7 | Supprimer les ré-exports temporaires (si encore présents) | `banque/index.ts`, `assets/index.ts` | — |
| 10.8 | Générer les scripts de migration DB pour les changements de schéma intervenus | `deploy/migrations/` | — |
| 10.9 | Validation finale : `tsc --noEmit` + `vite build` + test toutes les routes + test envoi Gesasso/OSRT | — | — |

---

## Calendrier révisé

```
Semaine  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16
Phase 0  ██
Phase 1     ██
Phase 2        ███
Phase 3            ███
Phase 4                ██
Phase 5                  ██
Phase 6                    ██
Phase 7                      ███
Phase 8                         ███
Phase 9                              ███
Phase 10                                ███
```

---

## Stratégie de migration

L'application n'étant **pas encore déployée en production** (aucun utilisateur actif), la contrainte de rétrocompatibilité est fortement réduite. Cela permet des modifications plus franches sans risque de régression utilisateur.

1. **Routes et structure** : Les chemins et l'organisation des fichiers peuvent être modifiés librement. Aucune redirection 301 ni ré-export temporaire n'est nécessaire. **Cependant**, il est impératif de mettre à jour tous les imports et références internes simultanément.
2. **Scripts de migration DB** : Tout changement de schéma de table (ajout/suppression de colonne, modification de contrainte, renommage) doit être accompagné d'un script SQL versionné dans `deploy/migrations/`, exécutable à l'ordre et préservant l'intégrité des données existantes.
3. **Données existantes** : Les scripts de migration doivent :
   - Préserver toutes les données existantes (pas de `DROP TABLE` ou `TRUNCATE` non justifié)
   - Fournir des valeurs par défaut pour les nouvelles colonnes
   - Inclure un rollback script (down migration) pour chaque up migration
4. **Feature flags** : hook `useFeatureFlag(key: string)` basé sur `localStorage` pour déployer progressivement les nouvelles pages (cockpit flights, reporting) — optionnel mais recommandé.
5. **Mise à jour i18n** : les nouvelles clés (`nav.*`) sont ajoutées à mesure. Les anciennes clés peuvent être supprimées immédiatement (pas de déploiement en cours). Nettoyage final en Phase 10.
6. **Rollback plan** : chaque phase doit pouvoir être revert en ≤ 1h (une seule PR par phase). Les migrations DB doivent avoir leur down migration associée.

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
| `member-portal/` | Réconciliation design system + module réinscription | 8 |
| `member-portal/pages/RenewalPage.tsx` | Nouveau — réinscription en ligne | 8 |
| `member-portal/api/renewal.ts` | Nouveau — API réinscription | 8 |
| `integrations/` (5+ fichiers) | Nouveau module — Gesasso + OSRT | 9 |
| `frontend/src/modules/{pricing,vi,storage,club}` | Suppression (après vérification) | 10 |
| `deploy/migrations/` | Scripts de migration DB | 10 |
| `banque/index.ts` | Ré-exports temporaires puis cleanup | 7→10 |

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
| V8 | Le portail membre (nouvelle UI) est responsive, permet logbook/solde/dépôt/doc/changement token **et réinscription en ligne** | 8 |
| V9 | Les synchronisations Gesasso et OSRT fonctionnent : envoi automatique après posting, dashboard d'état, file de rattrapage | 9 |
| V10 | Aucune régression sur Planche, HelloAsso, exports, intégrations existantes | 10 |
| V11 | a11y : navigation clavier possible, contraste minimum respecté, lecteur d'écran navigable | 0, 10 |
| V12 | Build production : `vite build` OK, pas de warning, pas de clé i18n manquante | 10 |
| V13 | Les scripts de migration DB s'exécutent sans perte de données et sont réversibles | 10 |

---

## Dépendances backend

Ce plan est **majoritairement frontend**. Les routes API backend existantes restent inchangées. Cependant, certaines fonctionnalités nécessitent des endpoints ou modifications backend :

### APIs existantes (inchangées)
- Vols : `/api/v1/flights/*` (existe)
- Membres : `/api/v1/members/*` (existe)
- Écritures : `/api/v1/accounting/entries/*` (existe)
- Planche : `/api/v1/planche/*` (existe)
- HelloAsso : `/api/v1/helloasso/*` (existe)

### APIs à créer

| Endpoint | Usage | Phase |
|----------|-------|-------|
| `GET /api/v1/alerts` | Lister les alertes opérationnelles (vols non facturés, soldes négatifs, incohérences) | 4 |
| `POST /api/v1/alerts/:id/ack` | Acquitter une alerte | 4 |
| `GET /api/v1/reports/kpi` | Agrégats KPI (revenus vols, usage machines, tendances comptes) | 7 |
| `POST /api/v1/members/renewal` | Déclencher la réinscription d'un membre (vérification éligibilité, création adhésion) | 8 |
| `GET /api/v1/members/renewal/status` | Vérifier le statut de renouvellement d'un membre | 8 |
| `POST /api/v1/integrations/gesasso/sync` | Déclencher l'envoi des vols vers Gesasso | 9 |
| `GET /api/v1/integrations/gesasso/status` | Statut de la synchro Gesasso (dernier envoi, file d'attente, échecs) | 9 |
| `POST /api/v1/integrations/osrt/sync` | Déclencher l'envoi des temps machines vers OSRT | 9 |
| `GET /api/v1/integrations/osrt/status` | Statut de la synchro OSRT | 9 |
| `PUT /api/v1/integrations/settings` | Configuration des endpoints et clés API Gesasso/OSRT | 9 |

### Modifications backend (schéma DB)

| Modification | Raison | Migration requise |
|-------------|--------|-------------------|
| Table `member_renewals` (nouvelle) | Suivi des réinscriptions en ligne (date, statut, référence HelloAsso) | Oui |
| Table `integration_logs` (nouvelle) | Historique des envois Gesasso/OSRT avec statut et message d'erreur | Oui |
| Table `integration_settings` (nouvelle) | Configuration des endpoints et clés API (chiffrée) | Oui |
| Colonne `last_renewal_date` sur `members` (optionnelle) | Cache de la date de dernière réinscription pour le portail | Oui |

---


