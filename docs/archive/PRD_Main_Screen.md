# frontend 
---
## 4. Modules
The application is composed of the following modules, each mapped to a workspace package:
### 4.1 Module: Club (`module-club`)- Member directory (pilots, instructors, non-flying members)- Member profile: personal data, licenses, medical certificates, qualifications- Aircraft fleet: registration, type, engine, maintenance status- Membership management: annual renewal, status tracking
### 4.2 Module: Planning (`module-planning`)- Digital flight board (planche de vol numérique)- Daily activity management: aircraft assignment, pilot/instructor pairing- OGN tracking integration (real-time glider position)- Flight declaration and post-flight validation- RAJ role management and handover
### 4.3 Module: Accounting (`module-banque`)- Member account ledger (compte adhérent)- Flight billing: automatic calculation from flight log entries- Pricing grids: historized, per aircraft type, per flight type- Dual-seat instruction cost-splitting rules- Bank reconciliation- Debit/credit entry management with immutable audit trail- Balance view per member
### 4.4 Module: Admin (`module-admin`)- User and role management (RBAC)- Application configuration- Pricing grid management- Audit log viewer- Data import/export (CSV, JSON)
### 4.5 Module: Dashboard (shell)- Home page with key KPIs per role- Notifications center- Cross-module search
---
## 5. Technical Architecture
### 5.1 Stack
| Layer | Technology ||---|---|| Frontend framework | Vue 3 (Composition API) || Build tool | Vite || Package manager | pnpm workspaces || UI component library | To be decided (e.g. PrimeVue, Vuetify, or custom) || State management | Pinia || Routing | Vue Router || i18n | vue-i18n v9+ || Backend | Node.js (Express or Fastify) || Database | PostgreSQL || ORM | Prisma or Drizzle || Auth | JWT + refresh tokens (or Keycloak) || Deployment | OVH VPS, Nginx reverse proxy |
### 5.2 Monorepo Structure
```packages/  ui/ # Shared design system: AppShell, Sidebar, Button, etc.  api-client/ # Typed REST API client (auto-generated from OpenAPI)  i18n/ # Shared translation files (fr, en)  module-club/  module-planning/  module-banque/  module-admin/apps/  web/ # Main SPA entry point, assembles all modules  api/ # Backend REST API```
### 5.3 Navigation Layout
- **App shell**: collapsible left sidebar (modules) + top header (user, notifications, language switcher)- Sidebar collapses to icon-only on tablet (< 1024px)- Sidebar becomes a hamburger drawer on mobile (< 768px)- Module-level routing: `/club/...`, `/planning/...`, `/banque/...`, `/admin/...`
### 5.4 API Design- RESTful JSON API- OpenAPI 3.0 spec as source of truth- Versioned endpoints (`/api/v1/...`)- Idempotent flight import via `ref_externe` field- Role-based endpoint access
---
## 6. Internationalisation (i18n)
### 6.1 Supported Languages (Minimum)| Code | Language | Status ||---|---|---|| `fr` | French | Primary / Default || `en` | English | Required |
Further languages (e.g. `de`, `es`) may be added without code changes.
### 6.2 Requirements- All UI strings must be externalized in translation files — **zero hardcoded strings** in components- Translation files live in the shared `packages/i18n/` workspace package, split by module namespace (e.g. `club.members`, `banque.ecritures`)- Language preference is stored in user profile and falls back to browser `Accept-Language`- A **language switcher** is accessible at all times in the top header- Date, time, number, and currency formatting must use `Intl` APIs driven by locale (e.g. `DD/MM/YYYY` for `fr`, `MM/DD/YYYY` for `en`)- All validation error messages, API error responses, and email notifications must also be localised- Translation keys follow the pattern: `{module}.{context}.{key}` (e.g. `club.members.licenseExpired`)- Missing translation keys must fall back to `fr` (primary language), never show raw keys in production
### 6.3 Content-Level Localisation- Aviation terminology must be reviewed by a domain expert for the English locale (e.g. "planche de vol" → "flight board", "remorquage" → "aerotow")- Legal/regulatory content (medical certificate labels, license types) should use EASA-standard English terminology
