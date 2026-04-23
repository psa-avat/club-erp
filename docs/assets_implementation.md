# Assets Management Implementation Plan

## 1. Objective

Implement a complete Assets module across backend and frontend, aligned with:
- SPEC_ASSETS for asset lifecycle, depreciation, stock, and operational workflows.
- SPEC_ACCOUNTING for pricing governance, fiscal-year constraints, and accounting posting rules.

This plan explicitly covers asset management and associated pricing.

## 2. Scope

In scope:
1. Asset master data (types, assets, statuses, ownership).
2. Asset-linked pricing (versioned, fiscal-year controlled, date-range controlled).
3. Cost provisioning based on usage metrics (engine hours, winch launches, flight hours, landings).
4. Depreciation schedules and accounting integration.
5. Stock management for consumables and services.
6. Backend APIs and frontend screens.

Out of scope:
1. Full payroll engine.
2. Full VAT engine.
3. Non-essential external orchestration outside current accounting boundaries.

## 3. Core Design Decisions

1. Pricing model is shared with accounting:
	- `pricing_versions` remains the governance table.
	- Add optional `asset_type_uuid` to scope versions for asset pricing.
	- `asset_type_uuid = NULL` means global/non-asset pricing.
2. Cost accrual is rule-driven:
	- `cost_provision_rules` define metric, unit cost, debit account, credit account, and accrual method.
3. Financial integrity is accounting-first:
	- All asset operations with financial impact generate balanced accounting entries.
4. Precision:
	- SQL NUMERIC(10,4), backend Decimal, frontend decimal.js.

## 4. Backend Implementation Plan

### Phase 1 - Asset Master Foundation

Files to implement:
1. `backend/models.py` (assets models)
2. `backend/schemas/assets.py` (new)
3. `backend/services/assets.py` (new)
4. `backend/api/routes/assets.py` (new)
5. `backend/main.py` route wiring

Deliverables:
1. Asset type CRUD (if needed via admin), flight type list/create per asset type.
2. Asset CRUD with validation:
	- unique asset code,
	- private ownership requires owner reference,
	- trackable asset requires accounting account.
3. Asset status transitions:
	- Operational, Under Maintenance, Out of Service, Disposed.
4. Asset account snapshot persistence for audit.

### Phase 2 - Asset Pricing Governance

Deliverables:
1. Extend pricing versioning with `asset_type_uuid`.
2. Add asset pricing items table/fields to support:
	- optional flight type,
	- unit and base price,
	- threshold and pack pricing,
	- include_insurance/include_fuel flags.
3. Service validations:
	- fiscal-year boundary checks,
	- date-range overlap checks per `(fiscal_year_uuid, asset_type_uuid)`.
4. Pricing lookup API for asset/date/flight type.

### Phase 2b - Cost Provisioning

Deliverables:
1. Cost provision rules CRUD.
2. Real-time accrual path and batch accrual path.
3. Batch staging table and idempotent processing.
4. Accounting posting from rules:
	- Debit account from rule,
	- Credit account from rule,
	- source traceability to usage document.

### Phase 3 - Depreciation

Deliverables:
1. Depreciation schedules by asset + fiscal year.
2. Draft then post lifecycle (posted immutable).
3. Straight-line formula implementation with residual value.
4. Link posted schedule to accounting entry.

### Phase 4 - Stock Management

Deliverables:
1. Products/services catalog.
2. Stock items with FIFO or weighted-average method.
3. Stock entries ledger (purchase, issue, return, adjustment, write-off).
4. Stock issue/receive APIs with accounting impact where required.

### Phase 5 - Flight/Usage Integration

Deliverables:
1. Use flight usage metrics for price lookup and cost accrual.
2. Generate draft revenue entries from pricing application.
3. Generate cost accrual entries/staging from cost rules.

## 5. Frontend Implementation Plan

### Module Structure

Create module under:
1. `frontend/src/modules/assets/index.ts`
2. `frontend/src/modules/assets/types.ts`
3. `frontend/src/modules/assets/api/index.ts`
4. `frontend/src/modules/assets/components/*`
5. `frontend/src/modules/assets/store/*` (if needed)

Wire in shell:
1. `frontend/src/App.tsx` route registration.
2. `frontend/src/shell/navigation.ts` menu entry with capability guard.

### Screens

1. Assets list page:
	- filters: type, status, ownership,
	- quick actions for status updates.
2. Asset detail page:
	- lifecycle summary,
	- depreciation summary,
	- linked accounting references.
3. Asset create/edit form:
	- Decimal-safe monetary fields,
	- conditional owner/account fields.
4. Asset pricing page:
	- fiscal year selector,
	- version timeline,
	- version create/edit,
	- pricing items CRUD,
	- overlap validation feedback.
5. Cost provisioning page:
	- rules CRUD,
	- accrual method selection,
	- staging/batch monitor.
