# Plan de Refactoring UI — ERP Club — V3 (Priorités MVP)

> **TL;DR** — Plan refondu par priorités **MVP** puis **Next Step**. L'ordre suit la chaîne de valeur réelle du club : d'abord les membres + leurs opérations (ventes, assets, vols, finance), puis les intégrations avancées et fonctionnalités secondaires. 10 phases, ~20 semaines.

---

## Principes directeurs (fusionnés)

| Principe | Application |
|----------|-------------|
| **Workflow d'abord** | La navigation suit les chaînes de valeur : facturation, trésorerie, suivi membre. |
| **Une seule vérité par écran** | Chaque entité (membre, vol, écriture) dispose d'un espace dédié et complet. |
| **Conserver les noms techniques** | Les dossiers `banque/`, `flights/`, `members/` ne sont pas renommés. Seule la navigation utilisateur (labels + groupes) change. |
| **Capitaliser sur l'existant** | `MemberWorkspaceShell`, `FlightsPage`, `BanqueDailyOpsPage`, `SupplierInvoicePage` etc. sont adaptés/réorganisés, pas réécrits. |
| **Refactoring possible si nécessaire** | Une page existante peut être refactorée (extraction de sous-composants, migration vers `@club-erp/ui`, amélioration a11y, simplification de code) dès qu'elle est modifiée dans le cadre d'une phase — pas de réécriture complète, mais pas de frozen scope non plus. |
| **Suppressions prouvées** | Un module n'est supprimé qu'après vérification `grep` garantissant zéro référence. |
| **Mobile-first pour le portail** | Le portail membre responsive ; l'ERP reste desktop-first avec adaptation tablette. |
| **A11y par défaut** | Navigation clavier, contraste minimum, attributs ARIA, focus visible. |
| **Menu adaptatif aux rôles** | La sidebar et les pages accessibles s'adaptent aux capabilities de l'utilisateur connecté (déjà en place via `requiredCapability` dans `shellNavItems`). |
| **Pas de rétrocompatibilité frontend** | L'application n'étant pas déployée, les routes et structures existantes peuvent être modifiées librement. Aucune redirection 301 ni ré-export temporaire nécessaire. |
| **Migration BD avec préservation des données** | Tout changement de schéma de table doit être accompagné d'un script de migration SQL preservant l'intégrité des données existantes. |
| **RGPD intégré** | Actions d'anonymisation des membres, affichage des audits, visibilité des consentements — intégrées dans l'UX, pas ajoutées après coup. |

---

## Architecture cible

Deux applications partageant le même design system (`packages/ui/`) :

- **ERP Club** → utilisateurs internes (bureau + tablette)
- **Portail Membre** → tous les membres (mobile + desktop)

### Structure technique conservée (pas de renommage)

```
frontend/src/modules/
├── admin/          ← conserve (paramètres système)
├── assets/         ← MVP : création, pricing, packs, sync Planche
├── banque/         ← MVP + Next : ledger, PCG, entries, reports, reconciliation, settings (daily ops éclaté dans flights/sales/assets)
├── club/           ← conservé temporairement
├── dashboard/      ← conserve
├── flights/        ← MVP : planche pull + billing cockpit
├── helloasso/      ← MVP : consolidation VI + achats membres
├── member-portal/  ← MVP : logbook, balance, login
├── members/        ← MVP : directory, creation, workspace (logbook/balance/packs/expenses)
├── planche/        ← MVP : sync flights + assets
├── planning/       ← Next step : vue informative
├── pricing/        ← à absorber par assets/
├── storage/        ← à absorber par admin/
├── vi/             ← à absorber par assets/
├── sales/          ← NOUVEAU : ventes aux membres (standalone)
├── reporting/      ← NOUVEAU (KPI, graphiques)
├── daily-ops/      ← Next step (alerts banner + page)
└── integrations/   ← Next step (Gesasso, OSRT)
```

**Règle** : Aucun déplacement de code d'un module existant vers un nouveau module. Les nouvelles fonctionnalités s'ajoutent dans leur module. Les pages existantes restent dans leurs modules et sont simplement ré-exposées via la nouvelle navigation.

> **Note** : L'application n'étant pas encore déployée en production, les modifications de chemins et de structure sont possibles sans contrainte de rétrocompatibilité. En revanche, les scripts de migration SQL sont obligatoires pour tout changement de schéma.

---

