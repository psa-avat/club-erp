Below is a detailed implementation plan a coding agent can execute incrementally.

**Goal**

Improve `/workspace/finance?tab=comptabilite` as a treasurer/assistant-friendly finance cockpit while keeping the existing advanced `AccountingWorkspacePage` available for expert/accountant use.

**Principles**

- Keep advanced accounting features, but expose them through task-first workflows.
- Default statutory views to posted entries only.
- Make reconciliation mandatory before fiscal-year close.
- Prefer backend-calculated accounting facts over frontend reconstruction.
- Keep changes incremental and shippable.

**Phase 1: Navigation Restructure**

Files likely involved:
- `frontend/src/modules/banque/components/FinanceWorkspacePage.tsx`
- `frontend/src/modules/banque/components/FinancialReportsPage.tsx`
- `frontend/src/modules/banque/components/GrandLivreScreen.tsx`

Tasks:
1. Replace the current flat `ComptabiliteSection` tabs with grouped assistant-oriented tabs:
   - `a-faire`
   - `saisie`
   - `rapprochement`
   - `documents`
   - `parametres`

2. Under `a-faire`, add a new placeholder/component:
   - `FinanceAccountingCockpitPage.tsx`

3. Under `saisie`, include:
   - `JournalEntriesScreen defaultState={0}`
   - `CreditCardSettlementPage`
   - `ChequeReceiptPage`
   - `ChequeRemittancePage`
   - `AccountingImportDialog` entry point if suitable

4. Under `rapprochement`, include:
   - `ReconciliationWorkspace`

5. Under `documents`, include:
   - `AccountTrialBalancePage`
   - `GrandLivreScreen`
   - `FinancialReportsPage`

6. Under `parametres`, include:
   - `BanqueCoaPage`
   - `JournalTemplatesScreen recurrenceFilter={[1]}`
   - `JournalTemplatesScreen recurrenceFilter={[2, 3, 4]}`
   - fiscal years page if desired in finance workspace

Acceptance criteria:
- `/workspace/finance?tab=comptabilite` no longer shows one long row of unrelated accounting tabs.
- Assistant users can find “what to do”, “enter”, “reconcile”, “documents”, and “settings”.
- Existing `AccountingWorkspacePage` still works unchanged.

**Phase 2: Finance Accounting Cockpit**

Create:
- `frontend/src/modules/banque/components/FinanceAccountingCockpitPage.tsx`

Use existing hooks where possible:
- `useAccountingEntriesCountQuery`
- `useFiscalYearsQuery`
- reconciliation hooks from `frontend/src/modules/banque/api/index.ts`
- active fiscal year store

Cockpit cards:
1. Draft entries to validate
   - count entries with `state=1`
   - action: open journal filtered to drafts

2. Cancelled/draft anomalies
   - count `state=3` or entries requiring attention if current model treats cancelled as draft-like
   - action: open journal filtered

3. Bank lines to reconcile
   - count unmatched/discrepancy bank lines if API exists
   - otherwise show statement-level reconciliation summary

4. Reconciliation discrepancies
   - count discrepancy lines
   - action: open reconciliation workspace

5. Entries without required tiers
   - count using existing `null_tiers` filter
   - action: open journal with `null_tiers=true`

6. Recurring entries due
   - use existing recurring/template APIs if available
   - if no endpoint exists, add placeholder card with disabled state

7. Fiscal year status
   - current active fiscal year
   - open/closed status
   - warning if no active fiscal year

UX requirements:
- Dense operational layout, no marketing hero.
- Cards should be compact status tiles, not decorative cards.
- Each tile must answer: count, why it matters, primary action.
- Use icons from `lucide-react`.
- Empty/good states should feel reassuring: “Aucune écriture à valider”.

Acceptance criteria:
- Treasurer can understand the accounting workload in under 10 seconds.
- Every non-zero item has a useful deep link or action.
- No backend changes required for the first version unless missing counts make the cockpit misleading.

**Phase 3: Journal Presets and UX Cleanup**

File:
- `frontend/src/modules/banque/components/JournalEntriesScreen.tsx`

Tasks:
1. Add optional props:
   - `initialFilters?: Partial<JournalFilters>`
   - `preset?: 'drafts' | 'unreconciled' | 'discrepancies' | 'missing-tiers' | 'posted'`
   - `compactFilters?: boolean`

2. Add filter preset buttons/chips:
   - Brouillons
   - Validées
   - À rapprocher
   - Écarts bancaires
   - Sans tiers
   - Exercice courant

3. Replace always-expanded advanced filters with:
   - visible quick filters
   - collapsible “Filtres avancés”

4. Preserve current advanced filter capabilities.

5. Replace `window.prompt` reversal with a modal:
   - new component: `ReversalDialog` may already exist; reuse if possible
   - show entry summary
   - require reversal reason
   - submit to existing reverse mutation

Acceptance criteria:
- Existing filters still work.
- Common workflows take fewer clicks.
- Reversal no longer uses browser prompt.
- Bulk post/delete behavior unchanged except improved confirmation copy if touched.

**Phase 4: Documents and Reports**

Files:
- `frontend/src/modules/banque/components/FinancialReportsPage.tsx`
- `frontend/src/modules/banque/components/AccountTrialBalancePage.tsx`
- `frontend/src/modules/banque/components/GrandLivreScreen.tsx`

