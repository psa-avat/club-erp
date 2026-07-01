# Documentation Index

This directory is organized by audience/purpose. When in doubt about current product behavior, `product/` is the source of truth — everything in `archive/` is historical only.

## `product/` — Product definition (living specs)

Actively maintained functional specifications. Reflects intended and (mostly) shipped behavior; kept in sync with the codebase.

| File | Covers |
|------|--------|
| `SPEC_MAIN.md` | Module inventory, menu structure, production vs. planned status |
| `SPEC_MEMBERS.md` | Members, committees, registrations, member sheets, portal |
| `SPEC_ACCOUNTING.md` | Fiscal years, PCG accounts, journals (incl. REM), pricing versions, pack link table |
| `SPEC_ASSETS.md` | Assets/machines, families, categories, pricing, stock & depreciation (planned sections flagged) |
| `SPEC_FLIGHTS_BILLING.md` | Planche import, flight billing lifecycle, FL/REM posting, pack FIFO consumption, billing hash |
| `SPEC_ROLES_CAPABILITIES.md` | Roles, capabilities catalogue, 2FA, role/capability matrix |

## `manual/` — End-user documentation

| File | Covers |
|------|--------|
| `USER_GUIDE.md` | Full end-user guide across all modules, FAQ (French) |

## `developer/` — Architecture & dev guidance

| File | Covers |
|------|--------|
| `ARCHITECTURE_GLOBAL_FISCAL_YEAR.md` | Global fiscal-year Zustand store shared across modules |

See also: `frontend/DESIGN_SYSTEM.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`.

## `operations/` — Maintenance references

| File | Covers |
|------|--------|
| `mapping_journal.md` | Journal → PCG account mapping reference (all 8 journals incl. REM) |

See also: `docs/migrations/*.sql` (numbered schema migrations), `deploy/README.md`.

## `plans/` — Active plans (real, unbuilt or partially-built work)

Each doc below has been verified against the current codebase; only plans with genuine remaining scope live here. Status tables inside each file indicate what's done vs. pending.

| File | Remaining scope (high level) |
|------|-------------------------------|
| `assets_implementation.md` | Stock/depreciation phases (2b–4) |
| `plan-accounting-daily.md` | AP flow, refund arbitrage queue, payroll OD wizard, reminders |
| `plan-accountingModuleGapClosure.prompt.md` | Global FY selector in `shell/components/Header.tsx` |
| `PLAN_ACCOUNTING_UXUI_IMPLEMENTATION.md` | Design reference backing the gap-closure plan above |
| `plan-bankReconciliation.prompt.md` | Entire bank statement import/matching engine — not started |
| `plan-dashboard-summary-amended.md` | Real `/dashboard/summary` endpoint — not started, dashboard still mocked |
| `plan-encryptSensitiveJsonSettings.prompt.md` | Field-level encryption for HelloAsso/Planche secrets — not started (security gap) |
| `plan-flightsAccountingFinalization.prompt.md` | Discount review, machine financial dashboard, scheduled ops |
| `plan-hr_and_planning_implementation.md` | Leave workflow, attendance validation, committee-linked planning |
| `plan-importflights.md` | Billing-quote/correction workflow layer |
| `plan-membersModuleRefactoring.prompt.md` | Expenses, Volunteer Fiscal, Documents tabs |
| `plan-membersUxSplitByCategoryGroup.prompt.md` | Core/External/Business member screen split — not started |
| `plan-phase0-frontend-foundation.md` | `packages/ui` component suite, i18n nav completion (Storybook was intentionally removed, not pending — see note in the doc) |
| `plan-planche-integration-phase1.md` | `FlightCharges` model + split-charge/multi-beneficiary billing |
| `plan-synchro-ffvp-osrt.md` | `GesAssoSyncPage.tsx` batch member-sync page |
| `ui-refactoring.md` | Consolidated nav/dashboard/visual-harmonization/portal work (replaces 4 prior overlapping docs) |

## `archive/` — Superseded / completed (historical reference only)

Not maintained. Kept for design rationale and history. Includes:

- Original PRDs (`PRD_*.md`, `PRD GESTION CLUB*.md`) — superseded by `product/` specs.
- Completed build plans (`plan-recurringAccounting`, `plan-symplifyMembers`, `plan-viworkflow`, `plan-plancheErpIntegration`, `MEMBERS_UI`) — fully shipped.
- One-time audits/checklists (`a11y-audit-phase0`, `ux-audit-phase1`, `ASSESSMENT_MEMBER_REGISTRATION_FLOW`, `CHECKLIST_ACCOUNTING_IMPLEMENTATION`, `EXECUTIVE_SUMMARY_ACCOUNTING_UXUI`, `CHALLENGE_ACCOUNTING_UXUI_DESIGN`) — findings already acted on or absorbed elsewhere.
- Superseded UI-refactor sources (`plan-uiRefactoring.prompt.md`, `plan-ux-ui-navigation.md`, `plan-visualHarmonization.prompt.md`, `ERP_UI_Refactoring.md`) — consolidated into `plans/ui-refactoring.md`.
- Misc superseded (`PROMPT_MIGRATION_DESIGN.md`, `compta.md`, `Flight_Billing_Specification_And_User_Manual.md`, `ai-agents-prompt.md`) — content merged into `product/` specs or fully redundant with `.claude/CLAUDE.md`.

## Other assets in `docs/`

SQL references (`*.sql`), sample CSVs, and standalone HTML guides (`GUIDE_VI.html`, etc.) were left in place at the `docs/` root — out of scope for this markdown reorganization pass.
