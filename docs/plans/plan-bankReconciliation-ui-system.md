# Plan — Bank Reconciliation Functional UI System

## Objective

Transform bank reconciliation from a table-driven feature into an operations cockpit:

- import statements with confidence,
- clear exceptions quickly,
- prove the balance continuously,
- close the reconciliation only when the system can explain why it is safe.

The backend already supports the core lifecycle: import, matching, manual match, discrepancy resolution, correcting entries, closure, and report. This plan focuses on clarity, efficiency, and a UI system that matches the accountant's real workflow.

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
- Reuse `get_reconciliation_report` logic server-side to avoid client-side aggregation.

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

Backend requirement:

- Add preview endpoint:
  - `POST /api/v1/reconciliation/import/preview`
  - returns parsed metadata and sample lines without persisting.
- Existing import endpoint remains the final commit action.

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

- Introduce queue/resolver/proof layout.
- Move expanded-row logic into a dedicated resolver panel.
- Add "accept and next" workflow.
- Improve candidate card clarity.

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

- Candidate explanation endpoint.
- Confidence bands in UI.
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

