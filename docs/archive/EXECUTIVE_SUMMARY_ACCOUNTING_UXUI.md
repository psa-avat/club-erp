# Accounting UX/UI Implementation Plan — Executive Summary

**Date**: May 4, 2026  
**Prepared for**: Senior development team + finance stakeholders  
**Status**: Complete strategic plan ready for execution  

---

## Objective

Translate SPEC_ACCOUNTING.md + AeroOps reference interfaces into a cohesive, accessible accounting module UX/UI that:
- **Enforces financial auditability** (posted entries immutable, fiscal year isolation)
- **Maximizes staff usability** (clear feedback, progressive disclosure, template reuse)
- **Ensures regulatory compliance** (WCAG 2.1 AA, audit trails, capability-based access)

---

## Deliverables Completed

### 1. **PLAN_ACCOUNTING_UXUI_IMPLEMENTATION.md** (10,000+ words)
   Comprehensive UX/UI specification covering:
   - ✅ Module architecture & state management (TanStack Query + Zustand)
   - ✅ 5 phases with detailed screen wireframes
   - ✅ Form validation patterns, accessibility, responsive design
   - ✅ 16-week roadmap with 8 milestones
   - ✅ Design tokens, color palette, typography

   **Key Sections**:
   - Phase 1: Dashboard, Ledger, Entry Form, Posted View, CoA, Templates
   - Phase 2: Pricing Lifecycle, Tier Editor, GL Account Mapping, Age Discounts
   - Phase 2b: Cost Provision Rules, Accrual Staging, Batch Jobs
   - Phase 3: Budget Preparation, Variance Dashboard, KPI Reporting
   - Phase 4: Projects, Subventions, Multi-Year Tracking
   - Phase 5: Flight Sync, Financial Statements, Exports

### 2. **CHALLENGE_ACCOUNTING_UXUI_DESIGN.md** (8,000+ words)
   Strategic document identifying 7 key UX/UI challenges in the spec:
   - ✅ **Challenge 1**: Fiscal year partitioning invisibility → Solution: Persistent FY selector
   - ✅ **Challenge 2**: Posted immutability not visually clear → Solution: Lock icon + disabled inputs
   - ✅ **Challenge 3**: Pricing version lifecycle governance → Solution: Timeline UI + conditional buttons
   - ✅ **Challenge 4**: Cost provision complexity → Solution: Batch metaphors (🚀, 📅, 📊)
   - ✅ **Challenge 5**: Age discount logic transparency → Solution: Eligibility badges + preview calculations
   - ✅ **Challenge 6**: Fiscal year close/reopen privilege → Solution: Admin-only UI + irreversible confirmations
   - ✅ **Challenge 7**: GL account mapping validation → Solution: Smart suggestions + pre-activation checklist

### 3. **CHECKLIST_ACCOUNTING_IMPLEMENTATION.md** (5,000+ words)
   Phase-by-phase execution guide with:
   - ✅ Backend tasks (models, endpoints, validation, tests)
   - ✅ Frontend tasks (components, pages, mutations, state)
   - ✅ QA test scenarios (E2E, accessibility, performance)
   - ✅ Design deliverables (wireframes, mockups, tokens)
   - ✅ Definition of Done for each phase
   - ✅ Testing & deployment checklists

---

## Critical UX/UI Decisions

### 0. Global Fiscal Year Context (Shell Level)
**Why**: Every module needs FY isolation; eliminate per-module FY selectors
**Design**: 
- Single FY selector in TopNavigation (persistent across all modules)
- Zustand store with localStorage persistence
- All queries auto-scoped to `activeFiscalYearUuid`
- Budget can override with `secondaryFiscalYearUuid` for FY+1 planning
- Reference: `ARCHITECTURE_GLOBAL_FISCAL_YEAR.md`
```
TopNav: [Accounting] FY 2026 (Open) [Switch ▼]
Result: Ledger, Budget, Reports all see same FY unless overridden
```

