# Plan: Finalize Flights Accounting — Billing, Pack Consumption & Daily Ops Integration

## TL;DR

Add the billing **apply** step that turns previews into **Draft** accounting entries (with explicit manual posting after review), introduce a proper **pack catalog + member-owned consumable packs** system (including multiple 25h packs per pilot), and build the **flights tab** in Daily Operations as the central UI cockpit.

---

## Design Decisions

| Decision | Choice |
|---|---|
| **Discount realization** | Discounts are carried by **pricing items** (standard item vs pack item), not by `discount_percent` stored on member packs |
| **Pack model** | **Catalog + consumable member holdings** — define reusable pack templates (ex: `PACK_25H`) and let members buy multiple packs; each billed flight consumes eligible quantity |
| **Pack definition pricing** | `pack_definitions` owns a list of (`asset_type_uuid`, `unit_price`) couples via `pack_definition_prices` |
| **Pack tracking** | Single `member_pack_events` ledger tracks purchase and consumption events; consumption is still one row per flight/line for audit |
| **Pack scope** | Packs are scoped by `pack_type` and eligible asset types; each scope selects the matching discounted pricing items |
| **Fiscal year boundary** | Packs are scoped to one fiscal year and expire at year-end. No carry-over |
| **Billing configurability** | Billing configuration is scoped **per fiscal year** via `flight_billing_configs`, with optional pack-level overrides on `pack_definitions` |
| **Post-purchase** | Allowed — system recalculates when a pack is bought after the flight date, including launch packs |
| **Freeze/exclude** | `is_frozen` flag on `member_pack_events` consume rows; frozen consumptions excluded from quantity consumption calculation |
| **Posting policy** | Posting is always a separate explicit action (manual), after member review; no automatic posting at apply time |
| **Billing hash & alerts** | Hash and alert logic must include selected pricing items and pack-consumption rows; alerts evaluate 411 net impact only |

---

## Phases

### Phase 1 — Data Models & Migration

**Steps** (all parallel — schema only, no logic):
1. Create `pack_definitions` table (catalog model)
   - `uuid`, `code` (unique), `name`
   - `fiscal_year_uuid` (FK)
   - `pack_type` (varchar: `flight_hours`|`winch_launches`|`tow_launches`)
   - `quantity_allowance` (Numeric(10,4)) — ex: `25.0000` hours for a 25h pack
   - `quantity_unit` (varchar: `hours`|`launches`)
   - `eligible_asset_type_uuid` (FK, nullable when definition is generic)
   - `pack_sales_account_uuid` (FK → accounting_accounts, nullable override)
   - `flights_journal_uuid` (FK → accounting_journals, nullable override)
   - `pack_consumption_strategy` (`fifo`|`lifo`, nullable override)
   - `priority` (int, optional tie-breaker when multiple pack definitions match)
   - `created_at`
2. Create `pack_definition_prices` table (asset-type price matrix per pack definition)
   - `uuid`, `pack_definition_uuid` (FK)
   - `asset_type_uuid` (FK)
   - `price` (Numeric(10,4))
   - unique constraint (`pack_definition_uuid`, `asset_type_uuid`)
   - `created_at`
3. Create `member_pack_events` table (single ledger for purchases and consumptions)
   - `uuid`, `member_uuid` (FK), `fiscal_year_uuid` (FK), `pack_definition_uuid` (FK)
   - `event_type` (`purchase`|`consume`|`freeze`|`unfreeze`|`adjust`)
   - `quantity_delta` (Numeric(10,4)) — positive for purchase, negative for consumption
   - `flight_uuid` (FK → validated_flights, nullable; required for `consume`)
   - `source` (`flight`|`launch`, nullable)
   - `applied_pricing_item_uuid` (FK → pricing_items, nullable)
   - `purchase_entry_uuid` (FK → accounting_entries, nullable)
   - `billed_amount` (Numeric(10,4), nullable)
   - `is_frozen` (Boolean, default false), `frozen_at`, `frozen_reason`
   - `created_at`
4. Create `flight_billing_configs` table (configuration **per fiscal year**)
   - `uuid`, `fiscal_year_uuid` (FK, unique)
   - `flights_journal_uuid` (FK → accounting_journals, default = FL journal)
   - `pack_sales_account_uuid` (FK → accounting_accounts) — account used for pack purchase entries
   - `pack_consumption_strategy` (`fifo` by default)
   - `allow_post_purchase_recalculation` (Boolean, default true)
   - `updated_at`, `updated_by`
   - *Note: this is the fiscal-year default; `pack_definitions` may override select fields*