Tasks:
1. Set `FinancialReportsPage` default `postedOnly` to `true`.
2. Confirm `AccountTrialBalancePage` already defaults to `postedOnly=true`; keep it.
3. Add consistent badge/copy:
   - “Documents comptables officiels: écritures validées uniquement”
   - Allow draft-inclusive preview only if user explicitly unchecks.
4. Add export buttons where missing:
   - CSV for balance
   - CSV/PDF later for reports
   - grand livre CSV

Acceptance criteria:
- Bilan/compte de résultat/balance do not silently include drafts by default.
- User can intentionally include drafts for preview.
- Documents are available from finance comptabilité documents tab.

**Phase 5: Backend Ledger Correctness**

Backend files likely involved:
- `backend/api/routes/accounting.py`
- `backend/services/accounting.py`
- `backend/schemas/accounting.py`

Current concern:
- `GrandLivreScreen` fetches entries with `limit: 500`
- opening balance is hardcoded to zero
- running balance is computed frontend-side

Tasks:
1. Add backend endpoint:
   - `GET /api/v1/accounting/reports/general-ledger`
2. Query params:
   - `fiscal_year_uuid`
   - `account_uuid` or `account_code`
   - `date_from`
   - `date_to`
   - `posted_only`
   - `limit`
   - `offset`
3. Response:
   - account metadata
   - opening_balance
   - total_debit
   - total_credit
   - closing_balance
   - paginated ledger lines
   - each line includes running_balance
4. Compute opening balance from entries before `date_from` within fiscal year, or from opening entries if modeled separately.
5. Add service tests:
   - debit-normal account balance
   - credit-normal account balance
   - date range opening balance
   - posted-only filtering
   - pagination does not change running balances

Frontend:
1. Update `GrandLivreScreen` to use the endpoint.
2. Remove client-side running balance calculation except formatting.

Acceptance criteria:
- Running balance remains correct across pages.
- Opening balance is not always zero.
- Large ledgers do not silently truncate at 500 entries.

**Phase 6: Fiscal-Year Close Readiness**

Backend files likely involved:
- `backend/api/routes/accounting.py`
- `backend/services/accounting.py`
- `backend/services/bank_reconciliation.py`
- `backend/schemas/accounting.py`

Tasks:
1. Add endpoint:
   - `GET /api/v1/accounting/fiscal-years/{uuid}/close-readiness`
2. Response checks:
   - `has_unposted_entries`
   - `unposted_entries_count`
   - `has_unreconciled_bank_lines`
   - `unreconciled_bank_lines_count`
   - `has_reconciliation_discrepancies`
   - `discrepancy_count`
   - `has_missing_required_tiers`
   - `missing_required_tiers_count`
   - `has_due_recurring_entries`
   - `due_recurring_entries_count`
   - `reports_balanced`
   - `can_close`
3. Enforce reconciliation requirement in close endpoint:
   - fiscal year cannot close if unreconciled/discrepancy lines exist
   - return actionable error with counts
4. Add tests:
   - close blocked by unreconciled line
   - close blocked by discrepancy
   - close allowed when all checks pass
   - permissions unchanged

Frontend:
1. Add `FiscalYearCloseChecklist` component.
2. Show it in cockpit and/or fiscal-year settings.
3. Link each blocker to the relevant screen.

Acceptance criteria:
- Reconciliation is mandatory before close.
- User sees exactly why close is blocked.
- Assistant can resolve blockers without knowing accounting internals.

**Phase 7: Treasurer-Focused Copy and Permissions**

Tasks:
1. Review labels in `banque` i18n namespace.
2. Prefer operational language:
   - “À valider” over “Brouillons” in cockpit
   - “À rapprocher” over raw reconciliation states
   - “Documents pour l’expert-comptable” for statutory exports
3. Ensure permissions:
   - assistants may view cockpit and prepare entries
   - only authorized users can post, reverse, close, or change accounting settings
4. Disable actions with clear explanations where permissions are missing.

Acceptance criteria:
- Non-accountants understand next actions.
- Dangerous actions are permission-gated.
- Settings are not mixed into daily work.

**Implementation Order**

Recommended order:
1. Navigation restructure with existing components.
2. Cockpit first version using existing counts.
3. Journal presets and reversal modal.
4. Reports posted-only consistency.
5. Close-readiness backend and UI.
6. General ledger backend endpoint.
7. Exports and polish.

**Testing Checklist**

Frontend:
- Build passes with `pnpm --filter frontend build`.
- Navigate to `/workspace/finance?tab=comptabilite`.
- Verify each new tab renders.
- Verify cockpit empty states.
- Verify journal presets apply expected filters.
- Verify reversal modal submits existing mutation.
- Verify reports default to posted-only.

Backend:
- Run accounting tests.
- Add tests for close-readiness.
- Add tests for general-ledger endpoint.
- Confirm fiscal-year close rejects unreconciled statements.

**Risks**

- Existing route/query-param behavior may not support nested tabs cleanly; inspect `WorkspaceShell` and `SubWorkspaceShell` before changing structure.
- Reconciliation count APIs may be missing; avoid expensive client aggregation over all lines.
- Grand livre correctness needs backend work before relying on it for official documents.
- “Cancelled” state semantics should be clarified before treating it as an anomaly.