## Navigation cible — ERP Club

Menu latéral **collapsible** structuré par groupes métier. La `Sidebar.tsx` actuelle est déjà générique — seuls `shell/navigation.ts` et les `labelKey` i18n changent.

> **Adaptation aux rôles** : chaque entrée de navigation peut être conditionnée par une `requiredCapability` (ex: `VIEW_FINANCIALS`, `MANAGE_USERS`). Le mécanisme est déjà implémenté dans `Sidebar.tsx` et `Header.tsx` via le filtre sur les capabilities de l'utilisateur connecté. La nouvelle navigation conserve et enrichit ce principe — un membre non-admin ne verra que les sections auxquelles il a accès.

```
📊 Dashboard
──────────────────
👥 Members
├── Directory           → /club/members (exist.)
├── Create member       → /club/members/new (MVP)
├── Member workspace    → /club/members/:uuid/workspace (MVP enrichi)
├── Committees          → /club/commissions (exist.)
├── Sheets              → /club/sheets (exist.)
└── Online renewal      → /member-portal/renewal (Next)

💰 Sales
├── Member Sales        → /sales (MVP — nouvelle page standalone)
└── Supplier Invoices   → /banque/factures-fournisseurs (Next)

🛠️ Assets
├── Fleet               → /assets (MVP enrichi)
├── Asset Types         → /assets/types (MVP)
├── Pricing             → /assets/:uuid/pricing (MVP)
├── Packs               → /banque/packs (MVP)
└── VI Types            → /vi/types (MVP consolidation)

✈️ Flights
├── Flight cockpit      → /flights (MVP billing)
├── Planche sync        → /planche (exist.)
└── Billing history     → /flights/billing (MVP)

🔌 Integrations
├── Planche             → /planche (exist.)
├── HelloAsso           → /helloasso (MVP)
├── Gesasso sync        → /integrations/gesasso (Next)
└── OSRT sync           → /integrations/osrt (Next)

💰 Finance & Accounting
├── Overview            → /banque (MVP)
├── Journal             → /banque/journal (MVP)
├── Chart of Accounts   → /banque/pcg (MVP)
├── Fiscal Years        → /banque/fiscal-years (MVP)
├── Reports             → /banque/reports (MVP)
├── Bank reconciliation → /banque/reconciliation (Next)
└── Settings            → /banque/settings (MVP)

> **Note :** L'ancienne page `/banque/operations` (Daily Ops) est éclatée dans les menus métier : les vols dans ✈️ Flights, les ventes dans 💰 Sales, les packs dans 🛠️ Assets/Pricing, les fournisseurs dans 💰 Sales.

📈 Reporting            → /reporting (Next)

⚙️ Admin
├── Admin               → /admin (exist.)
├── System Settings     → /admin (exist.)
├── Audit Log           → /admin/audit (Next)
└── S3 Storage          → /admin/storage (Next)
```

---

## Design system (évolutif à partir de l'existant)

### État des lieux
- 18 composants UI existants dans `frontend/src/components/ui/` (button, data-table, dialog, tabs, card, input, label, alert, banner, filter-bar, etc.)
- Packages workspace `packages/ui/` créé mais quasi vide

### Actions Phase 0

| # | Action |
|---|--------|
| D0.1 | Peupler `packages/ui/` en y déplaçant les composants génériques depuis `frontend/src/components/ui/` (pour partage ERP + Portail) |
| D0.2 | Ajouter les tokens CSS (couleurs, typographie, espacements) dans `packages/ui/src/tokens.css` |
| D0.3 | Ajouter Storybook pour le catalogue de composants |
| D0.4 | Créer les composants manquants : `Skeleton` (loading), `ErrorBoundary`, `EmptyState` (générique), `PageHeader` (unifié) |
| D0.5 | Audit a11y des composants existants : focus ring, contraste, rôles ARIA |

### Utilisation de Storybook

Storybook est installé dans `packages/ui/` (port 6006). Chaque composant du design system doit avoir une story (`*.stories.tsx`) documentant ses variantes, props, états (loading, empty, error, edge cases).

**Usage recommandé :**
- Lancer `pnpm --filter @club-erp/ui storybook` pour explorer/cataloguer les composants
- Écrire les stories **en parallèle** du développement des composants (pas après)
- L'addon a11y (`@storybook/addon-a11y`) est déjà actif — l'utiliser pour valider l'accessibilité de chaque composant
- Les stories servent de **documentation vivante** et de **support de test visuel** — pas de story = composant non livré
- Pour les phases MVP, prioriser les stories des composants utilisés dans les pages en cours de développement

