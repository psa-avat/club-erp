# Accounting Specification: UX/UI Challenges & Design Responses

**Date**: May 4, 2026  
**Prepared by**: Senior UX/UI Architect  
**Reference Images**: AeroOps accounting system  

---

## Executive Summary

The SPEC_ACCOUNTING.md provides excellent business logic and data governance rules, but leaves critical UX/UI questions unanswered that affect usability and user trust. This document identifies **7 key challenges** and provides **concrete UX/UI responses** aligned with the reference interfaces.

---

## Challenge 1: Fiscal Year Partitioning Invisibility

### The Problem (Spec §3.1, 5, 8)

The specification explicitly partitions all accounting data by fiscal year:
- "accounting_entries and accounting_lines are partitioned by LIST(fiscal_year_uuid)"
- "Fiscal year is explicit and first-class"
- Yet the spec provides **no UI guidance** on how users interact with this fundamental constraint

### UX/UI Risk

Users accidentally:
- Post entries to the wrong fiscal year
- Create pricing versions that overlap with the wrong FY
- Confuse FY 2026 budgets with FY 2026-27 budgets
- Don't realize they're viewing a closed fiscal year (no edit rights)

### Design Response: Persistent FY Context

**1. Top Navigation Bar** (always visible)
```
┌─ Teal Background (brand color)
├─ Left: Logo + "Accounting" breadcrumb
├─ Center: [Current FY: 2026-01-01 → 2026-12-31] ← FY Hero Badge
│          (color-coded: green=open, gray=closed, amber=reopened)
├─ Right: User menu
└─ Subtitle: "Status: Open | Last Posted Entry: Entry #BK-2026-0045"
```

**2. Page-Level Indication**
```
Every accounting page header shows:
┌─ [FY 2026 ▼ Switch] [Status: Open ▼]
├─ Breadcrumb: Accounting > Ledger > Entries
└─ Hero Summary (for that FY):
   Total Debits (FY2026): €1.2M | Total Credits: €1.2M | Entries: 847
```

**3. Form Context** (every create/edit form)
```
New Accounting Entry
Fiscal Year: [2026] (Pills showing 2025, 2026, 2027 available)
              └─ Clicking pill switches context + reloads form
```

**4. Table Context** (every data table)
```
Ledger for FY 2026 (2026-01-01 to 2026-12-31)
[Column header shows FY + date range]
```

**5. Data Isolation**
- **No mix**: If user is viewing FY 2026, they cannot see FY 2027 data
- **Switching**: Clicking "FY 2027" navigates to FY 2027 view (dashboard refreshes)
- **Privilege**: Only CLOSE_FISCAL_YEAR role can see closed FY reopen option

---

## Challenge 2: Posted Entry Immutability Not Visually Clear

### The Problem (Spec §4, 14.1)

The specification mandates:
- "Posted entries are immutable"
- "Corrections on posted entries are represented by reversal/correction entries only"

But the spec doesn't address:
- How do users know an entry is locked?
- What do they see when they click "Edit" on a posted entry?
- How discoverable is the reversal workflow?

### UX/UI Risk

Users:
- Attempt to "just fix a typo" in posted entry (error: "Cannot update posted entry")
- Get frustrated at "broken" UI (no edit button visible)
- Don't realize reversal is the intended workflow
- Escalate to staff instead of self-serve

### Design Response: Multi-Layered Immutability Signals

**1. Entry List Table** (visual state)
```
Entry # | Date | Description | State | Debit | Credit
─────────────────────────────────────
BK-2026-0045 | 2026-03-15 | Payment | ✓ POSTED | €1,250 | —
              (green badge)
              └─ Hover: "Posted 2026-03-15 by Admin. Immutable."

BK-2026-0044 | 2026-03-15 | Invoice | ⊙ DRAFT | €500 | —
              (yellow badge)
              └─ Hover: "Draft - Edit until posted"
```

