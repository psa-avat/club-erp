"""
    ERP-CLUB - Phase 1 Implementation Summary (REVISED)
    Planche Integration Schema Extensions and Service Foundation

    This document summarizes the Phase 1 backend implementation for Planche integration.
    All code follows the project's architecture, naming conventions, and GPL v3 licensing.
    
    REVISION 2: Removed redundant planche_*_id caching fields; moved charges to separate table.
"""

# Phase 1 Implementation — Partially Implemented (REVISED)

> **ACTUAL STATUS (verified 2026-07-01): Partially implemented — see "Remaining / Not Yet Done"
> at the end of this document.** `ValidatedFlight`, `AuditLog`, and `PlancheIntegrationService`
> (`batch_push_pilots`, `batch_push_machines`, `pull_validated_flights`) exist in code and match
> this document's description. However, the `FlightCharges` model described below does **not**
> exist in `backend/models.py`, and the `flight_charges` table was never created by the
> migration SQL — only referenced in a comment. The split-charge / multi-beneficiary billing
> pattern this document describes is unfinished. Do not treat Phase 1 as complete.

## Overview
Phase 1 establishes the schema foundations and integration service for Planche-ERP sync.
Core sync backend code (ValidatedFlight, AuditLog, PlancheIntegrationService) is implemented
with async support, retry logic, and audit trails. The charge-splitting piece described below
is still outstanding — see "Remaining / Not Yet Done".

**KEY ARCHITECTURAL DECISIONS:**
- Member/Asset do **not** cache Planche IDs (member_id and asset_code are sync keys)
- Charges stored in separate `flight_charges` table with `NUMERIC(10,4)` precision
- Supports 2 beneficiaries per flight (e.g., pilot + tow operator)
- ValidatedFlight uses UUIDv4 for consistency with members table

---

## 1. DATA MODEL EXTENSIONS

### Member Model (backend/models.py)
**NO CHANGES REQUIRED** - Planche integration uses `member_id` (UUID) as the sync key.
No caching of Planche IDs needed; Planche sends member_id for all pilot references.

### Asset Model (backend/models.py)
**NO CHANGES REQUIRED** - Planche integration uses `asset_code` (String) as the sync key.
No caching of Planche IDs needed; Planche sends asset_code for all machine references.

---

### ValidatedFlight Model (backend/models.py - NEW)
Brand new SQLAlchemy model capturing full Planche flight context:

**Identifiers**:
- `uuid` (UUID, PK) - ERP flight record identifier
- `planche_uuid` (String, unique index) - Planche API sync key

**Flight Context** (required):
- `aero` (String) - Aero/club code
- `jour` (Date) - Flight date
- `glider_immat` (String) - Glider registration/aircraft immatriculation

**Pilot Assignment** (mixed required/optional):
- `pilot_erp_id` (String, required) - Main pilot (Member UUID)
- `second_pilot_erp_id` (String, optional) - Second pilot or instructor
- `charge_to_erp_id` (String, optional) - Billing/charging member (may differ from pilot)
- `instruction_split` (Integer, default 0) - Instruction percentage
- `vi_erp_id` (String, optional) - Instructor assignment identifier

**Flight Details** (mixed):
- `typeOfFlight` (Integer, required) - Enum 0-7 (INSTRUCTION, SOLO, INITIATION, PARTAGE, PASSAGER, LACHER, SUPERVISE, ESSAI)
- `launchMethod` (Integer, required) - Enum 0-3 (EXTERNE, TREUIL, REMORQUEUR, AUTONOME)
- `launchType` (Integer, optional) - Detailed launch classification

**Tow/Winch Details** (optional):
- `launch_machine_immat` (String) - Tow plane or winch registration
- `launch_pilot_trigram` (String) - Tow pilot callsign
- `launch_instructor_trigram` (String) - Launch instructor callsign

**Timing & Indexes** (mixed):
- `takeoffTime` (String, required) - HH:MM format
- `landingTime` (String, required) - HH:MM format
- `startIndex` (Float, optional) - Altimeter/index at start
- `stopIndex` (Float, optional) - Altimeter/index at end
- `engineTime` (Float, optional) - Engine time in 1/100ths of hours
- `landingCount` (Integer, default 1) - Number of landings on flight