**Conseil :** Ne pas créer de stories pour les composants internes (propres à un module). Les stories sont réservées aux composants exportés par `@club-erp/ui`.

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

## Workflows clés (formalisés d'après spec)

```
Flight → Accounting :
  Planche → ERP (import) → Preview → Apply → Draft entry (FL) → Post → Posted entry

Member → Portal :
  Create member → HelloAsso purchase → Portal access → Logbook + Balance + Packs

Asset → Planche sync :
  Asset created/priced → Pushed to Planche → Flight import consistency check

Pack lifecycle :
  Pack purchased (HelloAsso) → Credit member account → Flight consumption → REM entry

Bank reconciliation :
  Planche import (bank statement) → Match with posted entries → Flag differences → Manual resolution

RGPD Lifecycle :
  Member resigns → Consent revoked → Anonymize data → Audit log frozen
```

## Cycle de vie de la facturation (formalisé d'après spec §2)

| État | Signification | UI |
|------|--------------|----|
| `pending` | Vol importé de Planche, pas encore facturé | Badge orange |
| `previewed` | Aperçu calculé, pas encore appliqué | Badge bleu clair |
| `applied` | Écriture au brouillon créée (journal FL), pas encore postée | Badge bleu |
| `posted` | Écriture postée (immuable) | Badge vert |
| `reversed` | Annulation + écriture de replacement postée | Badge rouge barré |

## RBAC — Matrice et intégration UI (d'après spec §13)

La sidebar utilise déjà le mécanisme `requiredCapability`. Cette matrice étend le principe à tous les écrans.

| Module / Action | Admin | Comptable | Opérations | Maintenance | Instructeur | Membre |
|----------------|-------|-----------|------------|-------------|-------------|--------|
| Membres - Lecture | ✅ | ✅ | ✅ | ❌ | ✅ | Soi |
| Membres - Écriture | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Assets - Lecture | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Assets - Écriture | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Vols - Lecture | ✅ | ✅ | ✅ | ✅ | ✅ | Soi |
| Vols - Facturation | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Vols - Reversal | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Finance - Écritures | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Finance - Rapports | ✅ | ✅ | ✅ | ❌ | ❌ | Soi |
| Sales - Gérer | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Admin - Configuration | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Intégrations - Gérer | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| RGPD - Anonymisation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Portail - Accès | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

**Implémentation** :
- Route guards : `ProtectedRoute` avec `requiredCapability` (existant, à enrichir)
- Guards composant : hook `useCapability('MANAGE_USERS')` pour masquer/afficher des sections
- Dans les tableaux : masquer les boutons d'action non autorisés

---

## Phases d'implémentation (priorités MVP)

### ▶️ Légende

| Badge | Signification |
|-------|---------------|
| 🟢 **MVP** | Fonctionnalité indispensable au fonctionnement du club |
| 🔵 **Next** | Fonctionnalité importante mais non bloquante |
| ⚪ **Cleanup** | Nettoyage et finalisation |

---

### Phase 0 — Design System & Fondations (semaine 1) — ✅ FAITE

| # | Action | Fichiers | Statut |
|---|--------|----------|--------|
| 0.1 | Peupler `packages/ui/` avec composants partagés + tokens CSS | `packages/ui/src/` | ✅ |
| 0.2 | Installer Storybook, cataloguer les composants existants | `packages/ui/.storybook/` | ✅ |
| 0.3 | Créer `Skeleton`, `ErrorBoundary`, `EmptyState` génériques | `packages/ui/src/` | ✅ |
| 0.4 | Audit a11y : focus ring, contraste, rôles ARIA sur tous les composants | `packages/ui/src/*` | ✅ |
| 0.5 | Ajouter les clés i18n `nav.*` pour la nouvelle navigation (fr + en) | `packages/i18n/src/resources/{fr,en}.ts` | ✅ |
| 0.6 | Réécrire `shell/navigation.ts` — 14 modules → groupes workflow | `frontend/src/shell/navigation.ts` | ✅ |
| 0.7 | Créer les modules vides (`daily-ops/`, `reporting/`, `integrations/`) | `frontend/src/modules/{daily-ops,reporting,integrations}/` | ✅ |

