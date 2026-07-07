Below is a detailed implementation plan a coding agent can execute incrementally.

**Goal**

Improve `/workspace/finance?tab=comptabilite` as a treasurer/assistant-friendly finance cockpit while giving accountant-level users (users with `POST_ACCOUNTING_ENTRIES` / `MANAGE_ACCOUNTING_SETTINGS`) full access to advanced accounting features in the same workspace.

**Principles**

- Keep advanced accounting features, but expose them through task-first workflows.
- Split by audience using the *existing* capability model (`VIEW_FINANCIALS`, `POST_ACCOUNTING_ENTRIES`, `MANAGE_ACCOUNTING_SETTINGS`) rather than inventing new roles — wire this into navigation from Phase 1, not as a late copy/permissions pass.
- Default statutory views to posted entries only.
- Make reconciliation mandatory before fiscal-year close.
- Prefer backend-calculated accounting facts over frontend reconstruction.
- Build one source of truth for "accounting health" counts (drafts, unreconciled lines, discrepancies, missing tiers, due recurring entries) and have both the cockpit and the close-readiness check consume it — do not implement counting logic twice.
- Keep changes incremental and shippable.

**Known findings from codebase audit (2026-07-07)**

- `AccountingWorkspacePage.tsx` is **dead code**: not exported from `modules/banque/index.ts`, not routed in `App.tsx`, referenced nowhere. It is not "the current expert page" — today there is only `ComptabiliteSection` inside `FinanceWorkspacePage`. Its acceptance criterion in earlier drafts ("existing AccountingWorkspacePage still works unchanged") was untestable because the page is unreachable.
- Current `ComptabiliteSection` already has 9 flat tabs: `journal`, `encaissements-cb`, `encaissement-cheque`, `remise-cheque`, `modeles`, `recurrentes`, `comptes`, `balance`, `rapprochement`.
- Capabilities are already enforced consistently at the action level: `POST_ACCOUNTING_ENTRIES` gates validate/reverse/close/resolve actions across ~11 components; `MANAGE_ACCOUNTING_SETTINGS` gates templates management on the frontend only — **not enforced on the backend outside a test file**. Fix this while touching settings routes.
- Nav-level gating today is coarse: the whole `/workspace/finance` entry requires only `VIEW_FINANCIALS`. No per-tab capability gating exists yet.
- `useAccountingEntriesCountQuery`, `useFiscalYearsQuery`, and the `null_tiers` filter genuinely exist and are safe to reuse. A **global** (cross-statement) discrepancy/unresolved count does **not** exist — only per-statement `unresolved_count`. A read-only "due recurring entries" count without side effects does not exist either (`useGenerateDueEntriesMutation` both counts and generates).
- `JournalEntriesScreen` already supports `defaultState` and `lockState` props, and a rich filter set including `null_tiers`. Reversal uses `window.prompt` (`JournalEntriesScreen.tsx:395`) — confirmed real defect.
- `GrandLivreScreen` confirmed: fetches with a fixed `limit: 500` (no pagination), opening balance is hardcoded to `Decimal(0)`, running balance is computed client-side from period movements only. **Any account with pre-period activity or more than 500 movements already renders a wrong ledger today.** Treat as a correctness bug, not just a UX gap.
- `AccountTrialBalancePage` already defaults `postedOnly=true` — no change needed there. Only `FinancialReportsPage` defaults `postedOnly=false` and needs fixing.

**Phase 0: Resolve dead code before restructuring**

Tasks:
1. Decide the fate of `AccountingWorkspacePage.tsx`: delete it, after confirming its unique tabs (`exercices`, `pcg`, `rapports`) are either already available elsewhere or are folded into the restructured `ComptabiliteSection` in Phase 1.
2. Do not write acceptance criteria elsewhere in this plan that assume `AccountingWorkspacePage` is reachable.

