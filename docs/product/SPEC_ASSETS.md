# Assets Module Specification

## 1. Purpose

This document defines the target specification for the Assets module of the ERP for a French gliding club association. It consolidates asset lifecycle management (acquisition, maintenance, depreciation, disposal), pricing strategies per asset family with versioning and flight-type variants, stock tracking for consumables, and accounting integration.

## 2. Core Principles

1. **Asset ownership is explicit**: club-owned vs. privately owned (with owner identity).
2. **Pricing is versioned and strategy-based**: differs by asset family, flight type, and time period.
3. **Cost provisioning is automatic**: maintenance/reserve costs accrue based on usage metrics (engine hours, launches, flights, landings).
4. **Monetary precision**: NUMERIC(10,4) in SQL, Decimal/decimal.js in application.
5. **Accounting ledger integration**: all asset transactions generate or reference accounting entries.
6. **Immobilization tracking**: fixed assets carry accounting account mappings for balance-sheet depreciation.
7. **Flight-type pricing**: tow planes, winches support pricing variants (tow vs. ferry, normal vs. cable break).
8. **Consumable stock management**: fuel, maintenance products with FIFO/weighted-average cost methods.

## 3. Domain Model

### 3.1 Asset Family
- `uuid`, `code` (unique), `name`
- `pricing_strategy` (1=FlightHours, 2=EngineTime, 3=PerFlight, 4=PerDuration, 5=PerUnit, 6=FlatRate)
- `is_active`
- `is_priced` — whether this family is expected to carry a flight tariff (`pricing_versions`). Most
  accounting-only families (trailers, refits, engines, ground vehicles, mower) are not priced.
- 4 optional accounting-account references — the **sole** source of GL accounts for every asset in the
  family (assets carry no GL account fields of their own, see §3.3). A trailer and its parent glider get
  different accounts by being assigned to different families (e.g. "Trailers" vs. "Aircrafts"), each with
  its own account set, rather than through a per-asset override:
  - `acquisition_account_uuid` (FK → AccountingAccount, class 2, e.g. 218xx)
  - `depreciation_account_uuid` (FK → AccountingAccount, class 28 — accumulated depreciation, contra-asset;
    NOT the 68x expense account)
  - `charge_account_uuid` (FK → AccountingAccount, class 6 — general expense, e.g. dotation aux amortissements
    681 or maintenance costs)
  - `revenue_account_uuid` (FK → AccountingAccount, class 7)
- Timestamps

### 3.1bis Asset Hierarchy (Parent/Child)
- `assets.parent_asset_uuid` (FK → Asset, nullable, self-referential) — a "main machine" (e.g. a glider) can
  have child assets (trailer, gelcoat/paint refit, engine swap) that are independent accounting items with
  their own depreciation profile, while remaining grouped under the parent for operational/reporting
  purposes. A child is typically assigned to a different asset family than its parent (e.g. a trailer
  belongs to a "Trailers" family, not "Aircrafts") so it automatically posts to that family's GL accounts —
  see §3.3.
- **Depth is strictly 2 levels**: a child asset can never itself become a parent. Enforced at the service
  layer (`_validate_parent_asset_uuid` in `services/assets.py`): a candidate parent must itself have
  `parent_asset_uuid IS NULL`, and an asset that already has children cannot be assigned a parent.
- `assets.is_bookable` (boolean, default `true`) — whether this individual asset can appear in flight
  selection and gets pushed to Planche. Sub-components (trailers, refits, engines) are typically `false`.
  Independent of the family's `is_priced` flag because it is asset-level (e.g. one specific glider under
  long-term restoration could be temporarily non-bookable without touching its family).
- The legacy `AssetCategory` catalog (migration 065) has been removed (migration 066): its 4 GL account
  columns moved directly onto `AssetFamily` (§3.1). A later pass (migration 067) removed the per-asset GL
  account override columns introduced alongside the hierarchy — accounts are configured once, on the
  family, and assets carry only price/depreciation inputs (§3.3).