---

### Phase 1 — Navigation & Layout (semaine 2) — 🟢 MVP — ✅ FAITE

| # | Action | Fichiers | Statut |
|---|--------|----------|--------|
| 1.1 | Mettre à jour `App.tsx` — nouvel ordre des routes | `frontend/src/App.tsx` | ✅ |
| 1.2 | Ajouter `AlertsBanner` placeholder dans `AppShell.tsx` | `frontend/src/shell/components/AppShell.tsx` | ✅ |
| 1.3 | Intégrer `PageHeader` unifié (breadcrumbs + titre + actions) | `packages/ui/src/` | ✅ |
| 1.4 | Tests : `tsc --noEmit` + `vite build` + test manuel de chaque lien | — | ⏭️ |

**Sidebar.tsx inchangée** — elle lit déjà `shellNavItems` dynamiquement.

---

### Phase 1b — Menu Définitif & Placeholders (semaine 2-3) — 🟢 MVP

**Objectif** : Rendre le menu définitif fonctionnel à 100 % — toutes les entrées de la navigation cible sont accessibles, même les fonctions pas encore implémentées, via des pages vides génériques. Permet de valider la structure, les capabilities, et de naviguer dans toute l'application dès le début.

| # | Action | Fichiers |
|---|--------|----------|
| 1b.1 | Compléter `navigation.ts` avec **toutes** les entrées du menu définitif (y compris Next/Cleanup) — chaque groupe et sous-groupe de la cible | `frontend/src/shell/navigation.ts` |
| 1b.2 | Créer un composant `PlaceholderPage` réutilisable (titre, description, badge "À venir / Coming soon") | `frontend/src/components/ui/PlaceholderPage.tsx` |
| 1b.3 | Ajouter les routes manquantes dans `App.tsx` (toutes les entrées Next/Cleanup) pointant vers `PlaceholderPage` avec un `requiredCapability` cohérent | `frontend/src/App.tsx` |
| 1b.4 | Vérifier que tous les liens du menu naviguent sans erreur 404 — test manuel de chaque groupe | — |

---

### Phase 1c — Homogénéisation des pages & Tabs (semaine 3) — 🟢 MVP — ✅ FAITE

**Objectif** : Uniformiser la présentation de toutes les pages existantes — PageHeader, breadcrumbs, tabs de navigation interne, layout standard. Chaque page doit ressembler à la cible finale (même si le contenu est encore partiel).

| # | Action | Fichiers | Statut |
|---|--------|----------|--------|
| 1c.1 | Migrer tous les imports `PageHeader` du chemin local `../../../components/ui/page-header` vers `@club-erp/ui` — supprimer l'ancien composant | Toutes les pages + `frontend/src/components/ui/page-header.tsx` | ✅ |
| 1c.2 | Ajouter `PageHeader` (titre + supportingText + breadcrumbs + actions) sur les pages principales (Dashboard, BanqueOverview, Admin) — ajout progressif dans les phases suivantes pour les autres pages | Modules `dashboard`, `banque`, `admin` | ✅ partiel |
| 1c.3 | Normaliser les tabs : ajouter `Tabs` dans `@club-erp/ui`, migrer `AdminPage` (TabButton → Tabs), migrer `MemberWorkspaceShell` dans Phase 2 | `packages/ui/src/tabs.tsx`, `admin/components/AdminPage.tsx` | ✅ |
| 1c.4 | Créer les sous-pages manquantes pour les entrées du menu Next/Cleanup — déjà fait en Phase 1b (PlaceholderPage) | — | ⏭️ fait en 1b |
| 1c.5 | Vérifier la cohérence : `tsc --noEmit` ✅ + `vite build` ✅ + test manuel des pages modifiées | — | ✅ |

---

### Phase 2 — Membres + Portail (semaine 3-5) — 🟢 MVP

