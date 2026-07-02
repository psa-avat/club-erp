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

1. Pricing behavior is item-driven:
	- Pricing calculation is defined by pricing items, not by asset type.
	- One asset type may have multiple pricing items using different billing metrics in the same fiscal period.
2. Shared metric vocabulary across pricing and cost provisioning:
	- Introduce a canonical billing metric catalog.
	- Pricing items and cost provision rules both reference `metric_code` from this shared catalog.
3. Asset type remains classification-focused:
	- Asset type stores category and operational metadata only.
	- Remove `pricing_strategy` from asset type to avoid ambiguity.
4. Optional defaults are UX-only:
	- Asset type may define default metrics for form prefill.
	- Defaults never constrain billing logic.
5. Financial integrity is accounting-first:
	- All asset operations with financial impact generate balanced accounting entries.
6. Precision:
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
1. Extend pricing versioning with `asset_type_uuid` (NULL = global version).
2. Pricing item fields:
	- optional `flight_type_uuid` filter,
	- `unit` billing unit (1=FlightTime, 2=EngineTimeMin, 3=EngineTime1/100h, 4=FlightDuration, 5=PerFlight, 6=Fixed),
	- `base_price` — standard price per unit for the implicit threshold `0`,
	- `pack_price` — nullable, price per unit when pilot has an active pack subscription,
	- `tiers` — child table `pricing_item_tiers` (from_qty, price, sort_order); evaluated as progressive brackets during flight billing and starting strictly above `0`.
3. Numeric precision rules:
	- prices (`base_price`, `pack_price`, `tier.price`) use 2 decimal places,
	- hour-based thresholds (`tier.from_qty` for FlightTime/FlightDuration) use up to 1 decimal place,
	- engine/count-based thresholds (`tier.from_qty` for EngineTimeMin, EngineTime1/100h, PerFlight, Fixed) use integer values only.
4. Tier semantics: `base_price` is the implicit bracket at `0`; explicit brackets are sorted ascending by `from_qty`, and the flight module picks the last bracket whose `from_qty <= cumulated consumption`. Example: `base=18€, 3→9€, 5→0€`.
5. Service validations:
	- fiscal-year boundary checks,
	- date-range overlap checks per `(fiscal_year_uuid, asset_type_uuid)`.
6. Pricing lookup API for asset/date/flight type using metric-aware item selection.
7. Support multiple metrics for a single asset type/version (for example: flight hour plus engine hour).

### Phase 2b - Cost Provisioning

Deliverables:
1. Cost provision rules CRUD using `metric_code` from the same billing metric catalog.
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
4. Unified pricing management page (`/pricing`):
	- fiscal year selector,
	- version timeline grouped by: global versions + per asset type,
	- version create/edit (optional asset_type_uuid selector),
	- pricing items CRUD:
		- base price + optional pack price (price with active pack),
		- inline multi-tier bracket editor (add/remove rows with from_qty + price),
		- optional flight type filter per item,
	- overlap validation feedback.
	Note: `/assets/:uuid/pricing` links to `/pricing?asset_type_uuid=xxx`.
5. Cost provisioning page:
	- rules CRUD with same metric catalog as pricing items,
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
8. `GET /api/v1/accounting/pricing/versions/{version_uuid}/items` (eager-loads tiers)
9. `PATCH /api/v1/accounting/pricing/items/{item_uuid}`
10. `DELETE /api/v1/accounting/pricing/items/{item_uuid}`
11. `PUT /api/v1/accounting/pricing/items/{item_uuid}/tiers` (replace full tier list atomically)
12. `GET /api/v1/accounting/pricing/lookup`
13. `GET /api/v1/accounting/billing-metrics`

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
3. `pack_price`, when set, must be a non-negative decimal.
4. Tier `from_qty` values must be unique per item and strictly greater than `0`; `base_price` defines the implicit base bracket.
5. Cost rule uniqueness for active rules: `(asset_type_uuid, fiscal_year_uuid, metric_code)`.
6. Cost rule debit and credit accounts cannot be the same.
7. Posted depreciation schedules and posted accounting entries are immutable.
8. Stock on-hand cannot become negative.
9. Pricing item `metric_code` must exist in billing metrics catalog.
10. Asset type default metrics, if configured, are UX defaults only and never pricing constraints.