### 3.2 Flight Type
- `uuid`
- `code` (unique), `name`, `description`
- `is_active`
- Global catalog (not tied to an asset family)
- Examples: TOW, FERRY, TRAINING, NORMAL, CABLE_BREAK, EXERCISE

### 3.3 Asset (Master)
- `uuid`, `asset_family_uuid` (FK)
- `parent_asset_uuid` (FK → Asset, nullable, self-referential, max depth 2 — see §3.1bis)
- `code` (unique, e.g., F-CGVX), `name`, `serial_number`
- `ownership` (1=Club, 2=Private)
- current owners for private assets stored in `AssetPrivateOwner(asset_uuid, member_uuid)`; supports one or many co-owners
- `is_bookable` (boolean, default true — see §3.1bis)
- `purchase_date`, `purchase_price` (NUMERIC(10,4))
- No GL account fields — the asset's family (§3.1) is the sole source of GL accounts
- `status` (1=Operational, 2=Under Maintenance, 3=Out of Service, 4=Disposed, 5=Sold)
- `depreciation_start_date`, `depreciation_years`, `residual_value`
- `is_active`
- Timestamps & `updated_by`

### 3.4 Asset Account Snapshot
- `uuid`, `asset_uuid` (FK), `account_uuid` (FK)
- `account_code`, `account_name` (snapshot)
- `captured_at`

### 3.5 Pricing Version (Unified with Accounting Module)

**Reuses the `PricingVersion` model from SPEC_ACCOUNTING**, with one addition:

- `uuid` (PK)
- `fiscal_year_uuid` (FK → AccountingFiscalYear)
- `name`, `from_date`, `to_date` (date, nullable)
- `status` (1=Draft, 2=Active, 3=Archived)
- `is_locked` (boolean)
- **`asset_family_uuid` (FK → AssetFamily, nullable)** ← if NULL → global/membership pricing; if set → asset-specific pricing
- `created_at`, `updated_at`, `created_by` (FK → User)

Lifecycle and mutability rules:
- Reuse the same state transition matrix and governance defined in `SPEC_ACCOUNTING` for `Draft/Active/Archived`.
- For asset pricing, the operational rule is identical: only `Draft` is editable; `Active` and `Archived` are read-only from a pricing-content perspective.
- Any post-activation change must be implemented by creating a new draft version (copy/edit/activate), not by editing an active or archived version.
- A version already used by billing/accounting flows is permanently frozen against `Active -> Draft` rollback.

**Constraint**: For a given `(asset_family_uuid, fiscal_year_uuid)` pair, pricing versions must not overlap in date ranges.

**Examples**:
- `asset_family_uuid=NULL, from_date=2026-01-01, to_date=2026-12-31`: Membership pricing for 2026
- `asset_family_uuid=<glider-uuid>, from_date=2026-01-01, to_date=2026-06-30`: Glider pricing (first half 2026)
- `asset_family_uuid=<tow-plane-uuid>, from_date=2026-07-01, to_date=NULL`: Tow plane pricing (from July onward)

### 3.6 Pricing Item

**Reuses the `PricingItem` model structure** (from SPEC_ACCOUNTING):

- `uuid` (PK)
- `pricing_version_uuid` (FK)
- `name`, `unit` (1=FlightTime, 2=EngineTimeMin, 3=EngineTime1/100h, 4=FlightDuration, 5=PerFlight, 6=Fixed)
- `metric_code` (string, FK -> BillingMetric): matches usage metrics like `engine_hours`
- `base_price` (NUMERIC(10,4)): implicit bracket at threshold `0`
- `pack_price` (NUMERIC(10,4), nullable): optional unit price when member has an active pack
- `tiers`: progressive brackets stored in `pricing_item_tiers(from_qty, price, sort_order)`; every `from_qty` must be strictly `> 0`
- **`flight_type_uuid` (FK → FlightType, nullable)** ← Only used for asset-specific pricing; NULL for global pricing. Values come from the global flight type catalog.
- `include_insurance`, `include_fuel` (booleans) ← Only meaningful for asset-specific pricing
- `created_at`, `updated_at`

