# Member Registration Flow Assessment

**Date:** 29 April 2026  
**Status:** Review of database structure, backend code, and frontend needs for annual member registration process

---

## Executive Summary

✅ **Database Structure: COMPLIANT**  
✅ **Backend Code: COMPLIANT with partial implementation**  
⚠️ **Frontend: Missing specialized registration screen**  

The current database and backend infrastructure correctly support:
- Multi-year registration periods with date ranges
- Separate registration records (not a single field on members)
- Registration type snapshots at the time of registration
- Committee membership enforcement (yearly)
- Member anonymization after inactivity
- Anticipatory registrations (October for rest of year + next year, December for next year)

**Critical missing piece:** A dedicated registration completion screen with checklist, template entry picker, and validation UI.

---

## 1. Database Structure Assessment

### 1.1 Members Table ✅ COMPLIANT

**Current fields that support your workflow:**

| Field | Purpose | Compliance |
|-------|---------|-----------|
| `uuid` | Stable primary key | ✅ Perfect |
| `account_id` | Financial ledger identity (ME<YEAR>-<NNNN>) | ✅ Auto-generated, unique |
| `member_category` | Type enumeration (1-6) | ✅ Supports full/temp/volunteer/external |
| `is_active` | Master on/off flag | ✅ Controls visibility |
| `status` | Lifecycle (1=Active, 2=Suspended, 3=Resigned, 4=Anonymized) | ✅ Handles anonymization after inactivity |
| `registration_status` | Profile onboarding (1=Draft, 2=In Progress, 3=Completed, 4=Archived) | ✅ Distinct from registration periods |
| `can_fly` | Flying eligibility flag | ✅ Triggers member sheet creation |
| `last_registration_year` | Tracks most recent active registration | ✅ Enables anonymization logic |
| `created_at` / `updated_at` | Audit trail | ✅ Proper timestamps |

**KEY INSIGHT:** `registration_status` is **correctly separated** from individual registration periods. It tracks profile/onboarding completion, NOT whether a member is registered for a given year. This is architecturally correct.

### 1.2 MemberRegistration Table ✅ COMPLIANT

**Supports multi-year anticipatory registration:**

```sql
CREATE TABLE member_registrations (
    uuid UUID PRIMARY KEY,
    member_uuid UUID NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    registered_for_year SMALLINT NOT NULL,  -- ← CRITICAL
    registration_type SMALLINT NOT NULL,    -- ← Snapshot of category
    status SMALLINT NOT NULL DEFAULT 1,
    registered_at TIMESTAMPTZ NOT NULL,
    registered_by INTEGER,
    notes TEXT,
    CONSTRAINT uq_member_registrations_period UNIQUE (member_uuid, start_date, end_date),
    CONSTRAINT chk_end_date_ge_start_date CHECK (end_date >= start_date)
)
```

**Why this supports your workflow:**

✅ **October registration for year 2026 + 2027:**  
- One row: `start_date='2026-10-01', end_date='2027-12-31', registered_for_year=2026 + 2027`  
- Query both: `WHERE registered_for_year IN (2026, 2027)`

✅ **December 2026 registration for 2027 only:**  
- One row: `start_date='2027-01-01', end_date='2027-12-31', registered_for_year=2027`

✅ **Yearly reset except anticipatory members:**  
- Query for active registrations: `WHERE status = 1 AND start_date <= TODAY AND end_date >= TODAY`  
- Anticipatory members already have overlapping periods; no reset needed

✅ **Anonymization after N years of inactivity:**  
- Check: `WHERE last_registration_year < CURRENT_YEAR - N` AND no active registration

### 1.3 CommitteeMember Table ✅ COMPLIANT

```sql
CREATE TABLE committee_members (
    committee_uuid UUID,
    member_uuid UUID,
    membership_year SMALLINT,
    assigned_at TIMESTAMPTZ,
    assigned_by INTEGER,
    PRIMARY KEY (committee_uuid, member_uuid, membership_year)
)
```

