# Plan: Finalize Flights Accounting — Billing, Pack Discounts & Daily Ops Integration

## TL;DR

Add the billing **apply** step that turns previews into posted accounting entries, introduce a proper **member pack** system with per-flight discount tracking, separate the discount as a contra accounting line, and build the **flights tab** in Daily Operations as the central UI cockpit.

---

## Design Decisions

| Decision | Choice |
|---|---|
| **Discount entry** | Single contra pair within the **same** flight journal entry (credit 411, debit discount_account), not a separate entry |
| **Pack model** | **Subscription / access-right** — fixed price for a pass, grants a % discount on all eligible flights for the fiscal year. No per-hour allowance to consume |
| **Pack tracking** | New `member_packs` table stores price, discount_percent, pack_type. `flight_pack_consumptions` tracks which flight benefited from which pack |
| **Pack scope** | Packs have a `pack_type` — `flight_hours`, `winch_launches` or `tow_launches`. Each scope discounts the corresponding pricing item |
| **Fiscal year boundary** | Packs are scoped to one fiscal year and expire at year-end. No carry-over |
| **Billing configurability** | Billing configuration (discount account, posting settings) is scoped **per fiscal year** via a new `flight_billing_configs` table, not global system_settings |
| **Post-purchase** | Allowed — system recalculates when a pack is bought after the flight date, including launch packs |
| **Freeze/exclude** | `is_frozen` flag on `flight_pack_consumptions`; frozen consumptions excluded from balance and discount calculation |

---

## Phases

### Phase 1 — Data Models & Migration

**Steps** (all parallel — schema only, no logic):
1. Create `member_packs` table (subscription/access-right model)
   - `uuid`, `member_uuid` (FK), `fiscal_year_uuid` (FK)
   - `pack_type` (varchar: `flight_hours`|`winch_launches`|`tow_launches`)
   - `price` (Numeric(10,4)) — fixed price paid for the pass
   - `discount_percent` (Numeric(5,2)) — e.g. 80.00 = 80% off base price
   - `purchase_entry_uuid` (FK → accounting_entries, nullable)
   - `pack_account_uuid` (FK → accounting_accounts, nullable — per-pack override of FY discount account)
   - `created_at`
2. Create `flight_pack_consumptions` table (audit trail of which flight used which pack)
   - `uuid`, `flight_uuid` (FK → validated_flights), `member_uuid` (FK)
   - `member_pack_uuid` (FK → member_packs), `source` (`flight`|`launch`)
   - `pack_discount_amount` (Numeric(10,4)) — discount = base_price × qty × (discount_percent/100)
   - `is_frozen` (Boolean, default false), `frozen_at`, `frozen_reason`
   - `created_at`
3. Create `flight_billing_configs` table (configuration **per fiscal year**)
   - `uuid`, `fiscal_year_uuid` (FK, unique)
   - `discount_account_uuid` (FK → accounting_accounts, e.g. 7066) — the account credited for pack discounts
   - `flights_journal_uuid` (FK → accounting_journals, default = FL journal)
   - `updated_at`, `updated_by`
   - *Note: no `post_automatically` flag — posting is always manual after member review*
4. Add `billing_quote_uuid` to `validated_flights` (nullable FK → new flight_billing_quotes table)
5. Create `flight_billing_quotes` table (persists preview results)
   - `uuid`, `flight_uuid` (FK), `billing_hash`, `total_amount`, `fiscal_year_uuid` (FK)
   - `state`: `quoted`, `applied`, `superseded`, `corrected`
   - `applied_lines_json` (JSONB), `accounting_lines_json` (JSONB), `discount_lines_json` (JSONB)
   - `accounting_entry_uuid` (FK → accounting_entries, nullable)
   - `created_at`

**Verification**: Migration SQL runs cleanly; new tables are empty; existing flights table migration adds nullable columns.

---

### Phase 2 — Backend Billing Configuration & Pack Management Service

**Steps** (depends on Phase 1, can be parallelised):
1. Create billing configuration CRUD in `backend/services/accounting.py` (or new `flight_billing_configs.py`):
   - `get_or_create_flight_billing_config(db, fiscal_year_uuid)` — return existing or create with defaults
   - `update_flight_billing_config(db, config_uuid, updates)` — update discount account, journal, etc.
   - `GET/PUT /api/v1/accounting/fiscal-years/{fiscal_year_uuid}/flight-billing-config` — API endpoints
