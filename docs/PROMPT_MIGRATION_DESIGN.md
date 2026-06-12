# Prompt de migration design — AVAT Club ERP

> À utiliser dans VSCode avec Copilot Chat / Claude Code, avec les deux repos ouverts
> ou accessibles : `club-erp/frontend` (app actuelle) et `ask-create-glow` (maquette Lovable).

---

## Contexte (à fournir en début de session)

Je migre le design de mon application React `club-erp/frontend` (Vite, React 19,
**react-router-dom v7**, Tailwind v4, Zustand, TanStack Query, i18next, package
UI maison `@club-erp/ui`) vers le design d'une maquette générée par Lovable
(`ask-create-glow`, TanStack Start/Router, Tailwind v4, **shadcn/ui**, Recharts).

**Décisions actées :**
- Le routing reste **react-router-dom v7** (pas de migration vers TanStack Router).
  Tout import/usage de `@tanstack/react-router` dans le code Lovable doit être
  traduit vers `react-router-dom` (`Link`, `useLocation`, `useNavigate`, `NavLink`).
- Adoption de **shadcn/ui** pour les composants de layout et UI génériques.
  `@club-erp/ui` est conservé pour les composants métier sans équivalent shadcn
  (DataTable, FilterBar, StickyActionBar, SearchableSelect, ConfirmationDialog,
  EmptyState, SegmentedButton, ListItem...) — ne pas les supprimer sans vérifier
  qu'un équivalent shadcn couvre le même besoin.
- L'app n'est pas encore déployée → pas de contrainte de coexistence ancien/nouveau
  en production, mais on procède par étapes livrables/testables.
- **Toute migration de page doit conserver la logique métier existante**
  (hooks, appels API, store Zustand, validations, i18n) et ne remplacer QUE la
  couche présentation (JSX/markup/classes/composants UI). Le contenu des pages
  Lovable est générique et doit être challengé page par page contre l'écran
  existant — ne pas copier-coller bêtement.

---

## Étape 0 — Socle technique (shadcn + tokens)

1. Installer les dépendances Radix/shadcn manquantes dans `club-erp/frontend`
   (comparer `ask-create-glow/package.json` vs `club-erp/frontend/package.json`,
   n'ajouter que ce qui manque : `@radix-ui/react-*`, `cmdk`, `vaul`,
   `embla-carousel-react`, `input-otp`, `tw-animate-css`, `class-variance-authority`
   si absent, etc.)
2. Copier `ask-create-glow/src/styles.css` (thème `@theme inline`, variables
   `--background`, `--primary`, `--sidebar-*`, `--chart-*` en oklch) et fusionner
   avec `club-erp/frontend/src/index.css` sans casser les classes/tokens déjà
   utilisés par l'app actuelle. Signaler les conflits de tokens existants.
3. Copier tous les fichiers de `ask-create-glow/src/components/ui/*` (composants
   shadcn) vers `club-erp/frontend/src/components/ui/`, en évitant les collisions
   de nom avec les fichiers `@club-erp/ui` déjà présents dans
   `club-erp/frontend/src/components/ui/` (ex: `alert.tsx`, `button.tsx`, `tabs.tsx`,
   `dialog.tsx`, `input.tsx`, `label.tsx` existent déjà localement — comparer et
   décider lequel garder, ou les placer dans un sous-dossier `shadcn/`).
4. Vérifier `components.json` (config shadcn) et adapter les alias d'import
   (`@/components/ui/...`) à la config `tsconfig`/`vite.config.ts` de
   `club-erp/frontend`.

Livrable : build qui passe, aucune régression visuelle sur l'existant (les
nouveaux composants shadcn sont disponibles mais pas encore utilisés).

---

## Étape 1 — Shell global (sidebar, header, layout)

1. Remplacer `club-erp/frontend/src/shell/components/AppShell.tsx`,
   `Header.tsx`, `Drawer.tsx` par une nouvelle implémentation basée sur
   `ask-create-glow/src/components/app-sidebar.tsx` et `app-header.tsx`.