**2. Entry Detail View** (posted = read-only)
```
┌─ Entry #BK-2026-0045
├─ Status Badge: [✓ POSTED] (large, green, prominent)
│  Subtext: "Posted by Admin on 2026-03-15 14:23:00"
│
├─ All Input Fields: DISABLED
│   Date: [2026-03-15] ← grayed out, no picker
│   Journal: [BQ] ← grayed out, no dropdown
│   Lines: (read-only table, no delete buttons)
│
├─ Lock Icon + Message:
│   🔒 This entry is posted and cannot be edited.
│   Reason: Posted entries are immutable for audit compliance.
│
└─ Action: [Reverse This Entry ▼]
    ├─ Option 1: Reverse with reason
    ├─ Option 2: Reverse and create new entry
    └─ Submenu shows: "Create new draft entry with opposite amounts"
```

**3. Draft Entry View** (editable)
```
┌─ Entry #(new, unsaved)
├─ Status Badge: [⊙ DRAFT] (yellow, editable)
│  Subtext: "Editable until posted"
│
├─ All Input Fields: ENABLED
│   Date: [2026-03-15 📅] ← blue border, interactive
│   Journal: [BQ ▼] ← interactive dropdown
│   Lines: (rows have delete buttons)
│
└─ Actions:
   [Cancel] [Save Draft] [Post Entry] ← bright blue
```

**4. Reversal Workflow** (clear, modal-based)
```
[Reverse Entry Modal]

Current Entry: #BK-2026-0045
Description: "Payment - Flight Log 47652"
Debit: 411 (Member Receivable) | €1,250
Credit: 512 (Bank Account) | €1,250

Reversal Reason: [Free text input]
└─ "Paid twice by mistake, reversal for correct processing"

[What will happen]
✓ Original entry #BK-2026-0045 remains POSTED and unchanged
✓ New DRAFT entry will be created with reversed amounts:
  Debit: 512 (Bank Account) | €1,250
  Credit: 411 (Member Receivable) | €1,250
✓ New entry linked to original via reversal_of_entry_uuid
✓ You can review, then post the reversal

[Cancel] [Create Reversal Draft]
```

---

## Challenge 3: Pricing Version Lifecycle Governance Missing UI

### The Problem (Spec §3.4, 9.1, 18, Phase 2)

The specification requires complex pricing governance:
- Draft versions are **fully editable**
- Active versions are **immutable for billing** (locked)
- Active versions can conditionally **revert to Draft** (only if never used)
- Once a version is **used** for billing, reverting is **forbidden** (auditability)

Yet the spec provides **zero UI guidance** on:
- How does user activate a pricing version?
- What does "locked" look like in the UI?
- How do they know if a version has been used?
- What happens when they try to revert a used version?

### UX/UI Risk

Users:
- Activate a version, then realize they forgot to set GL accounts (too late, no preview)
- Attempt to edit active versions (error: "Cannot edit active version")
- Don't understand "locked" terminology (technical term, not user-friendly)
- Revert an active version, breaking historical accounting data reproducibility

### Design Response: Version Lifecycle Card UI

**1. Pricing Version Timeline** (visual hierarchy)
```
┌─ Fiscal Year Timeline (horizontal scroll)
│
├─ FY 2025 Card (Archived, far left, grayed)
│  ┌─ FY 2025 Pricing [ARCHIVED]
│  ├─ Status: Gray tag "ARCHIVED"
│  ├─ Validity: 2025-01-01 → 2025-12-31
│  ├─ Items: 12
│  ├─ Used: 847 entries generated, all posted
│  └─ Actions: [View] [Export] (read-only)
│
├─ FY 2026 Card (Active, center, highlighted teal)
│  ┌─ FY 2026 Pricing [ACTIVE]
│  ├─ Status: Green tag "ACTIVE" (large)
│  ├─ Validity: 2026-01-01 → 2026-12-31
│  ├─ Items: 12
│  ├─ Locked: 🔒 YES (locked for billing)
│  ├─ Used: 847 draft entries, 723 posted
│  │  First Used: 2026-01-15 09:00:00
│  ├─ Description: "Standard FY2026 pricing. Immutable due to active usage."
│  └─ Actions: 
│      [Preview] [Make Copy to Draft] [Archive] [Revert] (disabled + tooltip)
│      └─ Revert tooltip: "Version was used for 723 posted entries. 
│         Reverting would break auditability. Create a new draft 
│         version by copying instead."
│
├─ FY 2027 Card (Draft, right, amber)
│  ┌─ FY 2027 Pricing [DRAFT]
│  ├─ Status: Amber tag "DRAFT" (editable)
│  ├─ Validity: 2027-01-01 → 2027-12-31 (set early for prep)
│  ├─ Items: 8 (incomplete)
│  ├─ Locked: ☐ NO (fully editable)
│  ├─ Missing Before Activation:
│  │  ⚠ 4 items missing GL account credit assignment
│  ├─ Progress: 8/12 items complete (66%)
│  └─ Actions: [Edit] [Activate] (disabled) [Preview] [Delete]
│      └─ Activate disabled: "Missing GL account mappings (4 items). 
│         Complete before activation."
│
└─ Legend: Green=Active | Amber=Draft | Gray=Archived | 🔒=Locked
```