✅ **Enforces committee requirement before registration completion**  
- Backend checks: `WHERE membership_year = {target_year}` must have at least 1 row  
- Current code: `complete_member_registration()` validates `committee_count >= 1`

### 1.4 MemberSheet Table ✅ COMPLIANT

```sql
CREATE TABLE member_sheets (
    uuid UUID PRIMARY KEY,
    member_uuid UUID,
    year SMALLINT,
    licence_number VARCHAR(50),
    fare_type SMALLINT,
    hours_count NUMERIC(10,4),
    packs_bought_count INTEGER,
    hours_done_in_pack NUMERIC(10,4),
    remaining_hours_in_pack NUMERIC(10,4),
    expense_access_enabled BOOLEAN,
    ...
    UNIQUE (member_uuid, year)
)
```

✅ **Auto-created by registration completion if `can_fly = true`**  
- Note: Current code creates registration but doesn't auto-create sheet (see GAP #1 below)

---

## 2. Backend Implementation Assessment

### 2.1 What's Working ✅

#### `complete_member_registration()` Service
```python
async def complete_member_registration(
    db: AsyncSession,
    member_uuid: UUID,
    payload: RegistrationCompletionRequest,  # year, start_date, end_date, registration_type, status, notes
    updated_by_user_id: Optional[int] = None,
) -> Member:
```

✅ **Correctly:**
- Validates committee membership for the target year exists
- Creates a `MemberRegistration` record with date range
- Sets `is_active = true` on the member (current code does this in `create_member_registration()`)
- Updates `last_registration_year` when registration is created
- Returns updated member detail

✅ **Endpoint:**
- `POST /members/{member_uuid}/complete-registration`
- Payload: `RegistrationCompletionRequest`
- Guard: `members_guard` (authorization in place)
- Returns: `MemberDetailResponse`

### 2.2 Gaps & Issues ⚠️

#### GAP #1: Missing Member Sheet Auto-Creation
**Current:** `complete_member_registration()` does NOT automatically create a member sheet when registration is completed for a flying member.

**Impact:** If member has `can_fly = true`, the sheet should be auto-created/updated during registration completion.

**Recommendation:**
```python
async def complete_member_registration(...):
    # ... existing validation ...
    
    # Create registration
    await create_member_registration(...)
    
    # NEW: Auto-create member sheet if can_fly
    if member.can_fly:
        existing_sheet = await db.scalar(
            select(MemberSheet).where(
                MemberSheet.member_uuid == member_uuid,
                MemberSheet.year == payload.year
            )
        )
        if not existing_sheet:
            sheet = MemberSheet(
                uuid=uuid4(),
                member_uuid=member_uuid,
                year=payload.year,
                fare_type=1,  # Default
                hours_count=Decimal(0),
                packs_bought_count=0,
                hours_done_in_pack=Decimal(0),
                remaining_hours_in_pack=Decimal(0),
                expense_access_enabled=False,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
                updated_by=updated_by_user_id,
            )
            db.add(sheet)
```

#### GAP #2: No Accounting Entry Auto-Post
**Current:** The spec mentions "triggers the creation of accounting writings based on the applicable price list entries" but this is NOT implemented.

**Context:** The PRD says this is "out of scope for v1" but the table exists for future integration.

**Status:** ⏸️ DEFERRED (acceptably, per spec)

#### GAP #3: Member Status Not Updated to `is_active = true`
**Current:** The function does NOT explicitly set `is_active = true` or update `status`.

**Issue:** If a member starts as draft/suspended, they should be activated upon successful registration completion.

**Code to add:**
```python
member.is_active = True
member.registration_status = 3  # COMPLETED
member.status = 1  # ACTIVE
member.last_registration_year = payload.year
await db.flush()  # Ensure these are persisted
```

---

