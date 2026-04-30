## Plan: Members Directory UX V2

### Vision

Replace the current card-list + inline-form layout with four purpose-built views:

1. Members Directory: dense table, KPI strip, quick filters, row actions.
2. Member Create/Edit Form (dedicated page): `MEMBERS > NEW PROFILE` / `MEMBERS > EDIT PROFILE`.
3. Registration Panel: two-column slide-over (steps on left, accounting preview always visible on right).
4. Committees Management: dedicated `/commissions` route with enriched committee cards + admin table.

This document aligns the implementation with the proposed wireframes.

---

### Layout Overview

#### 1) Members Directory (`/members`)

- Header: title + subtitle + `Export CSV` + `Add New Member`.
- KPI strip: Total Members | Pending Renewals | Active Instructors | Guest/Temp Passes.
- Filter bar: search + quick filters (`Category`, `Role`, `Can Fly`) + advanced filter icon.
- Table columns:
  - NAME & ID
  - CATEGORY
  - ROLE FLAGS
  - OPERATIONAL STATUS
  - REGISTRATION
  - COMMISSION
  - ACTIONS
- Renewal warning UX:
  - warning icon near member name
  - left row stripe for renewal-required members
- Pagination footer: `Showing X to Y of N members`.

#### 2) Member Create/Edit Form (dedicated page)

- Route target:
  - create: `/members/new`
  - edit: `/members/:uuid/edit`
- Layout: two columns.
- Left column:
  - Identite & Contact: first name, last name, gender, birth date, email, phone.
  - Club Classification: member category, FFVP ID, account ID.
  - Notes.
- Right sidebar:
  - photo placeholder/upload area.
  - Roles & Privileges toggles:
    - Can Fly
    - Instructor
    - Employee
    - Executive
    - Board Member
  - System verification block.
- Footer actions:
  - `Cancel`
  - `Validate & Create File` (create)
  - `Save Changes` (edit)
- Field policy updates:
  - remove `seniority`
  - use `first_subscription_year` (absolute year) when needed
  - `is_active` lifecycle remains business-flow controlled (no free toggle in normal form flow)

#### 3) Registration Panel (two-column slide-over)

- Trigger: row action `Finalize Registration`.
- Header: avatar, name, badges, account ID, and `Member since {first_subscription_year}`.
- Left column steps:
  - Step 1: Administrative Checklist (status chips: VALID / PENDING / VERIFIED).
  - Step 2: Fare Selection (selectable pricing rows + total amount due).
  - Step 3: Committee Selection (MANDATORY, at least one committee).
- Right column (always visible): Accounting Preview.
  - draft GL lines
  - invoice reference
  - reactive update from selected fares
- Footer: `Cancel` + effective date + `Validate & Activate Registration`.
- Validation gate: activation disabled until fare selection + committee selection are both satisfied.

#### 4) Committees Management (`/commissions`)

- Header: title + subtitle + `Add Committee`.
- Card grid requirements:
  - colored committee code badge
  - committee name + description
  - manager block with avatar
  - active members with initials avatar stack + assigned count
  - actions: `Manage Roster` and `Assign Member`
- Administrative table:
  - Code
  - Committee Name
  - Manager
  - Last Meeting
  - Budget Status
  - Actions
- Budget status visual states:
  - ON TRACK
  - PENDING REV.
  - OVER BUDGET

---

### Implementation Phases

#### Phase 1 to 8

Completed in prior workstream (KPI strip, table, registration panel baseline, filter drawer, `is_active` governance, pagination, committees route).

#### Phase 9 - Separate member form page

- Remove inline member create/edit section from directory surface.
- Introduce dedicated `MemberFormPage` route(s).
- Keep shared form logic centralized in `membersShared.tsx`.

#### Phase 10 - `seniority` to `first_subscription_year`

- Database migration required.
- Backend model/schema/service rename required.
- Frontend type/form/i18n rename required.
- `first_subscription_year` semantics: absolute year of first subscription.

#### Phase 11 - Registration validity audit

- Keep overlap-based validity logic for active registrations.
- Ensure denormalized `last_registration_year` is updated on registration completion.
- Confirm list badge computation remains year-aware.

#### Phase 12 - Registration panel redesign

- Refactor panel to strict two-column layout.
- Keep accounting preview always visible in right column.
- Replace `Member since` display source with `first_subscription_year`.

#### Phase 13 - Committees card enrichment

- Add manager avatar block.
- Add member initials stack with assigned count.
- Add committee badge color mapping.
- Add table support for `last_meeting_date` and `budget_status`.

---

### Data and Backend Notes

- Registration validity logic should continue using date overlap for active status.
- `last_registration_year` must be maintained during completion flows.
- `committee_codes` on member list remains preferred for directory COMMISSION badges.
- For committees admin table enrichment, backend fields may be required:
  - `last_meeting_date`
  - `budget_status`

---

### Verification Checklist

1. Directory has no inline form and actions route to dedicated member form page.
2. Form UX matches two-column wireframe behavior.
3. Registration panel shows `Member since {first_subscription_year}` and two-column behavior.
4. Committee cards include manager avatar and member avatar stack.
5. Migration applies and existing data converts safely.
6. Type checks and API contracts pass after field rename.
