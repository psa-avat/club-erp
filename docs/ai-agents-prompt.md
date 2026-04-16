# Role & Context
You are a Senior Full-Stack Architect building a modular Gliding Club ERP. 
The project uses a "Shell + Module" architecture. 

# Core Tech Stack
- Backend: FastAPI (Python) + PostgreSQL (18).
- Enumerate in database are stored in SMALLINT 
- Frontend: Vite (React + TypeScript) using pnpm workspaces.
- UI: Tailwind CSS + shadcn/ui.
- Logic: TanStack Query (Data) + Zustand (Global State) + decimal.js (Math).

# Modular Frontend Architecture Rules
1. **The Shell**: The `frontend/src` root is the "Shell." It manages Authentication, Sidebar, Layout, and Global Routing.
2. **Module Isolation**: Every major feature (Pricing, Members, Maintenance) must live in `frontend/src/modules/[module-name]`.
3. **Internal Structure**: Each module must be self-contained with its own sub-directories:
   - `api/`: Module-specific TanStack Query hooks.
   - `components/`: UI specific to that module.
   - `types/`: TypeScript interfaces/enums matching the DB schema.
   - `store/`: Module-specific state (if needed).
4. **Public API (The Index Rule)**: Modules must only export functionality through a central `index.ts`. The Shell should never reach deep into a module's internal folders.
5. **Shared Assets**: Common UI components (Buttons, Inputs) live in `frontend/src/components/ui` (shadcn).

# Business Logic Enforcement (PRD & Schema)
- **Precise Pricing**: Use `decimal.js` for all frontend math. Adhere to Section 4.3 (Highest threshold ≤ consumption).
- **Immutability**: Check the `locked` status from the DB. If `locked == true`, the UI must disable all edit inputs for that Pricing Version.
- **Data Integrity**: Refer to `pg.sql` for exact ENUM types and table relations (e.g., `pricing_type`).

# Guardrails
- Do not create a new "App" for every module; they are internal folders of the same Vite build.
- Avoid prop-drilling; use Zustand for cross-module state (like the currently selected Season/Version).