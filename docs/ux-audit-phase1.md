# Phase 1 — UX Audit Baseline
**Material 3 Frontend Refresh · Club ERP**
_Last updated: 2026-04-29_

This document is the single shared vocabulary for all subsequent phases. Every finding is grounded in the current codebase.  
Severity scale: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

## 1. Design System Inventory

### 1.1 Shared primitives (what exists today)

| Component | File | Variants / States |
|---|---|---|
| Button | `frontend/src/components/ui/button.tsx` | `default`, `secondary`, `ghost`, `destructive` · sizes `sm`, `default`, `lg` |
| Card | `frontend/src/components/ui/card.tsx` | Single surface. Sub-parts: Header, Title, Description, Content |
| Input | `frontend/src/components/ui/input.tsx` | Single variant, no error/success/helper text states |
| Label | `frontend/src/components/ui/label.tsx` | Single variant |
| Alert | `frontend/src/components/ui/alert.tsx` | Single variant, hardcoded rose/error only; `className` overridable |
| ImportDialog | `frontend/src/components/ui/ImportDialog.tsx` | Full-screen overlay; no focus trap, no Escape, no progress state |

### 1.2 What is missing from the system

All items below are hand-built locally on multiple screens instead of coming from a shared primitive:

- Native `<select>` elements (no shared styled wrapper, no searchable variant)
- Filter bars / filter chips (each screen builds its own, see §4)
- State badges / status chips (repeated in accounting, members, assets)
- Tabs / segmented navigation (accounting journal, members sections use custom pills)
- Page header (title + supporting text + contextual actions) — each module makes its own
- Section header (smaller intra-page grouping header)
- Empty state (text only, no illustration, no CTA pattern)
- Loading skeleton / spinner
- Success/info/warning banners (Alert is error-only today)
- Confirmation dialog (most destructive actions use `window.confirm`)
- Sticky action bar / save footer
- Responsive data table with row actions
- Stacked card list (mobile alternative to table)
- Searchable autocomplete
- Tooltip

### 1.3 Token coverage

| Area | Current approach | Gap |
|---|---|---|
| Color | Hard-coded Tailwind `slate-*`, `rose-*`, `green-*`, `amber-*` classes scattered in JSX | No semantic roles (surface, on-surface, primary, error, etc.) |
| Typography | Manrope loaded globally; size/weight scattered in Tailwind classes | No type scale tokens; no `display`, `headline`, `title`, `body`, `label` roles |
| Elevation / shadow | `shadow-sm`, `shadow-lg`, `shadow-xl` used ad hoc | No surface tier system (tonal surface 1–5 as in MD3) |
| Shape / radius | `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-full` scattered | No shape token; extra-small/small/medium/large shape roles missing |
| Spacing | Tailwind spacing scale, mixed p/m classes | No intentional content/component/screen spacing layers |
| Motion | `transition-colors` on Button; none elsewhere | No duration/easing tokens; no standard enter/exit animation |
| State layers | `hover:bg-slate-100`, `focus-visible:ring-*` on primitives | No standardized `--md-state-hover`, `--md-state-focus`, `--md-state-pressed` layers |

---

## 2. Shell & Navigation Audit

### 2.1 Current structure

```
AppShell (AppShell.tsx)
├── Header (Header.tsx)                — sticky top bar, h=16rem, z=40
│   ├── hamburger button               — md:hidden
│   ├── active-module chip             — md:hidden, non-dashboard only
│   ├── app title link                 — always visible
│   ├── language selector              — always visible
│   └── user avatar + dropdown menu   — authenticated only
├── MobileDrawer (MobileDrawer.tsx)   — fixed inset, z=50, md:hidden
│   └── capability-filtered NavLinks
├── Sidebar (Sidebar.tsx)             — w=64, hidden md:block
│   └── capability-filtered NavLinks
└── <main>                            — flex-1, p-4 md:p-6, Outlet
```

### 2.2 Navigation items (navigation.ts)

| Label key | Route | Required capability |
|---|---|---|
| nav.dashboard | /dashboard | — |
| nav.club | /club | MANAGE_USERS |
| nav.planning | /planning | EDIT_FLIGHTS |
| nav.banque | /banque | VIEW_FINANCIALS |
| nav.assets | /aéronefs | MANAGE_ASSETS |
| nav.admin | /admin | MANAGE_USERS |

