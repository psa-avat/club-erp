# Accounting Module Specification

## 1. Purpose

This document defines the target specification for the Accounting module of the ERP for a French gliding club association.

It consolidates:
- current implemented V1 ledger behavior,
- existing database design decisions (including fiscal-year partitioning),
- new business requirements impacting accounting (global settings, pricing linkage, budget lifecycle, projects/subventions, employee scheduling costs, and flight synchronization).

Accounting is the financial source of truth and must preserve strict auditability.

## 2. Core Principles

1. Double-entry ledger is mandatory: for each entry, total debit equals total credit.
2. French PCG (association-oriented) drives chart-of-accounts structure.
3. Fiscal year is explicit and first-class; it is not inferred only from entry date.
4. Draft-first workflow is allowed for review; posted entries are immutable.
5. Corrections on posted entries are represented by reversal/correction entries only.
6. Monetary precision uses NUMERIC(10,4) in SQL and Decimal/decimal.js in backend/frontend.
7. Historical imports preserve original meaning and provenance, then become immutable.

## 3. Domain Model

### 3.1 Fiscal Year

- Identified by UUID, business code, and year.
- Defines start_date and end_date boundaries.
- State values: Open (1), Closed (2), Reopened (3).
- Controls posting authorization and partition lifecycle.

### 3.2 Account (Chart of Accounts)

- Hierarchical code structure (for example 4, 41, 411).
- Account type enum values:
  - 1 = Asset
  - 2 = Liability
  - 3 = Equity
  - 4 = Expense
  - 5 = Revenue
- Supports posting-allowed/grouping behavior, reconciliation flag, archive state, and replacement account.

### 3.3 Journal

Minimum journal codes:
- VT (sales)
- HA (purchases)
- BQ (bank)
- CS (cash)
- OD (misc operations)
- AN (opening/carry-forward)

Journal type enum values:
- 1 = Sale
- 2 = Purchase
- 3 = Bank
- 4 = Cash
- 5 = General
- 6 = Opening

### 3.4 Accounting Entry (Header)

- Belongs to one fiscal year and one journal.
- Carries description, references, and provenance fields.
- State values:
  - 1 = Draft
  - 2 = Posted
  - 3 = Cancelled
- sequence_number is assigned and locked at posting.
- Supports reversal chain via reversal_of_entry_uuid and reversal_reason.

### 3.5 Accounting Line

- Belongs to one entry and one account.
- Stores debit and credit in NUMERIC(10,4).
- Member sub-ledger dimensions:
  - member_uuid
  - member_account_id_snapshot
- Analytical asset dimension:
  - analytical_asset_uuid
- Optional tax snapshot fields are preserved when provided.

### 3.6 Project/Special Action Dimension

Special actions (subventions, camps, events) must be reportable across fiscal years.

Decision:
- Keep fiscal-year partitioning on ledger tables.
- Add an optional project dimension on lines (project_uuid).
- Keep project master data in a dedicated module/table.

## 4. Ledger Rules

1. debit >= 0 and credit >= 0.
2. Each line has at least one non-zero amount.
3. entry_date must be inside fiscal year boundaries.
4. Entry must be balanced (sum debit = sum credit) before posting.
5. Draft entries can be updated (header and lines).
6. Posted entries and lines are immutable.
7. Business cancellation is represented through reversal entries.
8. Fiscal-year reopen is privileged and auditable.

## 5. Partitioning and Integrity

accounting_entries and accounting_lines are partitioned by LIST(fiscal_year_uuid).

Implications:
- Composite primary keys on partitioned tables: (uuid, fiscal_year_uuid).
- Composite line-to-entry foreign key: (entry_uuid, fiscal_year_uuid).
- Parent-table indexes propagate to year partitions.
- Master tables (fiscal years/accounts/journals) are not partitioned.

Partition lifecycle:
1. Create year-specific partitions when fiscal year opens.
2. Move rows from default partition to year partition when required.
3. Optionally archive closed-year partitions to read-only storage.

## 6. Security and Permissions

Authorization is capability-based.

Accounting-relevant capabilities:
- VIEW_FINANCIALS
- POST_ACCOUNTING_ENTRIES
- MANAGE_PRICES
- MANAGE_BUDGET
- MANAGE_ACCOUNTING_SETTINGS

