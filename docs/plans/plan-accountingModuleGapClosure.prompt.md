# Implementation Plan: Accounting Module – Gap Closure

## What's Already Done (Audit May 4, 2026)

### Backend (Complete)
- ✅ All 9 accounting models: AccountingFiscalYear, AccountingAccount, AccountingJournal, AccountingEntry, AccountingLine, AccountingEntryTemplate, AccountingEntryTemplateLine, PricingVersion, PricingItem, PricingItemTier
- ✅ 50+ REST endpoints covering: fiscal years (CRUD + close/reopen), chart of accounts, journals, entries (CRUD + post + reverse), templates, pricing lifecycle, CSV import
- ✅ 70+ service functions with full business logic (balance validation, hash-based tamper detection, FY isolation, etc.)
- ✅ PCG seed data loaded (French association CoA)
- ✅ Capability-based route guards (POST_ACCOUNTING_ENTRIES, VIEW_FINANCIALS, MANAGE_ACCOUNTING_SETTINGS, MANAGE_PRICES)
- ✅ 5 accounting test files
- ❌ MISSING: `GET /api/v1/accounting/fiscal-years/active` endpoint

### Frontend (Partial)

**Done:**
| Component | File |
|---|---|
| Banque navigation hub | `frontend/src/modules/banque/components/BanquePage.tsx` |
| Journal entries list w/ filters | `frontend/src/modules/banque/components/JournalEntriesScreen.tsx` |
| Entry create/edit workspace | `frontend/src/modules/banque/components/JournalEntryWorkspaceScreen.tsx` |
| Pricing version lifecycle | `frontend/src/modules/banque/components/BankPricingPage.tsx` |
| PCG seed management | `frontend/src/modules/banque/components/BanquePcgPage.tsx` |
| Settings | `frontend/src/modules/banque/components/BanqueSettingsPage.tsx` |
| Entry templates | `frontend/src/modules/banque/components/JournalTemplatesScreen.tsx` |
| CSV import | `frontend/src/modules/banque/components/AccountingImportDialog.tsx` |
| Unified pricing view | `frontend/src/modules/pricing/components/PricingPage.tsx` |
| TanStack Query hooks | `frontend/src/modules/banque/api/index.ts` |

**Critical gap — FY duplication problem:**
`useFiscalYearsQuery` is called independently in **6 places**, each managing its own local FY `useState` + `useEffect` — the exact pattern the global FY store should replace:

| File | Line |
|---|---|
| `frontend/src/modules/banque/components/JournalEntriesScreen.tsx` | 43 |
| `frontend/src/modules/banque/components/JournalEntryWorkspaceScreen.tsx` | 75 |
| `frontend/src/modules/banque/components/BankPricingPage.tsx` | 853 |
| `frontend/src/modules/pricing/components/PricingPage.tsx` | 839 |
| `frontend/src/modules/assets/components/AssetPricingPage.tsx` | 662 |
| `frontend/src/modules/members/components/RegistrationPanel.tsx` | 114 |

**Other missing pieces:**
- ❌ `frontend/src/store/fiscalYearStore.ts` — does not exist
- ❌ FY selector in `frontend/src/shell/components/Header.tsx` — not present
- ❌ No accounting Dashboard screen (BanquePage is just nav links)
- ❌ No CoA browser (only the PCG seed editor exists)
- ❌ No financial reports/statements screens (Phase 3+)

---

## Plan: Modifications to Make

### Phase 1 — Global Fiscal Year Architecture

**Step 1.1 — Backend: Add `/fiscal-years/active` endpoint** *(independent)*

Files:
- `backend/api/routes/accounting.py`: add `GET /api/v1/accounting/fiscal-years/active`
- `backend/services/accounting.py`: add `get_active_fiscal_year()` — query state=Open, fallback to latest by `end_date`
- `backend/tests/test_accounting_service.py`: add test for the new endpoint

Response schema: reuse `FiscalYearResponse` — `{uuid, code, year, start_date, end_date, state}`

---

**Step 1.2 — Frontend: Create global Zustand store** *(independent; reuses FiscalYear type from banque/api)*

File to create: `frontend/src/store/fiscalYearStore.ts`

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FiscalYear } from '../modules/banque/api'

type FiscalYearState = {
  activeFiscalYearUuid: string | null
  secondaryFiscalYearUuid: string | null   // budget: FY+1 planning override
  activeFiscalYearData: FiscalYear | null
  setActiveFiscalYear: (uuid: string, data: FiscalYear) => void
  setSecondaryFiscalYear: (uuid: string) => void
  clearSecondary: () => void
}

