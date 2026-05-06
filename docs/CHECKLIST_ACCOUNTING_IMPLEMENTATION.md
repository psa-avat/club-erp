# Accounting Module Implementation Checklist
## Phase-By-Phase Execution Guide

**Created**: May 4, 2026  
**Based on**: PLAN_ACCOUNTING_UXUI_IMPLEMENTATION.md + CHALLENGE_ACCOUNTING_UXUI_DESIGN.md  
**Target Audience**: Backend, Frontend, QA, UX Designers  

---

## Overview

This checklist translates the UX/UI implementation plan into actionable tasks organized by phase and discipline (Backend/Frontend/QA/Design).

---

# PHASE 1: CORE LEDGER (Weeks 1-4)

## Milestone 1.1: Infrastructure & Setup

### Backend Tasks
- [ ] Create `backend/app/modules/accounting/` directory structure
  - [ ] `models.py` (SQLAlchemy models: FiscalYear, Account, Journal, Entry, EntryLine, EntryTemplate)
  - [ ] `schemas.py` (Pydantic request/response schemas)
  - [ ] `service.py` (business logic: balance validation, posting, reversal)
  - [ ] `dependencies.py` (auth guards, FY scope injection)
  - [ ] `routes.py` (FastAPI endpoints)
- [ ] Create migrations (alembic):
  - [ ] Create partitioned `accounting_entries` and `accounting_lines` tables
  - [ ] Create `accounting_fiscal_years`, `accounting_accounts`, `accounting_journals`
  - [ ] Load PCG seed data (Association-focused chart of accounts)
- [ ] **Implement Global FY endpoints** (required by frontend store initialization):
  - [ ] `GET /api/v1/accounting/fiscal-years/active` → return current open (or most recent) FY
  - [ ] `GET /api/v1/accounting/fiscal-years` → return list of all FY (for selector dropdown)
  - [ ] Response format: `{ uuid, year, startDate (ISO 8601), endDate, state (open|closed|reopened) }`
- [ ] Implement capability checks:
  - [ ] `CLOSE_FISCAL_YEAR` (FY admin)
  - [ ] `POST_ACCOUNTING_ENTRIES` (posting)
  - [ ] `MANAGE_ACCOUNTING_SETTINGS` (settings/templates)
  - [ ] `VIEW_FINANCIALS` (read-only ledger)
- [ ] Add tests:
  - [ ] `test_fiscal_year_boundary_validation.py`
  - [ ] `test_entry_balance_validation.py`
  - [ ] `test_posting_immutability.py`
  - [ ] `test_reversal_workflow.py`
  - [ ] `test_partition_isolation.py`
  - [ ] `test_global_fiscal_year_endpoints.py` (active FY, FY list)

### Frontend Tasks
- [ ] **Global Fiscal Year Architecture** (shell-level, enables all modules):
  - [ ] Create `frontend/src/store/fiscalYearStore.ts` (Zustand store with persist middleware)
    - [ ] State: activeFiscalYearUuid, secondaryFiscalYearUuid (for budget planning)
    - [ ] Metadata: activeFiscalYearData (startDate, endDate, state)
    - [ ] Actions: setActiveFiscalYear(), setSecondaryFiscalYear(), clearSecondary()
  - [ ] Create React Context: `frontend/src/context/FiscalYearContext.tsx` (if deep component prop drilling needed)
  - [ ] Initialize in App root: fetch active FY on load, set in store, persist to localStorage
  - [ ] Update `frontend/src/components/TopNavigation.tsx`:
    - [ ] Add FY selector dropdown (shows all available FY)
    - [ ] Display FY state badge (Open/Closed/Reopened) with color coding
    - [ ] Show date range (YYYY-MM-DD → YYYY-MM-DD)
    - [ ] On selection change: update store, all modules auto-refresh
  - [ ] Reference: `ARCHITECTURE_GLOBAL_FISCAL_YEAR.md`
- [ ] Create module structure:
  - [ ] `frontend/src/modules/accounting/` with subfolders (api, components, store, types)
  - [ ] `api/queries.ts` (TanStack Query hooks for GET endpoints, auto-inject activeFY)
  - [ ] `api/mutations.ts` (mutations for POST/PUT/PATCH)
  - [ ] `store/draftEntryStore.ts` (Zustand for in-progress entries)
  - [ ] `store/filterStore.ts` (UI filters)
- [ ] Create shared components:
  - [ ] `components/shared/EntryStateTag.tsx` (visual state badges)
  - [ ] `components/shared/LockedWarning.tsx` (immutability message)
  - [ ] `components/shared/BalanceIndicator.tsx` (debit/credit balance feedback)
  - [ ] `components/shared/AccountSelect.tsx` (hierarchical CoA dropdown)
  - [ ] Note: FY selector now in TopNavigation (not per-module)

### QA Tasks
- [ ] Set up test infrastructure:
  - [ ] Cypress config for E2E tests
  - [ ] axe-core for accessibility scans
  - [ ] Test database (PostgreSQL test fixtures)
