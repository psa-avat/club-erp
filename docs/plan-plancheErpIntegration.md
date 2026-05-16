## Plan: Planche de vol integration

Create a manual, idempotent integration layer between ERP-CLUB and the Planche de vol backend. ERP remains the source of truth for pilots and machines, and Planche de vol remains the source of truth for validated flights. The first version should push only active registered pilots and active machines from ERP to Planche, and pull validated flights back into ERP with a transfer state plus last-update tracking so the same flight is never billed twice.

**Status: Phase 0 (MVP) Complete ✅ | Phases 1–7 Pending**

Phase 0 (MVP) delivered:
- Planche integration settings page (`/planche/integration`) with connection/credential form
- Settings persistence via generic `system_settings` table with module_name=PLANCHE_SETTINGS_MODULE ("planche")
- Test connection endpoint (GET /heartbeat via Planche API with LOGBOOK-API-KEY auth)
- Test login endpoint (POST /auth/login via Planche API with username/password)
- Authorization gating via MANAGE_ACCOUNTING_SETTINGS capability
- Frontend module with React Query hooks and TanStack Query v5 integration
- i18n namespace (`planche`) with EN/FR translations
- Sidebar navigation entry with capability guard

**Steps**
1. ✅ **Phase 0 – Settings & Contract Baseline** (COMPLETE)
   - Lock the integration contract and field mapping against the existing ERP models and the Planche API surface.
     - **Pilots mapping:** Member names, FFVP number, compta_id, erp_id, trigram from ERP member record
       - Planche pilot schema includes: `no`, `nom`, `prenom`, `ffvp`, `trigramme`, `id_compta`, `erp_id`, `isActif`, `updated_at`, `updated_by`
       - ERP must provide: name (nom+prenom), FFVP, compta_id, erp_id (UUID or member PK), trigram
     - **Machines mapping:** Map ERP asset/machine record to Planche machine payloads using stable external identifier
       - Planche machine schema includes: `no`, `immat`, `modele`, `type`, `nb_seats`, `private`, `arretee`, `updated_at`, `updated_by`
       - ERP must provide: immat (registration), model, type, seat count, active/archived state
     - **Flights mapping:** Import only validated flights from Planche, keyed by Planche flight UUID, with ERP-side transfer state and updated_at tracking
       - Planche validated_flights schema includes: `uuid` (PK), `aero`, `jour`, `glider_immat`, `pilot_compta_id`, `pilot_erp_id`, `second_pilot_id`, `second_pilot_erp_id`, `charge_to_compta_id`, `charge_to_erp_id`, `typeOfFlight`, `launchMethod`, `launch_machine_immat`, `takeoffTime`, `landingTime`, `startIndex`, `stopIndex`, `engineTime`, `flightKm`, `lastUpdated`, `vi_id`
       - ERP must support: tracking planche_flight_uuid, transfer_state (Imported, Pending, Error), last_synced_at, erp_created_fields (cost, member_charge, etc.)
   - Eligibility rules: only members with active subscription and active flight permission are pushed; only active machines are pushed.
   - Planche API endpoints confirmed:
     - `POST /pilotes` - Create/Update pilots (batch)
     - `POST /machines` - Create/Update machines (batch)
     - `GET /validated-flights` - Query with filters (aero, date, pilot, trigram)
     - `PATCH /validated-flights/{uuid}` - Patch validated flight
     - All endpoints require LOGBOOK-API-KEY header
   - **Deliverables:** Settings UI + test endpoints, verified API contracts

