# Backend Instructions
Applies to: backend/**

## Stack And Data
- Use FastAPI with async SQLAlchemy patterns already present in the project.
- PostgreSQL enum-like values are persisted as SMALLINT; keep Python and API mappings consistent.
- Use docs/pg.sql and docs/PRD files as the source of truth for schema and business constraints.

## API And Security
- Keep route contracts backward compatible unless change is explicitly requested.
- Validate payloads with Pydantic models and return clear HTTP errors.
- Reuse existing auth/security helpers for token handling and dependencies.
- Do not weaken authentication or authorization checks.

## Code And Persistence
- Prefer explicit transactions and clear commit/rollback behavior.
- Keep data integrity checks close to write paths.
- Add or update tests when changing business logic.
- Avoid introducing silent fallback behavior for critical flows.

## Operational Guardrails
- Keep logging actionable and avoid leaking sensitive data.
- Keep environment-variable based configuration and secure defaults.
