# Prompt de migration design — AVAT Club ERP

> À utiliser dans VSCode avec Copilot Chat / Claude Code, avec les deux repos ouverts
> ou accessibles : `club-erp/frontend` (app actuelle) et `ask-create-glow` (maquette Lovable).

---

## Contexte (à fournir en début de session)

Je migre le design de mon application React `club-erp/frontend` (Vite, React 19,
**react-router-dom v7**, Tailwind v4, Zustand, TanStack Query, i18next, package
UI maison `@club-erp/ui`) vers le design d'une maquette générée par Lovable
(`ask-create-glow`, TanStack Start/Router, Tailwind v4, **shadcn/ui**, Recharts).

**État des lieux technique (juin 2026) :**

| Aspect | `club-erp/frontend` | `ask-create-glow` (Lovable) |
|--------|---------------------|-----------------------------|
| React | 19.2.4 | 19.2.0 |
| Routing | react-router-dom 7.14.1 | @tanstack/react-router 1.168.25 |
| CSS | Tailwind v4.2.2, `@theme` custom (inspiration Material 3) | Tailwind v4.2.1, `@theme` OKLCH shadcn |
| UI Components | `@club-erp/ui` (package maison) + `src/components/ui/` (composants locaux basiques) | 44 composants shadcn/ui (New York style) |
| Radix UI | **Aucun** | 21 packages `@radix-ui/*` |
| Alias `@/` | **Aucun** — imports relatifs ou `@club-erp/*` | `@` → `src/` via `vite-tsconfig-paths` |
| Icons | lucide-react 1.8.0 | lucide-react 0.575.0 |
| Charts | Aucun | recharts 2.15.4 |
| Formulaires | Natif / maison | react-hook-form + zod 3.24.2 |
| Toasts | Aucun | sonner 2.0.7 |
| TypeScript | ~6.0.2 | ~5.8.3 |
| i18n | i18next 25 + react-i18next 16 | Aucun (texte FR en dur) |
| shadcn Sidebar | Aucun | Système complet (SidebarProvider, collapsible, etc.) |

**Décisions actées :**
- Le routing reste **react-router-dom v7** (pas de migration vers TanStack Router).
  Tout import/usage de `@tanstack/react-router` dans le code Lovable doit être
  traduit vers `react-router-dom` (`Link`, `useLocation`, `useNavigate`, `NavLink`).
- Adoption de **shadcn/ui** pour les composants de layout et UI génériques.
  `@club-erp/ui` est conservé pour les composants métier sans équivalent shadcn
  (DataTable, FilterBar, StickyActionBar, SearchableSelect, ConfirmationDialog,
  EmptyState, SegmentedButton, ListItem...) — ne pas les supprimer sans vérifier
  qu'un équivalent shadcn couvre le même besoin.
- **Sonner** est adopté pour les toasts (remplace toute gestion existante).
- **Recharts** est adopté pour les graphiques (aucun équivalent existant).
- **react-hook-form + zod** n'est pas adopté — on conserve le système de formulaire existant.
- Les textes FR en dur dans le JSX Lovable doivent tous passer par i18n.
- L'app n'est pas encore déployée → pas de contrainte de coexistence ancien/nouveau
  en production, mais on procède par étapes livrables/testables.
- **Toute migration de page doit conserver la logique métier existante**
  (hooks, appels API, store Zustand, validations, i18n) et ne remplacer QUE la
  couche présentation (JSX/markup/classes/composants UI). Le contenu des pages
  Lovable est générique et doit être challengé page par page contre l'écran
  existant — ne pas copier-coller bêtement.
- **Le portail membre** utilise le path `/member-portal/*` côté club-erp, alors que
  Lovable utilise `/portal/*`. La migration traduit les routes Lovable mais conserve
  le chemin `/member-portal/*` existant (inchangé).

---

## Étape 0 — Socle technique (shadcn + tokens)