**2. Preview Mode** (read-only visual of active version)
```
[Pricing Version: FY 2026 - Preview Mode]

Status: ACTIVE (🔒 Locked for billing) | Read-only view

Items (immutable):
│ # | Name | Unit | Base Price | GL Account Credit | Tiers | Actions
├─ 1 | Membership Annual | Fixed | €500.00 | 7061 | No | [View]
├─ 2 | Flight Time | FlightTime | €85.00 | 7062 | Yes (3 tiers) | [View]
├─ 3 | Tow Service | PerFlight | €40.00 | 7063 | Yes (2 tiers) | [View]
└─ ... (9 more items)

Note: This version is ACTIVE and cannot be edited.
To make changes, create a new draft version:
[Make Copy to Draft] → New version inherits this structure (editable)
```

**3. Edit Mode** (draft version, fully editable)
```
[Pricing Version: FY 2027 - Draft Mode]

Status: DRAFT (✏️ Editable) | Changes in progress

Items (editable):
│ # | Name | Unit | Base Price | GL Account | Tiers | Status | Actions
├─ 1 | Membership Annual | Fixed | €500.00 | 7061 ✓ | No | Complete | [Edit] [Delete]
├─ 2 | Flight Time | FlightTime | €85.00 | — ⚠ | Yes | Incomplete | [Edit] [Delete]
├─ 3 | Tow Service | PerFlight | €40.00 | 7063 ✓ | Yes | Complete | [Edit] [Delete]
└─ [+ Add Item]

Activation Readiness:
├─ Items Complete: 10/12 (83%)
├─ Required Fields: 
│  └─ ⚠ Flight Time is missing GL Account Credit assignment
├─ Date Overlap Check: 
│  └─ ✓ No conflicts with other versions
└─ [Edit Item] to complete GL mapping, then [Activate]
```

**4. Activation Confirmation Dialog**
```
Activate Pricing Version: FY 2027

You are about to activate this version. This will:
✓ Lock all pricing items for billing consistency
✓ Mark it as the active version for FY 2027
✓ Enable it for billing workflows
✓ Prevent reverting to draft (unless never used)

Current Status: DRAFT
Items: 12 complete
Validity: 2027-01-01 → 2027-12-31

[Cancel] [Activate]
```

**5. Revert Disabled State** (when version was used)
```
[Pricing Version: FY 2026 - Active Mode]

Actions:
├─ [Preview] ← click to view immutable data
├─ [Make Copy to Draft] ← recommended way to edit
├─ [Archive] ← retire this version
└─ [Revert to Draft] (disabled, grayed out)

Hover on [Revert to Draft]:
"⚠ This version cannot be reverted because it was used 
 for 723 posted accounting entries. Reverting would break 
 auditability and reproducibility of historical transactions.
 
 To make changes, click [Make Copy to Draft] to create a new 
 editable draft based on this version."
```

---

## Challenge 4: Cost Provision Rules Complexity (Phase 2b)

### The Problem (Spec §11)

Phase 2b introduces cost provision rules:
- Real-time vs batch accrual methods
- Asset-specific metrics (engine hours, launches, etc.)
- Staging queue for batch processing
- Daily/monthly batch job scheduling

The spec **lacks UI clarity** on:
- How does a user understand the difference between real-time and batch?
- How do they know if accruals are pending or completed?
- What errors can occur during batch runs?
- How do they verify cost accruals are correct?

### UX/UI Risk

Users:
- Don't understand why accruals sometimes are immediate, sometimes delayed
- Miss pending accruals that need manual review
- Don't realize batch job failed overnight
- Can't debug GL account mismatches