Acceptance criteria:
- No orphaned/unreferenced accounting page remains in the module.
- Any functionality unique to it (fiscal years page, PCG page, reports page) is accounted for in the new tab structure.

**Phase 1: Navigation Restructure + Capability-Driven Visibility**

Files likely involved:
- `frontend/src/modules/banque/components/FinanceWorkspacePage.tsx`
- `frontend/src/modules/banque/components/FinancialReportsPage.tsx`
- `frontend/src/modules/banque/components/GrandLivreScreen.tsx`

Tasks:
1. Replace the current flat `ComptabiliteSection` tabs with grouped tabs:
   - `a-faire`
   - `saisie`
   - `rapprochement`
   - `documents`
   - `parametres`

2. Under `a-faire`, add a new placeholder/component:
   - `FinanceAccountingCockpitPage.tsx` (built out in Phase 3)

3. Under `saisie`, include (visible to any user with `VIEW_FINANCIALS`; these are preparation/data-entry screens, not risky actions):
   - `JournalEntriesScreen defaultState={0}`
   - `CreditCardSettlementPage`
   - `ChequeReceiptPage`
   - `ChequeRemittancePage`
   - `AccountingImportDialog` entry point if suitable

4. Under `rapprochement`, include:
   - `ReconciliationWorkspace` — visible to all `VIEW_FINANCIALS` users in view/propose-match mode; resolve/close actions inside it stay gated on `POST_ACCOUNTING_ENTRIES` as they are today.

5. Under `documents`, include (read-only, low-risk — keep visible to both audiences, do not gate behind an "expert" capability):
   - `AccountTrialBalancePage`
   - `GrandLivreScreen`
   - `FinancialReportsPage`

6. Under `parametres`, include, and **hide this entire tab** for users without `MANAGE_ACCOUNTING_SETTINGS`:
   - `BanqueCoaPage`
   - `JournalTemplatesScreen recurrenceFilter={[1]}`
   - `JournalTemplatesScreen recurrenceFilter={[2, 3, 4]}`
   - fiscal years page (folded in from the deleted `AccountingWorkspacePage` if applicable)

7. Add backend enforcement of `MANAGE_ACCOUNTING_SETTINGS` on the settings routes it's meant to protect (currently only checked in a test, not in `api/routes/`).

Acceptance criteria:
- `/workspace/finance?tab=comptabilite` no longer shows one long row of unrelated accounting tabs.
- Users without `POST_ACCOUNTING_ENTRIES`/`MANAGE_ACCOUNTING_SETTINGS` do not see tabs full of actions they cannot perform — `parametres` is hidden entirely for them; `rapprochement`/`saisie` remain visible but resolve/post actions inside stay disabled as today.
- `MANAGE_ACCOUNTING_SETTINGS` is enforced server-side, not just in the UI.

**Phase 2: Accounting Health Aggregate Endpoint**

Backend files likely involved:
- `backend/api/routes/accounting.py`
- `backend/services/accounting.py`
- `backend/services/bank_reconciliation.py`
- `backend/schemas/accounting.py`

This phase exists because both the cockpit (Phase 3) and the close-readiness check (Phase 7) need the same counts — build the counting logic once.

Tasks:
1. Add endpoint (name TBD, e.g. `GET /api/v1/accounting/fiscal-years/{uuid}/health`):
   - `draft_entries_count` (`state=1`)
   - `cancelled_or_anomalous_entries_count` (clarify "cancelled" state semantics before treating as an anomaly — see Risks)
   - `unreconciled_bank_lines_count` (aggregate `unresolved_count` across statements for the fiscal year, or a genuinely aggregated query)
   - `reconciliation_discrepancies_count`
   - `missing_required_tiers_count` (reuse `null_tiers` filter logic)
   - `due_recurring_entries_count` — a read-only count, distinct from the existing `useGenerateDueEntriesMutation`, with no side effects
   - `active_fiscal_year` status (open/closed, or none active)
2. Add service tests for each count in isolation and for the endpoint as a whole.

