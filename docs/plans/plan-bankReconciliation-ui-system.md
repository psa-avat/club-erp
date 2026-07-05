# Plan — Bank Reconciliation Functional UI System

## Objective

Transform bank reconciliation from a table-driven feature into an operations cockpit:

- import statements with confidence,
- clear exceptions quickly,
- prove the balance continuously,
- close the reconciliation only when the system can explain why it is safe.

The backend already supports the core lifecycle: import, matching, manual match, discrepancy resolution, correcting entries, closure, and report. This plan focuses on clarity, efficiency, and a UI system that matches the accountant's real workflow.

## Status vs Current Implementation (2026-07-04)

Several items below are already built and should be evolved, not recreated:

- **Exception resolver already exists in embryo.** The statement detail table has an expand chevron per unresolved line; the expanded row shows discrepancy actions (accept/exclude/generate correcting entry) and a candidate-entries list with computed amount, sort, and Draft badge, inline — no modal. Phase 2 should restructure/extend this into the three-zone workbench, not build resolution UI from zero.
- **Filtering is already explicit-apply**, not live/debounced (a "Filtrer" button plus draft vs. applied filter state). Any redesigned queue/inbox must keep this pattern — do not reintroduce live filtering.
- **Lines are already server-paginated** (`GET /statements/{uuid}/lines` with `limit`/`offset`, `BankStatementLineListResponse{items,total}`). This was added specifically because loading 400+ lines client-side was slow. Any new "left queue" or "inbox" view must stay paginated/filtered server-side — see the correction under Backend/API Enhancements below.

### Phase 1 — done (2026-07-04)

- `GET /statements` now returns `BankStatementSummaryResponse` (status_counts, unresolved_count, live_balance_difference) via `list_statement_summaries`, computed with two `GROUP BY` aggregates over `bank_statement_lines` — not per-statement `get_reconciliation_report` calls, per the correction below.
- Statement inbox (`ReconciliationStatementList.tsx`) shows "À traiter" (unresolved_count) and "Écart" (live_balance_difference) columns; dropped the low-value "Format" column to make room.
- Statement detail (`ReconciliationWorkspace.tsx`) now defaults its status filter to unresolved (`match_status=unmatched,discrepancy`, backend accepts a comma-separated list) instead of showing everything on open. Manually clearing filters still resets to "Tous".
- `get_reconciliation_report` / `ReconciliationReportResponse` gained `live_balance_difference`, computed by a helper (`_compute_live_balance_difference`) shared with `close_reconciliation`'s own check — the closure proof panel can now show the *same* blocker (unresolved lines vs. balance mismatch) the backend would otherwise only report after a failed close attempt. Closure button now has 4 distinct states/labels matching the table above (unresolved count / balance mismatch amount / ready / closed).
- Backend: 6 new tests (`ListStatementSummariesTests`, `GetReconciliationReportTests`, comma-separated match_status filter) — 47 reconciliation tests total, full suite still at the same 15 pre-existing unrelated failures.

### Candidate-explanation endpoint — done (2026-07-04, pulled forward from Phase 2)

Built earlier than planned, as a correctness fix rather than a Phase 2 nicety: `GET /lines/{line_uuid}/candidates` (`get_match_candidates`) reuses `_load_eligible_entries`/`_score_candidate`/`_description_similarity`/`_is_internal_transfer_candidate` verbatim — the exact same logic `run_auto_match` uses. This fixed a real bug: the candidate picker previously queried the generic accounting-entries endpoint client-side (amount+date-only ranking, no description weight, no internal-transfer cap, and — critically — no exclusion of entries already reconciled to another line), so an already-matched ledger entry could appear as a pickable candidate and only fail with a 409 on click. `_load_eligible_entries` excludes matched entries by construction (an entry can only ever be matched once), so this is now structurally impossible, not just filtered client-side. `ReconciliationWorkspace.tsx`'s `CandidateEntriesList` now renders this endpoint's ranked output directly (score, internal-transfer badge) instead of re-scoring in TypeScript; the old date-window fetch, amount-tolerance settings fetch, and client-side ranking code were deleted. 4 new backend tests (`GetMatchCandidatesTests`) — 51 reconciliation tests total.

### Follow-up fixes — done (2026-07-04)

