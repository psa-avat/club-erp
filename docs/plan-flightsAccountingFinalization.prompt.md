# Plan: Finalize Flights Accounting — Billing, Pack Discounts & Daily Ops Integration

## TL;DR

Add the billing **apply** step that turns previews into posted accounting entries, introduce a proper **member pack** system with per-flight discount tracking, separate the discount as a contra accounting line, and build the **flights tab** in Daily Operations as the central UI cockpit.

---

## Design Decisions (captured from your description)

| Decision | Choice |
|---|---|
| **Discount entry** | Single contra pair within the **same** flight journal entry (credit 411, debit 7066), not a separate entry |
| **Pack consumption** | Only **charged hours** consume pack balance |
| **Pack tracking** | New `member_packs` table (hours_initial, hours_consumed). `MemberSheet.remaining_hours_in_pack` becomes a live aggregate |
| **Post-purchase** | Allowed — system recalculates when a pack is bought after the flight date |
| **Freeze/exclude** | `is_frozen` flag on `flight_pack_consumptions`; frozen consumptions excluded from balance |

---

## Phases

### Phase 1 — Data Models & Migration

**Steps** (all parallel — schema only, no logic):
1. Create `member_packs` table
   - `uuid`, `member_uuid` (FK), `hours_initial` (Numeric(8,2)), `hours_consumed` (Numeric(8,2), default 0)
   - `purchase_entry_uuid` (FK → accounting_entries, nullable — the accounting entry for the pack purchase)
   - `fiscal_year_uuid` (FK), `created_at`
2. Create `flight_pack_consumptions` table
   - `uuid`, `flight_uuid` (FK → validated_flights), `member_uuid` (FK)
   - `member_pack_uuid` (FK → member_packs), `hours_used` (Numeric(8,2))
   - `pack_discount_amount` (Numeric(10,4)) — the discount value = (base_price - pack_price) × hours_used
   - `is_frozen` (Boolean, default false), `frozen_at`, `frozen_reason`
   - `created_at`
3. Add `billing_quote_uuid` to `validated_flights` (nullable FK → new flight_billing_quotes table)
4. Create `flight_billing_quotes` table (persists preview results)
   - `uuid`, `flight_uuid` (FK), `billing_hash`, `total_amount`
   - `state`: `quoted`, `applied`, `superseded`, `corrected`
   - `applied_lines_json` (JSONB), `accounting_lines_json` (JSONB)
   - `accounting_entry_uuid` (FK → accounting_entries, nullable)
   - `created_at`
5. Add `pack_discount_account_uuid` to `system_settings` (module `accounting`, key `flights.pack_discount_account`) — configurable account for 7066.

**Verification**: Migration SQL runs cleanly; new tables are empty; existing flights table migration adds nullable columns.

---

### Phase 2 — Backend Pack Management Service

**Steps** (depends on Phase 1):
1. Create `backend/services/flight_packs.py` with:
   - `create_member_pack(db, member_uuid, hours, purchase_entry_uuid, user_id)` — creates a pack and updates `MemberSheet.remaining_hours_in_pack`
   - `list_member_packs(db, member_uuid, fiscal_year_uuid)` — list packs with remaining hours
   - `get_member_pack_balance(db, member_uuid, year)` → remaining hours (sum of initial - sum of consumed across all active non-frozen consumptions)
   - `freeze_consumption(db, consumption_uuid, reason)` — mark a FlightPackConsumption as frozen
2. Refactor `FlightBillingPreviewService._initial_pack_balances()` to read from `member_packs` instead of `MemberSheet.remaining_hours_in_pack` (single source of truth)
3. Add pack purchase accounting entry creation helper:
   - `create_pack_purchase_entry(db, member, pack_uuid, hours, unit_price, discount_account_uuid, user_id)` → creates Draft entry:
     - Debit `411` (member dimension) for total amount
     - Credit `discount_account_uuid` (e.g. 7066) for total amount

**Verification**: Unit tests for pack CRUD, balance calculation, pack purchase entry creation.

---

### Phase 3 — Backend Billing Apply & Discount Separation

