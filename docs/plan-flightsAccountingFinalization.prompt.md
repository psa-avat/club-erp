# Plan: Finalize Flights Accounting — Billing, Pack Consumption & Daily Ops Integration

## TL;DR

Add the billing **apply** step that turns previews into **Draft** accounting entries (with explicit manual posting after review), introduce a proper **pack catalog + member-owned consumable packs** system (including multiple 25h packs per pilot), and build the **flights tab** in Daily Operations as the central UI cockpit.

---

## Design Decisions

| Decision | Choice |
|---|---|
| **Discount realization** | Discounts are **decoupled from flight billing**. Flights are billed at gross price in FL journal. Discounts are tracked in `member_pack_consumptions` and applied via periodic REM adjustment entries |
| **Pack model** | **Catalog + consumable packs** — define reusable pack templates (ex: `PACK_25H`) linked to pricing items via `pack_applicability` with `discounted_unit_price`. Pack purchases tracked natively in GL |
| **Pack pricing** | `pack_applicability` links a pack definition to a `pricing_item` with a `discounted_unit_price`. Discount = `base_price − discounted_unit_price` |
| **Pack tracking** | `member_pack_consumptions` operational table — one row per flight line consuming pack units. Balance computed via `vw_member_pack_balances` view crossing GL purchases with consumptions |
| **Pack scope** | Packs scoped by `pack_type` (`flight_hours` / `winch_launches` / `tow_launches` / `engine_time`); each scope discounts matching pricing items |
| **Fiscal year boundary** | Packs scoped to one fiscal year. Remaining quantities reset to 0 at year-end — no carry-over |
| **REM journal** | Dedicated journal (code `REM` / `DISC`, type = General) for discount adjustments. One Draft entry per pilot per period, updated as discounts accumulate |
| **Pack discount accounting** | Pack sale revenue stays in class 7 via `pack_sales_account_uuid`; REM discounts debit a class 6 expense account via `pack_discount_expense_account_uuid`. The pack operating result is read as class 7 pack sales minus class 6 pack discount expenses |
| **Billing configurability** | Each pack definition carries its own sales account (`pack_sales_account_uuid`) and discount expense account (`pack_discount_expense_account_uuid`, normally class 6). Operational settings (period, tolerance) live in `system_settings`. Journals FL/REM are hardcoded — no dedicated table |
| **Post-purchase** | Allowed — system recalculates `member_pack_consumptions` and updates the REM Draft entry |
| **Freeze/exclude** | `is_frozen` flag on `member_pack_consumptions` rows; frozen consumptions excluded from REM calculation |
| **Posting policy** | FL entries can be posted independently. REM entries remain Draft until period close (monthly/quarterly) |
| **Alerts** | Evaluate combined net of gross FL entry + REM adjustment — never gross alone |

---

## Phases

### Phase 1 — Data Models & Migration

**Steps** (all parallel — schema only, no logic):
1. Create `pack_definitions` table (catalog model)
   - `uuid`, `code` (unique), `name`
   - `fiscal_year_uuid` (FK)
   - `pack_type` (varchar: `flight_hours`|`winch_launches`|`tow_launches`)
   - `quantity_allowance` (Numeric(10,2)) — ex: `25.0000` hours for a 25h pack
   - `quantity_unit` (varchar: `hours`|`launches`)
   - `eligible_asset_type_uuid` (FK → asset_types, nullable — restricts which asset types this pack applies to)
   - `pack_sales_account_uuid` (FK → accounting_accounts, nullable — override of default; credit side for pack purchase revenue)
   - `pack_discount_expense_account_uuid` (FK → accounting_accounts, nullable — override of default; debit side for REM pack discount expense, normally class 6)
   - `flights_journal_uuid` (FK → accounting_journals, nullable override)
   - `priority` (int, optional tie-breaker when multiple pack definitions match)
   - `created_at`
2. Create `pack_applicability` table (link pack → pricing_item with discounted price)
   - `uuid`, `pack_definition_uuid` (FK)
   - `pricing_item_uuid` (FK → pricing_items)
   - `discounted_unit_price` (Numeric(10,4)) — the unit price with discount (e.g. €20 instead of €100)
   - unique constraint (`pack_definition_uuid`, `pricing_item_uuid`)
   - `created_at`
