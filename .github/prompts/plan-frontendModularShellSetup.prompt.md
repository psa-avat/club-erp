## Plan: Frontend Modular Shell Setup.

Build a React-first modular frontend that satisfies the PRD functional goals (Club, Planning, Banque, Admin, Dashboard), while honoring current repo rules: shell in frontend/src and business modules under frontend/src/modules. Implement pnpm workspaces now in a hybrid way: workspace packages for shared building blocks (ui, api-client, i18n), module features remain in frontend/src/modules for low-risk delivery.

**Steps**
1. Phase 1: Baseline and workspace bootstrap. Create a Node workspace at repository root so `frontend` becomes a named workspace app package, then add shared workspace packages (`packages/ui`, `packages/api-client`, `packages/i18n`) without moving existing app code. This is foundational and blocks package linking work.
2. Phase 1: Update frontend package identity and dependency wiring in `frontend/package.json` so shell can consume workspace packages via `workspace:*`. Keep Vite entry and existing scripts unchanged in this phase to reduce migration risk. *depends on 1*
3. Phase 2: Shell architecture refactor in `frontend/src` by replacing the current app frame (`AppFrame` in `frontend/src/App.tsx`) with a dedicated shell layer (`shell/components/AppShell`, `Sidebar`, `Header`, `MobileDrawer`) and keep route protection at shell level using existing `ProtectedRoute` and `PublicOnlyRoute`. *depends on 2*
4. Phase 2: Route map expansion in `frontend/src/App.tsx` with module prefixes `/club/*`, `/planning/*`, `/banque/*`, `/admin/*`, plus `/dashboard` as shell home, while preserving existing `/login` behavior and fallback routing. Use module index exports and avoid deep imports. *parallel with 3 once shell contract is defined*
5. Phase 3: Module scaffolding under `frontend/src/modules` for `club`, `planning`, `banque`, `admin`, `dashboard` with mandatory internal structure (`api`, `components`, `types`, `store`, `index.ts`). Keep existing `pricing` module as compatibility placeholder and map it into Banque scope over time. *depends on 4*
6. Phase 3: Capability-aware navigation and guards. Reuse auth state from `frontend/src/auth/store/authStore.ts` and hooks in `frontend/src/auth/api/useAuth.ts` to add a shell-level capability utility (`useCapability`) and navigation filtering for module menus. Backend remains source of truth; frontend only hides/disables unauthorized actions. *depends on 5*
7. Phase 4: i18n foundation via workspace package. Implement shared i18n resources in `packages/i18n` with namespaces per module (`common`, `club`, `planning`, `banque`, `admin`, `dashboard`), French as primary locale and fallback target, and wire runtime initialization in frontend app bootstrap (`frontend/src/main.tsx`). *depends on 2, parallel with 5*
8. Phase 4: Replace hardcoded UI text in shell/auth/module entry screens with translation keys; enforce key naming convention `{module}.{context}.{key}` and ensure locale-driven formatting utilities (`Intl` for date/time/number/currency) are centralized in frontend shared utilities. *depends on 7*
9. Phase 5: API client consolidation. Move generic HTTP client concerns from `frontend/src/api/client.ts` into `packages/api-client` (or re-export transitional adapter) while preserving auth token interceptor semantics and query integration in module-local hooks. *depends on 2, parallel with 7*
10. Phase 5: Shared UI extraction. Promote reusable primitives/composites into `packages/ui` (wrapping or re-exporting `frontend/src/components/ui`) and update shell/modules to import from package entrypoints only. Keep design system visually consistent with existing Tailwind and shadcn usage. *depends on 3, parallel with 9*
11. Phase 6: Hardening and quality gates. Add lint/build/typecheck coverage for all workspaces and define translation completeness checks (missing key fallback behavior and CI detection). Validate responsive behavior at desktop/tablet/mobile thresholds and shell accessibility basics (focus, keyboard navigation, aria labels). *depends on 6, 8, 9, 10*