Acceptance criteria:
- A single endpoint returns every count both the cockpit and the close-readiness checklist need.
- No count requires a mutating call to compute.

**Phase 3: Finance Accounting Cockpit**

Create:
- `frontend/src/modules/banque/components/FinanceAccountingCockpitPage.tsx`

Use:
- The Phase 2 health endpoint as the sole data source for counts.
- Active fiscal year store for context.

Cockpit cards (backed by Phase 2 endpoint):
1. Draft entries to validate — action differs by viewer capability: users without `POST_ACCOUNTING_ENTRIES` see "prepared, en attente de validation" (no action, or link to view only); users with it see a direct "valider" deep link into the filtered journal.
2. Cancelled/anomalous entries — only surfaced once semantics are clarified (see Risks).
3. Bank lines to reconcile — deep link to `rapprochement`.
4. Reconciliation discrepancies — deep link to `rapprochement`, resolve action gated as elsewhere.
5. Entries without required tiers — deep link to journal with `null_tiers=true`.
6. Recurring entries due — deep link to `JournalTemplatesScreen`; generation action gated on `POST_ACCOUNTING_ENTRIES`.
7. Fiscal year status — current active fiscal year, open/closed, warning if none active.

UX requirements:
- Dense operational layout, no marketing hero.
- Cards should be compact status tiles, not decorative cards.
- Each tile must answer: count, why it matters, primary action — and the action must reflect what *this* viewer can actually do, not a generic action that turns out to be disabled.
- Use icons from `lucide-react`.
- Empty/good states should feel reassuring: "Aucune écriture à valider".

Acceptance criteria:
- Treasurer/accountant can understand the accounting workload in under 10 seconds.
- Every non-zero item has an action appropriate to the viewer's capabilities — no disabled placeholder tiles, since Phase 2 guarantees the counts exist.

**Phase 4: General Ledger Correctness**

Prioritized ahead of journal/report polish because this is a live correctness bug affecting a document accountants may already be relying on, not a UX nice-to-have.

Backend files likely involved:
- `backend/api/routes/accounting.py`
- `backend/services/accounting.py`
- `backend/schemas/accounting.py`

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
3. Until this ships, add a visible disclaimer on `GrandLivreScreen` that the opening balance is not yet computed and only period movements are shown.

Acceptance criteria:
- Running balance remains correct across pages.
- Opening balance is not always zero.
- Large ledgers do not silently truncate at 500 entries.

**Phase 5: Journal Presets and UX Cleanup**

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
   - collapsible "Filtres avancés"

4. Preserve current advanced filter capabilities.

5. Replace `window.prompt` reversal (`JournalEntriesScreen.tsx:395`) with a modal:
   - check whether a `ReversalDialog` component already exists elsewhere in the codebase before building a new one; reuse if it does
   - show entry summary
   - require reversal reason
   - submit to existing reverse mutation

Acceptance criteria:
- Existing filters still work.
- Common workflows take fewer clicks.
- Reversal no longer uses browser prompt.
- Bulk post/delete behavior unchanged except improved confirmation copy if touched.

**Phase 6: Documents and Reports**

Files:
- `frontend/src/modules/banque/components/FinancialReportsPage.tsx`
- `frontend/src/modules/banque/components/AccountTrialBalancePage.tsx` (no change needed — already `postedOnly=true` by default)
- `frontend/src/modules/banque/components/GrandLivreScreen.tsx`

Tasks:
1. Set `FinancialReportsPage` default `postedOnly` to `true` (currently `false`).
2. Set/confirm `GrandLivreScreen` defaults to `postedOnly=true` as well.
3. Add consistent badge/copy:
   - "Documents comptables officiels: écritures validées uniquement"
   - Allow draft-inclusive preview only if user explicitly unchecks.
4. Add export buttons where missing:
   - CSV for balance
   - CSV/PDF later for reports
   - grand livre CSV