3. Create `member_pack_consumptions` table (operational discount tracking)
   - `uuid`, `member_uuid` (FK), `flight_uuid` (FK → validated_flights)
   - `pack_type` (varchar: `flight_hours`|`winch_launches`|`tow_launches`|`engine_time`)
   - `quantity_consumed` (Numeric(5,2)) — qty consumed from pack for this flight
   - `discount_unit_price` (Numeric(10,2)) — `base_price − pack_price`
   - `total_discount_amount` (Numeric(10,2)) — `qty × discount_unit_price`
   - `accounting_entry_uuid` (FK → accounting_entries, nullable — REM entry link)
   - `is_frozen` (Boolean, default false), `frozen_at`, `frozen_reason`
   - `created_at`, `updated_at`
   - Index: `(member_uuid, pack_type)`
4. Create `vw_member_pack_balances` view (not a table)
   - Crosses GL pack purchases (`accounting_lines` × `pack_definitions.pack_sales_account_uuid`) with `member_pack_consumptions`
   - Returns: `member_uuid, pack_type, total_purchased, total_consumed, units_remaining`
   - See SPEC §5.5 for the full SQL definition
5. Add `accounting_entry_uuid` to `validated_flights` (nullable FK → accounting_entries — FL entry link)
6. Ensure REM journal exists in `accounting_journals` (code `REM` or `DISC`, type = General)
7. Store operational settings in `system_settings` (module `flight_billing`):
   - `discount_period_days` — period length for REM adjustment (default 30 for monthly)
   - `allow_post_purchase_recalculation` — true by default
   - `max_days_for_post_purchase_discount` — 30
   - `require_approval_for_late_discount` — true
   - *Accounts (`pack_sales_account_uuid`, `pack_discount_expense_account_uuid`) live on each `pack_definitions` row — no redundant global settings*

**Verification**: Migration SQL runs cleanly; new tables are empty; existing flights table migration adds nullable columns.

---

### Phase 2 — Backend Billing Configuration & Pack Management Service

**Steps** (depends on Phase 1, can be parallelised):
1. Add helpers to read/write flight billing settings from `system_settings`:
   - `get_flight_billing_setting(db, key)` → returns value with fallback
   - `update_flight_billing_setting(db, key, value)` — upserts into `system_settings` module `flight_billing`
   - `GET/PUT /api/v1/settings/flight-billing` — API endpoints for settings CRUD
   - *No dedicated table — settings live in `system_settings`*
2. Create `backend/services/flight_packs.py` with:
   - `create_pack_definition(db, payload, user_id)` — defines catalog packs (ex: 25h glider)
   - `manage_pack_applicability(db, pack_definition_uuid, applicable_items, user_id)` — links pricing items with their pack-discounted price
   - `record_pack_consumption(db, member_uuid, flight_uuid, pack_type, quantity_consumed, discount_unit_price, total_discount_amount)` — inserts a row in `member_pack_consumptions`
   - `get_member_pack_balance(db, member_uuid, fiscal_year_uuid, pack_type=None)` — queries `vw_member_pack_balances` view
   - `compute_rem_adjustment(db, member_uuid, fiscal_year_uuid, period_start, period_end)` — sums `total_discount_amount` for non-frozen consumptions in period
   - `upsert_rem_entry(db, member_uuid, fiscal_year_uuid, rem_journal_uuid, pack_discount_expense_account_uuid, total_discount, period_start, period_end)` — creates or updates the single Draft REM entry for this pilot/period (the `pack_discount_expense_account_uuid` is read from the applicable pack definition)
   - `freeze_consumption(db, consumption_uuid, reason)` / `unfreeze_consumption(db, consumption_uuid)`
3. Refactor `FlightBillingPreviewService` to compute `member_pack_consumptions` as a **post-billing step**: the FL entry is created at gross price; then eligible lines are checked against `pack_applicability` and `vw_member_pack_balances` to compute discount amounts. The GL is not modified at this stage
4. Add pack purchase accounting entry creation helper:
   - `create_pack_purchase_entry(db, member, amount, pack_sales_account_uuid, user_id)` → creates **posted** entry (VT journal):
     - Debit `411` (member dimension) for total amount
     - Credit `pack_sales_account_uuid` (from the pack definition)
   - *Pack purchases are posted immediately — the GL is the source of truth for pack balances*
   - Pack purchases credit a class 7 revenue account; later REM discounts debit a class 6 expense account so pack margin is visible as 7 minus 6.

**Verification**: Unit tests for billing config CRUD, pack definition + applicability CRUD, consumption recording, REM adjustment computation and upsert, pack purchase entry creation (posted).