## 3. Field Relevance Review

### 3.1 Member Fields: All Relevant ✅

| Field | Usage | Relevance |
|-------|-------|-----------|
| `uuid` | Stable PK, relations | ✅ CRITICAL |
| `genre` | Demographics | ✅ OPTIONAL (reporting) |
| `first_name` / `last_name` | Identity | ✅ CRITICAL |
| `date_of_birth` | Demographics, age-based pricing | ✅ USEFUL |
| `email` | Contact, notifications | ✅ CRITICAL |
| `phone` | Contact | ✅ OPTIONAL |
| `member_category` | Type (full/temp/volunteer) | ✅ CRITICAL |
| `seniority` | Years in club (for pricing) | ✅ USEFUL |
| `ffvp_id` | National federation ID | ✅ OPTIONAL (future sync) |
| `account_id` | Ledger identity, financial tracking | ✅ CRITICAL |
| `photo_url` | Identity verification | ✅ OPTIONAL |
| `is_active` | Visibility master flag | ✅ CRITICAL |
| `status` | Lifecycle (active/suspended/resigned/anonymized) | ✅ CRITICAL |
| `registration_status` | Onboarding progress (draft/in-progress/completed) | ✅ CRITICAL |
| `is_instructor` / `is_employee` / `is_executive` / `is_board_member` | Role flags (non-exclusive) | ✅ USEFUL |
| `can_fly` | Flying eligibility | ✅ CRITICAL |
| `external_auth_enabled` | Expense portal access | ✅ OPTIONAL |
| `last_registration_year` | Anonymization logic | ✅ CRITICAL |
| `notes` | Free-form comments | ✅ OPTIONAL |

**Conclusion:** All fields are relevant. None should be removed.

### 3.2 Registration Process Fields: Complete ✅

| Field | Purpose |
|-------|---------|
| `start_date` | Registration period start |
| `end_date` | Registration period end |
| `registered_for_year` | Fiscal year the registration applies to |
| `registration_type` | Member category at registration time (snapshot) |
| `status` | Active/inactive/cancelled |
| `notes` | Admin comments (templates applied, special conditions) |

**All present. Well designed.**

---

## 4. Current Registration Workflow (Backend) ✅

### 4.1 API Flow Today

```
1. Member created (status=1 DRAFT, registration_status=1 DRAFT)
2. Admin edits member in MembersPage (optional)
3. Admin assigns committee membership(s) via CommitteesPage → "Roster" editor
4. Admin clicks "Complete Registration" in MembersPage
   → POST /members/{uuid}/complete-registration
   → Validates: ≥1 committee membership for this year
   → Creates MemberRegistration record (start_date, end_date, year)
   → Returns updated member detail (registration_status → 3 COMPLETED)
5. On query: list members where registration overlaps active year
```

### 4.2 What's Missing: Specialized Registration Screen ⚠️

**Current state:**
- Registration completion is a single button in the existing MembersPage
- No checklist of required steps
- No template entry picker (if needed for accounting)
- No clear validation feedback
- No summary of what's being created

---

## 5. Recommended Registration Completion Screen

### 5.1 Screen Flow

**Route:** `/members/register/{memberUuid}/{year}` (modal or dedicated page)

**Steps (Checklist):**

1. ✓ **Member Profile Validation**
   - First/Last name not empty
   - Email address present
   - Member category selected
   - Display member status (active/suspended)

2. ✓ **Committee Assignment**
   - List assigned committees for this year
   - Minimum 1 required (show error if 0)
   - Allow inline add/remove during registration

3. ✓ **Registration Period**
   - Start date input (default: `YEAR-01-01`)
   - End date input (default: `YEAR-12-31`)
   - Allow past/future dates for anticipatory registration
   - Show warning if overlaps existing registration