6. Stock pages:
	- inventory list,
	- item detail,
	- issue/receive dialogs.

### Frontend Data/State Rules

1. TanStack Query for API data.
2. Respect locked states from backend.
3. decimal.js for all price/amount computations and formatting.
4. i18n keys added in both:
	- `packages/i18n/src/resources/fr.ts`
	- `packages/i18n/src/resources/en.ts`

## 6. Capabilities and Security

Use capability-based authorization, not direct role checks.

Required capabilities:
1. `MANAGE_ASSETS` for asset CRUD, depreciation approvals, stock operations.
2. `MANAGE_PRICES` for asset pricing and cost provisioning rules.
3. `VIEW_FINANCIALS` for read-only accounting-linked asset views.

Backend must enforce checks on every mutating endpoint.

## 7. API Contract Plan

Assets:
1. `POST /api/v1/assets`
2. `GET /api/v1/assets`
3. `GET /api/v1/assets/{asset_uuid}`
4. `PATCH /api/v1/assets/{asset_uuid}`
5. `GET /api/v1/assets/types`
6. `GET /api/v1/assets/types/{type_uuid}/flight-types`

Pricing (accounting-governed):
1. `POST /api/v1/accounting/pricing/versions`
2. `GET /api/v1/accounting/pricing/versions`
3. `PATCH /api/v1/accounting/pricing/versions/{version_uuid}`
4. `POST /api/v1/accounting/pricing/versions/{version_uuid}/items`
5. `GET /api/v1/accounting/pricing/versions/{version_uuid}/items`
6. `GET /api/v1/accounting/pricing/lookup`

Cost provisioning:
1. `POST /api/v1/accounting/cost-provision-rules`
2. `GET /api/v1/accounting/cost-provision-rules`
3. `PATCH /api/v1/accounting/cost-provision-rules/{rule_uuid}`
4. `GET /api/v1/accounting/cost-accrual-staging`
5. `POST /api/v1/accounting/cost-accrual-staging/batch-process`

Stock and depreciation:
1. `GET /api/v1/assets/stock`
2. `POST /api/v1/assets/stock/{item_uuid}/issue`
3. `POST /api/v1/assets/stock/{item_uuid}/receive`
4. `GET /api/v1/assets/{asset_uuid}/depreciation`
5. `POST /api/v1/assets/{asset_uuid}/depreciation`
6. `PATCH /api/v1/assets/{asset_uuid}/depreciation/{schedule_uuid}`

## 8. Validation Rules

1. No overlapping pricing versions for same fiscal year + asset type.
2. Pricing date ranges must be inside fiscal year boundaries.
3. Pack and threshold fields must be complete pairs.
4. Cost rule uniqueness for active rules: `(asset_type_uuid, fiscal_year_uuid, metric_name)`.
5. Cost rule debit and credit accounts cannot be the same.
6. Posted depreciation schedules and posted accounting entries are immutable.
7. Stock on-hand cannot become negative.

## 9. SQL Delivery Plan

Create `docs/assets.sql` as an idempotent schema extension with:
1. `asset_types`
2. `asset_flight_types`
3. `assets`
4. `asset_account_snapshots`
5. `asset_depreciation_schedules`
6. `cost_provision_rules`
7. `cost_accrual_staging`
8. `asset_products`
9. `asset_stock_items`
10. `asset_stock_entries`
11. alter `pricing_versions` add `asset_type_uuid`
12. conditional extension for `pricing_items` if present in target schema

Notes:
1. `docs/account.sql` is treated as canonical accounting schema in this repository.
2. `docs/pg.sql` is a legacy vocabulary reference for pricing strategy names.

## 10. Testing Plan

Backend tests:
1. Asset creation and status transitions.
2. Pricing overlap and fiscal-year range checks.
3. Pricing lookup with and without flight type.
4. Cost accrual real-time and batch idempotency.
5. Depreciation lifecycle immutability.
6. Stock issue/receive boundary checks.

Frontend tests:
1. Capability-gated actions and disabled states.
2. Locked read-only behavior.
3. Decimal inputs and precision handling.
4. Error banner rendering from backend `detail` responses.

## 11. Execution Order (Recommended)

1. SQL foundation in `docs/assets.sql`.
2. Backend models + schemas.
3. Backend services + routes.
4. Frontend API hooks and types.
5. Frontend pages and forms.
6. Integration tests and stabilization.

## 12. Acceptance Criteria

1. Assets and prices can be managed end-to-end via UI and API.
2. Pricing is consistent with accounting governance (fiscal year + versioning + lock behavior).
3. Cost provisioning supports engine hour and winch launch scenarios.
4. All monetary values preserve NUMERIC(10,4) precision.
5. Capability checks are enforced server-side.
6. SQL is idempotent and aligned with existing schema conventions.