export const useFiscalYearStore = create<FiscalYearState>()(
  persist(
    (set) => ({
      activeFiscalYearUuid: null,
      secondaryFiscalYearUuid: null,
      activeFiscalYearData: null,
      setActiveFiscalYear: (uuid, data) =>
        set({ activeFiscalYearUuid: uuid, activeFiscalYearData: data }),
      setSecondaryFiscalYear: (uuid) => set({ secondaryFiscalYearUuid: uuid }),
      clearSecondary: () => set({ secondaryFiscalYearUuid: null }),
    }),
    { name: 'fiscal-year-store' },
  ),
)
```

---

**Step 1.3 — Frontend: Add FY selector to Header** *(depends on 1.1 + 1.2)*

File to modify: `frontend/src/shell/components/Header.tsx`

- On mount (when `token` is present): call `GET /api/v1/accounting/fiscal-years/active`, initialize store if `activeFiscalYearUuid` is null
- Add compact `<select>` listing all FY (from `useFiscalYearsQuery`) between the language selector and the user avatar
- Display with color-coded badge per FY state:
  - `FY 2026 (Open)` → teal badge
  - `FY 2025 (Closed)` → gray badge
  - `FY 2025 (Reopened)` → amber badge
- On change → `setActiveFiscalYear(uuid, data)`
- Visible only when user is authenticated (already guarded by `token`)

---

**Step 1.4 — Frontend: Migrate 6 components to global store** *(depends on 1.2; can be done module-by-module)*

Pattern to replace in each component:

```ts
// BEFORE
const fiscalYearsQuery = useFiscalYearsQuery(canView)
const [filters, setFilters] = useState({ fiscal_year_uuid: '', ... })
useEffect(() => {
  if (fiscalYears.length > 0 && filters.fiscal_year_uuid === '') {
    setFilters((prev) => ({ ...prev, fiscal_year_uuid: fiscalYears[0].uuid }))
  }
}, [fiscalYears, filters.fiscal_year_uuid])

// AFTER
const activeFY = useFiscalYearStore((s) => s.activeFiscalYearUuid)
// use activeFY directly in query filter
```

Components:
1. `JournalEntriesScreen.tsx` — remove local FY dropdown from filter bar; keep journal/state/search filters
2. `JournalEntryWorkspaceScreen.tsx` — remove local FY state; use global store for FY scoping
3. `BankPricingPage.tsx` — remove local FY dropdown; display active FY as read-only context
4. `PricingPage.tsx` — remove local FY dropdown; display active FY as read-only context
5. `AssetPricingPage.tsx` — remove local FY dropdown; display active FY as read-only context
6. `RegistrationPanel.tsx` — **verify intent first**: this may need a year for a member registration, not accounting FY — may keep local selector or derive from `activeFiscalYearData.year`

---

### Phase 2 — Missing Frontend Screens *(after Phase 1)*

**Step 2.1 — Accounting Dashboard** *(parallel with 2.2)*

File to create: `frontend/src/modules/banque/components/BanqueDashboardPage.tsx`

- FY hero bar at top: `FY 2026 | 2026-01-01 → 2026-12-31 | Status: Open | Last posted: #BK-2026-0045`
- Summary cards (4-up grid):
  - Draft entries count + total debit amount
  - Posted entries count + total debit amount
  - Total debits for active FY
  - Total credits for active FY (should equal debits if balanced)
- Journal activity breakdown: entries grouped by journal type (Sale, Purchase, Bank, Cash, General)
- Quick actions: `[+ New Entry]` → `/banque/journal/workspace/new`, `[Import CSV]` → opens existing `AccountingImportDialog`
- Recent entries table (last 10, sorted by date desc): columns — #, date, journal, description, state badge, debit, credit
- Replace current link-only `BanquePage.tsx` or add as new route `/banque/dashboard`

**Step 2.2 — CoA Browser** *(parallel with 2.1)*

File to create: `frontend/src/modules/banque/components/BanqueCoaPage.tsx`

- Hierarchical tree view using existing `useAccountsQuery`
- Group by account class (1–7) using the first digit of `code`
- Collapsible sections per class; show: code, name, type, normal balance
- Link to "Manage PCG Seed" → existing `BanquePcgPage`
- Route: `/banque/pcg/accounts` (or replace current `/banque/pcg`)

---