2. ⏳ **Phase 1 – Backend Schema & Integration Service Foundations**
   - Extend ERP Member model to expose Planche sync fields:
     - Ensure Member has: active_subscription (bool), flight_permission (bool), erp_member_uuid (UUID), ffvp (int), compta_id (str), trigram (str)
     - Add if missing: Planche-side fields for caching (planche_pilot_id, planche_last_synced_at, planche_sync_status)
   - Extend ERP Asset/Machine model to expose Planche sync fields:
     - Ensure Asset has: immat (str, unique), active (bool), model_name (str), seat_count (int), aircraft_type (int)
     - Add if missing: planche_machine_id, planche_last_synced_at, planche_sync_status
   - Extend or create Flight/ValidatedFlight model for Planche sync metadata:
     - Add fields: planche_flight_uuid (str, unique), transfer_state (enum: Imported, Pending, Error, Billed), planche_last_updated_at (datetime), planche_updated_hash (str for idempotency detection), erp_created_at (datetime), erp_cost_cents (int), erp_member_charge_cents (int)
     - Add unique constraint on (planche_flight_uuid, planche_last_updated_at) to prevent duplicates
   - Create backend service `PlancheIntegrationService`:
     - HTTP client with async/await, retry logic (exponential backoff), error normalization
     - Batch pilot push: filter eligible members, map to PilotSchema[], push to POST /pilotes, return per-pilot success/failure
     - Batch machine push: filter active assets, map to MachineSchema[], push to POST /machines, return per-machine success/failure
     - Validated flight pull: query GET /validated-flights with last_synced_at cursor, map to Flight records, upsert with deduplication, return sync summary
   - Extend PlancheSettingsPayload schema to include:
     - sync_cursor_flights (datetime, optional) - last validated flight timestamp pulled
     - sync_cursor_pilots (datetime, optional) - last pilot push timestamp
     - sync_cursor_machines (datetime, optional) - last machine push timestamp
     - retry_max_attempts (int, default 3)
     - retry_backoff_ms (int, default 1000)
     - feature_flags (dict, e.g., {enable_pilot_push: bool, enable_machine_push: bool, enable_flight_pull: bool})
   - **Deliverables:** Extended models + PlancheIntegrationService, schema updates, migration scripts

3. ⏳ **Phase 2 – Outbound Sync Endpoints (Pilots & Machines)**
Backend endpoints:
  - `POST /api/v1/planche/pilots/push` - Manual trigger to push eligible pilots
    - Request: empty
    - Response: {success: bool, pushed_count: int, failed_count: int, errors: [{pilot_id, error_msg}], last_synced_at: datetime}
    - Calls PlancheIntegrationService.batch_push_pilots()
  - `POST /api/v1/planche/machines/push` - Manual trigger to push eligible machines
    - Request: empty
    - Response: {success: bool, pushed_count: int, failed_count: int, errors: [{machine_id, error_msg}], last_synced_at: datetime}
    - Calls PlancheIntegrationService.batch_push_machines()
  - Both endpoints gated by MANAGE_ACCOUNTING_SETTINGS capability
  - Frontend hooks (React Query):
    - `usePilotsPushMutation()` - trigger pilot push
    - `useMachinesPushMutation()` - trigger machine push
  - **Deliverables:** Two manual push endpoints + frontend mutations