2. Create `backend/services/flight_packs.py` with:
   - `create_member_pack(db, member_uuid, pack_type, price, discount_percent, purchase_entry_uuid, user_id)` — creates a subscription pass
   - `list_member_packs(db, member_uuid, fiscal_year_uuid, pack_type=None)` — filterable by pack_type
   - `get_active_packs_for_member(db, member_uuid, year, pack_type)` → returns list of active (non-frozen) packs for this scope, with their discount_percent
   - `find_best_discount(db, member_uuid, year, pack_type)` → highest discount_percent among active packs of this type (or 0 if none)
   - `freeze_consumption(db, consumption_uuid, reason)` / `unfreeze_consumption(db, consumption_uuid)`
3. Refactor `FlightBillingPreviewService` to query active packs for each payer and compute discount as `base_amount × (best_discount_percent / 100)` instead of the old hours-based consumption logic
4. Add pack purchase accounting entry creation helper:
   - `create_pack_purchase_entry(db, member, pack_uuid, units, unit_price, discount_account_uuid, fiscal_year_uuid, user_id)` → creates Draft entry:
     - Debit `411` (member dimension) for total amount
     - Credit `discount_account_uuid` (from billing config, or pack override if set)

**Verification**: Unit tests for billing config CRUD, pack CRUD (all types), discount percent resolution (best discount wins), pack purchase entry creation.

---

### Phase 3 — Backend Billing Apply & Discount Separation

**Steps** (depends on Phase 1 & 2):
1. Extend `FlightBillingPreviewService` → new `FlightBillingApplyService` in `backend/services/flight_billing_apply.py`:
   - `apply_preview(flight_uuid, fiscal_year_uuid, user_id)`:
     1. Loads billing config for the fiscal year (discount account, journal UUID)
     2. Runs preview (reuses `_preview_one`)
     3. Persists the quote to `flight_billing_quotes`
     4. Creates a **single Draft accounting entry** in the configured flights journal (FL, type=7):
        - **Debit lines**: one per applied line (411+member) for the full amount (base price * quantity)
        - **Credit lines**: one per applied line (revenue accounts 7062/7063/…) for the full amount
        - **Pack discount contra**: a single pair of lines for the **total** discount across all packs:
          - Debit `discount_account_uuid` (from billing config or pack override) — absorbs the discount
          - Credit `411` (member) — reduces the member receivable by discount amount
        - **Net effect**: member owes (full price − discount), revenue accounts get full price, discount account absorbs the difference.
     5. Persists `flight_pack_consumptions` rows for each pack that contributed (links flight ↔ pack, records discount_amount, source)
     6. Links the accounting entry to the flight (`accounting_entry_uuid`)
     7. Marks the quote as `applied`
   - `post_flight_billing(flight_uuid, fiscal_year_uuid, user_id)` — Posts the Draft entry (calls existing `post_accounting_entry`)
   - `batch_apply(flight_uuids, fiscal_year_uuid, user_id)` — Apply + post multiple flights in a transaction
2. Add API endpoints in `backend/api/routes/flights.py`:
   - `POST /{flight_uuid}/billing-apply` — Apply (create Draft entry, link to flight)
   - `POST /{flight_uuid}/billing-post` — Apply + Post in one step
   - `POST /billing-batch-apply` — Batch apply + post
3. New schemas in `backend/schemas/flights.py`:
   - `FlightBillingApplyRequest`, `FlightBillingApplyResponse`

**Verification**: Integration test: preview → apply → verify entry exists with correct lines → post → verify entry is posted. Assert discount lines are present and balanced.

---

### Phase 4 — Daily Operations: Flights Tab (Backend)

**Steps** (parallel with Phase 3):
1. Add flight-specific endpoints in `backend/api/routes/flights.py`:
   - `GET /billable-flights` — list flights ready for billing (not yet applied) within a date range
   - `GET /pending-billing-summary` — aggregate stats (count, total, warnings) for a date range
2. Add pack purchase endpoint:
   - `POST /members/{member_uuid}/packs` — buy a pack (creates pack + Draft accounting entry)
   - `GET /members/{member_uuid}/packs` — list packs with balances
