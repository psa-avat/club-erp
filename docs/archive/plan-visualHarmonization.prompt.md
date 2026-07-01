# Plan: Harmonisation visuelle des pages — Club ERP

## TL;DR

Audit des 24 pages workspace → **~85% déjà cohérentes** (WorkspaceShell + PageHeader + Tabs + i18n).
Plan en **3 phases** pour atteindre 100% : corrections ciblées sur les 4 pages divergentes, adoption
de ~8 motifs visuels de la maquette Lovable, et ajout d'un conteneur unifié pour toutes les pages.

---

## Audit visuel : état des lieux

### ✅ Pages conformes au pattern standard (20/24)

Toutes suivent : `WorkspaceShell` → `PageHeader` → `Tabs` → contenu des tabs.

| Module | Fichier | Nb tabs |
|--------|---------|---------|
| Flights | `FlightsWorkspacePage.tsx` | 6 |
| Members | `MembersWorkspacePage.tsx` | 4 |
| Banque | `BanqueWorkspacePage.tsx` | 6 |
| Finance | `FinanceWorkspacePage.tsx` | 5 |
| VI | `ViWorkspacePage.tsx` | 6 |
| RH | `RhWorkspacePage.tsx` | 3 |
| Machines | `MachinesWorkspacePage.tsx` | 3 |

### ⚠️ Pages divergentes (4)

| Page | Problème | Gravité |
|------|----------|---------|
| **AdminPage.tsx** (`admin/components/`) | Utilise `PageHeader` + `Tabs` manuels au lieu de `WorkspaceShell` | 🟠 Medium |
| **DashboardPage.tsx** (`dashboard/components/`) | Pas de `WorkspaceShell`, utilise `@club-erp/ui` PageHeader directement | 🟡 Low |
| **PlanningPage.tsx** (`planning/components/`) | Placeholder minimal (section + h1 inline) | 🟡 Low |
| **PricingPage.tsx** (`pricing/components/`) | Formulaire complexe, pas de shell unifié | 🟠 Medium |

### 🎨 Écarts visuels entre club-erp et maquette Lovable

| Aspect | club-erp actuel | Maquette Lovable | Écart |
|--------|----------------|-------------------|-------|
| **Conteneur page** | Aucun wrapper `max-w` dans WorkspaceShell | `mx-auto flex max-w-7xl flex-col gap-6` | WorkspaceShell ne contraint pas la largeur max |
| **Conteneur pages sans tabs** | Pas de wrapper cohérent | `mx-auto flex max-w-7xl flex-col gap-6` | Chaque page définit son propre conteneur |
| **PageHeader** | `mb-6` + WorkspaceShell ajoute `mt-6` sur Tabs | `border-b pb-5` sans marge basse | Double espacement potentiel |
| **En-tête tableau** | Simple `TableHeader` | `border-b px-5 py-3` avec titre, sous-titre, badge + action | club-erp plus minimal (via DataTable) |
| **Empty state** | Composant `EmptyState` (centré avec icône, titre, action) | `border-dashed bg-card h-56 centered` | Similaire mais styles légèrement différents |
| **Bannière info** | Pas de pattern standardisé | `rounded-xl border border-dashed bg-card/50 p-4 flex gap-3` avec icône accent | À adopter |
| **Badges de filtre** | `FilterBar` avec chips | `Badge` cliquables (cursor-pointer, rounded-md) | Approche différente (FilterBar plus riche) |
| **Grille de cartes** | `rounded-xl border bg-card p-5 hover:border-accent/40` | Idem | ✅ Identique |
| **KpiCard** | Idem Lovable (props identiques) | Même composant | ✅ Déjà harmonisé |
| **Couleurs statut** | Variables CSS `--color-success/warning/destructive` | `bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]` | club-erp utilise des classes Tailwind standards |
| **DataTable** | Utilise `border-outline-variant` (ancien token M3) | Utilise `border` (shadcn) | Vieille variable CSS non shadcn |

---

## Phase 1 — Corrections structurelles (pages divergentes)

### 1.1 Refactorer AdminPage → WorkspaceShell

**Fichier**: `frontend/src/modules/admin/components/AdminPage.tsx`

**Actions**:
- Remplacer `PageHeader + Tabs` manuels par `<WorkspaceShell>`
- Migrer le state manuel (`useState<AdminTab>`) vers `useActiveTab()` (URL `?tab=users|roles|capabilities|security`)
- Répartir le contenu des 4 tabs dans `WorkspaceShell.tabs`
- Conserver la grille de cartes dans un tab `administration`
- Bénéfice : liens directs URL, cohérence visuelle, unification

**Dépendances**: Aucune (indépendant)

### 1.2 Normaliser DashboardPage