Controls:
- Posting and fiscal-year close/reopen require privileged capability checks.
- Sensitive integration credentials must not be logged in clear text.

## 7. Global Settings

A central settings model is required for module-level configuration.

Decision:
- Add system_settings table with:
  - module_name (unique key)
  - settings (JSONB)
  - audit timestamps/user fields

Usage:
- Each module owns one settings section.
- Each module exposes an interface to manage its own settings.
- Accounting reads only relevant keys (posting options, numbering, exports, integrations).

## 8. PCG Seed Strategy (Association)

The database must be seeded with a practical association-focused PCG subset.

Requirements:
- Preserve hierarchy and account-type mapping.
- Mark grouping accounts as non-postable.
- Include minimum operational coverage:
  - member receivables (411)
  - bank/cash (512, 530)
  - membership/flight revenues (706x)
  - fuel/maintenance/insurance expenses (60x, 61x)
  - subvention/fonds dedies flow (194, 689, 789)
  - optional boutique/meals flow (607x/707x) when needed

VAT:
- Keep VAT account support and tax snapshot fields for historical compatibility.

## 9. Pricing and Registration Linkage

### 9.1 Price Versioning Decision

Prices are versioned with from_date/to_date and associated to fiscal year.

Decision:
- Keep both fiscal_year_uuid and date range.

Rationale:
- fiscal_year_uuid enforces annual accounting governance,
- date range supports in-year price changes with full traceability.

### 9.2 Subscription Workflow Impact

During member registration:
- User selects one or more applicable price items.
- System generates a Draft accounting entry in journal VT.
- Canonical accounting pattern:
  - debit 411 (with member dimensions)
  - credit applicable revenue accounts (7061, 7062, 7063, 707x, etc.)

## 10. Budget Management

Budget is a dedicated module with tight accounting integration.

Requirements:
1. Year N+1 budget is prepared during year N.
2. Initial budget can be derived from previous actuals.
3. At fiscal-year opening, selected prepared budget is activated/copied as current budget.
4. In-year budget revisions require dedicated capability.
5. KPI and reports compare actual vs budget by account and optional dimensions.

Data model direction:
- Budget lines should mirror accounting dimensions where possible:
  - fiscal_year_uuid
  - account_uuid
  - optional project_uuid
  - optional analytical_asset_uuid

## 11. Special Actions and Subventions

Special actions are project-centric budgets and accounting flows.

Requirements:
- Link budget lines and accounting lines to projects.
- Support multi-year follow-up of grants/subventions.
- Provide reports for project budget, actual, variance, and carry-forward.

## 12. Employees and Schedule Financial Impact

Employee scheduling is a separate module, but accounting integration is required.

Requirements affecting accounting:
- Employee identity may be linked to member identity (hybrid member/employee profiles).
- Leave/work-hour events can feed payroll/cost accrual accounting workflows.
- Employee financial data access is restricted by capability.

Committees and events:
- Committees can create events in a shared schedule visible to members.
- Events with financial impact (for example meals) follow standard draft-to-posted accounting flow.

## 13. Flight Synchronization Financial Workflow

Flights are sourced from an external FastAPI application.

Target workflow:
1. Synchronize pilots/assets as required.
2. Pull validated flights into ERP.
3. Preserve validated flights as billable evidence.
4. Generate draft sales accounting entries based on ERP pricing rules.
5. Send selected activity data to external tracking systems.
6. Track outbound send status flags and sync/reporting errors.

Settings requirements:
- Store endpoints, credentials, retry policy, and feature flags in module settings.

## 14. API Scope

### 14.1 Implemented V1 Accounting Endpoints

- POST /api/v1/accounting/fiscal-years
- GET /api/v1/accounting/fiscal-years
- GET /api/v1/accounting/accounts
- GET /api/v1/accounting/journals
- POST /api/v1/accounting/entries
- GET /api/v1/accounting/entries/{entry_uuid} (with fiscal_year_uuid)
- PUT /api/v1/accounting/entries/{entry_uuid} (draft only)
- PATCH /api/v1/accounting/entries/{entry_uuid}/post