5. Add `billing_quote_uuid` to `validated_flights` (nullable FK → new flight_billing_quotes table)
6. Create `flight_billing_quotes` table (persists preview results)
   - `uuid`, `flight_uuid` (FK), `billing_hash`, `total_amount`, `fiscal_year_uuid` (FK)
   - `state`: `quoted`, `applied`, `superseded`, `corrected`
   - `applied_lines_json` (JSONB), `accounting_lines_json` (JSONB), `pack_consumptions_json` (JSONB)
   - `accounting_entry_uuid` (FK → accounting_entries, nullable)
   - `created_at`

**Verification**: Migration SQL runs cleanly; new tables are empty; existing flights table migration adds nullable columns.

---

### Phase 2 — Backend Billing Configuration & Pack Management Service

**Steps** (depends on Phase 1, can be parallelised):
1. Create billing configuration CRUD in `backend/services/accounting.py` (or new `flight_billing_configs.py`):
   - `get_or_create_flight_billing_config(db, fiscal_year_uuid)` — return existing or create with defaults
   - `update_flight_billing_config(db, config_uuid, updates)` — update pack sales account, journal, consumption strategy, etc.
   - `GET/PUT /api/v1/accounting/fiscal-years/{fiscal_year_uuid}/flight-billing-config` — API endpoints
2. Create `backend/services/flight_packs.py` with:
   - `create_pack_definition(db, payload, user_id)` — defines catalog packs (ex: 25h glider)
   - `upsert_pack_definition_prices(db, pack_definition_uuid, price_rows, user_id)`
   - `buy_member_pack(db, member_uuid, pack_definition_uuid, quantity_multiplier, purchase_entry_uuid, user_id)` — inserts a `purchase` event
   - `list_member_pack_balance(db, member_uuid, fiscal_year_uuid, pack_type=None)` — derives balances from events
   - `consume_pack_quantity(db, pack_definition_uuid, member_uuid, flight_uuid, consumed_quantity, source, pricing_item_uuid)` — inserts one `consume` event per flight/line
   - `freeze_consumption(db, event_uuid, reason)` / `unfreeze_consumption(db, event_uuid)`
3. Refactor `FlightBillingPreviewService` to select the pricing item from pack-aware rules (standard vs pack pricing item), then consume quantity from eligible member packs (FIFO default)
4. Add pack purchase accounting entry creation helper:
    - `create_pack_purchase_entry(db, member, purchase_event_uuid, amount, pack_sales_account_uuid, fiscal_year_uuid, user_id)` → creates Draft entry:
     - Debit `411` (member dimension) for total amount
       - Credit `pack_sales_account_uuid` (pack override if set, else billing config default)

**Verification**: Unit tests for billing config CRUD, pack definition CRUD, member purchase CRUD, FIFO consumption resolution, and pack purchase entry creation.

---

### Phase 3 — Backend Billing Apply & Pack-Aware Pricing

**Steps** (depends on Phase 1 & 2):
1. Extend `FlightBillingPreviewService` → new `FlightBillingApplyService` in `backend/services/flight_billing_apply.py`:
   - `apply_preview(flight_uuid, fiscal_year_uuid, user_id)`:
   1. Loads billing config for the fiscal year (pack sales account, journal UUID, strategy) + pack-level overrides
     2. Runs preview (reuses `_preview_one`)
     3. Persists the quote to `flight_billing_quotes`
     4. Creates a **single Draft accounting entry** in the configured flights journal (FL, type=7):
        - **Debit lines**: one per applied line (411+member) using the resolved pricing item amount
        - **Credit lines**: one per applied line (revenue accounts 7062/7063/…) using the same resolved amount
        - No dedicated pack-adjustment contra line when pack pricing item is applied
   5. Persists one `member_pack_events` `consume` row per flight/line that uses pack quantity
     6. Links the accounting entry to the flight (`accounting_entry_uuid`)
     7. Marks the quote as `applied`
   - `post_flight_billing(flight_uuid, fiscal_year_uuid, user_id)` — Posts the Draft entry (calls existing `post_accounting_entry`)
   - `batch_apply(flight_uuids, fiscal_year_uuid, user_id)` — Apply multiple flights in a transaction (creates Draft entries only)
   - `batch_post(flight_uuids, fiscal_year_uuid, user_id)` — Posts already applied Draft entries in batch
2. Add API endpoints in `backend/api/routes/flights.py`:
   - `POST /{flight_uuid}/billing-apply` — Apply (create Draft entry, link to flight)
   - `POST /{flight_uuid}/billing-post` — Apply + Post in one step
   - `POST /billing-batch-apply` — Batch apply (Draft only by default; optional explicit mode to post)
   - `POST /billing-batch-post` — Batch post already applied Draft entries
3. New schemas in `backend/schemas/flights.py`:
   - `FlightBillingApplyRequest`, `FlightBillingApplyResponse`

