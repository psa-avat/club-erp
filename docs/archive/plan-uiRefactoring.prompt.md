# Plan de Refactoring UI — ERP Club — V4 (Spec-Conforme)

> **TL;DR** — Plan refondu selon la spec UI v2 (Dashboard + Menu Tiroir). Navigation par ☰ drawer, dashboard comme page d'accueil centrale avec KPIs actionnables. 13 phases, ~20 semaines.

---

## Principes directeurs

| Principe | Application |
|----------|-------------|
| **Dashboard d'abord** | Page d'accueil montre ce qui nécessite une action aujourd'hui (KPIs, alertes). |
| **Menu tiroir (drawer), pas de sidebar** | Bouton ☰ universel. Drawer overlay sur desktop + mobile. |
| **Workflow d'abord** | Navigation par chaînes de valeur : facturation, trésorerie, suivi membre. |
| **Une seule vérité par écran** | Chaque entité (membre, vol, écriture) a sa page dédiée. |
| **Adapter aux rôles** | KPIs, alertes, entrées de menu filtrés par capabilities. |
| **Conserver les noms techniques** | Dossiers `banque/`, `flights/`, `members/` inchangés dans le code. |
| **Capitaliser sur l'existant** | Pages adaptées/réorganisées, pas réécrites. |
| **Suppressions prouvées** | Suppression seulement après `grep` garantissant zéro référence. |
| **Mobile-first pour le portail** | Portail membre responsive ; ERP desktop-first adapté tablette. |
| **A11y par défaut** | Navigation clavier, contraste, ARIA, focus visible. |
| **Pas de rétrocompatibilité frontend** | Appli non déployée => routes modifiables librement. |
| **Migration DB avec scripts SQL** | Up + down, données préservées. |
| **RGPD intégré** | Anonymisation, consentement, journal d'audit dans l'UX. |

---

## Architecture cible

```
frontend/src/modules/
├── admin/          ← Utilisateurs, rôles, audit, S3 storage
├── assets/         ← Flotte, maintenance, pricing, packs, VI types
├── banque/         ← MVP + Next : journal, PCG, entries, ventes, fournisseurs, reports, reconciliation
├── club/           ← Temporaire (à fondre dans members/)
├── committees/     ← NOUVEAU : comités, budgets, validation dépenses
├── dashboard/      ← Page d'accueil KPIs, alertes, activité récente
├── daily-ops/      ← Next step : alertes
├── flights/        ← Cockpit facturation, historique
├── helloasso/      ← Consolidation VI + achats membres
├── integrations/   ← Next step : Gesasso, OSRT
├── member-portal/  ← Portail (login, logbook, solde, packs, frais)
├── members/        ← Annuaire, fiches, workspace
├── planche/        ← Sync flights + assets + configuration
├── planning/       ← Next step : vue informative
├── pricing/        ← À absorber par assets/
├── reporting/      ← KPI, graphiques, rapports financiers
├── sales/          ← NOUVEAU : ventes aux membres (reprend OpsSalesTab)
├── storage/        ← À absorber par admin/
└── vi/             ← À absorber par assets/
```

---

## Layout standard — ERP Club