### 0.1 — Installer les dépendances manquantes

**Radix UI (21 packages)** — tous absents de `club-erp/frontend`, tous nécessaires :
```
@radix-ui/react-accordion @radix-ui/react-alert-dialog @radix-ui/react-aspect-ratio
@radix-ui/react-avatar @radix-ui/react-checkbox @radix-ui/react-collapsible
@radix-ui/react-context-menu @radix-ui/react-dialog @radix-ui/react-dropdown-menu
@radix-ui/react-hover-card @radix-ui/react-label @radix-ui/react-menubar
@radix-ui/react-navigation-menu @radix-ui/react-popover @radix-ui/react-progress
@radix-ui/react-radio-group @radix-ui/react-scroll-area @radix-ui/react-select
@radix-ui/react-separator @radix-ui/react-slider @radix-ui/react-slot
@radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-toggle
@radix-ui/react-toggle-group @radix-ui/react-tooltip
```

**Autres packages shadcn :**
```
cmdk vaul embla-carousel-react input-otp tw-animate-css
react-day-picker sonner recharts react-resizable-panels
```

**Déjà présents dans club-erp** (vérifier version, ne pas réinstaller) :
```
class-variance-authority (0.7.1)
tailwind-merge (3.5.0)
clsx (2.1.1)
lucide-react (1.8.0)
```

### 0.2 — Configurer l'alias `@/`

`club-erp/frontend` n'a **aucun alias** configuré. Les composants shadcn importent
depuis `@/components/ui/...`, `@/lib/utils`, `@/hooks/...`. Il faut :

1. Ajouter dans `vite.config.ts` :
   ```ts
   resolve: {
     alias: {
       '@': path.resolve(__dirname, 'src'),
     },
   },
   ```
2. Ajouter dans `tsconfig.json` (ou `tsconfig.app.json`) :
   ```json
   "compilerOptions": {
     "paths": {
       "@/*": ["./src/*"]
     },
     "baseUrl": "."
   }
   ```
3. Installer `vite-tsconfig-paths` si besoin (ou utiliser `path` manuellement).

### 0.3 — Créer `components.json`

Le fichier de configuration shadcn est absent. Le créer à la racine de
`club-erp/frontend` :

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

### 0.4 — Fusionner les thèmes CSS

Deux systèmes de tokens coexistent actuellement dans `club-erp/frontend` :

