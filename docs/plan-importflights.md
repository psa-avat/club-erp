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

### Phase 2: Add pricing/billing quote generation

- Add `flight_billing_quotes`.
- Resolve pricing version by flight date and asset/flight type.
- Calculate line quantities and amounts using ERP pricing rules.
- Store structured billing lines.
- Generate deterministic `billing_hash`.
- Return explicit pricing errors for unresolved member, asset, pricing version, or account.

### Phase 3: Add accounting orchestration

- Generate Draft flight accounting entries from billing quotes.
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

### Billing comparison

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
