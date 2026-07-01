# UI Refactoring — Consolidated Active Plan

> Status: active working plan. Consolidates and supersedes (for planning purposes) four prior
> documents, kept for history/provenance:
> - `docs/archive/plan-uiRefactoring.prompt.md` — 13-phase, ~20-week overhaul (drawer nav, dashboard-centric homepage)
> - `docs/archive/plan-ux-ui-navigation.md` — nav consolidation (15 entries → 8 groups), double-header cleanup, i18n audit
> - `docs/archive/plan-visualHarmonization.prompt.md` — unify 24 workspace pages on WorkspaceShell/InfoBanner/ActionCard, remove Material 3 tokens
> - `docs/archive/ERP_UI_Refactoring.md` — Daily Operations cockpit, unified Finance, Alerts & Tasks, Portal redesign
>
> This document does not repeat their full rationale/wireframes except where still useful for
> unfinished work. Re-verified against the codebase on 2026-07-01.

---

## 1. What's done

These items were claimed (sometimes redundantly) across two or more source docs and are verified
in the current codebase.

**Navigation consolidation** (claimed by `plan-ux-ui-navigation` and `ERP_UI_Refactoring`)
- Sidebar reduced from the original 15+ scattered entries to **11 top-level groups**:
  Dashboard, Vols & Facturation, VI & HelloAsso, Planning, Membres, Finance, Rapports financiers,
  RH, Tarifs, Machines, Administration (`frontend/src/shell/navigation.ts`).
- Finance is unified: `/workspace/sales`, `/workspace/purchases`, `/workspace/banque`,
  `/workspace/accounting` all redirect into `FinanceWorkspacePage` tabs (`apercu`, `ventes`,
  `achats`, `comptabilite`). Member Portal removed from the staff sidebar. "Bilans" duplicate entry removed.
- `MembersWorkspacePage` has `directory` / `commissions` / `reinscription` tabs (double-header
  cleanup and `ClubPageShell` removal largely done — see remaining item below for one gap).

**Design system foundations** (claimed by `plan-uiRefactoring` Phases 0/1/1c and
`plan-visualHarmonization` Phase 1.1)
- `PageHeader`, `Tabs`, `WorkspaceShell` exist in `packages/ui` / `frontend/src/components/ui` and
  are the standard pattern used by ~20 workspace pages.
- Drawer/header navigation shell exists (`shell/components`), replacing old Sidebar/MobileDrawer.
- `AdminPage.tsx` (`frontend/src/modules/admin/components/AdminPage.tsx:102`) was refactored from
  manual `PageHeader` + `Tabs` to `WorkspaceShell` with tabs (`users`, `roles`, `capabilities`,
  `parametres`) plus a nested `SubWorkspaceShell` — this was still open in
  `plan-visualHarmonization` Phase 1.1 and is now closed.
- `InfoBanner` and `ActionCard` components exist at
  `frontend/src/components/ui/info-banner.tsx` and `frontend/src/components/ui/action-card.tsx`,
  matching the Lovable-derived patterns from `plan-visualHarmonization` Phase 2.2/2.5.
  **They are built but currently unused anywhere in the app** (zero grep hits) — see remaining work.

**Daily-ops style consolidation (partial)**
- `BanqueDailyOpsPage.tsx` exists as a 7-tab shell (dashboard, suppliers, sales, flights, packs,
  payments, payroll) — the "Pointage" tab-splitting envisioned by `plan-uiRefactoring` Phase 1b
  was not done as a literal page-split, but the functionality is consolidated behind this shell
  rather than duplicated.
- `PlanningPage.tsx` exists as a routed page (currently a minimal single-tab placeholder — see
  remaining work).

---

## 2. What's remaining

Organized by area. Each item is actionable and deduped across the four source docs.

### Navigation

1. **Reduce 11 top-level groups toward the target 8** (`plan-ux-ui-navigation` §2.1,
   `ERP_UI_Refactoring` §3). Current groups: Dashboard, Vols & Facturation, VI & HelloAsso,
   Planning, Membres, Finance, Rapports financiers, RH, Tarifs, Machines, Administration.
   Candidates for merging per the original target map: fold **Rapports financiers** into Finance
   (`tab=comptabilite` or a `rapports` tab), and consider folding **Tarifs** and **Machines** into
   a single Assets/Pricing group (`plan-uiRefactoring`'s `assets/` consolidation intent —
   pricing/packs/VI-types absorbed into assets). File: `frontend/src/shell/navigation.ts`.