---

### Phase 3 — Backend Billing Apply & REM Adjustment

**Steps** (depends on Phase 1 & 2):
1. Extend `FlightBillingPreviewService` → new `FlightBillingApplyService` in `backend/services/flight_billing_apply.py`:
   - `apply_flight_billing(flight_uuid, fiscal_year_uuid, user_id)`:
     1. Loads billing settings from `system_settings`
     2. Runs preview at **gross price** (reuses `_preview_one` with `base_price` — no pack adjustment in the FL entry)
     3. Creates a **Draft accounting entry in FL journal** with gross amounts:
        - Debit `411` (member) for `qty × base_price`
        - Credit `706x` (revenue) for `qty × base_price`
     4. Links the FL entry to the flight (`accounting_entry_uuid`)
     5. Computes eligible pack discounts and inserts rows in `member_pack_consumptions`
     6. Calls `upsert_rem_entry()` to create or update the single Draft REM entry for this pilot/period
   - `post_flight_billing(flight_uuid, fiscal_year_uuid, user_id)` — Posts the **FL** Draft entry (calls existing `post_accounting_entry`)
   - `batch_apply(flight_uuids, fiscal_year_uuid, user_id)` — Apply multiple flights in a transaction (FL Draft + consumptions + REM upsert)
   - `close_rem_period(fiscal_year_uuid, period_end, user_id)` — Posts all REM Draft entries for the period, opens new Drafts for the next period
2. Add API endpoints in `backend/api/routes/flights.py`:
   - `POST /{flight_uuid}/billing-apply` — Apply (gross FL Draft + consumption + REM upsert)
   - `POST /{flight_uuid}/billing-post` — Apply + Post FL entry
   - `POST /billing-batch-apply` — Batch apply
   - `POST /billing-batch-post` — Batch post FL entries
3. Add REM adjustment endpoints in `backend/api/routes/accounting.py`:
   - `POST /accounting/rem-adjustments/preview` — Preview REM adjustment for a pilot/period
   - `POST /accounting/rem-adjustments/apply` — Create or update the REM Draft entry
   - `POST /accounting/rem-adjustments/close-period` — Post all REM Drafts, open new ones

**Verification**: Integration test: preview → apply → verify FL entry at gross price → verify `member_pack_consumptions` rows created → verify REM Draft entry upserted with correct total discount.

---

### Phase 4 — Daily Operations: Flights Tab (Backend)

**Steps** (parallel with Phase 3):
1. Add flight-specific endpoints in `backend/api/routes/flights.py`:
   - `GET /billable-flights` — list flights ready for billing (not yet applied) within a date range
   - `GET /pending-billing-summary` — aggregate stats (count, total, warnings) for a date range
2. Add pack purchase endpoint:
   - `POST /members/{member_uuid}/packs` — buy a pack (creates posted VT entry + updates GL)
   - `GET /members/{member_uuid}/packs` — list pack balances (from `vw_member_pack_balances`) and consumption detail
3. Add endpoint to freeze/exclude a pack consumption from REM calculation:
   - `POST /pack-consumptions/{consumption_uuid}/freeze`
   - `POST /pack-consumptions/{consumption_uuid}/unfreeze`

**Verification**: API responses return correct data shapes; tests for each endpoint.

---

### Phase 5 — Daily Operations: Flights Tab (Frontend)

**Steps** (depends on Phase 4):
1. Create `frontend/src/modules/banque/components/OpsFlightsTab.tsx`:
   - **Header**: date range picker + "Sync from Planche" button + "Calculate" button + "Post All" button
   - **Flights list**: table with columns: date, pilot, glider, type, total (preview), status (pending/applied/posted), actions
   - **Row expand**: click to see detail — payers, applied lines, accounting lines, and pack consumptions
   - **Bulk actions**: select flights → "Preview" → "Apply" → "Post"
   - **Warnings/errors**: color-coded badges for each flight (e.g., pricing missing = red, pack applied = blue)
   - **Net display**: each flight row shows the gross amount. A separate "Discounts" panel shows the current period's REM adjustment per pilot, with link to `member_pack_consumptions` detail.
2. Integrate component into `BanqueDailyOpsPage.tsx` — replace `flights` tab placeholder with `<OpsFlightsTab />`
3. Add pack purchase form (modal/dialog) for quick pack purchase:
   - Member selector, pack definition selector (includes 25h packs), quantity multiplier, "Buy Pack" → creates posted VT entry
