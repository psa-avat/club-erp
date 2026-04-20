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

Registration completion is tracked with `registration_status`.

Rules:

- draft members can exist without committee assignment
- a member cannot be marked `Completed` unless at least one committee membership exists for the relevant registration year
- yearly committee membership should be renewed explicitly, not inferred forever from previous years

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
- `frontend/src/modules/members/types/index.ts`
- `frontend/src/modules/members/store/index.ts` if needed

The shell must only import from `frontend/src/modules/members/index.ts`.

### UI Scope

The first version should include one module page with four major areas:

1. member list and filters
2. create or edit member form
3. committee management
4. yearly member sheet management

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

1. create `docs/members.sql`
2. add SQLAlchemy models
3. add backend schemas and services
4. add members routes and route registration
5. build frontend members module
6. connect module into shell navigation and routing
7. add tests and seed data

## Open Follow-Ups

These are not blockers for v1 but should be clarified later:

- whether anonymized members keep their ledger identity visible in reports
- whether committee budgets belong in this module or a finance module
- whether external pilots need additional federation metadata
- whether member expense access should be token-only or password-based in v1.1