**IA gap:** Route `/pricing` exists in `App.tsx` and has an entry in the old `GlobalMenuBar.tsx`, but is NOT in `shellNavItems`. It is unreachable from any nav unless you know the URL. The same pricing content is also accessible as a sub-route of `/banque`. This is an unresolved information architecture conflict. 🔴

### 2.3 Shell findings

| ID | Severity | Finding | File |
|---|---|---|---|
| S-01 | 🔴 | `/pricing` route is unreachable from shell navigation | `navigation.ts`, `App.tsx` |
| S-02 | 🔴 | `GlobalMenuBar.tsx` is a parallel shadow-shell (duplicate Header + NavLinks) that is imported from `components/layout/index.ts` but unused in the current app tree. Dead code that will confuse future contributors. | `GlobalMenuBar.tsx`, `components/layout/index.ts` |
| S-03 | 🟠 | Header has no page title — on desktop the sidebar tells you where you are; on mobile the only contextual signal is a small chip that links back to the module root. No current-page title is ever displayed in the top bar. | `Header.tsx` |
| S-04 | 🟠 | MobileDrawer has no focus trap, no Escape handler, no `aria-modal`, and no scroll lock. Backdrop click closes it but only by checking `e.target === e.currentTarget`. | `MobileDrawer.tsx` |
| S-05 | 🟠 | Sidebar uses only top-level routes. No visual expansion or grouping for modules with deep sub-navigation (accounting with 3+ journal routes, assets with 5+ routes). Users discover sub-routes only from within the module. | `Sidebar.tsx` |
| S-06 | 🟡 | Sidebar NavLink uses `end={link.to === '/dashboard'}` but all other routes do not use `end`, so `/banque` also highlights when on `/banque/journal/templates`. This is correct for simple depth, but becomes misleading once sub-routes have their own distinct purposes. | `Sidebar.tsx` |
| S-07 | 🟡 | Language selector and user menu are placed in the same right-side slot, making the header feel crowded at narrow tablet widths where the sidebar is still hidden. | `Header.tsx` |
| S-08 | 🟢 | `App.css` contains Vite scaffold boilerplate (`.hero`, `.counter`, `#center`). All unused; safe to delete. | `App.css` |
| S-09 | 🟢 | `index.css` sets `body` background to a multi-gradient; this creates a visible discontinuity where white cards sit on a slightly textured pale slate background. Not wrong, but not intentional as a token. | `index.css` |

---

## 3. Dialog & Feedback Audit

| ID | Severity | Finding | File |
|---|---|---|---|
| D-01 | 🔴 | Destructive actions use `window.confirm` (template delete in `JournalTemplatesScreen`, pricing version delete in `AssetPricingPage`). These are unstyled, unlocalized, and block the JS thread. They feel out of place in every browser. | `JournalTemplatesScreen.tsx`, `AssetPricingPage.tsx` |
| D-02 | 🟠 | `ImportDialog` closes on backdrop click without warning (data loss risk if user accidentally clicks outside while uploading). No focus trap, no Escape key handler, no `role="dialog"` or `aria-labelledby`. | `ImportDialog.tsx` |
| D-03 | 🟠 | `ImportDialog` shows result counts and row errors in the same surface without step framing. There is no success state, no clear "done" CTA, and no visual separation between the upload phase and the results phase. | `ImportDialog.tsx` |
| D-04 | 🟠 | `Alert` is hardcoded rose/error. Success messages across accounting screens use `className` overrides (`border-green-200 bg-green-50 text-green-800`) which is fragile and inconsistent. | `alert.tsx`, `JournalEntryWorkspaceScreen.tsx`, `JournalTemplatesScreen.tsx` |
| D-05 | 🟡 | Success banners auto-dismiss after 3s (setTimeout). There is no dismiss button, no pause-on-hover, and no ARIA live region announcement. Screen-reader users may not catch them. | `JournalEntryWorkspaceScreen.tsx`, `JournalTemplatesScreen.tsx` |
| D-06 | 🟡 | Error messages from mutations use a generic `toErrorMessage()` fallback. Fine as a safety net, but callers do not provide field-level or contextual copy, so error messages are usually "Une erreur est survenue." | `journalShared.tsx` |
| D-07 | 🟢 | `ImportDialog` close button uses `✕` text character instead of an icon or labeled button. Screen readers read it as "times". | `ImportDialog.tsx` |

