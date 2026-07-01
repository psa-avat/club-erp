# CLAUDE.md

Instructions for Claude when working in this repository.

## Project Snapshot

Club ERP is a modular ERP for a French gliding club (AGPL-3.0). It manages members, aircraft/assets, flights, VI/HelloAsso flows, Planche integration, pricing, packs, accounting, reports, storage, and member portal access.

Repository layout (pnpm workspace + Python backend):

- `backend/`: FastAPI API, async SQLAlchemy models/services/routes, Pydantic schemas, tests.
- `frontend/`: Vite + React + TypeScript SPA, served by Nginx in Docker.
- `packages/i18n/`: shared translation resources (`fr` and `en`).
- `packages/ui/`: small shared UI package (`PageHeader`, `Tabs`, `cn`).
- `docs/`: product specs, manuals, architecture notes, active plans, migration SQL — see `docs/README.md`. Superseded material lives in `docs/archive/`.
- `deploy/`: Docker Compose files, deployment notes, schema/init SQL.

Preserve existing AGPL-3.0 license headers in backend files.

---

## First Rules

- Read the relevant existing code before editing. Prefer current project patterns over new architecture.
- Do not overwrite or revert user changes. The worktree may already be dirty.
- Keep changes scoped to the requested feature or bug.
- For database changes, update the SQL/migration/schema material that matches the existing change type.
- For frontend UI text, use i18n keys in `packages/i18n/src/resources/fr.ts` and `en.ts`; never hard-code French text in JSX.
- Prefer `@/` imports in frontend code when importing from `frontend/src`.
- Use `decimal.js` for frontend financial/pricing math. Never use JS floating-point arithmetic for money.
- Database enum-like values are stored as `SMALLINT`; check models, schemas, and SQL before adding values.

---

## Docker Stack

All `docker compose` commands must be run from the **`deploy/`** directory.

### Dev containers (docker-compose.override.yml auto-merged)

| Container | Image | Port (host) | Role |
|-----------|-------|-------------|------|
| `erp-db-dev` | postgres:18-alpine | `127.0.0.1:5432` | Local PostgreSQL |
| `erp-rustfs-dev` | rustfs/rustfs | `127.0.0.1:9000` (API S3), `192.168.0.120:9001` (console) | Object storage |
| `erp-backend` | built from `backend/` | `0.0.0.0:8000` | FastAPI / uvicorn |
| `erp-frontend` | built from monorepo root | `0.0.0.0:8080` | Nginx + Vite build |
| `erp-dozzle-dev` | amir20/dozzle | `9999` | Log viewer |

**Frontend Nginx** proxies `/api/*` → `http://erp-backend:8000` internally. No direct backend exposure needed in prod.

### Production topology (docker-compose.yml)

- `erp-backend` on `web_network` + `db_network` (not exposed via Traefik).
- `erp-frontend` on `web_network` (Traefik routes HTTPS to port 80).
- Shared PostgreSQL on `carnet-db` container reached via `db_network`.
- `CLUB_SLUG=avat` env var identifies the club in the backend.

### Common dev commands

```bash
# First-time volume creation (once per machine)
docker volume create pgdata_dev
docker volume create rustfsdata_dev
docker volume create rustfslogs_dev

# Start the full stack (from deploy/)
cd deploy
docker compose up -d

# Rebuild after code changes, then restart
docker compose build && docker compose up -d

# Rebuild a single service
docker compose build erp-backend
docker compose build erp-frontend

# Logs
docker compose logs -f erp-backend
docker compose logs -f erp-frontend
docker compose logs -f            # all containers

# Dozzle log UI
open http://localhost:9999

# Stop
docker compose down
```

### Access URLs (dev)

| URL | What |
|-----|------|
| `http://localhost:8080` | Frontend (Nginx + SPA) |
| `http://localhost:8000` | Backend API (direct) |
| `http://localhost:8000/health` | Backend health check |
| `http://localhost:8000/api/v1/docs` | FastAPI Swagger (non-prod only) |
| `http://localhost:9999` | Dozzle log viewer |
| `http://localhost:9000` | RustFS S3 API |
| `http://192.168.0.120:9001` | RustFS console |

### Vite dev server (no Docker, hot-reload)

```bash
pnpm --filter @club-erp/web dev    # runs on http://localhost:5173, proxies /api → 127.0.0.1:8000
pnpm --filter @club-erp/web build
pnpm --filter @club-erp/web lint
```

---

## Backend Architecture

Entry point: `backend/main.py`.

Core pattern:

