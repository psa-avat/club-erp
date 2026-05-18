Create a dedicated VI workflow in ERP, with its own table, CRUD endpoints, import staging from HelloAsso, and a manual selection-based export to Planche. Reuse the existing Planche `validated_flights.vi_erp_id` link for inbound reconciliation, and cache HelloAsso OAuth tokens for 30 minutes so import runs do not re-authenticate on every call.

Steps
1. Define the backend data model for VI and HelloAsso staging, including the requested fields: code, type, description, validity date, scheduled date, realisation date, and partner code. Add lifecycle fields needed to track active, staged, imported, and consumed rows.
2. Add backend service methods for VI create, update, delete, and narrow updates for scheduled date and realisation date. Enforce idempotency on code, date consistency, and clear error responses.
3. Add a dedicated VI capability and protect all VI admin routes with it. Wire the capability into the existing role/capability mapping pattern and keep Planche/HelloAsso sync routes behind the same privileged guard style already used in the app.
4. Add VI API routes for listing, CRUD, date patching, HelloAsso staging import, staged-row promotion into VI, and manual Planche export. Keep the Planche export selection-driven, limited to eligible active VI only.
5. Extend the Planche integration path so outbound VI selection can be attached to initiation flights, and inbound validated flights preserve the VI reference for later billing and reporting.
6. Implement HelloAsso token caching in the integration layer with a 30 minute TTL, fetch/refresh tokens from https://api.helloasso.com/oauth2/token when cache is missing or expired, and normalize imported purchases into a temporary staging table while excluding rows already imported or already consumed.
7. Build the frontend management screens. Add a VI submenu beside pilots and machines in the Planche area, and add a HelloAsso screen for importing paid VI and promoting them into the internal VI table.
8. Add focused tests for capability guards, CRUD validation, partial date updates, token cache reuse, staged-import deduplication, and Planche export selection rules. Add a narrow frontend typecheck pass for the new hooks and routes.

Relevant files
- backend/models.py — new VI entity and HelloAsso staging model.
- backend/services/planche_integration.py — reuse inbound/outbound Planche flow and VI references.
- backend/api/routes/planche.py — manual VI export endpoint and any preview route.
- backend/api/routes/helloasso.py — staging import and token-cache-aware purchase loading.
- backend/constants.py and backend/api/security.py — new VI capability and guards.
- frontend/src/modules/planche — VI management/export screen and API hooks.
- frontend/src/modules/helloasso — paid-VI import screen and promotion actions.
- frontend/src/shell/navigation.ts and frontend/src/App.tsx — routes and menu entries.
- packages/i18n/src/resources/fr.ts — labels for VI actions and states.

Verification
- Run the narrow backend test slice for VI CRUD, capability guards, and HelloAsso token caching.
- Run the touched backend syntax or type validation used in this repo.
- Run frontend `tsc --noEmit` for the new API hooks and route wiring.
- Manually verify the full path: import paid VI from HelloAsso, promote staged rows into VI, edit dates, and select VI for Planche export.

Decisions
- VI will be a dedicated ERP entity, not an extension of validated flights.
- Planche export will be manual selection-based, not auto-push.
- HelloAsso imports will first land in a temporary staging table, then be promoted into VI.
- HelloAsso OAuth tokens will be cached for 30 minutes and reused across import calls; refresh uses https://api.helloasso.com/oauth2/token.

Further Considerations
- The remaining product choice is whether the new VI capability should be Admin-only or shared with staff roles.
- It is still worth deciding whether realisation date should be set only manually, or also auto-filled when a VI is attached to a validated flight.