### Design Response: Cost Accrual Dashboard

**1. Rule Management UI** (simplified metaphor)
```
[Cost Provision Rules - Asset Type: ASK21 Glider]

Active Rules:
│ Metric | Cost/Unit | Accrual Method | GL Accounts | Status | Actions
├─ Engine Hours | €10.00 | 🚀 Real-time | 681→281 | Active | [Edit] [Pause]
│                          (immediate posting)
├─ Landings | €50.00 | 📅 Batch-Daily | 682→288 | Active | [Edit] [Pause]
│                       (collected daily)
└─ [+ New Rule]

Rule Metaphors (making batch concepts accessible):
├─ 🚀 Real-time: "Like a cash register - posted immediately when event happens"
├─ 📅 Batch-Daily: "Like collecting receipts at end of day, then recording once"
└─ 📊 Batch-Monthly: "Like a monthly reconciliation at month-end"

[Create New Rule] [Import from Previous FY]
```

**2. Staging Queue & Batch Status** (transparency)
```
[Cost Accrual Staging & Batch Jobs]

Active Staging Queue (pending posting):
Date | Asset | Metric | Value | Cost | Rule | GL Debit | GL Credit | Status | Action
─────────────────────────────────────────────────────────────────────────
2026-05-03 | ASK21 | engine_hours | 5.5 hrs | €55.00 | Rule #1 | 681 | 281 | Staged | [Post Now]
2026-05-03 | Tow-X | flight_hours | 3 flights | €75.00 | Rule #2 | 605 | 406 | Staged | [Post Now]
2026-05-02 | Winch | launches | 47 | €235.00 | Rule #3 | 686 | 287 | Posted ✓ | [View Entry]

Total Pending: €165.00 (will post in next batch job)

Batch Job Schedule:
├─ Daily Batch: Runs at 23:59 UTC
│  Last Run: 2026-05-03 23:59:00 ✓ (2 accruals processed, €290 cost)
│  Next Run: 2026-05-04 23:59:00 (tomorrow)
│  [Trigger Manual Batch Now] (admin only)
│
├─ Monthly Close: Runs on 1st at 02:00 UTC
│  Last Run: 2026-05-01 02:00:00 ✓ (12 accruals processed)
│  Next Run: 2026-06-01 02:00:00
│  └─ [View Last Month's Summary]

Batch Job Error Queue (if any):
├─ ⚠ 2026-05-02 batch failed: GL account 281 not found (asset ASK21 rule #1)
│  └─ Action: [Fix GL Account in Rule] [Retry Batch] [Skip]
└─ ⚠ 2026-05-01 batch incomplete: Only 8/10 accruals posted (2 skipped)
   └─ [View Details] [Retry Failed Items]
```

**3. Asset Accrual History** (verification)
```
[Asset: ASK21 Glider - Accrual History]

Rule: Engine Hours | Cost: €10/hour | Status: Real-time

Date | Event | Metric | Cost | GL Entry | Status
────────────────────────────────
2026-05-03 | Flight GLI-2026-0847 | 5.5 hrs | €55.00 | AC-2026-0234 ✓ | Posted
2026-05-02 | Flight GLI-2026-0846 | 3.2 hrs | €32.00 | AC-2026-0233 ✓ | Posted
2026-05-02 | Flight GLI-2026-0845 | 4.1 hrs | €41.00 | AC-2026-0232 ✓ | Posted
2026-05-01 | Flight GLI-2026-0844 | 2.8 hrs | €28.00 | AC-2026-0231 ✓ | Posted

Total Accrued (FY2026): 47.3 hrs × €10 = €473.00
GL Balance (Account 281): €473.00 ✓ Reconciled
```

---

## Challenge 5: Age Discount Logic Must Be Transparent

### The Problem (Spec §3.5, 9)

The specification defines age discount eligibility:
- "A member is under-25 eligible if their computed age on January 1 of the active fiscal year is strictly < 25"
- "Age is computed from members.date_of_birth"
- Discount is applied at **billing time** (not at registration)

The spec **lacks UI guidance** on:
- How does a member know they're eligible?
- When is the discount calculated? (At purchase? At posting?)
- Can the discount be changed after billing?
- How is it represented in the accounting entry?

