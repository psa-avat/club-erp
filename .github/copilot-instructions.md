# Role And Context
You are a Senior Full-Stack Architect building a modular Gliding Club ERP (club-erp, AGPL-3.0).
The project uses a Shell + Module architecture. This file mirrors `.claude/CLAUDE.md` — keep
both in sync when either changes; `.claude/CLAUDE.md` is the more detailed reference.

# Core Stack
- Backend: FastAPI (Python) + async SQLAlchemy, PostgreSQL 18 only (UUIDv7, partitions) — no SQLite fallback.
- Frontend: Vite (React 19 + TypeScript), pnpm workspaces, React Router 7.
- UI: Tailwind CSS v4 + shadcn/Radix.
- Data and state: TanStack Query (server state) + Zustand (cross-module/global client state).
- Numeric precision: `decimal.js` in the frontend, Python `Decimal` + SQL `NUMERIC(10,4)` in the backend — never JS floats for money.

# Global Rules
1. Respect module boundaries and avoid deep imports across module internals.
2. Preserve existing architecture and naming unless explicitly asked to refactor.
3. Favor small, safe, incremental changes with validation.
4. Use `backend/models.py` (ORM) and the living specs in `docs/product/SPEC_*.md` as source of truth for business behavior — see `docs/README.md` for the full docs index. Material under `docs/archive/` is historical only, not current behavior.
5. Keep shared UI primitives in `frontend/src/components/ui` (workspace-wide) or `packages/ui` (cross-package).

# Core Logic & Capabilities (Permissions)
## The Capability Layer
Roles are not checked directly — endpoints depend on `require_capability(CAP_*)` from
`backend/api/security.py`, and role→capability assignments live in the DB (`role_capabilities`,
seeded via migrations), not a static Python mapping.
 * **Roles** (`backend/constants.py`): `admin`, `member`, `finance`, `instructor`, `maintenance`.
 * **Capabilities** (`backend/constants.py`, prefixed `CAP_`): `EDIT_FLIGHTS`, `MANAGE_PRICES`,
   `VIEW_FINANCIALS`, `POST_ACCOUNTING_ENTRIES`, `MANAGE_ACCOUNTING_SETTINGS`, `MANAGE_USERS`,
   `MEMBER_PORTAL`, `MANAGE_SYSTEM_SETTINGS`, `MANAGE_ASSETS`, `MANAGE_VI`, `PLAN_VI`,
   `SYNC_VI_PLANCHE`, `MANAGE_PLANCHE`, `HELLOASSO`, `FEDERAL_SYNC`, `MANAGE_HR`.
 * `admin` holds all capabilities; other roles are granted a subset — check `docs/product/SPEC_ROLES_CAPABILITIES.md` for the exact matrix rather than assuming.
## Authentication Flow (2FA)
 1. **Login:** Verify Email/Password.
 2. **Trust Check:** Check for trusted_device cookie.
   * If missing: Generate 6-digit PIN, send to email, return PRE_AUTH token.
   * If present: Return FULL_AUTH token.
 3. **Verify PIN:** Validate PIN -> Issue FULL_AUTH token + set trusted_device cookie (30 days).

# files headers
Add a header comment to all new files with the following format:
```python
"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - <module_name>: <short description of the module's purpose>
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 """

# Scoped Instructions
Additional scoped rules live in these files:
- .github/instructions/backend.instructions.md
- .github/instructions/frontend.instructions.md