Acceptance criteria:
- Bilan/compte de résultat/balance do not silently include drafts by default.
- User can intentionally include drafts for preview.
- Documents are available from finance comptabilité documents tab, visible to both audiences.

**Phase 7: Fiscal-Year Close Readiness**

Backend files likely involved:
- `backend/api/routes/accounting.py`
- `backend/services/accounting.py`
- `backend/services/bank_reconciliation.py`
- `backend/schemas/accounting.py`

Tasks:
1. Add endpoint:
   - `GET /api/v1/accounting/fiscal-years/{uuid}/close-readiness`
2. Response, derived from the Phase 2 health endpoint's counts plus close-specific checks:
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
   - permissions unchanged (`POST_ACCOUNTING_ENTRIES` and/or `MANAGE_ACCOUNTING_SETTINGS`, whichever already gates fiscal year close)

Frontend:
1. Add `FiscalYearCloseChecklist` component.
2. Show it in cockpit and/or fiscal-year settings (`parametres` tab).
3. Link each blocker to the relevant screen.

Acceptance criteria:
- Reconciliation is mandatory before close.
- User sees exactly why close is blocked.
- Assistant-level users can resolve non-posting blockers (e.g. missing tiers) without needing `POST_ACCOUNTING_ENTRIES`; posting/closing itself stays gated.

**Phase 8: Treasurer-Focused Copy**

By this phase, permission-driven visibility is already in place from Phase 1 — this phase is pure copy/labels, not structural.

Tasks:
1. Review labels in `banque` i18n namespace.
2. Prefer operational language:
   - "À valider" over "Brouillons" in cockpit
   - "À rapprocher" over raw reconciliation states
   - "Documents pour l'expert-comptable" for statutory exports
3. Vary cockpit tile copy by viewer capability where the same count means a different action for different viewers (see Phase 3).

Acceptance criteria:
- Non-accountants understand next actions.
- Dangerous actions remain permission-gated (already true from Phase 1, verify no regression).
- Settings are not mixed into daily work (already true from Phase 1, verify no regression).

**Implementation Order**

1. Resolve dead `AccountingWorkspacePage` code.
2. Navigation restructure with capability-driven tab visibility, using existing components.
3. Accounting health aggregate endpoint (backend, once).
4. Cockpit, built on top of the health endpoint.
5. General ledger backend endpoint and correctness fix.
6. Journal presets and reversal modal.
7. Reports posted-only consistency.
8. Close-readiness backend and UI, reusing the health endpoint.
9. Copy pass, exports, polish.

**Testing Checklist**

Frontend:
- Build passes with `pnpm --filter frontend build`.
- Navigate to `/workspace/finance?tab=comptabilite`.
- Verify each new tab renders, and that `parametres` is hidden for a user without `MANAGE_ACCOUNTING_SETTINGS`.
- Verify cockpit empty states and capability-dependent tile copy/actions.
- Verify journal presets apply expected filters.
- Verify reversal modal submits existing mutation.
- Verify reports default to posted-only.

Backend:
- Run accounting tests.
- Add tests for the health aggregate endpoint.
- Add tests for close-readiness.
- Add tests for general-ledger endpoint.
- Confirm fiscal-year close rejects unreconciled statements.
- Confirm `MANAGE_ACCOUNTING_SETTINGS` is enforced server-side on settings routes.

**Risks**

- Existing route/query-param behavior may not support nested tabs cleanly; inspect `WorkspaceShell` and `SubWorkspaceShell` before changing structure.
- "Cancelled" state semantics should be clarified before treating it as an anomaly in the health endpoint/cockpit.
- Grand livre correctness needs backend work before relying on it for official documents — treat as higher priority than nav polish, since it may already be silently wrong for accounts with pre-period activity or >500 movements.
- Hiding `parametres` and gating `MANAGE_ACCOUNTING_SETTINGS` server-side is a behavior change for any user currently relying on frontend-only enforcement; audit who has the capability today before flipping backend enforcement on.