### UX/UI Risk

Users (members):
- Don't understand why they got/didn't get a discount
- Expect discount to apply retroactively if DOB changes
- Think discount applies to all items (vs. pricing-item-specific)

Staff:
- Can't easily identify eligible members
- Don't know when discount was applied to a posted entry
- Can't audit discount calculations

### Design Response: Transparent Age Eligibility

**1. Member Eligibility Badge** (everywhere member is shown)
```
Member: Alice Lee [⭐ U25 Eligible - Age 23 on 2026-01-01]
        └─ Hover: "Eligible for age discounts (< 25 on FY start date)"

Member: Bob Johnson [—No discount]
        └─ Hover: "Not eligible (age ≥ 25 on FY start date)"

Member: Carol Davis [⚠ DOB Missing]
        └─ Hover: "Age cannot be calculated (DOB not provided). No discount applied."
```

**2. Pricing Item Discount Visibility** (product listing)
```
Pricing Version: FY 2026 Standard

Item: Flight Time (Glider)
├─ Base Price: €85.00/hour
├─ Age Discount: 15% (for U25 members)
│  └─ Eligible: Members age < 25 on 2026-01-01
│  └─ Discount Calculation: €85.00 × 0.15 = €12.75 off
│  └─ Final Price (U25): €72.25/hour
└─ Tiers: [3 progressive brackets available]

Item: Membership Annual
├─ Base Price: €500.00/year
├─ Age Discount: 0% (no discount applies)
├─ Final Price (U25): €500.00 (same for all ages)
└─ Tiers: None
```

**3. Member Self-Service Registration** (discount preview)
```
[Register for FY 2026 - Step 2: Billing Preview]

Member: Alice Lee
Age Status: ⭐ U25 Eligible (Age 23 on 2026-01-01)

Products:
├─ Flight Time Subscription: €85.00/hour
│  Age Discount (15%): -€12.75
│  Subtotal: €72.25/hour
│
├─ Annual Membership: €500.00
│  Age Discount: None (0%)
│  Subtotal: €500.00
│
└─ Monthly Membership Fee: €45.00/month
   Age Discount (10%): -€4.50
   Subtotal: €40.50/month

Total First Payment: €1,012.75
└─ [Generated Accounting Entry]
   Debit: 411 (Member Receivable - Alice Lee) | €1,012.75
   Credit: 7061 (Membership Revenue) | €500.00
   Credit: 7062 (Flight Time Revenue) | €72.25
   Credit: 7063 (Misc Revenue) | €40.50

[Confirm & Post] [Edit] [Cancel]
```

**4. Accounting Entry Entry Memo** (audit trail)
```
Posted Entry: #VT-2026-0123

Header:
├─ Date: 2026-01-15
├─ Member: Alice Lee (DOB: 2003-05-10)
├─ Description: "Annual Membership + Flight Time subscription FY2026"
└─ Audit Memo:
   "U25 Discount Applied. Age on 2026-01-01: 23 (eligible, < 25)
    Pricing Version: FY 2026 Standard
    Discount %: Flight Time 15%, Membership 0%
    Calculated: €1,012.75 after discounts
    Note: If member's DOB or pricing version changes, discounts 
    are not retroactively recalculated. Only new entries are affected."

Lines:
├─ 411 (Member Receivable) | Debit: €1,012.75 | [Member: Alice Lee] [Asset: —]
├─ 7061 (Membership Revenue) | Credit: €500.00
├─ 7062 (Flight Revenue) | Credit: €72.25 (includes 15% U25 discount)
└─ 7063 (Misc Revenue) | Credit: €40.50
```

**5. Staff Audit Report** (verify discounts)
```
[Reports: Age Discount Audit - FY 2026]

Discounts Applied in FY 2026:
├─ Total Discounts Given: €3,450.00 (2.8% of total revenue)
├─ Members Eligible: 47 (age < 25)
├─ Members Ineligible: 156 (age ≥ 25)
├─ Members DOB Unknown: 8 (no discount)

Breakdown by Item:
│ Item | Base Revenue | Discounts | Final Revenue | Members Affected
├─ Flight Time | €78,400 | €3,200 (4.1%) | €75,200 | 47 U25 members (1.5h/member avg)
├─ Membership | €64,500 | €250 (0.4%) | €64,250 | 5 full-year U25 members
└─ Instruction | €18,900 | €0 (0%) | €18,900 | (no discount applies)

[Export Report] [Send to Treasurer]
```