- **Matching is now scoped by account, not journal.** `_load_eligible_entries` and `manual_match` no longer restrict candidates/matches to entries in the statement's own journal — only that they have a line on `statement.account_uuid` and match the fiscal year. A correcting entry recorded in an OD journal (or any journal) that hits the bank account is now a legitimate candidate; previously it was silently invisible. `AccountingJournal` join/import dropped from `bank_reconciliation.py` as a result. Tests: `test_accepts_entry_from_a_different_journal_when_account_and_fiscal_year_match`, renamed `test_rejects_entry_from_different_journal` → `test_rejects_entry_from_different_fiscal_year`.
- **Reconciliation status now visible on the main journal entries list** (`/workspace/finance?tab=comptabilite`, not just the reconciliation subtab). `list_accounting_entries`/`get_accounting_entry` batch-enrich each entry with `bank_match_status`/`bank_statement_status` (one extra query, same transient-attribute pattern as `_enrich_lines_tiers`), surfaced as a second badge next to the existing state badge: "Associé" (badge-info, matched but statement not yet closed), "Rapproché" (badge-success, statement closed), "Écart" (badge-warning, discrepancy). New file `test_accounting_bank_match_status.py`.
- **Reconciliation filters: only the libellé field needs the Filtrer button.** Status/date/amount filters now apply immediately on change (`setFilter` merges straight into `appliedFilters`); only free-text description filtering is debounced-via-button, since it's the only field where per-keystroke queries would actually be wasteful — a Select/date pick/completed amount is already a single discrete action.
- **Chevron stays after matching.** The expand chevron is no longer hidden once a line becomes `auto_matched`/`manually_matched` (only `excluded` hides it) — expanding a matched line now shows a read-only `MatchedEntrySummary` (date, description, Draft badge, reference, confidence) via `useAccountingEntryQuery`, instead of losing access to "which entry was this matched to" once resolved.
- **Reconciliation-state filter on the main journal entries list.** New `bank_reconciliation_state` query param (`unreconciled`/`associated`/`reconciled`/`discrepancy`) on `GET /entries` and `/entries/count`, implemented as an `EXISTS`/`NOT EXISTS` correlated subquery against `bank_statement_lines`+`bank_statements` in `_apply_accounting_entry_filters` (mirrors the badge added above). New Select in `JournalEntriesScreen.tsx`'s filter panel. 6 new SQL-shape tests in `test_accounting_bank_match_status.py` (`BankReconciliationStateFilterTests`), asserting on `str(stmt)` rather than hitting a DB.

### Not yet built

Statement-level summary and the candidate-explanation endpoint are done; import preview, three-zone workbench layout, and bulk accept remain — the rest of this plan (as amended) still applies to these.

## Core Product Principle

The default screen should answer:

1. What needs my attention?
2. Why is it blocked?
3. What is the fastest safe action?
4. Can I close this statement now?

The UI should not make the user browse all statement lines first. It should lead with unresolved work and balance proof.

## Current Frictions

| Area | Problem | Impact |
|---|---|---|
| Statement list | Shows imported statements but not remaining work | User cannot prioritize |
| Import | File upload is a form, not a validation flow | Duplicate/balance/parser issues are discovered too late |
| Detail workspace | Starts with filters and table browsing | User must manually discover exceptions |
| Matching | Global "run matching" action lacks preview/explanation | Low confidence in automated results |
| Manual resolution | Expanded table rows are workable but slow | Repeated exception clearing is inefficient |
| Report | Closure proof is a side card | The most important decision aid is visually secondary |
| Discrepancies | Accept/exclude/correct actions are cramped | Accounting decisions feel under-explained |

## Target UI Architecture

### 1. Reconciliation Inbox

Replace the passive statement list with an operational inbox.

Primary content:

- active fiscal year selector context,
- statement cards or dense table rows,
- progress and blocking indicators per statement.

Recommended columns:

| Column | Purpose |
|---|---|
| Period / statement date | Identify statement |
| Journal + account | Confirm scope |
| Opening / closing balance | Accounting anchor |
| Lines | Volume |
| Matched | Progress |
| To review | Main workload |
| Missing entries | Main risk |
| Balance difference | Closure blocker |
| Status | Imported / matching / flagged / reconciled |

Primary actions:

- Import statement
- Continue
- Review exceptions
- Close, only when ready

Data requirement:

- Extend statement list response or add a summary endpoint with status counts and balance difference per statement.
- **Correction:** do not call `get_reconciliation_report` per statement to build this list — it eager-loads every line of a statement plus a second matched-entries query, so computing it once per row is an N+1 that reintroduces the exact slowness the line-pagination work fixed for a single statement, multiplied across every statement in the inbox. Instead:
  - `status_counts` per statement: a single `SELECT statement_uuid, match_status, count(*) FROM bank_statement_lines WHERE statement_uuid = ANY(:uuids) GROUP BY statement_uuid, match_status`.
  - `balance_difference` for statements not yet reconciled: a single aggregate `SUM(amount) FILTER (WHERE match_status IN (...locked/excluded...))` per statement, added to `opening_balance` and compared to `closing_balance` — not a Python loop over ORM-loaded lines. For already-reconciled statements, the stored `balance_difference` column is authoritative and needs no computation.