**Objectif** : Annuaire membres complet, création, workspace logbook/balance/packs, portail membre.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 2.1 | Améliorer la fiche membre (formulaire création + modification complet) | `members/components/MemberFormPage.tsx` | 🟢 |
| 2.2 | Finaliser le workspace membre : logbook, balance, packs | `members/components/MemberWorkspaceShell.tsx` | 🟢 |
| 2.3 | Ajouter le tab Packs (solde, historique consommation) | `members/components/MemberPacksTab.tsx` | 🟢 |
| 2.4 | Mode club : sélecteur de membre + boutons Modifier / Envoyer accès portail | `members/components/MemberWorkspaceShell.tsx` | 🟢 |
| 2.5 | Réconcilier le portail membre avec `packages/ui/` | `member-portal/components/` | 🟢 |
| 2.6 | Portail : navigation responsive (tabs bas mobile, latéral desktop) | `member-portal/components/PortalShell.tsx` | 🟢 |
| 2.7 | Portail : login, logbook, balance, packs | `member-portal/pages/` | 🟢 |
| 2.8 | Ajouter la case à cocher « Consentement RGPD » dans le formulaire membre | `members/components/MemberFormPage.tsx` | 🔵 |
| 2.9 | Ajouter le bouton « Anonymiser ce membre » (visible Admin) | `members/components/MemberWorkspaceShell.tsx` | 🔵 |

---

### Phase 3 — Sales (semaine 5-6) — 🟢 MVP

**Objectif** : Page ventes aux membres standalone.

> **Note :** La définition des packs (`/banque/packs`) relève du **pricing** — traitée en Phase 4 (Assets). La **vente** (achat/consommation) d'un pack reste dans Sales.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 3.1 | Créer `SalesPage` (ventes aux membres : article → écriture + mise à jour compte) | `sales/components/SalesPage.tsx` | 🟢 |
| 3.2 | Formulaire de vente : sélection membre, article, montant, mode de paiement | `sales/components/SalesForm.tsx` | 🟢 |
| 3.3 | Historique des ventes avec filtres (date, membre, statut) | `sales/components/SalesHistory.tsx` | 🟢 |
| 3.4 | Pack purchase : achat pack → crédit compte membre | `sales/components/PackPurchaseForm.tsx` | 🟢 |
| 3.5 | Routes et navigation | `frontend/src/App.tsx` | 🟢 |

---

### Phase 4 — Assets + Pricing + VI (semaine 6-8) — 🟢 MVP

**Objectif** : Gestion de flotte complète + tarifs (création asset, types, pricing versions, pack definitions, VI types, sync Planche).

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 4.1 | Ajouter la création d'asset (formulaire complet) | `assets/components/AssetFormPage.tsx` | 🟢 |
| 4.2 | Asset pricing : page dédiée par asset | `assets/components/AssetPricingPage.tsx` | 🟢 |
| 4.3 | Asset packs : associer des packs à un asset | `assets/components/AssetPacksTab.tsx` | 🟢 |
| 4.4 | **Pack definitions** (page `/banque/packs`) : lister, créer, éditer les packs — fait partie du pricing, pas des sales | `banque/components/PackDefinitionsPage.tsx` | 🟢 |
| 4.5 | Asset Status Manager : liste de tous les assets avec statut, filtre, transition rapide | `assets/components/AssetStatusManager.tsx` | 🟢 |
| 4.6 | VI Types : consolidation dans assets (transfert depuis `vi/`) | `assets/components/ViTypeList.tsx` | 🟢 |
| 4.7 | Indicateur visuel de statut dans la liste des assets | `assets/components/AssetListPage.tsx` | 🟢 |
| 4.8 | Badge statut dans `FlightDetailDialog` | `banque/components/FlightDetailDialog.tsx` | 🔵 |
| 4.9 | Synchronisation Planche : pousser les assets créés/modifiés | `planche/api/sync.ts` | 🟢 |

---

### Phase 5 — HelloAsso + VI Consolidation (semaine 8-9) — 🟢 MVP

**Objectif** : Interface unifiée des achats HelloAsso (VI + membres), mapping comptable.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 5.1 | Consolider les pages HelloAsso (VI + membres) dans une interface unique | `helloasso/components/HelloAssoPurchasesPage.tsx` | 🟢 |
| 5.2 | Rafraîchir les écrans d'intégration (paramètres connexion, mapping compta) | `helloasso/components/HelloAssoIntegrationPage.tsx` | 🟢 |
| 5.3 | HelloAsso VI import : finaliser l'import des billets VI | `helloasso/components/HelloAssoViImportPage.tsx` | 🟢 |
| 5.4 | Mapping comptable : associer chaque type d'achat à un compte PCG | `helloasso/components/MappingSetup.tsx` | 🟢 |

---

### Phase 6 — Flights — Cockpit Facturation (semaine 10-12) — 🟢 MVP