- [ ] **Global FY Store tests**:
  - [ ] "App loads and initializes active FY from backend"
  - [ ] "FY selection persists to localStorage"
  - [ ] "Changing FY selector updates store globally"
  - [ ] "All modules reflect FY change without page reload"
  - [ ] "Secondary FY override works (budget planning)"
  - [ ] "TopNav FY badge shows correct status (Open/Closed/Reopened)"

### Design Tasks
- [ ] Create Figma wireframes:
  - [ ] Dashboard layout (hero stats, recent entries)
  - [ ] General Ledger view (filters, table, pagination)
  - [ ] Entry create/edit form (draft state)
  - [ ] Entry detail view (read-only, posted state)
  - [ ] Chart of Accounts browse
- [ ] Design tokens:
  - [ ] Color palette (Tailwind primary, green, yellow, red, gray)
  - [ ] Typography scale (H1-H3, body, caption)
  - [ ] Spacing system (1rem, 2rem gaps)
  - [ ] Component patterns (buttons, forms, tables, modals)

---

## Milestone 1.2: Dashboard & Overview

### Backend Tasks
- [ ] Implement dashboard API:
  - [ ] `GET /api/v1/accounting/dashboard?fiscal_year_uuid=...`
  - [ ] Return: total_debit, total_credit, pending_drafts_count, active_accounts_count, recent_entries[]
  - [ ] Add tests for dashboard data aggregation

### Frontend Tasks
- [ ] Build Dashboard page:
  - [ ] `pages/accounting/Dashboard.tsx`
  - [ ] Display FY hero banner (status, date range)
  - [ ] Display quick stats cards (debit, credit, drafts, accounts)
  - [ ] Display recent entries table (last 10)
  - [ ] Add [New Entry], [View All], [Reconciliation] buttons
  - [ ] Implement responsive grid (4 cols desktop, 2 cols tablet, 1 col mobile)
- [ ] Add TanStack Query hook:
  - [ ] `useDashboardQuery()` with refetchInterval (30s for near-real-time)

### Design Tasks
- [ ] Create Dashboard high-fidelity mockup
- [ ] Validate card layout and spacing
- [ ] Review color contrast for cards

### QA Tasks
- [ ] E2E test:
  - [ ] "Dashboard loads and displays current FY stats"
  - [ ] "Click [New Entry] navigates to form"
  - [ ] "Dashboard updates after posting entry (refetch)"

---

## Milestone 1.3: General Ledger View

### Backend Tasks
- [ ] Implement ledger API:
  - [ ] `GET /api/v1/accounting/entries` with filters:
    - [ ] `fiscal_year_uuid` (required)
    - [ ] `journal_code` (optional, e.g., "BQ")
    - [ ] `state` (optional, 1=Draft, 2=Posted, 3=Cancelled)
    - [ ] `date_from`, `date_to` (optional)
    - [ ] `search` (optional, search ref/description/account)
    - [ ] `page`, `limit` (pagination, default 20)
  - [ ] Return paginated response with total_count
  - [ ] Add sorting support (by date, amount, journal, etc.)
- [ ] Optimize queries:
  - [ ] Use partitioned table for efficient FY filtering
  - [ ] Add indexes on (fiscal_year_uuid, state, journal_code)

### Frontend Tasks
- [ ] Build Ledger page:
  - [ ] `pages/accounting/Ledger.tsx`
  - [ ] FY selector (top, persistent)
  - [ ] Filter sidebar:
    - [ ] Journal dropdown
    - [ ] Date range picker
    - [ ] State filter (All/Draft/Posted/Cancelled)
    - [ ] Search box
    - [ ] [Apply] [Reset] buttons
  - [ ] Results table:
    - [ ] Columns: Entry# | Date | Journal | Ref | Account | Desc | Debit | Credit | State | Posted By | Actions
    - [ ] Rows sortable (click header to toggle ▲▼)
    - [ ] Expandable rows (click to show linked lines)
    - [ ] Pagination controls
    - [ ] Row selection (checkbox for bulk actions)
    - [ ] State tags (colors: draft=yellow, posted=green, cancelled=red)
  - [ ] Actions column:
    - [ ] Draft: [Edit] [View] [Delete]
    - [ ] Posted: [View] [Reverse] [Download]
- [ ] Implement filters in TanStack Query:
  - [ ] `useLedgerEntriesQuery(filters)` with debouncing (500ms search)
  - [ ] Invalidate cache on filter change

### Design Tasks
- [ ] Create Ledger high-fidelity mockup
- [ ] Design filter panel (sidebar vs. inline, responsive)
- [ ] Design table (column widths, truncation, expand icon)
- [ ] Design state tags and action buttons

### QA Tasks
- [ ] E2E tests:
  - [ ] "Ledger filters work: filter by journal, date, state"
  - [ ] "Table pagination: navigate pages, change page size"
  - [ ] "Search works: search by reference, finds entry"
  - [ ] "Sort works: click column header, data re-sorts"
  - [ ] "Row expand works: click row, shows linked lines"

---

## Milestone 1.4: Entry Create/Edit Form