4. ⏳ **Phase 3 – Inbound Sync Endpoint (Validated Flights)**
  - Backend endpoint:
    - `POST /api/v1/planche/flights/pull` - Manual trigger to import validated flights from Planche
      - Request: optional {from_date: YYYY-MM-DD, to_date: YYYY-MM-DD}
      - Response: {success: bool, imported_count: int, skipped_count: int, error_count: int, errors: [{planche_uuid, error_msg}], last_synced_at: datetime}
      - Uses PlancheIntegrationService.pull_validated_flights(from_date, to_date)
      - Idempotent: checks planche_flight_uuid and planche_last_updated_at before creating/updating ERP flight
  - **Import/Validation Flow:**
    - Imported flights are created in "draft" mode in ERP (not immediately validated for accounting)
    - User reviews imported flights, then triggers validation (accounting process: pricing/charging)
    - Flights can be re-validated until locked; after locking, no further changes allowed
    - If Planche-side flights are modified after import, ERP detects changes and presents them for user review before re-validation
  - **Flight Table Mapping:**
      - ERP `validated_flights` table mirrors Planche’s structure, with the following schema (ERP-side, SQLAlchemy style):

  | Field                   | Type         | Required | Notes |
  |-------------------------|--------------|----------|-------|
  | uuid                    | String       | Yes      | ERP UUID (PK) |
  | planche_uuid            | String       | Yes      | Planche UUID (sync key) |
  | aero                    | String       | Yes      | Aero code |
  | jour                    | Date         | Yes      | Flight date |
  | glider_immat            | String       | Yes      | Glider registration |
  | pilot_erp_id            | String       | Yes      | Main pilot (ERP member_id) |
  | second_pilot_erp_id     | String       | No       | Second pilot/instructor |
  | charge_to_erp_id        | String       | No       | Billing member |
  | instruction_split       | Integer      | Yes      | Instruction split |
  | vi_erp_id               | String       | No       | VI assignment |
  | typeOfFlight            | Enum         | Yes      | Enum: INSTRUCTION, SOLO, ... |
  | launchMethod            | Enum         | Yes      | Enum: EXTERNE, TREUIL, ... |
  | launchType              | Integer      | No       | See doc for mapping |
  | launch_machine_immat    | String       | No       | Tow/winch registration |
  | launch_pilot_trigram    | String       | No       | Tow pilot trigram |
  | launch_instructor_trigram| String      | No       | Launch instructor trigram |
  | takeoffTime             | String       | Yes      | HH:MM |
  | landingTime             | String       | Yes      | HH:MM |
  | startIndex              | Float        | No       | TMG/tow plane index |
  | stopIndex               | Float        | No       | TMG/tow plane index |
  | engineTime              | Float        | No       | Engine time |
  | landingCount            | Integer      | Yes      | Default 1 |
  | flightKm                | Float        | No       | Distance in km |
  | takeoffLocation         | String       | No       | ICAO code |
  | landedLocation          | String       | No       | ICAO code |
  | observations            | Text         | No       | Free text |
  | launch_charge_cents     | Integer      | Yes      | Charge for launch/engine (in cents) |
  | glider_charge_cents     | Integer      | Yes      | Charge for glider/plane (in cents) |
  | erp_status              | Integer      | Yes      | 0=validated, 1=transferred, 2=modified_after_transfer |
  | validated_at            | DateTime     | Yes      | Validation timestamp |
  | validated_by            | String       | Yes      | User/device who validated |
  | transferred_at          | DateTime     | No       | When transferred to accounting |
  | transferred_by          | String       | No       | User/device who transferred |
  | last_export_hash        | String       | No       | Change marker for export |
  | created_at              | DateTime     | Yes      | Record creation |
  | updated_at              | DateTime     | Yes      | Last update |

    - Enum fields:
      - `typeOfFlight`: Use `TypeOfFlight` enum (INSTRUCTION=0, SOLO=1, ...)
      - `launchMethod`: Use `LaunchMethod` enum (EXTERNE=0, TREUIL=1, ...)
      - `erp_status`: 0=validated (draft), 1=transferred (locked), 2=modified_after_transfer
    - All fields required for billing, traceability, and sync are non-nullable unless noted.
  - **Charging Calculation & Storage:**
    - Charging is split into two components:
      - `launch_charge_cents`: Charge for launch or engine (tow, winch, self-launch, etc.)
      - `glider_charge_cents`: Charge for the glider or powered plane portion
    - Both values are calculated during the validation/pricing process and stored for full traceability and audit.
    - This split enables separate reporting and cost tracking for launch vs. aircraft operations.
    - All sync/validation/transfer operations update audit trail.
    - **Validation/Locking Flow:**
      - Imported flights start as `erp_status=0` (draft/validated)
      - User can review and trigger validation (pricing/charging, set launch_charge_cents and glider_charge_cents)
      - Once validated and transferred (`erp_status=1`), flight is locked for accounting
      - If Planche-side flight is modified, ERP sets `erp_status=2` and prompts user for review
  - Endpoint gated by MANAGE_ACCOUNTING_SETTINGS capability
  - Frontend hook:
    - `useFlightsPullMutation()` - trigger flight pull with optional date range
  - **Deliverables:** One manual pull endpoint + frontend mutation
