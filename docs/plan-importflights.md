# Plan: Planche Flights Import, Billing, and Corrections

## TL;DR

Planche is the source of truth for flight facts. ERP Club imports every Planche flight revision, stores the raw source snapshot immutably, normalizes the current flight view, calculates the ERP billing quote, and compares a deterministic billing hash.

If a Planche modification has no billing impact, ERP stores it and logs the change. If it changes the price and the accounting entry is still Draft, ERP updates the draft entry with an audit trail. If the entry is Posted, ERP creates a reversal entry for the original billing and a replacement entry for the corrected billing.

Target lifecycle:

```text
Planche flight revision pulled
  -> ERP stores immutable source snapshot
  -> ERP normalizes current flight
  -> ERP calculates billing quote
  -> ERP compares billing hash
  -> no price impact: store + log only
  -> draft entry: update draft + log
  -> posted entry: reverse original + create replacement
  -> acknowledge exact Planche uuid + revision
```

---

## Current State and Immediate Fixes

### Existing implementation

- `PlancheIntegrationService.pull_validated_flights()` currently pulls `GET /validated-flights`.
- `ValidatedFlight` stores a single row per `planche_uuid`.
- `ValidatedFlight.accounting_entry_uuid` is intended to link a flight to one accounting entry.
- Accounting already supports the required correction primitives:
  - Draft entries can be updated.
  - Posted entries are immutable.
  - Posted entries can be reversed with a new Draft reversal entry.

### Bugs to fix before building the end-to-end flow

1. **Field mapping mismatch**
   - Current code writes `flight_obj.aero`, `flight_obj.glider_immat`, and `flight_obj.launch_machine_immat`.
   - Current model has no `aero`, no `glider_immat`, and uses `asset_code` / `launch_asset_code`. Those names are misleading for the integration because ERP assets identify registrations in `assets.registration`.
   - Fix mapping and lookup rules:
     - `glider_immat` is the aircraft registration and must resolve to `assets.registration`.
     - `launch_machine_immat` is the tow/winch/launch machine registration and must also resolve to `assets.registration`.
     - Store the resolved ERP asset UUIDs where possible; keep the Planche registration strings as immutable source snapshot fields.
     - If keeping the current `ValidatedFlight` columns temporarily, map `glider_immat` -> `asset_code` and `launch_machine_immat` -> `launch_asset_code`, but treat those columns as registration snapshots rather than ERP asset codes.
     - add `aero` only if ERP needs to retain the Planche aerodrome separately.

2. **Broken modified-after-transfer detection**
   - Current code sets `erp_status = 0` before checking whether the existing flight was already transferred.
   - Capture existing state, source hash, accounting link, and revision before applying incoming data.

3. **Missing Planche source fields**
   - ERP should retain Planche metadata:
     - `pilot_compta_id`
     - `second_pilot_id`
     - `charge_to_compta_id`
     - `lastUpdated`
     - `revision`
     - `corrected_at`
     - `corrected_by`
     - `correction_reason`
     - `vi_id`
     - explicit cancelled/deleted status.

4. **Single-row `planche_uuid` design is insufficient**
   - The unique `planche_uuid` constraint prevents keeping multiple ERP versions of the same Planche flight.
   - A posted accounting correction requires preserving the original billed version and the corrected version.

---

## Target Architecture

### Lifecycle concepts

Do not rely on one `erp_status` integer for the whole workflow. Track these states separately:

| Lifecycle | Purpose | Example values |
|---|---|---|
| Source revision state | What Planche sent | `new`, `updated`, `cancelled`, `deleted`, `unchanged` |
| ERP review state | Whether ERP accepted/imported the revision | `imported`, `needs_review`, `accepted`, `rejected`, `error` |
| Billing state | Whether ERP billing is current | `not_billed`, `quoted`, `draft_entry`, `posted_entry`, `needs_correction`, `corrected` |
| Accounting state | Actual accounting entry state | `draft`, `posted`, `cancelled` from accounting entries |
| Planche ack state | Whether Planche knows ERP processed this revision | `not_acknowledged`, `acknowledged`, `ack_failed` |

### Proposed ERP data model

#### `planche_flight_snapshots`

Immutable source-of-truth storage for every Planche revision received.

Required fields:

- ERP UUID primary key.
- `planche_uuid`.
- `planche_revision`.
- `source_hash`: deterministic hash of the canonical Planche payload.
- `received_at`.
- `last_updated`.
- `status`: active/cancelled/deleted according to Planche.
- `payload_json`: full raw Planche payload.
- correction metadata: `corrected_at`, `corrected_by`, `correction_reason`.
- ack metadata: `ack_status`, `ack_at`, `ack_error`.

Constraints:

- Unique `(planche_uuid, planche_revision)`.
- Same revision import is idempotent.

#### Normalized flight/current view

Normalized ERP representation of the latest accepted Planche revision.

Required behavior:

- Points to the current `planche_flight_snapshots` row.
- Keeps normalized fields used by pricing and UI:
  - flight date, aerodrome, asset, launch asset, pilot, second pilot, bill-to member, VI reference, launch method, flight type, times, counters, distance, landing count, observations.
- Keeps stable ERP links to `Member`, `Asset`, and optional VI entities when resolvable.
- Resolves both `glider_immat` and `launch_machine_immat` against `assets.registration`; both are Planche registration strings, not ERP asset codes.
- Stores unresolved identifiers and marks the row `needs_review` when a member/asset cannot be matched.

#### `flight_billing_quotes`

Stores ERP-calculated billing result for a specific source snapshot.

Required fields:

- Quote UUID.
- Source snapshot UUID.
- Normalized flight UUID.
- Pricing version UUID.
- Bill-to member UUID and member account snapshot.
- Billing date.
- `billing_hash`: deterministic hash of all accounting-relevant billing lines.
- Total amount.
- Status: `draft`, `superseded`, `posted`, `corrected`, `no_charge`, `error`.
- Error details when pricing cannot be calculated.
- Line details as structured JSON or child rows:
  - pricing item UUID.
  - quantity.
  - unit price.
  - amount.
  - debit account.
  - credit/revenue account.
  - analytical asset.
  - description.

The billing hash must include only price/accounting-impacting data:

- bill-to member.
- pricing version and pricing item identities.
- quantities.
- unit prices.
- discounts/pack eligibility.
- revenue/debit accounts.
- analytical asset.
- tax fields if added later.

It must not include non-billing metadata such as observations, correction reason, or Planche audit timestamps.

#### Accounting links

Track accounting entries created from flight billing.

Required behavior:

- One quote can create one accounting entry.
- A posted quote correction links:
  - original posted entry.
  - reversal entry.
  - replacement entry.
- Preserve source snapshot and billing quote references on accounting entries via `source_system="planche_flights"` and stable `external_id` values.

Recommended `external_id` format:

```text
planche:{planche_uuid}:rev:{revision}:quote:{quote_uuid}
```

---

## Flight Billing Calculation Plan

First milestone: calculate manually and display the result without creating or
updating accounting entries, without acknowledging a billing decision as posted,
and without consuming member pack hours permanently.

The billing engine should be deterministic and side-effect free by default. It
must return a preview object that contains every decision needed to understand
the calculation:

- resolved flight, glider, optional launch machine, members, and pricing
  versions.
- payer allocation.
- quantities used by each price item.
- unit prices, pack discounts, and final amounts.
- proposed accounting lines.
- blocking errors and non-blocking warnings.
- a `billing_hash` for later correction comparison.

### Manual preview workflow

Initial UI/API behavior:

1. User selects one imported flight, or a date range of imported flights.
2. ERP calculates billing previews from current imported data.
3. ERP displays:
   - source flight facts.
   - resolved payers.
   - price items applied.
   - pack eligibility and simulated consumption.
   - proposed debit and credit lines.
   - missing setup errors.
4. User can recalculate after fixing members, machines, prices, accounts, or
   pack balances.
5. No accounting entry is created until a later explicit "apply" action exists.