---

## Challenge 6: Fiscal Year Close/Reopen Privilege Must Be Clear

### The Problem (Spec §2, 6, 14)

The specification requires:
- "Fiscal year close/reopen requires privileged capability checks"
- Only roles with `CLOSE_FISCAL_YEAR` capability can close or reopen years
- Once closed, "Posted entries are immutable" (already mandated, but year-wide enforcement)

The spec **lacks UI clarity** on:
- How is this privilege communicated?
- What can/can't users do in a closed FY?
- How does the reopen workflow work?
- What warnings prevent accidental closure?

### UX/UI Risk

Users:
- Accidentally post to a closed FY (error: "Closed FY")
- Attempt to reopen without understanding consequences
- Don't realize they need special privilege to close

Accountants:
- Unsure if they can reopen a closed year
- Don't know which capability they need

### Design Response: Fiscal Year Admin UI

**1. Fiscal Year List** (admin only)
```
[Administration: Fiscal Years]

[+ New Fiscal Year] [Import Previous Structure]

Fiscal Years:
│ FY | Start Date | End Date | State | Entries Posted | Budget Status | Actions
├─ 2024 | 2024-01-01 | 2024-12-31 | CLOSED | 1,247 | Closed | [View] [Reopen]
├─ 2025 | 2025-01-01 | 2025-12-31 | OPEN | 847 | Active | [View] [Close] [Archive]
├─ 2026 | 2026-01-01 | 2026-12-31 | CLOSED | 562 | Active | [View] [Reopen]
└─ 2027 | 2027-01-01 | 2027-12-31 | OPEN | 0 | Draft | [View] [Close] (disabled)
```

**2. FY Detail & Close Workflow** (modal)
```
[Fiscal Year Details & Close]

Fiscal Year 2025:
├─ Start Date: 2025-01-01
├─ End Date: 2025-12-31
├─ State: OPEN ✏️
├─ Created: 2024-12-15 by Admin
├─ Entries Posted: 847
├─ Draft Entries: 12
├─ Budgets Created: 1
├─ Pricing Versions: 3 (1 active)

Pre-Close Checklist:
├─ ✓ All expected entries posted (847 entries, no drafts blocking)
├─ ✓ Ledger balanced (Debit = Credit)
├─ ✓ All revenues reconciled
├─ ✓ Bank reconciliation complete
├─ ⚠ 12 Draft entries will remain in system (cannot post after close)

[Next: Close FY 2025]
```

**3. Close Confirmation** (irreversible action)
```
[CONFIRM: Close Fiscal Year 2025]

⚠️ WARNING: This action is irreversible.

Closing FY 2025 will:
✓ Lock all entries (no new posts allowed)
✓ Preserve all posted transactions (archived, read-only)
✓ Keep draft entries visible but unpublishable
✓ Enable FY 2026 as operational year
✓ Seal audit trail (no edits to any entries in FY 2025)

Required Confirmations:
├─ ☐ I have reconciled all bank and investment accounts
├─ ☐ I have reviewed and approved all pending journal entries
├─ ☐ I have confirmed no further entries will be added to FY 2025
├─ ☐ I understand closing is irreversible

[Cancel] [Close Fiscal Year 2025]
```

**4. Closed FY View** (read-only, immutable)
```
[Fiscal Year 2025 - CLOSED]

Status: 🔒 CLOSED (read-only, all transactions archived)
Closed: 2025-12-31 by Treasurer Jane Doe
Posted Entries: 847 (immutable)
Draft Entries: 12 (cannot post)

All entries locked:
├─ Cannot create new entries in FY 2025
├─ Cannot edit posted entries
├─ Cannot post draft entries
├─ Cannot change accounts
└─ Only view and export available

Actions:
├─ [View Entries] (read-only list)
├─ [Export Ledger] (PDF or CSV)
├─ [View Reports] (Balance Sheet, Income Statement)
└─ [Reopen FY] (admin/treasurer only, requires approval)
   └─ Hover: "Reopening will allow edits. Use only for corrections."
```

