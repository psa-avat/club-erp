# Global Fiscal Year Context Architecture

**Date**: May 4, 2026  
**Status**: Architectural refinement for Phase 1  

---

## Rationale

The SPEC_ACCOUNTING.md mandates fiscal year isolation across all data queries. Rather than having each module manage FY selection independently, we should:

✅ **Single source of truth**: Global FY state at shell level  
✅ **Persistent across navigation**: FY selection survives page changes  
✅ **Accessible to all modules**: Zustand store + React Context  
✅ **Default to current year**: Auto-select active FY on app load  
✅ **Allow local overrides**: Budget can select FY+1 without affecting other modules  

---

## Implementation Architecture

### 1. Global Zustand Store (Shell Level)

**File**: `frontend/src/store/fiscalYearStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FiscalYearState {
  // Primary: currently active FY for most operations
  activeFiscalYearUuid: string | null;
  
  // Secondary: optional comparison/planning year (e.g., Budget FY+1)
  secondaryFiscalYearUuid: string | null;
  
  // Cached metadata
  activeFiscalYearData: {
    uuid: string;
    startDate: string; // ISO 8601
    endDate: string;
    state: 'open' | 'closed' | 'reopened';
  } | null;
  
  // Actions
  setActiveFiscalYear: (uuid: string, data?: any) => void;
  setSecondaryFiscalYear: (uuid: string | null) => void;
  clearSecondary: () => void;
}

export const useFiscalYearStore = create<FiscalYearState>()(
  persist(
    (set) => ({
      activeFiscalYearUuid: null,
      secondaryFiscalYearUuid: null,
      activeFiscalYearData: null,

      setActiveFiscalYear: (uuid: string, data?: any) =>
        set({
          activeFiscalYearUuid: uuid,
          activeFiscalYearData: data,
        }),

      setSecondaryFiscalYear: (uuid: string | null) =>
        set({ secondaryFiscalYearUuid: uuid }),

      clearSecondary: () =>
        set({ secondaryFiscalYearUuid: null }),
    }),
    {
      name: 'fiscal-year-store',
      partialize: (state) => ({
        // Persist only UUIDs, not full metadata
        activeFiscalYearUuid: state.activeFiscalYearUuid,
        secondaryFiscalYearUuid: state.secondaryFiscalYearUuid,
      }),
    }
  )
);
```

### 2. Shell-Level FY Initialization

**File**: `frontend/src/App.tsx` or similar root component

```typescript
import { useEffect } from 'react';
import { useFiscalYearStore } from './store/fiscalYearStore';
import { useGetActiveFiscalYear } from './modules/accounting/api/queries';

export function App() {
  const setActiveFiscalYear = useFiscalYearStore(
    (state) => state.setActiveFiscalYear
  );
  
  // On app load, fetch and set active FY
  const { data: activeFY } = useGetActiveFiscalYear();
  
  useEffect(() => {
    if (activeFY) {
      setActiveFiscalYear(activeFY.uuid, {
        startDate: activeFY.startDate,
        endDate: activeFY.endDate,
        state: activeFY.state,
      });
    }
  }, [activeFY, setActiveFiscalYear]);

  return (
    <div className="app">
      <TopNavigation /> {/* FY selector lives here */}
      <main>
        <Routes>
          <Route path="/accounting/*" element={<AccountingModule />} />
          <Route path="/budget/*" element={<BudgetModule />} />
          {/* All modules receive global FY via store */}
        </Routes>
      </main>
    </div>
  );
}
```

### 3. Top Navigation with FY Selector

**File**: `frontend/src/components/TopNavigation.tsx`