### 1. Multi-Layered Immutability Signals
**Why**: Posted entries must never be accidentally edited
**Design**: 
- Entry list: Green ✓ POSTED tag
- Detail view: Large lock icon + disabled form + reversal workflow

### 2. Preview Mode for Active Pricing Versions
**Why**: Active versions locked for billing, but staff need to view/audit
**Design**: Read-only cards with "Make Copy to Draft" for edits

### 3. Transparent Age Discount Calculation
**Why**: Spec applies discount at billing time, but members must understand why
**Design**: 
- Member badge: "⭐ U25 Eligible (Age 23)"
- Item display: "€85/hour → -15% discount = €72.25/hour"
- Accounting entry memo: logs discount calculation for audit

### 4. Batch Accrual Simplified with Metaphors
**Why**: Real-time vs batch concepts unfamiliar to staff
**Design**: 
- 🚀 Real-time: "Like a cash register—immediate"
- 📅 Batch-Daily: "Collect receipts, post once daily"
- 📊 Batch-Monthly: "Monthly reconciliation at month-end"

---

## Implementation Roadmap

| Phase | Focus | Duration | Key Deliverables |
|-------|-------|----------|------------------|
| **1** | Core Ledger | Weeks 1-4 | Dashboard, entry form, templates, CoA |
| **2** | Pricing Governance | Weeks 5-7 | Version lifecycle, GL mapping, age discounts |
| **2b** | Cost Accrual | Weeks 8-9 | Rules, real-time/batch, staging dashboard |
| **3** | Budget Management | Weeks 10-12 | Preparation, KPI, variance reporting |
| **4** | Projects/Subventions | Weeks 13-14 | Multi-year tracking, project dimensions |
| **5** | Flight Sync & Reports | Weeks 15-16 | Integration monitoring, financial statements |

**Total**: 16-week engagement, ~6 developer-months equivalent

---

## Architecture Highlights

### Shell-Level: Global Fiscal Year Management
```
frontend/src/
├── store/
│   └── fiscalYearStore.ts        (Zustand, persisted to localStorage)
│       ├── activeFiscalYearUuid
│       ├── secondaryFiscalYearUuid (budget FY+1 planning)
│       └── activeFiscalYearData (metadata)
├── context/
│   └── FiscalYearContext.tsx     (optional, for deep component prop drilling)
└── components/
    └── TopNavigation.tsx         (FY selector lives here, shared across all modules)
```

**Result**: No per-module FY selection. All modules use global store via `useFiscalYearStore()`.

### Frontend Module Structure (Accounting-Specific)
```
frontend/src/modules/accounting/
├── api/
│   ├── queries.ts        (TanStack Query GET hooks, auto-scoped to global FY)
│   ├── mutations.ts      (POST/PUT/PATCH mutations)
│   └── types.ts          (Request/response types)
├── components/
│   ├── shared/           (EntryStateTag, LockedWarning, BalanceIndicator, etc.)
│   │   └── Note: FY selector not here (moved to TopNav)
│   ├── ledger/           (Entry list, filters)
│   ├── entries/          (Form, detail, reversal)
│   ├── pricing/          (Version lifecycle, tier editor)
│   ├── budget/           (Variance dashboard, can use secondaryFY)
│   ├── costing/          (Cost rules, staging)
│   └── reports/          (Financial statements)
├── store/
│   ├── draftEntryStore.ts     (Zustand for in-progress entries)
│   └── filterStore.ts         (UI filters & pagination)
└── types/
```

### State Management
- **Global Fiscal Year Store** (shell level): Active FY, secondary FY, metadata (persisted)
- **TanStack Query**: Server data (auto-scoped to active FY)
- **Zustand** (module-level): Client state (draft entries, UI filters, preferences)
- **React Context**: Global FY (if needed to avoid prop drilling in deep components)
- **Decimal.js**: All numeric calculations (precision safety)