| Fichier | Portée | Espace colorimétrique |
|---------|--------|-----------------------|
| `src/index.css` (via `@theme`) | Custom Material 3 | rgb/hex (#0f172a, etc.) |
| `packages/ui/src/tokens.css` | Design tokens additionnels | rgb/hex |

Le thème Lovable utilise **OKLCH** et définit ~40 variables CSS (`--background`,
`--primary`, `--sidebar-*`, `--chart-*`, `--radius-*`).

**Stratégie de fusion :**
1. Renommer les tokens existants de `src/index.css` en préfixe `--old-*` ou les
   conserver dans un bloc `@theme` séparé pour ne pas casser l'existant.
2. Ajouter le bloc `:root { ... }` complet du thème shadcn (OKLCH) depuis
   `ask-create-glow/src/styles.css`.
3. Ajouter le bloc `.dark { ... }` pour le mode sombre (actuellement inexistant
   dans club-erp).
4. Signaler les conflits : les classes Tailwind actuelles utilisent des noms
   comme `bg-primary`, `text-secondary` qui référencent les anciennes couleurs.
   Remplacer progressivement au fil de la migration des pages (Étape 3).
5. Ajouter `@import "tw-animate-css";` et `@custom-variant dark (...)`.

### 0.5 — Copier les composants shadcn

Copier TOUS les fichiers de `ask-create-glow/src/components/ui/*` (44 fichiers)
vers `club-erp/frontend/src/components/ui/`.

**⚠️ Collisions de noms** — ces fichiers existent déjà dans `club-erp/frontend/src/components/ui/` :
- `alert.tsx` — existe aussi dans `@club-erp/ui/src/alert.tsx`
- `button.tsx` — existe aussi dans `@club-erp/ui/src/button.tsx`
- `card.tsx` — existe localement
- `tabs.tsx` — existe aussi dans `@club-erp/ui/src/tabs.tsx`
- `dialog.tsx` — existe localement (à ne pas confondre avec le `<Dialog>` de shadcn)
- `input.tsx` — existe localement
- `label.tsx` — existe localement

**Règle de résolution :** le composant shadcn remplace le fichier local SAUF si
le fichier local exporte un composant métier sans équivalent (ex: `data-table.tsx`,
`filter-bar.tsx`, `empty-state.tsx`). En cas de doute, placer la version shadcn
et vérifier les imports existants. Les composants `@club-erp/ui` **ne sont pas
touchés** (package séparé).

**Fichiers locaux sans collision** (conservés tels quels) :
`data-table.tsx`, `filter-bar.tsx`, `section-header.tsx`, `sticky-action-bar.tsx`,
`searchable-select.tsx`, `confirmation-dialog.tsx`, `segmented-button.tsx`,
`list-item.tsx`, `empty-state.tsx`, `ImportDialog.tsx`, `PlaceholderPage.tsx`,
`banner.tsx`.

### 0.6 — Créer `src/lib/utils.ts`

Le fichier utilitaire `cn()` (fusion de classes Tailwind) est nécessaire pour
shadcn. Créer depuis `ask-create-glow/src/lib/utils.ts` :
```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### 0.7 — Vérification TypeScript

`club-erp/frontend` utilise TypeScript ~6.0.2 alors que `ask-create-glow` utilise
~5.8.3. Vérifier la compatibilité des types des packages Radix et shadcn avec TS6.
Si des erreurs de type surviennent, utiliser des `// @ts-expect-error` ponctuels ou
des surcharges de types dans un fichier `src/types/shadcn.d.ts`.

---

**Livrable Étape 0 :** build (`pnpm --filter frontend build`) qui passe,
aucune régression visuelle sur l'existant (les nouveaux composants shadcn sont
disponibles mais pas encore utilisés).

---

## Étape 1 — Shell global (sidebar, header, layout)

### 1.1 — Architecture cible