4. Add REM period management panel: view current period Drafts, close period, open new period
5. Add translations in `frontend/src/modules/banque/i18n/` (French + English)
6. Add API client calls in `frontend/src/modules/banque/api/`

**Alert trigger safety**: Balance checks must evaluate the **combined** net of the gross FL entry + the current REM Draft adjustment — never the gross alone.

**Verification**: UI renders; can select flights, preview at gross, apply; REM panel shows per-pilot adjustment; can close period.

---

### Phase 6 — Post-Purchase & Recalculation

**Steps** (depends on Phase 3, parallel with Phase 4-5):
1. Backend: `recalculate_pack_consumptions(flight_uuid, fiscal_year_uuid, user_id)`:
   - Deletes existing `member_pack_consumptions` rows for this flight (if any)
   - Re-runs discount eligibility against current `vw_member_pack_balances`
   - Inserts new `member_pack_consumptions` rows
   - Calls `upsert_rem_entry()` to update the pilot's REM Draft entry with the new total
   - *The FL entry is untouched — only the REM adjustment is updated*
2. Backend: `batch_recalculate(flight_uuids, fiscal_year_uuid, user_id)`:
   - Same logic as single recalc but in a transaction
3. Backend: `handle_post_purchase_pack(member_uuid, pack_type, fiscal_year_uuid, user_id)`:
   - After a pack purchase is recorded in the GL, identifies all already-billed flights for that member in the same FY eligible for this `pack_type`
   - Calls `recalculate_pack_consumptions()` for each eligible flight
   - Updates the REM Draft entry for the pilot
4. **Launch pack support**: The recalc engine respects `pack_type` — a winch-launch pack only discounts launch lines
5. UI: 
   - "Recalculate discounts" button on flight detail panel
   - "Buy pack" quick action when a flight has eligible lines at full price
   - "Refresh REM adjustment" after pack purchase (recalculates consumptions + updates REM Draft)

**Verification**: 
- Flight with 1h glider at gross €100, member buys 25h pack → recalculate → verify `member_pack_consumptions` row with `discount_unit_price=80`
- Flight with winch launch, member buys winch pack → recalculate → verify consumption on launch line only
- REM Draft entry updated correctly after batch recalculate
- Multiple packs of same type consumed FIFO, verified via `vw_member_pack_balances`

---

### Phase 7 — Freeze/Exclude & Manual Overrides

**Steps** (depends on Phase 2):
1. Backend: `freeze_pack_consumption(consumption_uuid, reason)` — sets `is_frozen=true` on a `member_pack_consumptions` row; triggers REM Draft update
2. Backend: `unfreeze_pack_consumption(consumption_uuid)` — re-includes; triggers REM Draft update
3. Backend: `update_rem_after_freeze(member_uuid, fiscal_year_uuid)` — recomputes the pilot's total discount and upserts the REM Draft entry
4. UI: Toggle switch in flight detail panel to freeze/unfreeze a consumption row
5. UI: When frozen, show "Consumption excluded — discount removed from REM" with reason tooltip

**Verification**: Freeze a consumption → verify it's excluded from REM total → unfreeze → verify reincluded.

---

### Phase 8 — Member External Access (Self-Service Portal)

**Steps** (depends on Phase 3, parallel with Phase 4-7):

**Context**: The ERP already has a token-based `expense_access` mechanism on `MemberSheet`. This phase extends that concept into a full self-service view where members can see their billing, flight log, and account movements without needing an ERP user account.

1. **Backend — Public/Token-authenticated endpoints** (new router `backend/api/routes/member_portal.py`, no capability guard, uses token auth):
   - `POST /api/v1/member-portal/login` — Accepts a member identifier + expense access token, returns a short-lived JWT
   - `GET /api/v1/member-portal/flights` — List the member's flights with billing status and amounts (date, glider, type, total charged, pack consumption if any)
   - `GET /api/v1/member-portal/flights/{flight_uuid}/billing` — Detail of one flight billing (applied lines, accounting lines, pack consumptions)
   - `GET /api/v1/member-portal/account` — Account summary (current balance, active packs per type, pending/posted entries)
   - `GET /api/v1/member-portal/account/entries` — List accounting entries where the member appears (filterable by year, state)
2. **Backend — Expense access token management** (enhance existing `expense_access`):
   - Add `member_portal_enabled` flag alongside `expense_access_enabled` (or reuse the existing one)
   - Token can be regenerated (existing endpoint) and distributed to the member via email/print