---

## 4. Filter & Browse Patterns Audit

Three main browse screens: Members, Assets, Journal Entries. Each builds its own filter bar independently.

### 4.1 Pattern comparison

| Aspect | Members | Assets | Journal Entries |
|---|---|---|---|
| Filter location | Card inside page (always visible) | Card inside page (always visible) | Card inside page (always visible) |
| Filter controls | 4 `<select>` + 1 `<input>` | 1 `<input>` + 1 `<select>` | 3 `<select>` + 1 `<input>` |
| Filter reset | No reset button | No reset button | ✅ "Réinitialiser les filtres" (phase 3 addition) |
| Active-filter count | None | None | None |
| Result count | None | Yes, inline | `({entries.length})` in title |
| Search debounce | No | No (client-side) | ✅ 350ms (phase 3 addition) |
| Server vs client | Server-filtered | **Client-side text match only** | Server-filtered |
| Empty state | Plain text | Plain text | Plain text |
| Loading state | "Chargement..." text | None visible | None visible |

### 4.2 Filter findings

| ID | Severity | Finding | File |
|---|---|---|---|
| F-01 | 🟠 | Assets filter is entirely client-side — the list is fetched once and filtered in JS. As aircraft inventory grows this becomes slow and gives false "no results" for items not yet loaded. | `AssetsListPage.tsx` |
| F-02 | 🟠 | No standard reset button on Members or Assets filter panels. Once filters are set the user has no one-click escape. | `MembersPage.tsx`, `AssetsListPage.tsx` |
| F-03 | 🟡 | All filter bars use native `<select>` elements. These cannot be searched, do not support custom rendering, and are not keyboard-navigable beyond what the OS provides. | All three screens |
| F-04 | 🟡 | No active-filter indicators anywhere. Users cannot tell at a glance which filters are active without reading all controls. | All three screens |
| F-05 | 🟡 | No consistent empty-state component. Each screen writes its own `<p className="text-sm ...">Aucun résultat</p>`. No illustration, no reset CTA, no hint about what caused the empty state. | All three screens |
| F-06 | 🟢 | Search inputs do not have explicit `aria-label` or `<label>` associations (Members, Assets). They have placeholder text only. | `MembersPage.tsx`, `AssetsListPage.tsx` |

---

## 5. Form Patterns Audit

### 5.1 General form findings

| ID | Severity | Finding | Affected screens |
|---|---|---|---|
| FM-01 | 🟠 | No inline field-level validation or helper text. Errors surface only after a full save attempt via the top-level Alert banner. Users cannot see which field caused the error without re-reading the whole form. | All long-form screens |
| FM-02 | 🟠 | All required/optional field indication is implicit. There are no `*` markers, no "(optional)" labels, and no field-level supporting text. | `AssetFormPage.tsx`, `MembersPage.tsx` |
| FM-03 | 🟠 | Native `<select>` elements are used for all dropdowns (journals, accounts, fiscal years, asset types, members) with no search. Some lists are potentially long (accounts can be 200+ entries). | `JournalEntryWorkspaceScreen.tsx`, `AssetFormPage.tsx`, `MembersPage.tsx` |
| FM-04 | 🟡 | Long forms are fully expanded at once. Member editor shows identity + category + flags + notes + references simultaneously with no grouping or progressive disclosure. | `MembersPage.tsx` |
| FM-05 | 🟡 | `Label` and `Input` are separate components but forms manually assemble `<div className="space-y-1"><Label /><Input /></div>` on every field. No shared `FormField` wrapper. | All forms |
| FM-06 | 🟡 | `disabled` inputs do not have a visual affordance beyond `opacity-50`. On forms where some fields are locked (e.g. posted accounting entry), users cannot easily tell which fields are editable. | `JournalEntryWorkspaceScreen.tsx`, member sheet |
| FM-07 | 🟢 | No autofocus on the first field when a form opens. Users must click manually before they can type. | All forms |

### 5.2 Accounting-specific form findings