```
[☰  ERP Club                [Exercice 2025] [FR] [Jean Dupont ▼]]
┌───────────────────────────────────────────────────────────────┐
│ [AlertsBanner — permanent, contextual]                        │
│ [PageHeader — breadcrumbs + titre + actions]                  │
│                                                                │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ Content (tableau / formulaire / workspace / KPIs)       │   │
│ └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

**Drawer (sur clic ☰)** :
```
┌──────────────────┐
│ 📊 Tableau de bord│
├──────────────────┤
│ ✈️ Vols          │
│   ├── Cockpit    │
│   └── Historique │
├──────────────────┤
│ 👥 Membres       │
│   ├── Annuaire   │
│   ├── Fiche      │
│   ├── Réinscrip. │
│   ├── Comités    │
├──────────────────┤
│ 🛠️ Actifs        │
│   ├── Flotte     │
│   ├── Tarifs     │ ← pricing + packs (annuel)
│   └── Maintenance│
├──────────────────┤
│ 💰 Finances      │
│   ├── Journal    │
│   ├── Ventes     │ ← ex-OpsSalesTab
│   ├── Fournisseur│ ← ex-OpsSupplierTab
│   ├── PCG        │
│   ├── Exercices  │
│   └── Rapports   │
├──────────────────┤
│ 🔌 Intégrations  │
│   ├── Planche    │
│   ├── HelloAsso  │
│   ├── Gesasso    │
│   └── OSRT       │
├──────────────────┤
│ ⚙️ Admin         │
└──────────────────┘
```

---

## Personas

| Persona | Tâches principales |
|---------|-------------------|
| **Secrétaire** | Facturation vols (Planche → écritures), gestion membres, imports HelloAsso |
| **Trésorier** | Ventes, fournisseurs, pointage bancaire, validation écritures, clôture exercice, reporting |
| **Responsable maintenance** | Suivi actifs (état, inspections), heures vol par machine |
| **Président de comité** | Consultation budget, validation dépenses comité |
| **Membre (portail)** | Solde, achat pack, déclaration frais, réinscription |

---

## Workflows clés

```
Flight → Accounting : Planche → Import → Preview → Apply → Draft FL → Post → Posted
Member → Portal : Create → HelloAsso → Portal access → Logbook + Balance + Packs
Asset → Planche : Created/priced → Push to Planche → Flight import consistency
Pack lifecycle : Purchase (HelloAsso) → Credit account → Flight consumption → REM
Bank reconciliation : Import relevé → Match entries → Flag → Manual resolution
Committee budget : Budget défini → Dépense soumise → Président approuve/rejette
RGPD : Member resigns → Consent revoked → Anonymize → Audit log frozen
```

## Cycle de vie facturation

| État | Signification | UI |
|------|--------------|----|
| `pending` | Vol importé, pas facturé | Badge orange |
| `previewed` | Aperçu calculé, pas appliqué | Badge bleu clair |
| `applied` | Écriture brouillon créée (FL) | Badge bleu |
| `posted` | Écriture postée (immuable) | Badge vert |
| `reversed` | Annulation + replacement | Badge rouge barré |

## RBAC

| Module / Action | Admin | Comptable | Opérations | Maintenance | Instructeur | Membre |
|----------------|-------|-----------|------------|-------------|-------------|--------|
| Membres - Lecture | ✅ | ✅ | ✅ | ❌ | ✅ | Soi |
| Membres - Écriture | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Comités - Budget | ✅ | ✅ | ❌ | ❌ | ❌ | Son comité |
| Assets - Lecture | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Assets - Écriture | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Vols - Facturation | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Vols - Reversal | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Finance - Écritures | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Finance - Pointage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sales - Gérer | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Admin - Config | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| RGPD - Anonymisation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Portail - Accès | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Phases d'implémentation

Légende : 🟢 **MVP** · 🔵 **Next** · ⚪ **Cleanup**

---

### Phase 0 — Design System & Fondations (semaine 1) — ✅ FAITE

| # | Action | Fichiers | Statut |
|---|--------|----------|--------|
| 0.1 | Peupler `packages/ui/` composants + tokens CSS | `packages/ui/src/` | ✅ |
| 0.2 | Storybook + catalogue composants | `packages/ui/.storybook/` | ✅ |
| 0.3 | Skeleton, ErrorBoundary, EmptyState | `packages/ui/src/` | ✅ |
| 0.4 | Audit a11y (focus, contraste, ARIA) | `packages/ui/src/*` | ✅ |
| 0.5 | Clés i18n `nav.*` fr + en | `packages/i18n/src/` | ✅ |
| 0.6 | Navigation.ts : 14 modules → groupes workflow | `shell/navigation.ts` | ✅ |
| 0.7 | Modules vides (daily-ops, reporting, integrations) | `modules/{daily-ops,reporting,integrations}/` | ✅ |

---

### Phase 1 — Navigation & Layout Drawer (semaine 2) — 🟢 MVP — ✅ FAITE

| # | Action | Fichiers | Statut |
|---|--------|----------|--------|
| 1.1 | App.tsx — nouvel ordre des routes | `frontend/src/App.tsx` | ✅ |
| 1.2 | AlertsBanner placeholder | `shell/components/AlertsBanner.tsx` | ✅ |
| 1.3 | PageHeader unifié (breadcrumbs + titre + actions) | `packages/ui/src/page-header.tsx` | ✅ |
| 1.4 | **Drawer : remplacer Sidebar + MobileDrawer** | `shell/components/Drawer.tsx` | ✅ |
| 1.5 | Bouton ☰ universel (desktop + mobile) | `shell/components/Header.tsx` | ✅ |
| 1.6 | Supprimer Sidebar.tsx, MobileDrawer.tsx | — | ✅ |
| 1.7 | Tests : tsc + vite build | — | ✅ |

---

### Phase 1b — Réorganisation Pages & Routes (semaine 2-3) — 🟢 MVP

**Objectif** : Mettre chaque page existante à sa place dans la nouvelle arborescence. Les tabs de `/banque/operations` (Pointage) sont éclatés en pages autonomes dans les modules métier. Suppression des doublons (Vols). Les packs sont repositionnés comme tarifs (opération annuelle).

| # | Action | Fichiers |
|---|--------|----------|
| 1b.1 | **Éclater `BanqueDailyOpsPage`** : chaque tab devient une page autonome | — |
| 1b.2 | OpsFlightsTab → fusionner dans `FlightsPage` (supprimer le doublon) | `flights/components/FlightsPage.tsx`, `banque/components/OpsFlightsTab.tsx` |
| 1b.3 | OpsSalesTab → migrer dans `sales/` comme composant de `SalesPage` | `sales/components/SalesPage.tsx`, `banque/components/OpsSalesTab.tsx` |
| 1b.4 | OpsPacksTab → migrer dans `assets/` comme vue « utilisation des packs » (distincte de la définition) | `assets/components/AssetPacksUsage.tsx`, `banque/components/OpsPacksTab.tsx` |
| 1b.5 | OpsSupplierTab → migrer dans `banque/` comme page fournisseurs autonome | `banque/components/SupplierInvoicePage.tsx`, `banque/components/OpsSupplierTab.tsx` |
| 1b.6 | Supprimer `BanqueDailyOpsPage.tsx` et rediriger `/banque/operations` → `/banque/journal` | `frontend/src/App.tsx` |
| 1b.7 | Compléter `navigation.ts` avec toutes les entrées Next + Placeholder | `shell/navigation.ts` |
| 1b.8 | Créer `PlaceholderPage` (titre, description, "À venir") + routes manquantes | `components/ui/PlaceholderPage.tsx`, `frontend/src/App.tsx` |
| 1b.9 | Vérification manuelle : tous les liens naviguent sans 404 | — |

### Phase 1c — Homogénéisation Pages (semaine 3) — 🟢 MVP — ✅ FAITE

| # | Action | Fichiers | Statut |
|---|--------|----------|--------|
| 1c.1 | Migrer PageHeader imports → @club-erp/ui | Toutes les pages | ✅ |
| 1c.2 | PageHeader sur Dashboard, Banque, Admin | `dashboard`, `banque`, `admin` | ✅ partiel |
| 1c.3 | Tabs normalisés (packages/ui + AdminPage) | `packages/ui/src/tabs.tsx`, `admin/AdminPage.tsx` | ✅ |
| 1c.4 | Sous-pages Next/Cleanup → PlaceholderPage | — | ⏭️ |
| 1c.5 | tsc --noEmit + vite build + test manuel | — | ✅ |

---

### Phase 2 — Dashboard KPIs (semaine 3-4) — 🟢 MVP

**Objectif** : Page d'accueil avec KPIs actionnables.

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ ✈️ VOLS     │  │ 👥 MEMBRES  │  │ 💰 FINANCES │
│ 12 à fact.  │  │ 3 réinscr.  │  │ 2 450€ à    │
│ 2 erreurs   │  │ 1 échéance  │  │   poster    │
└─────────────┘  └─────────────┘  └─────────────┘
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ 🛠️ ACTIFS   │  │ 📋 COMITÉS  │  │ ⚠️ ALERTES  │
│ 3 révisions │  │ 2 dépasse.  │  │ Sync Planche│
│ 1 HS        │  │  de budget  │  │  échoué     │
└─────────────┘  └─────────────┘  └─────────────┘
──────────────────────────────────────────────────
ACTIVITÉ RÉCENTE
• 5 vols facturés hier (2 300 €) ...
```

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 2.1 | KpiCard (6 thèmes : vols, membres, finances, actifs, comités, alertes) + données mockées | `dashboard/components/KpiCard.tsx` | 🟢 |
| 2.2 | KpiStrip horizontal (total par statut) | `dashboard/components/KpiStrip.tsx` | 🟢 |
| 2.3 | RecentActivity (timeline feed) | `dashboard/components/RecentActivity.tsx` | 🟢 |
| 2.4 | DashboardPage avec PageHeader | `dashboard/components/DashboardPage.tsx` | 🟢 |
| 2.5 | Chaque KPI cliquable → liste filtrée | `dashboard/components/KpiCard.tsx` | 🟢 |

---

### Phase 3 — Membres + Comités + Portail (semaine 4-7) — 🟢 MVP

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 3.1 | Formulaire membre complet | `members/components/MemberFormPage.tsx` | 🟢 |
| 3.2 | Workspace : logbook, balance, packs | `members/components/MemberWorkspaceShell.tsx` | 🟢 |
| 3.3 | Tab Packs (solde, historique conso) | `members/components/MemberPacksTab.tsx` | 🟢 |
| 3.4 | Selecteur membre + boutons Modifier/Portail | `members/components/MemberWorkspaceShell.tsx` | 🟢 |
| 3.5 | **Créer module committees/ + pages** | `committees/` | 🟢 |
| 3.6 | Vue budget (jauge, historique) | `committees/components/CommitteeBudget.tsx` | 🟢 |
| 3.7 | Workflow validation dépense président | `committees/components/ExpenseApproval.tsx` | 🟢 |
| 3.8 | Portail : réconciliation packages/ui | `member-portal/components/` | 🟢 |
| 3.9 | Portail : login, logbook, solde, packs | `member-portal/pages/` | 🟢 |
| 3.10 | RGPD consent checkbox formulaire membre | `members/components/MemberFormPage.tsx` | 🔵 |
| 3.11 | Bouton anonymiser (Admin) | `members/components/MemberWorkspaceShell.tsx` | 🔵 |
| 3.12 | **DB : member_expenses table, committee budget fields** | `deploy/migrations/` | 🟢 |

---

### Phase 4 — Sales (semaine 7-8) — 🟢 MVP

**Objectif** : Page ventes aux membres (reprend OpsSalesTab de l'ancien Pointage).

> **Note :** La **définition** des packs (`/banque/packs`) relève du pricing → traitée en Phase 5 (Assets). La **vente** (achat/consommation) d'un pack reste dans Sales (PackPurchaseForm). L'**historique** d'utilisation des packs (ex-OpsPacksTab) va dans Assets.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 4.1 | SalesPage (ventes : article → écriture → compte) | `sales/components/SalesPage.tsx` | 🟢 |
| 4.2 | SalesForm (membre, article, montant, paiement) | `sales/components/SalesForm.tsx` | 🟢 |
| 4.3 | SalesHistory (filtres date, membre, statut) | `sales/components/SalesHistory.tsx` | 🟢 |
| 4.4 | PackPurchaseForm (achat → crédit compte) | `sales/components/PackPurchaseForm.tsx` | 🟢 |
| 4.5 | Routes + navigation | `frontend/src/App.tsx` | 🟢 |

---

### Phase 5 — Assets + Pricing + Maintenance (semaine 8-10) — 🟢 MVP

**Objectif** : Gestion de flotte, tarifs (opération annuelle), packs (définition), maintenance.

> **Note :** Les packs sont une **définition de tarifs** (prix forfaitaire), pas une opération quotidienne. La page `/banque/packs` est déplacée ici comme partie du pricing. L'utilisation des packs (consommation, suivi) est distincte et vient de l'ex-OpsPacksTab.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 5.1 | AssetFormPage complète | `assets/components/AssetFormPage.tsx` | 🟢 |
| 5.2 | AssetPricingPage | `assets/components/AssetPricingPage.tsx` | 🟢 |
| 5.3 | AssetPacksTab | `assets/components/AssetPacksTab.tsx` | 🟢 |
| 5.4 | **PackDefinitionsPage** (page `/banque/packs`) — définition des packs (tarifs forfaitaires, opération annuelle) | `banque/components/PackDefinitionsPage.tsx` | 🟢 |
| 5.5 | **AssetPackUsage** (ex-OpsPacksTab) — suivi consommation des packs par asset/membre | `assets/components/AssetPackUsage.tsx` | 🟢 |
| 5.5 | AssetStatusManager (liste + statut + transition) | `assets/components/AssetStatusManager.tsx` | 🟢 |
| 5.6 | AssetStatusManager (liste + statut + transition) | `assets/components/AssetStatusManager.tsx` | 🟢 |
| 5.7 | **AssetMaintenanceLog (journal interventions)** | `assets/components/AssetMaintenanceLog.tsx` | 🟢 |
| 5.8 | Calcul échéances auto (100h, etc.) | `assets/api/maintenance.ts` | 🔵 |
| 5.9 | VI Types consolidation | `assets/components/ViTypeList.tsx` | 🟢 |
| 5.10 | Planche sync : push assets | `planche/api/sync.ts` | 🟢 |
| 5.11 | **DB : maintenance_log table** | `deploy/migrations/` | 🟢 |

---

### Phase 6 — HelloAsso Consolidation (semaine 10-11) — 🟢 MVP

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 6.1 | Fusion pages HelloAsso VI + membres | `helloasso/components/HelloAssoPurchasesPage.tsx` | 🟢 |
| 6.2 | Intégration : connexion, mapping compta | `helloasso/components/HelloAssoIntegrationPage.tsx` | 🟢 |
| 6.3 | VI import finalisation billets | `helloasso/components/HelloAssoViImportPage.tsx` | 🟢 |
| 6.4 | Mapping type achat → compte PCG | `helloasso/components/MappingSetup.tsx` | 🟢 |

---

### Phase 7 — Flights Cockpit (semaine 11-13) — 🟢 MVP

**Objectif** : Cockpit de facturation unique. L'ex-OpsFlightsTab (doublon dans l'ancien Pointage) est fusionné ici — une seule page pour les vols, pas de duplication.

> **Note :** Le cockpit Vols est l'unique page pour la facturation des vols. L'OpsFlightsTab de l'ancien Pointage est supprimé (contenu fusionné). Les 2 cas d'usage (facturation quotidienne + historique) sont gérés par les onglets de statut (pending→posted) et le filtre de date.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 7.1 | Pull Planche automatique | `planche/api/sync.ts` | 🟢 |
| 7.2 | Onglets statut (pending→reversed) | `flights/components/FlightsPage.tsx` | 🟢 |
| 7.3 | KPI strip (montant total, nb vols) | `flights/components/FlightsPage.tsx` | 🟢 |
| 7.4 | Actions batch (apply billing, post) | `flights/components/FlightsPage.tsx` | 🟢 |
| 7.5 | Lignes expansibles (détail tarifaire) | `flights/components/FlightsPage.tsx` | 🟢 |
| 7.6 | Badge reversed (rouge barré) + filtre | `flights/components/FlightsPage.tsx` | 🟢 |
| 7.7 | Reversal dialog (Admin/Accountant) | `flights/components/FlightReversalDialog.tsx` | 🟢 |
| 7.8 | Édition inline charge_to | `flights/components/FlightsPage.tsx` | 🟢 |
| 7.9 | Indicateur erreur (charge_to manquant) | `flights/components/FlightsPage.tsx` | 🟢 |
| 7.10 | Preview modal avant application | `flights/components/PreviewModal.tsx` | 🟢 |
| 7.11 | Audit panel par vol | `flights/components/FlightAuditPanel.tsx` | 🔵 |
| 7.12 | **DB : validated_flights audit columns** | `deploy/migrations/` | 🟢 |

---

### Phase 8 — Finance (semaine 13-15) — 🟢 MVP

**Objectif** : Plan comptable, écritures, journal, ventes, fournisseurs, rapports.

> **Note :** Les pages « Ventes » et « Fournisseurs » étaient les tabs OpsSalesTab et OpsSupplierTab de l'ancien Pointage. Elles deviennent des pages autonomes dans Finance.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 8.1 | PCG finalisé | `banque/components/PcgPage.tsx` | 🟢 |
| 8.2 | Saisie écritures (crédit/débit, TVA) | `banque/components/BanqueJournalEntryWorkspacePage.tsx` | 🟢 |
| 8.3 | Journal (chronologique, filtres) | `banque/components/BanqueJournalEntriesPage.tsx` | 🟢 |
| 8.4 | Grand-livre par compte + solde cumulé | `banque/components/BanqueLedgerPage.tsx` | 🟢 |
| 8.5 | Balance comptable par exercice | `banque/components/BanqueBalancePage.tsx` | 🟢 |
| 8.6 | **Page Ventes** (ex-OpsSalesTab) — listing ventes, filtres | `banque/components/BanqueSalesPage.tsx` | 🟢 |
| 8.7 | **Page Fournisseurs** (ex-OpsSupplierTab) — factures fournisseurs | `banque/components/BanqueSupplierPage.tsx` | 🟢 |
| 8.8 | Reporting module (KPI + graphiques) | `reporting/` | 🟢 |
| 8.9 | FiscalYearProvider (localStorage wrapper) | `shell/contexts/FiscalYearProvider.tsx` | 🟢 |
| 8.10 | Templates écritures (abonnements) | `banque/components/BanqueJournalTemplatesPage.tsx` | 🔵 |

---

### Phase 9 — Bank Reconciliation + Suppliers (semaine 15-16) — 🔵 Next

| # | Action | Fichiers |
|---|--------|----------|
| 9.1 | SupplierInvoicePage navigation autonome | `banque/components/SupplierInvoicePage.tsx` |
| 9.2 | Bank Reconciliation page (import relevé → matching → résolution) | `banque/components/ReconciliationPage.tsx` |
| 9.3 | Matching auto + manuel | `banque/components/ReconciliationPage.tsx` |
| 9.4 | Rapport rapprochement (PDF) | `banque/api/reconciliation.ts` |

---

### Phase 10 — Gesasso & OSRT (semaine 16-17) — 🔵 Next

| # | Action | Fichiers |
|---|--------|----------|
| 10.1 | GesassoSyncPage (dashboard envois, historique) | `integrations/components/GesassoSyncPage.tsx` |
| 10.2 | OsrtSyncPage (dashboard temps machine) | `integrations/components/OsrtSyncPage.tsx` |
| 10.3 | Hooks useGesassoSync / useOsrtSync | `integrations/api/sync.ts` |
| 10.4 | Configuration endpoints | `integrations/components/SyncSettingsPage.tsx` |

---

### Phase 11 — Alerts + Renewals + Expenses (semaine 17-18) — 🔵 Next

| # | Action | Fichiers |
|---|--------|----------|
| 11.1 | Hook useAlerts (TanStack Query + polling 5min) | `daily-ops/api/alerts.ts` |
| 11.2 | AlertsBanner → composant réel | `daily-ops/components/AlertsBanner.tsx` |
| 11.3 | AlertsPage (liste + acquittement + report) | `daily-ops/components/AlertsPage.tsx` |
| 11.4 | Réinscription en ligne (HelloAsso) | `member-portal/pages/RenewalPage.tsx` |
| 11.5 | Email notification avant échéance | `member-portal/api/renewal.ts` |
| 11.6 | Volunteer Expenses (notes de frais) | `members/components/MemberExpensesTab.tsx` |
| 11.7 | Validation/rejet admin avec remboursement | `members/components/MemberExpensesTab.tsx` |

---

### Phase 12 — Audit + S3 + Planning + RGPD (semaine 18-19) — 🔵 Next

| # | Action | Fichiers |
|---|--------|----------|
| 12.1 | AuditLogPage + endpoints | `admin/components/AuditLogPage.tsx` |
| 12.2 | S3 Storage config + upload/download | `admin/components/StorageSettings.tsx` |
| 12.3 | Documents tab workspace membre | `members/components/MemberDocumentsTab.tsx` |
| 12.4 | Planning calendrier (jour/semaine/mois) | `planning/components/PlanningPage.tsx` |
| 12.5 | Overlay indisponibilités membres | `planning/api/` |
| 12.6 | Fiscal déclaration annuelle + preuve | `members/components/MemberFiscalTab.tsx` |
| 12.7 | Export RGPD portabilité | `member-portal/api/export.ts` |
| 12.8 | **DB : member_availability, member_notifications** | `deploy/migrations/` |

---

### Phase 13 — Cleanup (semaine 19-20) — ⚪ Cleanup

| # | Action | Fichiers | Condition |
|---|--------|----------|-----------|
| 13.1 | `grep -r` pour chaque module candidat suppression | — | Aucune référence |
| 13.2 | Supprimer pricing/ | `modules/pricing/` | Vérifié |
| 13.3 | Supprimer vi/ | `modules/vi/` | Vérifié |
| 13.4 | Supprimer storage/ | `modules/storage/` | Vérifié |
| 13.5 | Supprimer club/ | `modules/club/` | Vérifié |
| 13.6 | Supprimer daily-ops/ (contenu migré Phase 11) | `modules/daily-ops/` | Vérifié |
| 13.7 | Supprimer OpsTabs résiduels (OpsFlightsTab, OpsSalesTab, OpsPacksTab, OpsSupplierTab) | `banque/components/` | Vérifié Phase 1b |
| 13.8 | Nettoyer clés i18n obsolètes | `packages/i18n/src/resources/` | — |
| 13.9 | Supprimer ré-exports temporaires | `banque/index.ts`, `assets/index.ts` | — |
| 13.10 | Audit final RGPD | tous les modules | — |
| 13.11 | Scripts migration DB finaux | `deploy/migrations/` | — |
| 13.12 | Validation : tsc + build + test toutes routes | — | — |
| 13.10 | Scripts migration DB finaux | `deploy/migrations/` | — |
| 13.11 | Validation : tsc + build + test toutes routes | — | — |

---

## Calendrier

```
Semaine  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20
Phase 0  ██  ← FAITE
Phase 1     ██ ← FAITE
Phase 1b     ███ ← réorganisation pages
Phase 1c      ██ ← FAITE
Phase 2         ██
Phase 3           █████
Phase 4                 ██
Phase 5                   ███
Phase 6                       ██
Phase 7                         ███
Phase 8                            ███
Phase 9                               ██
Phase 10                                ██
Phase 11                                  ██
Phase 12                                    ██
Phase 13                                      ██
```

**MVP (Phases 1-8) : semaines 2-15** · **Next (Phases 9-12) : semaines 15-19** · **Cleanup (Phase 13) : semaine 19-20**

---

## Stratégie de migration

1. **Routes et structure** : Pas de rétrocompatibilité frontend. Mettre à jour tous les imports simultanément.
2. **Scripts DB** : Tout changement de schéma = script SQL versionné up + down dans `deploy/migrations/`.
3. **Données** : Préserver toutes les données existantes. Valeurs par défaut pour nouvelles colonnes.
4. **Feature flags** : Hook `useFeatureFlag(key)` basé sur localStorage pour déploiement progressif.
5. **i18n** : Nouvelles clés ajoutées, anciennes supprimées immédiatement.
6. **Rollback** : Une PR par phase. Migrations DB avec down associé.
7. **Pages de tarifs (pricing, packs)** : Opérations annuelles, pas quotidiennes. Leur UI est simplifiée (pas de workflow complexe, juste CRUD). Placées dans Assets/Pricing, pas dans le flux de travail quotidien.