Precision rules:
- prices (`base_price`, `pack_price`, tier `price`) use 2 decimal places
- `from_qty` uses up to 1 decimal place for `FlightTime` and `FlightDuration`
- `from_qty` uses integer values only for `EngineTimeMin`, `EngineTime1/100h`, `PerFlight`, and `Fixed`

**Context-dependent fields**:

| Field | Asset Pricing | Membership Pricing |
|-------|---|---|
| `flight_type_uuid` | Optional (e.g., FERRY, CABLE_BREAK) | Unused (NULL) |
| `include_insurance` | Relevant | Not relevant (NULL/false) |
| `include_fuel` | Relevant | Not relevant (NULL/false) |
| `unit` | FlightTime, EngineTimeMin, EngineTime1/100h, FlightDuration, PerFlight, Fixed | PerFlight, Fixed |

### 3.7 Product / Service
- `uuid`, `code` (unique), `name`
- `category` (Consumable, Service, Fee)
- `unit_type`, `unit_price` (NUMERIC(10,4))
- `asset_family_uuid` (FK, nullable)
- `is_active`
- Timestamps

### 3.8 Stock Item

> **Status: Planned, not yet implemented.** No `StockItem` model, service, route, or frontend component exists in the codebase as of this writing.

- `uuid`, `product_uuid` (FK), `asset_family_uuid` (FK, nullable)
- `quantity_on_hand` (NUMERIC(10,4)), `unit` (liter, unit, etc.)
- `cost_method` (1=FIFO, 2=Weighted Average, 3=Standard Cost)
- `standard_cost_per_unit`, `reorder_point`, `storage_location`
- `last_restocked_date`
- Timestamps

### 3.9 Stock Entry (Ledger)

> **Status: Planned, not yet implemented.** No `StockEntry` model, service, route, or frontend component exists in the codebase as of this writing.

- `uuid`, `stock_item_uuid` (FK)
- `transaction_type` (1=Purchase, 2=Issue, 3=Return, 4=Adjustment, 5=Write-off)
- `quantity_delta` (NUMERIC(10,4)), `unit_cost`
- `reference_document` (e.g., PO-2026-001, FLIGHT-12345)
- `notes`, `transaction_date`
- `created_at`, `created_by` (FK)

### 3.10 Depreciation Schedule

> **Status: Planned, not yet implemented.** The `Asset` model stores depreciation *inputs* (`depreciation_start_date`, `depreciation_duration_months`) and the frontend displays a computed depreciation summary, but there is no `DepreciationSchedule` table, generation/approval/posting workflow, or accounting-entry linkage as described below. The depreciation account itself is resolved from the asset's family (§3.1), not stored per-asset. Since child assets (§3.1bis) are independent `Asset` rows, they already carry their own depreciation inputs — no schema change is needed for a sub-component to have its own amortization clock.

- `uuid`, `asset_uuid` (FK), `fiscal_year_uuid` (FK)
- `depreciation_amount`, `accumulated_depreciation`, `net_book_value` (all NUMERIC(10,4))
- `accounting_entry_uuid` (FK, nullable)
- `status` (1=Draft, 2=Posted)
- Timestamps

## 4. Asset Management Workflow

**Acquisition**: Create asset → if trackable, link to accounting account + generate immobilization entry  
**Usage**: Flight/maintenance triggers pricing lookup → generates revenue entry or stock deduction  
**Cost Provisioning**: Flight metrics (engine hours, launches, landings) trigger cost accrual → auto-generates maintenance reserve entries  
**Depreciation**: Annual cycle at FY start → generate schedules → approve → post to ledger  
**Disposal**: Mark as disposed → compute gain/loss → generate disposal entry

## 5. Pricing and Cost Structure

The Assets module integrates with the Accounting module's **unified pricing and cost provisioning system** (SPEC_ACCOUNTING sections 9 and 11).

