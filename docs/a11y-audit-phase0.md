# Audit d'Accessibilité (a11y) — Phase 0

## Périmètre

18 composants UI dans `frontend/src/components/ui/` :

| Composant | Fichier | Audit |
|-----------|---------|-------|
| Alert | `alert.tsx` | ✅ |
| Banner | `banner.tsx` | ✅ |
| Button | `button.tsx` | ✅ |
| Card | `card.tsx` | ✅ |
| ConfirmDialog | `confirmation-dialog.tsx` | ✅ |
| DataTable | `data-table.tsx` | ✅ |
| Dialog | `dialog.tsx` | ✅ |
| EmptyState | `empty-state.tsx` | ✅ |
| FilterBar / FilterChip | `filter-bar.tsx` | ✅ |
| ImportDialog | `ImportDialog.tsx` | ✅ |
| Input | `input.tsx` | ✅ |
| Label | `label.tsx` | ✅ |
| ListItem | `list-item.tsx` | ✅ |
| PageHeader | `page-header.tsx` | ✅ |
| SearchableSelect | `searchable-select.tsx` | ✅ |
| SectionHeader | `section-header.tsx` | ✅ |
| SegmentedButton | `segmented-button.tsx` | ✅ |
| StickyActionBar | `sticky-action-bar.tsx` | ✅ |
| Tabs | `tabs.tsx` | ✅ |

---

## Critères évalués

1. **Focus visible** — `focus-visible:ring-2` ou équivalent présent
2. **Rôles ARIA** — `role="alert"`, `role="dialog"`, `aria-modal`, `role="tablist"`, etc.
3. **Contraste** — Les tokens CSS respectent un ratio ≥ 4.5:1 pour le texte normal
4. **Navigation clavier** — Tab, Enter/Escape, Arrow keys gérés
5. **Labels et descriptions** — `aria-label`, `aria-labelledby`, `sr-only` utilisés
6. **Messages d'état** — `aria-live="polite"`, `role="status"` pour les notifications

---

## Résultats

### ✅ Alert (`alert.tsx`)
- `role="alert"` présent
- Variantes de couleurs avec contraste suffisant (tokens de `tokens.css`)
- **OK**

### ✅ Banner (`banner.tsx`)
- `role="status"` avec `aria-live="polite"` présent
- Bouton de fermeture avec `aria-label="Fermer"`
- Icônes avec `aria-hidden="true"`
- **OK**

### ✅ Button (`button.tsx`)
- `focus-visible:ring-2` + `focus-visible:ring-offset-2` présent
- États `disabled` avec `disabled:pointer-events-none disabled:opacity-50`
- `displayName = 'Button'` pour le débogage React
- **OK**

### ✅ Card (`card.tsx`)
- Utilise `h3` pour `CardTitle` (hiérarchie de titres)
- Composant statique, pas d'interaction
- **OK**

### ✅ ConfirmDialog (`confirmation-dialog.tsx`)
- Utilise `Dialog` (qui a `aria-modal`, focus trap, Escape key)
- `aria-labelledby` et `aria-describedby` avec des `useId()`
- Boutons avec texte explicite
- **OK**

### ✅ DataTable (`data-table.tsx`)
- En-têtes de tableau avec `scope="col"`
- `aria-sort` pour les colonnes triables
- `sr-only` pour l'en-tête Actions
- Tri avec icône `aria-hidden="true"`
- **OK**
- **À améliorer** : ajouter `role="rowgroup"` à `thead` et `tbody`

### ✅ Dialog (`dialog.tsx`)
- `role="dialog"`, `aria-modal="true"`
- Focus trap complet (Tab et Shift+Tab)
- `Escape` ferme le dialogue
- Verrouillage du scroll
- Backdrop avec `aria-hidden="true"`
- `aria-labelledby` et `aria-describedby` acceptés en props
- **OK**

### ✅ EmptyState (`empty-state.tsx`)
- Icônes avec `aria-hidden="true"`
- Titre en `p` (devrait être `h2` ou `h3` pour la sémantique)
- **À améliorer** : Remplacer `<p>` titre par `<h2>` ou `<h3>` selon le contexte

### ✅ FilterBar / FilterChip (`filter-bar.tsx`)
- FilterChip : `aria-pressed` pour l'état actif
- `focus-visible:ring-2` présent
- **OK**

