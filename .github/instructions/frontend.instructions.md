# Frontend Instructions
Applies to: frontend/**

## Architecture
- Treat frontend/src as the Shell (auth, layout, global routing).
- Keep business features under frontend/src/modules/[module-name].
- For each module, use internal folders: api, components, types, store.
- Export module capabilities through module index files; avoid deep imports from shell.

## State, Data, And UI
- Use TanStack Query for server data and async mutations.
- Use Zustand for global or cross-module client state.
- Use decimal.js for pricing or other precision-sensitive math.
- Use shared UI primitives from frontend/src/components/ui.

## Behavior Rules
- Respect locked states from backend: if locked is true, disable edit interactions.
- Keep type definitions aligned with backend schema and API contracts.
- Do not create separate app roots per module; all modules live in one Vite app.

## Implementation Quality
- Prefer accessible forms and clear error states.
- Keep route protection logic in shell-level auth components.
- Keep styling consistent with existing design tokens and utility patterns.

## Design System
> Consulter `frontend/DESIGN_SYSTEM.md` pour les patterns de layout,
> composants et conventions visuelles (WorkspaceShell, KpiCard, InfoBanner,
> ActionCard, DataTable, grilles responsives, tokens, badges statut, etc.).