6. ⏳ **Phase 6 – Audit Trail & Modification Detection**
  - All sync/import/validation operations are logged in an audit table
  - Dedicated audit page in ERP for reviewing and dropping audit records
  - Audit log includes: operation type, user, timestamp, affected records, result (success/failure), error details
  - Modification detection: If Planche-side flights are changed after import, audit log records the change and user is prompted to review before re-validation
  - **Deliverables:** Audit table, audit review page, modification detection logic

5. ⏳ **Phase 4 – Manual Operations UI (Members + Assets + Flights)**
   - **Members Module:** Add "Sync Pilots to Planche" button in MembersListPage header
     - On click: Dialog showing eligible count, excluded count, last sync time
     - Confirmation + "Push Now" button
     - Success: toast with count pushed
     - Errors: dismissible Card with error details
   - **Assets Module:** Add "Sync Machines to Planche" button in AssetsListPage header
     - Same pattern as Members
   - **Flights Module:** Add "Pull Flights from Planche" entry in accounting/flights surface or dedicated `/flights/planche/sync` route
     - Date range filter (from/to date pickers, default last 30 days)
     - Sync summary card: last pull time, available count, imported count, skipped count, error count
     - Results table with pagination: pilot, aircraft, date, duration, transfer state badge
     - Validation dialog before pull
     - Clear errors action
   - **Styling:** Apply existing Tailwind + shadcn/ui patterns (Card, Button, Dialog, Badge, Toast)
   - **i18n:** Add translations to `planche` namespace for all UI strings (en.ts, fr.ts)
   - **Deliverables:** Three UI entry points + i18n updates

6. ⏳ **Phase 5 – Sync Status Dashboard (Optional MVP)**
   - New page `/planche/sync-status` or widget in admin console
   - Displays:
     - Planche connection status (green/red indicator)
     - Last pilot push: timestamp + count
     - Last machine push: timestamp + count
     - Last flight pull: timestamp + count
     - Recent errors summary (expandable)
   - Provides quick drill-down to individual sync operations
   - **Deliverables:** Dashboard page + status widgets

7. ⏳ **Phase 6 – Testing & Validation**
   - Backend unit tests:
     - PlancheIntegrationService: pilot filtering, machine filtering, payload mapping, idempotent upsert behavior
     - Pilot eligibility: active subscription + flight permission filters
     - Machine eligibility: active status filter
     - Flight deduplication: planche_uuid + updated_at uniqueness
   - Integration tests:
     - End-to-end dry-run push (pilots, machines) without mutations
     - End-to-end dry-run pull (flights) without mutations
     - Error handling: invalid credentials, network timeouts, partial batch failures
   - Frontend tests:
     - Mutation hooks execute correctly with date ranges
     - Error and success states render properly
     - Dialogs confirm actions before execution
   - Manual smoke tests against test API:
     - Push a pilot, verify in Planche
     - Push a machine, verify in Planche
     - Pull a validated flight, verify in ERP with transfer_state = "Imported"
     - Repeat pull, verify no duplicates
   - **Deliverables:** Test suite + smoke test checklist

**Implementation Priority (MVP → Expansion)**
- **Sprint 1:** Phase 1 (Schema + Service) + Phase 2 (Push endpoints) + Phase 4.1 (Members UI)
- **Sprint 2:** Phase 3 (Pull endpoint) + Phase 4.2-4.3 (Flights UI) + Phase 6 (Testing)
- **Sprint 3:** Phase 5 (Dashboard) + Phase 6 (Expanded tests)

**Relevant Files**