3. Add endpoint to freeze/exclude a flight from discount:
   - `POST /flight-pack-consumptions/{consumption_uuid}/freeze`

**Verification**: API responses return correct data shapes; tests for each endpoint.

---

### Phase 5 — Daily Operations: Flights Tab (Frontend)

**Steps** (depends on Phase 4):
1. Create `frontend/src/modules/banque/components/OpsFlightsTab.tsx`:
   - **Header**: date range picker + "Sync from Planche" button + "Calculate" button + "Post All" button
   - **Flights list**: table with columns: date, pilot, glider, type, total (preview), status (pending/applied/posted), actions
   - **Row expand**: click to see detail — payers, applied lines, accounting lines, pack discount
   - **Bulk actions**: select flights → "Preview" → "Apply" → "Post"
   - **Warnings/errors**: color-coded badges for each flight (e.g., pricing missing = red, pack applied = blue)
   - **Net display**: each flight row always shows the **net** amount (gross − discount). The expanded view breaks down gross charges and discount contra separately
2. Integrate component into `BanqueDailyOpsPage.tsx` — replace `flights` tab placeholder with `<OpsFlightsTab />`
3. Add pack purchase form (modal/dialog) for quick pack creation:
   - Member selector, `pack_type` selector (flight_hours / winch_launches / tow_launches), price input, discount_percent input, "Create Pack" → creates Draft entry for the purchase
4. Add translations in `frontend/src/modules/banque/i18n/` (French + English)
5. Add API client calls in `frontend/src/modules/banque/api/`

**Alert trigger safety**: The frontend and backend must ensure that balance checks (e.g., minimum balance alerts) evaluate the **net** of gross charge + discount contra together — never the gross line alone. The apply endpoint processes both atomically in a single journal entry.

**Verification**: UI renders in Daily Ops flights tab; can select flights, preview, apply, post; pack purchase dialog works with type/percent selector; discount contra displayed as a single consolidated line.

---

### Phase 6 — Post-Purchase & Recalculation

**Steps** (depends on Phase 3, parallel with Phase 4-5):
1. Backend: `recalculate_billing(flight_uuid, fiscal_year_uuid, user_id)`:
   - Only possible if flight has a quote in `applied` or `superseded` state
   - Unlinks old accounting entry (deletes it if Draft, or creates reversal if Posted)
   - Supersedes the old quote (state → `superseded`)
   - Runs fresh preview with updated pack balances → creates new quote + new Draft entry
2. Backend: `batch_recalculate(flight_uuids, fiscal_year_uuid, user_id)`:
   - Same logic as single recalc but in a transaction for consistency
3. Backend: `handle_post_purchase_pack(flight_uuid, member_uuid, pack_uuid)`:
   - After a pack is purchased, identifies all flights for that member in the same fiscal year that could benefit (flights with excess hours not covered by a pack)
   - Triggers recalculation for each eligible flight
   - If a flight was already posted, creates a reversal + replacement entry pair
4. **Launch pack support**: The recalc engine respects `pack_type` — a winch-launch pack only applies to `source='launch'` lines with the winch asset type, not to flight hours
5. UI: 
   - "Recalculate" button on flight detail panel
   - "Buy pack to cover" quick action when a flight has excess hours at full price
   - "Recalculate all flights for member" after pack purchase (batch recalc button)

**Verification**: 
- Flight with 1h glider at €100/h, member buys 80%-off pack → recalculate → verify €80 discount contra line
- Flight with winch launch, member buys 50%-off winch pack → recalculate → verify discount on launch line only, not on glider line
- Multiple packs of same type → highest discount_percent wins
- Test reversal + replacement for posted entries
- Test batch recalculation after bulk pack purchase

---

### Phase 7 — Freeze/Exclude & Manual Overrides

**Steps** (depends on Phase 2):
1. Backend: `freeze_flight_discount(flight_uuid, reason)` — sets `is_frozen=true` on the consumption record, which re-excludes those hours from pack balance
2. Backend: `unfreeze_flight_discount(consumption_uuid)` — re-includes
3. Backend: Recalculate when freeze state changes (same logic as Phase 6)
4. UI: Toggle switch in flight detail panel to freeze/unfreeze discount
5. UI: When frozen, show "Discount excluded — full price applied" with reason tooltip