Recommended first endpoints:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/flights/{flight_uuid}/billing-preview` | Calculate one flight and return preview only |
| `POST` | `/api/v1/flights/billing-preview` | Calculate a batch by date/status filters and return preview only |

### Payer resolution

Resolve payers before pricing. Each payer allocation has:

- `member_uuid`.
- source role: `pilot`, `second`, `charge_to`, `club`.
- share ratio or quantity share.
- reason code for audit and UI.

Rules:

| Flight type | Payer rule |
|---|---|
| `solo` | Pilot pays 100%. |
| `supervise` / `supervisé` | Pilot pays 100%. |
| `lacher` / `lâcher` | Pilot pays 100%. |
| `instruction` | Pilot pays 100% unless `instruction_split` is set. If split is set, pilot and second pilot each receive a configured share, initially 50/50. |
| `partage` | Pilot and second pilot share the bill, initially 50/50. |
| `passager` | `charge_to` member pays 100% when set; otherwise pilot pays 100%. |
| `initiation` / VI | Charged to the club. Needs a configured club receivable/member account or dedicated VI handling rule. This is an open decision. |

Blocking errors:

- required payer cannot be resolved to an ERP member.
- split/share flight has no second pilot.
- `initiation` has no configured club/VI billing target.

Open decision: whether instruction split should split every item, only flight
time, or use item-level split flags. Default plan is to split all flight and
launch charges for the flight until item-level configuration exists.

### Pricing version resolution

Pricing is linked to machines through the asset type pricing version already
available on `pricing_versions.asset_type_uuid`.

For each billable machine involved in the flight:

1. Resolve the Planche registration to `assets.registration`.
2. Read the asset type.
3. Find one active pricing version where:
   - `status = Active`.
   - `from_date <= flight.jour`.
   - `to_date IS NULL OR to_date >= flight.jour`.
   - `asset_type_uuid = machine.asset_type_uuid`.
4. If no asset-specific version exists, optionally fall back to a global active
   pricing version (`asset_type_uuid IS NULL`) only if the club enables that
   fallback in pricing settings.
5. If no version applies, return a no-price blocking error for that machine.
6. If more than one version applies, return an overlap blocking error.

The glider/main aircraft and launch machine are priced independently. A flight
can therefore have:

- one pricing version for the glider or TMG.
- one pricing version for the tow plane, winch, or other launch machine.

### Price item matching

Load all `pricing_items` for the selected pricing version and keep the items
that apply to the flight:

- `flight_type_uuid IS NULL` applies to all flight types.
- `flight_type_uuid` set applies only when the imported flight maps to that ERP
  flight type.
- item revenue account `gl_account_credit_uuid` must be configured before the
  item can generate accounting lines.

Quantity by current item unit:

| Unit | Quantity rule |
|---|---|
| `FlightTime(h)` | Duration between `takeoff_time` and `landing_time`, in decimal hours. |
| `EngineTimeMinute` | `engine_time` converted to minutes according to the source unit decision below. |
| `EngineTime1_100h` | `engine_time / 100`. Used for TMG or autonomous motor time when Planche stores 1/100h. |
| `FlightDuration` | Same as flight duration unless later distinguished from airborne time. |
| `PerFlight` | `1`. |
| `Fixed` | `1`. |

Source unit decision: Planche `engineTime` appears to be in 1/100h for TMG or
autonomous engine time. Confirm this during implementation and store the
normalized quantity plus the raw source value in the preview line.

For launch machines, run the same pricing version and item matching process on
the launch asset. Launch item quantities usually use `PerFlight`, `Fixed`,
launch duration, or engine time if provided by Planche. If the launch machine is
present but cannot be priced, the preview should show a launch pricing error
separately from the glider pricing result.

### Tier, pack, and discount calculation

Calculate the normal unit price first:

1. Start with `PricingItem.base_price`.
2. If tiers exist, select the last tier where `from_qty <= relevant accumulated
   quantity`.
3. Use the tier price for the portion or whole line according to the club's
   chosen tier behavior.

Current tier behavior to implement first: whole-line threshold pricing. The
selected price is applied to the whole flight line. Progressive per-bracket
pricing can be added later if required.

Pack discount simulation:

1. A pricing version can opt in with `PricingVersion.use_pack`.
2. A price item is pack-discountable when `pack_price` is not null, or the
   selected tier has `pack_price` not null.
3. A member has pack capacity from `member_sheets.remaining_hours_in_pack` for
   the flight year.
4. The preview engine sorts flights chronologically within a batch and simulates
   pack consumption in that order.
5. For a single-flight preview, use the current persisted remaining pack hours
   as the starting balance.
6. If the payer has enough pack hours for the charged quantity, apply the pack
   price to that quantity.
7. If the payer has partial pack hours, split the line into:
   - pack-priced quantity up to remaining hours.
   - normal-priced quantity for the rest.
8. Return simulated `pack_hours_before`, `pack_hours_used`, and
   `pack_hours_after` on each preview line.
9. Do not update `member_sheets.remaining_hours_in_pack` during preview.

When the later apply step is built, pack consumption must happen in the same
database transaction as accounting entry creation/update, with row locking on
the relevant member sheets to avoid consuming the same hours twice.

Open decisions:

- Which item units consume pack hours. Default: `FlightTime(h)`,
  `FlightDuration`, and `EngineTime1_100h` consume pack hours; `PerFlight` and
  `Fixed` do not unless item configuration says so.
- Whether launch machine charges can use the same pack as flight hours. Default:
  no, unless the launch pricing item has a pack price.
- Whether age discounts combine with pack prices. Default: apply at most one
  discount, choosing the lower configured unit price for the member.

### Amount allocation and accounting preview

After calculating raw lines, allocate each amount to payers:

1. Calculate item amount before payer split.
2. Split by payer share.
3. Round line amounts using pricing settings.
4. Adjust any rounding remainder onto the largest payer line so debit equals
   credit.

For each calculated fee, generate proposed accounting lines:

- Debit: receivable account `411` with `member_uuid` and
  `member_account_id_snapshot` for the payer.
- Credit: price item's configured `gl_account_credit_uuid` (706x), with
  `analytical_asset_uuid` set to the glider or launch machine being charged.

The preview should keep one debit line per payer per calculated fee and one
credit line per revenue item. The later accounting entry may optionally group
lines by account/member/asset, but the preview should remain detailed for audit.

Example line shape:

```json
{
  "source": "flight",
  "payer_member_uuid": "...",
  "payer_role": "pilot",
  "pricing_item_uuid": "...",
  "asset_uuid": "...",
  "quantity": "1.25",
  "normal_unit_price": "120.0000",
  "applied_unit_price": "80.0000",
  "discount_reason": "pack",
  "amount": "100.0000",
  "debit_account_code": "411",
  "credit_account_code": "7062",
  "pack_hours_used": "1.25"
}
```

### Preview persistence

For the first milestone, preview can be transient. However, once the display is
stable, persist previews as `flight_billing_quotes` with status `preview` or
`quoted` so that:

- users can compare recalculations.
- import corrections can use `billing_hash`.
- future apply/posting actions reuse exactly the previewed calculation.

The persisted quote must include enough snapshots to remain auditable even if
pricing, member account numbers, or pack balances change later.

### Error model

Use structured error codes, not free text only:

- `member_not_found`.
- `asset_not_found`.
- `pricing_version_missing`.
- `pricing_version_overlap`.
- `pricing_item_account_missing`.
- `payer_rule_missing_second_pilot`.
- `club_billing_target_missing`.
- `quantity_missing`.
- `pack_balance_missing`.

Errors block accounting creation but do not block displaying the preview.
Warnings explain fallback behavior, such as no pack available or no launch
machine pricing configured when the flight has no launch machine.

---

## Modification Handling Rules

### Import and comparison

For each incoming Planche flight revision:

1. Store or find immutable source snapshot by `(planche_uuid, revision)`.
2. If the same revision already exists, return idempotent success.
3. Normalize the snapshot into the ERP current flight shape.
4. Calculate a new billing quote.
5. Compare the new `billing_hash` with the latest accepted/posted quote for the same `planche_uuid`.

### Case 1: new flight

- Store source snapshot.
- Create normalized flight.
- Create billing quote.
- Create accounting Draft entry when the quote is billable.
- Link quote to accounting entry.
- Ack Planche revision after ERP persistence succeeds.

### Case 2: modification with no price impact

Examples:

- observation text changed.
- correction reason changed.
- non-billable metadata changed.
- Planche audit fields changed.

ERP behavior:

- Store the new source snapshot.
- Update normalized current flight fields.
- Keep existing billing quote and accounting entry unchanged.
- Log a `flight_source_update_no_billing_impact` audit event.
- Ack the exact Planche revision.

### Case 3: price impact and accounting entry is Draft

ERP behavior:

- Store the new source snapshot.
- Create a new billing quote.
- Update the existing Draft accounting entry lines from the new quote.
- Mark the previous quote `superseded`.
- Link the new quote to the same accounting entry.
- Log old/new billing diff and changed source fields.
- Ack the exact Planche revision.

### Case 4: price impact and accounting entry is Posted

ERP behavior:

- Store the new source snapshot.
- Create a new billing quote.
- Create a Draft reversal entry from the original Posted entry using existing accounting reversal logic.
- Create a Draft replacement entry from the new quote.
- Link original, reversal, and replacement entries.
- Mark billing state `needs_correction` until both new entries are reviewed/posted.
- Ack Planche only after the correction entries are successfully created, or ack with an ERP status indicating `correction_pending` if Planche needs immediate feedback.

### Case 5: Planche cancellation/deletion

Cancellation follows the same accounting rule:

- If no accounting entry exists, mark the flight cancelled and no billing is needed.
- If the entry is Draft, delete or zero/update the Draft entry according to accounting policy.
- If the entry is Posted, create a reversal entry.
- Ack the exact cancelled/deleted Planche revision.

---

## Planche API Contract (test.api.psa-avat.fr)

The test API has been updated and exposes the ERP flight integration endpoints in OpenAPI version `1.0.45`.

### Authentication

All ERP endpoints use the existing `LOGBOOK-API-KEY` header security scheme.

### Routine incremental sync

Use this endpoint for normal ERP synchronization:

```http
GET /erp/validated-flights/changes?since={cursor}&limit={limit}
```

OpenAPI description:

- Returns all validated flights that changed since the cursor.
- Cursor format is `{updated_at_iso}|{uuid}`.
- Empty `since` means start from the beginning.
- Items are returned in ascending `updated_at` order.
- `limit` defaults to `500`, minimum `1`, maximum `5000`.

Response shape:

```json
{
  "cursor": "2026-05-25T12:34:56Z|previous-flight-uuid",
  "next_cursor": "2026-05-25T12:45:00Z|latest-flight-uuid",
  "has_more": false,
  "items": [
    {
      "uuid": "planche-flight-uuid",
      "revision": 3,
      "status": "updated",
      "updated_at": "2026-05-25T12:40:00Z",
      "corrected_at": "2026-05-25T12:39:00Z",
      "corrected_by": "jdupont",
      "correction_reason": "Landing time corrected",
      "flight": {}
    }
  ]
}
```

ERP behavior:

- Persist `cursor`, `next_cursor`, and `has_more` handling in Planche settings.
- Continue pulling while `has_more=true`.
- Store each item as a revision-specific source snapshot.
- Use `status` and `flight` together as the source payload for normalization and billing comparison.

### Legacy/manual backfill export

Use this endpoint for manual backfill and bulk recovery only:

```http
GET /erp/validated-flights?status={status}&updated_since={datetime}&limit={limit}
```

OpenAPI notes:

- The API describes this as a legacy export endpoint.
- Routine sync should use `/erp/validated-flights/changes`.
- `status` defaults to `0`, allowed range `0..2`.
- `updated_since` is optional date-time.
- `limit` defaults to `500`, maximum `5000`.

### Date-range preview

Use this endpoint for UI preview, dry runs, and backfill validation:

```http
POST /erp/validated-flights/preview
```

Request:

```json
{
  "from_date": "2026-01-01",
  "to_date": "2026-01-31",
  "aero": "LFxx",
  "pilot": "optional",
  "include_transferred": false
}
```

Response:

```json
{
  "total": 42,
  "new": 10,
  "updated": 3,
  "deleted": 1,
  "already_transferred": 28
}
```

Important: the implemented field is `include_transferred`, not `include_acknowledged`.

### Revision-aware acknowledgment

Use this endpoint after ERP has persisted the source snapshot and completed the import/billing decision for that exact revision:

```http
POST /erp/validated-flights/ack
```

Request:

```json
{
  "items": [
    {
      "uuid": "planche-flight-uuid",
      "revision": 3,
      "erp_status": "accepted",
      "erp_reference": "ERP-FLIGHT-123",
      "error": null
    }
  ]
}
```

Response:

```json
{
  "results": [
    {
      "uuid": "planche-flight-uuid",
      "revision": 3,
      "success": true,
      "error": null,
      "current_revision": 3,
      "detail": null
    }
  ]
}
```

Rules from the OpenAPI description:

- Each item is processed independently.
- On revision mismatch, the item is rejected with `revision_mismatch`.
- The rest of the batch can still succeed.
- ERP must keep ack failures retryable without duplicating source snapshots, billing quotes, or accounting entries.

Note: the live ack schema does not include `billing_hash`. ERP should store `billing_hash` internally and may include a quote/accounting identifier in `erp_reference` if useful.

### Soft delete endpoint

Planche exposes an admin soft-delete endpoint:

```http
POST /erp/validated-flights/{uuid}/delete
```

Request:

```json
{
  "reason": "Duplicate validated flight"
}
```

OpenAPI behavior:

- Sets `deleted_at`.
- Bumps `revision`.
- Writes an audit event.
- Deleted flights remain in the database and appear as `deleted` through the changes endpoint.

ERP should treat deleted revisions like cancellation/deletion events and apply the draft-vs-posted accounting rules.

### Validated flight payload fields

The live `ValidatedFlightSchema` contains these fields:

- `uuid` required.
- `aero` required.
- `jour` required date.
- `glider_immat` required; resolve to `assets.registration`.
- `pilot_compta_id`.
- `pilot_erp_id`.
- `second_pilot_id`.
- `second_pilot_erp_id`.
- `charge_to_compta_id`.
- `charge_to_erp_id`.
- `instruction_split`, default `0`.
- `typeOfFlight`.
- `launchMethod`.
- `launch_machine_immat`; resolve to `assets.registration` when present.
- `launch_pilot_trigram`.
- `launch_instructor_trigram`.
- `launchType`.
- `takeoffTime`.
- `landingTime`.
- `startIndex`.
- `stopIndex`.
- `engineTime`.
- `landingCount`, default `1`.
- `flightKm`.
- `takeoffLocation`.
- `landedLocation`.
- `observations`.
- `lastUpdated`.
- `erp_transfer_status`, default `0`.
- `transferred_at`.
- `transferred_by`.
- `last_export_hash`.
- `revision`, default `1`.
- `corrected_at`.
- `corrected_by`.
- `correction_reason`.
- `vi_erp_id`.

### Planche-side correction endpoint

Planche also exposes controlled corrections:

```http
POST /validated-flights/{uuid}/corrections
```

Use this only when ERP needs to push an explicit source correction back to Planche. Normal ERP billing corrections should not call this endpoint; they should consume Planche revisions and acknowledge them.

---

## Implementation Phases

### Phase 0: Fix current pull implementation and model mismatch

- Fix field mappings in `pull_validated_flights`.
- Add missing source fields needed for Planche corrections.
- Stop resetting state before comparing the previous ERP state.
- Add source hash calculation.
- Add tests for field mapping and existing transferred flight detection.

### Phase 1: Add immutable source snapshots and revision-aware import

- Add `planche_flight_snapshots`.
- Import by `(planche_uuid, revision)`.
- Preserve full raw payload.
- Make same revision import idempotent.
- Keep a normalized current flight view linked to the latest accepted snapshot.
- Remove dependence on unique `planche_uuid` as the only history record.

### Phase 2: Add manual billing preview calculation

- Build a side-effect-free flight billing calculator.
- Resolve payers from flight type, pilot, second pilot, `charge_to`, and VI/club rules.
- Resolve pricing versions by flight date and machine asset type.
- Calculate line quantities and amounts using ERP pricing rules.
- Simulate pack discounts without updating member pack balances.
- Return proposed debit 411 and credit 706x accounting lines.
- Generate deterministic `billing_hash`.
- Return explicit pricing errors for unresolved member, asset, pricing version, account, quantity, or club billing target.
- Add single-flight and batch preview endpoints.
- Add UI display for calculation details, warnings, and blocking errors.

### Phase 3: Persist quotes and add accounting orchestration

- Add or complete `flight_billing_quotes` persistence once preview output is stable.
- Store structured billing lines and calculation snapshots.
- Generate Draft flight accounting entries from approved billing quotes.
- Consume pack hours only during apply, in the same transaction as accounting entry creation/update.
- Use existing accounting update behavior for Draft entries.
- Use existing reversal behavior for Posted entries.
- Create replacement Draft entry for corrected posted flights.
- Link original, reversal, and replacement entries.
- Log billing diffs and source field diffs.

### Phase 4: Add Planche ack and sync cursor handling

- Store Planche sync cursor in Planche settings.
- Pull from `GET /erp/validated-flights/changes?since=...`.
- Ack exact `(uuid, revision)` after ERP persistence.
- Keep failed acknowledgments retryable.
- Keep manual date-range import for backfills and recovery.

### Phase 5: Add Flights UI in daily accounting operations

Add a Flights tab under Banque > Daily Ops.

Required UI:

- Import controls:
  - since last sync.
  - date range.
  - dry-run/preview.
- Review queue grouped by:
  - new.
  - changed with no price impact.
  - changed with price impact.
  - cancellation/deletion.
  - errors.
  - correction pending.
- Flight detail drawer:
  - Planche source diff.
  - normalized ERP fields.
  - old vs new billing lines.
  - linked accounting entries.
- Actions:
  - accept no-price-impact change.
  - update Draft entry.
  - create reversal and replacement.
  - defer with reason.
  - retry Planche ack.

### Phase 6: Tests and migration notes

- Add migrations for new snapshot/quote/link tables.
- Add backfill script for existing `validated_flights`.
- Add route/service tests for import, idempotency, billing comparison, draft update, posted correction, cancellation, and ack retry.
- Add UI tests for queue status rendering and correction actions.

---

## API Endpoints in ERP Club

### Backend endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/planche/flights/preview` | Dry-run Planche import and return counts/diffs |
| `POST` | `/api/v1/planche/flights/pull` | Pull and persist Planche flight revisions |
| `GET` | `/api/v1/planche/flights` | List imported flights and workflow states |
| `GET` | `/api/v1/planche/flights/{flight_uuid}` | Show normalized flight, source snapshots, quote, and accounting links |
| `POST` | `/api/v1/flights/{flight_uuid}/billing-preview` | Calculate one flight billing preview without applying it |
| `POST` | `/api/v1/flights/billing-preview` | Calculate batch billing previews without applying them |
| `POST` | `/api/v1/planche/flights/{flight_uuid}/accept` | Accept a no-price-impact change |
| `POST` | `/api/v1/planche/flights/{flight_uuid}/apply-draft-update` | Update linked Draft accounting entry |
| `POST` | `/api/v1/planche/flights/{flight_uuid}/create-correction` | Create reversal and replacement entries |
| `POST` | `/api/v1/planche/flights/ack/retry` | Retry failed Planche acknowledgments |