2. **Finish the "Réinscription" tab merge.** `MembersWorkspacePage`'s `reinscription` tab
   (`frontend/src/modules/members/components/MembersWorkspacePage.tsx:38-51`) is still a
   `PlaceholderPage`. `MemberSheetsPage.tsx` still exists, is still routed, and still owns
   `licence_number`, `fare_type`, `hours_count`, and portal-token management. Per
   `plan-ux-ui-navigation` Phase C2/C3: move these fields and the token
   activate/regenerate/revoke controls into the `reinscription` tab (or into
   `MemberWorkspaceShell` per-member "Accès portail" section), then redirect
   `/workspace/members?tab=fiches` → `?tab=reinscription` and delete `MemberSheetsPage.tsx`
   once nothing references it.
3. Re-audit i18n namespace consistency for workspace tabs (`workspace.[section].tabs.*` vs
   `workspace.tabs.*`) — `plan-ux-ui-navigation` Phase E6/E7 flagged this as incomplete; not
   re-verified in this pass, low risk, do as part of any future navigation touch.

### Dashboard

4. **Build the KPI dashboard homepage** (`plan-uiRefactoring` Phase 2). Currently
   `DashboardPage.tsx` is a basic KPI display with no drill-down. Needed:
   - `KpiCard` themes for Vols / Membres / Finances / Actifs / Comités / Alertes, each clickable
     to a filtered list.
   - `KpiStrip` (horizontal status totals) and `RecentActivity` (timeline feed).
   - Wire to real data instead of mocked values.
5. Add `max-w-7xl` width constraint. **Verified still missing**: neither `WorkspaceShell`
   (`frontend/src/components/ui/workspace-shell.tsx:136`, currently
   `"flex w-full flex-col gap-6"`) nor `DashboardPage.tsx:109` (same class list) applies a
   max-width wrapper. Per `plan-visualHarmonization` Phase 2.1, add
   `mx-auto flex max-w-7xl flex-col gap-6` to `WorkspaceShell` so all ~20 pages built on it inherit
   the constraint in one change; verify no page already double-wraps with its own `max-w-7xl` first.

### Visual harmonization / Material-3 cleanup

6. **Remove residual Material-3 tokens.** Verified count: **375 occurrences** of
   `border-outline-variant`, `on-surface-variant`, `rounded-shape-`, `bg-surface-` across
   `frontend/src` (higher than the ~321 previously estimated — codebase has grown since last
   audit). Examples: `frontend/src/components/ui/list-item.tsx`,
   `frontend/src/components/ui/banner.tsx`, `frontend/src/components/ui/searchable-select.tsx`,
   `frontend/src/modules/flights/components/FlightsPage.tsx`,
   `frontend/src/modules/members/components/MemberSheetsPage.tsx`. Mapping (per
   `plan-visualHarmonization` Phase 3.1): `border-outline-variant` → `border`,
   `on-surface-variant` → `muted-foreground`, `rounded-shape-*` → `rounded-xl`,
   `bg-surface-*` → `bg-card`.
7. **Wire up `InfoBanner` and `ActionCard`.** Both components exist and are built to spec but are
   dead code today (zero usages). Adopt them where the source docs intended: `InfoBanner` on
   Pricing (effective-date notices), Dashboard (alerts), Planning; `ActionCard` for
   Admin/RH/Integrations clickable grids (`plan-visualHarmonization` Phase 2.2/2.5).
8. **`PlanningPage.tsx` is still a placeholder** (single `calendar` tab, no real content). Needs
   the calendar/availability/assignment/activity-tracking build-out described in
   `plan-uiRefactoring` Phase 12.4 and `ERP_UI_Refactoring` §8, or at minimum a proper
   `WorkspaceShell`/`max-w-7xl` treatment if left minimal longer-term
   (`plan-visualHarmonization` Phase 1.3).
9. Normalize status-badge colors to the `badge-success` / `badge-warning` / `badge-destructive` /
   `badge-info` utility classes everywhere (some pages still hardcode Tailwind colors like
   `bg-teal-100 text-teal-800`) — `plan-visualHarmonization` Phase 2.4.
10. Standardize DataTable header composition (title/subtitle/badge/action row above the table) per
    the Option B pattern in `plan-visualHarmonization` Phase 2.3 — apply table-by-table as pages
    are touched, no dedicated sweep needed.

