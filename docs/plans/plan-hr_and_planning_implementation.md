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
- **Declared activity** : employees declare their real activity (hours worked) ; a manager validates it.
- Planning activities linked to existing committees — committees create and manage club events/activities (stages, cours théorie, permanences, maintenance…), not individual people schedules.
- Conflict checks between approved leave and confirmed activities.
- RH workspace UI for leave, attendance, and team profiles.
- Planning workspace UI for the club activity/event calendar managed by committees.

### V2

- PlancheDeVol hard-block integration when assigning unavailable instructors.
- Document attachments/checklists through existing storage service.
- Auto-calculated leave balance engine (CP/RTT accrual).
- Recurring activities and shift templates.

## Migration

Migration 053–059 are already used. Use:

`docs/migrations/060_hr_planning.sql`

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
    annual_work_hours NUMERIC(6,2) NOT NULL DEFAULT 1607.00,
    current_leave_balance NUMERIC(5,2) NOT NULL DEFAULT 0,
    last_leave_balance_update DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_hr_contract_type CHECK (contract_type IN ('CDI', 'CDD', 'SAISONNIER', 'VACATAIRE', 'BENEVOLE')),
    CONSTRAINT chk_hr_profile_dates CHECK (termination_date IS NULL OR termination_date >= hire_date),
    CONSTRAINT chk_hr_weekly_hours CHECK (weekly_hours >= 0),
    CONSTRAINT chk_hr_annual_hours CHECK (annual_work_hours >= 0),
    CONSTRAINT chk_hr_leave_balance CHECK (current_leave_balance >= 0)
);

COMMENT ON COLUMN hr_employee_profiles.annual_work_hours IS 'Durée annuelle de référence (ex: 1607h pour un temps plein)';
COMMENT ON COLUMN hr_employee_profiles.current_leave_balance IS 'Solde actuel de jours de congés disponibles (CP/RTT)';
COMMENT ON COLUMN hr_employee_profiles.last_leave_balance_update IS 'Date de dernière mise à jour du solde (manuel en V1, auto en V2)';

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
-- Attendance / declared activity (time tracking with validation workflow)
-- ==========================================================================
-- Les employés déclarent leur activité réelle (heures travaillées) qui doit
-- être validée par un manager (même capacité que approve_leave).
-- Un jour déclaré et approuvé peut être utilisé pour comparer les heures
-- attendues (calendrier) vs les heures réellement effectuées.
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
    -- Validation workflow
    workflow_state SMALLINT NOT NULL DEFAULT 1,
    reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_hr_attendance_type CHECK (attendance_type IN ('PRESENCE', 'ASTREINTE', 'FORMATION', 'BENEVOLAT', 'ABSENCE')),
    CONSTRAINT chk_hr_attendance_duration CHECK (duration_hours IS NULL OR duration_hours >= 0),
    CONSTRAINT chk_hr_attendance_time_order CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time),
    CONSTRAINT chk_hr_attendance_state CHECK (workflow_state IN (1, 2, 3, 4))
);

-- 1=Draft, 2=Submitted, 3=Approved, 4=Rejected
COMMENT ON COLUMN hr_attendance_entries.workflow_state IS '1=Brouillon, 2=Soumis, 3=Approuvé, 4=Rejeté';
COMMENT ON COLUMN hr_attendance_entries.source IS 'Origine : manual (saisie employé), imported, planche, admin';

CREATE INDEX idx_hr_attendance_member_date ON hr_attendance_entries(member_uuid, work_date);
CREATE INDEX idx_hr_attendance_date ON hr_attendance_entries(work_date);
CREATE INDEX idx_hr_attendance_state ON hr_attendance_entries(workflow_state);

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

-- ==========================================================================
-- Work-time calendar & season management
-- ==========================================================================