**Step 2.3 — Entry lock state UI in workspace** *(depends on existing `JournalEntryWorkspaceScreen`)*

File to modify: `frontend/src/modules/banque/components/JournalEntryWorkspaceScreen.tsx`

When entry `state === 'Posted'` (state value `2`):
- Show large `✓ POSTED` green badge at the top of the form, with sub-text: `"Posted by {user} on {date}. Immutable."`
- Disable all input fields (`disabled` or `readOnly` prop — already guarded on backend, mirrored in UI for clarity)
- Hide `[Save Draft]` and `[Post Entry]` buttons
- Show `🔒 This entry is posted and cannot be edited.` warning banner
- Show `[Reverse This Entry]` CTA button (opens Step 2.4 modal)

When entry `state === 'Draft'`:
- Show `⊙ DRAFT` amber badge with sub-text `"Editable until posted"`
- All fields enabled (current behavior — verify)

---

**Step 2.4 — Reversal modal** *(depends on 2.3; backend endpoint already exists)*

File to create: `frontend/src/modules/banque/components/ReversalDialog.tsx`

Triggered by `[Reverse This Entry]` CTA in Step 2.3.

Modal content:
- Read-only display of original entry (header + lines: debit account, credit account, amounts)
- `Reversal reason` free-text input (required)
- Preview section `[What will happen]`:
  - ✓ Original entry `#{ref}` remains POSTED and unchanged
  - ✓ New DRAFT entry will be created with reversed amounts (show account flip)
  - ✓ New entry linked to original via `reversal_of_entry_uuid`
- Actions: `[Cancel]` / `[Create Reversal Draft]`
- On confirm: call `POST /api/v1/accounting/entries/{uuid}/reverse` (already implemented), navigate to new draft entry

---

**Step 2.5 — Real-time balance indicator in entry workspace** *(depends on existing workspace screen)*

File to modify: `frontend/src/modules/banque/components/JournalEntryWorkspaceScreen.tsx`

- Add a sticky balance bar above the lines table (or inline in the form header)
- Compute `totalDebit` and `totalCredit` from current line inputs using `Decimal.js`
- States:
  - `✓ Balanced` → green badge when `totalDebit === totalCredit && totalDebit > 0`
  - `⚠ Unbalanced (Δ €{diff})` → amber badge at all other times
- `[Post Entry]` button disabled when not balanced (already enforced on backend — mirror in UI)
- Update live on every line change (no debounce needed — local state only)

---

**Step 2.6 — Pricing pre-activation checklist guard** *(depends on existing `BankPricingPage`)*

File to modify: `frontend/src/modules/banque/components/BankPricingPage.tsx`

For Draft pricing versions, before `[Activate]` can be clicked:
- Compute client-side: count items where `gl_credit_account_uuid` is null
- If count > 0:
  - Disable `[Activate]` button
  - Show tooltip: `"Missing GL credit account on {n} item(s). Assign before activation."`
  - Show inline progress bar: `{complete}/{total} items ready ({pct}%)`
- If count === 0:
  - Enable `[Activate]` button
  - Show `✓ All items have GL accounts — ready to activate`
- This is a pure frontend guard; backend already validates on `PATCH /activate` call

---

## Scope Exclusions (Phase 3+)
- Budget module: `secondaryFiscalYearUuid` pattern, variance analysis screens
- Flight Sync: automatic entry generation from flight log data
- Financial Reports: balance sheet, P&L statement screens
- Cost Provision Rules: accrual batch job UI

---

## Implementation Order (Dependency Graph)
```
1.1 (backend /active endpoint)
  └─► 1.3 (Header FY selector)

1.2 (fiscalYearStore.ts)
  └─► 1.3 (Header FY selector)
  └─► 1.4a (JournalEntriesScreen)
  └─► 1.4b (JournalEntryWorkspaceScreen)
  └─► 1.4c (BankPricingPage)
  └─► 1.4d (PricingPage)
  └─► 1.4e (AssetPricingPage)
  └─► 1.4f (RegistrationPanel — verify intent first)

1.3 (Header FY selector)
  └─► 2.1 (Dashboard — reads active FY from store)
  └─► 2.2 (CoA Browser)

1.4b (JournalEntryWorkspaceScreen migration)
  └─► 2.3 (Lock state UI)
        └─► 2.4 (Reversal modal)
        └─► 2.5 (Real-time balance indicator)

1.4c (BankPricingPage migration)
  └─► 2.6 (Pre-activation checklist guard)
```