*Phase 0 (Complete):*
- backend/api/routes/planche.py - GET/PUT settings endpoints + test-connection + test-login (DONE)
- backend/schemas/planche.py - PlancheSettingsPayload, PlancheConnectionTestResponse, PlancheLoginTestResponse (DONE)
- backend/api/routes/__init__.py - Planche router registration (DONE)
- backend/main.py - app.include_router(planche.router) (DONE)
- frontend/src/modules/planche/ - Module with PlancheIntegrationPage, API hooks, i18n (DONE)
- frontend/src/shell/navigation.ts - Planche menu entry (DONE)
- frontend/src/i18n/config.ts - Planche namespace registration (DONE)
- packages/i18n/src/resources/{en,fr}.ts - Planche translations (DONE)

*Phase 1 (Upcoming):*
- backend/models.py - Extend Member, Asset, Flight with sync metadata fields
- backend/services/planche_integration.py (NEW) - PlancheIntegrationService with batch_push_pilots(), batch_push_machines(), pull_validated_flights()
- backend/schemas/planche.py - Extend PlancheSettingsPayload with sync_cursor_*, retry_*, feature_flags
- backend/migrations/ - Migration for new sync metadata fields

*Phase 2 (Upcoming):*
- backend/api/routes/planche.py - Add POST /pilots/push and POST /machines/push endpoints
- frontend/src/modules/planche/api/index.ts - Add usePilotsPushMutation(), useMachinesPushMutation() hooks
- frontend/src/modules/members/components/MembersListPage.tsx - Add "Sync Pilots" button
- frontend/src/modules/assets/components/AssetsListPage.tsx - Add "Sync Machines" button

*Phase 3 (Upcoming):*
- backend/api/routes/planche.py - Add POST /flights/pull endpoint
- frontend/src/modules/planche/api/index.ts - Add useFlightsPullMutation() hook
- frontend/src/modules/flights/ or accounting/ - Add "Pull Flights from Planche" surface

*Phase 4-5 (Upcoming):*
- frontend/src/modules/planche/components/SyncStatusDashboard.tsx (NEW)
- frontend/src/modules/flights/components/PlancheSyncPage.tsx (NEW)

*Phase 6 (Upcoming):*
- backend/tests/test_planche_integration.py (NEW)
- frontend/src/modules/planche/__tests__/ (NEW)

**External References**
- https://test.api.psa-avat.fr/openapi.json - Planche API contract (v1.0.43 as of 2026-05-16)

**Verification – Status Report**

*Phase 0 (Complete):*
1. ✅ Planche API contract validated: heartbeat endpoint (GET), login endpoint (POST), pilot/machine/flight endpoints confirmed via OpenAPI v1.0.43
2. ✅ Settings UI and test endpoints deployed and verified:
   - Backend syntax validation: passed (py_compile)
   - Frontend TypeScript validation: passed (tsc --noEmit)
   - Backend import validation: passed (Python import check)
   - Startup crash fixed: DEFAULT_PLANCHE_SETTINGS converted from Pydantic object to plain dict
3. ✅ Settings form tested with test API credentials (connection_id, API token, environment toggle)
4. ✅ Authorization gating: MANAGE_ACCOUNTING_SETTINGS capability applied to all Planche routes

*Phases 1–6 (Upcoming - Pre-Implementation Verification):*
1. Review ERP Member, Asset, Flight models to identify required sync metadata fields before creating migration
2. Validate Planche pilot/machine/flight schema field mapping against ERP data models
3. Run backend test slice on new PlancheIntegrationService before Phase 3 manual sync workflows
4. Run frontend build after UI integration (Phase 4) to verify no TypeScript errors
5. Perform manual dry-run sync against test API after Phase 2 (pilots/machines)
6. Perform manual dry-run sync after Phase 3 (validated flights) with duplicate prevention test
7. Execute full test suite (Phase 6) before production deployment

**Decisions**