**Relevant files**
- `frontend/src/App.tsx` — replace current single-frame route assembly; introduce module-prefixed routes and shell mounting.
- `frontend/src/main.tsx` — provider composition (TanStack Query + router + i18n bootstrap).
- `frontend/src/components/layout/GlobalMenuBar.tsx` — source pattern to migrate into new shell header/navigation.
- `frontend/src/auth/components/ProtectedRoute.tsx` — preserve shell-level route protection.
- `frontend/src/auth/components/PublicOnlyRoute.tsx` — preserve guest-only login route behavior.
- `frontend/src/auth/store/authStore.ts` — capability-aware UI state source (roles/capabilities already present).
- `frontend/src/auth/api/useAuth.ts` — current user/session hooks to reuse for guards and menu filtering.
- `frontend/src/api/client.ts` — existing axios interceptor behavior to preserve during api-client packaging.
- `frontend/src/modules/pricing/index.ts` — transitional module reference to absorb into Banque roadmap.
- `frontend/package.json` — workspace dependencies and app package identity.
- `package.json` (repo root) — workspace root definition and shared scripts.
- `pnpm-workspace.yaml` (repo root) — workspace package globs (`frontend`, `packages/*`).
- `packages/ui/package.json` — shared UI package metadata and exports.
- `packages/ui/src/index.ts` — approved UI export surface used by shell/modules.
- `packages/api-client/package.json` — API client package metadata and peer deps.
- `packages/api-client/src/index.ts` — typed request client exports and interceptors.
- `packages/i18n/package.json` — i18n package metadata.
- `packages/i18n/src/index.ts` — i18n initialization and resources wiring.
- `packages/i18n/src/locales/fr/*.json` — primary locale namespaces.
- `packages/i18n/src/locales/en/*.json` — English locale namespaces.

**Verification**
1. Workspace integrity: run install and workspace listing; ensure `frontend` and `packages/*` resolve correctly and local links use `workspace:*`.
2. Type/lint/build: run workspace-wide checks; confirm no deep-import regressions between shell and modules.
3. Routing: verify navigation to `/dashboard`, `/club`, `/planning`, `/banque`, `/admin`, `/login`, plus wildcard fallback behavior.
4. Auth and guards: verify unauthenticated access redirects through `ProtectedRoute`, and capability-gated menu/actions hide correctly while backend still enforces authorization.
5. i18n behavior: verify no visible hardcoded strings on shell/login/module landing pages; switch `fr/en`; validate fallback to French when English key is missing.
6. Formatting: confirm locale-sensitive date/number/currency output is driven by active locale (`fr` vs `en`).
7. Responsive shell: validate sidebar collapse and mobile drawer behavior across target breakpoints.

**Decisions**
- Keep existing React stack (React + Vite + TanStack Query + Zustand); PRD Vue/Pinia/Node entries are treated as intent, not implementation baseline.
- Implement pnpm workspaces now.
- Use hybrid packaging now: modules remain in `frontend/src/modules` (per repo rule), while shared cross-cutting assets become workspace packages (`ui`, `api-client`, `i18n`).
- Deliver execution-ready plan depth with phased dependencies.

**Scope boundaries**
- Included: workspace bootstrap, shell structure, route map, module scaffolding, capability-aware frontend gates, i18n foundation, shared package setup.
- Excluded: full business feature implementation for each module, backend endpoint creation, and large visual redesign beyond structural shell needs.

**Further Considerations**
1. If strict one-package-per-module becomes mandatory later, plan a Phase 7 extraction from `frontend/src/modules/*` to `packages/module-*` with codemod-assisted import rewrites and explicit exception to current frontend architecture rule.
2. Add a translation key coverage script early to keep the “zero hardcoded strings” requirement enforceable as modules scale.
3. Define capability-to-route metadata in one registry file to keep sidebar rendering and route protection consistent.