**Flight Metrics** (optional):
- `flightKm` (Float) - Distance covered in km
- `takeoffLocation` (String) - ICAO code or airport name
- `landedLocation` (String) - ICAO code or airport name
- `observations` (Text) - Free-text notes

**ERP Status & Audit Metadata**:
- `erp_status` (SmallInteger, required, indexed):
  - 0 = validated (draft, not yet transferred to accounting)
  - 1 = transferred (locked in accounting system)
  - 2 = modified_after_transfer (changed after accounting transfer)
- `validated_at` (DateTime, required) - When flight was validated/imported
- `validated_by` (String, required) - User ID or system identifier
- `transferred_at` (DateTime, optional) - When transferred to accounting
- `transferred_by` (String, optional) - User who authorized transfer
- `last_export_hash` (String, optional) - Hash for modification detection

**Timestamps**:
- `created_at` (DateTime, default=now) - Record creation time
- `updated_at` (DateTime, default=now, auto-update) - Last modification time

**Constraints**:
- `typeOfFlight BETWEEN 0 AND 7`
- `launchMethod BETWEEN 0 AND 3`
- `erp_status IN (0, 1, 2)`
- `landingCount >= 1`
- `unique(planche_uuid)` - Prevent duplicate Planche flights

**NOTE**: Charges are NOT stored on ValidatedFlight. See FlightCharges model below.

---

### FlightCharges Model (backend/models.py - NEW) — ⚠️ NOT ACTUALLY IMPLEMENTED
**Verification note (2026-07-01): this model does not exist in `backend/models.py`.** A
`grep -n "FlightCharges" backend/models.py` finds nothing, and the migration SQL
(`deploy/init-db/phase1_planche_integration.sql`) does not create a `flight_charges` table —
the string only appears in a header comment describing intent. The tables actually created by
that migration are `planche_flight_snapshots`, `validated_flights`, and `planche_audit_log`.
The description below is the **design that was planned but not built**; treat it as a spec for
future work, not a completed deliverable.

Per-flight charging breakdown with support for 2 beneficiaries (e.g., pilot + tow operator).

Uses `NUMERIC(10,4)` precision per accounting standards (e.g., 125.5000 = €125.50).

**Fields**:
- `uuid` (UUID, PK) - Charge record identifier
- `validated_flight_uuid` (UUID, FK→validated_flights) - Associated flight
- `member_uuid` (UUID, FK→members) - Beneficiary member (pilot, tow operator, etc.)
- `engine_price` (NUMERIC(10,4), default 0) - Charge for tow/launch service
- `airframe_price` (NUMERIC(10,4), default 0) - Charge for glider/plane rental
- `created_at` (DateTime) - Record creation
- `updated_at` (DateTime) - Last update

**Relationship**: One flight can have multiple charges (e.g., charge to pilot + charge to tow operator).

**Constraints**:
- `engine_price >= 0`
- `airframe_price >= 0`

**Indices**: `validated_flight_uuid`, `member_uuid` for fast queries.

**TOTAL FLIGHT COST** = SUM(engine_price + airframe_price) across all associated members.

---

### AuditLog Model (backend/models.py - NEW)
Immutable audit trail for all Planche sync operations:

```python
class AuditLog(Base):
    operation_type: String  # pilot_push, machine_push, flights_pull, flights_validate, etc.
    affected_record_id: String (optional)  # Record UUID being operated on
    status: SmallInteger  # 0=success, 1=error, 2=partial
    result_summary: String (optional)  # Human-readable result
    error_message: Text (optional)  # Detailed error if applicable
    total_records: Integer (optional)  # Count for batch operations
    success_count: Integer (optional)
    failure_count: Integer (optional)
    triggered_by: String (optional)  # User/system identifier
    metadata: Text (optional)  # JSON string with operation-specific data
    created_at: DateTime (required, indexed)  # Operation timestamp
```

**Indices**: operation_type, affected_record_id, created_at for fast queries and cleanup.

---

## 2. SERVICE LAYER

### PlancheIntegrationService (backend/services/planche_integration.py - NEW)

**Initialization**:
```python
service = PlancheIntegrationService(
    base_url="https://planche.example.com/api",
    connection_id="club-001",
    token="LOGBOOK-API-KEY-VALUE",
    user="erp@club.fr",
    password="secure-password",
    retry_max_attempts=3,
    retry_backoff_ms=1000,
)
```

