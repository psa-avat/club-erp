## Plan: Planche de vol integration

Create a manual, idempotent integration layer between ERP-CLUB and the Planche de vol backend. ERP remains the source of truth for pilots and machines, and Planche de vol remains the source of truth for validated flights. The first version should push only active registered pilots and active machines from ERP to Planche, and pull validated flights back into ERP with a transfer state plus last-update tracking so the same flight is never billed twice.

**Steps**
1. Lock the integration contract and field mapping against the existing ERP models and the Planche API surface.
   - Pilots: map member names, FFVP number, compta_id, erp_id, and trigram from the ERP member record.
   - Machines: map the ERP asset/machine record to Planche machine payloads using the existing asset fields and a stable external identifier.
   - Flights: import only validated flights from Planche, keyed by Planche flight UUID, with ERP-side transfer state and updated_at tracking.
   - Eligibility rules: only members with an active subscription and active flight permission are pushed; only active machines are pushed.
   - Dependencies: the final flight storage shape still depends on the ERP flight schema you mentioned you can provide.

2. Add a backend Planche integration service and settings surface.
   - Create a dedicated service layer for Planche API access, payload mapping, retries, and error normalization.
   - Add module settings for connection URL, connection id, API token, sync cursors, feature flags, and retry policy.
   - Store the Planche base URL as a configurable environment/module setting, the remote id as a stable integration identifier, and the token as a secret value in the ERP settings store or secret-backed configuration.
   - Support separate configuration for test and production endpoints so manual syncs can be pointed at the test API first.
   - Keep the HTTP client async and aligned with the existing FastAPI/SQLAlchemy patterns.

3. Extend ERP persistence where the integration needs stable cross-system identifiers.
   - Ensure the member and asset records expose the fields needed for Planche mapping without breaking current behavior.
   - Add or reuse dedicated ERP identifiers if Planche needs a distinct stable key beyond account_id/code.
   - Add flight sync metadata fields or a companion sync table for source UUID, transfer state, and last updated timestamp.

4. Implement outbound pilot and machine sync from ERP to Planche.
   - Build manual sync endpoints that push a filtered set of eligible pilots.
   - Build manual sync endpoints that push a filtered set of eligible machines.
   - Make the sync idempotent so repeated pushes update existing Planche records rather than duplicating them.
   - Record per-item success/failure details so operators can see what was pushed and what failed.

5. Implement inbound validated-flight pull from Planche to ERP.
   - Pull validated flights only, using the Planche validated-flight endpoints and a last_updated cursor when available.
   - Store Planche flight UUIDs in ERP and mark imported flights with a transfer state plus updated_at so they are not processed twice.
   - Keep the imported flight record read-only with respect to Planche-authored fields, and only let ERP modify its own accounting-side state.
   - If a flight is later corrected in Planche, re-import via updated_at without duplicating the ERP record.

6. Expose manual operations and visibility in ERP.
   - Add backend endpoints or actions for push pilots, push machines, and pull flights.
   - Add a lightweight sync status view or admin action entry points in the relevant frontend module if operators need direct control.
   - Show last sync time, counts, and recent errors for each direction.

7. Cover the workflow with targeted tests.
   - Test pilot eligibility filtering, payload mapping, and idempotent upsert behavior.
   - Test machine eligibility filtering and payload mapping.
   - Test validated-flight import deduplication, transfer-state updates, and cursor handling.
   - Test that inactive or unsubscribed pilots and inactive machines are excluded.

**Relevant Files**
- /home/erpadmin/club-erp/backend/models.py - Member and Asset persistence anchors; likely location for any stable sync metadata fields.
- /home/erpadmin/club-erp/backend/schemas/members.py - Member summary/detail schema alignment for external pilot fields.
- /home/erpadmin/club-erp/backend/services/members.py - Member filtering, serialization, and export logic to reuse for Planche pilot sync.
- /home/erpadmin/club-erp/backend/api/routes/members.py - Member listing and any new manual sync endpoints.
- /home/erpadmin/club-erp/backend/services/assets.py - Asset/machine serialization and filtering logic to reuse for outbound sync.
- /home/erpadmin/club-erp/backend/api/routes/assets.py - Asset routes and likely manual sync action surface.
- /home/erpadmin/club-erp/backend/schemas/assets.py - Asset and flight-type payload contracts if sync metadata or mapping needs schema exposure.
- /home/erpadmin/club-erp/frontend/src/modules/members/api/index.ts - Frontend member API hooks if a manual sync action is exposed.
- /home/erpadmin/club-erp/frontend/src/modules/assets/api/index.ts - Frontend asset API hooks if a manual sync action is exposed.
- /home/erpadmin/club-erp/frontend/src/modules/members/components/MembersListPage.tsx - Best existing member-list surface for operator actions.
- /home/erpadmin/club-erp/frontend/src/modules/assets/components/AssetsListPage.tsx - Best existing asset-list surface for operator actions.
- /home/erpadmin/club-erp/docs/PRD_FLIGHTS.md - Product intent for Planche flight exchange.
- /home/erpadmin/club-erp/docs/SPEC_ACCOUNTING.md - Accounting-side expectations for flight synchronization.
- https://test.api.psa-avat.fr/openapi.json - External Planche API contract source.

