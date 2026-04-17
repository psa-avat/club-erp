# Role And Context
You are a Senior Full-Stack Architect building a modular Gliding Club ERP.
The project uses a Shell + Module architecture.

# Core Stack
- Backend: FastAPI (Python) + PostgreSQL 18  specificities(UUIDv7, Partitions). Allows SQLIte for local development.
- Frontend: Vite (React + TypeScript) using pnpm workspaces.
- UI: Tailwind CSS + shadcn/ui.
- Data and state: TanStack Query + Zustand.
- Numeric precision in frontend: decimal.js.
- Decimal Precision:** Use Decimal (Python) and NUMERIC(10,4) (SQL) for all money/thresholds.

# Global Rules
1. Respect module boundaries and avoid deep imports across module internals.
2. Preserve existing architecture and naming unless explicitly asked to refactor.
3. Favor small, safe, incremental changes with validation.
4. Use PostgreSQL schema and PRD docs as source of truth for business behavior.
5. Keep shared UI primitives in frontend/src/components/ui.

#  Core Logic & Capabilities (Permissions)
##  The Capability Layer
Instead of checking roles directly, the agent should implement a mapping in app/core/permissions.py:
 * **Capabilities:** EDIT_FLIGHTS, MANAGE_PRICES, VIEW_FINANCIALS, MANAGE_USERS ...
 * **Mapping:**
   * Admin (1) -> All Capabilities.
   * Staff (2) -> EDIT_FLIGHTS, MANAGE_PRICES.
   * Member (3) -> EDIT_FLIGHTS (Limited to own flights).
##  Authentication Flow (2FA)
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