### ✅ ImportDialog (`ImportDialog.tsx`)
- Backdrop click pour fermer
- Bouton de fermeture avec `aria-label` (via i18n)
- Résultats d'import avec couleurs sémantiques (success/warning/error)
- **À améliorer** : 
  - Ajouter `role="dialog"` + `aria-modal="true"` sur le conteneur
  - Ajouter `aria-labelledby` avec l'id du titre
  - Ajouter `aria-live="polite"` sur la zone de résultats
  - Remplacer le backdrop `onClick` générique par un overlay dédié
  - Gérer la touche `Escape`

### ✅ Input (`input.tsx`)
- `focus-visible:ring-2` présent
- États `disabled` gérés
- `placeholder` accessible
- **OK**

### ✅ Label (`label.tsx`)
- Utilise l'élément `<label>` natif
- **OK**

### ✅ ListItem (`list-item.tsx`)
- `role="button"` et `tabIndex={0}` quand `onClick` est fourni
- Gestion des touches Enter/Espace
- `focus-visible:ring-2` présent
- **OK**

### ✅ PageHeader (`page-header.tsx`)
- Navigation breadcrumb avec `nav` et `aria-label="Fil d'Ariane"`
- Icône de séparation avec `aria-hidden="true"`
- Titre en `h1` (hiérarchie correcte)
- **OK**

### ⚠️ SearchableSelect (`searchable-select.tsx`)
- `aria-haspopup="listbox"`, `aria-expanded`
- `role="listbox"` sur la liste déroulante
- `role="option"` avec `aria-selected` sur chaque option
- `aria-disabled` sur les options désactivées
- `Escape` ferme le dropdown
- **À améliorer** :
  - Ajouter `aria-activedescendant` pour le suivi de focus virtuel
  - Ajouter une gestion des flèches Haut/Bas dans la liste
  - Le focus devrait rester sur le trigger et utiliser `aria-activedescendant`

### ✅ SectionHeader (`section-header.tsx`)
- Titre en `h2` (hiérarchie correcte)
- Composant purement informatif
- **OK**

### ✅ SegmentedButton (`segmented-button.tsx`)
- `role="radiogroup"` avec `role="radio"`
- `aria-checked` sur chaque bouton
- `focus-visible:ring-2` avec `ring-inset`
- États `disabled` gérés
- **OK**

### ✅ StickyActionBar (`sticky-action-bar.tsx`)
- Composant structurel uniquement, pas d'interaction propre
- **OK**

### ✅ Tabs (`tabs.tsx`)
- `role="tablist"` avec `role="tab"` sur chaque onglet
- `aria-selected` sur l'onglet actif
- `tabIndex={0}` pour l'onglet actif, `tabIndex={-1}` pour les autres
- Navigation clavier complète : ArrowRight, ArrowLeft, Home, End
- `focus-visible:ring-2` présent
- `aria-disabled` sur les onglets désactivés
- **OK**

---

## Plan d'action

| Priorité | Composant | Action |
|----------|-----------|--------|
| **Haute** | ImportDialog | Ajouter `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-live`, gestion Escape |
| **Haute** | SearchableSelect | Ajouter `aria-activedescendant`, flèches Haut/Bas |
| **Moyenne** | DataTable | Ajouter `role="rowgroup"` sur thead/tbody |
| **Basse** | EmptyState | Remplacer `<p>` titre par `<h2>`/`<h3>` |

---

## Correctifs appliqués

### 1. ImportDialog — a11y fixes
- Ajout de `role="dialog"` et `aria-modal="true"` sur le conteneur
- Ajout de `aria-labelledby` lié au titre
- Ajout de `aria-live="polite"` sur la zone de résultats
- Ajout de la gestion de la touche `Escape`
- Structure sémantique améliorée

### 2. SearchableSelect — a11y fixes  
- Ajout de la navigation clavier (ArrowDown/ArrowUp) dans la liste
- Ajout de `aria-activedescendant` pour le suivi visuel
- Meilleure gestion du focus

### 3. DataTable — a11y fixes
- Ajout de `role="rowgroup"` sur `thead` et `tbody`

### 4. EmptyState — a11y fixes
- Passage du titre de `p` à `h3` pour une meilleure hiérarchie
