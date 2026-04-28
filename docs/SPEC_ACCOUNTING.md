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
- AC (auto-cost, for cost provision real-time entries)

Journal type enum values:
- 1 = Sale
- 2 = Purchase
- 3 = Bank
- 4 = Cash
- 5 = General
- 6 = Opening
- 7 = Auto-Cost

### 3.4 Pricing Version
- `uuid` (PK)
- `fiscal_year_uuid` (FK → AccountingFiscalYear)
- `name`, `from_date`, `to_date` (date, nullable)
- `status` (1=Draft, 2=Active, 3=Archived)
- `is_locked` (boolean)
- `asset_type_uuid` (FK → AssetType, nullable): if NULL → global/membership pricing; if set → asset-specific pricing
- Timestamps & `created_by`

Pricing lifecycle governance:
- `Draft` is the only fully editable state.
- `Active` is operational and must be treated as immutable for pricing content (items, tiers, prices, GL mapping).
- `Archived` is terminal and read-only.
- `is_locked` remains a technical hard lock and can only tighten permissions; it never expands them.

Pricing version state transition matrix:

| From | To | Allowed | Conditions |
|---|---|---|---|
| Draft | Active | Yes | Validation passes (date coherence, overlap checks, mandatory billing/accounting fields completed). |
| Draft | Archived | Yes | Optional administrative archive of unused draft. |
| Active | Archived | Yes | Allowed for retirement/end-of-life of a version. |
| Active | Draft | Conditional | Allowed only if version has never been used for billing/accounting and only with privileged capability + audit log. |
| Archived | Draft | No | Not allowed; create a new draft by copy instead. |
| Archived | Active | No | Not allowed; create and activate a new draft version. |

Used-once freeze rule:
- The system must track whether a pricing version has already been used by business flows (for example draft accounting entries generated from registration/flight billing).
- Suggested fields: `first_used_at` (timestamp nullable) and/or `usage_count` (integer default 0).
- Once used (`first_used_at` is not NULL or `usage_count > 0`), any transition that re-opens mutability (`Active -> Draft`) is forbidden.

Correction policy after activation:
- If a change is required after activation, create a new `Draft` version (typically copied from the active one), apply edits, then activate the new version with the appropriate validity dates.
- Historical versions already used remain immutable to preserve auditability and reproducibility.

### 3.4 Accounting Entry (Header)

- Belongs to one fiscal year and one journal.
- Carries description, references, and provenance fields.
- State values:
  - 1 = Draft
  - 2 = Posted
  - 3 = Cancelled
- sequence_number is assigned and locked at posting.
- Supports reversal chain via reversal_of_entry_uuid and reversal_reason.

### 3.5 Pricing Item
- `uuid` (PK)
- `pricing_version_uuid` (FK)
- `name`, `unit` (1=FlightTime, 2=EngineTimeMin, 3=EngineTime1/100h, 4=FlightDuration, 5=PerFlight, 6=Fixed)
- `metric_code` (string, FK -> BillingMetric): canonical identifier for usage metrics
- `base_price` (NUMERIC(10,4)): implicit bracket at threshold `0`
- `pack_price` (NUMERIC(10,4), nullable): optional per-unit surcharge applied on top of pack hour cost when member has an active pack
- `age_discount_percent` (NUMERIC(5,2), NOT NULL, default 0): percentage discount applied to this item when the member is under-25 eligible; 0 means no discount
- `gl_account_credit_uuid` (FK → AccountingAccount, nullable): revenue account credited when this item is billed (e.g., `7062` glider flight time, `7063` tow, `7561` annual membership). NULL is allowed during setup; the version activation guard should require it to be set. The debit side (member receivable `411`) is resolved at billing time from the journal/settings default — it is **not** stored on the item.
- `tiers`: progressive brackets stored in `pricing_item_tiers(from_qty, price, sort_order)`; every `from_qty` must be strictly `> 0`
- `flight_type_uuid` (FK → FlightType global catalog, nullable)
- `include_insurance`, `include_fuel` (booleans)
- Timestamps

Precision rules:
- prices (`base_price`, `pack_price`, tier `price`) use 2 decimal places
- `age_discount_percent` uses 2 decimal places and must be between 0 and 100 (inclusive)
- `from_qty` uses up to 1 decimal place for `FlightTime`; integer minutes for `FlightDuration`
- `from_qty` uses integer values only for `EngineTimeMin`, `EngineTime1/100h`, `PerFlight`, and `Fixed`

Age eligibility rule:
- A member is under-25 eligible if their computed age on January 1 of the active fiscal year is strictly less than 25.
- Age is computed from `members.date_of_birth`; if `date_of_birth` is NULL the member is treated as not eligible (no discount applied).
- Eligibility is evaluated at billing time; the discount percentage stored on the item is the source of truth.

### 3.6 Accounting Line

- Belongs to one entry and one account.
- Stores debit and credit in NUMERIC(10,4).
### 3.5 Accounting Line