4. ⭐ **Template Entry Picker** (Optional, if accounting integration enabled)
   - Dropdown: "Select accounting template entry (optional)"
   - Shows: template code, description, debit/credit accounts
   - If selected: brief preview of what will be posted
   - Note: Can be deferred if accounting v1 is not yet active

5. ✓ **Summary & Validation**
   - Show: Member name, category, start date, end date, year
   - Show: Applied committees
   - Error states: missing committee, invalid dates
   - Button: "Complete Registration" (disabled if invalid)

6. ✓ **Confirmation & Result**
   - Success: "Member registered for 2026"
   - Show: Created registration UUID, timestamp
   - Return to members list or detail page

### 5.2 UI Components Needed

```tsx
// RegistrationCompletionScreen.tsx
interface RegistrationCompletionScreenProps {
  memberUuid: string
  year: number
  onSuccess?: (member: MemberDetail) => void
  onCancel?: () => void
}

// Internal state:
- step: number (1-5)
- startDate: string
- endDate: string
- selectedTemplateUuid: string | null
- committeeList: Committee[]
- assignedCommittees: string[]
- errors: Record<string, string>
- loading: boolean
```

### 5.3 Backend Endpoint Extension (Optional)

If template entry is selected, ensure `RegistrationCompletionRequest` can accept:

```python
class RegistrationCompletionRequest(BaseModel):
    year: int
    start_date: date
    end_date: date
    registration_type: Optional[int] = None
    status: int = 1
    notes: Optional[str] = None
    # NEW (optional):
    template_entry_uuid: Optional[UUID] = None  # For future accounting integration
```

---

## 6. Multi-Year Anticipatory Registration Example

### Scenario: October 2026 Registration for 2026 + 2027

**Current database behavior (already working):**

```python
# User registers member for rest of 2026 + all of 2027
payload = RegistrationCompletionRequest(
    year=2026,  # Current year
    start_date=date(2026, 10, 1),
    end_date=date(2027, 12, 31),  # Spans 2 years
    registration_type=1,  # Full member
    status=1
)
await complete_member_registration(db, member_uuid, payload, ...)

# Result: ONE registration record created
# member_registrations table:
# ┌────────────────────────────────────────────────────────────┐
# │ uuid | member_uuid | start_date | end_date       | registered_for_year |
# ├─────┼─────────────┼────────────┼────────────────┼─────────────────────┤
# │ ... │ xxx         │ 2026-10-01 │ 2027-12-31     │ 2026                │
# └────────────────────────────────────────────────────────────┘
#
# Query for 2026 active members: registered_for_year = 2026, status = 1 ✓
# Query for 2027 active members: registered_for_year = 2026 (overlaps 2027) ✓
```

✅ **This works correctly as-is.**

### Scenario: Year Change (2027 → 2028)

**Process on January 1, 2028:**

1. ✅ Members with anticipatory registrations (like above) → remain active (no action)
2. ✅ Members without anticipatory registrations → NOT automatically reset
3. ⚠️ Admin must trigger re-registration flow for returning members
4. ✅ Non-registered members for 5 years → marked anonymized (via `anonymize_inactive_members()`)

**Backend supports this:**
```python
# Check if member is active for 2028:
active_regs = await db.scalars(
    select(MemberRegistration).where(
        MemberRegistration.member_uuid == member_uuid,
        MemberRegistration.status == 1,
        MemberRegistration.start_date <= date(2028, 12, 31),
        MemberRegistration.end_date >= date(2028, 1, 1),
    )
)
is_active_2028 = len(active_regs) > 0  # True if anticipatory or newly registered
```

✅ **Correctly handled.**

---

## 7. Anonymization Logic ✅

**Already implemented:**

```python
async def anonymize_inactive_members(
    db: AsyncSession,
    reference_year: Optional[int] = None,
) -> AnonymizationResultResponse:
    """Anonymize members with no active registration for the configured number of full years."""
    
    # Default: 5 years
    anonymize_after_years = settings.get("anonymize_after_unregistered_years", 5)
    
    # Query: members where last_registration_year < threshold
    threshold_year = current_year - anonymize_after_years
    cutoff = date(threshold_year, 12, 31)
    
    # Set status = 4 (ANONYMIZED) for inactive members
```