| Path | Role |
|------|------|
| `backend/models.py` | SQLAlchemy ORM models — source of truth |
| `backend/schemas/*.py` | Pydantic request/response DTOs |
| `backend/api/routes/*.py` | FastAPI routers — orchestration, guards, response shaping only |
| `backend/services/*.py` | Business logic and DB operations |
| `backend/api/security.py` | JWT/session auth, capabilities, role helpers |
| `backend/constants.py` | Capability names, role codes, flight/launch type labels |
| `backend/database.py` | Async engine/session setup |

Routes use `Depends(get_db)` from `api.dependencies`. Protected endpoints use `require_capability(CAP_*)`.

When adding or changing backend behavior:

- Put business rules in services, not routes.
- Use explicit `HTTPException` (`400`, `404`, `409`) consistently.
- Keep accounting invariants strict: balanced entries, fiscal year boundaries, posted-entry immutability, closed-year rules.
- Use `Decimal` for monetary values.
- Add or update tests in `backend/tests` for non-trivial service logic.

### Backend tests

```bash
# Run all tests
backend/venv/bin/python -m pytest backend/tests

# Run a specific file
backend/venv/bin/python -m pytest backend/tests/<test_file>.py
```

---

## Database and Migrations

| Location | Role |
|----------|------|
| `backend/models.py` | ORM source of truth for the running API |
| `docs/migrations/*.sql` | Numbered migration files (001–054+) |
| `deploy/init-db/*.sql` | Docker initialization scripts |
| `deploy/schema erp-club.sql` | Deployment schema snapshot |
| `docs/*.sql` | Design, seed, and module SQL references |

Before any schema change: inspect the model, current migrations, and deployment schema. If a new column/table is needed, update ORM models, Pydantic schemas, services/routes, frontend types, and a new migration SQL file together.

---

## Frontend Architecture