**Fichier**: `frontend/src/modules/dashboard/components/DashboardPage.tsx`

**Actions**:
- Ajouter le wrapper `mx-auto flex max-w-7xl flex-col gap-6` (sans WorkspaceShell, car dashboard n'a pas de tabs)
- Conserver `PageHeader` (mais depuis `@club-erp/ui`)
- Vérifier que les KPI cards utilisent le composant `KpiCard` (déjà OK)
- Bénéfice : largeur max cohérente avec les autres pages

**Dépendances**: Aucune (indépendant)

### 1.3 Architecture PlanningPage

**Fichier**: `frontend/src/modules/planning/components/PlanningPage.tsx`

**Actions**:
- Implémenter le calendrier d'activité (inspiré de Lovable `routes/planning.tsx`)
- Utiliser `WorkspaceShell` si tabs multiples, sinon wrapper `max-w-7xl` unifié
- Bénéfice : pas de page placeholder visuellement cassée

**Dépendances**: Phase 1.2 (pattern de conteneur)

### 1.4 Architecture PricingPage

**Fichier**: `frontend/src/modules/pricing/components/PricingPage.tsx`

**Actions**:
- Soit intégrer dans `WorkspaceShell` (si multi-tabs : tarifs, packs, versions)
- Soit wrapper `max-w-7xl` si page unique
- Vérifier l'utilisation de `PageHeader`
- Bénéfice : pas de page isolée visuellement

**Dépendances**: Aucune (nécessite décision)

---

## Phase 2 — Adoption des motifs visuels Lovable (harmonisation fine)

*Parallèle avec Phase 1, fichiers indépendants*

### 2.1 Ajouter `max-w-7xl` dans WorkspaceShell

**Fichier**: `frontend/src/components/ui/workspace-shell.tsx`

**Action**: Ajouter `mx-auto flex max-w-7xl flex-col gap-6` comme wrapper du contenu.
```tsx
<div className="mx-auto flex max-w-7xl flex-col gap-6">
  <PageHeader ... />
  <Tabs ...>
</div>
```

**Impact**: Toutes les pages WorkspaceShell (20/24) héritent automatiquement du conteneur unifié.
**Risque**: Vérifier qu'aucune page n'a déjà son propre conteneur `max-w-7xl` (éviter la duplication).

### 2.2 Créer un composant `InfoBanner`

**Fichier**: Nouveau `frontend/src/components/ui/info-banner.tsx`

**Pattern Lovable**:
```tsx
<div className="flex items-center gap-3 rounded-xl border border-dashed bg-card/50 p-4 text-sm">
  <Tag className="h-4 w-4 text-accent" />
  <span className="text-muted-foreground">...</span>
</div>
```

**Props suggérées**:
```tsx
interface InfoBannerProps {
  icon?: LucideIcon
  children: ReactNode
  variant?: "info" | "warning" | "success"
}
```

**Pages cibles**: PricingPage (info date d'effet), Dashboard (alertes), Planning

### 2.3 Améliorer l'en-tête des DataTable

**Fichier**: `frontend/src/components/ui/data-table.tsx`

**Option A** — Ajouter une prop optionnelle `header` :
```tsx
interface DataTableProps<T> {
  // ...props existantes
  header?: {
    title: string
    description?: string
    badge?: { label: string; variant?: string }
    action?: { label: string; onClick: () => void }
  }
}
```

**Option B** — Documenter un pattern de composition (plus flexible) :
```tsx
<div className="rounded-xl border bg-card">
  <div className="flex items-center justify-between border-b px-5 py-3">
    <div>
      <h2 className="text-sm font-semibold">...</h2>
      <p className="text-xs text-muted-foreground">...</p>
    </div>
    <div className="flex items-center gap-2">
      <Badge variant="secondary">...</Badge>
      <Button size="sm" variant="ghost">...</Button>
    </div>
  </div>
  <DataTable ... />
</div>
```

**Recommandation**: Option B (composition) pour garder DataTable simple et flexible.

### 2.4 Normaliser les couleurs de statut via classes utilitaires

**Problème**: Certaines pages utilisent `bg-teal-100 text-teal-800` (hardcoded), d'autres `bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]`.

**Action**: Ajouter des classes utilitaires dans `index.css` ou un fichier dédié :
```css
/* Status badge utilities */
.badge-success { ... }
.badge-warning { ... }
.badge-destructive { ... }
.badge-info { ... }
```

Ou mieux : utiliser `variant` sur le composant shadcn `Badge` avec des variantes personnalisées.

**Fichiers cibles**:
- `frontend/src/index.css` (classes utilitaires)
- `frontend/src/modules/banque/components/` (FY state badges)
- `frontend/src/shell/components/AppHeader.tsx` (FY badges)
- Toutes les pages avec status badges

### 2.5 Normaliser les grilles de cartes cliquables

**Pattern Lovable** (Admin, RH, Integrations) :
```tsx
<button className="flex items-start gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:border-accent/40">
  <div className="rounded-lg bg-secondary p-2.5">
    <Icon className="h-5 w-5 text-accent" />
  </div>
  <div>
    <h3 className="font-semibold">...</h3>
    <p className="mt-1 text-sm text-muted-foreground">...</p>
  </div>
</button>
```

**Action**: Créer un composant `ActionCard` réutilisable :
```tsx
interface ActionCardProps {
  icon: LucideIcon
  title: string
  description: string
  onClick?: () => void
}
```

**Fichier**: Nouveau `frontend/src/components/ui/action-card.tsx`

---

## Phase 3 — Contrôle qualité et documentation

*Dépend de Phases 1 et 2*

### 3.1 Audit final des classes CSS Material 3 résiduelles

**Action**: `grep` pour les tokens M3 résiduels :
- `border-outline-variant` → remplacer par `border`
- `on-surface-variant` → remplacer par `muted-foreground`
- `rounded-shape-*` → remplacer par `rounded-xl`
- `bg-surface-*` → remplacer par `bg-card`

**Fichiers cibles**: Tout le code React (modules, shell, composants)

### 3.2 Audit responsive

**Action**: Vérifier que toutes les pages respectent :
- Sidebar collapse à 768px (déjà fait via `useIsMobile`)
- Grids responsives (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`)
- Tables avec scroll horizontal
- Gap cohérent (`gap-4`, `gap-6`)

### 3.3 Audit i18n des textes FR en dur

**Action**: Vérifier qu'aucun texte FR en dur depuis Lovable ne subsiste.

### 3.4 Documenter le Design System

**Fichier**: `frontend/DESIGN_SYSTEM.md`

**Contenu**:
- Structure de page standard (wrapper, PageHeader, Tabs, contenu)
- Composants disponibles et équivalents
- Patterns de grille (KPI 4-col, cartes 2-col, contenu 3-col)
- Status badges et couleurs sémantiques
- Responsive breakpoints

---

## Résumé des modifications

| Fichier | Action | Phase |
|---------|--------|-------|
| `frontend/src/components/ui/workspace-shell.tsx` | Ajouter wrapper `max-w-7xl` | 2.1 |
| `frontend/src/components/ui/info-banner.tsx` | **Nouveau** composant | 2.2 |
| `frontend/src/components/ui/action-card.tsx` | **Nouveau** composant | 2.5 |
| `frontend/src/modules/admin/components/AdminPage.tsx` | Refactor → WorkspaceShell | 1.1 |
| `frontend/src/modules/dashboard/components/DashboardPage.tsx` | Ajouter wrapper `max-w-7xl` | 1.2 |
| `frontend/src/modules/planning/components/PlanningPage.tsx` | Implémenter + wrapper unifié | 1.3 |
| `frontend/src/modules/pricing/components/PricingPage.tsx` | Shell unifié | 1.4 |
| `frontend/src/index.css` | Classes utilitaires status badges | 2.4 |
| Divers modules | Normaliser classes M3 → shadcn | 3.1 |

## Vérification

1. **Build**: `pnpm --filter frontend build` passe sans erreur
2. **Navigation**: Tester les 14 routes principales + `/member-portal/*`
3. **URL tabs**: Vérifier `?tab=xxx` sur AdminPage (après refactor)
4. **Responsive**: Tester sidebar collapse, grilles, table scroll
5. **Régression visuelle**: Comparer Dashboard et Flights avant/après
6. **i18n**: `grep -r "texte français"` — aucun texte FR en dur dans le JSX

## Décisions

- **DashboardPage** conserve sa structure sans WorkspaceShell (pas de tabs, affichage KPI pur). Seul le wrapper `max-w-7xl` est ajouté.
- **PlanningPage** sera soit un WorkspaceShell (si tabs), soit une page simple avec wrapper. Décision à prendre lors de l'implémentation.
- **PricingPage** — à analyser plus finement. Si formulaire complexe >20 champs, conserve sa structure avec wrapper `max-w-7xl`.
- Les composants `@club-erp/ui` ne sont pas modifiés (package séparé).

## Questions

1. **PricingPage** : Doit-elle être intégrée dans un WorkspaceShell (avec tabs : Tarifs, Packs, Versions) ou rester une page formulaire unique avec wrapper `max-w-7xl` ?
2. **PlanningPage** : Simple vue calendrier (page unique) ou workspace multi-tabs (Calendrier, Ressources, Équipe) ?
