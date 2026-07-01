# Accounting UX/UI Implementation Plan

**Date**: May 4, 2026  
**Based on**: SPEC_ACCOUNTING.md + Reference Interfaces (AeroOps)  
**Architecture**: Shell + Module pattern (Vite/React/TypeScript)  

## Executive Summary

This plan translates the Accounting specification into a cohesive, accessible UX/UI implementation aligned with professional accounting software practices (demonstrated by AeroOps, Xero, Wave) while respecting the gliding club's lean operational context.

### UX/UI Design Principles
1. **Financial Clarity**: Every number has a source, state, and audit trail.
2. **Constraint Visibility**: Fiscal year, posting state, and lock status are always visible.
3. **Progressive Disclosure**: Simple workflows first; advanced options revealed only when needed.
4. **Template Reuse**: Recurring transactions are prefilled, not re-entered.
5. **Real-Time Validation**: Feedback on balance, date ranges, and GL account mappings inline.
6. **Accessibility**: WCAG 2.1 AA; keyboard navigation; semantic HTML; clear error messages.

---

## Architecture & State Management

### Global Fiscal Year Context (Shell Level)
**Important**: FY selection is now global (not per-module). See `ARCHITECTURE_GLOBAL_FISCAL_YEAR.md`.

```
frontend/src/
├── store/
│   └── fiscalYearStore.ts              # Global Zustand store (persisted)
│       ├── activeFiscalYearUuid
│       ├── secondaryFiscalYearUuid (for budget FY+1)
│       └── activeFiscalYearData (metadata: dates, state)
├── context/
│   └── FiscalYearContext.tsx           # Optional, for deep components
└── components/
    └── TopNavigation.tsx               # FY selector lives here (shared across all modules)
```

**Result**: No per-module FY selection. All queries auto-scoped via `useFiscalYearStore()`.

### Module Structure
```
frontend/src/modules/accounting/
├── api/                          # TanStack Query hooks
│   ├── queries.ts               # GET endpoints (use global FY from store)
│   ├── mutations.ts             # POST/PUT/PATCH endpoints
│   └── types.ts                 # Response/request types
├── components/
│   ├── shared/                  # Reusable components
│   │   ├── EntryStateTag.tsx    # (FY selector now in TopNav, not here)
│   │   ├── LockedWarning.tsx
│   │   └── BalanceIndicator.tsx
│   ├── ledger/                  # Ledger view components
│   ├── entries/                 # Entry create/edit/view
│   ├── pricing/                 # Pricing version management
│   ├── budget/                  # Budget lifecycle (can override with secondary FY)
│   ├── costing/                 # Cost provision rules
│   └── reports/                 # Financial statements
├── store/                        # Zustand for client state (accounting-specific)
│   ├── draftEntryStore.ts       # Working drafts not yet posted
│   └── filterStore.ts           # UI filters & pagination
├── types/                        # Local TypeScript interfaces
└── index.ts                      # Module exports
```

### State Management Strategy
- **Global Fiscal Year Store** (`frontend/src/store/fiscalYearStore.ts`): Active FY, secondary FY, metadata (persisted to localStorage)
- **TanStack Query**: All server data (accounts, entries, pricing versions) auto-scoped to active FY
- **Zustand (module-level)**: Draft entry editing (allow offline edits before posting), UI filters
- **React Context** (optional): Fiscal year (if deep components need to avoid prop drilling)
- **Decimal.js**: All numeric operations (prices, balances, thresholds)

---

## Phase 1: Core Ledger UX/UI

### 1.1 Layout & Navigation

#### Global Accounting Navigation (Shell Level)
```
Dashboard → Accounting
├── Ledger & Entries (Main)
│   ├── General Ledger (browse + search)
│   ├── Create Entry (modal or form)
│   └── Entry Templates (recurring)
├── Chart of Accounts
│   ├── Browse (hierarchical tree)
│   └── Manage (admin only)
├── Fiscal Years (admin)
│   ├── Open/Close workflow
│   └── Settings
└── Settings (module-level)
    ├── Default journals/accounts
    └── Export/integrations
```

**UX Challenge**: Fiscal year selector must be **persistent in top bar** (never hidden), visible at all times as a read-only display with inline "switch FY" option for privileged users.

### 1.2 Dashboard / Overview Screen

**Components**:
1. **Fiscal Year Hero** (top, full width)
   - Current FY badge (e.g., "FY 2026-01-01 to 2026-12-31")
   - State indicator (Open / Closed / Reopened)
   - Admin button: Close / Reopen (visible only if CLOSE_FISCAL_YEAR capability)

2. **Quick Stats Cards** (4 columns)
   - Total Debit Posted (€)
   - Total Credit Posted (€)
   - Pending Drafts (count)
   - Accounts Active (count)

3. **Recent Entries Table** (last 10)
   - Entry # | Date | Journal | Description | Debit | Credit | State

4. **Quick Actions** (buttons)
   - + New Entry
   - + New Template
   - View All Entries
   - Reconciliation Check

---

### 1.3 General Ledger View

**Screen**: `/accounting/ledger`

**Layout**:
```
┌─ Fiscal Year Selector [2026 ▼] Status: Open
├─ Filters
│  ├─ Journal [All ▼] Search-filter
│  ├─ Date Range [From] [To]
│  ├─ Entry State [All / Draft / Posted / Cancelled]
│  ├─ Search (by ref, description, account)
│  └─ [Apply] [Reset]
├─ Bulk Actions (visible only if rows selected)
│  └─ [Archive Selected] [Export CSV]
└─ Table: Paginated Results (20 rows/page)
   Columns: # | Entry# | Date | Journal | Ref | Acct | Description | Debit | Credit | State | Posted By | Actions
   
   ├─ Expandable Row (click) → Linked Lines Detail
   ├─ State Tags (Draft=yellow, Posted=green, Cancelled=red)
   └─ Actions: View | Edit (draft only) | Reverse | Download
```

**Accessibility**:
- Sort by any column (▲▼ indicator)
- Keyboard: Tab through table, Enter to expand, Escape to collapse
- Screen reader: "Table with 20 rows, Date column sorted ascending"

**Real-Time Validation**:
- As user filters, row count updates instantly
- If no results: "No entries found for FY 2026 in journal BQ"

---

### 1.4 Entry Create/Edit Form

**Screen**: `/accounting/entries/new` or `/accounting/entries/{entry_uuid}`