3. **Frontend — Standalone member portal app** (new route group outside the shell, no auth guard):
   - `frontend/src/modules/member-portal/` — new module
   - Login page: member identifier + token input → obtain JWT → store in session-only storage
   - Dashboard view: active packs with remaining quantities, last 5 flights, account balance
   - Flights list: paginated table with billing detail expand
   - Account entries: ledger view of posted entries affecting the member
   - Uses the same `decimal.js` and formatting utilities as the main app
   - Styled with Tailwind + shadcn, mobile-friendly (members may use phones)
4. **Security rules**:
   - Token is hashed in DB (existing `_hash_token` pattern), never stored in plain text
   - JWT expires in 2 hours; refresh requires re-login
   - Read-only: no mutation endpoints in the portal
   - Rate-limited: max 30 requests/minute per token

**Accounting visibility rule**:
- Member portal must display each billed flight with its **gross** FL entry and the associated `member_pack_consumptions` rows.
- A separate "Discounts" section shows the current period's REM adjustment and the net balance after discounts.
- `vw_member_pack_balances` is exposed so members can see remaining pack units per type.

**Verification**:
- Enable expense access for a member → generate token → log in via portal → see flights, billing, account
- Invalid token → 401
- Expired token → 401 with clear message
- Flights from other members → not visible

---

### Phase 9 — Machine Financial Dashboard

**Steps** (depends on Phase 3 & 5, can start after billing apply works):

1. **Backend — Aggregation endpoint**:
    - `GET /api/v1/assets/{asset_uuid}/financial-summary?fiscal_year_uuid=...`:
       - `total_debit` — sum of debit lines where `analytical_asset_uuid = asset`
       - `total_credit` — sum of credit lines where `analytical_asset_uuid = asset`
       - `pack_purchases_total` — sum of pack purchase amounts linked to this asset type
       - `pack_consumed_quantity_total` — total quantity consumed from packs for this asset's flights
       - `flight_count` — number of billed flights using this asset
    - `GET /api/v1/assets/{asset_uuid}/financial-detail?fiscal_year_uuid=...`:
       - Returns paginated list of accounting entries where `analytical_asset_uuid = asset`
       - Each entry: entry date, description, sequence number, debit, credit, member, flight UUID
    - `GET /api/v1/assets/financial-summary?fiscal_year_uuid=...` — aggregated for **all** machines:
       - Returns a list: `[{asset_code, asset_name, total_debit, total_credit, pack_purchases, pack_consumed_quantity, flight_count}, ...]`
       - Sorted by asset code, filterable by asset type
2. **Frontend — Dashboard view** in the accounting section:
   - New component: `frontend/src/modules/banque/components/MachineFinancialDashboard.tsx`
   - **Summary table**: rows = machines, columns = code, name, total debit, total credit, pack purchases, pack consumed qty, net, flight count
   - **Sparkline/bar**: mini visual comparison of debit vs credit per machine
   - **Click-to-drill-down**: clicking a row navigates to a detail view:
     - Detail table: list of accounting entries with analytical dimension = this machine
     - Each row: date, entry ref, description, debit, credit, member
     - Links to the original accounting entry and to the flight
   - **Fiscal year selector** (reuses existing `useFiscalYearStore`)
   - **Export**: CSV export of the summary table
3. **Navigation**:
   - Add a "Machines" entry in the accounting sidebar/navigation
   - Or place it as a dedicated tab within the Daily Ops dashboard

**Verification**:
- After billing a few flights for different machines, the dashboard shows correct totals per machine
- Drill-down shows the correct accounting entries
- CSV export contains expected data
- Pack purchases and consumed quantities are correctly attributed

---

## Relevant Files