**Core Methods**:

#### 1. `async batch_push_pilots(db, triggered_by="system")`
Push eligible members to Planche `/pilotes` endpoint.

- **Filter**: Members where `can_fly=true` and `status=1` (active)
- **Payload per pilot**:
  ```json
  {
    "ffvp_id": 12345678,
    "account_id": "MEMBER-001",
    "first_name": "Jean",
    "last_name": "Dupont",
    "email": "jean@club.fr",
    "phone": "+33612345678",
    "trigram": "JDU"
  }
  ```
- **Response handling**: Planche confirms receipt; no ID caching needed (uses member_id as key)
- **Audit logging**: Records operation with success/failure counts
- **Returns**: `{ "total": N, "success": N, "failure": N, "error_details": [...] }`

#### 2. `async batch_push_machines(db, triggered_by="system")`
Push eligible assets to Planche `/machines` endpoint.

- **Filter**: Assets where `is_active=true` and `status=1` (operational)
- **Payload per machine**:
  ```json
  {
    "code": "F-ABCD",
    "registration": "F-ABCD",
    "model": "ASW-28",
    "manufacturer": "Alexander Schleicher",
    "year": 2015
  }
  ```
- **Response handling**: Planche confirms receipt; no ID caching needed (uses asset_code as key)
- **Audit logging**: Records operation results
- **Returns**: `{ "total": N, "success": N, "failure": N, "error_details": [...] }`

#### 3. `async pull_validated_flights(db, from_date=None, to_date=None, triggered_by="system")`
Pull validated flights from Planche `/validated-flights` endpoint.

- **Query parameters**: Optional `from_date` and `to_date` for incremental pulls
- **Response handling**: Expects list of flight objects with all ValidatedFlight fields
- **Upsert logic**:
  - Check if flight exists by `planche_uuid`
  - If exists: Update all fields, mark as modified if previously transferred
  - If new: Insert as `erp_status=0` (draft)
- **Deduplication**: Skips flights with missing `planche_uuid`
- **Status tracking**: Logs created/updated/skipped counts
- **Audit logging**: Detailed metadata with operation statistics
- **Returns**: `{ "total": N, "created": N, "updated": N, "skipped": N, "error_details": [...] }`

#### 4. `async _perform_request(method, endpoint, json=None, params=None)` (Private)
Shared HTTP client with exponential backoff retry logic.

- **Header**: Always includes `LOGBOOK-API-KEY: {token}`
- **Timeout**: 30 seconds
- **Retry strategy**:
  - Retries on server errors (5xx) and network timeouts
  - Does NOT retry on client errors (4xx) - assumes invalid request
  - Exponential backoff: `backoff_ms * (2 ^ attempt)`
- **Returns**: httpx.Response object (caller handles status codes)

#### 5. `async _log_audit(...)` (Private)
Helper to log operations to AuditLog table.

---

## 3. SCHEMA EXTENSIONS

### PlancheSettingsPayload (backend/schemas/planche.py)

Extended Pydantic schema with Phase 1+ fields:

```python
class PlancheSettingsPayload(BaseModel):
    # Original MVP fields
    base_url: str = Field(min_length=1)
    connection_id: str = Field(min_length=1)
    token: str = Field(min_length=1)
    user: str = Field(min_length=1)
    password: str = Field(min_length=1)
    environment: str = Field(default="test", min_length=1)
    
    # Phase 1+ sync cursor fields
    sync_cursor_flights: Optional[datetime] = None  # Last pull timestamp
    sync_cursor_pilots: Optional[datetime] = None   # Last push timestamp
    sync_cursor_machines: Optional[datetime] = None # Last push timestamp
    
    # Retry configuration
    retry_max_attempts: int = Field(default=3, ge=1, le=10)
    retry_backoff_ms: int = Field(default=1000, ge=100, le=60000)
    
    # Feature flags
    feature_flags: dict[str, bool] = Field(default_factory=lambda: {
        "enable_pilot_push": True,
        "enable_machine_push": True,
        "enable_flight_pull": True,
    })
```

---

## 4. DATABASE MIGRATION