### 14.2 Next Accounting-Adjacent Endpoints

- Module settings endpoints (per module, capability-scoped).
- Pricing lifecycle endpoints (year + date-range versioning).
- Budget lifecycle/reporting endpoints.
- Project/subvention reporting endpoints.
- Flight sync monitoring and error reporting endpoints.

### 14.3 Validation Error Contract Examples

V1 accounting endpoints return FastAPI standard error envelopes:

- `{"detail": "<human-readable message>"}`

Examples for posting and fiscal-year violations:

```json
{
  "detail": "Cannot post entry into closed fiscal year FY2026"
}
```

```json
{
  "detail": "Entry is not balanced: debit=10.0000 != credit=9.0000"
}
```

```json
{
  "detail": "Entry date 2027-01-01 is outside fiscal year [2026-01-01, 2026-12-31]"
}
```

```json
{
  "detail": "Can only reopen a closed fiscal year (state=2), current=1"
}
```

The OpenAPI operation definitions for V1 accounting endpoints include these examples under `400`, `404`, and `409` responses.

## 15. Audit and Traceability

Mandatory:
- immutable posted records,
- deterministic posting numbering,
- provenance fields for imports,
- reversible correction chain,
- user/action timestamps.

Recommended hardening:
- entry_hash sealing at posting,
- verification tooling for integrity checks.

## 16. Out of Scope for V1 Core Ledger

Handled by dedicated modules/services (must remain accounting-compatible):
- full payroll engine,
- full VAT computation engine,
- advanced stock valuation,
- external orchestration beyond sync status and draft generation.

## 17. Specification Acceptance Criteria

1. No contradictory enum/state/field definitions.
2. Draft/post immutability and reversal policy are explicit.
3. Fiscal-year partitioning constraints are explicit and technically consistent.
4. Pricing decision (fiscal year + date range) is explicit.
5. Budget and project/subvention requirements are linked to accounting dimensions.
6. Flight-sync accounting workflow is explicit and auditable.
7. Capability-based authorization expectations are explicit.

## 18. Phased Implementation Checklist

This checklist translates the specification into executable work packages.

### Phase 1: Ledger Hardening and Baseline Data

Goal: finalize the accounting core as a stable platform for dependent modules.

Backend and database:
- [ ] Verify all accounting enums and state transitions are consistent in models, schemas, and SQL.
- [x] Enforce posting immutability and draft-only update behavior with tests.
- [x] Confirm fiscal-year boundary and balance validation at service and SQL levels.
- [x] Ensure partition creation/migration routine exists for fiscal-year opening.
- [x] Add and validate PCG seed loader for association-focused account subset.

API and contracts:
- [x] Stabilize V1 accounting endpoints and response payloads.
- [x] Add validation error contract examples for posting and fiscal-year violations.

Frontend:
- [ ] Complete draft-entry create/edit/post flow with explicit read-only state after post.
- [ ] Show clear posting validation errors and immutable-state UI locks.

Permissions and security:
- [x] Enforce capability checks for post/close/reopen operations.
- [x] Audit log all privileged accounting actions.

Testing and release:
- [x] Add integration tests for create draft, update draft, post, and reversal chain.
- [x] Add seed verification test (required account codes available and postability flags correct).

### Phase 2: Global Settings and Pricing Governance

Goal: make module configuration and pricing lifecycle operationally manageable.

Backend and database:
- [x] Create system_settings table (module_name, settings JSONB, audit fields).
- [x] Implement settings service with per-module schema validation.
- [x] Implement pricing versioning with both fiscal_year_uuid and from/to range constraints.

API and contracts:
- [x] Add settings endpoints with module-scoped read/update operations.
- [x] Add pricing CRUD/list endpoints with overlap checks for date ranges.

Frontend:
- [x] Build settings screens per module section.
- [ ] Build pricing management screen for fiscal year with version timeline.
- [ ] Integrate registration workflow to select applicable price items and preview accounting outcome.

Permissions and security:
- [ ] Restrict settings editing to MANAGE_ACCOUNTING_SETTINGS (and module-specific capability as needed).
- [ ] Restrict price management to MANAGE_PRICES.