| ID | Severity | Finding | File |
|---|---|---|---|
| FA-01 | 🟠 | `JournalEntryWorkspaceScreen` combines (a) model prefill, (b) pricing prefill, (c) entry metadata, (d) line editor, (e) save/post, (f) reversal — all in one vertical scroll. No visual grouping between helper tools and core data entry. | `JournalEntryWorkspaceScreen.tsx` |
| FA-02 | 🟡 | Line editor table has no sticky columns. On narrow screens `account_uuid` select + debit + credit + description + remove overflow horizontally. The table uses `overflow-x-auto` as the sole mobile accommodation. | `journalShared.tsx` |
| FA-03 | 🟡 | "Ajouter une ligne" button is in the table header. After adding many lines the button is offscreen and users must scroll up to add more. | `journalShared.tsx` |
| FA-04 | 🟡 | Debit/credit inputs have no locale formatting (e.g. `1 234.56`). Values are shown as plain number inputs. | `journalShared.tsx` |

---

## 6. Page Hierarchy & Composition Audit

### 6.1 Hierarchy inconsistency

Each module uses a different visual approach for its page header:

| Module | Approach | File |
|---|---|---|
| Members | Full dark hero banner (emerald gradient, large title + section buttons) | `MembersPage.tsx` |
| Assets | Plain white card with title + description text | `AssetsListPage.tsx` |
| Accounting | Custom `JournalPageShell` with title + description + inline sub-nav links | `journalShared.tsx` |
| Dashboard | Plain text inside `<section>` | `DashboardPage.tsx` (assumed) |
| Admin | Unknown (not audited this pass) | `AdminPage.tsx` |
| Settings | Title card inside `BanqueSettingsPage` | `BanqueSettingsPage.tsx` |

There is no shared page-scaffold component. Each module author invented a different header pattern.

### 6.2 Content density findings

| ID | Severity | Finding | File |
|---|---|---|---|
| P-01 | 🟠 | `MembersPage.tsx` is the largest monolith: members list + committees + sheets + year selector + import + token generation + edit forms all coexist. Cognitive load is very high and task focus is poor. | `MembersPage.tsx` |
| P-02 | 🟡 | `AssetDetailPage` displays all asset information in a flat card wall with no tab or anchor navigation. For assets with pricing history, depreciation schedules, and activity logs, this will become unmanageable. | `AssetDetailPage.tsx` |
| P-03 | 🟡 | `JournalTemplatesScreen` stacks the editor and the list vertically (fixed in phase 3 of previous sessions), but the editor itself is still a long scroll with no section grouping. | `JournalTemplatesScreen.tsx` |
| P-04 | 🟡 | Breadcrumb / back navigation is inconsistent. Journal uses a `← Retour à la comptabilité` link. Assets use browser back. Members has no back affordance at all. | Multiple screens |
| P-05 | 🟢 | Primary CTAs (Save, Create, Post) are placed at the bottom of forms. On long forms on small screens, the primary action is below the fold, making it feel like there is nothing to do. | Multiple screens |

---

## 7. Permission & Access Patterns Audit

| ID | Severity | Finding | File |
|---|---|---|---|
| A-01 | 🟠 | Access denied is handled differently per module: plain text paragraph (Journal entries), silent redirect (JournalEntryWorkspacePage wrapper), inline Alert (BanqueSettingsPage). No shared denied-state component. | `JournalEntriesScreen.tsx`, `BanqueJournalEntryWorkspacePage.tsx`, `BanqueSettingsPage.tsx` |
| A-02 | 🟡 | Routes in `App.tsx` are not capability-guarded at the router level. All protection is inside individual screen components. A user with a direct URL can render the shell structure around a "no permission" message. | `App.tsx` |
| A-03 | 🟢 | Capability check `useCapability('...')` is correctly abstracted, but the hook is called independently in every screen rather than being lifted to a route-wrapper pattern. | All screens |

---

## 8. Mobile & Responsive Audit

