# Plan: Flight Integration Step 1 — Planche Synchronization

## TL;DR

Fix the existing `pull_validated_flights` (has field mapping + status detection bugs), then build the bidirectional transfer flow: pull flights from Planche → insert/update in ERP → set `erp_status=1` (transferred) → acknowledge back to Planche via `POST /erp/validated-flights/ack`. Handle modified flights based on their ERP status (draft vs locked).

---

## Research Summary: Planche API (test.api.psa-avat.fr)

### Existing usage
- `GET /validated-flights` — Already used by `pull_validated_flights` to pull flights
- `GET /validated-flights` (with `date_from`/`date_to`/`aero`/`pilot`/`status` filters) — Available

### Available but NOT used yet (needed for Step 1)
- **`POST /erp/validated-flights/ack`** — Acknowledge validated flights as transferred (payload: `{"uuids": [...], "export_hash": "..."}`). This is the proper ERP handshake endpoint — **preferred over PUT /vols/{id}/status**.

### Known bugs in current `pull_validated_flights` (must fix)
1. **Field mapping bug** (lines 1118-1119): `flight_obj.aero` and `flight_obj.glider_immat` don't exist on ERP's `ValidatedFlight` model. Planche returns these fields — we need to add `aero` to our model, and map `glider_immat` → `asset_code`.
2. **Status detection bug** (lines 1151-1157): `erp_status` is set to 0 on line 1151, then checked for `== 1` on line 1157. The check **always fails** because value was just overwritten. Must capture `existing_flight.erp_status` BEFORE overwriting.
3. **Missing fields**: Planche's `ValidatedFlight` has `pilot_compta_id`, `second_pilot_id`, `charge_to_compta_id`, `lastUpdated`, `revision`, `corrected_at`, `corrected_by`, `correction_reason`, `vi_id` — not captured in our model.

---

## Step 1: Planche Synchronization

### Goals
- Pull new/modified flights from Planche (with proper detection)
- Insert new flights → mark transferred → ack to Planche
- For modified flights:
  - If **draft** (erp_status=0): update in place → mark transferred → ack
  - If **locked** (erp_status=1): mark old as "to_be_canceled" → create new flight record → no transfer yet (waiting on accounting in Steps 2/3)

### Phases

#### Phase 0: Fix existing bugs + align data model (prerequisite)

**Files:**

**(a) `backend/models.py` — Add missing fields to `ValidatedFlight`**

Planche returns these fields that our model currently lacks:
- `aero = Column(String, nullable=False)` — aerodrome code
- `pilot_compta_id = Column(String, nullable=True)` — legacy accounting ID
- `second_pilot_id = Column(String, nullable=True)` — legacy second pilot ID  
- `charge_to_compta_id = Column(String, nullable=True)` — legacy billing ID
- `last_updated = Column(String, nullable=True)` — Planche's `lastUpdated` timestamp
- `revision = Column(Integer, nullable=False, default=1)` — Planche revision counter
- `corrected_at = Column(DateTime, nullable=True)`
- `corrected_by = Column(String, nullable=True)`
- `correction_reason = Column(Text, nullable=True)`

Also: map `glider_immat` → our existing `asset_code` via rename or alias.

**(b) `backend/services/planche_integration.py` — Fix `pull_validated_flights`**

- Map Planche fields correctly:
  - `glider_immat` → `flight_obj.asset_code`
  - `aero` → `flight_obj.aero` (new)
  - `pilot_compta_id`/`second_pilot_id`/`charge_to_compta_id` → new fields
  - `lastUpdated` → `flight_obj.last_updated`
  - `revision` → `flight_obj.revision`
- **Fix status detection**: capture `existing_flight.erp_status` BEFORE setting to 0
- Compute `last_export_hash` from source fields for modification detection

**Verification:**
- Unit test: pull flights from mocked Planche data, verify all fields mapped correctly
- Unit test: pull existing flight with erp_status=1, verify it's detected as modified

---

#### Phase 1: Add `to_be_canceled` status and data model updates

**Model changes** (`backend/models.py`):
- Add `erp_status = 3` meaning "to_be_canceled" to the status docstring
- Update the `CheckConstraint("erp_status IN (0, 1, 2, 3)")`
- The `to_be_canceled` flag indicates the flight will be superseded by a new version once accounting is resolved

**Constants changes** (`backend/constants.py`):
- Add `CAP_MANAGE_FLIGHTS_TRANSFER` capability (for the transfer operation)
- Add capability seeds tuple

**Verification:**
- Migration script for constraint update
- Test creating flight with erp_status=3

---

#### Phase 2: Add transfer methods to PlancheIntegrationService

**File:** `backend/services/planche_integration.py`

New methods on `PlancheIntegrationService`:

**(a) `acknowledge_flights(db, planche_uuids: list[str], export_hash: str | None, triggered_by: str)`**
- Calls `POST /erp/validated-flights/ack` with `{"uuids": planche_uuids, "export_hash": export_hash}`
- This is the **sole** acknowledgment mechanism (no individual flight status endpoint)
- Returns success/error per flight
- Logs audit `flights_ack` operation

