## Plan: Encrypt Sensitive JSON Settings

Protect sensitive values stored in system settings JSON at rest by introducing transparent field-level encryption in backend services, masking secret fields in GET responses, and preserving update usability through explicit secret replacement semantics in frontend forms. Use an environment-managed key (SETTINGS_ENCRYPTION_KEY), with backward-compatible read support for legacy plaintext rows and a one-time migration.

**Steps**
1. Define security contract and secret-field detection rules.
2. Phase 1: Backend crypto foundation (blocks all later phases).
3. Phase 2: Service-layer encryption/decryption integration (depends on 2).
4. Phase 3: Masked API responses and safe update semantics (depends on 3).
5. Phase 4: Frontend adjustments for masked secrets (parallel with 4 after API contract is fixed).
6. Phase 5: Data migration for existing plaintext rows (depends on 3).
7. Phase 6: Tests and verification hardening (depends on 3/4/5).

Phase 1 - Backend crypto foundation
1. Add cryptography dependency in /home/erpadmin/club-erp/backend/requirements.txt.
2. Create a dedicated helper module (for example /home/erpadmin/club-erp/backend/services/settings_crypto.py) to:
- Load and validate SETTINGS_ENCRYPTION_KEY from environment.
- Encrypt/decrypt string values using authenticated encryption.
- Prefix ciphertext with a stable marker/version (example pattern: enc:v1:...) so legacy plaintext can be detected.
3. Define generic secret key-name matcher per decision:
- Encrypt keys ending with _secret, _token, _password (case-insensitive).
- Keep non-matching keys as plaintext JSON values.

Phase 2 - Service-layer integration
1. Update /home/erpadmin/club-erp/backend/services/accounting.py in upsert_system_setting:
- Before write, recursively encrypt matching sensitive keys in request.settings.
- Preserve non-sensitive values unchanged.
2. Update get_system_setting and list_system_settings:
- Decrypt encrypted sensitive values for internal processing.
- Keep compatibility with plaintext legacy values by decrypting only values with marker.
3. Keep ensure_default_system_settings unchanged except that any future sensitive defaults will be encrypted automatically via upsert paths.

Phase 3 - Masked API responses + update semantics
1. Add a response masking helper in backend route layer (shared utility or per-route helper) to avoid returning decrypted secrets in GET responses.
2. Update GET settings responses in:
- /home/erpadmin/club-erp/backend/api/routes/planche.py
- /home/erpadmin/club-erp/backend/api/routes/helloasso.py
- /home/erpadmin/club-erp/backend/api/routes/accounting.py (generic settings endpoints)
3. Define mask format and write contract:
- GET returns masked values for secret keys (example fixed token like ********).
- PUT treats masked token as keep-existing-secret, and only overwrites when client submits a new non-masked value.
4. Enforce this merge behavior in route layer before calling upsert_system_setting so accidental overwrite does not happen when user saves unchanged form.

Phase 4 - Frontend adaptations for masked values
1. Update HelloAsso setup page:
- /home/erpadmin/club-erp/frontend/src/modules/helloasso/components/HelloAssoIntegrationPage.tsx
2. Update Planche setup page:
- /home/erpadmin/club-erp/frontend/src/modules/planche/components/PlancheIntegrationPage.tsx
3. UX behavior:
- Show masked placeholders for secret fields loaded from GET.
- On save, submit unchanged masked sentinel only when field untouched.
- If user edits field, submit new plaintext so backend replaces encrypted value.
4. Ensure connection-test actions still use current form values and prompt user if required secret remains masked-but-empty state.

Phase 5 - Migration
1. Add migration script under /home/erpadmin/club-erp/backend/migrations/ to encrypt existing plaintext secrets in system_settings.settings.
2. Migration behavior:
- Scan all modules/settings JSON recursively.
- Encrypt only keys matching suffix rule and not already marked encrypted.
- Idempotent rerun support.
3. Provide rollback companion (decrypt script) for operational safety during rollout.

Phase 6 - Testing and hardening
1. Add focused crypto unit tests in backend/tests (new test module) for:
- Roundtrip encrypt/decrypt.
- Legacy plaintext pass-through.
- Marker/version parsing errors.
2. Update existing backend tests impacted by changed settings behavior:
- /home/erpadmin/club-erp/backend/tests/test_accounting_phase2.py
- /home/erpadmin/club-erp/backend/tests/test_accounting_audit_logging.py
- /home/erpadmin/club-erp/backend/tests/test_helloasso_routes.py
3. Add/extend route tests for:
- GET returns masked secrets.
- PUT with masked sentinel keeps previous secret.
- PUT with new secret replaces encrypted value.
4. Frontend verification:
- Build and smoke test both setup pages for save + test connection with masked/unmasked transitions.

**Relevant files**
- /home/erpadmin/club-erp/backend/services/accounting.py - central settings read/write flow (upsert_system_setting, get_system_setting, list_system_settings).
- /home/erpadmin/club-erp/backend/api/routes/planche.py - module settings GET/PUT and connection tests using secrets.
- /home/erpadmin/club-erp/backend/api/routes/helloasso.py - module settings GET/PUT and OAuth connection test.
- /home/erpadmin/club-erp/backend/api/routes/accounting.py - generic settings endpoints that must respect masking.
- /home/erpadmin/club-erp/backend/requirements.txt - cryptography dependency.
- /home/erpadmin/club-erp/frontend/src/modules/planche/components/PlancheIntegrationPage.tsx - secret-field UX and save semantics.
- /home/erpadmin/club-erp/frontend/src/modules/helloasso/components/HelloAssoIntegrationPage.tsx - secret-field UX and save semantics.
- /home/erpadmin/club-erp/backend/migrations - migration + rollback scripts for existing data.

**Verification**
1. Run backend unit tests for crypto and settings service behaviors.
2. Run route tests validating masked responses and keep-existing-secret semantics.
3. Run migration on a copy of production-like data and verify no plaintext remains for matching secret-key suffixes.
4. Run frontend build and manual flow checks:
- Open settings page, verify masked values are shown.
- Save without editing secret, verify secret still works for connection tests.
- Replace secret, save, verify connection test uses new value.

**Decisions**
- Encrypt at rest for JSON keys matching suffixes: _secret, _token, _password.
- GET settings responses must mask secret values.
- Encryption key source is environment variable SETTINGS_ENCRYPTION_KEY.
- Included scope: backend settings storage + planche/helloasso/admin settings endpoints + related frontend setup forms + migration + tests.
- Excluded scope: redesign of role/capability model, non-settings secret stores, and external KMS integration in this pass.

**Further Considerations**
1. Key rotation can be added next by embedding key-version metadata per encrypted value (v2 plan).
2. If needed, extend secret-key matcher to additional suffixes (for example _api_key) after inventory review to avoid over-encrypting non-secret fields.
3. Any urllib-based outbound HTTP helper must set `User-Agent: python-requests/2.31.0` (or similar) to avoid Cloudflare WAF 1010 blocks — `Python-urllib/3.x` is banned by the HelloAsso Cloudflare zone and likely others.