### Backend Tasks
- [ ] Implement entry endpoints:
  - [ ] `POST /api/v1/accounting/entries` (create draft)
    - [ ] Input: fiscal_year_uuid, journal_uuid, date, description, reference, lines[]
    - [ ] Validate: date within FY boundaries, debit/credit per line
    - [ ] Do NOT require balance (draft can be incomplete)
    - [ ] Return: entry object with UUID, state=1 (Draft)
  - [ ] `PUT /api/v1/accounting/entries/{entry_uuid}` (update draft)
    - [ ] Allow editing: date, description, reference, lines
    - [ ] Disallow if state != 1 (Draft)
    - [ ] Validation: date, debit/credit per line (not required to balance)
  - [ ] `PATCH /api/v1/accounting/entries/{entry_uuid}/post` (post entry)
    - [ ] Validate: entry is balanced (debit = credit)
    - [ ] Validate: all lines have non-zero amounts
    - [ ] Check: user has POST_ACCOUNTING_ENTRIES capability
    - [ ] Check: date within FY boundaries
    - [ ] Transition: state from 1 (Draft) to 2 (Posted)
    - [ ] Assign: sequence_number (auto-increment per FY/journal)
    - [ ] Set: posted_at, posted_by timestamps
    - [ ] Return: updated entry object
- [ ] Implement GL account validation:
  - [ ] `GET /api/v1/accounting/accounts` (list all postable accounts)
  - [ ] `GET /api/v1/accounting/accounts/{account_uuid}` (detail + balance for FY)
- [ ] Add tests:
  - [ ] "Create draft entry (unbalanced) succeeds"
  - [ ] "Post draft entry (balanced) succeeds, sequence # assigned"
  - [ ] "Post entry (unbalanced) fails with error"
  - [ ] "Update posted entry fails"

### Frontend Tasks
- [ ] Build Entry Form component:
  - [ ] `components/entries/EntryForm.tsx` (reusable for create/edit)
  - [ ] Header section:
    - [ ] FY badge (read-only pill)
    - [ ] Transaction Date picker (validate FY range)
    - [ ] Journal dropdown (VT, HA, BQ, CS, OD, AN, AC, FL)
    - [ ] Reference field (text input, optional)
    - [ ] Description field (textarea, 200 char limit)
  - [ ] Lines section (repeating):
    - [ ] Account select (hierarchical dropdown with search)
    - [ ] Description (text input, optional)
    - [ ] Debit input (decimal, 2 decimals, using decimal.js)
    - [ ] Credit input (decimal, 2 decimals)
    - [ ] Delete button (✕, disabled if only 1 line)
    - [ ] Add Line button
  - [ ] Validation feedback (real-time):
    - [ ] Date validation: "Entry date outside FY boundaries"
    - [ ] Per-line: "Debit OR credit required (not both)"
    - [ ] Balance check: "✓ Balanced" (green) or "Unbalanced: debit €1,250 ≠ credit €1,200" (red)
  - [ ] Action buttons (sticky, bottom):
    - [ ] [Cancel] [Save Draft] [Post Entry] (Post disabled if unbalanced)
- [ ] Implement entry form page:
  - [ ] `pages/accounting/EntryCreate.tsx` (new entry)
  - [ ] `pages/accounting/EntryEdit.tsx` (edit draft)
  - [ ] Load account list for dropdown (cached via TanStack Query)
  - [ ] Use Zustand draft store to auto-save (localStorage) every 3 seconds
  - [ ] On submit: POST to backend via mutation hook
- [ ] Create mutations:
  - [ ] `useCreateEntryMutation()` (POST)
  - [ ] `useUpdateEntryMutation()` (PUT, draft only)
  - [ ] `usePostEntryMutation()` (PATCH /post)
  - [ ] Each mutation handles errors and shows toast notifications

### Design Tasks
- [ ] Create Entry Form high-fidelity mockup
- [ ] Design form layout (header, lines grid, actions)
- [ ] Design validation feedback (inline errors, balance indicator)
- [ ] Design Account Select dropdown (hierarchical view)

### QA Tasks
- [ ] E2E tests:
  - [ ] "Create entry: fill form, save draft, verify saved"
  - [ ] "Edit draft: modify, save, verify changes"
  - [ ] "Post entry: balance check passes, click post, verify sequence # assigned"
  - [ ] "Post entry unbalanced: click post, error shown, entry not posted"
  - [ ] "Form validation: date outside FY range rejected"
  - [ ] "Balance indicator updates real-time as amounts change"
- [ ] Accessibility tests:
  - [ ] Tab navigation through all form fields
  - [ ] Error messages linked to inputs (aria-describedby)
  - [ ] Screen reader: "Debit field, required, balance error message"

---

## Milestone 1.5: Entry Detail View (Posted, Immutable)

### Backend Tasks
- [ ] Implement entry detail endpoint:
  - [ ] `GET /api/v1/accounting/entries/{entry_uuid}` (with fiscal_year_uuid)
  - [ ] Return: full entry with lines, posted metadata, linked documents
- [ ] No changes needed (already covered in Phase 1.1)