**5. Reopen Confirmation** (requires explicit approval)
```
[REQUEST: Reopen Fiscal Year 2025]

⚠️ WARNING: Reopening a closed year is unusual.

Reopening FY 2025 will:
✓ Allow posting new entries to FY 2025
✓ Allow editing draft entries
✓ Require immediate closure again after edits (no indefinite reopening)
✓ Audit log will show who reopened and when

Reason for Reopening:
[Free text: e.g., "Correction for Q3 accrual error found"]

[Cancel] [Reopen FY 2025]

Note: Your action will be logged in the audit trail. 
Only accountants with CLOSE_FISCAL_YEAR capability can reopen.
```

**6. Reopened FY Visual Indicator** (during editing)
```
[Fiscal Year 2025 - REOPENED FOR CORRECTIONS]

Status: ⚠️ REOPENED (temporarily unlocked for edits)
Reopened: 2026-01-10 by Treasurer Jane Doe
Reopened Reason: "Correction for Q3 accrual error"

Note: This year was closed and is temporarily reopened for corrections.
After corrections are complete, it should be closed again immediately.

Entries added/edited during reopening:
├─ Entry #AC-2025-9847 | Accrual correction | Posted 2026-01-10
├─ [+ Add Entry]
└─ [When Done, Close Again ▼]
```

---

## Challenge 7: GL Account Mapping Validation Before Activation

### The Problem (Spec §3.4, §3.5, §9.2)

The specification mandates:
- Pricing items must have `gl_account_credit_uuid` set before version activation
- "NULL is allowed during setup; the version activation guard should require it to be set"
- But **no UI guidance** on:
  - How does user know which GL account to map?
  - What if they choose wrong (e.g., expense account instead of revenue)?
  - How is this validated in real-time vs. at activation?

### UX/UI Risk

Users:
- Map wrong GL account (e.g., 4000 expense instead of 7062 revenue)
- Leave GL account empty, then get blocked at activation with no guidance
- Don't understand GL account hierarchy
- Spend time selecting correct account from long, unfamiliar list

### Design Response: Contextual GL Account Selection

**1. Pricing Item Edit Form** (real-time validation)
```
[Edit Pricing Item: Flight Time Glider]

GL Account Credit (Revenue Account): [? Select Required] *
├─ Hint: "Where should flight revenue be credited? Usually in 70xx (Revenue)"
├─ Recommendation: Based on item type (Flight Time → 7062 typically)
│
├─ Dropdown with smart suggestions:
│  ┌─ Suggested (typical for this item):
│  │  ├─ 7062 - Flight Revenue (General)  [Most Common]
│  │  ├─ 7063 - Flight Revenue (Member Training)
│  │  └─ 7064 - Flight Revenue (Intro Events)
│  │
│  ├─ All Revenue Accounts (70xx):
│  │  ├─ 7061 - Membership Revenue
│  │  ├─ 7062 - Flight Revenue
│  │  ├─ 7063 - Tow Service Revenue
│  │  ├─ 7064 - Instruction Revenue
│  │  ├─ 7065 - Boutique Sales
│  │  └─ ... (8 more)
│  │
│  └─ Other Postable Accounts:
│     └─ (disabled, not recommended)
│
├─ Search: [Flight] → filters to "7062 - Flight Revenue" ✓
│
├─ Selected: [7062 - Flight Revenue] ✓
│  └─ Account Info (inline):
│     - Account Type: Revenue
│     - Currently Postable: ✓ Yes
│     - GL Balance (FY2026): €125,340.00
```

**2. GL Account Validation at Activation** (pre-flight check)
```
[Pricing Version Pre-Activation Checklist]

Item-by-Item GL Account Validation:
│ Item # | Item Name | GL Account | Status | Error
├─ 1 | Membership Annual | 7061 | ✓ Valid | —
├─ 2 | Flight Time | 7062 | ✓ Valid | —
├─ 3 | Tow Service | 4000 | ✗ INVALID | ⚠ Account type is Expense, expected Revenue
├─ 4 | Instruction | — | ✗ MISSING | ⚠ GL Account not assigned
└─ 5 | Fuel Surcharge | 7065 | ✓ Valid | —

Validation Issues Found: 2
├─ ⚠ Item #3: "4000 - Purchases" is an Expense account. 
│  Revenue items must credit a Revenue account (7xxx).
│  Suggestion: Use "7062 - Flight Revenue" or similar.
│  [Fix Item #3]
│
├─ ⚠ Item #4: GL Account not assigned.
│  Suggestion: Use "7064 - Instruction Revenue"
│  [Fix Item #4]
│
└─ [Fix All Issues] [Cancel Activation]
```

