# CLAUDE.md

Instructions for Claude when working in this repository.

## Project Snapshot

Club ERP is a modular ERP for a gliding club. It manages members, aircraft/assets, flights, VI/HelloAsso flows, Planche integration, pricing, packs, accounting, reports, storage, and member portal access.

The repository is a pnpm workspace plus a Python backend:

- `backend/`: FastAPI API, async SQLAlchemy models/services/routes, Pydantic schemas, tests.
- `frontend/`: Vite + React + TypeScript application.
- `packages/i18n/`: shared translation resources for `fr` and `en`.
- `packages/ui/`: small shared UI package (`PageHeader`, `Tabs`, `cn`).
- `docs/`: PRDs, specs, architecture notes, migration SQL, implementation plans.
- `deploy/`: Docker Compose, deployment notes, schema/init SQL.

The application is licensed under AGPL-3.0. Preserve existing license headers in backend files and follow local style when creating new ones.

## First Rules

- Read the relevant existing code before editing. Prefer the current project patterns over introducing new architecture.
- Do not overwrite or revert user changes. The worktree may already be dirty.
- Keep changes scoped to the requested feature or bug.
- For database changes, update the SQL/migration/schema material that matches the existing change type.
- For frontend UI text, use i18n keys in `packages/i18n/src/resources/fr.ts` and `en.ts`; do not hard-code user-facing French text in JSX.
- Prefer `@/` imports in frontend code when importing from `frontend/src`.
- Use `decimal.js` for frontend financial/pricing math. Avoid JavaScript floating point arithmetic for money, accounting balances, prices, or thresholds.
- Database enum-like values are generally stored as `SMALLINT`; check models, schemas, and SQL before adding values.

## Useful Commands

From the repository root:

```bash
pnpm --filter @club-erp/web dev
pnpm --filter @club-erp/web build
pnpm --filter @club-erp/web lint
```

Backend tests are Python unittest/pytest style. Common local commands:

```bash
backend/venv/bin/python -m unittest
backend/venv/bin/python -m pytest backend/tests
python3 -m pytest backend/tests
```

Local Docker stack:

```bash
cd deploy
docker compose up -d
docker compose logs -f erp-backend
docker compose down
```

Vite dev server runs on `http://localhost:5173` and proxies `/api` to `http://127.0.0.1:8000`. Docker frontend is documented at `http://localhost:8080`. Backend health is `/health`; API docs are under `/api/v1/docs` in non-production.

## Backend Architecture

Entry point: `backend/main.py`.

Core backend pattern:

- `backend/models.py`: SQLAlchemy ORM models.
- `backend/schemas/*.py`: Pydantic request/response DTOs.
- `backend/api/routes/*.py`: FastAPI routers. Keep these mostly orchestration, validation, dependency guards, and response shaping.
- `backend/services/*.py`: business logic and database operations.
- `backend/api/security.py`: JWT/session auth, capabilities, role helpers.
- `backend/constants.py`: capability names and shared constants.
- `backend/database.py`: async engine/session setup.

Routes use async SQLAlchemy sessions via `Depends(get_db)` from `api.dependencies`. Protected endpoints typically depend on `require_capability(...)` using constants such as `CAP_VIEW_FINANCIALS`, `CAP_MANAGE_USERS`, `CAP_MANAGE_PRICES`, etc.

When adding or changing backend behavior:

- Put business rules in services, not directly in routes, unless the route is only parsing query params or choosing a guard.
- Use explicit `HTTPException` statuses for validation/conflict/not-found cases; many services already use `400`, `404`, and `409` consistently.
- Keep accounting invariants strict: balanced entries, fiscal year boundaries, posted-entry immutability, and closed-year rules.
- Prefer `Decimal` for monetary values and Pydantic/SQLAlchemy types already used nearby.
- Add or update tests in `backend/tests` for non-trivial service logic, route guards, import/export behavior, or accounting effects.

## Database And Migrations

Database assets live in several places:

- `backend/models.py`: ORM model source of truth for the running API.
- `docs/migrations/*.sql`: numbered migrations and incremental SQL changes.
- `deploy/init-db/*.sql`: initialization scripts for Docker/provisioning.
- `deploy/schema erp-club.sql` and other deploy schema dumps: generated or deployment-oriented schema snapshots.
- `docs/*.sql`: design, seed, and module SQL references.

Before changing schema, inspect the relevant model, current migration set, and deployment schema file. If a new column/table is required, update ORM models, Pydantic schemas, services/routes, frontend types, and migration SQL together.

## Frontend Architecture

Entry points:

- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/shell/*`
- `frontend/src/modules/*`

The frontend follows a Shell + Module architecture:

- The shell owns auth, global layout, sidebar navigation, app header, routing, and alerts.
- Feature work belongs in `frontend/src/modules/[module-name]`.
- Modules expose public surfaces through their `index.ts`.
- Module internals commonly include `api/`, `components/`, `types/`, and sometimes `store/`.
- Shared shadcn-style components live in `frontend/src/components/ui`.
- Shared package UI lives in `packages/ui`.

Important libraries:

- React 19, Vite, TypeScript.
- React Router 7 for routing.
- TanStack Query for server state.
- Zustand for selected cross-module/global state.
- Tailwind CSS v4 and shadcn/Radix primitives for UI.
- `lucide-react` for icons.
- `sonner` for toasts.
- `decimal.js` for money/pricing calculations.

Frontend API pattern:

- Use the shared Axios instance from `frontend/src/api/client.ts`.
- Put module query keys and hooks in `frontend/src/modules/<module>/api/index.ts`.
- Use `getAuthRequestConfig()` or rely on the interceptor for bearer tokens, following nearby code.
- Invalidate TanStack Query keys after mutations; keep query keys stable and module-scoped.

Routing and navigation:

- App routes are centralized in `frontend/src/App.tsx`.
- Sidebar navigation is in `frontend/src/shell/navigation.ts`.
- Many old routes redirect into workspace routes such as `/workspace/finance`, `/workspace/members`, `/workspace/flights`, `/workspace/tarifs`.
- Capability-gated navigation uses `requiredCapability`.

## Frontend UI Conventions

Read `frontend/DESIGN_SYSTEM.md` before broad UI work.

Key rules:

- Use `WorkspaceShell` and `PageHeader` for workspace pages.
- Use existing shadcn UI components from `frontend/src/components/ui`.
- Use `DataTable` composition instead of adding header props to the table component.
- Prefer existing layout tokens: `border`, `bg-card`, `text-foreground`, `text-muted-foreground`.
- Avoid Material-style token names unless they already exist in the touched file.
- Use adaptive grids and horizontal scrolling for tables.
- Use `Dialog` for small forms, `Sheet` for large forms, and `AlertDialog` for destructive confirmations.
- Use `Badge` plus existing `badge-success`, `badge-warning`, `badge-destructive`, and `badge-info` classes for statuses.
- Do not create a separate app per module; everything is part of the same Vite app.

## I18n

Translations are configured in `frontend/src/i18n/config.ts` and sourced from `@club-erp/i18n`.

When adding UI labels:

- Add French keys to `packages/i18n/src/resources/fr.ts`.
- Add English keys to `packages/i18n/src/resources/en.ts`.
- Use `useTranslation(namespace)` in components.
- Reuse existing namespaces such as `common`, `banque`, `members`, `admin`, `assets`, `flights`, `vi`, `rh`, `pricing`, etc.

## Domain Notes

Common modules and concepts:

- Members: pilots, committees, registrations, member sheets, member portal, account summaries.
- Assets/Machines: aircraft/equipment, asset types, machine pricing, Planche machine push.
- Flights: flight import/pull, billing, pack consumption, Planche integration.
- VI/HelloAsso: voucher entitlements, types, planning, purchases/imports.
- Finance/Accounting: fiscal years, journals, PCG/accounts, entries, templates, supplier invoices, sales, reports, ledgers.
- Tarifs/Pricing: generic pricing, machine pricing, packs, flight types.
- Admin: users, roles/capabilities, system settings, storage, integration settings.

Accounting and pricing code is high-risk. Check existing service tests and specs before changing posting, reversal, fiscal year, pack consumption, tier thresholds, or account balance logic.

## Testing Guidance

Run the narrowest useful tests for the area changed, then a broader check when touching shared code:

- Frontend component/module change: `pnpm --filter @club-erp/web build`; lint if the change is style/import heavy.
- Backend service/route change: targeted `backend/venv/bin/python -m pytest backend/tests/<test_file>.py` or unittest equivalent.
- Accounting/pricing/migration change: include relevant accounting, flight billing, pack, and Planche tests if affected.
- Shared package/i18n change: run the frontend build.

If local dependencies or services are missing, report the exact command attempted and the failure.

## Reference Docs

Useful docs to inspect before larger work:

- `docs/ai-agents-prompt.md`: original short AI-agent guidance.
- `frontend/DESIGN_SYSTEM.md`: frontend layout/component conventions.
- `deploy/README.md`: local Docker and deployment flow.
- `docs/SPEC_ACCOUNTING.md`: accounting behavior.
- `docs/SPEC_MEMBERS.md`: members behavior.
- `docs/SPEC_FLIGHTS_BILLING.md`: flight billing behavior.
- `docs/SPEC_ASSETS.md`: assets behavior.
- `docs/PRD GESTION CLUB.md` and `docs/PRD GESTION CLUB -V2.md`: product context.

## Final Checklist Before Hand-off

- Code follows nearby patterns.
- Backend models, schemas, services, routes, SQL, frontend types, and i18n are aligned when a contract changes.
- User-facing text has both `fr` and `en` translations.
- Financial math uses `Decimal` in Python and `decimal.js` in TypeScript.
- Capability checks and navigation visibility are updated when adding protected features.
- Relevant build/tests were run, or the reason they could not run is documented.