### Design System
- **Colors**: Tailwind + shadcn/ui (teal primary, green success, yellow draft, red error)
- **Spacing**: 1rem component gap, 2rem section gap
- **Typography**: H1-H3, body, caption (semantic)
- **Accessibility**: WCAG 2.1 AA, keyboard nav, semantic HTML, alt text

---

## Success Criteria

| Dimension | Target | Method |
|-----------|--------|--------|
| **Functionality** | All Phase X features work as specified | Manual testing + E2E suite |
| **Quality** | Zero critical bugs, accessible | Accessibility audit + test coverage > 80% |
| **Performance** | Page load < 2s, form submit < 500ms | Lighthouse CI + performance monitoring |
| **Usability** | Staff trained, no major pain points | User testing + feedback survey |
| **Auditability** | All transactions logged, immutable | Audit trail tests + manual review |
| **Maintainability** | Code well-documented, consistent patterns | Code review + architecture review |

---

## Key References

1. **SPEC_ACCOUNTING.md**: Source of truth for business logic, data model, governance rules
2. **AeroOps Screenshots**: Reference interfaces demonstrating professional UX patterns
3. **Project Instructions**: Backend/Frontend guidelines, capabilities model, auth flow
4. **PLAN_ACCOUNTING_UXUI_IMPLEMENTATION.md**: Complete technical UX/UI specification
5. **CHALLENGE_ACCOUNTING_UXUI_DESIGN.md**: Strategic design decisions & rationale
6. **CHECKLIST_ACCOUNTING_IMPLEMENTATION.md**: Phase-by-phase execution tasks

---

## Next Steps

### Immediate (Week 1)
1. Review all 3 deliverable documents with team
2. Finalize Figma wireframes (Phase 1 priority)
3. Set up frontend module structure
4. Kickoff Sprint 1 backend tasks

### Short-term (Weeks 1-4)
1. Complete Phase 1 backend (models, migrations, endpoints)
2. Build Phase 1 frontend (dashboard, ledger, entry form)
3. Implement TanStack Query hooks and mutations
4. Begin E2E test automation

### Medium-term (Weeks 5-8)
1. Integrate Pricing module (Phase 2)
2. Add cost provision rules (Phase 2b)
3. User acceptance testing with finance team
4. Staff training preparation

### Long-term (Weeks 9-16)
1. Budget, Projects, Flight Sync (Phases 3-5)
2. Financial reporting & exports
3. Deployment & go-live

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| FY complexity confuses users | High | Persistent FY context, training materials |
| Posting immutability frustrates staff | Medium | Clear UI signals, reversal workflow, documentation |
| Pricing version management overhead | Medium | Simplified UI (cards, timeline), GL validation |
| Batch accrual errors undetected | Medium | Dashboard alerts, error queue, manual trigger |
| Age discount calculation disputes | Low | Transparent preview, audit memo, export report |
| Regulatory compliance (GL mappings) | High | Validation pre-activation, mandatory GL assignment |

---

## Conclusion

This comprehensive plan bridges the gap between the SPEC_ACCOUNTING.md requirements and real-world user needs, demonstrated by professional accounting systems like AeroOps. By implementing the phased approach with clear UX/UI patterns, accessibility focus, and rigorous validation, the club-erp accounting module will be:

✅ **Financially Rigorous**: Immutable ledger, fiscal year isolation, audit trails  
✅ **Staff-Friendly**: Persistent context, real-time feedback, template reuse  
✅ **Accessible**: WCAG 2.1 AA, keyboard navigation, screen reader compatible  
✅ **Maintainable**: Clear architecture, consistent patterns, well-documented  

**Estimated Effort**: 6 developer-months across Backend + Frontend + QA  
**Estimated Duration**: 16 weeks with daily coordination  

---

**Prepared by**: Senior UX/UI Architect  
**Date**: May 4, 2026  
**Status**: ✅ Ready for team review & execution sprint kickoff