**3. Debit Side (Member Receivable)** (auto-resolved, hidden from user)
```
[Pricing Item Details: Flight Time]

├─ Base Price: €85.00
├─ Credit Account (Revenue): [7062 - Flight Revenue] *
│  └─ User selects ✓
│
├─ Debit Account (Auto-resolved):
│  └─ 411 - Member Receivable [auto]
│     └─ Explanation: "Member receivables are always debited when billing.
│        This account is resolved at billing time from system defaults.
│        You don't need to set it here."
│
└─ Accounting Entry Pattern (Preview):
   Debit: 411 (Member Receivable) | auto-determined
   Credit: 7062 (Flight Revenue) | your selection ✓
```

**4. GL Account Error Recovery** (if wrong account selected)
```
[Activated Pricing Version - GL Account Mismatch Detected]

⚠️ ERROR IN LIVE PRICING VERSION

Version: FY 2026 Standard (ACTIVE)
Issue: Item #3 "Tow Service" has invalid GL account mapping

Current GL Account: 4000 - Purchases (Expense Account)
Expected GL Account Type: Revenue Account (7xxx)

Impact: Entries generated from this item will post to wrong ledger section.
Affects: 0 entries so far (early detection)

Actions:
├─ [Make Copy to Draft] → Create new draft version, fix GL account, re-activate
├─ [Report Issue] → Notify accountant to investigate
└─ [Disable Item] → Temporarily disable "Tow Service" from being used

⚠️ We recommend making a corrected draft version immediately.
```

---

## Summary: Design Challenges & Responses

| Challenge | Specification Gap | Design Solution |
|-----------|-------------------|-----------------|
| **1. FY Partitioning Invisibility** | No UI guidance on FY context | Persistent FY selector + color-coded badges in all views |
| **2. Posted Immutability Unclear** | No visual signal for read-only state | Lock icon + disabled inputs + reversal workflow modal |
| **3. Pricing Lifecycle Governance** | No UI for version states/transitions | Timeline + card UI + conditional button states + tooltips |
| **4. Cost Provision Complexity** | Batch vs real-time not explained | Dashboard metaphors (🚀 real-time, 📅 batch) + staging queue |
| **5. Age Discount Logic** | Calculated at billing, not transparent | Eligibility badge + preview calculations + audit memo |
| **6. Fiscal Year Close/Reopen** | Privilege requirements unclear | Admin-only UI + irreversible action confirmations + reopen warnings |
| **7. GL Account Mapping** | No guidance on correct accounts | Smart suggestions + item-type hints + validation at activation |

---

## Implementation Priorities

### Phase 1 (Weeks 1-4): Foundational Clarity
- FY selector & persistent context
- Posted entry immutability signals
- GL account validation

### Phase 2 (Weeks 5-7): Pricing Governance
- Version lifecycle UI (timeline, cards)
- Preview mode & revert prevention
- Activation validation

### Phase 2b (Weeks 8-9): Cost Provision
- Rule management (simplified metaphors)
- Staging dashboard + batch status

### Phase 3+ (Weeks 10+): Advanced Features
- Age discount preview
- FY close/reopen workflow
- Audit reporting

---

## Conclusion

The SPEC_ACCOUNTING.md provides rigorous business logic, but translating it into a usable UX requires:
1. **Persistent Context**: Fiscal years, posting state, locking status always visible
2. **Real-Time Feedback**: Validation errors inline, not in error dialogs
3. **Progressive Disclosure**: Simple workflows first; advanced options revealed gradually
4. **Accessibility**: Keyboard navigation, clear labels, semantic HTML

This design document bridges the gap between specification and implementation, challenging vague requirements with concrete UX patterns proven effective in professional accounting systems.
