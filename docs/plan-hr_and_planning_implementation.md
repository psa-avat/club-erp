# Plan 053 — RH & Planning d'Activité (amended)

## Purpose

Implement Human Resources, leave workflows, attendance tracking, and committee-driven activity planning in the existing Club ERP architecture.

This amended plan replaces the generic `users`/`org_committees` proposal with a repo-specific design that works with the current codebase:

- Backend: FastAPI + async SQLAlchemy + Pydantic.
- Frontend: React/Vite TypeScript, not Flutter.
- Committees already exist as `committees` and `committee_members` in the members module.
- The existing `RhWorkspacePage` and `PlanningPage` are placeholders and should become the UI entry points.
- Members, not auth users, are the club's operational people ledger. `users` remain authentication/audit actors.

## Current Code Reality

Already implemented:

- `Member.is_employee`, `Member.is_instructor`, `Member.can_fly`, `Member.is_executive`, `Member.is_board_member`.
- `committees` and `committee_members`, keyed by `member_uuid` and `membership_year`.
- Committee CRUD and roster endpoints under `/api/v1/members/committees`.
- `RhWorkspacePage` with tabs `conges`, `presences`, `equipe`.
- `PlanningPage` with a placeholder calendar tab.
- Navigation routes `/workspace/rh` and `/planning`.

Do not create duplicate `org_committees` tables. Extend the existing committee model only if a real missing field is needed.

## Scope

### V1

- Employee HR profiles linked to `members.uuid`.
- Leave requests with approval workflow.
- Attendance/work sessions for employees and volunteers.
- Planning activities linked to existing committees.
- Conflict checks between approved leave and confirmed activities.
- RH workspace UI for leave, attendance, and team profiles.
- Planning workspace UI for calendar/list of club activities.

### V2

- PlancheDeVol hard-block integration when assigning unavailable instructors.
- Document attachments/checklists through existing storage service.
- Leave balance/accrual engine for CP/RTT.
- Recurring activities and shift templates.

## Migration

Use the next migration number after the current planning docs. If `052_bank_reconciliation.sql` is implemented first, use:

`docs/migrations/053_hr_planning.sql`

Use `gen_random_uuid()` consistently with existing migrations.