*Phase 0 (Locked):*
- ERP is the source of truth for pilots and machines; Planche is the source of truth for validated flights.
- The integration is manual first (user-triggered), not scheduled/automatic.
- The Planche connection must be configurable by URL, connection_id, and API token before any sync action is enabled.
- Only pilots with active subscription AND active flight permission are exported.
- Only active machines are exported.
- Flight sync state tracked with: planche_flight_uuid (PK), transfer_state (enum), planche_last_updated_at, erp_created_at.
- Settings persisted in generic `system_settings` table (not dedicated config file) for consistency with ERP patterns.
- All Planche endpoints require LOGBOOK-API-KEY header (authenticated requests).

*Phases 1–6 (To Be Finalized Before Implementation):*
1. **ERP Flight Storage:** Confirm schema fields for storing Planche flight metadata (planche_flight_uuid, transfer_state, erp_cost_cents, erp_member_charge_cents).
2. **Pilot Identity:** Confirm whether Planche receives member UUIDs via `erp_id` field or alternative stable key (compta_id, PK).
3. **Machine Identity:** Confirm whether Planche receives asset code via stable external identifier or immat (registration) as primary key.
4. **Dry-Run Support:** Decide if Phase 2–3 endpoints support `{dry_run: true}` mode to preview changes before committing.
5. **Sync Cursor Strategy:** Confirm whether to use timestamps (last_synced_at) or sequence IDs for incremental pulls.
6. **Error Recovery:** Decide if failed pushes/pulls should queue for retry or require manual re-trigger.
7. **Conflict Resolution:** If pilot/machine updates conflict, confirm overwrite strategy (ERP wins, Planche wins, or manual review).

**UX/UI Surface Design**

The integration surfaces are designed to match the existing ERP club module patterns (teal/emerald hero gradients, Card components, Tailwind utilities, Button/Dialog primitives from shadcn/ui).

*Phase 4.1 (Complete) - Planche Integration Settings*
- Route: `/planche/integration` ✅
- Section layout with Card containers ✅
- Configuration form with inputs: ✅
  - Planche Base URL (text input, required)
  - Connection ID (text input, required)
  - API Token (password input, required, masked)
  - Environment selector (toggle or dropdown for test/production)
  - Save and Test Connection button
  - Test Login button
- Connection status badge (Connected/Disconnected) shown live after test ✅
- Inline error messages if connection fails ✅
- Success/error toast notifications ✅
- Sidebar navigation entry with capability guard ✅

*Phase 4.2 (Pending) - Members Module: Push Pilots to Planche*
- Action button in MembersListPage header (alongside "Import CSV", "New Member")
- Button label: "Sync to Planche" or "Push Pilots"
- On click, opens a Dialog with:
  - Summary card showing:
    - Count of eligible pilots (active subscription + flight permission)
    - Count of pilots that will be excluded (inactive/unsubscribed)
    - Last sync timestamp (if any)
  - Confirmation text explaining the action
  - Primary action button: "Push Now" (disabled if no eligible pilots)
  - Secondary action: Cancel
- After success: toast with "Pushed N pilots to Planche"
- After errors: show per-item error details in a dismissible Card with error counts
- Styling: Reuse existing Card, Button, Dialog, Badge, Toast from shadcn/ui
- i18n: Add to `planche` namespace (push_pilots_action, eligible_pilots, excluded_pilots, push_success, push_error, etc.)

*Phase 4.3 (Pending) - Assets Module: Push Machines to Planche*
- Action button in AssetsListPage header (alongside "New Asset", "Import CSV")
- Button label: "Sync to Planche" or "Push Machines"
- On click, opens a Dialog with same pattern:
  - Summary: count of active machines vs. inactive machines
  - Last sync timestamp
  - Confirmation + Push Now button
- Success/error handling same as pilots
- Styling and i18n: Parallel to pilots section