Le système de sidebar shadcn est complexe et implique plusieurs composants :
- `SidebarProvider` (contexte racine, gère l'état collapsed/expand)
- `Sidebar` (conteneur principal avec `collapsible="icon"`)
- `SidebarHeader`, `SidebarContent`, `SidebarFooter` (sections)
- `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent` (groupes de navigation)
- `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuItem` (éléments de menu)
- `SidebarInset` (wrapper du contenu principal, gère la marge)
- `SidebarTrigger` (bouton de toggle)

Ces composants viennent de `ask-create-glow/src/components/ui/sidebar.tsx` et
`use-mobile.tsx` (hook responsable du breakpoint 768px).

### 1.2 — Traduire le routing

Le code Lovable utilise `@tanstack/react-router` (`Link`, `useRouterState`,
`useNavigate`, `createFileRoute`, etc.). Traduire systématiquement vers
`react-router-dom` :

| TanStack Router | react-router-dom |
|----------------|------------------|
| `<Link to="/path">` | `<Link to="/path">` ou `<NavLink to="/path">` |
| `useRouterState().location.pathname` | `useLocation().pathname` |
| `useNavigate()` | `useNavigate()` |
| `useMatchRoute()` | `useMatch()` |
| `navigate({ to: '/path' })` | `navigate('/path')` |

**Détection de route active** dans la sidebar : utiliser
`useLocation().pathname` avec `pathname === to` ou `pathname.startsWith(to + '/')`.

### 1.3 — Remplacer AppShell/Header/Drawer

1. Créer `club-erp/frontend/src/shell/components/AppShell.tsx` basé sur
   `ask-create-glow/src/routes/__root.tsx` (layout racine) + `app-sidebar.tsx` +
   `app-header.tsx`.
2. Le nouveau `AppShell` doit contenir :
   - `<SidebarProvider>` racine
   - `<AppSidebar>` avec la navigation réelle
   - `<SidebarInset>` contenant `<AppHeader>` + `<AlertsBanner>` + `<Outlet />`
   - `<Toaster>` (sonner)
3. Remplacer la structure de menu Lovable (`opsNav`, `opsAdmin`, `memberNav`
   dans `app-sidebar.tsx`) par la structure réelle issue de
   `club-erp/frontend/src/shell/navigation.ts` (qui reflète les vraies routes
   définies dans `App.tsx`), en appliquant le style/layout shadcn.
4. La navigation Lovable a 2 variantes (Opérations vs Membre) — club-erp a un
   système de capabilities plus fin (Admin → tout, Staff → opérations, Member →
   limité). Adapter le menu pour n'afficher que les items permis par le rôle
   connecté.
5. **Header** : intégrer la recherche Lovable (« Rechercher un membre, un vol… »)
   comme fonctionnalité optionnelle (non liée à une API existante pour l'instant).
   Le sélecteur de rôle (Operations/Member) peut être conservé comme
   shortcut UI mais la vérification réelle se fait via l'auth existante.
6. **AlertsBanner** : réintégrer sous le header mais au-dessus de `<Outlet />`,
   en conservant son comportement actuel (API, polling, dismissal).

### 1.4 — Gestion des routes du portail membre

- Lovable utilise le path `/portal/*` pour le portail membre.
- **club-erp utilise `/member-portal/*`** — conserver ce chemin existant.
- Le layout du portail (`PortalShell.tsx`) a sa propre structure, distincte du
  shell principal. Ne pas le fusionner avec `AppShell` — les adapter
  indépendamment (voir Étape 3.7).

### 1.5 — Role context

`ask-create-glow/src/lib/role-context.tsx` fournit un `RoleProvider` basique
(state React, pas de persistance). Côté club-erp, l'authentification et les
rôles sont gérés par l'API (JWT, capabilities). **Ne pas adopter** le
`RoleProvider` Lovable — le remplacer par le contexte d'auth existant
(`@club-erp/api-client` / store auth).

---

**Livrable Étape 1 :** l'app entière tourne avec le nouveau layout général
(sidebar + header shadcn), toutes les pages existantes s'affichent dans
`<Outlet />` sans modification de leur contenu interne. Tester la navigation
sur toutes les routes principales (y compris `/member-portal/*`).

---

## Étape 2 — Composants transverses (page-header, KPI cards, section-header)

### 2.1 — PageHeader

Remplacer `@club-erp/ui/src/page-header.tsx` et
`club-erp/frontend/src/components/ui/section-header.tsx` par
`ask-create-glow/src/components/page-header.tsx`.

**API Lovable** :
```ts
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}
```

**API existante (@club-erp/ui)** : vérifier les props actuelles et adapter chaque
page consommatrice ou enrober le nouveau composant pour matcher l'ancienne API
(période de transition). Priorité à ne pas casser les pages avant leur migration
complète (Étape 3).

### 2.2 — KpiCard

Adopter `ask-create-glow/src/components/kpi-card.tsx` pour les écrans à
indicateurs :

**API Lovable** :
```ts
interface KpiCardProps {
  label: string;           // Étiquette (ex: "Revenus en attente")
  value: string;           // Valeur affichée (ex: "2 450 €")
  hint?: string;           // Sous-texte optionnel
  icon?: LucideIcon;        // Icône Lucide
  trend?: { value: string; positive?: boolean };  // Tendance
  accent?: "default" | "success" | "warning" | "destructive";
}
```

**Pages cibles** :
- `modules/dashboard/components/DashboardPage.tsx`
- `modules/banque/components/BanqueDashboardPage.tsx`
- `modules/members/components/MemberKpiStrip.tsx`

### 2.3 — Chart (Recharts)

Le composant `ask-create-glow/src/components/ui/chart.tsx` est un wrapper
shadcn autour de Recharts. Il peut être adopté pour les graphiques dans :
- Dashboard (graphiques de revenus/vols)
- Finance (graphiques de trésorerie)
- Reporting

---

**Livrable Étape 2 :** composants transverses migrés et utilisés au moins sur
le dashboard principal (préparation Étape 3.1).

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
5. Ne pas adopter **react-hook-form + zod** de Lovable — conserver le système
   de formulaire existant. Les formulaires Lovable ne servent que de référence
   visuelle (layout des champs, grilles, spacing).
6. Vérifier i18n : tout texte en dur dans le JSX Lovable doit passer par
   `useTranslation()` / clés existantes dans `@club-erp/i18n` (ajouter les
   clés manquantes).
7. Tester la page : rendu, responsive, actions fonctionnelles inchangées.

**Ordre de traitement** (du plus simple au plus complexe) :

| # | Module / pages existantes | Page(s) Lovable de référence | Notes |
|---|---|---|---|
| 3.1 | `modules/dashboard/components/DashboardPage.tsx` | `routes/index.tsx` (DailyOps) | Pilote : peu de logique, beaucoup de KPI/charts. Lovable affiche 4 KPI cards + actions — challenger contre les vrais indicateurs du dashboard |
| 3.2 | `modules/members/components/MembersListPage.tsx`, `MemberFormPage.tsx`, `MemberWorkspaceShell.tsx`, `MemberPilotSheetPage.tsx`, `CommitteesManagementPage.tsx`, `MemberSheetsPage.tsx` | `routes/members.tsx` | Plusieurs écrans à dériver d'une seule page Lovable — challenger fortement le contenu (Lovable est un tableau + stats très générique) |
| 3.3 | `modules/planning/components/PlanningPage.tsx` | `routes/planning.tsx` | Vérifier si la page Lovable apporte une structure calendrier exploitable |
| 3.4 | `modules/assets/components/*` (Assets*, AssetTypes, AssetPricing) + `modules/vi/components/*` | `routes/assets.tsx` | Page Lovable unique à décliner en plusieurs écrans (liste, détail, types, pricing, VI) |
| 3.5 | `modules/flights/components/FlightsPage.tsx`, `modules/discovery/components/*` (si existant) | `routes/discovery.tsx` (Vols d'initiation) + `routes/assets.tsx` (utilisation appareils) | Lovable a une page dédiée `discovery.tsx` pour les "Vols d'initiation". Si `modules/discovery` n'existe pas, utiliser uniquement le style de layout (cartes, timeline). Pour les vols classiques, design ad hoc depuis `assets.tsx` / `planning.tsx` |
| 3.6 | `modules/banque/components/*` (25+ écrans : dashboard, journal, journal entry workspace, templates, COA, PCG, fiscal years, pricing, pricing version edit, reports, daily ops, member bulk billing, supplier invoice, pack definitions) | `routes/finance.tsx`, `routes/sales.tsx`, `routes/pricing.tsx`, `routes/reporting.tsx` | **Lot le plus lourd** — découper en sous-lots par sous-module (ex: 3.6a journal, 3.6b pricing, 3.6c reports, 3.6d daily-ops/billing). Les pages Lovable sont des dashboards génériques : décomposer leur structure visuelle en plusieurs écrans réels, ne pas chercher une correspondance 1:1 |
| 3.7 | `modules/member-portal/pages/*` (Dashboard, Flights, Account, Expenses, Logbook, Workspace) + `PortalShell.tsx` | `routes/portal.tsx`, `portal.index.tsx`, `portal.account.tsx`, `portal.availability.tsx`, `portal.logbook.tsx`, `portal.packs.tsx` | Portail séparé, son propre shell. **Attention au path** : Lovable utilise `/portal/*`, club-erp utilise `/member-portal/*`. Traduire les liens mais conserver `/member-portal/*`. Challenger le layout `PortalShell` avec celui de `routes/portal.tsx` |
| 3.8 | `modules/planche/components/*`, `modules/helloasso/components/*` | `routes/integrations.tsx` | Pages très spécifiques métier — Lovable est générique, s'en inspirer pour le style de cards/listes uniquement |
| 3.9 | `modules/admin/components/AdminPage.tsx`, `modules/storage/components/StorageSettingsPage.tsx` | `routes/administration.tsx` | |

---

## Étape 4 — Nettoyage final

1. Identifier et supprimer les composants `@club-erp/ui` / anciens
   `components/ui/*` devenus inutilisés (grep des imports).
2. Supprimer `packages/ui/src/tokens.css` si ses tokens sont remplacés par
   le thème shadcn (vérifier les imports résiduels).
3. Vérifier qu'aucun texte en dur (FR codé en dur depuis Lovable) ne subsiste
   hors i18n — une revue exhaustive de tous les JSX migrés est nécessaire.
4. Audit responsive (mobile/tablette) sur les pages migrées, en particulier
   sidebar (mode collapsed, breakpoint 768px via `useIsMobile`) et
   tables/DataTable (scroll horizontal).
5. Vérifier qu'aucun import résiduel de `@tanstack/react-router` ne subsiste
   (la moindre occurrence cassera le build).
6. Vérifier que tous les imports `@/components/...` pointent bien vers
   `src/components/...` via l'alias — pas d'import relatif cassé.
7. Vérifier que `components.json` est cohérent avec l'état final des alias
   et du fichier CSS.
8. Nettoyer les dépendances `@radix-ui/*` ou autres devenues inutilisées.

---

## Consignes générales pour l'assistant pendant l'exécution

- Avant de modifier une page, lister les hooks/données/handlers utilisés
  (TanStack Query, Zustand store, fonctions d'API de `modules/*/api/index.ts`)
  pour s'assurer qu'ils sont tous réintégrés après migration.
- Ne jamais supprimer une fonctionnalité existante (filtre, action, colonne
  de table, validation, bouton) au prétexte qu'elle n'apparaît pas dans la
  maquette Lovable — signaler l'écart et demander confirmation avant suppression.
- Les alias `@/` utilisés par shadcn doivent être fonctionnels avant toute
  migration de page. Vérifier que le build passe avec `pnpm --filter frontend build`.
- Les composants shadcn copiés peuvent référencer `@/lib/utils`, `@/hooks/use-mobile`,
  `@/components/ui/...` — ces dépendances doivent être résolues avant l'Étape 1.
- La maquette Lovable utilise **du texte FR en dur** partout. Ne pas copier ces
  textes — les remplacer par les clés i18n existantes ou en créer de nouvelles.
- Les imports `@tanstack/react-router` dans les composants Lovable (sidebar, header,
  routes) doivent être systématiquement convertis en `react-router-dom`.
- **Ne pas adopter react-hook-form/zod** des formulaires Lovable — le système de
  formulaire existant est conservé. Les formulaires Lovable sont une référence
  visuelle uniquement.
- Le `RoleProvider` Lovable (contexte React simple) est à ignorer — utiliser
  le système d'auth/capabilities existant.
- Pour chaque page migrée, produire un court résumé : composants remplacés,
  composants conservés, écarts fonctionnels identifiés entre Lovable et l'existant,
  points à valider.
- Travailler module par module, un commit/PR par sous-lot pour faciliter la revue.
- Attention à la différence de version TypeScript (~6.0 vs ~5.8) — des erreurs de
  type peuvent survenir sur les packages Radix. Les signaler sans bloquer la
  migration (solution : `// @ts-expect-error` ou déclaration de types).