```typescript
import { useFiscalYearStore } from '../store/fiscalYearStore';
import { useGetFiscalYears } from '../modules/accounting/api/queries';

export function TopNavigation() {
  const { activeFiscalYearUuid, activeFiscalYearData, setActiveFiscalYear } =
    useFiscalYearStore();
  
  const { data: allFiscalYears } = useGetFiscalYears();

  return (
    <nav className="top-nav bg-teal-900 text-white px-4 py-2">
      <div className="flex items-center justify-between">
        {/* Left: Logo + Module Breadcrumb */}
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Club ERP</h1>
          <span className="text-gray-300">/</span>
          <span id="current-module">Accounting</span>
        </div>

        {/* Center: Global FY Display + Selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-100">Fiscal Year:</label>
          <select
            value={activeFiscalYearUuid || ''}
            onChange={(e) => {
              const fy = allFiscalYears?.find(
                (f) => f.uuid === e.target.value
              );
              if (fy) {
                setActiveFiscalYear(fy.uuid, {
                  startDate: fy.startDate,
                  endDate: fy.endDate,
                  state: fy.state,
                });
              }
            }}
            className="bg-teal-800 text-white px-3 py-1 rounded text-sm"
          >
            {allFiscalYears?.map((fy) => (
              <option key={fy.uuid} value={fy.uuid}>
                {fy.year} ({fy.state.toUpperCase()})
              </option>
            ))}
          </select>

          {/* Status Badge */}
          <span
            className={`px-2 py-1 rounded text-xs font-semibold ${
              activeFiscalYearData?.state === 'open'
                ? 'bg-green-600'
                : activeFiscalYearData?.state === 'closed'
                  ? 'bg-gray-600'
                  : 'bg-yellow-600'
            }`}
          >
            {activeFiscalYearData?.state.toUpperCase()}
          </span>

          {/* Date range info */}
          <span className="text-xs text-gray-200 ml-2">
            {activeFiscalYearData?.startDate} →{' '}
            {activeFiscalYearData?.endDate}
          </span>
        </div>

        {/* Right: User Menu */}
        <UserMenu />
      </div>
    </nav>
  );
}
```

### 4. Module Usage: Access Global FY

**In any module** (e.g., Accounting Dashboard):

```typescript
import { useFiscalYearStore } from '../../store/fiscalYearStore';
import { useLedgerEntriesQuery } from './api/queries';

export function AccountingDashboard() {
  const activeFiscalYearUuid = useFiscalYearStore(
    (state) => state.activeFiscalYearUuid
  );

  // All queries automatically scoped to activeFiscalYearUuid
  const { data: entries } = useLedgerEntriesQuery({
    fiscalYearUuid: activeFiscalYearUuid!,
    limit: 10,
  });

  return (
    <div>
      <h2>Ledger for FY {activeFiscalYearUuid}</h2>
      {/* Render entries */}
    </div>
  );
}
```

### 5. Module Override: Budget (FY+1 Planning)

**Special case**: Budget module prepares FY N+1 while FY N is operational.

```typescript
import { useFiscalYearStore } from '../../store/fiscalYearStore';
import { useBudgetQuery } from './api/queries';

export function BudgetModule() {
  const activeFY = useFiscalYearStore((state) => state.activeFiscalYearUuid);
  const { secondaryFiscalYearUuid, setSecondaryFiscalYear } =
    useFiscalYearStore();

  // Budget works with secondary FY (N+1)
  const budgetFY = secondaryFiscalYearUuid || getNextFiscalYear(activeFY);

  const { data: budget } = useBudgetQuery({
    fiscalYearUuid: budgetFY,
  });

  return (
    <div>
      <div className="budget-selector">
        <label>Preparing Budget for:</label>
        <select
          value={budgetFY}
          onChange={(e) => setSecondaryFiscalYear(e.target.value)}
        >
          {/* Allow selecting FY for budget prep */}
        </select>
        <span className="text-sm text-gray-600">
          (Module override: Budget plans ahead while {activeFY} is current)
        </span>
      </div>

      {/* Render budget for budgetFY */}
    </div>
  );
}
```

### 6. React Context Wrapper (Optional, for prop drilling avoidance)

**File**: `frontend/src/context/FiscalYearContext.tsx` (if deeper components need FY)

```typescript
import { createContext, useContext } from 'react';
import { useFiscalYearStore } from '../store/fiscalYearStore';

interface FiscalYearContextValue {
  activeFiscalYearUuid: string | null;
  activeFiscalYearData: any;
  setActiveFiscalYear: (uuid: string, data?: any) => void;
}

const FiscalYearContext = createContext<FiscalYearContextValue | null>(null);

export function FiscalYearProvider({ children }: { children: React.ReactNode }) {
  const state = useFiscalYearStore();

  return (
    <FiscalYearContext.Provider value={state as any}>
      {children}
    </FiscalYearContext.Provider>
  );
}

export function useFiscalYearContext() {
  const context = useContext(FiscalYearContext);
  if (!context) {
    throw new Error(
      'useFiscalYearContext must be used within FiscalYearProvider'
    );
  }
  return context;
}
```

### 7. Backend API: Get Active Fiscal Year

**File**: `backend/app/modules/accounting/routes.py`