| ID | Severity | Finding | File |
|---|---|---|---|
| M-01 | 🟠 | Shell mobile experience is acceptable (drawer + module chip) but workspaces are not redesigned for mobile. Most screens simply "collapse" (md grid → single column), producing very long pages. | All major screens |
| M-02 | 🟠 | MobileDrawer has no scroll lock (`overflow-hidden` not applied to `body`). On short screens, the page behind the drawer may scroll. | `MobileDrawer.tsx` |
| M-03 | 🟡 | Journal line editor table overflows horizontally on mobile (acknowledged in §5.2). No touch-optimized alternative (e.g. stacked line cards). | `journalShared.tsx` |
| M-04 | 🟡 | Asset list row actions (Edit, Pricing, status buttons) are a horizontal cluster that wraps awkwardly on small screens with no overflow menu fallback. | `AssetsListPage.tsx` |
| M-05 | 🟡 | Import dialog is `max-w-2xl` but not height-constrained, so on small screens the dialog may overflow the viewport with no internal scroll. | `ImportDialog.tsx` |
| M-06 | 🟢 | Touch targets: most buttons are `h-10` (40px) which meets minimum. Small ghost/link buttons used for row actions may be as small as `h-8` (32px), borderline. | Multiple screens |

---

## 9. Summary: Prioritized Issue Register

| Priority | ID | Area | Finding |
|---|---|---|---|
| 1 | S-01 | IA | `/pricing` unreachable from shell nav — design decision required |
| 2 | S-02 | Shell | `GlobalMenuBar.tsx` dead-code shadow shell — delete |
| 3 | D-01 | Dialogs | `window.confirm` used for destructive actions — replace with dialog component |
| 4 | D-02/03 | Dialogs | `ImportDialog` missing a11y, focus trap, step framing |
| 5 | 1.2 | System | Missing shared primitives: filter chip bar, page header, confirmation dialog, success/warning banners, searchable select, empty state, sticky action bar |
| 6 | 1.3 | Tokens | No semantic color, type, elevation, shape, or motion tokens |
| 7 | FM-01 | Forms | No inline field validation or helper text |
| 8 | FM-03 | Forms | Native `<select>` for long lists (accounts, members) — no search |
| 9 | FA-01 | Accounting | Workspace mixes helper tools with core entry editing |
| 10 | P-01 | Screens | `MembersPage` is overloaded — needs task decomposition |
| 11 | F-01 | Filters | Assets filter is client-side only |
| 12 | A-01 | Permissions | Access-denied UX is inconsistent across all modules |
| 13 | S-03 | Shell | No page title in header on any breakpoint |
| 14 | S-04 | Shell | MobileDrawer missing focus trap, Escape, aria-modal, scroll lock |
| 15 | M-03 | Mobile | Journal line table needs touch-optimized alternative |

---

## 10. Phase 2 Input: Recommended Token Architecture

Based on the gaps above, Phase 2 should introduce the following semantic CSS custom properties in `index.css` (Tailwind v4 compatible):

### Color roles (MD3 mapping → current slate/green palette)
```
--color-primary          (currently slate-900)
--color-on-primary       (white)
--color-primary-container  (slate-100 / tonal surface)
--color-on-primary-container (slate-800)
--color-secondary        (slate-600)
--color-surface          (white)
--color-surface-variant  (slate-50)
--color-surface-container (slate-100, for cards)
--color-on-surface       (slate-900)
--color-on-surface-variant (slate-500, supporting text)
--color-outline          (slate-300, borders)
--color-outline-variant  (slate-200, dividers)
--color-error            (rose-600)
--color-on-error         (white)
--color-error-container  (rose-50)
--color-on-error-container (rose-700)
--color-success          (green-700)
--color-success-container (green-50)
--color-on-success-container (green-800)
--color-warning          (amber-700)
--color-warning-container (amber-50)
--color-on-warning-container (amber-800)
```

### Type scale (MD3 → current Manrope usage)
```
--typescale-display-large    (2.25rem / 700)   — hero titles
--typescale-display-medium   (1.875rem / 700)  — section heroes
--typescale-headline-large   (1.5rem / 600)    — page titles (H1)
--typescale-headline-medium  (1.25rem / 600)   — card/section titles (H2)
--typescale-headline-small   (1.125rem / 600)  — sub-section titles (H3)
--typescale-title-large      (1rem / 600)      — list item titles
--typescale-title-medium     (0.875rem / 500)  — emphasized labels
--typescale-body-large       (1rem / 400)      — primary body text
--typescale-body-medium      (0.875rem / 400)  — secondary body text
--typescale-label-large      (0.875rem / 500)  — button text, form labels
--typescale-label-medium     (0.75rem / 500)   — chips, badges, captions
--typescale-label-small      (0.6875rem / 500) — micro labels
```