- Belongs to one entry and one account.
- Stores debit and credit in NUMERIC(10,4).
- Member sub-ledger dimensions:
  - member_uuid
  - member_account_id_snapshot
- Analytical asset dimension:
- analytical_asset_uuid
- Project dimension (future):
  - project_uuid
- Optional tax snapshot fields are preserved when provided.

### 3.6 Project/Special Action Dimension

Special actions (subventions, camps, events) must be reportable across fiscal years.

Decision:
- Keep fiscal-year partitioning on ledger tables.
- Add an optional project dimension on lines (project_uuid).
- Keep project master data in a dedicated module/table.

### 3.7 Recurring Entry Model

Reusable journal structures for periodic or operator-driven entries.

Fields:
- `uuid` (PK)
- `code` (unique short identifier)
- `name`
- `journal_uuid` (FK -> Journal)
- `description` (nullable)
- `default_reference` (nullable)
- `recurrence_type` (enum-like smallint): `1=Manual`, `2=Monthly`, `3=Quarterly`, `4=Yearly`
- `is_active` (boolean)
- `created_at`, `updated_at`, `created_by`

Child lines mirror AccountingLine structure for `account_uuid`, `debit`, `credit`, and optional description.

Rules:
- A model must remain balanced (`sum(debit) == sum(credit)`).
- Models are reusable prefills; they do not post or schedule entries by themselves.
- Operators can still adjust the generated draft before posting.

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
- The journal / ledger screen is visible with `VIEW_FINANCIALS`.
- Entry creation, draft editing, posting, and reversal require `POST_ACCOUNTING_ENTRIES`.
- Recurring entry model CRUD requires `MANAGE_ACCOUNTING_SETTINGS`.

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
  - debit `411` (member receivable, with member dimensions) — resolved at billing time from the journal/settings default receivable account; not stored on the item
  - credit `pricing_items.gl_account_credit_uuid` for each item (e.g., `7061` membership, `7062` flight time, `7063` tow, `707x` misc)
- Analytical tracking: when a flight is the billing source, the billing service stamps `analytical_asset_uuid` on the accounting line using the glider/tow-plane UUID from the flight record. Revenue by aircraft is then a query on `(account_uuid, analytical_asset_uuid)` — no per-aircraft sub-accounts in the chart of accounts are needed.

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

## 11. Cost Provision Rules (Asset Maintenance & Reserve Accrual)

Cost provision rules allow automatic accrual of maintenance, reserve, or operating costs based on asset usage metrics (e.g., engine hours, winch launches). Each rule defines:
- The usage metric (unit type: Hour, Launch, Flight, Landing, etc.)
- The cost per unit
- GL account mapping (flexible per rule)
- Accrual trigger (real-time on event, or batch periodic)

### 11.1 Cost Provision Rule Model

**CostProvisionRule**
- `uuid` (PK)
- `asset_type_uuid` (FK → AssetType): which asset type this rule applies to
- `fiscal_year_uuid` (FK → AccountingFiscalYear): validity scope
- `metric_name` (string, e.g., "engine_hours", "winch_launches", "flight_hours", "landings")
- `cost_per_unit` (NUMERIC(10,4)): cost accrued per metric unit
- `gl_account_debit_uuid` (FK → GLAccount): expense/reserve account (e.g., 681 maintenance, 68x operating)
- `gl_account_credit_uuid` (FK → GLAccount): accrual/reserve account (e.g., 281 maintenance reserve, 486 accrued maintenance)
- `accrual_method` (enum):
  - 1 = **Real-time**: Entry posted immediately when asset event (flight) is recorded
  - 2 = **Batch-daily**: Accrued via daily batch job (e.g., each night)
  - 3 = **Batch-monthly**: Accrued via monthly batch (e.g., month-end close)
- `is_active` (boolean): pause/resume without deleting
- `created_at`, `updated_at`, `created_by` (FK → User)

**Constraint**: For a given `(asset_type_uuid, metric_name, fiscal_year_uuid)` pair, only one active rule may exist.

### 11.2 Integration with Flight Recording

When a flight is recorded with asset metrics (e.g., engine hours, launches):
1. Lookup active CostProvisionRules matching the asset and FY
2. For each rule:
   - Calculate cost accrual: `metric_value × cost_per_unit`
   - If `accrual_method` = Real-time:
     - Generate Draft accounting entry (journal AC or configurable)
     - Debit GL account from rule
     - Credit GL account from rule
     - Link to flight record (source_document_ref = flight_uuid)
   - If `accrual_method` = Batch-*:
     - Aggregate metric in a staging table (see section 11.3)
     - Batch job processes staged accruals

### 11.3 Batch Accrual Staging

For batch accrual methods, maintain a staging table:

**CostAccrualStaging**
- `uuid` (PK)
- `cost_provision_rule_uuid` (FK)
- `asset_uuid` (FK → Asset)
- `metric_date` (date): when metric was recorded
- `metric_value` (numeric): cumulative or incremental (policy TBD)
- `cost_amount` (NUMERIC(10,4)): calculated cost
- `is_accrued` (boolean): whether entry already posted
- `accrual_entry_uuid` (FK → AccountingEntry, nullable)
- `created_at`

Batch job:
- Daily: runs at EOD, groups by rule/asset, creates one entry per rule per asset
- Monthly: runs at month-end, aggregates full month, creates summary entries

### 11.4 GL Account Mapping Examples

| Asset Type | Metric | Cost/Unit | Debit GL | Credit GL | Rationale |
|---|---|---|---|---|---|
| Glider ASK21 | engine_hours | €10 | 681 (Maintenance costs) | 281 (Maintenance reserve) | Accrual for scheduled maintenance |
| Tow Plane | flight_hours | €25 | 605 (Fuel costs) | 406 (Accrued fuel costs) | Variable fuel cost based on hours |
| Winch | winch_launches | €5 | 686 (Equipment maintenance) | 287 (Equipment reserve) | Per-launch wear reserve |
| Glider ASK21 | landings | €50 | 682 (Repairs) | 288 (Repairs accrual) | Landing-related wear |

### 11.5 End-of-Period Close Integration

At fiscal year-end:
1. All batch-accrued costs must be posted (no pending staging rows)
2. Reserve GL accounts (28x) should reconcile to physical asset maintenance schedules
3. Accrual method can be overridden for final month-end (e.g., force batch→real-time for close clarity)

## 12. Special Actions and Subventions

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
- GET /api/v1/accounting/entries
- POST /api/v1/accounting/entries
- GET /api/v1/accounting/entries/{entry_uuid} (with fiscal_year_uuid)
- PUT /api/v1/accounting/entries/{entry_uuid} (draft only)
- PATCH /api/v1/accounting/entries/{entry_uuid}/post
- POST /api/v1/accounting/entries/{entry_uuid}/reverse
- GET /api/v1/accounting/entry-models
- GET /api/v1/accounting/entry-models/{template_uuid}
- POST /api/v1/accounting/entry-models
- PATCH /api/v1/accounting/entry-models/{template_uuid}
- DELETE /api/v1/accounting/entry-models/{template_uuid}

Implemented UI surface:
- Banque -> Journal et grand livre
- Browse entries by fiscal year / journal / state / text search
- Create entries from scratch
- Prefill entries from pricing items
- Prefill entries from recurring entry models
- Save drafts, post drafts, and reverse posted entries
- Create and maintain recurring entry models

### 14.2 Next Accounting-Adjacent Endpoints

- Module settings endpoints (per module, capability-scoped).
- Pricing lifecycle endpoints (year + date-range versioning).- Cost provision rule CRUD/list endpoints (asset type + fiscal year scoped).
- Cost accrual staging and batch job monitoring endpoints.- Budget lifecycle/reporting endpoints.
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
5. Cost provision rules (metric, GL accounts, accrual method) are explicit and flexible.
6. Budget and project/subvention requirements are linked to accounting dimensions.
7. Flight-sync accounting workflow is explicit and auditable.
8. Capability-based authorization expectations are explicit.

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
- [x] Build pricing management screen for fiscal year with version timeline.
- [ ] Integrate registration workflow to select applicable price items and preview accounting outcome.

Permissions and security:
- [ ] Restrict settings editing to MANAGE_ACCOUNTING_SETTINGS (and module-specific capability as needed).
- [ ] Restrict price management to MANAGE_PRICES.

Testing and release:
- [ ] Add pricing overlap and fiscal-year mismatch tests.
- [ ] Add end-to-end test for registration -> draft accounting entry generation.

### Phase 2b: Cost Provision Rules (New)

Goal: enable automatic maintenance/reserve cost accrual based on asset usage metrics.

Backend and database:
- [ ] Create CostProvisionRule and CostAccrualStaging tables.
- [ ] Implement cost accrual service (real-time and batch methods).
- [ ] Add daily and monthly batch job schedulers for batch-accrued costs.
- [ ] Implement GL account mapping per asset type.

API and contracts:
- [ ] Add cost provision rule CRUD/list endpoints (scoped to asset type + fiscal year).
- [ ] Add batch job trigger and status endpoints.
- [ ] Add cost accrual staging query/reconciliation endpoints.

Frontend:
- [ ] Build cost provision rule management UI (per asset type).
- [ ] Build batch job monitoring dashboard (pending vs. posted accruals).
- [ ] Show cost accrual history on asset detail views.

Permissions and security:
- [ ] Restrict rule management to MANAGE_PRICES or dedicated capability.
- [ ] Restrict batch job execution to privileged users.

Testing and release:
- [ ] Add tests for real-time and batch cost accrual.
- [ ] Add end-to-end test for flight with metrics → cost entry generation.
- [ ] Add batch job idempotency tests.

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
- [ ] Track E (Assets): Asset master + Phase 2b cost provision rules (depends on Phase 2b backend).