| File | What to do |
|---|---|
| `backend/models.py` | Add `PackDefinition`, `PackApplicability`, `MemberPackConsumption` models. Add `vw_member_pack_balances` migration |
| `backend/services/flight_packs.py` | **NEW** — Pack definition + applicability CRUD, consumption recording, REM adjustment computation, upsert, freeze logic |
| `backend/services/flight_billing.py` | Refactor preview to compute gross amounts; add eligibility check for `member_pack_consumptions` as post-billing step |
| `backend/services/flight_billing_apply.py` | **NEW** — Gross FL entry creation + consumption recording + REM upsert |
| `backend/services/accounting.py` | Add flight billing settings helpers in `system_settings` module + REM entry helpers |
| `backend/api/routes/flights.py` | Add apply/post/batch + consumption + freeze + recalculate + REM adjustment endpoints |
| `backend/api/routes/accounting.py` | Add REM preview/apply/close-period endpoints |
| `backend/api/routes/settings.py` | Add flight billing settings GET/PUT (or reuse existing system_settings routes) |
| `backend/schemas/flights.py` | Add `FlightBillingApplyRequest/Response`, consumption schemas, billing config schemas |
| `frontend/src/modules/banque/components/BanqueDailyOpsPage.tsx` | Wire `flights` tab to real component |
| `frontend/src/modules/banque/components/OpsFlightsTab.tsx` | **NEW** — Full flights billing cockpit with gross display + REM panel |
| `frontend/src/modules/banque/components/PackPurchaseDialog.tsx` | **NEW** — Modal for quick pack purchase |
| `frontend/src/modules/banque/components/RemPeriodPanel.tsx` | **NEW** — REM period management (view Drafts, close period) |
| `frontend/src/modules/banque/api/` | Add flight billing + REM + config API calls |
| `frontend/src/modules/banque/i18n/` | Add translations for flights ops + REM |
| `backend/services/flight_billing.py` | Add `recalculate_pack_consumptions()`, `batch_recalculate()`, `handle_post_purchase_pack()` |
| `backend/api/routes/member_portal.py` | **NEW** — Public token-authenticated endpoints for member self-service |
| `backend/services/members.py` | Extend expense access token management |
| `frontend/src/modules/member-portal/` | **NEW** — Standalone member self-service module |
| `frontend/src/modules/banque/components/MachineFinancialDashboard.tsx` | **NEW** — Per-machine financial summary with drill-down |

---

## Verification Plan

1. **Unit tests**: pack definition CRUD, pack_applicability CRUD, consumption recording, REM adjustment computation, REM upsert, freeze/unfreeze
2. **Integration test**: full cycle — Planche sync → preview (gross) → apply → verify FL entry at gross price → verify `member_pack_consumptions` rows → verify REM Draft entry upserted → close period → verify REM entry posted
3. **UI manual test — Daily Ops**: Flights tab → select flights → preview (gross) → apply → verify REM panel updates → buy pack → recalculate → verify REM adjustment updated → close REM period
4. **UI manual test — Machine dashboard**: After billing flights for multiple machines, dashboard shows correct aggregates → drill-down → entries match
5. **UI manual test — Member portal**: Enable expense access → login with token → see own gross flights + discount detail + pack balances
6. **Edge cases**: shared flight (partage) with pack for one pilot only; post-purchase covering an already-billed flight; freeze then unfreeze; fiscal year rollover (pack balances reset to 0)
7. **REM period boundary**: close period → verify entries posted → new period opens with zero balance → new flights create new Draft REM entries

---

## Scope Boundaries

**Accounting Control Note**:
- Costs advanced by members must go through the expense-report (`note de frais`) workflow before reimbursement. Direct bank reimbursement is out of scope and should be refused, especially when the supplier invoice is not issued to the club or clearly to the reimbursed member.

**Included**:
- Pack catalog with `pack_definitions` + `pack_applicability` (link to pricing items with discounted price)
- Pack purchase accounting (411 → pack_sales_account) and discount expense (6xx → pack_discount_expense_account) — both configured per pack definition
- Gross billing in FL journal, discount tracked via `member_pack_consumptions` operational table
- REM journal for periodic discount adjustment entries (one Draft per pilot per period, upserted)
- `vw_member_pack_balances` view for live pack balance computation
- Launch method packs: winch and tow launches tracked separately from flight hours
- Fiscal year scoping: packs expire at year-end, balances reset to 0
- Post-purchase recalculation and batch recalculation
- Freeze/exclude individual consumption rows
- Daily ops flights tab as central UI hub (gross entries + REM panel)
- Billing configuration UI per fiscal year
- Member self-service portal (token-based, read-only: flights, discounts, account)
- Machine financial dashboard (credit/debit per asset, pack purchases, consumed quantities, drill-down)

**Excluded** (future):
- Batch pricing version management within the flights tab
- Automated recurrent (monthly) billing runs
- Member invoice PDF generation (separate feature)
- Integration with helloasso for pack purchase payment collection
- Cost provision rules per flight (provision for tow/glider costs)
- Pack expiration or validity windows beyond fiscal year
- Multi-factor auth for the member portal
- Push notifications for new bills or pack exhaustion