**Verification**: Integration test: preview → apply → verify entry exists with correct lines → post → verify entry is posted. Assert pack-consumption rows are persisted and quantities decremented.

---

### Phase 4 — Daily Operations: Flights Tab (Backend)

**Steps** (parallel with Phase 3):
1. Add flight-specific endpoints in `backend/api/routes/flights.py`:
   - `GET /billable-flights` — list flights ready for billing (not yet applied) within a date range
   - `GET /pending-billing-summary` — aggregate stats (count, total, warnings) for a date range
2. Add pack purchase endpoint:
   - `POST /members/{member_uuid}/packs` — buy a pack (creates pack + Draft accounting entry)
   - `GET /members/{member_uuid}/packs` — list pack balances (derived from events) and usage audit summary
3. Add endpoint to freeze/exclude a pack consumption from flight recalculation:
   - `POST /pack-events/{event_uuid}/freeze`
   - `POST /pack-events/{event_uuid}/unfreeze`

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
   - **Net display**: each flight row always shows the billed net from resolved pricing items. The expanded view shows gross-equivalent context and consumed pack quantities.
2. Integrate component into `BanqueDailyOpsPage.tsx` — replace `flights` tab placeholder with `<OpsFlightsTab />`
3. Add pack purchase form (modal/dialog) for quick pack purchase:
   - Member selector, pack definition selector (includes 25h packs), quantity multiplier, "Create Pack" → creates Draft entry for the purchase
4. Add translations in `frontend/src/modules/banque/i18n/` (French + English)
5. Add API client calls in `frontend/src/modules/banque/api/`

**Alert trigger safety**: The frontend and backend must ensure that balance checks (e.g., minimum balance alerts) evaluate the final posted member net after pack-aware pricing resolution for the same journal entry.

**Verification**: UI renders in Daily Ops flights tab; can select flights, preview, apply, post; pack purchase dialog works with pack definition + quantity selector; expanded view shows consumed pack quantities.

---

### Phase 6 — Post-Purchase & Recalculation

**Steps** (depends on Phase 3, parallel with Phase 4-5):
1. Backend: `recalculate_billing(flight_uuid, fiscal_year_uuid, user_id)`:
   - Only possible if flight has an existing quote/entry from a prior apply cycle
   - Unlinks old accounting entry (deletes it if Draft, or creates reversal if Posted)
   - Supersedes the old quote (state → `superseded`)
   - Runs fresh preview with current remaining pack quantities and freeze state → creates new quote + new Draft entry
2. Backend: `batch_recalculate(flight_uuids, fiscal_year_uuid, user_id)`:
   - Same logic as single recalc but in a transaction for consistency
3. Backend: `handle_post_purchase_pack(member_uuid, pack_uuid, fiscal_year_uuid, user_id)`:
   - After a pack is purchased, identifies all already-billed flights for that member in the same fiscal year that are eligible for this `pack_type`
   - Triggers recalculation for each eligible flight
   - If a flight was already posted, creates a reversal + replacement entry pair
4. **Launch pack support**: The recalc engine respects `pack_type` — a winch-launch pack only applies to `source='launch'` lines with the winch asset type, not to flight hours
5. UI: 
   - "Recalculate" button on flight detail panel
   - "Buy pack" quick action when a flight has eligible lines billed at full price
   - "Recalculate all flights for member" after pack purchase (batch recalc button)

**Verification**: 
- Flight with 1h glider billed with pack-priced item, member buys one 25h pack → recalculate → verify `consumed_quantity=1.0h` and remaining quantity decremented
- Flight with winch launch, member buys winch-launch pack → recalculate → verify consumption applies on launch line only, not on glider line
- Multiple packs of same type → FIFO consumption across purchases
- Test reversal + replacement for posted entries
- Test batch recalculation after bulk pack purchase

---

### Phase 7 — Freeze/Exclude & Manual Overrides

**Steps** (depends on Phase 2):
1. Backend: `freeze_pack_event(event_uuid, reason)` — sets `is_frozen=true` on a `consume` event so that consumption is excluded from billing recalculation
2. Backend: `unfreeze_pack_event(event_uuid)` — re-includes
3. Backend: Recalculate when freeze state changes (same logic as Phase 6)
4. UI: Toggle switch in flight detail panel to freeze/unfreeze pack consumption
5. UI: When frozen, show "Pack consumption excluded — standard pricing applied" with reason tooltip