#### Header
```
┌─ Modal or Full Page
├─ Fiscal Year [FY 2026-01] (read-only pill)
├─ Entry State: DRAFT (yellow tag) | Edit enabled
│  (If Posted: green tag + all inputs disabled + reversal option shown)
└─ Breadcrumb: Ledger > New Entry
```

#### Form Sections

**1. Header Section** (collapsible)
```
Transaction Date: [YYYY-MM-DD picker] *
Journal: [VT / HA / BQ / CS / OD / AN / AC ▼] *
Reference: [e.g., INV-2026-0142] (optional but recommended)
Description: [Free text, ~200 chars] *
Entry State (preview): DRAFT
```

**UX Note**: Date field must validate against fiscal year boundaries with inline error: "Entry date 2027-01-01 is outside FY 2026 [2026-01-01 to 2026-12-31]"

**2. Line Items Section** (repeating rows, min 1)
```
Line # | Account | Description | Debit (€) | Credit (€) | Delete
───────────────────────────────────────────────────────────────
   1  | [4000...▼] | [text] | [0.00] | [1,250.00] | [✕]
   2  | [5120...▼] | [text] | [1,250.00] | [0.00] | [✕]
       | [+ Add Line]

Validation Feedback (real-time):
├─ Each line: debit XOR credit (not both, not neither)
└─ Entry Total: Debit = Credit → ✓ (green) or ✗ Unbalanced (red)
```

**Account Selection UX**:
- Dropdown shows hierarchical structure (collapsible)
  ```
  4 - EXPENSES
  ├─ 40 - Purchases
  │ └─ 4000 - Raw Materials
  └─ 41 - Operating
      └─ 4100 - Salaries
  ```
- Search by code or name: "fuel" → shows 606x accounts
- **Non-postable accounts** (grouping accounts) are disabled/grayed out

**3. Optional Sections**

**Member Dimension** (for entries affecting member receivables):
```
Member: [Search by name / tricode] (optional, nullable)
Member Account Snapshot: [411XX] (auto-populated from schema)
```

**Analytical Asset Dimension** (for flight-linked entries):
```
Asset: [Glider/Tow Plane ▼] (optional, nullable)
Asset UUID: [pre-filled, read-only]
```

**Project/Subvention Dimension** (Phase 4+):
```
Project: [Special Action / Subvention ▼] (optional, nullable)
```

#### Action Buttons (bottom sticky)
```
[Cancel] [Save as Draft] [Post Entry] (enabled only if balanced & valid)
```

