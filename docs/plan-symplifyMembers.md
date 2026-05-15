# Simplified Members Status Management — Refinement Plan

## Challenge & Refinement of Current Spec

### Current Spec Issues

1. **Member Status has 4 values instead of 3**
   - Current: Active (1), Suspended (2), Resigned (3), Anonymized (4)
   - Problem: Resigned is redundant with Anonymized; both represent member no longer active
   - **Fix:** Collapse to Active (1), Suspended (2), Anonymized (3)

2. **Registration Status has 4 values instead of 2**
   - Current: Draft (1), In Progress (2), Completed (3), Archived (4)
   - Problem: Too many states; doesn't match document checklist model
   - **Fix:** Use only Pending (1) and Completed (2) for checklist state

3. **Registration State not formally enumerated**
   - Current spec mentions Unregistered/Registered but mixes them with above
   - **Fix:** Define Registration State as **computed/derived** from:
     - Whether `CURRENT_DATE` overlaps an active `member_registrations` period
     - Combined with `members.registration_status` value

4. **member_registrations.registration_type unclear**
   - Question: How does `registration_type` differ from `member_category`?
   - If identical, should be removed to avoid duplication
   - If different, spec must clarify purpose

---

## Proposed Simplified Three-Tier Model

### Visual Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ MEMBER STATUS (Lifecycle Governance)                            │
│ 1 = Active    │ 2 = Suspended    │ 3 = Anonymized              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ REGISTRATION STATUS (Document Checklist Control)                │
│ 1 = Pending (missing docs)    │ 2 = Completed (all docs OK)    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ REGISTRATION STATE (Computed at Runtime)                        │
│ ❌ Unregistered | ⏳ Pending | ✅ Registered                    │
│ (derives from date overlap + registration_status value)         │
└─────────────────────────────────────────────────────────────────┘
```

### 1. Member Status (Lifecycle) — **Stored on `members.status`**

| Value | State | Meaning |
|-------|-------|---------|
| 1 | Active | Member is in good standing; can register, log in, be listed in directory. |
| 2 | Suspended | Member privileges temporarily frozen by admin; no registration or access allowed. |
| 3 | Anonymized | Retained for ledger integrity only; all PII scrubbed; cannot register or access. |

**Notes:**
- Replaces "Resigned" value — resignation is terminal state → Anonymized
- Admin transitions member between states (Active ↔ Suspended ↔ Anonymized)
- Anonymized is one-way; cannot reactivate (represents GDPR-compliant deletion)

### 2. Registration Status (Document Checklist) — **Stored on `members.registration_status`**

| Value | State | Meaning |
|-------|-------|---------|
| 1 | Pending | An active registration period is assigned, **but** mandatory prerequisites are missing (e.g., medical cert, signed club rules, insurance proof). |
| 2 | Completed | All mandatory registration prerequisites validated and stored; registration is administratively cleared. |

**Automatic Transition Rules:**
- When `registration_status` updated to Completed, backend validates all prerequisites exist and are non-expired
- If a prerequisite is later removed/deleted (e.g., medical cert file deleted), backend automatically reverts `registration_status` to Pending
- This prevents "Completed" from drifting out of sync with actual prerequisite state

### 3. Registration State (Derived / Computed) — **Computed at Query Time**

Evaluated by checking member category and active registration periods.

| State | Condition | Display | Color |
|-------|-----------|---------|-------|
| **Unregistered** | Member category not in (5,7,8) and no active registration period overlaps CURRENT_DATE for selected year | ❌ Unregistered | Gray |
| **Pending** | Active registration period overlaps CURRENT_DATE, **AND** `members.registration_status = 1` | ⏳ Pending | Orange |
| **Registered** | Member category in (5,7,8), or active registration period overlaps CURRENT_DATE and `members.registration_status = 2` | ✅ Registered | Green |

**SQL Logic (Conceptual):**

```sql
SELECT 
    m.uuid,
    m.first_name,
    m.last_name,
    CASE 
      WHEN m.member_category IN (5, 7, 8) THEN
         CASE
            WHEN m.registration_status = 1 THEN 'Pending'
            WHEN m.registration_status = 2 THEN 'Registered'
            ELSE 'Registered'
         END
      WHEN EXISTS (
            SELECT 1 FROM member_registrations r 
            WHERE r.member_uuid = m.uuid 
              AND r.status = 1  -- Active registration only
              AND CURRENT_DATE BETWEEN r.start_date AND r.end_date
              AND r.registered_for_year = EXTRACT(YEAR FROM CURRENT_DATE)
        ) THEN
            CASE 
                WHEN m.registration_status = 1 THEN 'Pending'
                WHEN m.registration_status = 2 THEN 'Registered'
            END
        ELSE 'Unregistered'
    END AS registration_state