**Verification**: Freeze a consumption → verify balance recalculated → verify flight billing is updated.

---

### Phase 8 — Member External Access (Self-Service Portal)

**Steps** (depends on Phase 3, parallel with Phase 4-7):

**Context**: The ERP already has a token-based `expense_access` mechanism on `MemberSheet`. This phase extends that concept into a full self-service view where members can see their billing, flight log, and account movements without needing an ERP user account.

1. **Backend — Public/Token-authenticated endpoints** (new router `backend/api/routes/member_portal.py`, no capability guard, uses token auth):
   - `POST /api/v1/member-portal/login` — Accepts a member identifier + expense access token, returns a short-lived JWT
   - `GET /api/v1/member-portal/flights` — List the member's flights with billing status and amounts (date, glider, type, total charged, discount applied)
   - `GET /api/v1/member-portal/flights/{flight_uuid}/billing` — Detail of one flight billing (applied lines, discount lines)
   - `GET /api/v1/member-portal/account` — Account summary (current balance, pack balances per type, pending/posted entries)
   - `GET /api/v1/member-portal/account/entries` — List accounting entries where the member appears (filterable by year, state)
2. **Backend — Expense access token management** (enhance existing `expense_access`):
   - Add `member_portal_enabled` flag alongside `expense_access_enabled` (or reuse the existing one)
   - Token can be regenerated (existing endpoint) and distributed to the member via email/print
3. **Frontend — Standalone member portal app** (new route group outside the shell, no auth guard):
   - `frontend/src/modules/member-portal/` — new module
   - Login page: member identifier + token input → obtain JWT → store in session-only storage
   - Dashboard view: pack balances, last 5 flights, account balance
   - Flights list: paginated table with billing detail expand
   - Account entries: ledger view of posted entries affecting the member
   - Uses the same `decimal.js` and formatting utilities as the main app
   - Styled with Tailwind + shadcn, mobile-friendly (members may use phones)
4. **Security rules**:
   - Token is hashed in DB (existing `_hash_token` pattern), never stored in plain text
   - JWT expires in 2 hours; refresh requires re-login
   - Read-only: no mutation endpoints in the portal
   - Rate-limited: max 30 requests/minute per token

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
     - `total_debit` — sum of debit lines where analytical_asset_uuid = asset
     - `total_credit` — sum of credit lines where analytical_asset_uuid = asset
     - `pack_purchases_total` — sum of pack purchase amounts linked to this asset type
     - `pack_discounts_total` — sum of pack discount amounts applied to this asset's flights
     - `flight_count` — number of billed flights using this asset
   - `GET /api/v1/assets/{asset_uuid}/financial-detail?fiscal_year_uuid=...`:
     - Returns paginated list of accounting entries where analytical_asset_uuid = asset
     - Each entry: entry date, description, sequence number, debit, credit, member, flight UUID
   - `GET /api/v1/assets/financial-summary?fiscal_year_uuid=...` — aggregated for **all** machines:
     - Returns a list: `[{asset_code, asset_name, total_debit, total_credit, pack_purchases, pack_discounts, flight_count}, ...]`
     - Sorted by asset code, filterable by asset type
2. **Frontend — Dashboard view** in the accounting section:
   - New component: `frontend/src/modules/banque/components/MachineFinancialDashboard.tsx`
   - **Summary table**: rows = machines, columns = code, name, total debit, total credit, pack purchases, pack discounts, net, flight count
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
- Pack purchases and discounts are correctly attributed

---

## Relevant Files