Entry points: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/shell/*`, `frontend/src/modules/*`.

Shell + Module pattern:

- **Shell** owns auth, global layout, sidebar navigation, app header, routing, and alerts.
- **Feature work** belongs in `frontend/src/modules/[module-name]`.
- Modules expose public surfaces through their `index.ts` only.
- Module internals: `api/` (TanStack Query hooks), `components/`, `types/`, `store/` (Zustand, if needed).
- Shared shadcn-style components: `frontend/src/components/ui`.
- Shared package UI: `packages/ui`.

Key libraries:

| Library | Purpose |
|---------|---------|
| React 19 + Vite + TypeScript | Core stack |
| React Router 7 | Routing |
| TanStack Query | Server state / data fetching |
| Zustand | Cross-module / global client state |
| Tailwind CSS v4 + shadcn/Radix | UI primitives |
| `lucide-react` | Icons |
| `sonner` | Toasts |
| `decimal.js` | Monetary / pricing calculations |

Frontend API pattern:

- Use the shared Axios instance from `frontend/src/api/client.ts`.
- Put module query keys and hooks in `frontend/src/modules/<module>/api/index.ts`.
- Bearer tokens are handled by the interceptor; follow nearby code.
- Invalidate TanStack Query keys after mutations; keep keys stable and module-scoped.

Routing and navigation:

- Routes are centralized in `frontend/src/App.tsx`.
- Sidebar navigation is in `frontend/src/shell/navigation.ts` (uses `requiredCapability` for gating).
- Many old routes redirect into `/workspace/finance`, `/workspace/members`, `/workspace/flights`, `/workspace/tarifs`.

---

## Frontend UI Conventions

Read `frontend/DESIGN_SYSTEM.md` before broad UI work.

- Use `WorkspaceShell` and `PageHeader` for workspace pages.
- Use existing shadcn UI components from `frontend/src/components/ui`.
- Use `DataTable` composition — do not add header props to the table component.
- Layout tokens: `border`, `bg-card`, `text-foreground`, `text-muted-foreground`.
- Avoid Material-style token names unless they already exist in the touched file.
- Use adaptive grids and horizontal scrolling for tables.
- `Dialog` for small forms, `Sheet` for large forms, `AlertDialog` for destructive confirmations.
- `Badge` + `badge-success`, `badge-warning`, `badge-destructive`, `badge-info` for statuses.
- One Vite build, not multiple apps.

---

## I18n

Translations sourced from `@club-erp/i18n` (configured in `frontend/src/i18n/config.ts`).

When adding UI labels:

- Add French key to `packages/i18n/src/resources/fr.ts`.
- Add English key to `packages/i18n/src/resources/en.ts`.
- Use `useTranslation(namespace)` in components.
- Reuse existing namespaces: `common`, `banque`, `members`, `admin`, `assets`, `flights`, `vi`, `rh`, `pricing`, etc.

---

## Domain Notes

| Module | Key concepts |
|--------|-------------|
| Members | Pilots, committees, registrations, member sheets, portal, account summaries. `ME<YEAR>-<NNNN>` / `EXT-<NNNN>` / `FO-<NNNN>` IDs. |
| Assets | Aircraft/equipment, asset types, ownership (club vs. private), machine pricing, Planche push. |
| Flights | Pull from Planche, billing (FL journal), pack consumption (REM journal), Planche integration. |
| VI / HelloAsso | Voucher entitlements, types, planning, purchases/imports from HelloAsso. |
| Finance / Accounting | Fiscal years, journals (VT/HA/BQ/CS/OD/AN/FL/REM), PCG/accounts, entries, templates, supplier invoices, sales, reports, ledgers. |
| Tarifs / Pricing | Versioned pricing, machine pricing, packs, flight types, tier thresholds. |
| Admin | Users, roles/capabilities, system settings, storage, integration settings, audit trail. |

**Accounting and pricing code is high-risk.** Check existing service tests and specs before changing posting, reversal, fiscal year, pack consumption, tier thresholds, or account balance logic.

Roles: `admin`, `finance`, `instructor`, `maintenance`, `member`.
Capabilities: `EDIT_FLIGHTS`, `MANAGE_PRICES`, `VIEW_FINANCIALS`, `POST_ACCOUNTING_ENTRIES`, `MANAGE_ACCOUNTING_SETTINGS`, `MANAGE_SYSTEM_SETTINGS`, `MANAGE_USERS`, `MEMBER_PORTAL`, `MANAGE_ASSETS`, `MANAGE_PLANCHE`, `HELLOASSO`, `MANAGE_VI`, `PLAN_VI`, `SYNC_VI_PLANCHE`, `FEDERAL_SYNC`.

---

## Testing Guidance

Run the narrowest useful test set for the area changed:

| Change type | Test command |
|-------------|-------------|
| Frontend component/module | `pnpm --filter @club-erp/web build` (+ lint if style/import heavy) |
| Backend service/route | `backend/venv/bin/python -m pytest backend/tests/<test_file>.py` |
| Accounting/pricing/migration | Include accounting, flight billing, pack, and Planche tests if affected |
| Shared package/i18n | `pnpm --filter @club-erp/web build` |
| Docker build | `docker compose build erp-frontend` or `erp-backend` from `deploy/` |

If local dependencies or services are missing, report the exact command and the failure.

---

## Reference Docs

`docs/` is organized by audience — see `docs/README.md` for the full index. Summary:

| Document | Description |
|----------|-------------|
| `docs/README.md` | Index of the whole `docs/` tree — check here first |
| `docs/product/SPEC_MAIN.md` | Module list, menu structure, feature inventory |
| `docs/product/SPEC_ROLES_CAPABILITIES.md` | Roles, capabilities, 2FA, role-capability matrix |
| `docs/product/SPEC_MEMBERS.md` | Members module specification |
| `docs/product/SPEC_ACCOUNTING.md` | Accounting module specification (incl. pack link table, REM journal) |
| `docs/product/SPEC_FLIGHTS_BILLING.md` | Flight billing specification |
| `docs/product/SPEC_ASSETS.md` | Assets module specification |
| `docs/manual/USER_GUIDE.md` | Complete end-user guide (all modules, FAQ) |
| `docs/developer/ARCHITECTURE_GLOBAL_FISCAL_YEAR.md` | Global fiscal-year store architecture |
| `docs/operations/mapping_journal.md` | Journal → PCG account mapping reference |
| `docs/plans/` | Active plans — real, unbuilt or partially-built features. Check before starting new work on a module. |
| `docs/archive/` | Superseded PRDs, completed plans, one-time audits — historical only, not a source of truth |
| `frontend/DESIGN_SYSTEM.md` | Frontend layout/component conventions |
| `deploy/README.md` | Deployment and operations guide |
| `.github/copilot-instructions.md` | Equivalent guidance for GitHub Copilot — keep in sync with this file |

---

## Final Checklist Before Hand-off

- [ ] Code follows nearby patterns.
- [ ] Backend models, schemas, services, routes, SQL, frontend types, and i18n are aligned when a contract changes.
- [ ] User-facing text has both `fr` and `en` translations.
- [ ] Financial math uses `Decimal` in Python and `decimal.js` in TypeScript.
- [ ] Capability checks and navigation visibility are updated when adding protected features.
- [ ] Relevant build/tests were run, or the reason they could not run is documented.
- [ ] New migration SQL added to `docs/migrations/` with next sequence number.