-- Seasons : périodes d'activité du club (ex: "Basse saison", "Haute saison")
-- Chaque saison a un début et une fin, et sert à affecter un calendrier de travail.
CREATE TABLE hr_seasons (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_hr_season_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_hr_seasons_dates ON hr_seasons(start_date, end_date);

-- Calendriers de travail : pattern hebdomadaire type
-- Un calendrier définit, pour chaque jour de la semaine, si on travaille
-- et combien d'heures. On peut aussi définir un jour supplémentaire
-- sur une semaine spécifique du mois (ex: 1er samedi du mois).
CREATE TABLE hr_work_calendars (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Détail jour par jour d'un calendrier
CREATE TABLE hr_work_calendar_days (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_uuid UUID NOT NULL REFERENCES hr_work_calendars(uuid) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),  -- 1=Lundi … 7=Dimanche
    is_working BOOLEAN NOT NULL DEFAULT TRUE,
    expected_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
    start_time TIME,
    end_time TIME,
    -- 0=toutes les semaines, 1..5=N-ième semaine du mois (5=dernière)
    apply_on_week SMALLINT NOT NULL DEFAULT 0 CHECK (apply_on_week BETWEEN 0 AND 5),
    CONSTRAINT chk_hr_calendar_day_hours CHECK (expected_hours >= 0),
    UNIQUE (calendar_uuid, day_of_week, apply_on_week)
);

CREATE INDEX idx_hr_calendar_days_calendar ON hr_work_calendar_days(calendar_uuid);

-- Affectation : lie un employé + une saison + un calendrier
-- Une même saison peut avoir des calendriers différents selon l'employé.
-- Modèle constant = une seule affectation pour une saison couvrant toute l'année.
-- Modèle saisonnier = plusieurs affectations, une par saison.
CREATE TABLE hr_calendar_assignments (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_uuid UUID NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    season_uuid UUID NOT NULL REFERENCES hr_seasons(uuid) ON DELETE CASCADE,
    calendar_uuid UUID NOT NULL REFERENCES hr_work_calendars(uuid) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (member_uuid, season_uuid)
);

CREATE INDEX idx_hr_calendar_assignments_member ON hr_calendar_assignments(member_uuid);
CREATE INDEX idx_hr_calendar_assignments_season ON hr_calendar_assignments(season_uuid);
```

## Fonctionnement

### Saisons et affectations

Les saisons (`hr_seasons`) sont des ressources **globales du club** (ex : "Basse saison 2026", "Haute saison 2026"). Elles ne sont pas liées à un employé en particulier.

L'administrateur choisit ensuite **pour chaque employé** quelles saisons couvrent son planning de travail, et quel calendrier hebdomadaire s'applique pour chaque saison. Cette affectation (`hr_calendar_assignments`) est la pièce centrale : un employé doit avoir au moins une affectation pour que son planning soit défini.

Exemples de configurations possibles (non exhaustifs) :

- Un employé dont le temps de travail ne change pas dans l'année → affecté à **1 saison annuelle** (ex : `01/01 – 31/12`) avec 1 calendrier.
- Un employé dont le rythme change selon la saison → affecté à **plusieurs saisons** (ex : Basse / Intersaison / Haute), chacune avec son propre calendrier.

La même saison peut être partagée entre plusieurs employés. Chaque employé peut cependant utiliser un calendrier différent pour la même saison (un plein temps et un mi-temps peuvent être sur la même "Haute saison" avec des calendriers distincts).

La configuration concrète (noms des saisons, dates, heures, affectations) est entièrement gérée via l'interface `CalendarManagementPage`. Aucune valeur n'est codée en dur.

### Congés

Les congés ne sont **pas** prédéfinis dans le calendrier. Quand un congé est posé et approuvé (`hr_leave_requests`), il **neutralise** la partie correspondante du calendrier : les heures attendues passent à 0 pour les jours concernés.

Le calcul des heures travaillées attendues pour un employé sur une période suit cette logique :

```
heures_attendues = SUM(calendar_days) - SUM(leave_days_couverts)
```

### Résolution du calendrier pour un jour donné

Pour déterminer les heures attendues d'un employé un jour donné :

1. Trouver la saison qui couvre cette date (`hr_seasons.start_date ≤ date ≤ end_date`)
2. Trouver l'affectation pour cet employé + cette saison (`hr_calendar_assignments`)
3. Récupérer le calendrier et le jour correspondant (`hr_work_calendar_days` avec `day_of_week` et `apply_on_week` correspondant au N° de semaine du mois)
4. Si un congé approuvé couvre cette date → heures attendues = 0

Do not rely on a global `touch_updated_at()` trigger unless it exists in the target schema. Existing ORM models already use Python-side `onupdate` patterns; database triggers can be added later if the project standardizes them.

## Backend Models

Add models to `backend/models.py`:

- `HrEmployeeProfile`
- `HrLeaveRequest`
- `HrAttendanceEntry`
- `HrSeason`
- `HrWorkCalendar`
- `HrWorkCalendarDay`
- `HrCalendarAssignment`
- `PlanningActivity`
- `PlanningActivityParticipant`

Relationships:

- HR profiles and leave entries link to `Member` through `member_uuid`.
- Optional `user_id` on profile links an employee/member to an auth account when one exists.
- `HrCalendarAssignment` links `Member` → `HrSeason` → `HrWorkCalendar`.
- `HrWorkCalendarDay` belongs to `HrWorkCalendar`.
- Planning activities link to existing `Committee` through `committee_uuid`.
- Participants link activities to `Member`.
- `created_by`, `updated_by`, reviewer fields link to `User` for audit.

Model relationships sketch:

```python
class HrSeason(Base):
    __tablename__ = "hr_seasons"
    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(100), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    description = Column(String(255), nullable=True)
    # ...

class HrWorkCalendar(Base):
    __tablename__ = "hr_work_calendars"
    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    days = relationship("HrWorkCalendarDay", back_populates="calendar", cascade="all, delete-orphan")

class HrWorkCalendarDay(Base):
    __tablename__ = "hr_work_calendar_days"
    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    calendar_uuid = Column(ForeignKey("hr_work_calendars.uuid"), nullable=False)
    day_of_week = Column(SmallInteger, nullable=False)  # 1=Monday
    is_working = Column(Boolean, nullable=False, default=True)
    expected_hours = Column(Numeric(5,2), nullable=False, default=0)
    apply_on_week = Column(SmallInteger, nullable=False, default=0)
    calendar = relationship("HrWorkCalendar", back_populates="days")

class HrCalendarAssignment(Base):
    __tablename__ = "hr_calendar_assignments"
    uuid = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_uuid = Column(ForeignKey("members.uuid"), nullable=False)
    season_uuid = Column(ForeignKey("hr_seasons.uuid"), nullable=False)
    calendar_uuid = Column(ForeignKey("hr_work_calendars.uuid"), nullable=False)
    member = relationship("Member")
    season = relationship("HrSeason")
    calendar = relationship("HrWorkCalendar")
```

## Backend Schemas

Create:

- `backend/schemas/hr.py`
- `backend/schemas/planning.py`

Use integer states in responses and document meanings:

- Leave: `1=Draft`, `2=Submitted`, `3=Approved`, `4=Rejected`, `5=Cancelled`.
- Activity: `1=Draft`, `2=Confirmed`, `3=Cancelled`.
- Participant: `1=Planned`, `2=Confirmed`, `3=Cancelled`.

Use string enums only for stable domain labels such as `leave_type`, `contract_type`, `activity_type`, and `role_type`.

### Calendar schemas (in `hr.py`)

```python
from datetime import date, time
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field

class HrSeasonCreate(BaseModel):
    name: str = Field(..., max_length=100)
    start_date: date
    end_date: date
    description: str | None = None

class HrSeasonResponse(HrSeasonCreate):
    uuid: UUID
    # + timestamps

class HrWorkCalendarDayCreate(BaseModel):
    day_of_week: int = Field(..., ge=1, le=7)
    is_working: bool = True
    expected_hours: Decimal = Field(default=0, ge=0, decimal_places=2)
    start_time: time | None = None
    end_time: time | None = None
    apply_on_week: int = Field(default=0, ge=0, le=5)

class HrWorkCalendarCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: str | None = None
    days: list[HrWorkCalendarDayCreate]

class HrCalendarAssignmentCreate(BaseModel):
    member_uuid: UUID
    season_uuid: UUID
    calendar_uuid: UUID
```

### Calendar resolution

```python
class ExpectedHoursResult(BaseModel):
    date: date
    is_working: bool
    expected_hours: Decimal
    leave_uuid: UUID | None = None  # si neutralisé par un congé
    calendar_name: str | None = None
    season_name: str | None = None
```

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
- When a leave is approved, `current_leave_balance` on the employee profile is deducted by `total_days_deducted`. In V1 this deduction is explicit (the approval endpoint updates the balance). V2 can auto-compute from accrual rules.

### Declared Activity (Time Tracking)

- **Declaration** : any employee can create a `Draft` or `Submitted` attendance entry for themselves (`attendance_type` = `PRESENCE`).
- **Validation** : approving/rejecting a declared activity requires the same capability as leave approval (`CAP_MANAGE_HR` or equivalent).
- **Edits** : a `Draft` entry can be edited by its author. Once `Submitted`, only a reviewer can edit/review it.
- **Immutability** : `Approved` entries cannot be edited — they are locked. Rejected entries return to `Draft` for correction.
- **Comparison with calendar** : the `presences` tab should show, side by side :
  - Expected hours (from calendar resolution)
  - Declared hours (from the approved attendance entry)
  - Difference
- **Leave overlap** : a day with an approved leave (`hr_leave_requests`) cannot have a submitted/approved attendance entry. The service should check this on submit.

### Calendar Resolution (Work-Time)

Add to `backend/services/hr.py` or a dedicated `backend/services/hr_calendar.py`.

**Core function — `compute_expected_hours(member_uuid, date)`:**

```python
async def compute_expected_hours(
    db: AsyncSession, member_uuid: UUID, target_date: date
) -> ExpectedHoursResult:
    """
    Calcule les heures attendues pour un employé un jour donné.
    
    Algorithme :
    1. Trouver la saison active pour cette date (hr_seasons couvrant la date)
    2. Trouver l'affectation calendrier pour cet employé + cette saison (hr_calendar_assignments)
       → Si aucune affectation n'existe pour cet employé sur cette saison, retourner is_working=False, expected_hours=0
    3. Résoudre le jour dans le calendrier (day_of_week + apply_on_week)
    4. Vérifier si un congé approuvé neutralise ce jour
    """
    ...
```

**Règle de résolution `apply_on_week` :**

Pour déterminer quelle semaine du mois est un jour donné :
```python
def _week_of_month(d: date) -> int:
    """Retourne 1..5 (5 = dernière semaine)."""
    first_day = d.replace(day=1)
    week_num = (d.day - 1) // 7 + 1
    # Si week_num dépasse le nombre de semaines du mois → 5 (dernière)
    max_weeks = ((first_day + relativedelta(day=31)).day - 1) // 7 + 1
    return 5 if week_num > max_weeks else week_num
```

Un jour correspond à une ligne du calendrier quand :
- `apply_on_week = 0` (toutes les semaines) **ou**
- `apply_on_week = week_of_month` (semaine correspondante)

**Fonction utilitaire — `get_work_summary(member_uuid, start_date, end_date)`:**

```python
async def get_work_summary(
    db: AsyncSession, member_uuid: UUID, start_date: date, end_date: date
) -> dict:
    """
    Résumé pour une période :
    - total_expected_hours : heures attendues (calendrier - congés)
    - total_declared_hours : heures déclarées approuvées
    - total_leave_hours : heures neutralisées par les congés
    - worked_days : nombre de jours travaillés attendus
    - leave_days : nombre de jours de congé
    """
    ...
```

### Declared Activity

- `submit_attendance(entry_uuid)` — passe de Draft → Submitted (vérifie le non-chevauchenement avec un congé approuvé).
- `approve_attendance(entry_uuid, reviewer_user_id)` — passe de Submitted → Approved, lock.
- `reject_attendance(entry_uuid, reviewer_user_id, reason)` — passe de Submitted → Draft, avec motif.
- L'approbation utilise la même capacité que l'approbation des congés.

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

# --- Declared activity workflow (même endpoints que attendance) ---
POST   /api/v1/hr/attendance/{entry_uuid}/submit
POST   /api/v1/hr/attendance/{entry_uuid}/approve
POST   /api/v1/hr/attendance/{entry_uuid}/reject

# --- Employee dashboard ---
GET    /api/v1/hr/me/dashboard  # retourne : solde congés, heures attendues/mois, déclarations en cours

# --- Calendar & Seasons ---
GET    /api/v1/hr/seasons
POST   /api/v1/hr/seasons
GET    /api/v1/hr/seasons/{season_uuid}
PATCH  /api/v1/hr/seasons/{season_uuid}
DELETE /api/v1/hr/seasons/{season_uuid}

GET    /api/v1/hr/calendars
POST   /api/v1/hr/calendars
GET    /api/v1/hr/calendars/{calendar_uuid}
PATCH  /api/v1/hr/calendars/{calendar_uuid}
DELETE /api/v1/hr/calendars/{calendar_uuid}

GET    /api/v1/hr/calendar-assignments
POST   /api/v1/hr/calendar-assignments
PATCH  /api/v1/hr/calendar-assignments/{assignment_uuid}
DELETE /api/v1/hr/calendar-assignments/{assignment_uuid}

# --- Calendar resolution ---
GET    /api/v1/hr/calendar/expected-hours?member_uuid=&date=
GET    /api/v1/hr/calendar/work-summary?member_uuid=&start_date=&end_date=

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

Replace placeholders in `RhWorkspacePage` with these tabs:

- `conges`: leave calendar/list, request dialog/sheet, approval queue.
- `presences`: attendance table with date filters, employee selector, **and declaration workflow**.
- `equipe`: employee profiles (including `annual_work_hours`, `current_leave_balance`) and links to member records.
- `calendriers` (V1): seasons + calendars + assignments management.
- **Portlet employé** (sidebar ou modale) : solde de congés, heures attendues mensuelles, déclarations en attente.

Add:

- `frontend/src/modules/rh/api/index.ts`
- `frontend/src/modules/rh/types.ts`
- `frontend/src/modules/rh/components/LeavePlanningPage.tsx`
- `frontend/src/modules/rh/components/AttendancePage.tsx`
- `frontend/src/modules/rh/components/TeamProfilesPage.tsx` (inclut champ `annual_work_hours` et `current_leave_balance` dans le formulaire)
- `frontend/src/modules/rh/components/CalendarManagementPage.tsx`

Use `WorkspaceShell`, existing shadcn components, and `useTranslation('rh')` or fix the current `common` namespace usage if keeping nested `common.workspace.rh` keys.

### Declared Activity UI (`AttendancePage.tsx`)

Le composant `AttendancePage` intègre la déclaration d'activité :

- **Tableau des déclarations** : filtre par employé, date, statut.
- **Création** : bouton "Déclarer mes heures" → Sheet avec date, start_time, end_time, duration_hours, notes.
- **Actions** :
  - L'employé peut soumettre sa déclaration (Draft → Submitted).
  - Un manager peut approuver/rejeter (Submitted → Approved/Rejected).
  - Badge de statut : Draft (gris), Submitted (orange), Approved (vert), Rejected (rouge).
- **Comparaison calendrier** : colonnes côte à côte :
  - Heures attendues (du calendrier/résolution)
  - Heures déclarées (de l'entrée approuvée)
  - Différence
- **Bulk validation** : un manager peut sélectionner plusieurs déclarations et les approuver/rejeter en lot.

### Calendar Management UI (`CalendarManagementPage.tsx`)

Le composant `CalendarManagementPage` offre trois sous-vues accessibles par tabs internes :

**1. Saisons (`hr_seasons`)**
- Tableau des saisons définies avec nom, dates, description.
- Dialog pour créer/éditer une saison.
- Suppression avec confirmation (AlertDialog).

**2. Calendriers (`hr_work_calendars`)**
- Liste des calendriers avec leur nom et description.
- À l'ouverture d'un calendrier, affiche la grille des 7 jours avec :
  - Checkbox "travailé"
  - Champ `expected_hours`
  - Champ `apply_on_week` (0=toutes les semaines, 1-5=Nième semaine)
  - Heures de début/fin optionnelles
- Dialog ou Sheet pour l'édition (un calendrier = 7 lignes max).

**3. Affectations (`hr_calendar_assignments`)**
- Tableau groupé par employé : chaque ligne affiche une affectation employé | saison | calendrier | actions.
- **Ajout d'une affectation** : l'admin sélectionne un employé (recherche par nom/trigramme), puis choisit parmi les saisons disponibles celle(s) à lui affecter, et associe un calendrier à chacune.
- Un employé peut être affecté à plusieurs saisons (au moins une est requise pour que son planning soit calculable).
- La même saison peut être utilisée par plusieurs employés avec des calendriers différents.
- Détection des doublons : un employé ne peut pas avoir deux affectations pour la même saison (contrainte UNIQUE `(member_uuid, season_uuid)`).
- Avertissement visuel si les affectations d'un employé ne couvrent pas la totalité de l'année en cours (jours sans saison = planning indéfini).

**Vue synthèse : heures attendues**
- Un sélecteur : employé + période (date range).
- Affiche un tableau jour par jour avec :
  - Date | Saison | Calendrier | Heures attendues | Congé (si neutralisé) | Heures effectives
- Total lignes : total heures attendues, total neutralisées, solde.

### Planning Workspace

The planning module is **committee-driven activity/event management** — not individual work schedules (those are handled in the RH module via seasons and calendars). Committees create events such as stages, cours théorie, permanences, maintenance sessions, and other club events. Members (participants, instructors, organisateurs) are then assigned to those events.

Replace the placeholder in `PlanningPage` with tabs such as:

- `calendar`: visual calendar of club activities/events, filterable by committee or activity type.
- `activities`: table of planned activities with status, committee, dates, and participant count.
- `conflicts`: list of conflicts between confirmed activities and approved member leave.

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

- HR profile labels (annual_work_hours, current_leave_balance, last_leave_balance_update).
- Leave states and action buttons.
- Attendance table and filters.
- Declaration workflow states (draft, submitted, approved, rejected).
- Declaration comparison (expected_hours, declared_hours, difference).
- Employee dashboard (leave_balance_summary, monthly_hours, pending_declarations).
- Season labels (name, dates, description).
- Calendar labels (day names, apply_on_week labels, expected_hours).
- Assignment labels (employee, season, calendar).
- Calendar resolution summary (expected_hours_legend, leave_neutralisation).
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

- Add migration `053_hr_planning.sql` (including seasons, calendars, calendar_days, assignments).
- Add SQLAlchemy models and Pydantic schemas.
- Add service functions and route modules.
- Add calendar resolution service (`compute_expected_hours`, `get_work_summary`).
- Add basic tests for CRUD, state transitions, overlap checks, and calendar resolution.

### Phase 2: HR Workspace

- Implement RH query hooks.
- Replace leave, attendance, and team placeholders.
- Add self-service draft leave creation and admin approval queue.
- Add calendar management tab (seasons CRUD, calendars CRUD, assignments).
- Add expected-hours preview in leave request and attendance views.

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

1. Create HR profile for an employee member (with `annual_work_hours` and `current_leave_balance`).
2. Reject HR profile creation for unknown member.
3. Submit leave from Draft.
4. Approve/reject submitted leave with reviewer metadata → verify `current_leave_balance` deduction on approve.
5. Refuse edits to approved/rejected leave except dedicated cancellation.
6. Refuse overlapping submitted/approved leave for the same member.
7. Create a declared activity entry (Draft) for an employee.
8. Submit declared activity (Draft → Submitted).
9. Reject declared activity (Submitted → Draft) with reason.
10. Approve declared activity (Submitted → Approved) — lock the entry.
11. Refuse submit if an approved leave already covers the same date (leave overlap).
12. Verify non-HR user cannot approve another member's leave or declared activity.
13. Create activity linked to existing committee.
14. Assign instructor participant and detect approved leave conflict.
15. Confirm activity only after conflict warnings are handled according to service policy.
16. Create a season and verify date-boundary queries.
17. Create a work calendar with multiple day entries including `apply_on_week` rules.
18. Assign an employee to a season+calendar.
19. `compute_expected_hours` returns correct hours for a normal workday (apply_on_week=0).
20. `compute_expected_hours` returns correct hours for a 1st-Saturday-of-month workday.
21. `compute_expected_hours` returns zero for a non-working day.
22. `compute_expected_hours` returns zero when an approved leave covers the date.
23. `get_work_summary` aggregates correctly over a multi-week period across season boundaries.
24. Cannot assign the same employee to the same season twice (UNIQUE constraint).
25. Deleting a season cascades to assignments but blocks if a calendar assignment references it.

Frontend:

1. `/workspace/rh` renders real leave, attendance, and team tabs.
2. User-facing text comes from i18n.
3. Leave request create/submit/approve/reject flows update TanStack Query caches.
4. `/planning` renders activity calendar/list.
5. Committee filter uses existing committee data.
6. Calendar management tab renders seasons, calendars, and assignments sub-views.
7. Creating a season via the dialog is reflected in the table without refresh.
8. Calendar day grid shows 7 rows with correct day-of-week labels.
9. Expected-hours preview in leave request shows correct neutralisation.
10. Employee profile form shows `annual_work_hours` and `current_leave_balance` fields.
11. Declaration submit/approve/reject flow updates entry status badge.
12. Presence tab shows expected vs declared hours comparison columns.
13. Employee dashboard portlet displays leave balance and monthly hours.
14. Bulk approve/reject on declarations works for multiple selected entries.
15. Conflict warnings are visible and do not overlap with table/calendar layout on mobile.

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