2. **Traduire le routing** : remplacer tous les `Link`/`useRouterState` de
   `@tanstack/react-router` par `Link`/`NavLink`/`useLocation` de
   `react-router-dom`. La détection de route active (`pathname === url` ou
   `startsWith`) doit utiliser `useLocation().pathname`.
3. Remplacer la structure de menu Lovable (`opsNav`, `opsAdmin`, `memberNav`
   dans `app-sidebar.tsx`) par la structure réelle issue de
   `club-erp/frontend/src/shell/navigation.ts` (qui reflète les vraies routes
   définies dans `App.tsx`), en appliquant le style/layout shadcn `Sidebar*`
   (composants `Sidebar`, `SidebarContent`, `SidebarGroup`, `SidebarMenu`,
   `SidebarMenuButton`...).
4. Réintégrer `AlertsBanner.tsx` (existant) dans le nouveau header ou en zone
   dédiée sous le header, en conservant son comportement actuel.
5. Conserver le `role-context` (`useRole`) de Lovable s'il correspond à une
   notion existante côté club-erp (sinon l'ignorer/adapter à l'auth existante
   `@club-erp/auth` / `auth/store`).

Livrable : l'app entière tourne avec le nouveau layout général (sidebar +
header shadcn), toutes les pages existantes s'affichent dans `<Outlet />`
sans modification de leur contenu interne. Tester la navigation sur toutes
les routes principales.

---

## Étape 2 — Composants transverses (page-header, KPI cards, section-header)

