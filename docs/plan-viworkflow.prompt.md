Implement a dual-side VI workflow: ERP is the source of truth for entitlement, type catalog, source tracking, and lifecycle; Planche is the operational execution surface for daily scheduling. Use the existing validated_flights.vi_erp_id reconciliation link and extend payload contracts where needed for deterministic matching.

Goals
1. Support dynamic type management over time (VI, JD, STAGE, future values), while keeping VI as a permanent baseline.
2. Add a planning page to schedule loaded entitlements and update operational notes (phone or customer information) before the flight day.
3. Track origin explicitly (helloasso, club, complementary flight, manual or partner) for audit and reporting.
4. Keep financial and ownership control in ERP, while allowing Planche-side updates and operations.

Architecture decisions
1. ERP owns entitlement records, type catalog, origin/source fields, lifecycle statuses, and accounting traceability.
2. Planche receives selected scheduled records for operations and returns references in validated flights.
3. Generic daily VI, JD, and STAGE templates are defined in ERP and mirrored to Planche, not Planche-owned.
4. HelloAsso imports land in a staging table first, then are promoted into entitlement records.
5. OAuth tokens are cached for 30 minutes and refreshed through https://api.helloasso.com/oauth2/token when missing or expired.

Steps
1. Create ERP models for:
	- vi_type_catalog (dynamic, active or archived types)
	- vi_entitlements (code, type_id, description, validity_date, scheduled_date, realisation_date, partner_code, origin_type, origin_ref, notes)
	- helloasso_vi_staging (raw import candidate, normalized fields, dedupe keys, promotion state)
2. Add lifecycle and integrity rules:
	- statuses: loaded, scheduled, realized, expired, cancelled
	- uniqueness on entitlement code
	- date consistency checks (realisation_date cannot precede scheduled_date)
	- idempotent promotion from staging
3. Add service layer workflows:
	- CRUD for entitlements and type catalog
	- focused patch operations for scheduled_date, realisation_date, and notes
	- bulk scheduling and unscheduling helpers
4. Add API routes and capabilities:
	- dedicated capability split for VI administration, planning, and Planche sync
	- routes for type catalog CRUD, entitlement CRUD, date and notes patching, planning actions
	- routes for staging import preview, dedupe review, and promotion
5. Extend HelloAsso import behavior:
	- use OAuth token caching (30 minute TTL)
	- fetch token from https://api.helloasso.com/oauth2/token when cache is absent or expired
	- deduplicate with stable external keys (order_id, item_id, payment_id)
	- exclude already-promoted or already-consumed rows from next import runs
6. Extend Planche integration contract (Planche side can be updated):
	- outbound: push selected scheduled records with stable erp_entitlement_id and type code
	- optional outbound fields: schedule_slot_id, origin_type, notes
	- inbound validated flights: return vi_erp_id and optionally schedule_slot_id for deterministic realization linkage
7. Build frontend screens:
	- ERP VI Planning page (calendar plus list, status filters, bulk schedule, notes editing)
	- Planche submenu entry for VI push and reconciliation controls
	- HelloAsso import page for staging review and promotion into entitlements
8. Add tests and verification:
	- capability guards
	- dynamic type lifecycle (add or archive types)
	- dedupe and idempotent promotion
	- schedule and realization updates
	- Planche push idempotency and inbound reconciliation accuracy

Relevant files
- backend/models.py - planned VI type, entitlement, and staging models
- backend/services/planche_integration.py - planned schedule-aware push and inbound reconciliation
- backend/api/routes/planche.py - planned VI schedule push or preview endpoints
- backend/api/routes/helloasso.py - planned staged import and dedupe pipeline
- backend/constants.py and backend/api/security.py - planned capability additions
- frontend/src/modules/planche - planned VI planning or push UI
- frontend/src/modules/helloasso - planned staging and promotion UI
- frontend/src/shell/navigation.ts and frontend/src/App.tsx - planned route wiring
- packages/i18n/src/resources/fr.ts - planned labels for types, statuses, and origins

Verification
1. Validate ownership boundaries: ERP remains source of truth for entitlement and origin.
2. Validate repeated HelloAsso pulls do not create duplicates.
3. Validate planning lifecycle: loaded -> scheduled -> realized or cancelled or expired.
4. Validate Planche sync idempotency on repeated pushes of the same selection.
5. Validate inbound flight mapping resolves to one entitlement or slot deterministically.

Open points to lock
1. Capability assignment policy: admin-only or shared with selected staff.
2. Realisation date policy: auto-fill from validated flights with manual override, or manual-only.
3. Template generation policy: nightly auto-generation or on-demand per planning session.

Phased build order

Phase 1 - ERP data foundation
Deliverables: vi_type_catalog model, vi_entitlements model, and helloasso_vi_staging model in backend/models.py. SQL migration in deploy/init-db/. Pydantic request and response schemas. No routes yet.
Depends on: nothing.
Done when: models import cleanly, migration runs without error, and schemas validate correctly.

Phase 2 - ERP service layer and CRUD routes
Deliverables: service functions for type catalog and entitlement CRUD, focused patch helpers for scheduled_date, realisation_date, and notes, bulk scheduling helper, new CAP_MANAGE_VI capability in constants.py, and guarded routes at /api/v1/vi/* with capability enforcement.
Depends on: Phase 1.
Done when: backend test slice passes for CRUD, date patch, and capability guard on each route.

Phase 3 - HelloAsso import pipeline
Deliverables: token cache layer with 30-minute TTL and refresh via https://api.helloasso.com/oauth2/token, staging import endpoint that deduplicates on order_id/item_id/payment_id, promote-to-entitlement endpoint that marks rows consumed and excludes them from future pulls, and preview/diff endpoint showing net-new candidates.
Depends on: Phase 1 and 2.
Done when: repeated import runs produce no duplicate staging rows or entitlements.

Phase 4 - Planche sync extension
Deliverables: outbound VI schedule push endpoint that accepts a selection of entitlement UUIDs, maps to Planche payload including erp_entitlement_id, type code, scheduled date, notes, and origin_type, and deletes or archives removed records on Planche. Planche-side contract updated to accept and store these fields and return vi_erp_id and optionally schedule_slot_id in validated flights.
Depends on: Phase 2.
Done when: repeated push of the same selection produces an idempotent state in Planche, and inbound validated flights carry a vi_erp_id that maps deterministically to one ERP entitlement.

Phase 5 - Frontend: HelloAsso import and VI management
Deliverables: HelloAsso import page (staging table, dedupe diff, promote selection action), VI entitlement list and edit forms (type, origin badge, lifecycle status, date editing, notes editing), and type catalog admin screen (add or archive types).
Depends on: Phase 2 and 3.
Done when: tsc --noEmit passes, and the full import-and-promote flow works end to end.

Phase 6 - Frontend: Planning page and Planche push
Deliverables: VI planning page (calendar or list view, status filters, bulk schedule assignment, inline notes editor), Planche submenu entry for VI schedule push with selection controls and preview counts, and reconciliation feedback showing which entitlements have been realized.
Depends on: Phase 4 and 5.
Done when: staff can go from loaded entitlement to Planche-visible scheduled slot in one session without backend errors.

Phase 7 - Tests and hardening
Deliverables: backend test coverage for type catalog lifecycle, dedupe idempotency, scheduling state machine, Planche push idempotency, inbound reconciliation mapping. Frontend typecheck pass. Manual end-to-end walkthrough documented.
Depends on: all phases.
Done when: all backend tests pass, tsc --noEmit is clean, and the full user journey is verified manually.