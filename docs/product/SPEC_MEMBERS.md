# Members Module Specification

## Purpose

This document defines the implementation specification for the Members module of the gliding club ERP.
It turns the member PRD into a build-ready scope for database, backend, and frontend work.

This module manages:

- member identity and contact information
- member classification and operational role flags
- committee assignments
- yearly flying member sheet data
- member-specific authentication and expense access

This module does not create rows in the existing `users` table. Member access is a separate concern and must be implemented independently from staff/admin user authentication.

## Confirmed Product Decisions

The following decisions are confirmed and drive the design:

1. Full member, temporary member, non-flying member, short-period member, external pilot, volunteer, external organization, and client or supplier are all supported categories that must be stored.
2. Instructor, employee, executive, and board are role flags, not the primary member type.
3. Committee membership is enforced after registration completion, not at draft creation time.
4. Member authentication is specific to members and separate from ERP staff authentication. `account_id` is also used as the ledger identity.
5. Member category, operational status, and current-year registration status are distinct concerns and must not be merged in filters or forms.

## Goals

- Store complete member records with stable business identifiers.
- Support multiple role flags on the same member.
- Track annual member activity for flying members.
- Track committee membership and committee management.
- Prepare for external member access to expenses without coupling members to internal admin users.

## Non-Goals

- Reusing the existing `users` table for members.
- Implementing full expense ledger screens inside this module.
- Implementing FFVP synchronization in the first version.
- Storing full image binaries in PostgreSQL in the first version.

## Domain Model

### 1. Members

Represents a person known by the club.

Each member has:

- a UUID primary key
- a unique business identifier `account_id`
- account ids use category-specific prefixes: `ME<YEAR>-<NNNN>` for club members, `EXT-<NNNN>` for external pilots and external organizations, and `FO-<NNNN>` for clients/suppliers
- a member category
- an operational status
- a current-year registration summary field maintained from registration records
- zero or more operational role flags
- contact and identity fields
- lifecycle compatibility fields

### 2. Member Role Flags

Role flags are independent booleans stored on the member record:

- `is_instructor`
- `is_employee`
- `is_executive`
- `is_board_member`

Business rule:

- a member may be both instructor and executive
- a member may be both instructor and employee
- a member may not be employee and executive at the same time
- a member may not be employee and board member at the same time

### 3. Committees

Committees represent recurring club working groups with an assigned manager and annual membership assignments.

Each committee has:

- a UUID primary key
- a unique code
- a description
- an optional yearly budget amount
- an optional member manager

### 4. Committee Membership

Committee membership is stored in a join table.

Committee assignment is required only when member registration is completed.

### 5. Member Sheet

The member sheet stores annual flying-related data for members who can fly.

There is at most one member sheet per member per year.

### 6. Member Registration Periods

Registration is a distinct dated validity period, not a single field on `members`.

It is separate from `registration_status` on `members`. In V2, `registration_status` is treated as a compatibility summary for the selected or current year and is recomputed from `member_registrations`. Admin reversals must happen by updating the underlying registration row, not by editing the summary field directly.

A registration record:

- marks the member as registered for a date range
- stores the target reporting year
- stores the member category snapshot used for the registration
- triggers the creation of accounting writings based on the applicable price list entries
- creates or confirms the member sheet for the target year if `can_fly = true`
- records who performed the registration and when

A member is considered registered for a year when an active registration period overlaps that calendar year.

Examples:

- a member registered in October for the rest of the current year and next year has a period spanning both years
- a pilot registered in December for the next year has a period starting on January 1 of the next year
- temporary members use exact short validity periods

### 7. Price List

The price list defines the fees applicable per member category for a given year.

Each price list entry:

- belongs to a specific year
- targets a specific member category (or is universal)
- carries a label and a unit amount
- contributes one row in `accounting_writings` when the registration is executed

The price list is managed by authorised staff before the registration campaign begins.

### 8. Accounting Writings

Accounting writings record the financial consequences of a registration event.

Each accounting writing:

- is linked to the `member_registration` that triggered it
- copies the price list entry label and amount at the time of registration (snapshot, not a live FK)
- expresses a debit on the member's ledger account (`account_id`)
- is immutable once created; cancellation produces a reversal row

The accounting module integration is out of scope for v1, but the table must be created so that data is available when the ledger module is built.

## Enumerations

All enumerations are stored as `SMALLINT`, consistent with project rules.

### Member Category

- `1` = Full Member
- `2` = Temporary Member
- `3` = Non-Flying Member
- `4` = Short Period Member
- `5` = External Pilot
- `6` = Volunteer
- `7` = External Organization
- `8` = Client / Supplier

### Gender

- `0` = Unspecified
- `1` = Male
- `2` = Female
- `3` = Other