| File | What to do |
|---|---|
| `backend/models.py` | Add `MemberPack`, `FlightPackConsumption`, `FlightBillingQuote`, `FlightBillingConfig` models |
| `backend/services/flight_packs.py` | **NEW** — Pack CRUD, balance queries, freeze logic (respects pack_type) |
| `backend/services/flight_billing_configs.py` | **NEW** — Per-fiscal-year billing configuration CRUD |
| `backend/services/flight_billing.py` | Refactor `_initial_pack_balances()` to use new pack models, keyed by (member, year, pack_type) |
| `backend/services/flight_billing_apply.py` | **NEW** — Apply preview → create entry, discount separation, post, persist consumptions |
| `backend/services/accounting.py` | Minor: expose `get_account` for config lookup |
| `backend/api/routes/flights.py` | Add apply/post/batch + pack + freeze + recalculate endpoints |
| `backend/api/routes/accounting.py` | Add flight billing config GET/PUT endpoint |
| `backend/schemas/flights.py` | Add `FlightBillingApplyRequest/Response`, pack schemas, billing config schemas |
| `backend/schemas/members.py` | Add pack-related Pydantic models |
| `frontend/src/modules/banque/components/BanqueDailyOpsPage.tsx` | Wire `flights` tab to real component |
| `frontend/src/modules/banque/components/OpsFlightsTab.tsx` | **NEW** — Full flights billing cockpit |
| `frontend/src/modules/banque/components/PackPurchaseDialog.tsx` | **NEW** — Modal for quick pack creation with pack_type selector |
| `frontend/src/modules/banque/components/FlightBillingConfigPanel.tsx` | **NEW** — Billing config editor within Daily Ops settings |
| `frontend/src/modules/banque/api/` | Add flight billing API calls |
| `frontend/src/modules/banque/i18n/` | Add translations for flights ops |
| `backend/services/flight_billing.py` | Add `recalculate_billing()`, `batch_recalculate()`, `handle_post_purchase_pack()` |
| `backend/api/routes/member_portal.py` | **NEW** — Public token-authenticated endpoints for member self-service |
| `backend/services/members.py` | Extend expense access token management (regenerate, validate, portal flag) |
| `backend/api/routes/assets.py` | Add financial-summary and financial-detail endpoints |
| `backend/services/assets.py` | Add financial aggregation queries (debit/credit by analytical_asset, pack totals) |
| `frontend/src/modules/member-portal/` | **NEW** — Standalone member self-service module (login, flights, account) |
| `frontend/src/modules/banque/components/MachineFinancialDashboard.tsx` | **NEW** — Per-machine financial summary with drill-down |
| `frontend/src/modules/banque/components/BanqueDashboardPage.tsx` | Optionally link to machine financial dashboard |
| `frontend/src/modules/banque/api/` | Add machine financial summary API calls |

---

## Verification Plan

1. **Unit tests**: pack CRUD, balance calculation, preview → apply entry creation, discount line separation, freeze/unfreeze recalc
2. **Integration test**: full cycle — Planche sync → preview → apply → post → verify accounting entry exists with correct lines (including discount contra) → verify member pack balance updated
3. **UI manual test — Daily Ops**: Flights tab → select flights → preview → apply → post → check Journal FL for the entry → buy pack → recalculate → verify updated
4. **UI manual test — Machine dashboard**: After billing flights for multiple machines, dashboard shows correct aggregates → drill-down → entries match
5. **UI manual test — Member portal**: Enable expense access → login with token → see own flights, billing, account → cannot see other members' data
6. **Edge cases**: shared flight (partage) with pack for one pilot only; post-purchase covering an already-posted flight; freeze then unfreeze; multiple packs with partial consumption; year-end rollover (unconsumed pack hours lost)

---

## Scope Boundaries

**Included**:
- Pack purchase accounting (411 → discount_account), with configurable discount account per fiscal year (or per-pack override)
- Per-flight/per-launch pack discount as contra entry within the same flight journal entry
- Launch method packs: winch launches and tow launches tracked separately from flight hours
- Fiscal year scoping: packs belong to one FY, unconsumed units lost at year-end
- Post-purchase recalculation (pack bought after flight)
- Batch recalculation (multiple flights affected by a single pack purchase)
- Freeze/exclude individual flight line from discount
- Daily ops flights tab as the central UI hub
- Billing configuration UI per fiscal year
- Member self-service portal (token-based, read-only: flights, billing, account)
- Machine financial dashboard (credit/debit per asset, pack purchases, discounts, drill-down)

**Excluded** (future):
- Batch pricing version management within the flights tab
- Automated recurrent (monthly) billing runs
- Member invoice PDF generation (separate feature)
- Integration with helloasso for pack purchase payment collection
- Cost provision rules per flight (provision for tow/glider costs)
- Pack expiration or validity windows beyond fiscal year
- Multi-factor auth for the member portal
- Push notifications for new bills or pack exhaustion