### Shape scale (MD3 → current rounded-* usage)
```
--shape-none     (0)
--shape-xs       (0.25rem  / rounded)
--shape-sm       (0.375rem / rounded-md)
--shape-md       (0.5rem   / rounded-lg)
--shape-lg       (0.75rem  / rounded-xl)
--shape-xl       (1rem     / rounded-2xl)
--shape-full     (9999px   / rounded-full)
```

### Elevation / surface tiers
```
--surface-0  (white, no shadow — flat content)
--surface-1  (white + shadow-sm — cards, panels)
--surface-2  (white + shadow-md — raised cards, dropdowns)
--surface-3  (white + shadow-lg — modals, popovers)
--surface-4  (white + shadow-xl — full overlays)
```

---

## 11. Phase 3–4 Input: Component Gap List

Components to build in `frontend/src/components/ui/` during Phase 4 (in priority order):

1. `page-header.tsx` — `PageHeader(title, supportingText, actions?, breadcrumb?)`
2. `section-header.tsx` — `SectionHeader(title, supportingText?, action?)`
3. `confirmation-dialog.tsx` — `ConfirmDialog(title, body, confirmLabel, onConfirm, onCancel, variant?)`
4. `banner.tsx` — `Banner(variant: success|info|warning|error, message, onDismiss?)`
5. `filter-bar.tsx` — `FilterBar(chips: FilterChip[], onReset?, resultCount?)` + `FilterChip(label, active, onToggle)`
6. `tabs.tsx` — `Tabs + Tab` with keyboard navigation and animated indicator
7. `segmented-button.tsx` — 2-4 option exclusive selection (replaces custom pills)
8. `list-item.tsx` — `ListItem(leading?, headline, supporting?, trailing?, onClick?)` for browse lists
9. `searchable-select.tsx` — controlled combobox with search filter
10. `data-table.tsx` — sortable table with overflow menu per row, responsive card fallback
11. `empty-state.tsx` — `EmptyState(icon?, title, description, action?)` standardized empty content
12. `sticky-action-bar.tsx` — bottom-fixed (mobile) / inline (desktop) primary action zone
13. `dialog.tsx` — base dialog primitive with focus trap, Escape, aria-modal, scroll lock

---

## 12. Decisions — RESOLVED 2026-04-29

| # | Decision | **Resolution** | Impact |
|---|---|---|---|
| 1 | Pricing IA | ✅ **(b) Merge under `/banque`** — pricing items and versions are sub-routes of `/banque`; remove `/pricing` standalone route and delete `GlobalMenuBar.tsx` | Shell nav restructure (Phase 3): add Pricing sub-entries under Banque sidebar group |
| 2 | Token delivery | ✅ **(c) Both** — define semantic CSS custom properties in `index.css` under `:root {}` AND expose them as Tailwind `@theme` aliases so `text-primary`, `bg-surface-container`, etc. work in JSX | Phase 2 implementation approach confirmed |
| 3 | MembersPage routing | ✅ **(b) Split routes** — `/club/members`, `/club/committees`, `/club/sheets` each get their own page; MembersPage monolith is decomposed | Phase 6 scope: 3 separate screen rewrites; member sheet pages must be mobile-friendly (phone access confirmed use-case) |
| 4 | Line editor mobile | ✅ **(a) Horizontal scroll + sticky first column** — table stays for desktop-primary use; `position: sticky; left: 0` on the account column; no stacked-card alternative needed | Phase 5 journal: one CSS fix, no layout rework |

### Additional context recorded
- **Primary viewport**: wide desktop (PC) — dense tables and side-by-side layouts are fine.
- **Mobile scope**: member sheets specifically need to work on phone. All other mobile findings remain Medium priority; member sheet mobile is High.
- **Pricing merge consequence**: `/pricing` route and `GlobalMenuBar.tsx` (S-01, S-02) will be resolved together in Phase 3 shell restructure.