### 5.1 Revenue Pricing (Member Charges)

Reuses `PricingVersion` (with optional `asset_family_uuid`) and `PricingItem`:
- **asset_family_uuid = NULL**: Global/membership pricing
- **asset_family_uuid = <asset-uuid>**: Asset-specific pricing (what to charge for flights using this asset)

Example pricing items:
- Glider ASK21, unit=FlightTime, base_price=€45.00, include_insurance=true, include_fuel=false
- Tow Plane, unit=PerFlight, base_price=€120.00, include_fuel=true
- Winch, unit=PerFlight, base_price=€15.00 (charged to member)

Version workflow: Draft → Active (when published) → Archived (when superseded).

Date-range versioning allows in-year price changes (e.g., seasonal summer rates).

### 5.2 Cost Provisioning (Maintenance & Operating Reserves)

Reuses `CostProvisionRule` from SPEC_ACCOUNTING (section 11):
- Automatically accrues maintenance/operating costs based on asset usage
- Examples:
  - Glider engine: €10/engine_hour → Debit 681, Credit 281 (maintenance reserve)
  - Tow Plane: €25/flight_hour → Debit 605, Credit 406 (fuel accrual)
  - Winch: €5/winch_launch → Debit 686, Credit 287 (equipment reserve)

Accrual methods:
- **Real-time**: Posted immediately when flight is recorded (if metric available on-the-fly)
- **Batch-daily**: Aggregated each night
- **Batch-monthly**: Consolidated at month-end close

Integration: When a flight is recorded with asset metrics (engine hours, launches), the cost provisioning system automatically generates accounting entries per active rules.

## 6. Accounting Integration

- **Acquisition**: debit 212 (Fixed Asset), credit 512/530 (Bank/Cash)
- **Flight Revenue**: debit 411 (Member Receivable), credit 706x (Revenue)
- **Cost Provision (Engine Hours)**: debit 681 (Maintenance), credit 281 (Maintenance reserve)
- **Cost Provision (Winch Launches)**: debit 686 (Equipment maintenance), credit 287 (Equipment reserve)
- **Cost Provision (Fuel)**: debit 605 (Fuel costs), credit 406 (Accrued fuel)
- **Depreciation**: debit 68x (Depreciation Expense), credit 28x (Accumulated Depreciation)
- **Disposal**: debit 512 (Bank), debit 28x (Accumulated), credit 212 (Asset), credit 75x/65x (Gain/Loss)
- **Stock Issue**: debit 60x (Expense), credit 3x (Stock Inventory)

## 7. Depreciation (Straight-Line)

**Formula**: (Purchase Price − Residual Value) / Useful Life  
**Annual Generation**: At fiscal year start for all fixed assets  
**States**: Draft → Approve → Posted (immutable)  
**Mid-year Adjustment**: Configurable (full year / half year / prorated monthly)

## 8. API Scope

**Assets**: POST/GET/PATCH /api/v1/assets, /api/v1/assets/families, /api/v1/assets/categories, /api/v1/assets/flight-types  
**Pricing**: POST/GET/PATCH /api/v1/accounting/pricing/versions, /api/v1/accounting/pricing/versions/{version_uuid}/items  
**Cost Provision Rules**: POST/GET/PATCH /api/v1/accounting/cost-provision-rules  
**Cost Accrual Staging**: GET /api/v1/accounting/cost-accrual-staging, POST /api/v1/accounting/cost-accrual-staging/batch-process  
**Stock**: GET /api/v1/assets/stock, POST /api/v1/assets/stock/{item_uuid}/issue|receive, GET /api/v1/assets/stock/ledger  
**Depreciation**: GET /api/v1/assets/{asset_uuid}/depreciation, POST /api/v1/assets/{asset_uuid}/depreciation/approve  
**Products**: CRUD /api/v1/assets/products  
**Pricing Lookup**: GET /api/v1/accounting/pricing/lookup?asset_family_uuid=...&date=...&flight_type_uuid=...