### Frontend Tasks
- [ ] Build Entry Detail page:
  - [ ] `pages/accounting/EntryDetail.tsx`
  - [ ] Header:
    - [ ] FY badge (read-only)
    - [ ] Entry # (sequence number if posted)
    - [ ] State tag (✓ POSTED, green, large)
    - [ ] Posted by/at timestamps
    - [ ] Lock icon + message: "🔒 This entry is posted and cannot be edited."
  - [ ] Form (all inputs disabled, grayed out):
    - [ ] Date, Journal, Reference, Description (read-only)
    - [ ] Lines table (read-only, no delete buttons)
  - [ ] Reversal section:
    - [ ] [Reverse This Entry ▼] button (modal workflow)
  - [ ] Supporting Documents section (if any):
    - [ ] List attached files (read-only)
  - [ ] Audit Memo section (if populated):
    - [ ] Display internal notes (read-only)

### Design Tasks
- [ ] Create Detail View mockup (posted state)
- [ ] Design lock indicator and disabled input styling

### QA Tests
- [ ] "Posted entry: all inputs disabled, no edit buttons visible"
- [ ] "Posted entry: [Reverse] button visible and clickable"
- [ ] "Reversal workflow: click [Reverse], modal appears, reason field shown"

---

## Milestone 1.6: Reversal Entry Workflow

### Backend Tasks
- [ ] Implement reversal endpoint:
  - [ ] `POST /api/v1/accounting/entries/{entry_uuid}/reverse`
  - [ ] Input: reversal_reason (free text)
  - [ ] Validate: entry_uuid exists and is Posted (state=2)
  - [ ] Create new Draft entry with:
    - [ ] Same FY, journal, date
    - [ ] Reversed lines (debit ↔ credit swapped)
    - [ ] reversal_of_entry_uuid = original UUID
    - [ ] reversal_reason = input
    - [ ] state = 1 (Draft)
  - [ ] Return: new draft entry object
- [ ] Add tests:
  - [ ] "Reverse posted entry creates new draft with swapped amounts"
  - [ ] "Reversed entry linked to original via reversal_of_entry_uuid"

### Frontend Tasks
- [ ] Build Reversal Modal:
  - [ ] `components/entries/ReversalModal.tsx`
  - [ ] Display original entry details (read-only)
  - [ ] Input: Reversal Reason (textarea, 500 char limit)
  - [ ] Preview: What will happen (new draft created, swapped amounts)
  - [ ] Actions: [Cancel] [Create Reversal]
  - [ ] On submit: call `useReverseEntryMutation()`
  - [ ] On success: redirect to new draft entry detail page

### Design Tasks
- [ ] Create Reversal Modal mockup
- [ ] Design preview section (show swapped amounts)

### QA Tests
- [ ] "Reversal workflow: submit reason, new draft created"
- [ ] "New draft shows linked to original (reversal_of_entry_uuid displayed)"

---

## Milestone 1.7: Chart of Accounts

### Backend Tasks
- [ ] Load PCG seed:
  - [ ] `backend/data/pcg_seed.json` (existing seed data)
  - [ ] Migration script to insert seed into `accounting_accounts` table
  - [ ] Verify: 7 classes, 342 accounts, correct postability flags
- [ ] Implement CoA endpoints:
  - [ ] `GET /api/v1/accounting/accounts?postable=true` (list, filterable)
  - [ ] `GET /api/v1/accounting/accounts/{account_uuid}` (detail with balance for FY)
  - [ ] `GET /api/v1/accounting/accounts/hierarchy` (tree structure for dropdown)

### Frontend Tasks
- [ ] Build CoA Browse page:
  - [ ] `pages/accounting/ChartOfAccounts.tsx`
  - [ ] Hierarchical tree view (collapsible classes/groups):
    - [ ] Click class name to expand
    - [ ] Show account code, label, type, balance
    - [ ] Color-code by type (asset=blue, liability=red, equity=green, etc.)
  - [ ] Search box (search by code or name)
  - [ ] Filter: Postable (checkbox)
  - [ ] Click account to show detail panel (balance trend, transactions)

### Design Tasks
- [ ] Create CoA mockup (hierarchical tree)
- [ ] Design account detail panel

### QA Tests
- [ ] "CoA tree expands/collapses correctly"
- [ ] "Search filters accounts"
- [ ] "Click account shows detail panel"

---

## Milestone 1.8: Entry Templates (Recurring Transactions)

### Backend Tasks
- [ ] Implement template endpoints:
  - [ ] `GET /api/v1/accounting/entry-models` (list)
  - [ ] `POST /api/v1/accounting/entry-models` (create)
  - [ ] `PUT /api/v1/accounting/entry-models/{template_uuid}` (update)
  - [ ] `DELETE /api/v1/accounting/entry-models/{template_uuid}` (delete)
  - [ ] `POST /api/v1/accounting/entry-models/{template_uuid}/use` (prefill entry from template)
- [ ] Implement template model:
  - [ ] Fields: code (unique), name, journal_uuid, description, default_reference, recurrence_type, is_active
  - [ ] Child lines: account, debit%, credit%, description
  - [ ] Validation: template must be balanced (sum debit% = 100 = sum credit%)

### Frontend Tasks
- [ ] Build Template List page:
  - [ ] `pages/accounting/EntryTemplates.tsx`
  - [ ] [+ New Template] button
  - [ ] Table: Template Name | Code | Journal | Recurrence | Lines | Actions
  - [ ] Row actions: [Edit] [Use] [Duplicate] [Delete]