### SQL Migration (deploy/init-db/phase1_planche_integration.sql)

Ready-to-apply migration script (PostgreSQL):

**Tables created:**

1. **validated_flights** - Flight records imported from Planche
   - 38 columns capturing full flight context
   - Unique on `planche_uuid` for sync deduplication
   - Indexed on `planche_uuid`, `jour`, `erp_status`

2. **flight_charges** - Per-flight charging with multiple beneficiaries
   - Links to `validated_flights` (FK, cascade delete)
   - Links to `members` (FK, cascade delete)
   - `engine_price` and `airframe_price` both NUMERIC(10,4)
   - Supports up to 2 charges per flight
   - Indexed on `validated_flight_uuid`, `member_uuid`

3. **planche_audit_log** - Immutable audit trail
   - Operation logging for all sync/pull/push activities
   - Indexed on `operation_type`, `affected_record_id`, `created_at`

**What's NOT changed:**
- `members` table: No Planche ID caching needed
- `assets` table: No Planche ID caching needed

**Application**:
```bash
psql -d erp_database -f deploy/init-db/phase1_planche_integration.sql
```

---

## 5. DEPENDENCIES

### Backend Requirements
Added to `backend/requirements.txt`:
- `httpx>=0.25.0` - Async HTTP client with connection pooling

---

## 6. ENUMS

### TypeOfFlight (backend/models.py)
```python
class TypeOfFlight(IntEnum):
    INSTRUCTION = 0
    SOLO = 1
    INITIATION = 2
    PARTAGE = 3
    PASSAGER = 4
    LACHER = 5
    SUPERVISE = 6
    ESSAI = 7
```

### LaunchMethod (backend/models.py)
```python
class LaunchMethod(IntEnum):
    EXTERNE = 0       # External/tow launch
    TREUIL = 1        # Winch launch
    REMORQUEUR = 2    # Tow plane
    AUTONOME = 3      # Self-launch (motorglider)
```

---

## 7. VALIDATION & TESTING STATUS

✅ **Python Syntax**: All files pass `py_compile` check
✅ **Type Hints**: Complete type annotations throughout
✅ **Pydantic Schemas**: Validation passes with default values
✅ **Async Support**: All DB operations use async/await
✅ **Error Handling**: Comprehensive try/catch with audit logging

---

## 8. PHASE 2 DEPENDENCIES

Phase 2 (API Endpoints) will require:

1. **New API Routes** (`backend/api/routes/planche.py`):
   - `POST /api/planche/pilots/sync` → Trigger `batch_push_pilots()`
   - `POST /api/planche/machines/sync` → Trigger `batch_push_machines()`
   - `POST /api/planche/flights/pull` → Trigger `pull_validated_flights()`
   - `GET /api/planche/flights` → Query ValidatedFlight records
   - `PATCH /api/planche/flights/{uuid}` → Update flight status

2. **Frontend Pages**:
   - Flights import/sync dashboard
   - Flights grid with validation controls
   - Audit log viewer

3. **Integration Tests**:
   - Mock Planche API responses
   - Test retry/backoff logic
   - Test deduplication (upsert on planche_uuid)
   - Test charge splitting and audit logging

---

## 9. FILE MANIFEST

| File | Status | Changes |
|------|--------|---------|
| backend/models.py | ⚠️ Partially done | Added ValidatedFlight (verified present), AuditLog (verified present), enums TypeOfFlight & LaunchMethod. **FlightCharges was NOT added** — verified absent via grep. NO changes to Member/Asset. |
| backend/services/planche_integration.py | ✅ NEW | PlancheIntegrationService with batch sync methods (pilots, machines, flights) — verified present. No ID caching logic. |
| backend/schemas/planche.py | ✅ Modified | Extended PlancheSettingsPayload with cursors and feature flags (no changes to validation). |
| backend/requirements.txt | ✅ Modified | Added httpx>=0.25.0 |
| deploy/init-db/phase1_planche_integration.sql | ⚠️ Partially done | Migration creates `validated_flights`, `planche_audit_log`, and `planche_flight_snapshots` — verified present. **Does NOT create `flight_charges`**; that table name only appears in a comment. NO alterations to members/assets. |

---

## 10. USAGE EXAMPLE