## 9. Cost Provisioning and Maintenance Accounting

### 9.1 Cost Accrual for Flight Operations

Each asset family can have multiple cost provision rules tied to operational metrics:

| Metric | Meaning | Trigger | Example Rule |
|---|---|---|---|
| engine_hours | Hours engine ran | On flight record with engine_hours metric | Glider: €10/hr → 681/281 |
| winch_launches | Number of winch-assisted launches | On winch-launch flight recorded | Winch: €5/launch → 686/287 |
| flight_hours | Total flight time | On flight record | Tow Plane: €25/hr → 605/406 |
| landings | Number of landings | On flight record with landing recorded | Any aircraft: €50/landing → 682/288 |

### 9.2 GL Account Assignment by Asset Family

Per asset family, define which GL accounts are used for cost accrual:

**Gliders:**
- Engine maintenance: Debit 681, Credit 281 (€10/engine_hour)
- Landing wear: Debit 682, Credit 288 (€50/landing)

**Tow Plane:**
- Fuel costs: Debit 605, Credit 406 (€25/flight_hour)
- Engine maintenance: Debit 681, Credit 281 (€8/flight_hour)

**Winch:**
- Launch wear: Debit 686, Credit 287 (€5/winch_launch)

### 9.3 Real-Time vs. Batch Accrual

**Real-time (ACT_REAL_TIME)**:
- Used for metrics available immediately on flight completion (e.g., engine_hours from flight record)
- Cost entry generated synchronously; journal = AC (Auto-Cost)
- Linked to source flight (source_document_ref = flight_uuid)
- Pros: Accurate per-flight cost tracking, no reconciliation needed
- Cons: More entries, potential for real-time cost creep if rules change

**Batch-daily (ACT_BATCH_DAILY)**:
- Used for metrics that need aggregation or validation
- Daily batch job (EOD) runs: lookup all flights from previous day, aggregate metrics per rule per asset, post one entry per rule
- Journal = AC-DAILY (Batch cost)
- Pros: Fewer entries, cleaner GL, easier to reconcile
- Cons: Slight lag (one day), requires validation/audit trail

**Batch-monthly (ACT_BATCH_MONTHLY)**:
- Heaviest aggregation; month-end only
- Used for high-volume operations or when audit trail prefers monthly close
- Journal = AC-MONTHLY (Monthly cost accrual)

### 9.4 Integration with Depreciation and Budget

- Cost provisions flow into maintenance reserve accounts (281, 28x family) — these reserve balances inform depreciation and maintenance scheduling decisions
- Budget module uses prior-year cost accruals (actual or forecast) to project year N+1 maintenance budget
- At fiscal year-end, reserve accounts must reconcile to maintenance schedules (planned vs. actual spend)

### 9.5 Audit Trail

Each CostProvisionRule tracks:
- Rule definition (metric, cost per unit, GL accounts)
- Accrual method
- Fiscal year scope
- Created/updated timestamps and user
- Active flag (can be paused)

Each CostAccrualStaging record (for batch methods) links accrual entry back to rule, source metrics, and posting date.

Real-time accruals are linked via flight_uuid in accounting entry.

## 10. Phased Implementation

| Phase | Goal | Items |
|-------|------|-------|
| 1 | Asset master + depreciation | Asset/Type/DepreciationSchedule models, CRUD, seeding, straight-line calc |
| 2 | Pricing versioning + flight types (unified with accounting) | PricingVersion/Item/FlightType (global catalog), overlap validation, lookup logic |
| 2b | Cost provisioning | CostProvisionRule/CostAccrualStaging, real-time + batch accrual, GL mapping, flight integration |
| 3 | Stock management | StockItem/Entry, FIFO/weighted-avg costing, ledger posting |
| 4 | Flight integration | Asset selection on flights, pricing simulation, revenue + cost entry generation |
| 5 | Acquisition/disposal | Asset acquisition wizard, disposal with gain/loss, bulk import |
| 6 | Reporting | Asset valuation, utilization, stock aging, depreciation forecast, cost accrual reconciliation |