- [ ] Build Template Edit modal:
  - [ ] Template Name, Code, Journal, Recurrence, Description, Default Reference
  - [ ] Lines grid (account, debit%, credit%, description)
  - [ ] Balance validation: "✓ Balanced (Debit 100% = Credit 100%)"
  - [ ] [Save] [Cancel]
- [ ] Build Template Use workflow:
  - [ ] Click [Use] on template
  - [ ] Redirect to Entry create form pre-filled with:
    - [ ] Journal (from template)
    - [ ] Reference (default reference with date macro if applicable)
    - [ ] Description (from template)
    - [ ] Lines (from template, amounts placeholder for user to fill)
  - [ ] User edits amounts and submits

### Design Tasks
- [ ] Create Template List and Edit mockups

### QA Tests
- [ ] "Create template: fill form, save, appears in list"
- [ ] "Use template: click [Use], entry form pre-filled correctly"
- [ ] "Template balance validation works"

---

## Phase 1 Definition of Done

- [ ] **Global Fiscal Year Architecture** complete:
  - [ ] Zustand store created with persist middleware
  - [ ] TopNav FY selector implemented (dropdown with status badge)
  - [ ] Backend endpoints implemented (/fiscal-years/active, /fiscal-years)
  - [ ] All modules use global FY (no per-module selectors)
  - [ ] FY persistence tested (localStorage survives reload)
  - [ ] Secondary FY override tested (budget planning)
- [ ] All Phase 1 backend tasks complete and tested
- [ ] All Phase 1 frontend tasks complete and tested
- [ ] General Ledger fully functional (create, edit draft, post, view, reverse)
- [ ] Chart of Accounts browsable
- [ ] Entry Templates functional
- [ ] E2E test suite covers all Phase 1 workflows (including FY selection)
- [ ] Accessibility audit: WCAG 2.1 AA compliance verified
- [ ] Performance: Page load < 2s, form submit < 500ms
- [ ] Deployment: Phase 1 ready for internal testing

---

# PHASE 2: PRICING MANAGEMENT (Weeks 5-7)

## Milestone 2.1: Pricing Version Lifecycle

### Backend Tasks
- [ ] Create pricing models:
  - [ ] `PricingVersion`: uuid, fiscal_year_uuid, name, from_date, to_date, status (1=Draft, 2=Active, 3=Archived), is_locked, asset_type_uuid, created_by, first_used_at, usage_count
  - [ ] `PricingItem`: uuid, pricing_version_uuid, name, unit, metric_code, base_price, pack_price, age_discount_percent, gl_account_credit_uuid, flight_type_uuid, include_insurance, include_fuel
  - [ ] `PricingItemTier`: uuid, pricing_item_uuid, from_qty, price, sort_order
- [ ] Implement pricing endpoints:
  - [ ] `GET /api/v1/accounting/pricing-versions?fiscal_year_uuid=...`
  - [ ] `POST /api/v1/accounting/pricing-versions` (create draft)
  - [ ] `PUT /api/v1/accounting/pricing-versions/{version_uuid}` (update draft only)
  - [ ] `PATCH /api/v1/accounting/pricing-versions/{version_uuid}/activate` (draft → active)
  - [ ] `PATCH /api/v1/accounting/pricing-versions/{version_uuid}/archive` (active → archived)
  - [ ] `POST /api/v1/accounting/pricing-versions/{version_uuid}/revert-to-draft` (conditional revert if not used)
- [ ] Implement validation:
  - [ ] Activation: all items have GL account credit set
  - [ ] Activation: no date overlap with other ACTIVE versions
  - [ ] Revert: reject if first_used_at is not NULL
  - [ ] Archive: allow from any state
- [ ] Add tests:
  - [ ] "Create pricing version as draft"
  - [ ] "Activate version: validation passes"
  - [ ] "Activate version: missing GL account fails"
  - [ ] "Revert used version: fails with error"
  - [ ] "Revert unused version: succeeds"

### Frontend Tasks
- [ ] Build Pricing Timeline:
  - [ ] `pages/accounting/Pricing.tsx`
  - [ ] FY selector + status display
  - [ ] Horizontal timeline (scroll) showing all FY cards
  - [ ] Card design for each state (Draft/Active/Archived):
    - [ ] Status badge (color-coded)
    - [ ] Basic info (name, validity dates, item count)
    - [ ] Actions buttons (state-dependent)
    - [ ] Expandable detail (click to expand/collapse)
- [ ] Build Version Card component:
  - [ ] `components/pricing/PricingVersionCard.tsx`
  - [ ] Display: status, validity, item count, locked flag
  - [ ] Actions: [Edit] (draft only) | [Preview] (active) | [Activate] (draft) | [Archive] | [Revert] (conditional)
  - [ ] Detail expansion: show items list preview
- [ ] Build Pricing Version Editor:
  - [ ] `pages/accounting/PricingVersionEdit.tsx` (create/edit form)
  - [ ] Step 1: Basic Info
    - [ ] FY selector (pre-selected)
    - [ ] Name, From/To dates, Asset Type, Locked checkbox
    - [ ] Validation: from < to, within FY boundaries
  - [ ] Step 2: Pricing Items (CRUD items within version)
    - [ ] [+ Add Item] button
    - [ ] Items table: Name | Unit | Base Price | GL Account | Age Discount | Actions
    - [ ] Row actions: [Edit Item] [Delete Item]
    - [ ] Expandable row detail (tiers, etc.)
  - [ ] Activation Checklist (before clicking activate):
    - [ ] All items have GL account assigned
    - [ ] No date overlaps
    - [ ] Items complete (visual progress indicator)
    - [ ] [Activate] button (enabled/disabled based on checklist)