**(b) `transfer_flights_to_planche(db, flight_uuids: list[str], triggered_by: str)`**
- Orchestrates the full transfer flow:
  - For each flight in a batch:
    - Set `erp_status = 1`, `transferred_at = now`, `transferred_by = triggered_by`
    - Collect planche_uuids for the ack call
  - Call `acknowledge_flights()` with the batch
  - Partial success: mark as transferred in ERP even if some ack calls fail
  - Log audit `flights_transfer` operation

**(c) Refactor `pull_validated_flights` for enhanced flow**
- Return structured `FlightPullResult` with:
  - `new_flights`: list created (planche_uuid, erp_uuid)
  - `modified_flights`: list with previous erp_status for downstream decision
  - `errors`: list of error details

**Verification:**
- Unit test: acknowledge batch of flights
- Unit test: partial success (some ack fail, some succeed)
- Integration test: full pull → process → transfer → ack cycle

---

#### Phase 3: API Endpoints

**File:** `backend/api/routes/planche.py`

New endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/planche/flights/pull` | Pull new/modified flights from Planche |
| `POST` | `/api/v1/planche/flights/transfer` | Transfer flights and ack to Planche |

**Request/Response schemas** (`backend/schemas/planche.py`):
- `FlightPullRequest`: `from_date`, `to_date` (optional)
- `FlightPullResponse`: `total`, `created`, `updated`, `modified_after_transfer`, `errors`
- `FlightTransferRequest`: `flight_uuids: list[str]` (optional — if omitted, transfer all eligible)
- `FlightTransferResponse`: `transferred_count`, `failed_count`, `errors`

**Capability guard:**
- `CAP_MANAGE_PLANCHE` reused for pull
- `CAP_MANAGE_FLIGHTS_TRANSFER` (new) for transfer

**Verification:**
- Test: pull endpoint returns correct counts
- Test: transfer endpoint sets erp_status and calls Planche ack
- Test: capability guard blocks unauthorized users

---

#### Phase 4: Modified flight handling (ERP status-based logic)

**File:** `backend/services/planche_integration.py`

New method: `handle_modified_flights(db, modified_flights: list, triggered_by: str)`

Logic:
1. For each modified flight record from Planche:
   - Load existing ERP flight by `planche_uuid`
   - If **erp_status == 0 (draft)**: update all fields in-place → proceed to transfer normally
   - If **erp_status == 1 (transferred/locked)**:
     - Set existing flight to `erp_status = 3` (to_be_canceled)
     - Create a **new** ValidatedFlight record with erp_status=0 (draft)
     - The new flight gets a new ERP UUID, same planche_uuid
     - Leave accounting_entry_uuid null on both (will be handled in Steps 2/3)
   - If **erp_status == 2 (modified_after_transfer)**: same as erp_status=1 treatment

**Important boundary:** The "to_be_canceled" flag does NOT generate accounting entries yet. This is a placeholder for Step 2/3.

**Verification:**
- Test: draft flight modification → updates in place
- Test: locked flight modification → old marked canceled, new created
- Test: locked flight with accounting_entry_uuid → preserved on old, null on new

---

### Out of Scope for Step 1
- Price calculations (Step 2)
- Accounting entries generation (Step 3)
- Frontend UI for flight management
- Flight charges import (mentioned in comments as Phase 2)

---

## Relevant Files

| File | What to do |
|------|-----------|
| `backend/models.py` | Add missing fields (`aero`, `pilot_compta_id`, etc.), add erp_status=3 value, update CheckConstraint |
| `backend/constants.py` | Add `CAP_MANAGE_FLIGHTS_TRANSFER` capability |
| `backend/schemas/planche.py` | Add flight pull/transfer request/response schemas |
| `backend/services/planche_integration.py` | Fix bugs in `pull_validated_flights`; add `acknowledge_flights`, `transfer_flights_to_planche`, `handle_modified_flights` |
| `backend/api/routes/planche.py` | Add flight pull + transfer endpoints |
| `backend/tests/test_planche_flight_routes.py` | New test file for flight sync |
| `docs/migrations/` | Migration for new model fields + constraint update |

---

## Verification

1. **Unit tests**: field mapping fix, status detection fix, acknowledge request formatting
2. **Integration test**: full cycle — pull flights → process modifications → transfer → ack → verify Planche receives status
3. **API smoke test**: call new endpoints with sample data, verify responses
4. **Audit log review**: verify `flights_pull`, `flights_transfer`, `flights_ack` audit entries created

---

## Decisions & Boundaries

- **New status `to_be_canceled` (3)**: Introduced as a marker only; no accounting impact until Step 2/3
- **Ack endpoint**: Only `POST /erp/validated-flights/ack` for batch transfer acknowledgment
- **No frontend**: Step 1 is backend-only; frontend integration deferred
- **`last_export_hash`**: Used for modification detection during pull; computed from source fields
- **Partial transfer**: Successful flights marked transferred even if some ack calls fail
- **Flight identifier**: Keep `planche_uuid` as string (matches Planche's `uuid` field, not auto-increment `id`)