**Objectif** : Cockpit de facturation complet avec cycle de vie (pending → previewed → applied → posted → reversed), actions batch.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 6.1 | Pull Planche : import automatique des vols depuis Planche | `planche/api/sync.ts` (exist.) | 🟢 |
| 6.2 | Ajouter les onglets de statut (pending/previewed/applied/posted/reversed) | `flights/components/FlightsPage.tsx` | 🟢 |
| 6.3 | Ajouter KPI strip (montant total par statut, nombre de vols) | `flights/components/FlightsPage.tsx` | 🟢 |
| 6.4 | Actions batch (apply billing, post) sur sélection multiple | `flights/components/FlightsPage.tsx` | 🟢 |
| 6.5 | Rendre les lignes expansibles avec détail tarifaire | `flights/components/FlightsPage.tsx` | 🟢 |
| 6.6 | Ajouter l'état `reversed` (badge rouge barré, filtre, lien replacement) | `flights/components/FlightsPage.tsx` | 🟢 |
| 6.7 | Bouton « Reverser » (Admin/Accountant) + dialog de confirmation | `flights/components/FlightReversalDialog.tsx` | 🟢 |
| 6.8 | Panneau d'audit history par vol (timeline changements d'état) | `flights/components/FlightAuditPanel.tsx` | 🔵 |

---

### Phase 7 — Finance — Ledger + PCG + Entries + Reports (semaine 12-14) — 🟢 MVP

**Objectif** : Plan comptable complet, saisie d'écritures, journal, grand-livre, rapports financiers.

| # | Action | Fichiers | Priorité |
|---|--------|----------|----------|
| 7.1 | Finaliser le plan comptable (PCG) : arborescence, comptes par défaut | `banque/components/PcgPage.tsx` | 🟢 |
| 7.2 | Saisie d'écritures : formulaire avec ligne crédit/débit, TVA, contrepartie | `banque/components/BanqueJournalEntryWorkspacePage.tsx` | 🟢 |
| 7.3 | Journal : affichage chronologique, filtres (exercice, période, compte) | `banque/components/BanqueJournalEntriesPage.tsx` | 🟢 |
| 7.4 | Grand-livre : vue par compte avec solde cumulé | `banque/components/BanqueLedgerPage.tsx` | 🟢 |
| 7.5 | Balance : balances comptables par exercice | `banque/components/BanqueBalancePage.tsx` | 🟢 |
| 7.6 | Reports : créer `reporting/` module avec grille KPI + graphiques | `reporting/` | 🟢 |
| 7.7 | Déplacer `FinancialReportsPage` de `banque/` vers `reporting/` | `reporting/components/FinancialReportsPage.tsx` | 🟢 |
| 7.8 | Templates d'écritures (abonnements, virements périodiques) | `banque/components/BanqueJournalTemplatesPage.tsx` | 🔵 |

---

### Phase 8 — Next Step : Intégrations Gesasso & OSRT (semaine 15-16) — 🔵 Next

| # | Action | Fichiers |
|---|--------|----------|
| 8.1 | Page **Gesasso sync** : dashboard envois, historique, file de rattrapage | `integrations/components/GesassoSyncPage.tsx` |
| 8.2 | Page **OSRT sync** : dashboard envois temps machine, historique | `integrations/components/OsrtSyncPage.tsx` |
| 8.3 | Hook `useGesassoSync` / `useOsrtSync` (TanStack Query) | `integrations/api/sync.ts` |
| 8.4 | Page de configuration des endpoints et clés d'API | `integrations/components/SyncSettingsPage.tsx` |
| 8.5 | Alerte automatique en cas d'échec de synchronisation | `integrations/api/sync.ts` |

---

### Phase 9 — Next Step : Suppliers + Bank Reconciliation (semaine 16-18) — 🔵 Next

| # | Action | Fichiers |
|---|--------|----------|
| 9.1 | Wrapper `SupplierInvoicePage` pour navigation autonome | `banque/components/SupplierInvoicePage.tsx` |
| 9.2 | Créer la page **Bank Reconciliation** : import relevé → matching → écart → résolution | `banque/components/ReconciliationPage.tsx` |
| 9.3 | Matching automatique (montant, date, référence) + matching manuel | `banque/components/ReconciliationPage.tsx` |
| 9.4 | Rapport de rapprochement (PDF export) | `banque/api/reconciliation.ts` |