### Design Tasks
- [ ] Create Pricing Timeline mockup
- [ ] Create Version Card designs (Draft/Active/Archived states)
- [ ] Create Version Editor form mockup

### QA Tests
- [ ] "Create pricing version (draft state)"
- [ ] "Activate version: validation passes"
- [ ] "Activate version: GL account missing, fails with error"
- [ ] "Archive active version"
- [ ] "Revert unused version: succeeds"
- [ ] "Revert used version: fails, error shown"

---

## Milestone 2.2: Pricing Item & Tier Editor

### Backend Tasks
- [ ] Implement item endpoints:
  - [ ] `POST /api/v1/accounting/pricing-items` (create within version)
  - [ ] `PUT /api/v1/accounting/pricing-items/{item_uuid}` (update, draft version only)
  - [ ] `DELETE /api/v1/accounting/pricing-items/{item_uuid}` (delete, draft version only)
- [ ] Implement tier endpoints:
  - [ ] `POST /api/v1/accounting/pricing-item-tiers` (add tier)
  - [ ] `PUT /api/v1/accounting/pricing-item-tiers/{tier_uuid}` (update tier)
  - [ ] `DELETE /api/v1/accounting/pricing-item-tiers/{tier_uuid}` (delete tier)
- [ ] Add validation:
  - [ ] Item: base_price, pack_price are NUMERIC(10,4) with 2 decimals
  - [ ] Item: age_discount_percent 0-100, 2 decimals
  - [ ] Tiers: from_qty must be strictly increasing
  - [ ] Tiers: from_qty decimals allowed only for FlightTime unit

### Frontend Tasks
- [ ] Build Pricing Item Editor modal:
  - [ ] `components/pricing/PricingItemEditor.tsx`
  - [ ] Form fields:
    - [ ] Name (text)
    - [ ] Unit (dropdown: FlightTime, EngineMin, EngineTime100h, FlightDuration, PerFlight, Fixed)
    - [ ] Metric Code (text, auto-populated or free-text)
    - [ ] Base Price (decimal input, 2 decimals)
    - [ ] Age Discount % (decimal input, 0-100)
    - [ ] Pack Price (decimal input, nullable)
    - [ ] GL Account Credit (account select)
    - [ ] Flight Type (optional dropdown)
    - [ ] Include Insurance (checkbox)
    - [ ] Include Fuel (checkbox)
  - [ ] Tier sub-section (repeating rows):
    - [ ] From Qty | Price | Sort Order
    - [ ] Add/Edit/Delete tier rows
    - [ ] Validation: from_qty strictly increasing
- [ ] Build Tier Editor:
  - [ ] `components/pricing/TierEditor.tsx`
  - [ ] Modal for adding/editing tiers
  - [ ] From Qty input (format depends on unit type)
  - [ ] Price (decimal, 2 decimals)
  - [ ] Sort Order (auto-assigned, editable)

### Design Tasks
- [ ] Create Item Editor form mockup
- [ ] Create Tier Editor mockup

### QA Tests
- [ ] "Add pricing item: fill form, save"
- [ ] "Edit item: modify fields, save"
- [ ] "Delete item (draft version)"
- [ ] "Add tier: from_qty increments validated"
- [ ] "Tier from_qty accepts decimal for FlightTime, rejects for others"

---

## Milestone 2.3: GL Account Validation & Mapping

### Backend Tasks
- [ ] Implement GL account mapping validation:
  - [ ] When activating version, verify all items have gl_account_credit_uuid set
  - [ ] Verify account is postable and type is Revenue (or allowable expense)
  - [ ] Return validation errors if any issue found
- [ ] Test: "Activation fails if item missing GL account"

### Frontend Tasks
- [ ] Build GL Account Select component:
  - [ ] `components/accounting/GLAccountSelect.tsx`
  - [ ] Dropdown with hierarchical structure (classes/groups)
  - [ ] Search functionality (by code or name)
  - [ ] Suggestions based on item type (e.g., Flight Time → 7062 typically)
  - [ ] Display account info (type, postability, balance)
  - [ ] Hint text: "Revenue accounts (70xx) recommended for pricing items"
- [ ] Implement validation feedback:
  - [ ] Real-time: "Account must be postable"
  - [ ] Real-time: "Account must be Revenue type, found Expense"
  - [ ] Pre-activation: Checklist shows GL account status for each item

### Design Tasks
- [ ] Design GL Account Select (dropdown hierarchy)
- [ ] Design validation feedback inline

### QA Tests
- [ ] "GL Account Select dropdown shows suggestions"
- [ ] "Search filters accounts"
- [ ] "Validation: non-postable account rejected"
- [ ] "Activation: missing GL account fails with clear error"

---

## Milestone 2.4: Age Discount Preview & Billing