**Steps** (depends on Phase 1 & 2):
1. Extend `FlightBillingPreviewService` → new `FlightBillingApplyService` in `backend/services/flight_billing_apply.py`:
   - `apply_preview(flight_uuid, fiscal_year_uuid, user_id)`:
     1. Runs preview (reuses `_preview_one`)
     2. Persists the quote to `flight_billing_quotes`
     3. Creates a **single Draft accounting entry** in journal `FL` (type=7):
        - **Debit lines**: one per applied line (411+member) for the full amount (base price * quantity)
        - **Credit lines**: one per applied line (revenue accounts 7062/7063/…) for the full amount
        - **Pack discount correction**: if pack was used, add a single pair of lines for the **total** discount:
          - Credit `411` (member) for total discount amount
          - Debit `discount_account_uuid` (7066) for total discount amount
        - **Net effect**: member owes (full price − discount), revenue accounts get full price, discount account absorbs the difference.
     4. Links the accounting entry to the flight (`accounting_entry_uuid`)
     5. Marks the quote as `applied`
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
2. Integrate component into `BanqueDailyOpsPage.tsx` — replace `flights` tab placeholder with `<OpsFlightsTab />`
3. Add pack purchase form (modal/dialog) for quick pack creation:
   - Member selector, hours input, unit price, "Create Pack" → creates Draft entry for the purchase
4. Add translations in `frontend/src/modules/banque/i18n/` (French + English)
5. Add API client calls in `frontend/src/modules/banque/api/`

**Verification**: UI renders in Daily Ops flights tab; can select flights, preview, apply, post; pack purchase dialog works; discount lines visible.

---

### Phase 6 — Post-Purchase & Recalculation

**Steps** (depends on Phase 3, parallel with Phase 4-5):
1. Backend: `recalculate_billing(flight_uuid, fiscal_year_uuid, user_id)`:
   - Only possible if flight is in `applied` state (Draft entry exists)
   - Unlinks old entry (deletes it if Draft, or creates reversal if Posted)
   - Creates new quote + new entry with updated pack balances
2. Backend: `handle_post_purchase_pack(flight_uuid, member_uuid, pack_uuid)`:
   - After a pack is purchased that covers a flight date, recalculates the flight billing
   - If the flight was already posted, creates a reversal + replacement entry
3. UI: "Recalculate" button on flight details panel + "Buy pack to cover" quick action when a flight has excess hours

**Verification**: Test: flight with 4h where pilot has 0h balance → buy 25h pack → recalculate → verify discount applied. Test reversal + replacement for posted entries.

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

## Relevant Files

| File | What to do |
|---|---|
| `backend/models.py` | Add `MemberPack`, `FlightPackConsumption`, `FlightBillingQuote` models |
| `backend/services/flight_packs.py` | **NEW** — Pack CRUD, balance queries, freeze logic |
| `backend/services/flight_billing.py` | Refactor `_initial_pack_balances()` to use new pack model |
| `backend/services/flight_billing_apply.py` | **NEW** — Apply preview → create entry, discount separation, post |
| `backend/services/accounting.py` | Minor: expose `get_account` for config lookup, system setting for discount account |
| `backend/api/routes/flights.py` | Add apply/post/batch + pack + freeze endpoints |
| `backend/schemas/flights.py` | Add `FlightBillingApplyRequest/Response`, pack schemas |
| `backend/schemas/members.py` | Add pack-related Pydantic models |
| `frontend/src/modules/banque/components/BanqueDailyOpsPage.tsx` | Wire `flights` tab to real component |
| `frontend/src/modules/banque/components/OpsFlightsTab.tsx` | **NEW** — Full flights billing cockpit |
| `frontend/src/modules/banque/api/` | Add flight billing API calls |
| `frontend/src/modules/banque/i18n/` | Add translations for flights ops |
| `backend/services/flight_billing.py` | Add `recalculate_billing()`, `handle_post_purchase_pack()` |

---

## Verification Plan

1. **Unit tests**: pack CRUD, balance calculation, preview → apply entry creation, discount line separation, freeze/unfreeze recalc
2. **Integration test**: full cycle — Planche sync → preview → apply → post → verify accounting entry exists with correct lines (including 7066 discount contra) → verify member pack balance updated
3. **UI manual test**: Daily Ops → Flights tab → select flights → preview → apply → post → check Journal FL for the entry → buy pack → recalculate → verify updated
4. **Edge cases**: shared flight (partage) with pack for one pilot only; post-purchase covering an already-posted flight; freeze then unfreeze; multiple packs with partial consumption

---

## Scope Boundaries

**Included**:
- Pack purchase accounting (411 → 7066)
- Per-flight pack discount as contra entry within the same flight journal entry
- Post-purchase recalculation (pack bought after flight)
- Freeze/exclude individual flight from discount
- Daily ops flights tab as the central UI hub

**Excluded** (future):
- Batch pricing version management within the flights tab
- Automated recurrent (monthly) billing runs
- Member invoice PDF generation (separate feature)
- Integration with helloasso for pack purchase payment collection
- Cost provision rules per flight (provision for tow/glider costs)