*Phase 4.4 (Pending) - Flights Module: Pull Validated Flights from Planche*
- Entry point: Dedicated "Planche Flight Sync" or in Accounting/Banque module
- Route: `/flights/planche/sync` or `/accounting/flights/sync-planche`
- Main panel showing:
  - **Sync Status Summary Card:**
    - Last pull timestamp
    - Validated flights available in Planche (count)
    - Flights successfully imported this session (count)
    - Flights skipped (already transferred) (count)
    - Sync errors (count, clickable to expand error list)
  - **Date Range Filter:**
    - From Date and To Date pickers (optional, default to last 30 days)
    - Button: "Pull Flights"
  - **Real-time or post-sync Results:**
    - Table or list showing newly imported flights:
      - Pilot name (linked to member)
      - Aircraft registration
      - Flight date
      - Duration
      - Transfer state badge (Imported, Skipped, Error)
    - Pagination if needed
- Button actions:
  - "Pull Flights" - primary action, triggers sync for date range
  - "Clear Errors" - clears error state on any failed pulls
  - Optional: "Configure Last Sync Cursor" link for advanced users
- Validation dialog before pull:
  - Confirm: "Pull flights from Planche between [date] and [date]?"
  - Warning if flights already exist for those dates
  - Cancel or Confirm buttons
- Styling and i18n: Match pilots/machines patterns

*Phase 5 (Pending) - Sync Status Overview / Dashboard*
- Could be a small widget or dedicated page
- Shows at-a-glance status:
  - Planche connection status (green/red)
  - Last pilot push: timestamp + count
  - Last machine push: timestamp + count
  - Last flight pull: timestamp + count
  - Recent errors summary (clickable to drill down)
- Can reuse the status cards from individual sync screens

**Design Token Application**
- Colors: Use `border-outline-variant`, `bg-surface`, `bg-surface-container` for Cards
- Buttons: Primary (blue/teal), Secondary (gray), Ghost for cancel actions
- Hero section: Use `bg-gradient-to-r from-sky-950 via-teal-900 to-emerald-800` for dedicated sync pages if standalone
- Status badges: 
  - Success: Green badge `bg-green-50 text-green-900`
  - Pending/Processing: Amber badge `bg-amber-50 text-amber-900`
  - Error: Red badge `bg-red-50 text-red-900`
  - Skipped: Gray badge `bg-slate-50 text-slate-900`
  - Imported: Blue badge `bg-blue-50 text-blue-900`
- Spacing: Use `space-y-4` or `gap-3` for Card sections, `p-4` or `p-6` for padding
- Responsive: Grid layouts at `sm:grid-cols-2` or `md:grid-cols-3` for multi-column summaries
- Form inputs: `h-8 text-sm rounded-shape-sm` for consistency with existing forms

**Further Considerations**

1. **Data Hygiene & Conflict Resolution:**
   - If pilot changes FFVP number or compta_id, how should reconciliation handle remapping?
   - Decision needed: Re-sync all historical data or create a migration mapping table?

2. **Audit & Traceability:**
   - Should sync operations create audit log entries (who triggered, when, result counts)?
   - Decision needed: Centralized audit table or per-module log entries?

3. **Dry-Run & Rollback:**
   - Phase 2–3 endpoints should support `{dry_run: true}` to preview changes without mutating ERP data.
   - Decision needed: Should failed syncs auto-retry or require manual re-trigger? Recommend manual to avoid cascading failures.

4. **VI (Instructors) Sync:**
   - Planche VI endpoints exist (`POST /vi/`, `PUT /vi/{vi_id}`, `DELETE /vi/{vi_id}`).
   - If needed, add Phase 7: VI sync endpoints (similar to pilots/machines) to sync instructor/staff credentials.
   - Out of MVP scope for now but note as future enhancement.

5. **Rate Limiting & Performance:**
   - Planche API may have rate limits; recommend implementing token bucket or exponential backoff in PlancheIntegrationService.
   - For large pilot/machine populations (100+), batch in chunks of 50–100 records per request.

6. **Monitoring & Alerting:**
   - Recommend structured logging of all sync operations for operational visibility.
   - Future: integrate with observability stack (e.g., NewRelic, DataDog) if desired.