### Backend Tasks
- [ ] Implement age calculation:
  - [ ] Given member DOB and FY start date, calculate age
  - [ ] Check: age < 25 = eligible
  - [ ] Return: eligibility flag
- [ ] Implement pricing calculation (with discounts):
  - [ ] Given member, item, FY: lookup pricing version
  - [ ] Check age eligibility
  - [ ] Calculate base price, apply age discount if eligible
  - [ ] Apply pack price surcharge if applicable
  - [ ] Return final price
- [ ] Implement preview endpoint:
  - [ ] `POST /api/v1/accounting/pricing-items/{item_uuid}/calculate-price?member_uuid=...&fiscal_year_uuid=...`
  - [ ] Return: base_price, age_discount_amount, final_price, eligibility_reason
- [ ] Add tests:
  - [ ] "Age discount applied for U25 member"
  - [ ] "Age discount not applied for 25+ member"
  - [ ] "Age discount not applied if DOB missing"

### Frontend Tasks
- [ ] Integrate age discount into Registration workflow (if applicable):
  - [ ] In billing preview, show:
    - [ ] Member age status (⭐ U25 Eligible or —)
    - [ ] Base price, discount amount, final price
    - [ ] Explanation: "15% discount applied for members < 25 on FY start"
  - [ ] Call backend pricing calculation API
  - [ ] Display in accounting entry preview

### Design Tasks
- [ ] Design age eligibility badge
- [ ] Design billing preview with discounts shown

### QA Tests
- [ ] "Age discount: U25 member shows correct discounted price"
- [ ] "Age discount: 25+ member shows base price"
- [ ] "Age discount: DOB missing, no discount applied"

---

## Milestone 2.5: Integration with Accounting Entry

### Backend Tasks
- [ ] When billing a member (from registration/flight), generate draft accounting entry:
  - [ ] Call pricing calculation
  - [ ] Create entry with debit 411 (member receivable), credit 706x (revenue per item)
  - [ ] Capture billing source (registration_uuid, flight_uuid, etc.)
  - [ ] Mark pricing_version as "used" (set first_used_at if not already set, increment usage_count)
- [ ] Endpoint: `POST /api/v1/accounting/entries/from-billing`
  - [ ] Input: source_type (registration/flight), source_uuid, member_uuid, fiscal_year_uuid
  - [ ] Return: draft entry created

### Frontend Tasks
- [ ] In registration/flight modules, after pricing calculated:
  - [ ] Call API to generate draft accounting entry
  - [ ] Show entry preview before posting
  - [ ] Link to entry in Accounting module

### QA Tests
- [ ] "Registration → draft accounting entry generated"
- [ ] "Pricing version marked as used after first billing"
- [ ] "Revert disabled on version after first use"

---

## Phase 2 Definition of Done

- [ ] Pricing versioning fully functional (create, edit, activate, archive)
- [ ] GL account mapping validated before activation
- [ ] Age discount logic transparent and tested
- [ ] Pricing versions locked when active (immutable)
- [ ] Integration with billing workflows complete
- [ ] E2E tests cover pricing lifecycle
- [ ] Phase 2 ready for staff testing

---

# PHASE 2b: COST PROVISION RULES (Weeks 8-9)

## Milestone 2b.1: Cost Provision Rule Management

### Backend Tasks
- [ ] Create models:
  - [ ] `CostProvisionRule`: uuid, asset_type_uuid, fiscal_year_uuid, metric_name, cost_per_unit, gl_account_debit_uuid, gl_account_credit_uuid, accrual_method (1=real-time, 2=batch-daily, 3=batch-monthly), is_active, created_by
  - [ ] `CostAccrualStaging`: uuid, cost_provision_rule_uuid, asset_uuid, metric_date, metric_value, cost_amount, is_accrued, accrual_entry_uuid
- [ ] Implement rule endpoints:
  - [ ] `GET /api/v1/accounting/cost-provision-rules?fiscal_year_uuid=...&asset_type_uuid=...`
  - [ ] `POST /api/v1/accounting/cost-provision-rules` (create)
  - [ ] `PUT /api/v1/accounting/cost-provision-rules/{rule_uuid}` (update)
  - [ ] `PATCH /api/v1/accounting/cost-provision-rules/{rule_uuid}/toggle-active` (pause/resume)
- [ ] Add validation:
  - [ ] Unique constraint: (asset_type_uuid, metric_name, fiscal_year_uuid) with only one active rule
  - [ ] GL accounts must be postable

### Frontend Tasks
- [ ] Build Rule Management page:
  - [ ] `pages/accounting/CostProvisionRules.tsx`
  - [ ] FY + Asset Type selectors (context)
  - [ ] [+ New Rule] button
  - [ ] Rules table: Asset | Metric | Cost/Unit | GL Accounts | Method | Status | Actions
  - [ ] Row actions: [Edit] [Pause] [Delete]
- [ ] Build Rule Editor modal:
  - [ ] Asset Type (read-only, from context)
  - [ ] Metric (dropdown: engine_hours, flight_hours, landings, etc.)
  - [ ] Cost per Unit (decimal)
  - [ ] GL Account Debit (expense account)
  - [ ] GL Account Credit (accrual/reserve account)
  - [ ] Accrual Method (radio: Real-time / Batch-daily / Batch-monthly)
  - [ ] Is Active (checkbox)
  - [ ] Validation: unique rule for asset+metric+FY