### Daily Ops / Alerts & Tasks

11. **Build the Alerts & Tasks system — not found anywhere in the codebase.** Verified: `AlertsBanner`
    exists in the shell but renders only placeholder content; the route `/daily-ops/alerts` resolves
    to a generic `PlaceholderPage`; the `daily-ops` module directory is an empty stub; there is no
    `useAlerts` hook and no `AlertsPage` component. This is called for by all of
    `plan-uiRefactoring` Phase 11, `plan-ux-ui-navigation`'s dashboard alerts references, and
    `ERP_UI_Refactoring` §9. Scope:
    - `useAlerts` hook (TanStack Query, ~5 min polling) surfacing: unbilled flights, flights
      modified after billing, missing pricing, negative balances, pack inconsistencies, Planche/
      HelloAsso sync errors.
    - Real `AlertsBanner` (persistent, contextual) replacing the placeholder.
    - `AlertsPage` (list, acknowledge, snooze).
12. **Bank reconciliation** (`plan-uiRefactoring` Phase 9): import statement → auto/manual
    matching → resolution → PDF report. Not built.
13. **Volunteer expenses (notes de frais)**: member-submitted expense claims with admin
    approve/reject + reimbursement flow (`plan-uiRefactoring` Phase 11.6/11.7). Not built.
14. Recurring entry templates (`BanqueJournalTemplatesPage`) — not built
    (`plan-uiRefactoring` Phase 8.10).
15. Gesasso/OSRT dedicated sync dashboards beyond the current federal-sync integration
    (`plan-uiRefactoring` Phase 10) — check `project_federal_sync.md` memory note for current
    federal-sync implementation state before scoping this further.

### Portal

16. **Member portal redesign is incomplete.** Verified: the portal has more pages than the
    original "login, logbook, balance" baseline (`DashboardPage`, `AccountPage`, `ExpensesPage`,
    `FlightsPage`, `LoginPage`, `WorkspacePage` under `frontend/src/modules/member-portal/pages`),
    but the portal `DashboardPage` itself only shows account-balance cards and a packs-consumption
    bar — no volunteer declarations, documents, or availability sections
    (`ERP_UI_Refactoring` §17). Remaining:
    - Documents tab (upload/view member files).
    - Volunteer/fiscal declaration flow with proof upload.
    - Availability declaration (feeds Planning, per `ERP_UI_Refactoring` §8 "For members (portal):
      declare availability").
    - Online renewal (HelloAsso) + pre-expiry email notification
      (`plan-uiRefactoring` Phase 11.4/11.5).
    - RGPD data export/portability endpoint (`plan-uiRefactoring` Phase 12.7).
17. Optional staff-side "preview as member" link from the club member workspace into the portal
    login (`plan-ux-ui-navigation` Phase C7) — low priority, nice-to-have.

### Sales & Suppliers (structural question, unresolved across sources)

18. `ERP_UI_Refactoring` proposed a first-class "Sales & Suppliers" top-level nav group; the other
    three docs instead fold sales/suppliers into Finance tabs. **Verified current state**: no
    `frontend/src/modules/sales/` directory exists; sales/suppliers live only as tabs inside
    `BanqueDailyOpsPage` and `FinanceWorkspacePage`. Decision needed before further work: keep
    consolidated under Finance (current direction, consistent with the nav-consolidation docs) or
    split out. Default to **keep under Finance** unless a concrete UX complaint reopens this —
    the other three docs agree, and splitting would re-fragment the nav that was just consolidated.

---

## 3. Notes on scope no longer worth pursuing as originally written

- `plan-uiRefactoring`'s full 13-phase/20-week sequencing (committees module, RGPD anonymize
  button, maintenance-log DB table, member-availability DB tables, audit-log page, S3 storage
  config UI, etc.) is still technically "not done," but should be re-scoped from ground truth
  (current nav has 11 groups, not the drawer-only layout originally specified) rather than
  followed phase-by-phase. Treat the remaining-work list above (§2) as the current source of
  truth; consult the original doc only for wireframe/DB-table detail when picking up a specific
  item.
- The literal "drawer menu, no sidebar" layout from `plan-uiRefactoring`'s Principes Directeurs
  was not verified in this pass and may already differ from what was built (current shell uses a
  sidebar-style nav per `navigation.ts` structure, not a confirmed drawer-only pattern) — verify
  actual shell layout before relying on that wireframe.