**State Transitions**:
- Draft → Save Draft (always works, even if unbalanced)
- Draft + Balanced → Post Entry (becomes immutable, sequence # assigned)
- Posted → View Only (all inputs disabled, reversal option shown below)

---

### 1.5 Posted Entry View (Read-Only Immutable State)

**Visual Indicators**:
```
┌─ Entry #BK-2026-0045 (sequence #, assigned at posting)
├─ Status: ✓ POSTED (green tag, large)
│  Posted by: Admin User | Posted at: 2026-03-15 14:23:00 UTC
│  Locked: ✓ This entry cannot be edited.
└─ [Reverse This Entry ▼]
   └─ Reverse Reason: [Free text] → Creates reversal entry
```

**All Inputs**: Disabled (gray, no cursor)

**Supporting Documents Section**:
```
Attached Files (read-only)
├─ Service_Invoice_FCHRY.pdf (2.4 MB, uploaded 2026-03-14)
└─ Flight_Log_Extract.csv (178 KB, uploaded 2026-03-14)
```

**Audit Memo** (read-only):
```
Internal notes (visible to accountants only):
"Reconciled with bank statement. Shell Aviation payment confirmed."
```

---

### 1.6 Reversal Entry Workflow

**Scenario**: User posts entry #BK-2026-0045 and needs to undo it.

**UX**:
1. View posted entry
2. Click [Reverse This Entry ▼]
3. Modal appears:
   ```
   Reverse Entry #BK-2026-0045
   
   Reversal Reason: [Free text, e.g., "Duplicate payment"]
   Create New Draft Reversal Entry? [Cancel] [Yes, Create]
   
   Note: Original entry remains posted and immutable.
   A new draft reversal entry will be created, which you can review and post.
   ```
4. New draft entry created with:
   - Same accounts, but debit/credit swapped
   - `reversal_of_entry_uuid` = original entry UUID
   - `reversal_reason` = user input
   - State = Draft (user can review before posting)

---

### 1.7 Chart of Accounts (CoA) Browse & Admin

**Screen**: `/accounting/chart-of-accounts`

#### Browse Tab (All Users)
```
┌─ Fiscal Year [FY 2026] (selector for multi-year comparison)
├─ Class Overview (7-class structure)
│  Class 1: Capital Accounts [24 accounts]
│  Class 2: Fixed Assets [59 accounts]
│  Class 3: Inventory [12 accounts]
│  Class 4: Third Party [89 accounts]
│  Class 5: Financial [31 accounts]
│  Class 6: Expenses [98 accounts]
│  Class 7: Revenue [32 accounts]
└─ Hierarchical Tree (collapsible, expandable)
   1 - CAPITAL ET RESERVES
   ├─ 10 - CAPITAL ET CAPITAL
   │  ├─ 101 - Capital
   │  ├─ 1013 - Capital souscrit
   │  └─ [+ 3 more]
   ├─ [+ 5 more classes]
   
   ├─ Account Details (click account)
   │  Code: 4000
   │  Label: CASH AT BANK
   │  Type: Asset
   │  Postable: ✓
   │  Reconciliation: ✓
   │  Status: Active (green)
   │  GL Balance (FY 2026): €412,050.00
   └─ [Show Transactions] [Show Balance Trend]
```

**Search & Filter**:
- Search by code (e.g., "411") or name ("member receivable")
- Filter by: Type (Asset/Liability/Equity/Expense/Revenue)
- Filter by: Postability, Reconciliation flag

#### Admin Tab (MANAGE_ACCOUNTING_SETTINGS)
```
[Add New Account] [Import PCG Seed] [Export CoA]

Editable Fields (existing accounts):
├─ Code (immutable)
├─ Label
├─ Type (immutable)
├─ Postable (checkbox)
├─ Reconciliation Flag (checkbox)
├─ Archive Status (checkbox) → Hides from posting UI
├─ Replacement Account (for archival)
└─ [Save] [Cancel]

New Account Form:
├─ Code: [XXXX] * (validate PCG syntax, no dupes)
├─ Label: [text] * 
├─ Type: [Asset/Liability/Equity/Expense/Revenue ▼] *
├─ Postable: [✓] (default true)
├─ Reconciliation Flag: [☐]
└─ [Create] [Cancel]
```

---

### 1.8 Entry Templates (Recurring Transactions)

**Screen**: `/accounting/entry-templates`

#### List View
```
┌─ [+ New Template] [Manage] [Import]
├─ Filter: [Journal ▼] [Recurrence ▼] [Status ▼]
└─ Table
   Template Name | Code | Journal | Recurrence | Lines | Created | Actions
   ───────────────────────────────────────────────────────────
   AVGAS Resupply | FUEL_PURCHASE | HA | Monthly | 2 | 2026-01-15 | Edit | Use | Duplicate | Delete
   Monthly Hangar Lease | HANGAR_RENT | HA | Monthly | 1 | 2026-01-01 | ... | ...
   Clubhouse Electricity | UTILITY_BILL | HA | Quarterly | 2 | 2026-02-01 | ... | ...
```

#### Create/Edit Template Modal
```
Template Name: [AVGAS Resupply] *
Code (Unique Identifier): [FUEL_PURCHASE] * (alphanumeric, ~20 chars)
Journal: [HA ▼] *
Description (optional): [Bulk fuel purchase from terminal]
Default Reference: [e.g., INV-AVGAS-%Y%m] (optional, supports date macros)
Recurrence: [Manual / Monthly / Quarterly / Yearly ▼] *

Line Items (locked structure):
Line # | Account | Description | Debit (€) | Credit (€) | Delete
───────────────────────────────────────────────────────────────
   1  | 606100 | Fuel & Lubricants | [100%] | [0%] | [✕]
   2  | 512000 | Bank Account | [0%] | [100%] | [✕]
       | [+ Add Line]

Note: Percentages allow proportional splits.

[Save Template] [Cancel]
```

**UX Note**: Balancing is mandatory. Real-time feedback:
```
Balance Check: Debit = 100%, Credit = 100% → ✓ Balanced
```

#### Using a Template
**Scenario**: User clicks "Use" on AVGAS Resupply template.

**UX**:
1. Modal/Form appears prefilled:
   ```
   [New Entry from Template: AVGAS Resupply]
   
   Transaction Date: [Date picker, defaults to today] *
   Journal: [HA] (read-only from template)
   Reference: [INV-AVGAS-202605] (auto-populated with today's date)
   Description: [Bulk fuel purchase from terminal] (editable)
   
   Line Items (pre-filled from template):
   1 | 606100 | Fuel & Lubricants | [Qty] | €100.00 | [✕]
   2 | 512000 | Bank Account | - | €100.00 | [✕]
   
   Allowed Edits:
   ├─ Change amounts (proportional or absolute)
   ├─ Change date
   ├─ Change description
   └─ Add additional lines
   
   [Cancel] [Save as Draft] [Post Entry]
   ```

2. User edits amounts, then [Post Entry]
3. New posted entry is created with template reference captured

---

## Phase 2: Pricing Management & Governance

### 2.1 Pricing Version Lifecycle Screen

**Screen**: `/accounting/pricing`

#### Main Layout
```
┌─ Fiscal Year [2026 ▼] (selector, required)
├─ [+ New Pricing Version] [Import Template] [Export]
├─ Timeline View (horizontal scrolling)
│  ┌──────────────────────────┬────────────────────────┬──────────────┐
│  │ FY 2025 (Archived)       │ FY 2026 (ACTIVE)       │ FY 2027      │
│  │                          │ 2026-01-01→2026-12-31  │ (Preparing)  │
│  │ • Membership: €450       │ • Membership: €500     │ • Member:... │
│  │ • Flight Time: €80/h     │ • Flight Time: €85/h   │ • ...        │
│  │ (Locked, Read-only)      │ (Locked, Edit preview) │ (Draft)      │
│  └──────────────────────────┴────────────────────────┴──────────────┘
└─ Card Grid (below timeline)
   Each card = one pricing version
```

#### Pricing Version Card (Draft State)
```
┌─ FY 2026-01 Pricing (Draft)
├─ Status: DRAFT (yellow tag) | Edit enabled
├─ Validity: 2026-01-01 → 2026-12-31
├─ Items: 12 products
├─ Age Discount: 15% for U25
├─ Locked: ☐
├─ Actions: [Edit] [Preview] [Activate] [Duplicate] [Delete]
└─ Details (collapsible)
   │ Membership - €500/year
   │ Flight Time - €85/hour (includes fuel)
   │ Tow Service - €40/flight (progr. discount after 10)
   └─ [+ Add Item]
```

#### Pricing Version Card (Active State)
```
┌─ FY 2026-01 Pricing (ACTIVE)
├─ Status: ACTIVE (green tag) | Edit restricted
├─ Validity: 2026-01-01 → 2026-12-31
├─ Items: 12 products
├─ Locked: ✓ (immutable for billing)
├─ Actions: [Preview] [Archive] [Revert to Draft*]
│  *Revert disabled if used in accounting entries
└─ Used in Entries: 47 draft, 23 posted
   Last Used: 2026-05-03 14:23:00
   First Used: 2026-01-15 09:00:00
```

**UX Challenge Addressed**: 
- **Preview Mode** (Active versions): Show data in read-only layout
- **Revert Restriction**: If `first_used_at` is not NULL, revert button is disabled with tooltip: "This version was used to generate accounting entries (first used 2026-01-15). Reverting would break auditability. Create a new draft version instead."

#### Pricing Version Card (Archived State)
```
┌─ FY 2025-12 Pricing (ARCHIVED)
├─ Status: ARCHIVED (gray tag) | Read-only
├─ Validity: 2025-01-01 → 2025-12-31
├─ Items: 12 products (view-only)
├─ Actions: [View] [Export]
└─ Archived: 2026-01-15 by Admin User
```

---

### 2.2 Create/Edit Pricing Version Form

**Screen**: `/accounting/pricing/new` or `/accounting/pricing/{version_uuid}/edit`

#### Header
```
New Pricing Version for FY 2026

Step 1: Basic Info (required)
├─ Fiscal Year: [FY 2026 ▼] * (pre-selected from context)
├─ Name: [e.g., "FY2026 Standard Pricing"] *
├─ Validity From: [2026-01-01] * (date picker)
├─ Validity To: [2026-12-31] * (date picker)
│  Validation: From < To, within FY boundaries
├─ Asset Type (optional): [All / Glider ASK21 / Tow Plane ▼]
│  If set: This is asset-specific pricing (e.g., ASK21 flight time)
│  If null: Global pricing (membership, instruction)
└─ Locked: ☐ (checked = immutable, unchecked = editable)
```

#### Step 2: Pricing Items (min 1 required before activation)
```
[+ Add Pricing Item] [Import from Previous FY]

Pricing Item #1: Membership Annual
├─ Name: [Membership Annual] *
├─ Unit: [Fixed ▼] (1=Flight Time, 2=Engine Min, 3=Flight Duration, 4=Per Flight, 5=Fixed)
├─ Metric Code: [MEMBERSHIP_ANNUAL] *
├─ Base Price: [€500.00] * (NUMERIC(10,4), 2 decimals)
├─ Age Discount (%): [0.00] * (0-100, 2 decimals)
│  Tooltip: "Discount applied for members age < 25 on Jan 1 of FY"
├─ Pack Price (optional): [€0.00] (surcharge if member has active pack)
├─ GL Account Credit: [7061 - Membership Revenue ▼] * (required before activation)
│  Tooltip: "Debit side (411 member receivable) resolved at billing time"
├─ Flight Type (optional): [null ▼]
├─ Include Insurance: [☑]
├─ Include Fuel: [☑]
├─ Tiers (progressive brackets, optional)
│  │ From Qty | Price (€) | Sort Order
│  ├─ 0 | 80.00 | 1 (base)
│  ├─ 10 | 75.00 | 2 (after 10 hours)
│  ├─ 50 | 70.00 | 3 (after 50 hours)
│  └─ [+ Add Tier]
└─ [Save Item] [Cancel]
```

**Precision Validation**:
- Base price: "€500.00" (format enforced)
- Age discount: "15.50%" (0.00 - 100.00)
- from_qty: "10.5" (decimals for FlightTime only; integers for others)

#### Validation Before Activation
```
Pre-Activation Checklist:
├─ ✓ At least 1 pricing item
├─ ✓ All items have GL account credit set
├─ ✓ Date ranges don't overlap with other ACTIVE versions in FY
├─ ✓ from_date >= FY start, to_date <= FY end
└─ ✓ No gaps or overlaps in tier from_qty

If all pass: [Activate Version] enabled
If any fail: [Activate Version] disabled + error list shown
```

---

### 2.3 Pricing Item Tier Editor

**Modal** (edit tier structure inline or separate screen)

```
Pricing Item: Flight Time (Glider)
Tiers: Progressive pricing based on usage

Tier # | From Quantity | Price (€) | Description | Actions
────────────────────────────────────────────────────
   1  | 0 (base) | €85.00 | Standard rate | [Edit] [Delete]
   2  | 10.0 | €82.00 | Frequent user discount | [Edit] [Delete]
   3  | 50.0 | €80.00 | Very active discount | [Edit] [Delete]
       | [+ Add Tier]

Rules:
- from_qty must be strictly increasing (0 < 10 < 50)
- from_qty for FlightTime allows 1 decimal; others must be integers
- Each tier requires a unique price

Add Tier Modal:
├─ From Quantity: [0] * (integer or decimal depending on unit)
├─ Price (€): [€85.00] *
├─ Sort Order: [3] (auto-incremented, editable)
└─ [Create] [Cancel]
```

---

### 2.4 Age Discount UX & Billing Preview

**Question**: How should members see age-discount eligibility?

**Solution**: Add billing preview when registering.

**Registration Flow** (in members module, but generates accounting entry):
```
[Member Self-Service Registration]

Step 1: Select Membership Type
├─ Full Member: €500/year
├─ Associate: €300/year (age < 25: -15% = €255)
└─ Instruction: €100/training (flat rate)

Step 2: Age Eligibility Check
├─ Your Age on 2026-01-01: 23 (under 25)
├─ Age Discount Applied: -15% (€75)
├─ Final Price: €425
└─ [Confirm & Continue]

Step 3: Review & Authorize Accounting Entry
├─ You are being billed for:
│  └─ Annual Membership 2026: €425 (age discounted)
│
├─ This generates an accounting entry:
│  Debit: 411 (Member Receivable) | €425
│  Credit: 7061 (Membership Revenue) | €425
│
└─ [Save Entry as Draft] [Post Immediately] [Cancel]
```

**UX Principle**: Transparency on discount logic. Member sees:
1. Calculated age (DOB → age on Jan 1)
2. Eligible for discount (Y/N)
3. Final billed price
4. Accounting entry preview

---

## Phase 2b: Cost Provision Rules (New Feature)

### 2b.1 Cost Provision Rule Management

**Screen**: `/accounting/cost-provision-rules`

#### List View
```
Fiscal Year [2026 ▼]

[+ New Rule] [Import] [Export]

Table: Active Rules
Asset Type | Metric | Cost/Unit | GL Debit | GL Credit | Accrual Method | Status | Actions
────────────────────────────────────────────────────────────────────────────
ASK21 | engine_hours | €10.00 | 681 (Maintenance) | 281 (Reserve) | Real-time | Active | Edit | Pause | Delete
Tow Plane | flight_hours | €25.00 | 605 (Fuel) | 406 (Accrued) | Batch-daily | Active | ... | ...
Winch | launches | €5.00 | 686 (Equipment) | 287 (Reserve) | Batch-monthly | Active | ... | ...
```

#### Create/Edit Rule Modal
```
Cost Provision Rule

Asset Type: [ASK21 ▼] * (required)
Metric: [engine_hours ▼] * (flexible list: engine_hours, flight_hours, landings, etc.)
Cost per Unit: [€10.00] * (NUMERIC(10,4), 2 decimals)

GL Account Mapping:
├─ Debit Account: [681 - Maintenance Costs ▼] *
├─ Credit Account: [281 - Maintenance Reserve ▼] *
│  Validation: 281 must be a balance-sheet account (asset or liability)

Accrual Method: [Real-time ▼] *
├─ Real-time: Entry posted immediately when asset event is recorded
├─ Batch-daily: Aggregated at end of day
└─ Batch-monthly: Aggregated at month-end

Is Active: [✓] (uncheck to temporarily pause)

Constraint Validation:
└─ For (asset=ASK21, metric=engine_hours, FY=2026), only one active rule allowed

[Create Rule] [Cancel]
```

**UX Note**: If a rule already exists for the asset+metric+FY combination, show warning:
```
⚠ An active rule for ASK21 + engine_hours already exists:
  Cost: €12.00/hour (created by Admin on 2026-01-15)
  
  Options: [Use Existing] [Deactivate Existing & Create New] [Cancel]
```

---

### 2b.2 Cost Accrual Status Dashboard

**Widget** (on Accounting Dashboard or sub-tab)

```
Cost Accrual Staging & Batch Jobs

Active Rules: 3 | Pending Accruals: 47 | Today's Cost: €1,250.00

Staging Queue (next batch job):
Date Range | Asset | Metric | Qty | Cost | Status | Action
───────────────────────────────────────────────────
2026-05-03 | ASK21 | engine_hours | 5.5 | €55.00 | Staged | Post Now
2026-05-03 | Tow | flight_hours | 3 | €75.00 | Staged | Post Now
2026-05-02 | Winch | launches | 47 | €235.00 | Posted ✓ | View Entry

Batch Job Scheduler:
├─ Daily Batch: Runs at 23:59 UTC | Last run: 2026-05-03 23:59 | Status: ✓
├─ Monthly Close: Runs on 1st at 02:00 UTC | Last run: 2026-05-01 02:00 | Status: ✓
└─ [Trigger Manual Batch Now] (admin only)
```

---

## Phase 3: Budget Management

### 3.1 Budget Preparation Workflow

**Screen**: `/accounting/budget`

#### Budget Lifecycle Timeline
```
┌─ Fiscal Year Selection: [FY 2027 ▼] (for planning FY2027 during FY2026)
├─ Budget Status: DRAFT (editable) → ACTIVE (operational) → CLOSED (historical)
│
└─ Timeline Card
   ├─ Current FY 2026: ACTIVE (operational, locked)
   ├─ Next FY 2027: DRAFT (preparation phase, editable)
   └─ Future FY 2028: PLANNING (not yet created)
```

#### Budget Creation Modal
```
Prepare Budget for FY 2027

Step 1: Initialize From
├─ ○ From Previous Year (FY 2026): Import all accounts & amounts
│   └─ [Apply Inflation ▼] [Apply Growth %]
├─ ○ From Template: [Select Budget Template ▼]
├─ ○ From Scratch: Empty budget
└─ [Next]
```

#### Budget Line Item Editor
```
Budget for FY 2027

[+ Add Budget Line] [Import Accounts] [Apply Adjustment]

Budget Line # | Account | Description | Actual (FY2026) | Budget (FY2027) | YTD Actual | Variance | Actions
─────────────────────────────────────────────────────────────────────────────────────────
   1 | 606100 | Fuel & Lubricants | €68,340 | €72,000 | €28,500 | -€3,500 | Edit | Delete
   2 | 686100 | Maintenance | €42,100 | €44,000 | €16,200 | -€2,100 | ... | ...
   3 | 605000 | Service Contracts | €18,500 | €19,500 | €7,800 | -€1,200 | ... | ...
   
   Total Revenue | 7000-7999 | - | €250,150 | €265,000 | €105,230 | -€15,000
   Total Expenses | 6000-6999 | - | €155,600 | €162,500 | €64,200 | -€7,300
   Net Result | - | - | €94,550 | €102,500 | €41,030 | -€7,700
```

**Line Item Edit Modal**:
```
Budget Line: Fuel & Lubricants (Account 606100)

Account: [606100 ▼] (read-only)
FY 2026 Actual: €68,340 (informational)
FY 2027 Budget: [€72,000] * (editable)

Assumptions (optional):
├─ Inflation Rate: [5.26%] (auto-calculated from prior)
├─ Growth Factor: [+2%] (manual override)
├─ Notes: "Includes increase in aircraft hours due to summer events"
└─ Linked Project: [AVGAS Resupply 2027 ▼] (optional, for project tracking)

[Save] [Cancel]
```

---

### 3.2 Budget vs. Actual Variance Dashboard

**Widget** (main Accounting Dashboard tab)

```
Budget Performance FY 2026 (vs. Budget FY 2026)

┌─ Overall KPIs
├─ Revenue Actual: €250,150 | Budget: €265,000 | Variance: -€14,850 (-5.6%)
├─ Expenses Actual: €155,600 | Budget: €162,500 | Variance: €6,900 (-4.2%)
├─ Net Result Actual: €94,550 | Budget: €102,500 | Variance: -€7,950 (-7.8%)
└─
┌─ Variance by Category (chart: bar or waterfall)
│  Revenue ────────────────────────── €250k (Target: €265k) ⚠ -5.6%
│  │├─ Membership: €82,400 / €85,000 (-3.1%)
│  │├─ Flight Time: €145,200 / €152,000 (-4.5%)
│  │└─ Other: €22,550 / €28,000 (-19.5%)
│  │
│  Expenses ──────────────────────── €155k (Target: €162k) ✓ -4.2%
│  │├─ Fuel: €68,340 / €72,000 (-5.1%)
│  │├─ Maintenance: €42,100 / €44,000 (-4.3%)
│  │└─ Services: €18,500 / €19,500 (-5.1%)
│  │
│  Net Result ──────────────────── €94k (Target: €102k) ⚠ -7.8%
│
└─ Actuals YTD vs Budget (line chart)
   May actual actuals approach budget? Trend analysis.
```

**Table Drill-Down**:
```
Click on "Fuel" → Detail View

Account 606100: Fuel & Lubricants

Month | Actual | Budget | Variance | % | Trend
──────────────────────────────────
Jan | €5,420 | €6,000 | -€580 | -9.7% | ↓
Feb | €5,890 | €6,000 | -€110 | -1.8% | →
Mar | €6,100 | €6,000 | +€100 | +1.7% | ↑
Apr | €5,650 | €6,000 | -€350 | -5.8% | ↓
May | €6,280 | €6,000 | +€280 | +4.7% | ↑ (partial, 5 days)

Total YTD | €29,340 | €30,000 | -€660 | -2.2%
```

---

## Phase 4: Projects & Subventions

### 4.1 Project Tracking Dimension

**Screen**: `/accounting/projects`

#### Project List
```
[+ New Project]

Project Name | Code | Status | Budget | Actual | Variance | FY Coverage | Actions
──────────────────────────────────────────────────────────────
Summer Flight Camp 2026 | CAMP-2026 | Active | €15,000 | €12,340 | +€2,660 | 2026 | View | Edit
Youth Scholarship Fund | YOUTH-2026 | Active | €5,000 | €4,200 | +€800 | 2026 | ... | ...
AVGAS Subvention (State) | SUBV-STATE | Closed | €10,000 | €10,000 | €0 | 2025-2026 | Archive
```

#### Project Detail Screen
```
Summer Flight Camp 2026

├─ Status: Active
├─ Budget: €15,000 | Actual: €12,340 | Variance: +€2,660 (17.7%)
├─ Fiscal Year Coverage: 2026-01-01 → 2026-12-31
├─ Description: Summer intensive flight training for youth members
├─ Budget Lines
│  Instructors (Account 641000): €8,000 | Actual: €6,800
│  Facilities (Account 621000): €5,000 | Actual: €4,200
│  Equipment (Account 601000): €2,000 | Actual: €1,340
└─ Transactions Linked (11 entries)
   ├─ Entry #VT-2026-0042 | €2,400 | Instructor fees (posted)
   ├─ Entry #VT-2026-0043 | €1,250 | Facility rental (posted)
   └─ [+ Add Accounting Entry to Project]
```

**Linking Entries to Projects**:
When creating or editing an accounting entry, optional field:
```
Project / Special Action: [Summer Flight Camp 2026 ▼]
```

---

## Phase 5: Flight Synchronization Monitoring

### 5.1 Flight Sync Dashboard

**Screen**: `/accounting/flight-sync`

```
Flight Synchronization Status

Sync Status:
├─ Last Full Sync: 2026-05-03 14:23:00 (41 flights pulled)
├─ Validated Flights: 847 (all in current FY)
├─ Draft Entries Generated: 847
├─ Posted Entries: 723
├─ Pending Review: 124 (ready to post)
└─ Errors: 3 (pending retry)

Error Queue:
Flight # | Date | Pilot | Issue | Status | Retry
────────────────────────────────────
GLI-2026-0847 | 2026-05-03 | John Doe | Invalid asset UUID | Failed | [Retry]
GLI-2026-0846 | 2026-05-02 | Jane Smith | Missing metric | Failed | [Retry]
GLI-2026-0845 | 2026-05-02 | Bob Johnson | GL account not found | Failed | [Retry]

[Trigger Sync Now] [Retry Failed] [View Logs]

Generated Accounting Entry Preview:
```
┌─ Flight: GLI-2026-0848 (Glider ASK21, 2.5 hours)
├─ Pilot: Alice Lee
├─ Asset: ASK21-001
├─ Metrics: 2.5 flight hours, 0 engine hours, 1 landing
├─ Price Version: FY 2026 Standard (€85/hour)
├─ Calculated Cost: €212.50 (2.5 × €85)
└─ Draft Accounting Entry:
   Debit: 411 (Member Receivable, Alice Lee) | €212.50
   Credit: 7062 (Flight Revenue) | €212.50
   Analytical Asset: ASK21-001
   
   [Review Entry] [Post] [Reject]
```

---

## Phase 5b: Export & Reporting

### 5b.1 Financial Statements Views

**Screens**: `/accounting/reports/balance-sheet`, `/accounting/reports/income-statement`

#### Balance Sheet
```
BALANCE SHEET - FY 2026 (as of 2026-05-03)

ASSETS
├─ Fixed Assets: €412,050.00
│  ├─ Intangible: €45,000
│  ├─ Tangible: €860,000
│  ├─ Finance: €12,000
│  └─ Financial: €12,000 (placeholder)
│
└─ Current Assets: €215,000.00
   ├─ Inventory: €64,500
   ├─ Trade Receivables: €87,500 (Member Accounts 411)
   ├─ Cash & Equiv: €50,000
   └─ Prepaids: €13,000

TOTAL ASSETS: €627,050.00

LIABILITIES & EQUITY
├─ Equity: €450,000.00
│  ├─ Capital: €500,000
│  ├─ Reserves: €50,000
│  └─ Retained Earnings: -€100,000
│
└─ Liabilities: €177,050.00
   ├─ Long-term Debt: €412,000
   ├─ Trade Payables: €95,000
   ├─ Accrued Costs: €50,000
   └─ Other: €20,050

TOTAL LIAB. & EQUITY: €627,050.00

Balance Check: ✓ Assets = Liabilities + Equity

[Export PDF] [Print] [Email]
```

#### Income Statement (Compte de Résultat)
```
INCOME STATEMENT - FY 2026 (vs. FY 2025 & Budget FY 2026)

Revenue:
├─ Membership Fees: €85,000 | Budget: €85,000 | Prior: €82,000 | +3.7%
├─ Flight Revenue: €150,250 | Budget: €152,000 | Prior: €145,200 | +3.5%
├─ Instruction: €28,900 | Budget: €28,000 | Prior: €26,800 | +7.8%
└─ Other: €6,000 | Budget: €0 | Prior: €1,200
Total Revenue: €270,150 | Budget: €265,000 | Prior: €255,200 | +5.9% ✓

Expenses:
├─ Fuel & Lubricants: €68,340 | Budget: €72,000 | Prior: €65,200
├─ Maintenance & Repairs: €42,100 | Budget: €44,000 | Prior: €40,500
├─ Insurance: €35,000 | Budget: €35,000 | Prior: €35,000
├─ Staff Costs: €32,500 | Budget: €32,000 | Prior: €31,200
├─ Facilities: €18,500 | Budget: €19,500 | Prior: €18,000
└─ Other: €15,600 | Budget: €16,000 | Prior: €14,300
Total Expenses: €212,040 | Budget: €218,500 | Prior: €204,200 | +3.8%

EBIT (Operating Result): €58,110 | Budget: €46,500 | +24.9% ✓

Net Result (after tax adjustments): €58,110

[Export PDF] [Print] [Email]
```

---

## UI/UX System Design

### Design Tokens & Consistency

#### Color Scheme (Tailwind + shadcn/ui)
- **Primary (Teal)**: Interactive elements, buttons (#0f766e)
- **Green**: Success, posted entries, positive variance (#16a34a)
- **Yellow/Amber**: Draft, warnings, pending actions (#ca8a04)
- **Red**: Errors, cancelled, negative variance (#dc2626)
- **Gray**: Disabled, neutral, archived (#6b7280)

#### Typography
- **Display**: H1 (2.25rem), fiscal year headings
- **Heading**: H2 (1.875rem), section titles
- **Subheading**: H3 (1.5rem), subsection titles
- **Body**: 1rem, default text
- **Label**: 0.875rem, form labels, table headers
- **Caption**: 0.75rem, secondary info, metadata

#### Spacing
- **Component Gap**: 1rem (16px)
- **Section Gap**: 2rem (32px)
- **Card Padding**: 1.5rem (24px)
- **Form Row Gap**: 0.5rem (8px)

#### Form Patterns
- **Required Field**: `*` in red, not "Required" label (WCAG)
- **Validation Feedback**: Inline, under field, color-coded
- **Success Feedback**: Green checkmark + "Saved successfully"
- **Error Feedback**: Red X + "Entry is unbalanced: debit ≠ credit"
- **Loading**: Spinner or skeleton (never freeze UI)

#### Table UX
- **Sortable Columns**: ▲▼ indicator, click to toggle
- **Expandable Rows**: Click row or > icon
- **Pagination**: Show 20 rows/page, max 5 page buttons
- **Row Selection**: Checkboxes for bulk actions
- **Sticky Header**: Header stays visible on scroll

### Accessibility Guidelines

**WCAG 2.1 AA Compliance**:
- Color contrast ≥ 4.5:1 for text
- Keyboard navigation: Tab, Shift+Tab, Enter, Escape
- Form labels associated with inputs (id + htmlFor)
- aria-live regions for async updates
- Error messages linked to inputs (aria-describedby)
- Screen reader: all icons have alt text or aria-label

**Keyboard Shortcuts** (optional, but helpful):
- `Ctrl+S` / `Cmd+S`: Save draft entry
- `Ctrl+Enter` / `Cmd+Enter`: Post entry
- `Escape`: Close modal/form
- `Tab`: Navigate to next field
- `Shift+Tab`: Navigate to previous field
- `?`: Show keyboard shortcuts help

### Responsive Design

**Breakpoints** (Tailwind):
- **Mobile** (sm): 640px (single-column layout, collapsible menus)
- **Tablet** (md): 768px (2-column grid for cards)
- **Desktop** (lg): 1024px (3+ columns, full tables)
- **Wide** (xl): 1280px (full-width dashboards)

**Mobile UX Adjustments**:
- Forms: Single-column, larger touch targets (48px min)
- Tables: Card layout (account name, debit, credit stacked)
- Modals: Full-screen on mobile, 80vw on desktop
- Charts: Responsive (width: 100%, maintain aspect ratio)

---

## Implementation Roadmap

### Milestone 1: Phase 1 (Core Ledger) — Weeks 1-4
**Deliverables**:
- [ ] Dashboard & Overview (hero stats, recent entries)
- [ ] General Ledger view (filters, pagination, search)
- [ ] Entry create/edit form (draft/post states)
- [ ] Posted entry view (immutable, reversal option)
- [ ] Chart of Accounts (browse + admin)
- [ ] Entry Templates (CRUD + use workflow)
- [ ] API integration (TanStack Query hooks)
- [ ] State management (Zustand + localStorage for drafts)

**Testing**:
- Integration tests: create draft → post → reverse
- E2E: Form validation, balance check, fiscal year isolation
- Accessibility: Keyboard nav, screen reader, color contrast
- Responsiveness: Mobile, tablet, desktop views

### Milestone 2: Phase 2 (Pricing) — Weeks 5-7
**Deliverables**:
- [ ] Pricing version lifecycle (card UI, timeline)
- [ ] Create/edit pricing version form
- [ ] Tier editor (progressive brackets)
- [ ] Age discount preview & billing
- [ ] Validation pre-activation
- [ ] "Used-once freeze" logic

**Testing**:
- Pricing overlap & fiscal-year checks
- Registration → accounting entry generation
- Age discount calculation & rounding

### Milestone 3: Phase 2b (Cost Provision) — Weeks 8-9
**Deliverables**:
- [ ] Cost provision rule CRUD
- [ ] Accrual method selector (real-time vs batch)
- [ ] Batch job monitoring dashboard
- [ ] Staging queue visualization

### Milestone 4: Phase 3 (Budget) — Weeks 10-12
**Deliverables**:
- [ ] Budget preparation workflow
- [ ] Initialize-from-actuals
- [ ] Line item editor
- [ ] Budget vs Actual dashboard
- [ ] KPI widgets (revenue, expenses, net result)
- [ ] Variance trend chart

### Milestone 5: Phase 4 (Projects) — Weeks 13-14
**Deliverables**:
- [ ] Project master UI
- [ ] Entry-to-project linking
- [ ] Multi-year subvention tracking

### Milestone 6: Phase 5 (Flight Sync & Reports) — Weeks 15-16
**Deliverables**:
- [ ] Flight sync monitoring dashboard
- [ ] Error queue & retry UI
- [ ] Balance Sheet report
- [ ] Income Statement report
- [ ] Export (PDF, CSV)

---

## Challenge Areas & Design Decisions

### Challenge 1: Fiscal Year Partitioning Complexity
**Problem**: Users may confuse which FY they're editing, especially with overlapping pricing versions.

**Solution**:
- Persistent FY selector in top bar (always visible)
- Color-coded FY badges (FY 2026 = teal, FY 2027 = purple)
- Breadcrumb shows "FY 2026 > Ledger > Entry #123"
- All data tables show FY context in header

### Challenge 2: Posted Entry Immutability
**Problem**: Users expect to edit, then get frustrated when locked.

**Solution**:
- Clear visual lock icon (🔒) on posted entries
- Disabled form state (grayed out, no cursor)
- Reversal workflow as only way to undo
- Inline education: "Posted entries are immutable for audit compliance. To undo, create a reversal entry."

### Challenge 3: Pricing Version Lifecycle Governance
**Problem**: Spec requires "Active versions must be immutable, but can conditionally revert to Draft if never used."

**Solution**:
- Preview mode (read-only UI, no edit buttons visible)
- Revert button: Visible but disabled if `first_used_at` ≠ NULL
- Disabled button tooltip: "Version was used to generate accounting entries (first used 2026-01-15). Create a new draft version instead to maintain auditability."
- Warning banner: "You are viewing an ACTIVE pricing version. Changes will not be reflected in billing."

### Challenge 4: Cost Provision Rule Complexity
**Problem**: Batch accrual scheduling is unfamiliar to club staff.

**Solution**:
- Simplified UI: Show "Real-time" vs "Batch-daily" vs "Batch-monthly" as radio buttons
- Education tooltips: "Real-time: Entry posted immediately. Batch: Aggregated at schedule time."
- Dashboard shows pending accruals + next batch job time
- Color-code batch job status (green = on schedule, yellow = delayed, red = failed)

### Challenge 5: Age Discount Logic Transparency
**Problem**: Age discount eligibility calculated at billing time; users may expect retroactive changes.

**Solution**:
- Pricing item shows: "Age Discount: 15% for members < 25 on Jan 1 of FY"
- Registration workflow shows: "Your age on 2026-01-01: 23 → Eligible for -15% discount"
- Accounting entry preview shows final billed amount
- Lock after billing: Once posted, discount % is immutable (captured in entry description or memo)

---

## API Contract Alignment

### New Frontend-Expected API Endpoints

**Accounting Entries**:
- `GET /api/v1/accounting/entries?fiscal_year_uuid=...&journal_code=...&state=...&date_from=...&date_to=...` (filters)
- `POST /api/v1/accounting/entries` (create draft)
- `PUT /api/v1/accounting/entries/{entry_uuid}` (update draft)
- `PATCH /api/v1/accounting/entries/{entry_uuid}/post` (post)
- `POST /api/v1/accounting/entries/{entry_uuid}/reverse` (create reversal)

**Pricing Versions**:
- `GET /api/v1/accounting/pricing-versions?fiscal_year_uuid=...` (list by FY)
- `POST /api/v1/accounting/pricing-versions` (create draft)
- `PUT /api/v1/accounting/pricing-versions/{version_uuid}` (update draft)
- `PATCH /api/v1/accounting/pricing-versions/{version_uuid}/activate` (activate)
- `PATCH /api/v1/accounting/pricing-versions/{version_uuid}/archive` (archive)
- `POST /api/v1/accounting/pricing-versions/{version_uuid}/revert-to-draft` (conditional revert)

**Cost Provision Rules**:
- `GET /api/v1/accounting/cost-provision-rules?fiscal_year_uuid=...&asset_type_uuid=...`
- `POST /api/v1/accounting/cost-provision-rules`
- `PATCH /api/v1/accounting/cost-provision-rules/{rule_uuid}`

**Budget**:
- `GET /api/v1/accounting/budget?fiscal_year_uuid=...`
- `POST /api/v1/accounting/budget` (create)
- `PUT /api/v1/accounting/budget/{budget_uuid}` (update)
- `GET /api/v1/accounting/budget/{budget_uuid}/vs-actual` (KPI report)

**Reports**:
- `GET /api/v1/accounting/reports/balance-sheet?fiscal_year_uuid=...&as_of_date=...`
- `GET /api/v1/accounting/reports/income-statement?fiscal_year_uuid=...`
- `GET /api/v1/accounting/reports/export/pdf` (export)

---

## Testing Strategy

### Unit Tests (Frontend)
- **Components**: FiscalYearSelector, LockedWarning, BalanceIndicator
- **Store**: Draft entry save/load, filter state
- **Utils**: Decimal arithmetic, validation helpers

### Integration Tests
- **Entries**: Create draft → update → post → reverse
- **Pricing**: Create version → activate → lock check → reversal prevention
- **Budget**: Initialize → variance calculation

### E2E Tests (Cypress/Playwright)
1. User creates accounting entry draft
2. User posts entry (becomes immutable)
3. User attempts to edit posted entry (UI locked)
4. User reverses posted entry (new draft created)
5. User activates pricing version (becomes preview-only)
6. User attempts revert on used version (button disabled + tooltip shown)

### Accessibility Tests
- axe-core for color contrast, ARIA labels
- Keyboard navigation (Tab, Enter, Escape)
- Screen reader (NVDA/JAWS simulation)

---

## Deployment & Rollout

### Phase-Gated Rollout
1. **Phase 1 (Ledger)**: Internal testing (staff), then staged rollout to power users
2. **Phase 2 (Pricing)**: Staff review before member-facing features
3. **Phase 2b (Cost Provision)**: Admin only initially, then gradual staff training
4. **Phase 3+ (Budget/Projects/Reports)**: Full rollout with documentation

### Training & Documentation
- Video tutorials (2-3 min each): Create entry, post entry, reverse entry
- Admin manual: Fiscal year management, pricing lifecycle, cost rules
- Staff manual: Daily entry creation, template use, reconciliation
- Member portal guide: Budget view (if applicable)

### Monitoring & Feedback
- Usage analytics: Which features are used most?
- Error logging: Form validation failures, API errors
- User feedback survey (quarterly)
- Performance metrics: Page load time, form submission time

---

## Summary: UX/UI Key Differentiators

| Aspect | Reference (AeroOps) | Our Approach |
|--------|----------------------|---------------|
| **Fiscal Year** | Implicit in data | Explicit, persistent selector |
| **Posted Immutability** | Locked UI state | Clear lock icon + disabled inputs |
| **Pricing Governance** | Not visible | Preview mode + conditional revert |
| **Cost Accrual** | Not addressed | Dashboard with batch job monitoring |
| **Age Discount** | Not shown | Transparent preview + eligibility check |
| **Templates** | Yes, powerful | Simplified for club use (fewer macros) |
| **Mobile** | Desktop-optimized | Responsive (card layout on mobile) |
| **Accessibility** | Good | WCAG 2.1 AA, keyboard nav throughout |

---

## Conclusion

This plan translates SPEC_ACCOUNTING.md into a cohesive, user-friendly UX/UI implementation that respects financial auditability while maintaining accessibility for a small club's operational staff. The phased approach allows early wins (Phase 1 ledger) while building toward advanced features (budget, cost provisioning, flight sync) in later phases.

**Next Steps**:
1. Design Figma wireframes for Phase 1 screens
2. Set up frontend module structure & TanStack Query hooks
3. Implement API client layer
4. Build component library (FiscalYearSelector, BalanceIndicator, etc.)
5. ~~Create Storybook stories for accessibility & consistency~~ — Storybook was deliberately removed from the project (commit `b98c705`, 2026-06-14); use accessibility audits instead (see `docs/archive/a11y-audit-phase0.md`)
6. Begin Phase 1 E2E implementation & testing