```sql
-- ==========================================================================
-- HR employee profiles
-- ==========================================================================
CREATE TABLE hr_employee_profiles (
    member_uuid UUID PRIMARY KEY REFERENCES members(uuid) ON DELETE RESTRICT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    contract_type VARCHAR(16) NOT NULL,
    hire_date DATE NOT NULL,
    termination_date DATE,
    weekly_hours NUMERIC(5,2) NOT NULL DEFAULT 35.00,
    leave_allowance_days NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_hr_contract_type CHECK (contract_type IN ('CDI', 'CDD', 'SAISONNIER', 'VACATAIRE', 'BENEVOLE')),
    CONSTRAINT chk_hr_profile_dates CHECK (termination_date IS NULL OR termination_date >= hire_date),
    CONSTRAINT chk_hr_weekly_hours CHECK (weekly_hours >= 0)
);

CREATE INDEX idx_hr_employee_profiles_user ON hr_employee_profiles(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_hr_employee_profiles_active ON hr_employee_profiles(is_active);

-- ==========================================================================
-- Leave requests
-- ==========================================================================
CREATE TABLE hr_leave_requests (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE RESTRICT,
    leave_type VARCHAR(16) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_half_day SMALLINT NOT NULL DEFAULT 0,
    end_half_day SMALLINT NOT NULL DEFAULT 0,
    total_days_deducted NUMERIC(5,2) NOT NULL DEFAULT 0,
    workflow_state SMALLINT NOT NULL DEFAULT 1,
    reason_notes TEXT,
    reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_hr_leave_type CHECK (leave_type IN ('CP', 'RTT', 'MALADIE', 'SANS_SOLDE', 'FORMATION', 'AUTRE')),
    CONSTRAINT chk_hr_leave_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_hr_leave_half_day_start CHECK (start_half_day IN (0, 1, 2)),
    CONSTRAINT chk_hr_leave_half_day_end CHECK (end_half_day IN (0, 1, 2)),
    CONSTRAINT chk_hr_leave_state CHECK (workflow_state IN (1, 2, 3, 4, 5)),
    CONSTRAINT chk_hr_leave_days CHECK (total_days_deducted >= 0)
);

-- 1=Draft, 2=Submitted, 3=Approved, 4=Rejected, 5=Cancelled
CREATE INDEX idx_hr_leave_member_dates ON hr_leave_requests(member_uuid, start_date, end_date);
CREATE INDEX idx_hr_leave_state ON hr_leave_requests(workflow_state);
CREATE INDEX idx_hr_leave_period ON hr_leave_requests(start_date, end_date);

-- Fast lookup for overlap checks. Actual overlap prevention is enforced in services
-- on submit/approve because plain unique indexes only catch identical ranges.
CREATE INDEX idx_hr_leave_active_ranges
    ON hr_leave_requests(member_uuid, start_date, end_date)
    WHERE workflow_state IN (2, 3);

-- ==========================================================================
-- Attendance / time tracking
-- ==========================================================================
CREATE TABLE hr_attendance_entries (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE RESTRICT,
    work_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    duration_hours NUMERIC(5,2),
    attendance_type VARCHAR(16) NOT NULL DEFAULT 'PRESENCE',
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    notes TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_hr_attendance_type CHECK (attendance_type IN ('PRESENCE', 'ASTREINTE', 'FORMATION', 'BENEVOLAT', 'ABSENCE')),
    CONSTRAINT chk_hr_attendance_duration CHECK (duration_hours IS NULL OR duration_hours >= 0),
    CONSTRAINT chk_hr_attendance_time_order CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time)
);

CREATE INDEX idx_hr_attendance_member_date ON hr_attendance_entries(member_uuid, work_date);
CREATE INDEX idx_hr_attendance_date ON hr_attendance_entries(work_date);

-- ==========================================================================
-- Committee-driven activity planning
-- ==========================================================================
CREATE TABLE planning_activities (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    committee_uuid UUID REFERENCES committees(uuid) ON DELETE SET NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    activity_type VARCHAR(32) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    location VARCHAR(100),
    max_participants INTEGER,
    status SMALLINT NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_planning_activity_type CHECK (activity_type IN ('STAGE', 'MAINTENANCE', 'COURS_THEORIE', 'EVENEMENT', 'PERMANENCE', 'FORMATION', 'AUTRE')),
    CONSTRAINT chk_planning_activity_dates CHECK (ends_at > starts_at),
    CONSTRAINT chk_planning_activity_status CHECK (status IN (1, 2, 3))
);

-- 1=Draft, 2=Confirmed, 3=Cancelled
CREATE INDEX idx_planning_activities_period ON planning_activities(starts_at, ends_at);
CREATE INDEX idx_planning_activities_committee ON planning_activities(committee_uuid);
CREATE INDEX idx_planning_activities_status ON planning_activities(status);

CREATE TABLE planning_activity_participants (
    activity_uuid UUID NOT NULL REFERENCES planning_activities(uuid) ON DELETE CASCADE,
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    role_type VARCHAR(24) NOT NULL DEFAULT 'PARTICIPANT',
    status SMALLINT NOT NULL DEFAULT 1,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (activity_uuid, member_uuid),
    CONSTRAINT chk_planning_participant_role CHECK (role_type IN ('PARTICIPANT', 'ORGANISATEUR', 'INSTRUCTEUR', 'RESPONSABLE', 'BENEVOLE')),
    CONSTRAINT chk_planning_participant_status CHECK (status IN (1, 2, 3))
);

-- 1=Invited/Planned, 2=Confirmed, 3=Cancelled
CREATE INDEX idx_planning_participants_member ON planning_activity_participants(member_uuid);
```

Do not rely on a global `touch_updated_at()` trigger unless it exists in the target schema. Existing ORM models already use Python-side `onupdate` patterns; database triggers can be added later if the project standardizes them.

## Backend Models

Add models to `backend/models.py`:

- `HrEmployeeProfile`
- `HrLeaveRequest`
- `HrAttendanceEntry`
- `PlanningActivity`
- `PlanningActivityParticipant`

Relationships:

- HR profiles and leave entries link to `Member` through `member_uuid`.
- Optional `user_id` on profile links an employee/member to an auth account when one exists.
- Planning activities link to existing `Committee` through `committee_uuid`.
- Participants link activities to `Member`.
- `created_by`, `updated_by`, reviewer fields link to `User` for audit.

## Backend Schemas

Create:

- `backend/schemas/hr.py`
- `backend/schemas/planning.py`

Use integer states in responses and document meanings:

- Leave: `1=Draft`, `2=Submitted`, `3=Approved`, `4=Rejected`, `5=Cancelled`.
- Activity: `1=Draft`, `2=Confirmed`, `3=Cancelled`.
- Participant: `1=Planned`, `2=Confirmed`, `3=Cancelled`.

Use string enums only for stable domain labels such as `leave_type`, `contract_type`, `activity_type`, and `role_type`.

## Backend Services

Create:

- `backend/services/hr.py`
- `backend/services/planning.py`

Important service rules:

### HR

- A leave request can be edited by its owner only while `Draft`.
- A submitted request can be approved/rejected only by a user with HR/admin capability.
- Approved/rejected requests are immutable except cancellation through a dedicated endpoint.
- Overlap checks must run on submit and approve; use `idx_hr_leave_active_ranges` for fast lookups.
- `total_days_deducted` should be computed server-side where possible; the client may preview but should not be the source of truth.
- Member eligibility should derive from `Member.is_employee` and/or existing `HrEmployeeProfile.is_active`.

### Planning

- Activities can be created as Draft and later confirmed.
- Confirming an activity should run conflict checks against approved leave for assigned participants.
- Instructor-specific checks should use `Member.is_instructor` when role type is `INSTRUCTEUR`.
- Committee filters should use existing `committees.uuid`.
- Activities should not duplicate VI planning. VI remains in `frontend/src/modules/vi` and `/api/v1/vi`.

## API Routes

Add route modules:

- `backend/api/routes/hr.py`
- `backend/api/routes/planning.py`

Register them in `backend/api/routes/__init__.py` and `backend/main.py` using the existing import/include style.

Suggested endpoints:

```text
GET    /api/v1/hr/profiles
POST   /api/v1/hr/profiles
GET    /api/v1/hr/profiles/{member_uuid}
PATCH  /api/v1/hr/profiles/{member_uuid}

GET    /api/v1/hr/leaves
POST   /api/v1/hr/leaves
GET    /api/v1/hr/leaves/{leave_uuid}
PATCH  /api/v1/hr/leaves/{leave_uuid}
POST   /api/v1/hr/leaves/{leave_uuid}/submit
POST   /api/v1/hr/leaves/{leave_uuid}/approve
POST   /api/v1/hr/leaves/{leave_uuid}/reject
POST   /api/v1/hr/leaves/{leave_uuid}/cancel

GET    /api/v1/hr/attendance
POST   /api/v1/hr/attendance
PATCH  /api/v1/hr/attendance/{entry_uuid}
DELETE /api/v1/hr/attendance/{entry_uuid}

GET    /api/v1/planning/activities
POST   /api/v1/planning/activities
GET    /api/v1/planning/activities/{activity_uuid}
PATCH  /api/v1/planning/activities/{activity_uuid}
POST   /api/v1/planning/activities/{activity_uuid}/confirm
POST   /api/v1/planning/activities/{activity_uuid}/cancel
PUT    /api/v1/planning/activities/{activity_uuid}/participants
GET    /api/v1/planning/conflicts
```

Capabilities:

- Add constants such as `CAP_VIEW_HR`, `CAP_MANAGE_HR`, `CAP_VIEW_PLANNING`, `CAP_MANAGE_PLANNING` if the product needs separate permissions.
- Otherwise, for a first version, reuse `CAP_MANAGE_USERS` for HR admin and allow authenticated members to manage their own draft leave requests only.
- Planning management can be restricted to committee managers or `CAP_MANAGE_USERS` until a dedicated capability is seeded.

## Frontend Implementation

Use existing modules:

- `frontend/src/modules/rh`
- `frontend/src/modules/planning`

Do not introduce a separate framework or Flutter surface.

### RH Workspace

Replace placeholders in `RhWorkspacePage`:

- `conges`: leave calendar/list, request dialog/sheet, approval queue.
- `presences`: attendance table with date filters and employee selector.
- `equipe`: employee profiles and links to member records.

Add:

- `frontend/src/modules/rh/api/index.ts`
- `frontend/src/modules/rh/types.ts`
- `frontend/src/modules/rh/components/LeavePlanningPage.tsx`
- `frontend/src/modules/rh/components/AttendancePage.tsx`
- `frontend/src/modules/rh/components/TeamProfilesPage.tsx`

Use `WorkspaceShell`, existing shadcn components, and `useTranslation('rh')` or fix the current `common` namespace usage if keeping nested `common.workspace.rh` keys.

### Planning Workspace

Replace the placeholder in `PlanningPage` with tabs such as:

- `calendar`: activity calendar/list.
- `activities`: table of planned activities.
- `conflicts`: leave/activity conflict review.

Add:

- `frontend/src/modules/planning/api/index.ts`
- `frontend/src/modules/planning/types.ts`
- `frontend/src/modules/planning/components/PlanningCalendarPage.tsx`
- `frontend/src/modules/planning/components/PlanningActivitiesPage.tsx`
- `frontend/src/modules/planning/components/PlanningConflictsPage.tsx`

Use existing committee queries from the members module or add a small planning-side hook that calls `/api/v1/members/committees`.

## I18n

Current resources already contain `planning` and `rh` namespaces. Extend those namespaces rather than placing all text under `common`.

Add French and English keys for:

- HR profile labels.
- Leave states and action buttons.
- Attendance table and filters.
- Planning activity types/states.
- Conflict warnings.

Avoid hardcoded visible text in JSX.

## PlancheDeVol / Operational Conflict Hooks

V1 should expose a conflict-check endpoint but not hard-block Planche operations yet.

Conflict check inputs:

- `member_uuid`
- `date` or `starts_at` / `ends_at`
- optional `role_type`

Conflict sources:

- Approved leave (`hr_leave_requests.workflow_state = 3`).
- Confirmed planning activities where the member is already assigned.

V2 can integrate these checks into Planche synchronization or assignment flows once member/member_uuid mapping to Planche operational users is fully explicit.

## Execution Phases

### Phase 1: Backend Foundation

- Add migration `053_hr_planning.sql`.
- Add SQLAlchemy models and Pydantic schemas.
- Add service functions and route modules.
- Add basic tests for CRUD, state transitions, and overlap checks.

### Phase 2: HR Workspace

- Implement RH query hooks.
- Replace leave, attendance, and team placeholders.
- Add self-service draft leave creation and admin approval queue.

### Phase 3: Planning Workspace

- Implement planning query hooks.
- Replace planning placeholder with calendar/list.
- Add activity participants and conflict warnings.

### Phase 4: Operational Integration

- Add conflict badges to planning views.
- Expose Planche-facing conflict checks.
- Add storage/checklist support only if real workflow documents are required.

## Tests

Backend:

1. Create HR profile for an employee member.
2. Reject HR profile creation for unknown member.
3. Submit leave from Draft.
4. Approve/reject submitted leave with reviewer metadata.
5. Refuse edits to approved/rejected leave except dedicated cancellation.
6. Refuse overlapping submitted/approved leave for the same member.
7. Create activity linked to existing committee.
8. Assign instructor participant and detect approved leave conflict.
9. Confirm activity only after conflict warnings are handled according to service policy.
10. Verify non-HR user cannot approve another member's leave.

Frontend:

1. `/workspace/rh` renders real leave, attendance, and team tabs.
2. User-facing text comes from i18n.
3. Leave request create/submit/approve/reject flows update TanStack Query caches.
4. `/planning` renders activity calendar/list.
5. Committee filter uses existing committee data.
6. Conflict warnings are visible and do not overlap with table/calendar layout on mobile.

Verification commands:

```bash
backend/venv/bin/python -m pytest backend/tests
pnpm --filter @club-erp/web build
pnpm --filter @club-erp/web lint
```

## Explicit Non-Goals For V1

- No duplicate `org_committees` tables.
- No Flutter implementation.
- No direct mutation of Planche data from HR leave workflows.
- No payroll/accrual accounting automation.
- No document management unless backed by a concrete workflow.