### Member Status

- `1` = Active
- `2` = Suspended
- `3` = Resigned
- `4` = Anonymized

### Registration Status

- `1` = Draft
- `2` = In Progress
- `3` = Completed
- `4` = Archived

### Fare Type

Stored in member sheet.
Exact values may later be aligned with pricing rules, but v1 should support:

- `1` = Standard
- `2` = Student
- `3` = Discovery
- `4` = Pack
- `5` = Other

## Database Specification

The module must be delivered with a dedicated SQL file:

- `docs/members.sql`

It should create the following tables.

### Table: `members`

Required columns:

- `uuid UUID PRIMARY KEY`
- `genre SMALLINT NOT NULL DEFAULT 0`
- `first_name VARCHAR(100) NOT NULL`
- `last_name VARCHAR(100) NOT NULL`
- `date_of_birth DATE NULL`
- `email VARCHAR(255) NULL`
- `phone VARCHAR(50) NULL`
- `member_category SMALLINT NOT NULL`
- `seniority SMALLINT NULL`
- `ffvp_id BIGINT NULL`
- `account_id VARCHAR(32) NOT NULL UNIQUE`
- `photo_url TEXT NULL`
- `status SMALLINT NOT NULL DEFAULT 1`
- `registration_status SMALLINT NOT NULL DEFAULT 1`
- `is_instructor BOOLEAN NOT NULL DEFAULT FALSE`
- `is_employee BOOLEAN NOT NULL DEFAULT FALSE`
- `is_executive BOOLEAN NOT NULL DEFAULT FALSE`
- `is_board_member BOOLEAN NOT NULL DEFAULT FALSE`
- `can_fly BOOLEAN NOT NULL DEFAULT FALSE`
- `external_auth_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- `last_registration_year SMALLINT NULL`
- `notes TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_by INTEGER NULL`

Constraints:

- unique on `account_id`
- optional unique on `email` when not null
- optional unique on `ffvp_id` when not null
- check valid `genre`
- check valid `member_category`
- check valid `status`
- check valid `registration_status`
- check employee/executive incompatibility
- check employee/board incompatibility

Reference:

- `updated_by` references `users.id`

Notes:

- `account_id` formats: `ME<YEAR>-<NNNN>`, `EXT-<NNNN>`, `FO-<NNNN>`
- value is auto-generated on creation but may be manually adjusted by authorized admin logic
- `can_fly` is derived from category in some cases, but stored explicitly for clarity and reporting

### Table: `committees`

Required columns:

- `uuid UUID PRIMARY KEY`
- `code VARCHAR(32) NOT NULL UNIQUE`
- `description VARCHAR(255) NOT NULL`
- `budget_amount NUMERIC(12,2) NULL`
- `manager_member_uuid UUID NULL`
- `is_active BOOLEAN NOT NULL DEFAULT TRUE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_by INTEGER NULL`

References:

- `manager_member_uuid` references `members.uuid`
- `updated_by` references `users.id`

### Table: `committee_members`

Required columns:

- `committee_uuid UUID NOT NULL`
- `member_uuid UUID NOT NULL`
- `membership_year SMALLINT NOT NULL`
- `assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `assigned_by INTEGER NULL`

Primary key:

- `(committee_uuid, member_uuid, membership_year)`

References:

- `committee_uuid` references `committees.uuid`
- `member_uuid` references `members.uuid`
- `assigned_by` references `users.id`

Notes:

- membership is yearly because committee assignments are renewed during registration

### Table: `member_sheets`

Required columns:

- `uuid UUID PRIMARY KEY`
- `member_uuid UUID NOT NULL`
- `year SMALLINT NOT NULL`
- `licence_number VARCHAR(100) NULL`
- `fare_type SMALLINT NOT NULL`
- `hours_count NUMERIC(8,2) NOT NULL DEFAULT 0`
- `packs_bought_count INTEGER NOT NULL DEFAULT 0`
- `hours_done_in_pack NUMERIC(8,2) NOT NULL DEFAULT 0`
- `remaining_hours_in_pack NUMERIC(8,2) NOT NULL DEFAULT 0`
- `expense_access_token_hash VARCHAR(255) NULL`
- `expense_access_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_by INTEGER NULL`

Constraints:

- unique on `(member_uuid, year)`
- check valid `fare_type`
- numeric fields must be `>= 0`

References:

- `member_uuid` references `members.uuid`
- `updated_by` references `users.id`

### Table: `member_registrations`

Tracks dated registration validity periods. This table is the source of truth for annual activity.

Required columns:

- `uuid UUID PRIMARY KEY`
- `member_uuid UUID NOT NULL`
- `start_date DATE NOT NULL`
- `end_date DATE NOT NULL`
- `registered_for_year SMALLINT NOT NULL`
- `registration_type SMALLINT NOT NULL`
- `status SMALLINT NOT NULL DEFAULT 1`
- `registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `registered_by INTEGER NULL`
- `notes TEXT NULL`

Constraints:

- unique on `(member_uuid, start_date, end_date)`
- check valid `registered_for_year`
- check valid `registration_type`
- check valid `status`: `1=Active`, `2=Cancelled`, `3=Superseded`
- check `end_date >= start_date`

References:

- `member_uuid` references `members.uuid`
- `registered_by` references `users.id`

Notes:

- creating this row triggers generation of `accounting_writings` and creation/confirmation of `member_sheets`
- `members.last_registration_year` is deprecated compatibility data derived from the latest registration
- yearly committee membership should be renewed explicitly, not inferred forever from previous years

### Table: `price_list`

Defines the fees applicable to each registration.

Required columns:

- `uuid UUID PRIMARY KEY`
- `year SMALLINT NOT NULL`
- `member_category SMALLINT NULL` — NULL means applicable to all categories
- `label VARCHAR(255) NOT NULL` — snapshot label copied to accounting writings
- `amount NUMERIC(12,2) NOT NULL`
- `is_active BOOLEAN NOT NULL DEFAULT TRUE`
- `sort_order SMALLINT NOT NULL DEFAULT 0` — display order in UI and writing generation order
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_by INTEGER NULL`

Constraints:

- `amount >= 0`
- check valid `member_category` when not null

References:

- `updated_by` references `users.id`

Notes:

- multiple rows may share the same year (one row per fee line, e.g. membership fee + insurance + licence)
- rows are selected at registration time by matching `year` and `member_category` (or `member_category IS NULL`)
- once a registration has been executed for a year, modifying the price list for that year has no retroactive effect

### Table: `accounting_writings`

Immutable ledger rows produced by registration events.

Required columns:

- `uuid UUID PRIMARY KEY`
- `member_registration_uuid UUID NOT NULL`
- `member_uuid UUID NOT NULL`
- `account_id VARCHAR(32) NOT NULL` — snapshot of member account_id at registration time
- `year SMALLINT NOT NULL`
- `label VARCHAR(255) NOT NULL` — snapshot of price_list.label
- `amount NUMERIC(12,2) NOT NULL`
- `is_reversal BOOLEAN NOT NULL DEFAULT FALSE`
- `reversed_writing_uuid UUID NULL` — filled for reversal rows only
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `created_by INTEGER NOT NULL`

Constraints:

- `amount >= 0`

References:

- `member_registration_uuid` references `member_registrations.uuid`
- `member_uuid` references `members.uuid`
- `reversed_writing_uuid` references `accounting_writings.uuid`
- `created_by` references `users.id`

Notes:

- rows are never updated or deleted; corrections produce reversal rows
- the `account_id` snapshot ensures the ledger remains coherent even if the member record changes

## Account ID Rules

`account_id` is the stable business key for members and must also be used by the ledger.

Generation rules:

- prefix is always `ME`
- year segment uses the creation year
- sequence is 4 digits minimum
- example: `ME2026-0001`

Behavior:

- generated automatically if not provided
- must be unique
- may be manually edited by authorized backend logic
- must remain immutable for normal member self-service operations

## Registration Rules

### Current-Year Registration Summary (`registration_status`)

`registration_status` on `members` is a compatibility summary derived from registration rows for the relevant year.

Rules:

- draft members can exist without committee assignment
- a member cannot have a year marked `Completed` unless at least one committee membership exists for the relevant registration year
- yearly committee membership should be renewed explicitly, not inferred forever from previous years
- admin reversal is done by changing the year registration row status; the member summary field follows that mutation

### Annual Re-Registration Workflow

Each year, active members who were previously fully registered must go through the annual re-registration workflow unless an existing active registration period already overlaps the target year.

This workflow is distinct from the initial member lifecycle and may be triggered by authorised staff at any point during the year.

#### Preconditions

The following must be true before a yearly registration is accepted:

- member `status` is `Active`
- no active `member_registrations` period already covers the exact same `(member_uuid, start_date, end_date)`
- at least one committee membership exists for the target year
- at least one active `price_list` row exists for the target year (matching the member's category or universal)

#### Workflow Steps (atomic transaction)

1. **Resolve applicable price list entries** — select all active `price_list` rows where `year = target_year` and (`member_category = member.member_category` OR `member_category IS NULL`), ordered by `sort_order`.
2. **Create `member_registrations` row** — records `start_date`, `end_date`, `registered_for_year`, `registration_type`, `registered_by`, and `registered_at`.
3. **Create `accounting_writings` rows** — one row per resolved price list entry, snapshotting `label`, `amount`, and `account_id`.
4. **Create or confirm `member_sheets` row** — if `can_fly = true` and no sheet exists for `(member_uuid, year)`, create it with default values.
5. **Update compatibility fields** — set `members.last_registration_year` to the latest target year and recompute the summary `members.registration_status` from the target year registration rows.

All five steps execute inside a single database transaction. If any step fails, the entire workflow rolls back.

#### Post-conditions

- one active `member_registrations` period exists
- one or more `accounting_writings` rows exist
- if `can_fly`, one `member_sheets` row exists for the year
- `members.last_registration_year` reflects the latest registered target year for compatibility only

#### Cancellation (v1.1, not in scope for v1)

Cancelling a registration produces reversal `accounting_writings` rows (one per original writing, with `is_reversal = true`) and changes the registration period status to `Cancelled`. The member sheet is not automatically deleted.

### Inactive Member Anonymization

Members with no active registration period for the configured number of full years are anonymized.

Configuration is stored in module settings:

- `members.anonymize_after_unregistered_years`
- default: `5`

Anonymization keeps the member row active for referential integrity and preserves `uuid` and `account_id`, but clears direct personal data such as email, phone, birth date, photo URL, FFVP id, and notes.

## Flying Rules

`can_fly` decides whether a member should have an active member sheet.

Guidelines:

- full members usually can fly
- temporary members usually can fly
- short-period members usually can fly
- external pilots may fly
- non-flying members usually cannot fly
- volunteers usually cannot fly unless explicitly enabled

Rules:

- if `can_fly = true`, the UI should expose member sheet management
- if `can_fly = false`, member sheet creation is optional and normally hidden

## Member Authentication Specification

Members are not ERP `users`.

V1 must prepare the schema and API for member access without coupling it to admin login.

Authentication scope:

- member login identifier: `account_id`
- member access is limited to their own profile summary and expense data
- admin/staff authentication remains managed by the existing `users` stack

Recommended v1 approach:

- add a dedicated member authentication table in a later step if login is implemented
- for now, prepare member sheet expense access via token-based external access fields

Not in scope for the first build:

- password reset workflow
- MFA for members
- shared auth between members and ERP staff

## Backend Specification

### File Layout

Recommended backend additions:

- `backend/api/routes/members.py`
- `backend/schemas/members.py`
- `backend/services/members.py`
- updates in `backend/models.py`
- router registration in `backend/main.py`

### Backend Responsibilities

The backend must provide:

- CRUD for members
- CRUD for committees
- yearly committee assignment management
- yearly member sheet management
- account id generation
- rule validation for incompatible flags
- validation that completed registration requires at least one committee

### API Endpoints

#### Members

- `GET /api/v1/members`
- `POST /api/v1/members`
- `GET /api/v1/members/{member_uuid}`
- `PATCH /api/v1/members/{member_uuid}`
- `POST /api/v1/members/{member_uuid}/complete-registration`

Filters for list endpoint:

- `search`
- `status`
- `member_category`
- `registration_status`
- `committee_uuid`
- `can_fly`
- `is_instructor`
- `is_employee`
- `is_executive`
- `is_board_member`
- `is_active`
- `year`
- `registration_state` — `registered` or `unregistered` for the selected year, based on active registration periods

#### Committees

- `GET /api/v1/committees`
- `POST /api/v1/committees`
- `GET /api/v1/committees/{committee_uuid}`
- `PATCH /api/v1/committees/{committee_uuid}`
- `PUT /api/v1/committees/{committee_uuid}/members/{year}`

#### Member Sheets

- `GET /api/v1/members/{member_uuid}/sheets`
- `GET /api/v1/members/{member_uuid}/sheets/{year}`
- `PUT /api/v1/members/{member_uuid}/sheets/{year}`
- `POST /api/v1/members/{member_uuid}/sheets/{year}/expense-access`
- `DELETE /api/v1/members/{member_uuid}/sheets/{year}/expense-access`

#### Annual Registrations

- `POST /api/v1/members/{member_uuid}/complete-registration` — validate committee membership and create a registration period
- `POST /api/v1/members/{member_uuid}/registrations` — create a dated registration period
- `GET /api/v1/members/{member_uuid}/registrations` — list all registration periods for a member
- `PATCH /api/v1/members/{member_uuid}/registrations/{registration_uuid}` — update period dates/status/notes
- `POST /api/v1/members/anonymize-inactive` — anonymize members after the configured number of unregistered full years

#### Price List

- `GET /api/v1/price-list` — list all entries (filter: `year`, `member_category`, `is_active`)
- `POST /api/v1/price-list` — create a new price list entry
- `GET /api/v1/price-list/{uuid}` — retrieve a single entry
- `PATCH /api/v1/price-list/{uuid}` — update label, amount, sort_order, is_active
- `DELETE /api/v1/price-list/{uuid}` — soft-delete (sets `is_active = false`) only if no registration has used it yet

#### Accounting Writings

- `GET /api/v1/accounting-writings` — list all writings (filter: `member_uuid`, `year`, `is_reversal`)
- `GET /api/v1/members/{member_uuid}/accounting-writings` — writings scoped to one member

### Validation Rules

The service layer must enforce:

- unique `account_id`
- unique email if provided
- unique FFVP id if provided
- `is_employee` cannot be combined with `is_executive`
- `is_employee` cannot be combined with `is_board_member`
- registration completion requires at least one committee membership for the target year
- registration period end date must be on or after start date
- registered/unregistered list filters must be based on active registration-period overlap with the selected year
- member sheet uniqueness by member and year
- negative hours and pack counts are rejected

### Response Shapes

Member list response should include:

- identity summary
- category
- flags
- active/status fields
- registration status
- current committee count
- current year member sheet availability
- selected-year registration availability

Member detail response should include:

- all editable fields
- yearly committee assignments
- yearly member sheets
- dated registration periods

## Frontend Specification

### File Layout

Create a dedicated module:

- `frontend/src/modules/members/index.ts`
- `frontend/src/modules/members/api/index.ts`
- `frontend/src/modules/members/components/MembersPage.tsx`
- `frontend/src/modules/members/components/MemberForm.tsx`
- `frontend/src/modules/members/components/MemberDetail.tsx`
- `frontend/src/modules/members/components/CommitteePanel.tsx`
- `frontend/src/modules/members/components/MemberSheetPanel.tsx`
- `frontend/src/modules/members/components/RegistrationPanel.tsx`
- `frontend/src/modules/members/components/AccountingWritingsPanel.tsx`
- `frontend/src/modules/members/types/index.ts`
- `frontend/src/modules/members/store/index.ts` if needed

Create a dedicated price-list module:

- `frontend/src/modules/price-list/index.ts`
- `frontend/src/modules/price-list/api/index.ts`
- `frontend/src/modules/price-list/components/PriceListPage.tsx`
- `frontend/src/modules/price-list/components/PriceListForm.tsx`
- `frontend/src/modules/price-list/types/index.ts`

The shell must only import from `frontend/src/modules/members/index.ts`.

### UI Scope

The first version should include one module page with six major areas:

1. member list and filters
2. create or edit member form
3. committee management
4. yearly member sheet management
5. annual registration panel
6. accounting writings panel (read-only)

The price list is a separate admin page in the shell navigation.

### Members List

Display:

- name
- account id
- category
- role flags
- status
- registration status
- can fly
- committee count

Capabilities:

- free text search
- filter chips or selects
- create member
- edit member
- open member detail
- quick active toggle if allowed
- visual indicator when a member is not registered for the selected year, based on active registration periods

### Member Form

Sections:

- identity
- contact
- membership classification
- operational roles
- registration
- notes

Fields:

- first name
- last name
- gender
- date of birth
- email
- phone
- member category
- FFVP id
- account id
- can fly
- instructor flag
- employee flag
- executive flag
- board flag
- active flag
- status
- registration status
- notes

Behavior:

- account id auto-filled on create but editable for authorized staff
- role incompatibilities shown inline before submit
- committee assignment UI required only when registration is being completed
- member sheet panel shown only when `can_fly = true`

### Committee UI

Must support:

- create committee
- edit committee
- select manager
- assign members by year
- review yearly assignments

### Member Sheet UI

Must support:

- create or update annual sheet
- edit licence number
- edit fare type
- edit hours and pack fields
- enable or disable expense access

### Registration Panel UI

Displayed in the member detail view. Must support:

- list all yearly registrations for the member (year, registered_at, registered_by, number of writings)
- action button "Register for YYYY" — enabled only when preconditions are met
- confirmation dialog showing the resolved price list entries and total amount before executing
- after execution: refresh the list, sheet panel, and member header
- display of the accounting writings produced by each registration (read-only table)

### Price List Page UI

Stand-alone page in the shell navigation under administration:

- list price list entries with year filter
- create entry form (year, member_category, label, amount, sort_order)
- inline edit for amount, label, sort_order, is_active
- delete (soft) with guard when entries have been used in registrations
- bulk duplicate: copy all entries from year N to year N+1

## Permissions

The detailed capability model can be added later, but the backend should already separate read and write concerns.

Recommended future capabilities:

- `members.read`
- `members.write`
- `members.committees.write`
- `members.sheets.write`
- `members.expense_access.write`

## Test Specification

### Backend Tests

Must cover:

- member creation with generated account id
- member creation with manual account id
- duplicate account id rejection
- duplicate email rejection when email is present
- duplicate FFVP id rejection when FFVP id is present
- employee plus executive rejection
- employee plus board rejection
- registration completion blocked without committee
- registration completion success with committee
- one member sheet per year
- negative hours rejection

### Frontend Tests

Must cover:

- list rendering
- filter behavior
- create member form validation
- role incompatibility messaging
- committee requirement on completion
- conditional display of member sheet panel

## Delivery Order

1. create `docs/members.sql` — includes `members`, `committees`, `committee_members`, `member_sheets`, `member_registrations`, `price_list`, `accounting_writings`
2. add SQLAlchemy models
3. add backend schemas and services
   a. member CRUD service
   b. price list service
   c. registration service (atomic workflow)
   d. accounting writings read service
4. add members routes and route registration
   a. members router
   b. price-list router
   c. registrations router
   d. accounting-writings router
5. build frontend members module
   a. members list and form
   b. committee panel
   c. member sheet panel
   d. registration panel
   e. accounting writings panel (read-only)
6. build frontend price-list module
7. connect both modules into shell navigation and routing
8. add tests and seed data

## CSV Bulk Import

### Endpoint

`POST /api/v1/members/import`

- Requires `MANAGE_USERS` capability.
- Accepts `multipart/form-data` with a single `file` field (`.csv`).
- Encoding: UTF-8 (with or without BOM) or latin-1; auto-detected.

### CSV Format

See `docs/members-sample.csv` for a reference file.

**Required columns:** `first_name`, `last_name`, `member_category`

**Optional columns:** `genre`, `email`, `phone`, `date_of_birth` (YYYY-MM-DD), `status`, `registration_status`, `is_instructor`, `can_fly`, `ffvp_id`, `account_id`, `seniority`, `is_employee`, `is_executive`, `is_board_member`, `external_auth_enabled`

**Enum values accepted (case-insensitive):**

| Column | Accepted values |
|---|---|
| `member_category` | `1`/`pilote`, `2`/`stagiaire`, `3`/`passager`, `4`/`mécanicien`, `5`/`admin` |
| `genre` | `M`/`male`/`homme`, `F`/`female`/`femme` |
| `status` | `1`/`active`/`actif`, `2`/`inactive`/`inactif`, `3`/`suspended`/`suspendu` |
| `registration_status` | `0`/`none`/`aucun`, `1`/`pending`/`en attente`, `2`/`complete`/`complet`, `3`/`expired`/`expiré` |
| Boolean columns | `true`/`false`/`oui`/`non`/`1`/`0` |

### Behavior

- Each row is validated independently; errors in one row do not block other rows.
- A row that fails validation is **skipped** (not created) and its error is reported.
- A row where the `account_id` or `email` already exists is skipped (duplicate).
- No dry-run mode; rows that pass are committed immediately.

### Response

```json
{
  "created": 2,
  "skipped": 1,
  "errors": [
    { "row": 3, "field": "member_category", "message": "Unknown member_category value: 'inconnu'" }
  ]
}
```

## Open Follow-Ups

These are not blockers for v1 but should be clarified later:

- whether anonymized members keep their ledger identity visible in reports
- whether committee budgets belong in this module or a finance module
- whether external pilots need additional federation metadata
- whether member expense access should be token-only or password-based in v1.1
- exact price list structure: are insurance and FFVP fees separate line items or rolled into one?
- whether a member can be registered for a past year (back-registration) and if so what validation applies
- whether accounting writings feed directly into a future general ledger module or remain standalone
- cancellation/reversal workflow priority for v1.1

---

## Members UX V2 – Directory First

This section defines the V2 frontend redesign requirements. It supersedes the v1 frontend spec above for the members route and adds the Committees Management route. Backend contracts remain unchanged unless noted under "Backend changes required."

### Canonical Routes

| Route | Component | Nav label |
|---|---|---|
| `/members` | `MembersListPage` | MEMBERS |
| `/commissions` | `CommitteesManagementPage` | COMMISSIONS |

`MembersPage` is the legacy migration source. It must not be added to routing; its useful logic (committee forms, roster, sheet panels) must be migrated to the new components before removal.

---

### Members Directory (`/members`)

#### Page header
- Title: "Members Directory", subtitle: "Manage member categories, operational status, and current-year registration state."
- Actions (top-right): `Export CSV` button, `Add New Member` primary button.

#### KPI strip
Four tiles derived client-side from the loaded list query result. No separate backend aggregate endpoint.

| Tile | Derivation | Highlight color |
|---|---|---|
| Total Members | `members.length` | neutral |
| Pending Renewals | `members` where `last_registration_year < selectedYear && status === 1` | orange |
| Active Instructors | `members` where `is_instructor && status === 1` | neutral |
| Guest / Temp Passes | `members` where `member_category === 2` | neutral |

KPI values are recalculated whenever the query result changes.

#### Filter bar
- Full-width text search input (searches name, account_id, email) — maps to `search` filter param.
- Quick filter: Category (select) — maps to `member_category`.
- Quick filter: Operational status (select) — maps to `status`.
- Quick filter: Role (select for instructor / employee / executive / board) — maps to role flag params.
- Quick filter: Can Fly (toggle) — maps to `can_fly`.
- Advanced filter icon — opens a side drawer exposing: `registration_status`, all four role flags, `committee_uuid`, `year`, and any secondary operational filters.
- Rule: `registration_status` filter only shown when `year` is also set; inline guidance shown otherwise.
- Backend errors from filter queries must surface inline below the filter bar.

#### Directory table

A density table (`<table>` element, not a card list). Columns:

| Column | Source | Notes |
|---|---|---|
| NAME & ID | `first_name`, `last_name`, `account_id` | Initials avatar (no photo), account_id in monospace sub-label. ⚠ warning triangle if `last_registration_year < selectedYear && status === 1`. Optional left-border stripe for members with renewal issues. |
| CATEGORY | `member_category` | Plain text label from `memberCategoryLabel()`. |
| ROLE FLAGS | `is_instructor`, `is_employee`, `is_executive`, `is_board_member` | Colored compact tags. Show "NO ROLES" in muted text when all flags are false. |
| OPERATIONAL STATUS | `status` | Badge: Active (green), Suspended (red), Resigned (muted), Anonymized (muted). |
| REGISTRATION | `registration_status`, `has_member_sheet_for_year` | Year-aware badge: ✅ COMPLETED, ⏳ DRAFT, ⏸ IN PROGRESS, 🗄 ARCHIVED. |
| COMMISSION | `committee_codes` | Compact code badge(s) for current year (e.g. SAFETY, EVENTS). Empty cell if unassigned. See backend note below. |
| ACTIONS | — | Pencil icon → edit drawer. Kebab menu → "Finalize Registration", "View Sheet", other future actions. |

Responsive: ROLE FLAGS and COMMISSION columns collapse on mobile.

#### Pagination footer
- "Showing X to Y of N members" + page navigation.
- If backend exposes `limit`/`offset` params, wire server-side pagination. Otherwise client-side at page size 25.

#### Directory legend
- Color key strip at the bottom of the page: Active / Suspended / Renewal Required / Can Fly.

#### Acceptance criteria
- Table renders all columns with correct data for each member in the query result.
- KPI tiles update when filters change.
- ⚠ indicator appears for every member where `last_registration_year < selectedYear && status === 1`.
- Clicking pencil opens the member edit drawer; lifecycle state is derived from `status` and is never sent as a separate boolean field.
- Kebab menu "Finalize Registration" opens the Registration Panel.
- After successful registration, the row's REGISTRATION and COMMISSION badges update without full page reload.

---

### Registration Panel (slide-over)

Triggered by "Finalize Registration" from a row kebab menu. Implemented as a shadcn `Sheet` (right slide-over), not a modal, so the directory remains visible behind it.

#### Member header
- Initials avatar, full name, lifecycle badge (e.g. RENEWAL REQUIRED), "Member since [month year]" from `created_at`, "Last Activity" placeholder.

#### Step 1 – Administrative Checklist
- Informational only in V2 (does not block the backend).
- Static items with status chips derived from member data:
  - Medical Certificate (Class 2) — chip: VALID / PENDING INPUT (based on presence/expiry data in V2)
  - FFVP License Number — chip: PENDING INPUT if `ffvp_id` is null, else VALID
  - Identity Document — chip: VERIFIED (static placeholder in V2)

#### Step 2 – Fare Selection (REQUIRED)
- Fetch applicable pricing items for `selectedYear` and the member's `member_category` via existing pricing API.
- Render as a table: Description | Category | Amount | Select (checkbox).
- Compute TOTAL AMOUNT DUE client-side using `decimal.js`.
- At least one item must be checked for VALIDATE to be enabled.

#### Step 3 – Accounting Preview (read-only)
- Derive draft GL lines from selected fare items using the member's `account_id` and GL account mappings.
- Columns: ACCOUNT | DEBIT | CREDIT.
- Show a generated Invoice Reference preview (e.g. `INV-{YEAR}-{account_id}`).
- This panel is informational; the actual GL entries are created by the backend during `complete-registration`.

#### Step 4 – Committee Selection (MANDATORY)
- Label: "Choix de Commission". Sub-label: "Members are required to participate in at least one working committee to support club operations." Badge: MANDATORY.
- Fetch active committees via `useCommitteesQuery(activeOnly: true)`.
- Render as a card grid: committee icon (emoji or generic), code, name, short description. Cards are selectable (toggle selection on click).
- At least one card must be selected for VALIDATE to be enabled.

#### Footer
- Left: CANCEL button (closes panel, no mutation).
- Center: Effective Date input (date picker, defaults to today).
- Right: **VALIDATE & ACTIVATE REGISTRATION** primary button — disabled until Step 2 (fare) AND Step 4 (committee) are both satisfied.

#### Submit sequence
1. Call `useCompleteRegistrationMutation` with `{ year, template_uuid, selected_item_uuids }`.
2. On success, for each selected committee UUID call `useReplaceCommitteeMembersMutation` (add this member to the existing roster).
3. Invalidate `membersQueryKeys.root` and `membersQueryKeys.committees`.
4. Close panel.

#### Acceptance criteria
- VALIDATE button is disabled when no fare is selected.
- VALIDATE button is disabled when no committee is selected.
- Deselecting all fares or all committees disables VALIDATE again.
- Successful submit updates the row REGISTRATION badge to COMPLETED and COMMISSION badge to the selected committee code(s).
- Backend errors surface inline in the panel footer, not as a toast only.

---

### Committees Management (`/commissions`)

Standalone routed page. Accessible from the shell sidebar as COMMISSIONS.

#### Page header
- Title: "Committees Management", subtitle: "Manage operational working groups and active year assignments."
- Actions (top-right): `Add Committee` primary button → opens create committee drawer.

#### Card grid (active committees)
- One card per active committee from `useCommitteesQuery(activeOnly: true)`.
- Card contents: code badge (colored), committee name, description, active member count for `selectedYear`, member avatar stack (initials of first 3–4 members), status badge (ACTIVE / INACTIVE), alert badge if applicable (e.g. "5 Pending Reports" — placeholder in V2).
- Actions per card: "Manage Roster" → opens `CommitteeRosterDrawer`; "View All" → scrolls to table row.

#### Administrative Overview table
- Columns: Code | Committee Name | Manager | Last Meeting | Budget Status | Actions.
- Source: `useCommitteesQuery()`.
- "Manager" column: resolve manager name from `manager_member_uuid` using the loaded members list.
- "Last Meeting": placeholder field — display "—" until backend exposes `last_meeting_date`.
- "Budget Status": derive from `budget_amount` presence — "ON TRACK" if set, "—" if null.
- Row Actions: edit icon → opens edit committee drawer; roster icon → opens roster drawer.
- Table header actions: `Export CSV` (client-side from query data), `Print Summary` (`window.print()`).

#### Committee Roster Drawer (`CommitteeRosterDrawer`)
- Triggered from card "Manage Roster" or table row action.
- Header: committee name + current year.
- Multi-select member list (checkbox per member, filtered to members with `status = 1`).
- Pre-selects current roster from `useCommitteeMembersQuery(committeeUuid, selectedYear)`.
- Save calls `useReplaceCommitteeMembersMutation`.

#### Acceptance criteria
- `/commissions` route renders without redirecting to `/members`.
- Card grid shows all active committees with correct member counts.
- Manage Roster drawer pre-populates current year assignments and saves correctly.
- Add Committee creates a new committee and it appears in both the card grid and the table.
- Edit committee updates the table row without full page reload.
- Export CSV produces a valid CSV of the committee list.

---

### Lifecycle Governance

Member lifecycle state is controlled by `status` and `registration_status` only.

Rules:
- Member edit drawer must not expose a separate active/inactive boolean.
- Routed forms and legacy migration surfaces must not include `is_active` in create or update payloads.
- Registration flows update lifecycle state via status fields, not through a dedicated boolean toggle.

Acceptance criterion: no UI path in V2 allows sending `is_active` for members.

---

### Backend Changes Required for V2

| Change | Priority | Reason |
|---|---|---|
| Add `committee_codes: string[]` to `MemberSummary` response (list of committee codes assigned to the member for the requested year) | High | Needed for COMMISSION column without per-row detail fetches. Requires a `year` query param on `GET /api/v1/members` or a JOIN in the list query. |
| Clarify whether `complete-registration` accepts `committee_uuids` atomically or whether committee roster assignment is always a separate call | Medium | Determines submit sequence in the Registration Panel. |
| Add `last_meeting_date DATE NULL` to `committees` table | Low | Needed for the Administrative Overview table "Last Meeting" column (V2.1). |

Until `committee_codes` is available on the list endpoint, the COMMISSION column falls back to showing a generic "✓" badge when `committee_count > 0` and is left empty otherwise.