1. Remplacer `club-erp/frontend/src/components/ui/section-header.tsx` (et
   l'équivalent `@club-erp/ui/page-header.tsx`) par
   `ask-create-glow/src/components/page-header.tsx`, en gardant la même API
   (props) que possible pour limiter les changements dans les pages
   consommatrices — sinon adapter chaque usage.
2. Adopter `ask-create-glow/src/components/kpi-card.tsx` pour les écrans à
   indicateurs : `modules/dashboard/components/DashboardPage.tsx`,
   `modules/banque/components/BanqueDashboardPage.tsx`,
   `modules/members/components/MemberKpiStrip.tsx`.

Livrable : composants transverses migrés et utilisés au moins sur le
dashboard principal (préparation étape 3.1).

---

## Étape 3 — Migration des pages, module par module

**Méthode pour chaque page** :
1. Ouvrir la page Lovable correspondante (`ask-create-glow/src/routes/*.tsx`)
   et la page existante (`club-erp/frontend/src/modules/.../components/*.tsx`).
2. Identifier dans la version existante : hooks de données (React Query),
   store Zustand, handlers d'action, validations, i18n, routes/liens internes,
   composants `@club-erp/ui` utilisés.
3. Reconstruire le JSX en suivant la structure visuelle/layout Lovable
   (grilles, cards, espacements, composants shadcn), en réinjectant les
   données et handlers réels de la version existante.
4. Remplacer les composants `@club-erp/ui` par leur équivalent shadcn
   **uniquement si un équivalent existe et couvre le besoin** (Button, Card,
   Tabs, Dialog, Input, Label, Badge, Select...). Garder DataTable,
   FilterBar, StickyActionBar, SearchableSelect, EmptyState,
   ConfirmationDialog, SegmentedButton, ListItem tels quels (juste restylés
   si besoin via classes Tailwind/tokens).
5. Vérifier i18n : tout texte en dur dans le JSX Lovable doit passer par
   `useTranslation()` / clés existantes dans `@club-erp/i18n` (ajouter les
   clés manquantes).
6. Tester la page : rendu, responsive, actions fonctionnelles inchangées.

**Ordre de traitement** (du plus simple au plus complexe) :

| # | Module / pages existantes | Page(s) Lovable de référence | Notes |
|---|---|---|---|
| 3.1 | `modules/dashboard/components/DashboardPage.tsx` | `routes/index.tsx` | Pilote : peu de logique, beaucoup de KPI/charts |
| 3.2 | `modules/members/components/MembersListPage.tsx`, `MemberFormPage.tsx`, `MemberWorkspaceShell.tsx`, `MemberPilotSheetPage.tsx`, `CommitteesManagementPage.tsx`, `MemberSheetsPage.tsx` | `routes/members.tsx` | Plusieurs écrans à dériver d'une seule page Lovable — challenger fortement le contenu |
| 3.3 | `modules/planning/components/PlanningPage.tsx` | `routes/planning.tsx` | |
| 3.4 | `modules/assets/components/*` (Assets*, AssetTypes, AssetPricing) + `modules/vi/components/*` | `routes/assets.tsx` | Page Lovable unique à décliner en plusieurs écrans (liste, détail, types, pricing, VI) |
| 3.5 | `modules/flights/components/FlightsPage.tsx` | (aucune page Lovable dédiée identifiée — vérifier `discovery.tsx`/`assets.tsx`) | À traiter en dernier de ce lot, design ad hoc si pas d'équivalent |
| 3.6 | `modules/banque/components/*` (25+ écrans : dashboard, journal, journal entry workspace, templates, COA, PCG, fiscal years, pricing, pricing version edit, reports, daily ops, member bulk billing, supplier invoice, pack definitions) | `routes/finance.tsx`, `routes/sales.tsx`, `routes/pricing.tsx`, `routes/reporting.tsx` | **Lot le plus lourd** — découper en sous-lots par sous-module (ex: 3.6a journal, 3.6b pricing, 3.6c reports, 3.6d daily-ops/billing). Les pages Lovable sont des dashboards génériques : décomposer leur structure visuelle en plusieurs écrans réels, ne pas chercher une correspondance 1:1 |
| 3.7 | `modules/member-portal/pages/*` (Dashboard, Flights, Account, Expenses, Logbook, Workspace) + `PortalShell.tsx` | `routes/portal.tsx`, `portal.index.tsx`, `portal.account.tsx`, `portal.availability.tsx`, `portal.logbook.tsx`, `portal.packs.tsx` | Portail séparé, son propre shell — challenger layout `PortalShell` avec celui de `routes/portal.tsx` |
| 3.8 | `modules/planche/components/*`, `modules/helloasso/components/*` | `routes/integrations.tsx` | Pages très spécifiques métier — la page Lovable est générique, s'en inspirer pour le style de cards/listes uniquement |
| 3.9 | `modules/admin/components/AdminPage.tsx`, `modules/storage/components/StorageSettingsPage.tsx` | `routes/administration.tsx` | |

---

## Étape 4 — Nettoyage final

1. Identifier et supprimer les composants `@club-erp/ui` / anciens
   `components/ui/*` devenus inutilisés (grep des imports).
2. Vérifier qu'aucun texte en dur (FR codé en dur depuis Lovable) ne subsiste
   hors i18n.
3. Audit responsive (mobile/tablette) sur les pages migrées, en particulier
   sidebar (mode collapsed) et tables/DataTable.
4. Vérifier qu'aucun import résiduel de `@tanstack/react-router` ne subsiste.

---

## Consignes générales pour l'assistant pendant l'exécution

- Avant de modifier une page, lister les hooks/données/handlers utilisés
  (TanStack Query, Zustand store, fonctions d'API de `modules/*/api/index.ts`)
  pour s'assurer qu'ils sont tous réintégrés après migration.
- Ne jamais supprimer une fonctionnalité existante (filtre, action, colonne
  de table, validation) au prétexte qu'elle n'apparaît pas dans la maquette
  Lovable — signaler l'écart et demander confirmation avant suppression.
- Pour chaque page migrée, produire un court résumé : composants
  remplacés, composants conservés, écarts fonctionnels identifiés entre
  Lovable et l'existant, points à valider.
- Travailler module par module, un commit/PR par sous-lot pour faciliter la
  revue.