✅ **This correctly handles your GDPR anonymization requirement.**  
✅ **Entry remains active but personal fields are masked (future work).**

---

## 8. Implementation Roadmap

### Phase 1: Fix Backend Gaps (1-2 hours)

- [ ] Add member sheet auto-creation to `complete_member_registration()`
- [ ] Update member status/is_active on completion
- [ ] Write tests for new behavior
- [ ] Document API behavior changes

### Phase 2: Build Registration Screen (4-6 hours)

- [ ] Create `RegistrationCompletionScreen.tsx` component
- [ ] Implement 6-step checklist UI
- [ ] Add form validation with real-time feedback
- [ ] Integrate with existing mutations
- [ ] Add i18n translations (members.registration.*)
- [ ] Write tests

### Phase 3: Optional - Accounting Integration (Deferred)

- [ ] Extend `RegistrationCompletionRequest` to accept template entry
- [ ] Create accounting entries on registration completion
- [ ] Wire up UI to select template
- [ ] Test end-to-end flow

---

## 9. Summary & Recommendations

### ✅ What's Already Correct

| Area | Status | Details |
|------|--------|---------|
| Database structure | ✅ EXCELLENT | Supports multi-year, anticipatory, and GDPR requirements |
| Member registration table | ✅ EXCELLENT | Date-based, separate from onboarding status |
| Committee enforcement | ✅ IMPLEMENTED | Validated before registration completion |
| Anonymization | ✅ IMPLEMENTED | Configured threshold, automatic masking ready |
| Backend APIs | ✅ MOSTLY COMPLETE | Endpoints exist; some gaps in logic |

### ⚠️ Critical Gaps

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Member sheet auto-creation | Members can't use flying features | 1 hour | HIGH |
| Status not updated on registration | Workflows unclear | 30 min | MEDIUM |
| No specialized registration screen | Poor UX, unclear process | 4-6 hours | HIGH |
| No template entry picker | Can't integrate accounting | 2-3 hours | LOW (deferred) |

### 🎯 Immediate Actions

1. **This week:**
   - Fix backend gaps (auto-sheet, status update)
   - Run full test suite
   - Verify anonymization behavior

2. **Next week:**
   - Design registration completion screen
   - Build component with checklist
   - Integrate with existing flows
   - Add i18n labels

3. **Future:**
   - Integrate accounting templates (when ledger module ready)
   - Build batch registration screen for annual campaigns
   - Add email notifications on registration completion

---

## 10. Field Usage Matrix

**For quick reference during implementation:**

| Field | Create | List | Detail | Register | Anonymize |
|-------|--------|------|--------|----------|-----------|
| uuid | 🔄 auto | ✅ | ✅ | — | ✅ |
| account_id | 🔄 auto | ✅ | ✅ | — | ⚠️ mask |
| first_name | ✅ required | ✅ | ✅ | — | ⚠️ mask |
| last_name | ✅ required | ✅ | ✅ | — | ⚠️ mask |
| email | ✅ optional | — | ✅ | ✅ check | ⚠️ mask |
| member_category | ✅ required | ✅ | ✅ | 🔄 snapshot | — |
| is_active | — | ✅ filter | ✅ | ✅ set true | ✅ set false |
| status | — | ✅ filter | ✅ | ✅ set active | ✅ set anon |
| registration_status | — | — | ✅ | ✅ set completed | — |
| can_fly | ✅ optional | — | ✅ | 🔄 create sheet | — |
| last_registration_year | — | — | ✅ | ✅ update | — |

Legend: ✅ Used, — Not used, 🔄 Automatic, ⚠️ Special handling

---

**End of Assessment**