### Design Tasks
- [ ] Create Rule Management page mockup
- [ ] Design Rule Editor form

### QA Tests
- [ ] "Create cost provision rule"
- [ ] "Pause/resume rule"
- [ ] "Duplicate rule for same asset+metric rejected with error"

---

## Milestone 2b.2: Accrual Staging & Batch Processing

### Backend Tasks
- [ ] Implement real-time accrual (when flight recorded):
  - [ ] If accrual_method = 1 (real-time):
    - [ ] Create draft accounting entry immediately
    - [ ] Debit GL from rule, Credit GL from rule
    - [ ] Link to flight_uuid (source_document_ref)
  - [ ] Else: add to CostAccrualStaging table
- [ ] Implement batch accrual job:
  - [ ] Daily job (23:59 UTC):
    - [ ] Query CostAccrualStaging with is_accrued=false
    - [ ] Group by rule + asset
    - [ ] Create one entry per rule per asset per day
    - [ ] Mark staging rows as is_accrued=true, set accrual_entry_uuid
  - [ ] Monthly job (1st at 02:00 UTC):
    - [ ] Similar logic, aggregated for entire month
- [ ] Implement staging query endpoints:
  - [ ] `GET /api/v1/accounting/cost-accrual-staging?fiscal_year_uuid=...` (pending accruals)
  - [ ] `POST /api/v1/accounting/cost-accrual-staging/post-now` (trigger manual batch)
- [ ] Add error handling:
  - [ ] If GL account not found, mark as failed (skip + log error)
  - [ ] Retry failed accruals on next batch

### Frontend Tasks
- [ ] Build Accrual Status Dashboard widget:
  - [ ] `pages/accounting/CostAccrualDashboard.tsx` (or tab in main dashboard)
  - [ ] Staging queue (pending accruals):
    - [ ] Table: Date | Asset | Metric | Qty | Cost | Status | Action
    - [ ] Show pending and recently posted
  - [ ] Batch job scheduler:
    - [ ] Show next run time
    - [ ] Show last run status (✓ or ✗)
    - [ ] [Trigger Manual Batch Now] button
- [ ] Implement error display:
  - [ ] Show failed accruals with error message
  - [ ] [Retry] button per failed item

### Design Tasks
- [ ] Design Accrual Dashboard mockup
- [ ] Design batch job status indicators

### QA Tests
- [ ] "Real-time accrual: flight recorded → entry created immediately"
- [ ] "Batch-daily accrual: staged, posted at scheduled time"
- [ ] "Batch job error: GL account not found, marked as failed"
- [ ] "Manual batch trigger: [Trigger Now] button works"

---

## Phase 2b Definition of Done

- [ ] Cost provision rules fully functional
- [ ] Real-time accrual working for flights
- [ ] Batch accrual jobs scheduled and tested
- [ ] Error handling and retry logic in place
- [ ] Dashboard shows accrual status
- [ ] E2E tests cover real-time and batch accruals
- [ ] Phase 2b ready for asset management integration

---

# PHASE 3: BUDGET MANAGEMENT (Weeks 10-12)

[Detailed tasks for budget preparation, KPI reporting, variance analysis]

---

# PHASE 4: PROJECTS & SUBVENTIONS (Weeks 13-14)

[Detailed tasks for multi-year project tracking]

---

# PHASE 5: FLIGHT SYNC & REPORTING (Weeks 15-16)

[Detailed tasks for flight integration, financial statements, exports]

---

# Testing & QA Summary

## Unit Tests (Backend)
- [ ] All validation logic (balance, boundaries, GL accounts)
- [ ] Age discount calculations
- [ ] Cost accrual calculations
- [ ] State transitions

## Integration Tests (Backend)
- [ ] Entry lifecycle (create → post → reverse)
- [ ] Pricing lifecycle (draft → activate → use → revert-check)
- [ ] Accrual staging and batch jobs

## E2E Tests (Frontend)
- [ ] User workflows (create entry, post, view)
- [ ] Form validation and real-time feedback
- [ ] State management and persistence

## Accessibility Tests
- [ ] WCAG 2.1 AA compliance
- [ ] Keyboard navigation
- [ ] Screen reader compatibility

## Performance Tests
- [ ] Page load time < 2s
- [ ] Form submit < 500ms
- [ ] Pagination with large datasets (1000+ entries)

---

# Deployment Checklist

- [ ] Code reviewed and merged to main
- [ ] All tests passing (unit, integration, E2E)
- [ ] Accessibility audit complete
- [ ] Performance benchmarks met
- [ ] Documentation updated
- [ ] Staging deployed and verified
- [ ] Rollback plan prepared
- [ ] Staff training completed
- [ ] Go-live approval from finance team

---

# Success Criteria

✓ **Functionality**: All Phase X features working as specified  
✓ **Quality**: No critical bugs, accessibility compliant  
✓ **Performance**: Page load < 2s, form submit < 500ms  
✓ **Usability**: Staff trained, no major pain points  
✓ **Auditability**: All transactions logged, immutability enforced  

---

**End of Checklist**