## 11. Permissions

- `MANAGE_ASSETS`: Create/update/delete assets, approve depreciation
- `MANAGE_PRICES`: Pricing CRUD
- `MANAGE_STOCK`: Stock issue/receive
- `VIEW_FINANCIALS`: Read-only views

## 12. Definition of Done

- [ ] Database migrations reversible (deterministic)
- [ ] NUMERIC(10,4) precision used consistently
- [ ] All asset transactions generate accounting entries
- [ ] Cost provision rules generate entries per defined GL mapping
- [ ] Batch cost accrual jobs are idempotent and auditable
- [ ] Capability checks enforced server-side
- [ ] UI reflects locks (locked versions read-only, disposed assets in history only)
- [ ] Regression tests pass for accounting ledger
- [ ] Logging excludes sensitive data
- [ ] Error handling & validation per endpoint documented

## 13. Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|----------|
| Depreciation method change mid-year | Financial restatement | Lock after posting; new methods on new assets only |
| Pricing overlap | Ambiguous charges | DB constraints + UI timeline visualization |
| Stock cost method transition | Inventory valuation jump | Per-item method choice; revalue on transition |
| Private asset tracking gap | Revenue leak | Require at least one current private owner; audit by owner set |
| Flight-type inconsistency | Pricing lookup failures | Seed at install; require selection in UI |
| Cost provision rules forgotten | Incomplete maintenance reserves | Rule audit checklist at fiscal year close |
| Real-time cost creep | Over-accrual if rules change mid-month | Batch methods preferred for stable environments; real-time for predictable metrics |

## 14. CSV Bulk Import

### Endpoint

`POST /api/v1/assets/import`

- Requires `MANAGE_ASSETS` capability.
- Accepts `multipart/form-data` with a single `file` field (`.csv`).
- Encoding: UTF-8 (with or without BOM) or latin-1; auto-detected.

### CSV Format

See `docs/assets-sample.csv` for a reference file.

**Required columns:** `code`, `name`, `asset_family_code`

**Optional columns:** `ownership`, `status`, `year_of_manufacture`, `purchase_price`, `residual_value`, `purchase_date` (YYYY-MM-DD), `depreciation_years`, `useful_life_years`, `depreciation_start_date` (YYYY-MM-DD), `registration`, `serial_number`, `notes`, `parent_asset_code`, `is_bookable`

**Enum values accepted (case-insensitive):**

| Column | Accepted values |
|---|---|
| `ownership` | `1`/`club`, `2`/`private`/`privé` |
| `status` | `1`/`operational`/`opérationnel`, `2`/`maintenance`, `3`/`out_of_service`/`hors_service`, `4`/`disposed`/`cédé` |
| `asset_family_code` | Must match an existing asset family `code` in the database |
| `parent_asset_code` | Optional — must match an existing asset `code` already in the database (see Behavior below) |
| `is_bookable` | `1`/`true`/`yes`/`oui`, `0`/`false`/`no`/`non`; defaults to bookable when omitted |

### Behavior

- Asset families are resolved by `asset_family_code` via a pre-fetched lookup table.
- `parent_asset_code`, when set, is resolved against a pre-fetched map of **already-existing** asset codes — built once before the import loop starts, not refreshed mid-run. A CSV import therefore **cannot create a parent and its child in the same run**: the parent must already exist in the database (either from a prior import or created manually) before a row can reference it as `parent_asset_code`. An unknown `parent_asset_code` produces a row-level error and the row is skipped.
- Each row is validated independently; errors in one row do not block other rows.
- A row that fails validation is **skipped** and its error is reported.
- A row where the `code` already exists is skipped (duplicate).
- No dry-run mode; rows that pass are committed immediately.

### Response

```json
{
  "created": 2,
  "skipped": 1,
  "errors": [
    { "row": 3, "field": "asset_family_code", "message": "Unknown asset_family_code: 'UNKNOWN'" }
  ]
}
```