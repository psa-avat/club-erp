# Design System — Club ERP Frontend

> **Dernière mise à jour** : 2026-06-14

## Structure de page standard

Toutes les pages workspace suivent ce schéma :

```
┌─ AppShell (SidebarProvider) ─────────────────────────────────────────────┐
│  ├─ AppSidebar (navigation, filtrage par capabilities)                  │
│  └─ SidebarInset                                                       │
│      ├─ AppHeader (user menu, exercice, recherche)                     │
│      ├─ AlertsBanner (notifications système)                           │
│      └─ <Outlet />                                                     │
│          └─ WorkspaceShell (mx-auto max-w-7xl)                         │
│              ├─ PageHeader (titre, description, actions)               │
│              ├─ Tabs (navigation, URL ?tab=xxx)                        │
│              └─ TabContent                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

### Conteneur unifié

Toutes les pages sont wrappées dans `mx-auto flex max-w-7xl flex-col gap-6` :
- **Pages avec tabs** → via `WorkspaceShell` (hérité automatiquement)
- **Pages sans tabs** → wrapper manuel (Dashboard, Pricing, etc.)

### PageHeader

Composant unifié depuis `@club-erp/ui` (rétrocompatible `supportingText` / `description`) :
```tsx
<PageHeader
  title="Titre de la page"
  description="Description optionnelle"
  actions={<Button>Action</Button>}
/>
```

---

## DataTable — Option B (composition pattern)

**Recommandée** : Ne pas étendre `DataTable` avec des props d'en-tête.
Utiliser plutôt la composition pour des tables avec titre et actions :

```tsx
<div className="rounded-xl border bg-card">
  {/* En-tête de table optionnel */}
  <div className="flex items-center justify-between border-b px-5 py-3">
    <div>
      <h2 className="text-sm font-semibold text-foreground">Titre</h2>
      <p className="text-xs text-muted-foreground">Sous-titre</p>
    </div>
    <div className="flex items-center gap-2">
      <Badge variant="secondary">7 sélectionnés</Badge>
      <Button size="sm" variant="ghost">
        Voir tout
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  </div>
  {/* DataTable sans wrapper (déjà rendue dans rounded-xl border bg-card) */}
  <DataTable
    columns={columns}
    data={data}
    getRowKey={(row) => row.id}
    emptyState={<EmptyState icon={...} title="..." />}
  />
</div>
```

**Props DataTable disponibles** :
| Prop | Type | Description |
|------|------|-------------|
| `columns` | `ColumnDef<T>[]` | Définition des colonnes |
| `data` | `T[]` | Données à afficher |
| `getRowKey` | `(row: T) => string \| number` | Clé unique pour chaque ligne |
| `onRowClick` | `(row: T) => void` | Optionnel, callback de clic |
| `actions` | `(row: T) => ReactNode` | Optionnel, rend des boutons d'action |
| `defaultSortKey` | `string` | Colonne de tri par défaut |
| `defaultSortDir` | `'asc' \| 'desc'` | Direction de tri par défaut |
| `expandedRow` | `string \| number \| null` | Ligne actuellement développée |
| `renderExpanded` | `(row: T) => ReactNode` | Contenu développé sous une ligne |
| `emptyState` | `ReactNode` | Rendu quand data est vide |
| `className` | `string` | Classes additionnelles |

---

## Patterns de grille

### KPI (4 colonnes)
```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <KpiCard label="..." value="..." icon={...} accent="warning" trend={{...}} />
</div>
```

### Cartes d'action (2-3 colonnes)
```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  <ActionCard icon={...} title="Titre" description="Description" onClick={...} />
</div>
```

### Contenu principal + sidebar (3 colonnes, ratio 2:1)
```tsx
<div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
  <div className="xl:col-span-2">{/* Tableau principal */}</div>
  <div className="flex flex-col gap-4">{/* Sidebar */}</div>
</div>
```

---

## Status badges — classes utilitaires

Utiliser les classes `badge-*` sur le composant `Badge` shadcn pour les statuts :

```tsx
<Badge className="badge-success">Actif</Badge>
<Badge className="badge-warning">En attente</Badge>
<Badge className="badge-destructive">Bloqué</Badge>
<Badge className="badge-info">Info</Badge>
```

Alternativement, utiliser les classes `bg-[color:var(--color-xxx)]/15 text-[color:var(--color-xxx)]` pour du styling inline.

---

## Composants disponibles

### shadcn/ui (dans `src/components/ui/`)
Bouton, Input, Label, Card, Tabs, Dialog, Sheet, Badge, Alert, Table, Select, Checkbox, Switch, Avatar, Tooltip, DropdownMenu, Popover, Progress, Skeleton, Table, Pagination, Separator, ScrollArea, Accordion, Breadcrumb, Command, etc.

### Métier (dans `src/components/ui/`)
| Composant | Usage |
|-----------|-------|
| `WorkspaceShell` | Layout à tabs avec persistance URL |
| `PageHeader` | Titre de page unifié (via `@club-erp/ui`) |
| `KpiCard` | Indicateur KPI avec label, valeur, tendance, icône |
| `InfoBanner` | Bannière d'information (bordure dashed) |
| `ActionCard` | Carte cliquable pour grilles d'actions |
| `DataTable` | Tableau triable avec colonnes |
| `FilterBar` | Barre de filtres avec chips |
| `SearchableSelect` | Selecteur avec recherche |
| `EmptyState` | État vide centré |
| `ConfirmationDialog` | Dialogue de confirmation destructive |
| `StickyActionBar` | Barre d'actions fixe en mobile |
| `SegmentedButton` | Bouton segmenté |
| `ListItem` | Élément de liste standard |

### @club-erp/ui (package séparé, non modifié)
PageHeader, Tabs, Button, Card, Dialog, Input, Label, Alert — versions historiques conservées pour rétrocompatibilité.

---

## Bonnes pratiques

1. **Toujours utiliser `useTranslation()`** pour les textes — pas de texte FR en dur dans le JSX.
2. **Préférer `@/` imports** plutôt que des chemins relatifs.
3. **URL tab persistence** avec `?tab=xxx` via `useActiveTab()` hook.
4. **Data fetching par tab** avec TanStack Query `enabled: tab === 'xxx'`.
5. **Actions CRUD** : `Dialog` (< 10 champs), `Sheet` (> 10 champs), `AlertDialog` (destructif).
6. **Conserver les tokens shadcn** : utiliser `border`, `bg-card`, `text-foreground`, `text-muted-foreground` — pas de tokens M3 (`border-outline-variant`, `text-on-surface`, etc.).
7. **Responsive** : sidebar collapse à 768px, grilles adaptatives, tables avec scroll horizontal.