### Capabilities

- Reuse `CAP_MANAGE_PLANCHE` for import and preview.
- Add `CAP_MANAGE_FLIGHTS_BILLING` for accounting-impacting flight actions.
- Existing accounting posting permissions remain responsible for posting Draft entries.

---

## Test Plan

### Import and source snapshots

- Pull creates a new source snapshot and normalized flight.
- Pull same `(planche_uuid, revision)` is idempotent.
- Pull newer revision stores a second immutable snapshot.
- Pull missing required identifiers marks the flight `needs_review` with clear errors.

### Billing preview and comparison

- Manual preview calculates payer allocation, price lines, pack simulation, and proposed accounting lines without creating entries.
- Preview does not update `member_sheets.remaining_hours_in_pack`.
- Batch preview consumes simulated pack hours chronologically and independently from persisted pack balances.
- Non-billing Planche field changes do not change `billing_hash`.
- Billing-impacting changes change `billing_hash`.
- Pricing version, account, discount, quantity, and bill-to changes are included in the hash.
- Observations, correction reason, and Planche audit timestamps are excluded from the hash.

### Accounting behavior

- New billable flight creates a Draft accounting entry.
- New no-charge flight creates a quote with `no_charge` and no accounting entry.
- Price-impact modification with Draft entry updates the same Draft entry.
- Price-impact modification with Posted entry creates reversal and replacement Draft entries.
- Cancelled flight with Draft entry updates/deletes the Draft according to policy.
- Cancelled flight with Posted entry creates a reversal.

### Planche ack

- Ack sends exact `uuid + revision`.
- Ack failure does not duplicate ERP snapshots, quotes, or entries on retry.
- Revision `N+1` remains unacknowledged if only revision `N` was acked.

### UI

- Flights tab shows new, changed, no-price-impact, price-impact, error, and correction-pending queues.
- Detail drawer shows source diff and billing diff.
- Actions are disabled when the user lacks the required capability.
- Ack retry is visible for ack failures.

---

## Decisions and Assumptions

- ERP Club calculates prices and accounting entries; Planche only provides flight facts and corrections.
- Planche remains the source of truth for flight facts, correction metadata, and cancellation/deletion state.
- ERP Club stores every Planche revision it receives immutably.
- Existing accounting Draft update and Posted reversal behavior will be reused.
- Posted accounting entries are never modified in place.
- A deterministic `billing_hash` is the decision boundary for whether a Planche change has accounting impact.
- Planche acknowledgment must be revision-aware.
- Manual date-range import remains available for backfill and recovery even after cursor-based sync is added.
