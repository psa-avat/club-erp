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

1. Full member, temporary member, non-flying member, short-period member, external pilot, and volunteer are all member categories that must be stored.
2. Instructor, employee, executive, and board are role flags, not the primary member type.
3. Committee membership is enforced after registration completion, not at draft creation time.
4. Member authentication is specific to members and separate from ERP staff authentication. `account_id` is also used as the ledger identity.

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
- a member category
- zero or more operational role flags
- contact and identity fields
- lifecycle state
- registration completion state

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

### 6. Member Registration (yearly)

The yearly registration is a distinct workflow that runs once per member per calendar year.

It is separate from `registration_status`, which tracks the overall member lifecycle (draft → completed).

A yearly registration record:

- marks the member as registered for a given year
- triggers the creation of accounting writings based on the applicable price list entries
- creates or confirms the member sheet for that year if `can_fly = true`
- records who performed the registration and when

Only one registration record may exist per `(member_uuid, year)` pair.

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
- `is_active BOOLEAN NOT NULL DEFAULT TRUE`
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

- `account_id` format: `ME<YEAR>-<NNNN>`
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

Tracks one yearly registration event per member.

Required columns:

- `uuid UUID PRIMARY KEY`
- `member_uuid UUID NOT NULL`
- `year SMALLINT NOT NULL`
- `registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `registered_by INTEGER NOT NULL`
- `notes TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Constraints:

- unique on `(member_uuid, year)` — only one registration per member per year

References:

- `member_uuid` references `members.uuid`
- `registered_by` references `users.id`

Notes:

- creating this row triggers generation of `accounting_writings` and creation/confirmation of `member_sheets`
- the row itself is immutable; corrections require a reversal workflow (v1.1)

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

### Member Lifecycle Registration (`registration_status`)

Registration completion is tracked with `registration_status` on the `members` table.

Rules:

- draft members can exist without committee assignment
- a member cannot be marked `Completed` unless at least one committee membership exists for the relevant registration year
- yearly committee membership should be renewed explicitly, not inferred forever from previous years

### Annual Re-Registration Workflow

Each year, active members who were previously fully registered must go through the annual re-registration workflow.

This workflow is distinct from the initial member lifecycle and may be triggered by authorised staff at any point during the year.

#### Preconditions

The following must be true before a yearly registration is accepted:

- member `status` is `Active`
- member `registration_status` is `Completed`
- no `member_registrations` row exists for `(member_uuid, current_year)`
- at least one active `price_list` row exists for the target year (matching the member's category or universal)

#### Workflow Steps (atomic transaction)

1. **Resolve applicable price list entries** — select all active `price_list` rows where `year = target_year` and (`member_category = member.member_category` OR `member_category IS NULL`), ordered by `sort_order`.
2. **Create `member_registrations` row** — records the event with `year`, `registered_by`, and `registered_at`.
3. **Create `accounting_writings` rows** — one row per resolved price list entry, snapshotting `label`, `amount`, and `account_id`.
4. **Create or confirm `member_sheets` row** — if `can_fly = true` and no sheet exists for `(member_uuid, year)`, create it with default values.
5. **Update `members.last_registration_year`** — set to the target year.

All five steps execute inside a single database transaction. If any step fails, the entire workflow rolls back.

#### Post-conditions

- one `member_registrations` row exists for the year
- one or more `accounting_writings` rows exist
- if `can_fly`, one `member_sheets` row exists for the year
- `members.last_registration_year` reflects the current year

#### Cancellation (v1.1, not in scope for v1)

Cancelling a registration produces reversal `accounting_writings` rows (one per original writing, with `is_reversal = true`) and removes the `member_registrations` row. The member sheet is not automatically deleted.

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
- `last_registration_year` — filter by year of last registration

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

- `POST /api/v1/members/{member_uuid}/registrations` — execute the annual registration workflow for a given year (body: `{ "year": 2026 }`)
- `GET /api/v1/members/{member_uuid}/registrations` — list all yearly registration records for a member
- `GET /api/v1/members/{member_uuid}/registrations/{year}` — detail of one yearly registration including its accounting writings

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

Member detail response should include:

- all editable fields
- yearly committee assignments
- yearly member sheets

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
- visual indicator when a member is not yet registered for the current year (`last_registration_year < current_year`)

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