FROM members m
WHERE m.status = 1;  -- Only consider Active members
```

---

## Permanent Members Rules (Categories 5, 7, 8)

Categories 5 (External Pilot), 7 (External Organization), and 8 (Client/Supplier) are permanent members.

### Rule Set

1. **No Registration Row Required**
   - Permanent members are valid without creating rows in `member_registrations`.
   - Yearly registration workflow does not apply to these categories.

2. **Always Considered Registered**
   - In list/detail computations, categories 5/7/8 are treated as registered by default.
   - `registration_state=registered` must include 5/7/8 even when no dated registration exists.
   - `registration_state=unregistered` must exclude 5/7/8.

3. **Registration Status Managed in Edit Screen**
   - For 5/7/8, administrative progression is managed through `members.registration_status` on the member edit page.
   - `members.status` (lifecycle) and `members.registration_status` are both editable in member edit screen.

4. **Guard Registration Endpoints**
   - `complete-registration` and manual registration creation endpoints must reject 5/7/8 with clear HTTP 400 guidance.
   - Error message should explicitly state: permanent members are managed from the edit screen and do not use annual registration periods.

5. **Lifecycle Status Still Applies**
   - Permanent does not bypass lifecycle controls.
   - Suspended/Anonymized members remain blocked according to existing status rules.

---

## Key Business Rules

1. **Date-Driven Logic:** A member's registration is "active" if `CURRENT_DATE BETWEEN start_date AND end_date` in any row of `member_registrations` with `status = 1`

2. **Extensible Dates:** Admin can extend `start_date` / `end_date` without creating new rows

3. **Independent Checklist:** `registration_status` is managed independently of dates; allows:
   - Member is registered for dates, but docs incomplete → Pending
   - Member is registered for dates, all docs done → Registered
   - Member has no active registration → Unregistered (regardless of registration_status)

4. **Auto-Revert on Doc Loss:** If prerequisite deleted mid-year, backend auto-reverts `registration_status` to Pending

5. **Member Status Takes Precedence:** If `members.status ≠ 1` (Active), registration state is blocked/frozen

6. **Permanent Categories:** Member categories 5/7/8 are always treated as registered and do not require any `member_registrations` row.

7. **Edit Screen Ownership:** For permanent categories, lifecycle status and registration_status must be managed directly in member edit form.

---

## Database Schema Adjustments

### Table: `members`

**Current:**
```sql
status SMALLINT NOT NULL DEFAULT 1              -- 1=Active, 2=Suspended, 3=Resigned, 4=Anonymized
registration_status SMALLINT NOT NULL DEFAULT 1 -- 1=Draft, 2=In Progress, 3=Completed, 4=Archived
```

**Refined:**
```sql
status SMALLINT NOT NULL DEFAULT 1              -- 1=Active, 2=Suspended, 3=Anonymized
registration_status SMALLINT NOT NULL DEFAULT 1 -- 1=Pending, 2=Completed
```

**Constraints:**
```sql
CHECK (status IN (1, 2, 3))
CHECK (registration_status IN (1, 2))
```

### Table: `member_registrations`

**Clarification needed:**
- Remove or clarify `registration_type` column
  - If it duplicates `member_category`, use a category snapshot during registration instead
  - Suggested: Store snapshot of member's category at registration time in a `category_at_registration` column if needed for historical accuracy

**Simplify status values:**
- Current: `status` with values 1=Active, 2=Cancelled, 3=Superseded
- Proposed: `is_active BOOLEAN` (TRUE=active, FALSE=cancelled)
  - Simpler, clearer; archived rows can be soft-deleted or marked with `is_active = FALSE`

---

## Questions to Resolve

1. **Should `member_registrations.registration_type` be retained?**
   - If it's identical to member_category, remove it
   - If different, clarify the business purpose

2. **How are document prerequisites tracked?**
   - Need a way to mark prerequisites (medical cert, insurance, rules agreement, etc.) as present/valid/expired
   - Triggers auto-revert of registration_status to Pending if any go missing

3. **Backward compatibility:**
   - Existing records have `registration_status` in Draft/In Progress/Completed/Archived
   - Migration: Draft → Pending, Completed → Completed, others → Pending

---

## Concrete Implementation Plan

### Scope Freeze for This Delivery

- Keep existing status enums as-is for now (no enum reduction in this delivery).
- Implement permanent behavior only for categories 5, 7, 8.
- Add edit-screen control for both lifecycle status and registration_status.
- Do not create schema migrations in this delivery unless required by runtime constraints.

### Delivery Order (Implementation Backlog)

#### Work Package 1 - Backend domain helpers and registration-state semantics

Target files:
- `backend/services/members.py`

Changes:
- Add a single helper for permanent categories (5, 7, 8).
- In member summary serialization (`is_registered_for_year`), return true for permanent categories even without registration rows.
- In member list filtering when `registration_state` is used:
   - registered: include permanent categories by default.
   - unregistered: exclude permanent categories by default.

Acceptance criteria:
- A category 5/7/8 member with zero rows in `member_registrations` appears as registered in list and detail summary.
- Filtering by unregistered never returns 5/7/8 members.

#### Work Package 2 - Backend endpoint guards for permanent categories

Target files:
- `backend/services/members.py`
- `backend/api/routes/members.py` (only if message mapping is needed at route level)

Changes:
- Reject creation/completion of dated registrations for categories 5/7/8 in:
   - create member registration flow
   - complete registration flow
- Return HTTP 400 with a consistent message indicating that permanent members are managed from the edit screen.

Acceptance criteria:
- `POST /api/v1/members/{uuid}/registrations` returns 400 for categories 5/7/8.
- `POST /api/v1/members/{uuid}/complete-registration` returns 400 for categories 5/7/8.
- Same calls still work for non-permanent categories.

#### Work Package 3 - Member edit payload and UI controls

Target files:
- `frontend/src/modules/members/components/membersShared.tsx`
- `frontend/src/modules/members/components/MemberFormPage.tsx`

Changes:
- Include `registration_status` in update payload builder (`buildMemberUpdatePayload`).
- Add a visible registration_status control in member edit form.
- Keep lifecycle status and registration_status editable together for permanent categories.
- Add a contextual note on categories 5/7/8: no annual registration period required.

Acceptance criteria:
- Editing a member can persist both `status` and `registration_status` in one save.
- For categories 5/7/8, UI clearly indicates status management is done on this screen.

#### Work Package 4 - Frontend list/badge consistency

Target files:
- `frontend/src/modules/members/components/MemberRowBadges.tsx`
- any member list container using `is_registered_for_year`

Changes:
- Ensure displayed state does not show renewal-required semantics for 5/7/8 when no registration rows exist.
- Keep badge mapping consistent with current enum values.

Acceptance criteria:
- Permanent members display consistent registered semantics in list rows.

#### Work Package 5 - Backend tests

Target files:
- `backend/tests/test_members_registration.py`
- `backend/tests/test_members_update.py`
- `backend/tests/test_accounting_route_guards.py` (if route-level guards/assertions live there)

Add tests for:
- permanent categories are treated as registered without registration rows.
- registered/unregistered filters include or exclude permanent categories correctly.
- registration create/complete endpoints reject permanent categories with HTTP 400.
- member update persists both lifecycle status and registration_status.

Acceptance criteria:
- Test suite for touched member tests passes.

#### Work Package 6 - Validation and release checks

Backend checks:
- Run targeted backend tests for members and route guards.

Frontend checks:
- Run lint and build in frontend workspace.
- Manual edit-flow verification on category 1 and category 5 (or 7/8).

Release gate:
- No regression on non-permanent annual registration workflow.
- Permanent categories fully manageable through edit screen without registration rows.

#### Work Package 7 - SQL migrations (delivery artifacts)

Target files:
- `docs/migrations/024_members_permanent_registration_guard.sql`
- `docs/migrations/025_members_registration_type_range_to_8.sql`
- `docs/migrations/026_members_simplify_status_enums.sql`
- `docs/migrations/027_members_status_post_migration_checks.sql`

Changes:
- `024`: adds DB-level trigger guard to reject `member_registrations` writes for categories 5/7/8.
- `025`: updates `chk_member_registrations_type` range to `1..8` for schema consistency with member categories.
- `026`: remaps legacy status values and tightens members constraints to `status 1..3` and `registration_status 1..2`.
- `027`: runs post-migration validation checks and raises if any invalid data remains.

Acceptance criteria:
- Running migration `024` prevents direct SQL inserts/updates creating dated registrations for permanent categories.
- Running migration `025` leaves existing registrations valid and aligns check constraints with category enum.

---

## Test Checklist (Execution)

### Backend functional checklist
- [ ] Category 5 member with no registrations is returned as registered in member list response.
- [ ] Category 7 member with no registrations is returned as registered in member list response.
- [ ] Category 8 member with no registrations is returned as registered in member list response.
- [ ] Filter `registration_state=registered` includes categories 5/7/8 without registrations.
- [ ] Filter `registration_state=unregistered` excludes categories 5/7/8.
- [ ] `POST /members/{uuid}/registrations` returns 400 for categories 5/7/8.
- [ ] `POST /members/{uuid}/complete-registration` returns 400 for categories 5/7/8.
- [ ] `PATCH /members/{uuid}` updates both `status` and `registration_status` for categories 5/7/8.

### Frontend functional checklist
- [ ] Edit form displays both lifecycle status and registration_status controls.
- [ ] Saving edit form sends registration_status in PATCH payload.
- [ ] Category 5/7/8 edit view displays guidance that annual registration is not required.
- [ ] Member list does not display false unregistered/renewal warning for categories 5/7/8.

### Regression checklist
- [ ] Non-permanent categories still follow annual registration workflow.
- [ ] Existing registration flows for categories 1/2/3/4/6 remain unchanged.
- [ ] No API contract break on member detail and list endpoints.

---

## Future Enhancements (Post-v1)

1. **Registration History:** Archive completed registrations separately to show member's multi-year activity
2. **Prerequisite Matrix:** Configurable by member category (e.g., Full members need medical cert, non-flying members don't)
3. **Automatic Completion:** Option to auto-promote from Pending to Completed when last doc is added