**Verification**: Freeze a consumption → verify balance recalculated → verify flight billing is updated.

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
- Member portal must display each billed flight with billed lines and the associated pack-consumption rows so the member can reconcile consumed quantity and net amount.

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
| `backend/models.py` | Add `PackDefinition`, `PackDefinitionPrice`, `MemberPackEvent`, `FlightBillingQuote`, `FlightBillingConfig` models |
| `backend/services/flight_packs.py` | **NEW** — Pack definition + price-matrix CRUD, events ledger, balance projection, freeze logic |
| `backend/services/flight_billing_configs.py` | **NEW** — Per-fiscal-year billing configuration CRUD |
| `backend/services/flight_billing.py` | Refactor pack-aware pricing resolution to use consumable pack purchases keyed by (member, fiscal_year, pack_type, asset_type) |
| `backend/services/flight_billing_apply.py` | **NEW** — Apply preview → create entry, post, persist consumptions |
| `backend/services/accounting.py` | Minor: expose `get_account` for config lookup |
| `backend/api/routes/flights.py` | Add apply/post/batch + pack + freeze + recalculate endpoints |
| `backend/api/routes/accounting.py` | Add flight billing config GET/PUT endpoint |
| `backend/schemas/flights.py` | Add `FlightBillingApplyRequest/Response`, pack schemas, billing config schemas |
| `backend/schemas/members.py` | Add pack-related Pydantic models |
| `frontend/src/modules/banque/components/BanqueDailyOpsPage.tsx` | Wire `flights` tab to real component |
| `frontend/src/modules/banque/components/OpsFlightsTab.tsx` | **NEW** — Full flights billing cockpit |
| `frontend/src/modules/banque/components/PackPurchaseDialog.tsx` | **NEW** — Modal for quick pack purchase with pack-definition selector |
| `frontend/src/modules/banque/components/FlightBillingConfigPanel.tsx` | **NEW** — Billing config editor within Daily Ops settings |
| `frontend/src/modules/banque/api/` | Add flight billing API calls |
| `frontend/src/modules/banque/i18n/` | Add translations for flights ops |
| `backend/services/flight_billing.py` | Add `recalculate_billing()`, `batch_recalculate()`, `handle_post_purchase_pack()` |
| `backend/api/routes/member_portal.py` | **NEW** — Public token-authenticated endpoints for member self-service |
| `backend/services/members.py` | Extend expense access token management (regenerate, validate, portal flag) |
| `backend/api/routes/assets.py` | Add financial-summary and financial-detail endpoints |
| `backend/services/assets.py` | Add financial aggregation queries (debit/credit by analytical_asset, pack purchases, consumed quantities) |
| `frontend/src/modules/member-portal/` | **NEW** — Standalone member self-service module (login, flights, account) |
| `frontend/src/modules/banque/components/MachineFinancialDashboard.tsx` | **NEW** — Per-machine financial summary with drill-down |
| `frontend/src/modules/banque/components/BanqueDashboardPage.tsx` | Optionally link to machine financial dashboard |
| `frontend/src/modules/banque/api/` | Add machine financial summary API calls |

---

## Verification Plan

1. **Unit tests**: pack definition CRUD, pack-definition price matrix CRUD, member pack events (purchase/consume), preview → apply entry creation, freeze/unfreeze recalc
2. **Integration test**: full cycle — Planche sync → preview → apply (Draft) → member review window → post → verify accounting entry exists with correct lines and that `member_pack_events` consume rows are persisted
3. **UI manual test — Daily Ops**: Flights tab → select flights → preview → apply → post → check Journal FL for the entry → buy pack → recalculate → verify updated
4. **UI manual test — Machine dashboard**: After billing flights for multiple machines, dashboard shows correct aggregates → drill-down → entries match
5. **UI manual test — Member portal**: Enable expense access → login with token → see own flights, billing, account → cannot see other members' data
6. **Edge cases**: shared flight (partage) with pack for one pilot only; post-purchase covering an already-posted flight; freeze then unfreeze; multiple packs of same type consumed by FIFO; fiscal year rollover (pack validity expires, no carry-over)
7. **Hash/alert safety test**: billing hash changes when selected pricing items or pack-event consumption rows change; minimum-balance alerts evaluate net 411 impact only after full entry apply

---

## Scope Boundaries

**Included**:
- Pack catalog with consumable quantity (including 25h packs), per-asset-type price matrix, and member ability to buy multiple packs
- Pack purchase accounting (411 → pack sales account), configured in fiscal-year billing config
- Pack-aware pricing resolution through pack-definition prices/pricing items, with consumption audit per flight/launch
- Launch method packs: winch launches and tow launches tracked separately from flight hours
- Fiscal year scoping: packs belong to one FY and expire at year-end (no carry-over)
- Post-purchase recalculation (pack bought after flight)
- Batch recalculation (multiple flights affected by a single pack purchase)
- Freeze/exclude individual pack-consumption event line
- Daily ops flights tab as the central UI hub
- Billing configuration UI per fiscal year
- Member self-service portal (token-based, read-only: flights, billing, account)
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