**Verification**
1. Validate the payload mapping against the Planche OpenAPI contract for /pilotes, /machines, /validated-flights, and the relevant auth endpoints.
2. Add or update backend tests for pilot selection, machine selection, and validated-flight import idempotency.
3. Run a targeted backend test slice for the new sync service and affected member/asset service tests.
4. Run the frontend build if operator actions or status views are added.
5. Perform a manual smoke test against the test Planche API: push a pilot, push a machine, pull a validated flight, then repeat the pull to confirm the transfer state prevents duplicates.

**Decisions**
- ERP is the source of truth for pilots and machines.
- Planche de vol is the source of truth for validated flights.
- The integration is manual first, not scheduled first.
- The Planche connection must be configurable by URL, id, and token before any sync action is enabled.
- Only pilots with an active subscription/registration and active flight permission are exported.
- Only active machines are exported.
- Flight sync state should be tracked with source UUID, state, and updated_at.
- The exact ERP flight storage fields still depend on the schema you said you can provide.

**UX/UI Surface Design**

The integration surfaces are designed to match the existing ERP club module patterns (teal/emerald hero gradients, Card components, Tailwind utilities, Button/Dialog primitives from shadcn/ui).

1. **Planche Integration Settings** (Admin panel entry point)
   - Route: `/admin/integrations/planche` or similar settings panel
   - Section layout with Card containers
   - Configuration form with inputs:
     - Planche Base URL (text input, required)
     - Connection ID (text input, required)
     - API Token (password input, required, masked)
     - Test/Production toggle selector
     - Save and Test Connection button
   - Connection status badge (Connected/Disconnected) shown live after save
   - Inline error messages if connection fails
   - Success toast notification after save

2. **Members Module: Push Pilots to Planche** (Inline in MembersListPage)
   - Action button in the page header with other actions (Import CSV, New Member)
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

3. **Assets Module: Push Machines to Planche** (Inline in AssetsListPage)
   - Action button in the page header with other actions (New Asset, Import CSV)
   - Button label: "Sync to Planche" or "Push Machines"
   - On click, opens a Dialog with same pattern:
     - Summary: count of active machines vs. inactive machines
     - Last sync timestamp
     - Confirmation + Push Now button
   - Success/error handling same as pilots

4. **Flights Module: Pull Validated Flights from Planche** (New or in existing accounting/flights surface)
   - Entry point: Dedicated "Planche Flight Sync" or in Accounting Banque module
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

5. **Sync Status Overview / Dashboard** (Optional, first pass can skip)
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
- Hero section: Use `bg-gradient-to-r from-sky-950 via-teal-900 to-emerald-800` for main sync pages if standalone
- Status badges: 
  - Success: Green badge `bg-green-50 text-green-900`
  - Pending/Processing: Amber badge `bg-amber-50 text-amber-900`
  - Error: Red badge `bg-red-50 text-red-900`
  - Skipped: Gray badge `bg-slate-50 text-slate-900`
- Spacing: Use `space-y-4` or `gap-3` for Card sections, `p-4` or `p-6` for padding
- Responsive: Grid layouts at `sm:grid-cols-2` or `md:grid-cols-3` for multi-column summaries
- Form inputs: `h-8 text-sm rounded-shape-sm` for consistency with existing forms

**Implementation Priority**
1. **Phase 1 (MVP):** Planche settings + Members push pilots + Assets push machines (backend + inline UI)
2. **Phase 2:** Flights pull (new or existing flights surface) + sync status visibility
3. **Phase 3:** Dedicated sync dashboard if business value justifies

**Further Considerations**
1. If you want Planche to receive erp_id as the ERP member UUID, keep that as the stable cross-system key; if you prefer another key, lock that before implementation.
2. If machine identity should be based on asset code or registration, choose one canonical value before mapping the push payload.
3. Consider adding a "Test Sync" dry-run button in settings to validate connection and payload mapping before production pushes.