Testing and release:
- [ ] Add pricing overlap and fiscal-year mismatch tests.
- [ ] Add end-to-end test for registration -> draft accounting entry generation.

### Phase 3: Budget Lifecycle and KPI Reporting

Goal: support annual preparation, in-year revisions, and variance reporting.

Backend and database:
- [ ] Add budget tables aligned with accounting dimensions (fiscal year, account, optional asset/project).
- [ ] Implement initialize-from-actuals routine.
- [ ] Implement activate-prepared-budget at fiscal-year opening.
- [ ] Implement revision model (version or change log) for in-year controlled adjustments.

API and contracts:
- [ ] Add endpoints for prepare, activate, revise, and reporting queries.
- [ ] Add KPI endpoints for actual vs budget by account, asset, and project.

Frontend:
- [ ] Build budget preparation UI for N+1 during year N.
- [ ] Build revision workflow UI and variance dashboards.
- [ ] Add export/report view for finance committee.

Permissions and security:
- [ ] Restrict revisions to MANAGE_BUDGET.
- [ ] Keep budget publication/activation auditable.

Testing and release:
- [ ] Add tests for initialization, activation, revision authorization, and KPI correctness.

### Phase 4: Projects/Subventions and Employee Cost Signals

Goal: track special actions across years and prepare HR-linked financial data.

Backend and database:
- [ ] Add project master table and optional project_uuid dimensions on budget and accounting lines.
- [ ] Implement project-level carry-forward and subvention reporting views.
- [ ] Define employee-to-member linkage policy for hybrid profiles.
- [ ] Define accounting hooks for leave/work-hour events to payroll/accrual staging.

API and contracts:
- [ ] Add project CRUD/list and project financial reporting endpoints.
- [ ] Add employee schedule event APIs needed by downstream accounting hooks.

Frontend:
- [ ] Build project/subvention tracking screens with multi-year view.
- [ ] Build restricted employee section for schedule and activity inputs.

Permissions and security:
- [ ] Restrict employee section and data access to dedicated capability.
- [ ] Restrict project budget/subvention edits to authorized users.

Testing and release:
- [ ] Add tests for project multi-year aggregation and access control.

### Phase 5: Flight Synchronization and External Dispatch Monitoring

Goal: automate billing inputs from validated flights and monitor integration reliability.

Backend and database:
- [ ] Implement flight sync adapters (pilots/assets push, validated flights pull).
- [ ] Store validated flights as auditable billable sources.
- [ ] Implement pricing application engine for flight-generated draft accounting entries.
- [ ] Add outbound dispatch queue/status flags for external tracking systems.

API and contracts:
- [ ] Add sync trigger/status/error endpoints.
- [ ] Add reconciliation endpoints (flight totals vs generated accounting entries).

Frontend:
- [ ] Build sync monitoring dashboard (last run, errors, pending retries).
- [ ] Build review screen for generated draft entries before posting.

Permissions and security:
- [ ] Restrict sync execution and connector setting updates to authorized capabilities.
- [ ] Protect credentials in settings and operational logs.

Testing and release:
- [ ] Add contract tests for external API adapters.
- [ ] Add end-to-end tests for validated flight -> draft entry generation -> posting.

## 19. Cross-Phase Definition of Done

Each phase is complete only when all conditions below are true:
- [ ] Database migration scripts are deterministic and reversible.
- [ ] API contracts are documented and backward compatibility is respected unless explicitly approved.
- [ ] Capability checks are enforced server-side and covered by tests.
- [ ] UI states reflect backend locks (especially posted and closed-year constraints).
- [ ] Monitoring/logging is actionable and excludes sensitive secrets.
- [ ] Regression tests pass for accounting create/update/post/reversal critical paths.

## 20. Suggested Execution Order by Team Track

To parallelize delivery with low risk:
- [ ] Track A (Backend/Core): Phase 1 then Phase 2 backend items.
- [ ] Track B (Frontend): Phase 1 screens then settings/pricing UI from Phase 2.
- [ ] Track C (Data/Finance): PCG seed validation and budget model from Phase 3.
- [ ] Track D (Integrations): Flight sync foundation from Phase 5 once Phase 2 settings are available.