---

### Phase 10 — Next Step : Alerts + Renewals + Volunteer Expenses (semaine 18-19) — 🔵 Next

| # | Action | Fichiers |
|---|--------|----------|
| 10.1 | Créer le hook `useAlerts` (TanStack Query + polling 5min) | `daily-ops/api/alerts.ts` |
| 10.2 | Créer `AlertsBanner` (bandeau permanent dans AppShell) | `daily-ops/components/AlertsBanner.tsx` |
| 10.3 | Créer `AlertsPage` (liste exhaustive + acquittement + report) | `daily-ops/components/AlertsPage.tsx` |
| 10.4 | Intégrer `AlertsBanner` dans `AppShell.tsx` | `shell/components/AppShell.tsx` |
| 10.5 | Module de réinscription en ligne (détection membre, sélection catégorie, paiement HelloAsso) | `member-portal/pages/RenewalPage.tsx` |
| 10.6 | Notification par email avant échéance + lien direct | `member-portal/api/renewal.ts` |
| 10.7 | Implémenter le tab Volunteer Expenses (dépôt note de frais + validation) | `members/components/MemberExpensesTab.tsx` |
| 10.8 | Workflow validation/rejet admin avec auto-remboursement | `members/components/MemberExpensesTab.tsx` |

---

### Phase 11 — Next Step : Audit Log + S3 Storage + Planning + RGPD (semaine 19-20) — 🔵 Next

| # | Action | Fichiers |
|---|--------|----------|
| 11.1 | Audit Log : page dédiée + endpoints API | `admin/components/AuditLogPage.tsx` |
| 11.2 | S3 Storage : config + upload/download documents membres | `admin/components/StorageSettings.tsx` |
| 11.3 | Documents tab dans workspace membre (upload/download S3) | `members/components/MemberDocumentsTab.tsx` |
| 11.4 | Planning : vue calendrier informative (jour/semaine/mois) | `planning/components/PlanningPage.tsx` |
| 11.5 | Overlay indisponibilités membres sur le planning | `planning/api/` |
| 11.6 | Volunteer Fiscal : déclaration annuelle + upload preuve + validation | `members/components/MemberFiscalTab.tsx` |
| 11.7 | Export RGPD (portabilité) dans le portail membre | `member-portal/api/export.ts` |

---

### Phase 12 — Cleanup & Finalisation (semaine 20-21) — ⚪ Cleanup

| # | Action | Fichiers | Condition |
|---|--------|----------|-----------|
| 12.1 | Vérifier `grep -r` pour chaque module candidat à la suppression | — | Aucune référence |
| 12.2 | Supprimer `pricing/` si aucune référence | `frontend/src/modules/pricing/` | Vérifié 12.1 |
| 12.3 | Supprimer `vi/` si aucune référence | `frontend/src/modules/vi/` | Vérifié 12.1 |
| 12.4 | Supprimer `storage/` si aucune référence | `frontend/src/modules/storage/` | Vérifié 12.1 |
| 12.5 | Supprimer `club/` si aucune référence (shell uniquement) | `frontend/src/modules/club/` | Vérifié 12.1 |
| 12.6 | Nettoyer les clés i18n obsolètes | `packages/i18n/src/resources/` | — |
| 12.7 | Supprimer les ré-exports temporaires (si encore présents) | `banque/index.ts`, `assets/index.ts` | — |
| 12.8 | Audit final RGPD | tous les modules | — |
| 12.9 | Générer les scripts de migration DB | `deploy/migrations/` | — |
| 12.10 | Validation finale : `tsc --noEmit` + `vite build` + test toutes les routes | — | — |

---

## Calendrier

```
Semaine  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21
Phase 0  ██  ← ✅ FAITE
Phase 1     ██ ← ✅ FAITE
Phase 1b     ██ ← 🆕
Phase 1c      ██ ← ✅
Phase 2        █████
Phase 3              ██
Phase 4                ███
Phase 5                   ██
Phase 6                     ███
Phase 7                        ███
Phase 8                           ██
Phase 9                             ██
Phase 10                              ██
Phase 11                                ██
Phase 12                                  ██
```

MVP (Phases 1-7) : semaines 2-14 — Phases 0-1 ✅ FAITES · Phases 1b-1c ✅ FAITES
Next (Phases 8-11) : semaines 15-20
Cleanup (Phase 12) : semaines 20-21

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