### 2. Import Wizard

Replace the single import dialog with a staged wizard.

Step 1 — Source:

- fiscal year,
- bank/cash journal,
- reconcilable account,
- file.

Step 2 — Preview:

- detected format,
- parsed period,
- opening balance,
- closing balance,
- total debit,
- total credit,
- line count,
- first 10 parsed lines,
- duplicate/hash warning.

Step 3 — Confirm:

- create statement,
- optionally run auto-match immediately after import.

CSV behavior:

- If CSV mapping is missing, show mapping fields inline in the wizard.
- Existing saved mappings should be selectable without leaving the flow.
- Clarify persistence timing: a mapping created inline during the wizard should be saved as a reusable `BankCsvMapping` immediately (on leaving step 1 / before preview), not deferred to final import confirmation — otherwise the preview step can't use it, and re-running preview after a tweak would create duplicate unsaved mappings.

Backend requirement:

- Add preview endpoint:
  - `POST /api/v1/reconciliation/import/preview`
  - returns parsed metadata and sample lines without persisting.
- Existing import endpoint remains the final commit action.
- Confirmed feasible with low risk: `import_statement` (`backend/services/bank_parsers.py`) already separates cleanly — validation, format detection, parsing, duplicate-hash check, and balance-mismatch warning all happen before the first `db.add`/`commit`. Extract that portion into a shared `_validate_and_parse(...)` helper used by both `import_statement` and the new preview function, so the two paths can't silently drift apart.

### 3. Statement Workbench

Replace the current table-first detail view with a three-zone workbench.

Top command bar:

- Back
- Statement identity
- Status badge
- Progress counters
- Run matching
- Matching settings
- Close / Export

Progress counters:

- Matched
- Auto matched
- Manual
- To review
- Missing
- Excluded
- Balance difference

Main layout:

| Zone | Role |
|---|---|
| Left queue | Worklist grouped by status |
| Center resolver | Selected line, candidate entries, decision controls |
| Right proof panel | Balance proof, unresolved blockers, closure action |

Default queue:

- show unresolved first: `discrepancy`, then `unmatched`.
- matched lines remain accessible through tabs or filters, but should not be the default job.

Suggested queue tabs:

- À traiter
- À vérifier
- Rapprochées
- Exclues
- Toutes

### 4. Exception Resolver

The resolver should make one accounting decision at a time.

Selected bank line panel:

- date,
- amount,
- description,
- reference,
- counterparty,
- raw bank reference if available.

Suggested match panel:

- best candidate,
- confidence band,
- amount difference,
- date difference,
- label/reference similarity,
- draft/posted state.

Actions:

- Accept suggestion
- Choose another entry
- Create correcting entry
- Exclude
- Dissociate if already matched

Audit requirements:

- Require notes for exclude.
- Encourage notes for correcting entry.
- Show generated correcting entry reference after creation.

Candidate list:

- rank exact amount first,
- then date proximity,
- then description similarity,
- show draft/posted badge,
- show bank-account line amount,
- show entry description/reference.

Efficiency controls:

- Next unresolved
- Previous unresolved
- Accept and next
- Keyboard shortcuts can come later, but layout should support them.

### 5. Closure Proof Panel

Make the report panel the always-visible control center.

Show:

- opening balance,
- sum of reconciled/excluded movements,
- expected closing balance,
- statement closing balance,
- balance difference,
- unresolved line count,
- draft matched entries that will be posted on close,
- correcting entries created from reconciliation.

Closure button states:

| State | Button |
|---|---|
| Unresolved lines | Disabled: "3 lignes à résoudre" |
| Balance mismatch | Disabled: "Écart de solde 12,40 €" |
| Ready | Enabled: "Clôturer le rapprochement" |
| Closed | Locked: "Clôturé" |

## Backend/API Enhancements

### Required

1. Statement summaries
   - Add status counts to list endpoint or create:
     - `GET /api/v1/reconciliation/statements/summary`
   - Include unresolved count and balance difference.

2. Import preview
   - Add non-persisting parser endpoint.
   - Return metadata, duplicate warning, sample lines.