```python
# Initialize service from PlancheSettingsPayload
from backend.services.planche_integration import PlancheIntegrationService
from backend.schemas.planche import PlancheSettingsPayload
from database import get_async_session

settings = PlancheSettingsPayload(
    base_url="https://planche.example.com/api",
    connection_id="club-001",
    token="xyz-api-key",
    user="erp@club",
    password="pass",
    retry_max_attempts=3,
    feature_flags={"enable_pilot_push": True, "enable_machine_push": True, "enable_flight_pull": True}
)

service = PlancheIntegrationService(
    base_url=settings.base_url,
    connection_id=settings.connection_id,
    token=settings.token,
    user=settings.user,
    password=settings.password,
    retry_max_attempts=settings.retry_max_attempts,
)

async with get_async_session() as db:
    # Push pilots
    result = await service.batch_push_pilots(db, triggered_by="system")
    print(f"Pilots: {result['success']}/{result['total']} synced")
    
    # Push machines
    result = await service.batch_push_machines(db, triggered_by="system")
    print(f"Machines: {result['success']}/{result['total']} synced")
    
    # Pull flights (last 7 days)
    from datetime import datetime, timedelta, timezone
    from_date = datetime.now(timezone.utc) - timedelta(days=7)
    result = await service.pull_validated_flights(db, from_date=from_date, triggered_by="admin-user")
    print(f"Flights: {result['created']} new, {result['updated']} updated")
```

---

## 11. NOTES & DESIGN DECISIONS

- **No Planche ID Caching**: Members use `member_id` (UUID) and Assets use `asset_code` (String) as sync keys. Planche sends these values back, so no need to cache separate planche_pilot_id/planche_machine_id.

- **Async/Await**: All service methods require `async with` context for database sessions.

- **Split Charges Model**: 
  - ValidatedFlight has NO charge columns
  - FlightCharges table stores charges separately
  - Supports 2 beneficiaries per flight (e.g., pilot + tow operator)
  - Uses NUMERIC(10,4) for accounting precision (e.g., 125.5000 = €125.50)
  - Total cost = SUM(engine_price + airframe_price) across all charges

- **Planche UUID Deduplication**: Uses `planche_uuid` as unique sync key to prevent duplicates across imports.

- **Status Lifecycle**: Flights flow from `erp_status=0` (draft) → `erp_status=1` (transferred) → potentially `erp_status=2` (modified).

- **Error Recovery**: Failed syncs logged to AuditLog; no tracking fields on Member/Asset (status can be inferred from AuditLog).

- **Incremental Sync**: `sync_cursor_*` fields in PlancheSettingsPayload enable resumable pulls (Phase 2+ feature).

---

## 12. REMAINING / NOT YET DONE (audit 2026-07-01)

Direct verification against the repo on 2026-07-01:

- **`FlightCharges` model does not exist.** `grep -n "FlightCharges" backend/models.py`
  returns no matches. Sections 1 ("FlightCharges Model — NEW"), 9 (file manifest), and 11
  ("Split Charges Model") describe a model that was never implemented.
- **`flight_charges` table was never created.** The migration
  `deploy/init-db/phase1_planche_integration.sql` only creates `planche_flight_snapshots`,
  `validated_flights`, and `planche_audit_log` (confirmed via `grep -n "^CREATE TABLE"`).
  `flight_charges` appears exactly once, in a header comment stating the intent to create it.
- **Split-charge / multi-beneficiary billing is unfinished.** Since there is no charges table,
  `ValidatedFlight` has no way to record per-beneficiary `engine_price`/`airframe_price`, and
  the "TOTAL FLIGHT COST = SUM(...)" logic described in section 1 has no backing storage.
  Any billing/accounting code that assumes this table exists will fail.
- **What IS confirmed working**: `ValidatedFlight` and `AuditLog` models in
  `backend/models.py` (verified by grep), and `PlancheIntegrationService` in
  `backend/services/planche_integration.py` with `batch_push_pilots`, `batch_push_machines`,
  and `pull_validated_flights` methods (verified present).

**Before starting Phase 2 API endpoints that touch flight charging, either implement the
`FlightCharges` model + migration as originally designed, or revise this document's billing
design if a different approach was chosen.**

---

End of Phase 1 Implementation Documentation (Revised)