```python
@router.get("/fiscal-years/active")
async def get_active_fiscal_year(
    current_user: User = Depends(get_current_user),
):
    """Return the currently open (or most recent) fiscal year."""
    active_fy = await db.query(FiscalYear).filter(
        FiscalYear.state == 1  # Open
    ).first()
    
    if not active_fy:
        # Fallback to most recent closed
        active_fy = await db.query(FiscalYear).order_by(
            FiscalYear.start_date.desc()
        ).first()
    
    if not active_fy:
        raise HTTPException(status_code=404, detail="No fiscal year found")
    
    return {
        "uuid": str(active_fy.uuid),
        "year": active_fy.year,
        "startDate": active_fy.start_date.isoformat(),
        "endDate": active_fy.end_date.isoformat(),
        "state": ["open", "closed", "reopened"][active_fy.state - 1],
    }

@router.get("/fiscal-years")
async def list_fiscal_years(
    current_user: User = Depends(get_current_user),
):
    """List all fiscal years (for selector dropdown)."""
    fys = await db.query(FiscalYear).order_by(
        FiscalYear.start_date.desc()
    ).all()
    
    return [
        {
            "uuid": str(fy.uuid),
            "year": fy.year,
            "startDate": fy.start_date.isoformat(),
            "endDate": fy.end_date.isoformat(),
            "state": ["open", "closed", "reopened"][fy.state - 1],
        }
        for fy in fys
    ]
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        App Root                             │
│  1. Fetch active FY from backend                            │
│  2. Set in Zustand store (persisted to localStorage)        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    TopNavigation                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ FY Selector [FY 2026 Open] [Change to FY 2027] ⏬     │   │
│  └────────┬──────────────────────────────────────────────┘   │
└───────────┼──────────────────────────────────────────────────┘
            │ Updates activeFiscalYearUuid in Zustand
            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Module A (Accounting)                    │
│  const fy = useFiscalYearStore((s) => s.activeFY)           │
│  const { data } = useLedgerQuery({ fiscalYearUuid: fy })    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Dashboard (uses activeFY automatically)              │    │
│  │ Ledger (filtered to activeFY)                        │    │
│  │ Entry Form (date validated against activeFY range)  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Module B (Budget)                        │
│  const secondary = useFiscalYearStore((s) => s.secondary)   │
│  const { data } = useBudgetQuery({ fiscalYearUuid: sec })   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Budget Editor (uses secondaryFY for N+1 planning)   │    │
│  │ Variance Report (compares active vs budget FY)      │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Benefits

| Aspect | Benefit |
|--------|---------|
| **Single Source of Truth** | FY state changes once, all modules reflect instantly |
| **Persistent Selection** | User selects FY 2027 on Accounting, it stays on Accounting → Budget |
| **Reduced Boilerplate** | No FY selector in every module component |
| **Module Independence** | Budget can override with secondary FY without affecting Accounting |
| **Performance** | FY data cached in localStorage, no duplicate API calls |
| **Type Safety** | TypeScript ensures valid FY UUIDs across modules |

---

## Implementation Checklist (Phase 1)

- [ ] Create `fiscalYearStore.ts` (Zustand store with persist middleware)
- [ ] Create backend `/api/v1/accounting/fiscal-years/active` endpoint
- [ ] Create backend `/api/v1/accounting/fiscal-years` endpoint (list)
- [ ] Integrate FY fetch + store initialization in App root
- [ ] Build TopNavigation FY selector component
- [ ] Update all accounting module hooks to use `useFiscalYearStore()`
- [ ] Add React Context wrapper (if needed for deep components)
- [ ] Document FY selection flow in component README
- [ ] Test: FY persistence across navigation
- [ ] Test: FY changes reflected in all modules
- [ ] Test: Budget secondary FY override works

---

## Migration Guide (If Refactoring Existing Code)

### Before (per-module FY selection)
```typescript
export function LedgerPage() {
  const [selectedFY, setSelectedFY] = useState(null);
  const { data } = useLedgerQuery({ fiscalYearUuid: selectedFY });
  
  return (
    <div>
      <select value={selectedFY} onChange={(e) => setSelectedFY(e.target.value)}>
        {/* FY options */}
      </select>
      {/* Ledger table */}
    </div>
  );
}
```

### After (global FY context)
```typescript
export function LedgerPage() {
  const activeFY = useFiscalYearStore((s) => s.activeFiscalYearUuid);
  const { data } = useLedgerQuery({ fiscalYearUuid: activeFY! });
  
  return <div>{/* Ledger table, no FY selector needed */}</div>;
}
```

---

## Conclusion

A global fiscal year context at the shell level eliminates redundancy, ensures consistency, and makes the user experience more cohesive. Modules can still override (e.g., Budget) when needed, but the default is "respect the global FY"—exactly what users expect in an integrated accounting system.