3. Candidate explanation
   - Add optional candidate scoring endpoint:
     - `GET /api/v1/reconciliation/lines/{line_uuid}/candidates`
   - Return amount diff, date diff, description score, final score.
   - **Must reuse the auto-match scoring path verbatim**: same `_load_eligible_entries` (respecting `include_drafts`), same `_score_candidate`/`_description_similarity`, same `_is_internal_transfer_candidate` cap. This is not a "nice to have" cosmetic addition — today the frontend candidate list reimplements a simplified amount+date-only ranking in TypeScript that ignores description similarity and the internal-transfer cap entirely, so the manual-match picker and `run_auto_match` can rank/flag the same entry differently. A shared endpoint removes that duplicated, drifting logic. Recommend pulling this into **Phase 2** (see below) rather than deferring it to Phase 4 — it's a correctness fix, not just a confidence-band nicety.

### Nice To Have

1. Bulk accept high-confidence matches.
2. Rerun matching on unresolved lines only.
3. PDF report export.
4. Keyboard navigation state in API is not needed; client only.

## Frontend Implementation Phases

### Phase 1 — Better Work Visibility

Scope:

- Add statement summary counts.
- Redesign statement list into an inbox.
- Default statement detail filters to unresolved work.
- Promote report/closure proof.

Files likely touched:

- `backend/services/bank_reconciliation.py`
- `backend/api/routes/reconciliation.py`
- `backend/schemas/reconciliation.py`
- `frontend/src/modules/banque/api/index.ts`
- `frontend/src/modules/banque/components/ReconciliationStatementList.tsx`
- `frontend/src/modules/banque/components/ReconciliationWorkspace.tsx`
- `frontend/src/modules/banque/components/ReconciliationReport.tsx`
- `packages/i18n/src/resources/fr.ts`
- `packages/i18n/src/resources/en.ts`

Acceptance criteria:

- User can see unresolved counts before opening a statement.
- Opening a statement lands on actionable lines first.
- Closure blockers are visible without scrolling or table inspection.

### Phase 2 — Workbench Resolver

Scope:

- Introduce queue/resolver/proof layout, evolving the existing expandable-row resolver (candidate list + discrepancy actions already inline) rather than rebuilding it.
- Add the candidate-explanation endpoint (`GET /lines/{line_uuid}/candidates`, reusing auto-match scoring — see Backend/API Enhancements) and switch the frontend candidate list to it, retiring the client-side amount/date-only ranking.
- Add "accept and next" workflow.
- Improve candidate card clarity (confidence band, internal-transfer warning badge when capped).
- Keep the existing paginated/explicit-apply-filter data fetching for the queue — do not fetch all lines client-side.

Files likely touched:

- `ReconciliationWorkspace.tsx`
- new `ReconciliationLineQueue.tsx`
- new `ReconciliationLineResolver.tsx`
- new `ReconciliationProofPanel.tsx`

Acceptance criteria:

- User can clear multiple exceptions without returning to a full table each time.
- Candidate choice shows enough information to decide safely.
- The next unresolved line is one click away after every resolution.

### Phase 3 — Import Wizard

Scope:

- Add import preview backend.
- Replace import dialog with wizard.
- Inline CSV mapping creation/selection.
- Optional "run matching after import" toggle.

Files likely touched:

- `backend/services/bank_parsers.py`
- `backend/api/routes/reconciliation.py`
- `backend/schemas/reconciliation.py`
- `ReconciliationImportPanel.tsx`
- `CsvMappingWizard.tsx`

Acceptance criteria:

- User sees parsed balances and sample lines before persisting.
- CSV users can complete mapping without leaving import.
- Duplicate statement warning is shown before commit.

### Phase 4 — Confidence and Bulk Efficiency

Scope:

- Confidence bands in UI (candidate explanation endpoint itself moved to Phase 2 — see above).
- Bulk accept high-confidence suggestions.
- Rerun matching unresolved only.

Acceptance criteria:

- User understands why a match was suggested.
- High-confidence routine work can be cleared safely in bulk.
- Low-confidence decisions remain explicit.

## UI Design Rules

- Use dense, work-focused layouts; avoid marketing-style cards.
- Put actions close to the accounting object they affect.
- Keep closure proof visible during resolution.
- Prefer badges, counters, and compact tables over explanatory paragraphs.
- Use icons for commands where obvious: import, refresh, settings, lock, download.
- Never hide blockers behind generic disabled states.
- Make the default view the most likely next action.

## Suggested First Build Slice

Implement Phase 1 first.

It provides the biggest clarity gain with limited backend changes:

1. Add per-statement status counts and unresolved count.
2. Show those counts in the statement inbox.
3. Make the detail page default to unresolved lines.
4. Upgrade the report panel into a closure proof panel with explicit blocker messages.

This creates a functional bridge from the current v1 implementation to the fuller workbench without rewriting the whole module at once.