## 9. SQL Delivery Plan

Create `docs/assets.sql` as an idempotent schema extension with:
1. `asset_types`
2. `asset_flight_types`
3. `assets`
4. `asset_account_snapshots`
5. `asset_depreciation_schedules`
6. `billing_metrics` (new canonical catalog)
7. `asset_type_default_metrics` (optional)
8. `cost_provision_rules` (metric_code based)
9. `cost_accrual_staging`
10. `asset_products`
11. `asset_stock_items`
12. `asset_stock_entries`
13. alter `pricing_versions` add `asset_type_uuid`
14. alter `pricing_items`:
	- add `pack_price NUMERIC(10,4) NULL`,
	- remove `threshold_unit_count`, `threshold_price` (migrated to tiers),
	- add `metric_code` and backfill from legacy `unit`.
15. create `pricing_item_tiers` (uuid, pricing_item_uuid FK CASCADE, from_qty, price, sort_order).
16. alter `cost_provision_rules` migrate `metric_name` to `metric_code`.
17. remove `asset_types.pricing_strategy` after compatibility window.

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
2. Backend models + schemas with compatibility fields.
3. Backend services + routes with dual-read migration support.
4. Frontend API hooks and types migrated to `metric_code`.
5. Frontend pages and forms migrated to shared metric selector.
6. Remove deprecated fields after compatibility window.
7. Integration tests and stabilization.

## 12. Acceptance Criteria

1. Assets and prices can be managed end-to-end via UI and API.
2. Pricing is consistent with accounting governance (fiscal year + versioning + lock behavior).
3. Cost provisioning supports engine hour and winch launch scenarios.
4. All monetary values preserve NUMERIC(10,4) precision.
5. Capability checks are enforced server-side.
6. SQL is idempotent and aligned with existing schema conventions.
7. A single asset type can be priced with multiple metrics in the same pricing version.
8. Pricing items and cost provision rules use the same metric vocabulary.
9. Asset type does not carry pricing behavior fields.

## 13. 2026-07 Refactor: Category/Family Collapse & Asset Hierarchy

This section is an addendum, not a rewrite — Phase 1 above still documents the original build decisions
(including the Category/Family split introduced by migration 065), and this section documents what
superseded it. See `docs/migrations/066_family_gl_accounts_and_asset_hierarchy.sql` for the schema change.

**Why:** In practice every asset family mapped to exactly one category, so the extra level added a UI/data
hop without adding flexibility. Meanwhile there was no way to model a "main machine" (e.g. a glider) with
sub-components (trailer, gelcoat/paint refit, engine swap) that are distinct accounting items — different
PCG account, different depreciation clock — while still belonging operationally to one asset.

**What changed:**
- `AssetCategory` is removed. Its 4 GL account columns (acquisition/depreciation/charge/revenue) moved
  directly onto `AssetFamily` as defaults (1:1 data copy during migration, no data loss).
- `AssetFamily.is_priced` (new): explicit flag for whether the family is expected to carry a flight tariff.
  Most accounting-only families (trailers, refits, engines, ground vehicles, mower) are not priced.
- `Asset.parent_asset_uuid` (new): self-referential FK, strictly 2 levels deep, enforced in
  `services/assets.py::_validate_parent_asset_uuid`.
- `Asset.is_bookable` (new): whether the asset can appear in flight selection / gets pushed to Planche.
  Sub-components are typically non-bookable.
- `Asset.depreciation_account_uuid` / `charge_account_uuid` / `revenue_account_uuid` (new): per-asset GL
  overrides mirroring the existing `acquisition_account_uuid`, falling back to the family default when null.
- CSV bulk import gained optional `parent_asset_code` and `is_bookable` columns (§14 of SPEC_ASSETS.md).

Pricing (`PricingVersion`/`PricingItem`) is unchanged — still scoped by `asset_family_uuid`, unaffected by
this refactor. Depreciation *calculation/posting* (Phase 3 above) remains unimplemented; unrelated to this
change other than the account column move.
