## Plan: Members Module Refactoring — Unified Member Workspace & Portal Redesign

### TL;DR

Unify the club member pages and the member portal into a single set of shared page components with context-aware rendering (club staff sees all members with full CRUD; portal member sees only their own data with restricted actions). Redesign the pilot sheet into a tabbed "member workspace" (Logbook, Balance & Deposits, Expenses, Volunteer Fiscal Declarations, Documents). Eliminate pack data redundancy by dropping pack fields from `MemberSheet` — Daily Ops becomes the single source of truth for packs. Automate key distribution by email with self-service key change. Enhance the pilot list with live balance and last-flight-date columns.

---

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Component sharing model** | Create shared pages in `members` module → export via barrel → import by `member-portal` | Respects module boundaries (export from public API); avoids two versions |
| **Context control** | `{ mode: 'club' \| 'portal', memberUuid?: string }` prop on shared components | Single prop toggle switches between club admin actions and member self-service |
| **Page layout** | Tabbed workspace (single route) rather than separate pages | Cleaner navigation, consistent header, reduces route duplication |
| **Pack fields on MemberSheet** | **DROP columns** `packs_bought_count`, `hours_done_in_pack`, `remaining_hours_in_pack` | User confirmed: full removal. Single source of truth in packs module |
| **Member list balance** | Computed via a new `vw_member_financial_summary` view | Avoids N+1 queries on accounting_lines per member |
| **Member auth for portal** | Default password = `{ffvp_id}_{YYYYMMDD}` (birth date), member changes after first login | No admin setup needed; member already knows their credentials; password change in portal |
| **Deposit recording** | Full accounting integration (not stub) — **auto-posted** (state=2) | Real money needs immediate reflection; reversal handles errors |
| **Document management** | S3-based file storage using **existing** `/storage/settings` config, new `member_documents` table | Infrastructure already exists (bucket defined), just unused |
| **Email sending** | New `backend/services/email.py` service based on `conf_emails.json` SMTP config | Sync send with error handling for v1; queue later if needed |
| **Expense → Reimbursement** | Auto-create accounting entry on approval | Debit class 6 expense account, credit member receivable account |
| **Volunteer fiscal declarations** | One **annual** declaration per member; configurable accounts per FY; S3 proof upload | Neutral accounting operation; fiscal receipt generated yearly for tax reduction |
| **Volunteer accounting** | `volunteer_fiscal_settings` table (per FY) with receipt account + offset account | Configurable, not hardcoded |
| **Priority order** | Logbook first after workspace shell (Phase 2 before 3-5) | User confirmed: Logbook is the priority |

---

### Included vs Excluded

| Included | Excluded (future) |
|---|---|
| Shared member workspace pages (Logbook, Balance & Deposits, Club Expenses, Volunteer Fiscal Declarations, Documents) | Invoice PDF generation |
| Tab-based layout for both club and portal contexts | HelloAsso payment integration for deposits |
| **DROP** pack fields from `member_sheets` (migration — user confirmed full removal) | Recurring subscription billing |
| Key distribution by email + self-service token change | Multi-factor auth for portal |
| Pilot list with live balance + last flight date columns | Push/email notifications for new documents |
| Document upload/download/delete per member (using existing S3 storage config) | Digital signature for documents |
| Deposit accounting entry (real double-entry, auto-posted) | Bank reconciliation feed |
| Volunteer fiscal declarations (annual per member, proof upload via S3, configurable accounts per FY) | **Year-end fiscal receipt PDF generation** (Phase 10 — requires legal template + Cerfa format) |
| Email sending service (sync SMTP with error handling) | Member-to-member document sharing |
| Club expense approval → auto-reimbursement accounting entry | |
| Volunteer fiscal settings table (per FY: receipt account + offset account) | |

---

### Phases & Steps

#### Phase 1 — Foundation: Shared Member Workspace Architecture

**Steps**:
1. **Define the "workspace context" contract** in `frontend/src/modules/members/types/workspace.ts`:
   ```typescript
   type WorkspaceMode = 'club' | 'portal';
   interface WorkspaceContext {
     mode: WorkspaceMode;
     memberUuid: string;       // always set — from URL (club) or token (portal)
     readOnly: boolean;        // portal = true for most things
   }
   ```
2. **Create the shared workspace shell** `MemberWorkspaceShell.tsx` in members/components:
   - Tab navigation: 📖 Logbook | 💰 Balance & Deposits | 🧾 Club Expenses | 📋 Volunteer Fiscal | 📄 Documents
   - Accepts `WorkspaceContext` prop
   - Renders the correct tab content
   - In club mode: member selector dropdown + member info header (name, account_id, category, photo, status) + back-to-list button + [📧 Send portal access] button
   - In portal mode: fixed to own member, simplified header, no selector + [🔑 Change token]
3. **Export all new components** from `members/index.ts` barrel file
4. **Add new member workspace route in club context**: `/club/members/:memberUuid/workspace` → renders `MemberWorkspaceShell` with `mode: 'club'`; dependent on Phase 2-4 tab content
5. **Replace member portal routes** — change standalone pages to single route: `/member-portal/workspace` → renders `MemberWorkspaceShell` with `mode: 'portal'`; dependent on Phase 2-4 tab content
6. **Keep existing portal login page** — auth flow unchanged; only post-login routing changes

**Files**:
- `frontend/src/modules/members/types/` — add `workspace.ts`
- `frontend/src/modules/members/components/MemberWorkspaceShell.tsx` — **new**
- `frontend/src/modules/members/index.ts` — add exports
- `frontend/src/App.tsx` — add/replace routes
- `frontend/src/modules/member-portal/index.ts` — update exports
- `backend/api/routes/member_portal.py` — keep login endpoint, adjust if needed

**Verification**:
- Club route `/club/members/{uuid}/workspace` loads with member selector + tabs (empty for now)
- Portal route `/member-portal/workspace` loads after login with own member data
- Tab switching works in both contexts

---

#### Phase 2 — Tab: Logbook (Carnet de Vol)

**Steps**:
1. **Backend — Logbook endpoint** `GET /api/v1/members/{member_uuid}/logbook`:
   - Returns paginated list of validated_flights for this member
   - Fields: flight_date, machine (code + type), flight_type_label, launch_method, duration (takeoff→landing), role (pilot/instructor/passenger), billing_quote_state, has_discount, gross_amount, net_amount
   - Query params: `year`, `date_from`, `date_to`, `limit`, `offset`
   - Joins: validated_flights → asset_flight_types → flight_types, assets
   - Order: flight_date DESC
   - In portal mode: member_uuid comes from JWT (enforced by dependency)
   - In club mode: member_uuid comes from path parameter
2. **Backend — Schema** `backend/schemas/members.py`: `LogbookItemResponse`, `LogbookListResponse`
3. **Frontend — Logbook tab component** `MemberLogbookTab.tsx`:
   - Shared component (uses `WorkspaceContext`)
   - Filter bar: year selector, date range, flight type, launch method
   - Table: date, machine, type, launch, duration, role, billing status badge, gross/net amounts
   - Row expand: full billing detail (lines, discounts, pack consumptions)
   - Club mode: "View in Daily Ops" link opens `/banque/operations?member={uuid}`
   - Portal mode: read-only, shows gross + discount amounts
   - Empty state: "Aucun vol enregistré"
4. **Frontend — API hooks** in `members/api/index.ts`: `useMemberLogbookQuery(memberUuid, filters)`
   - Portal uses same hook with own uuid
   - Or: create `useMemberPortalLogbookQuery(filters)` that calls same endpoint with member from context

**Files**:
- `backend/api/routes/members.py` — add GET /{uuid}/logbook endpoint
- `backend/services/members.py` — add `list_member_flights()` service function
- `backend/schemas/members.py` — add LogbookItemResponse, LogbookListResponse
- `frontend/src/modules/members/components/MemberLogbookTab.tsx` — **new**
- `frontend/src/modules/members/api/index.ts` — add logbook hooks
- `frontend/src/modules/member-portal/api/index.ts` — add portal logbook hook (wraps shared hook)

**Verification**:
- Logbook shows flights for the member, ordered by date DESC
- Filters work (year, date range, type)
- Billing status is correctly displayed (pending/applied/posted)
- Club mode shows all members, portal mode only own member
- Row expand shows billing detail

---

#### Phase 3 — Tab: Balance & Deposits

**Steps**:
1. **Backend — Balance endpoint** `GET /api/v1/members/{member_uuid}/account-summary`:
   - Returns: `{ current_balance, pending_total, posted_total, currency }`
   - Computed from accounting_lines where member_uuid = member
   - FY filter optional

2. **Backend — Account entries** `GET /api/v1/members/{member_uuid}/account-entries`:
   - Paginated list of accounting entries for this member
   - Fields: date, journal_code, description, reference, state (draft/posted), debit, credit
   - Joins: accounting_lines → accounting_entries → accounting_journals
   - Filterable by fiscal_year, state (draft|posted|all), date range

3. **Backend — Deposit endpoint** (replace stub) `POST /api/v1/members/{member_uuid}/deposit`:
   - **New model**: Deposit accounting entry with:
     - Debit line: bank/cash account (configurable in settings)
     - Credit line: member receivable/liability account (e.g., 411 or 467)
     - Journal: configurable (e.g., "CAISSE" or "BANQUE" journal)
   - Accepts: `{ amount, payment_method, reference?, deposit_date? }`
   - Creates Draft AccountingEntry (requires manual posting) OR auto-posts
   - Returns: `{ deposit_uuid, entry_uuid, amount, status, message }`
   - **Deposit settings table**: one row per fiscal year defining the default bank account, deposit journal, and receivable account for member deposits

4. **Backend — Deposit settings** alongside flight_billing_settings:
   - Add `deposit_journal_uuid`, `deposit_bank_account_uuid`, `deposit_receivable_account_uuid` to `flight_billing_settings` (or a new `member_finance_settings` table)
   - Better approach: extend `flight_billing_settings` to a broader `finance_settings` table since both relate to member accounting
   - Actually, simplest: just add 3 columns to `flight_billing_settings` and rename concept

5. **Frontend — Balance & Deposits tab** `MemberBalanceTab.tsx`:
   - **Balance cards**: current balance (color-coded), pending total, posted total
   - **Recent entries table**: date, journal, description, debit, credit, state badge
     - Club mode: "Delete draft entry" button + "Add entry" button
     - Portal mode: read-only table
   - **Deposit section** (conditional):
     - Club mode: deposit form + "record for member" submit
     - Portal mode: deposit form (member submits, creates draft)
     - Form: amount input (decimal), payment_method dropdown, reference text, optional receipt upload
   - **Fiscal year selector** (reuses store or existing component)

6. **Frontend — API hooks**:
   - `useMemberAccountSummaryQuery(memberUuid, fiscalYearUuid)`
   - `useMemberAccountEntriesQuery(memberUuid, filters)`
   - `useMemberDepositMutation()` — shared between club and portal
   - Portal-specific hooks that call same endpoints with own UUID

**Files**:
- `backend/api/routes/members.py` — add balance, entries, deposit endpoints
- `backend/services/members.py` — add account aggregation, deposit creation
- `backend/api/routes/accounting.py` — maybe add deposit settings endpoints
- `backend/schemas/members.py` — add account schemas, deposit schemas
- `backend/models.py` — extend flight_billing_settings with deposit columns
- `frontend/src/modules/members/components/MemberBalanceTab.tsx` — **new**
- `frontend/src/modules/members/api/index.ts` — add account hooks + deposit mutation
- `frontend/src/modules/member-portal/api/index.ts` — add portal wrappers

**Verification**:
- Balance shows correct amount for member with billed flights
- Entries table shows correct accounting lines
- Deposit creates real AccountingEntry (check DB)
- Club mode can delete draft entries
- Portal deposit creates entry, shows confirmation
- Payment method dropdown has valid options

---

#### Phase 4a — Tab: Club Expenses

**Steps**:
1. **Backend — Expense model** `backend/models.py`: new `MemberExpense` table:
   - `uuid`, `member_uuid` (FK), `amount` (Numeric(10,2)), `description` (Text), `status` (pending/approved/rejected), `receipt_url` (nullable, S3 presigned URL), `rejection_reason` (nullable), `created_at`, `updated_at`, `approved_by` (FK → User nullable), `approved_at` (nullable)
   - No `expense_type` field — club expenses are a distinct model from volunteer fiscal declarations

2. **Backend — Expense CRUD endpoints**:
   - `GET /api/v1/members/{member_uuid}/expenses` — list expenses (filterable by status, date)
   - `POST /api/v1/members/{member_uuid}/expenses` — create expense (member submits)
   - `PATCH /api/v1/expenses/{expense_uuid}/review` — approve/reject (club only, CAP_MANAGE_USERS)
   - `DELETE /api/v1/expenses/{expense_uuid}` — delete own pending expense
   - Portal version: same endpoints but member_uuid derived from JWT
   - Receipt upload: separate `POST /api/v1/expenses/{expense_uuid}/receipt` — uploads to S3 under `members/{uuid}/expenses/{expense_uuid}/`

3. **Backend — Auto-reimbursement on approval**:
   - When expense is approved, automatically create `AccountingEntry` with:
     - Debit line: expense account (class 6, configurable in settings)
     - Credit line: member receivable account (411 or similar)
     - Auto-post (state=2)
     - Reference: "Remb. note de frais — {member_name} — {date}"
   - Rejection does NOT create any entry

4. **Frontend — Club Expenses tab** `MemberClubExpensesTab.tsx`:
   - **Table**: date, amount, description, status badge (pending=🟡, approved=🟢, rejected=🔴), receipt link/icon
     - Club mode: approve/reject buttons on pending rows
     - Portal mode: read-only table, can delete own pending
   - **New expense form** (portal mode + club mode):
     - Amount input (decimal, EUR)
     - Description textarea
     - Receipt file upload (drag & drop, S3 storage)
     - Submit button
   - **Empty state**: "Aucune note de frais"
   - **Auto-reimbursement indicator**: approved expenses show a "Remboursé" badge with entry reference

5. **Frontend — API hooks**:
   - `useMemberExpensesQuery(memberUuid, filters)`
   - `useCreateMemberExpenseMutation()`
   - `useReviewExpenseMutation()` (club only)
   - `useDeleteExpenseMutation()`
   - `useUploadExpenseReceiptMutation()`

**Files**:
- `backend/models.py` — new `MemberExpense` table
- `backend/api/routes/members.py` — expense CRUD + reimbursement endpoints
- `backend/services/members.py` — expense service functions
- `backend/schemas/members.py` — expense schemas
- `frontend/src/modules/members/components/MemberClubExpensesTab.tsx` — **new**
- `frontend/src/modules/members/api/index.ts` — expense hooks
- `frontend/src/modules/member-portal/api/index.ts` — portal expense wrappers

**Verification**:
- Member submits expense → pending status
- Club admin approves → status changes to approved → auto-reimbursement entry created
- Club admin rejects → status changes to rejected, no entry created
- Receipt upload stores file in S3
- Portal shows own expenses; club shows all

---

#### Phase 4b — Tab: Volunteer Fiscal Declarations

**Concept**: Members declare donations or volunteer mileage (km) for fiscal year N-1, to receive a tax reduction receipt. This is a **neutral** accounting operation — the total amount is recorded on dedicated pass-through accounts. No club expense or income is generated.

**Steps**:
1. **Backend — Volunteer Fiscal model** `backend/models.py`: new `MemberVolunteerFiscal` table:
   - `uuid`, `member_uuid` (FK), `fiscal_year` (SmallInteger, NOT NULL — the year of activity, N-1), `amount` (Numeric(10,2) NOT NULL), `declaration_type` (VARCHAR(20): `donation` / `km` / `other`), `description` (Text, nullable — e.g., "Trajet aller-retour meeting aérien"), `proof_file_url` (Text, nullable — S3 key for uploaded proof), `status` (VARCHAR(20): `pending` / `validated` / `receipt_issued`), `validated_by` (FK → User, nullable), `validated_at` (DateTime, nullable), `receipt_issued_at` (DateTime, nullable), `created_at`, `updated_at`
   - Unique constraint: `(member_uuid, fiscal_year)` — **one declaration per member per year**
   - Index on `(fiscal_year, status)`

2. **Backend — Volunteer Fiscal settings** alongside `flight_billing_settings`:
   - New table `volunteer_fiscal_settings`:
     - `id` SERIAL PK
     - `fiscal_year_uuid` UUID NOT NULL UNIQUE REFERENCES fiscal_years(uuid)
     - `receipt_account_uuid` UUID NOT NULL REFERENCES accounting_accounts(uuid) — e.g., 467 (pass-through liability)
     - `offset_account_uuid` UUID NOT NULL REFERENCES accounting_accounts(uuid) — e.g., 471 (suspense/pass-through asset)
     - These two accounts mirror each other — the operation is neutral
     - `receipt_footer_text` TEXT — custom text printed on the fiscal receipt
     - `created_at`, `updated_at`
   - Settings form UI: combobox selectors for both accounts + footer text input

3. **Backend — Volunteer Fiscal CRUD endpoints**:
   - `GET /api/v1/members/{member_uuid}/volunteer-fiscal` — get member's declaration for a year
   - `POST /api/v1/members/{member_uuid}/volunteer-fiscal` — create/update declaration (one per member per year)
   - `PATCH /api/v1/volunteer-fiscal/{declaration_uuid}/validate` — validate (club only, sets validated_at, optionally creates accounting entry)
   - `POST /api/v1/volunteer-fiscal/{declaration_uuid}/upload-proof` — upload proof file to S3
   - `GET /api/v1/volunteer-fiscal/{declaration_uuid}/receipt` — generate fiscal receipt PDF (Phase 10 — placeholder for now)
   - `GET /api/v1/volunteer-fiscal/summary?fiscal_year=...` — club view: aggregate all validated declarations for the year (total amount, member count)
   - Portal endpoints: same, member_uuid from JWT

4. **Backend — Accounting on validation** (neutral entry):
   - When a declaration is validated, create an `AccountingEntry` with:
     - Debit line: `offset_account_uuid` (pass-through, e.g. 471)
     - Credit line: `receipt_account_uuid` (pass-through, e.g. 467)
     - Amount: declaration amount
     - Reference: "Reçu fiscal {year} — {member_name}"
     - Auto-posted (state=2)
     - This is purely informational/tracking — no P&L impact

5. **Frontend — Volunteer Fiscal tab** `MemberVolunteerFiscalTab.tsx`:
   - **Header**: Current fiscal year + explanatory text: "Déclarez ici vos dons ou frais de déplacement bénévole pour obtenir un reçu fiscal. La déclaration concerne l'activité de l'année N-1."
   - **Declaration form** (one per member per year):
     - Fiscal year input (pre-filled: current year - 1, locked after submission)
     - Declaration type selector: Donation / Kilométrage bénévole / Autre
     - Description textarea
     - Amount input (decimal, EUR)
     - Proof file upload (drag & drop)
     - Submit button
   - **Status display**: pending (🟡), validated (🟢), receipt issued (🔵)
   - **Club mode**: view all members' declarations for the FY, validate pending ones, see aggregate totals at top
   - **Portal mode**: own declaration only, edit while pending
   - **Receipt button**: "Télécharger le reçu fiscal" (Phase 10 — placeholder: "Bientôt disponible")
   - **Empty state**: "Aucune déclaration fiscale cette année"

6. **Frontend — API hooks**:
   - `useMemberVolunteerFiscalQuery(memberUuid, fiscalYear)`
   - `useUpsertVolunteerFiscalMutation()`
   - `useValidateVolunteerFiscalMutation()` (club only)
   - `useUploadVolunteerFiscalProofMutation()`
   - `useVolunteerFiscalSummaryQuery(fiscalYear)` (club only)
   - `useVolunteerFiscalSettingsQuery(fiscalYearUuid)`
   - `useUpsertVolunteerFiscalSettingsMutation()`

**Files**:
- `backend/models.py` — new `MemberVolunteerFiscal` + `VolunteerFiscalSettings` tables
- `backend/api/routes/members.py` — volunteer fiscal endpoints
- `backend/services/members.py` — volunteer fiscal service functions
- `backend/schemas/members.py` — volunteer fiscal schemas
- `backend/api/routes/accounting.py` — volunteer fiscal settings endpoints (or in members.py)
- `frontend/src/modules/members/components/MemberVolunteerFiscalTab.tsx` — **new**
- `frontend/src/modules/members/api/index.ts` — volunteer fiscal hooks + settings hooks
- `frontend/src/modules/member-portal/api/index.ts` — portal wrappers

**Verification**:
- Member submits volunteer fiscal declaration → pending status
- Club validates → status changes to validated → neutral accounting entry created
- Upload proof file → stored in S3
- One declaration per member per year enforced (upsert)
- Club summary shows aggregate totals
- Portal shows own declaration only

---

#### Phase 5 — Tab: Document Management

**Steps**:
1. **Backend — Document model** `backend/models.py`: new `MemberDocument` table:
   - `uuid`, `member_uuid` (FK), `document_type` (varchar: certificate | medical | invoice | receipt | other), `label` (varchar 255), `description` (text nullable), `filename` (varchar 255), `s3_key` (varchar 500), `mime_type` (varchar 100), `file_size` (bigint), `uploaded_at` (datetime), `uploaded_by` (FK → User nullable)
   - Index on `(member_uuid, document_type)`

2. **Backend — Document CRUD endpoints**:
   - `GET /api/v1/members/{member_uuid}/documents` — list documents (filterable by type)
   - `POST /api/v1/members/{member_uuid}/documents/upload` — upload file + metadata → stores in S3 at `members/{uuid}/documents/{document_uuid}/{filename}` → creates MemberDocument row
   - `GET /api/v1/documents/{document_uuid}/download` — generates presigned S3 URL (temporary 1h link)
   - `DELETE /api/v1/documents/{document_uuid}` — deletes from S3 + removes row
   - `PATCH /api/v1/documents/{document_uuid}` — update metadata (label, description, document_type)
   - Portal: same endpoints but member_uuid derived from JWT

3. **Frontend — Documents tab** `MemberDocumentsTab.tsx`:
   - **Document list**: card or table view showing: icon (based on mime/type), label, type badge, file size, upload date
   - **Document type filter**: pills (All, Certificates, Medical, Invoices, Receipts, Other)
   - **Upload button**: opens dialog with file picker (drag & drop) + label + type selector + description
   - **Row actions**: Download (opens in new tab), Edit metadata, Delete (with confirmation)
   - Club mode: full CRUD for any member
   - Portal mode: limited to own documents, can upload/download/delete own
   - Empty state: "Aucun document" with upload CTA

4. **Frontend — API hooks**:
   - `useMemberDocumentsQuery(memberUuid, filters?)`
   - `useUploadMemberDocumentMutation()`
   - `useDeleteMemberDocumentMutation()`
   - `useUpdateMemberDocumentMutation()`
   - `useDocumentDownloadUrlQuery(documentUuid)` — returns presigned URL

**Files**:
- `backend/models.py` — new `MemberDocument` table
- `backend/api/routes/members.py` — document endpoints
- `backend/services/members.py` — document service functions
- `backend/services/storage.py` — enhance if needed for member document folder structure
- `backend/schemas/members.py` — document schemas
- `frontend/src/modules/members/components/MemberDocumentsTab.tsx` — **new**
- `frontend/src/modules/members/api/index.ts` — document hooks
- `frontend/src/modules/member-portal/api/index.ts` — portal document wrappers

**Verification**:
- Upload document → appears in list with correct metadata
- Download → opens file or triggers download
- Delete → removes from list and S3
- Document type filter works
- Portal context only shows own documents

---

#### Phase 6 — Pilot Sheet Redesign (Pack Cleanup)

**Steps**:
1. **Backend — Migration** to remove pack fields from `member_sheets`:
   - `ALTER TABLE member_sheets DROP COLUMN packs_bought_count, DROP COLUMN hours_done_in_pack, DROP COLUMN remaining_hours_in_pack;`
   - Or mark as deprecated and remove in a later migration (safer — keep columns but stop writing to them)

2. **Backend — Remove pack logic from MemberSheet**:
   - Remove pack field writes in `create_member_registration()` and `upsert_member_sheet()`
   - Update `MemberSheetResponse` schema to exclude pack fields
   - OR keep them but derive from `vw_member_pack_balances` if needed

3. **Update `MemberPilotSheetPage.tsx`** — Replace with redirect to workspace:
   - At `/club/members/:memberUuid/pilot-sheet`, show a redirect notice: "Cette page a été remplacée par l'espace membre → [Accéder à l'espace membre]"
   - OR directly redirect to `/club/members/:memberUuid/workspace`

4. **Update MemberSheet upsert API** — Remove pack fields from `MemberSheetUpsertRequest` schema

5. **Frontend — Remove pack display from MembersListPage** integration:
   - Remove pack-related columns from member sheet display
   - Ensure Daily Ops packs tab is the only place for pack management

**Files**:
- `docs/migrations/045_remove_member_sheet_pack_fields.sql` — migration
- `backend/models.py` — remove pack fields from MemberSheet model
- `backend/schemas/members.py` — update MemberSheetUpsertRequest, MemberSheetResponse
- `backend/services/members.py` — update upsert_member_sheet, create_member_registration
- `frontend/src/modules/members/components/MemberPilotSheetPage.tsx` — redirect or repurpose
- `frontend/src/modules/members/components/MemberSheetsPage.tsx` — update if it showed pack fields

**Verification**:
- Migration runs cleanly
- Creating/updating member sheet no longer requires pack fields
- Daily Ops packs tab still shows all pack data correctly
- Existing sheets retain pack data columns (if kept, just unused)

---

#### Phase 7 — Pilot List Enhancement

**Steps**:
1. **Backend — New computed fields on member list**:
   - Add optional query params to `GET /api/v1/members`: `include_balance=true`, `include_last_flight=true`
   - When `include_balance=true`: LEFT JOIN accounting_lines → compute balance per member, return `balance` field
   - When `include_last_flight=true`: LEFT JOIN validated_flights → get MAX(flight_date), return `last_flight_date`
   - These are expensive — only compute when explicitly requested
   - For efficiency: create `vw_member_financial_summary` and `vw_member_last_flight` views

   OR simpler approach: 
   - Add `last_flight_date` to `MemberSummaryResponse` (nullable)
   - Add `balance` to `MemberSummaryResponse` (nullable, Decimal)
   - Compute via subquery in the list endpoint when requested

2. **Backend — Update MemberSummaryResponse schema**:
   - Add `last_flight_date: date | null`
   - Add `balance: Decimal | null`

3. **Frontend — Update MembersListPage/MemberDirectoryTable**:
   - New columns: "Last Flight" (date badge, or "—" if null), "Balance" (colored: green if positive/zero, red if negative)
   - Sorting on these columns (if backend supports)
   - Column visibility toggle or show always
   - Click on balance → opens member workspace at Balance tab
   - Click on last flight → opens member workspace at Logbook tab

4. **Frontend — Filters**:
   - Add "Has flown since" date filter (backend: flights joined)
   - Add "Balance range" filter (min/max amount)
   - These are advanced (in filter drawer)

**Files**:
- `backend/api/routes/members.py` — add include_balance, include_last_flight params
- `backend/services/members.py` — add balance/last_flight computation in list_members
- `backend/schemas/members.py` — add optional fields to MemberSummaryResponse
- `frontend/src/modules/members/components/MembersListPage.tsx` — add columns
- `frontend/src/modules/members/components/MemberDirectoryTable.tsx` — add columns + links
- `frontend/src/modules/members/components/MemberFilterDrawer.tsx` — add new filters

**Verification**:
- Pilot list shows last flight date and balance for members
- Filters work (has flown since, balance range)
- Clicking balance or flight navigates to correct workspace tab
- Performance is acceptable (optional computation)

---

#### Phase 8 — Key Access Automation & Email

**Steps**:
1. **Backend — Email service** `backend/services/email.py`:
   - `send_email(to: str, subject: str, body_html: str, attachments?: list)` 
   - Uses SMTP config from `conf_emails.json`
   - HTML template support (string.Template or Jinja2)
   - Returns success/failure

2. **Backend — Portal access email endpoint** `POST /api/v1/members/{member_uuid}/send-portal-access`:
   - Requires CAP_MANAGE_USERS
   - Checks member has email
   - Generates expense_access token (if not already enabled)
   - Sends email with:
     - Portal URL (from env config)
     - Member identifier (account_id or email)
     - Generated token
     - Instructions to change token after login
   - Logs to audit_log
   - Returns `{ success: bool, message: string }`

3. **Backend — Member self-service token change** `POST /api/v1/member-portal/change-token`:
   - Authenticated (portal JWT)
   - Accepts `{ current_token, new_token }`
   - Validates current_token
   - Hashes and stores new token
   - Returns success

4. **Frontend — "Send portal access" button** in member workspace header (club mode only):
   - Button: "📧 Envoyer l'accès au portail"
   - Shows confirmation dialog with member email displayed
   - On confirm: calls POST endpoint, shows success toast
   - If no email: warning message asking to set member email first

5. **Frontend — Token change page** in portal workspace:
   - Settings/gear icon in portal header → opens token change dialog or page
   - Form: current token (pre-filled notice), new token (with generate button), confirm new token
   - "Generate strong token" button → generates `secrets.token_urlsafe(24)` equivalent
   - After change: show confirmation + new token (one-time display)
   - Logout + prompt to re-login with new token

6. **Frontend — Portal link in email**:
   - URL: configurable via env variable
   - Default: window.location.origin + "/member-portal/login"
   - Email template: "Bonjour {name}, votre accès au portail membre du Club ERP est prêt..."

**Files**:
- `backend/services/email.py` — **new**, SMTP email service
- `backend/api/routes/members.py` — add send-portal-access endpoint
- `backend/api/routes/member_portal.py` — add change-token endpoint
- `backend/services/members.py` — add send_portal_access function
- `backend/services/member_portal.py` — add change_token function
- `frontend/src/modules/members/components/MemberWorkspaceShell.tsx` — add portal access button (club mode)
- `frontend/src/modules/member-portal/pages/` — add TokenChangePage or dialog
- `frontend/src/modules/member-portal/api/index.ts` — add changeToken mutation
- `backend/conf_emails.json` — verify/update SMTP config

**Verification**:
- "Send portal access" button works → email received with correct URL + credentials
- Member can change token in portal → new token works, old token rejected
- Member without email → warning shown, button disabled
- Portal login with new token works

---

#### Phase 9 — Migration & Cleanup

**Steps**:
1. **Migration scripts** in `docs/migrations/`:
   - `046_member_expenses.sql` — create member_expenses table
   - `047_member_volunteer_fiscal.sql` — create member_volunteer_fiscal + volunteer_fiscal_settings tables
   - `048_member_documents.sql` — create member_documents table
   - `049_member_workspace_views.sql` — create vw_member_financial_summary, vw_member_last_flight
   - `050_remove_member_sheet_pack_fields.sql` — DROP pack columns from member_sheets
   - `051_deposit_settings.sql` — add deposit columns to flight_billing_settings

2. **Backend tests** for all new endpoints and services:
   - `backend/tests/test_member_logbook.py`
   - `backend/tests/test_member_expenses.py`
   - `backend/tests/test_member_documents.py`
   - `backend/tests/test_member_portal_key_change.py`
   - `backend/tests/test_deposit.py`
   - Update existing tests for MemberSheet pack field removal

3. **Frontend i18n keys**:
   - Add all new keys to `packages/i18n/src/resources/fr.ts` and `en.ts`
   - Namespace: `members.workspace.*`, `members.documents.*`, `members.expenses.*`, `members.balance.*`, `members.logbook.*`

4. **Remove or redirect old pilot sheet route** — update navigation links in members list to point to workspace

**Files**:
- `docs/migrations/046-050.sql` — migration files
- `backend/tests/` — new test files
- `packages/i18n/src/resources/fr.ts` — translations
- `packages/i18n/src/resources/en.ts` — translations
- `frontend/src/modules/members/components/MembersListPage.tsx` — update navigation links

**Verification**:
- All migrations run in order without errors
- All new tests pass
- Old pilot sheet route redirects to workspace
- i18n keys resolve correctly in both languages

---

### Navigation & UX Flow

```
Club Context (/club/members/):
  /club/members/
    └── MembersListPage (table with last_flight, balance columns)
          ├── Click row → /club/members/{uuid}/edit
          ├── Click "Pilot sheet" → /club/members/{uuid}/workspace (redirect)
          └── Click balance → /club/members/{uuid}/workspace (Balance tab)
          
  /club/members/{uuid}/workspace
    └── MemberWorkspaceShell
          ├── Header: Avatar, Name, Account ID, Badges, Status
          │   [📧 Send portal access] [✏️ Edit member] [← Back to list]
          ├── Tabs:
          │   ├── 📖 Logbook (MemberLogbookTab)
          │   ├── 💰 Balance & Deposits (MemberBalanceTab)
          │   ├── 🧾 Club Expenses (MemberClubExpensesTab)
          │   ├── 📋 Volunteer Fiscal (MemberVolunteerFiscalTab)
          │   └── 📄 Documents (MemberDocumentsTab)
          └── Tab content renders based on active tab

Portal Context (/member-portal/):
  /member-portal/login (unchanged)
  /member-portal/workspace
    └── MemberWorkspaceShell (mode='portal')
          ├── Header: Member name, Logout button
          │   [🔑 Change token]
          ├── Tabs: same as club
          └── Tab content renders with readOnly restrictions
```

---

### Database Models Summary

**New tables**:
```sql
-- Member club expenses (note de frais)
CREATE TABLE member_expenses (
    uuid UUID PRIMARY KEY,
    member_uuid UUID NOT NULL REFERENCES members(uuid),
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    receipt_url TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMPTZ
);
CREATE INDEX idx_member_expenses_member ON member_expenses(member_uuid);
CREATE INDEX idx_member_expenses_status ON member_expenses(status);

-- Member volunteer fiscal declarations (annual, one per member per year)
CREATE TABLE member_volunteer_fiscal (
    uuid UUID PRIMARY KEY,
    member_uuid UUID NOT NULL REFERENCES members(uuid),
    fiscal_year SMALLINT NOT NULL,  -- year of activity (N-1)
    amount NUMERIC(10,2) NOT NULL,
    declaration_type VARCHAR(20) NOT NULL CHECK (declaration_type IN ('donation', 'km', 'other')),
    description TEXT,
    proof_file_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'receipt_issued')),
    validated_by INTEGER REFERENCES users(id),
    validated_at TIMESTAMPTZ,
    receipt_issued_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(member_uuid, fiscal_year)
);
CREATE INDEX idx_volunteer_fiscal_year ON member_volunteer_fiscal(fiscal_year, status);

-- Volunteer fiscal settings (per fiscal year)
CREATE TABLE volunteer_fiscal_settings (
    id SERIAL PRIMARY KEY,
    fiscal_year_uuid UUID NOT NULL UNIQUE REFERENCES fiscal_years(uuid) ON DELETE CASCADE,
    receipt_account_uuid UUID NOT NULL REFERENCES accounting_accounts(uuid),  -- e.g. 467 (pass-through liability)
    offset_account_uuid UUID NOT NULL REFERENCES accounting_accounts(uuid),   -- e.g. 471 (pass-through asset)
    receipt_footer_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Member documents (S3-backed)
CREATE TABLE member_documents (
    uuid UUID PRIMARY KEY,
    member_uuid UUID NOT NULL REFERENCES members(uuid),
    document_type VARCHAR(50) NOT NULL DEFAULT 'other',
    label VARCHAR(255) NOT NULL,
    description TEXT,
    filename VARCHAR(255) NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_member_documents_member ON member_documents(member_uuid);
CREATE INDEX idx_member_documents_type ON member_documents(document_type);
```

**Modified tables**:
```sql
-- DROP pack fields (user confirmed full removal)
ALTER TABLE member_sheets DROP COLUMN IF EXISTS packs_bought_count;
ALTER TABLE member_sheets DROP COLUMN IF EXISTS hours_done_in_pack;
ALTER TABLE member_sheets DROP COLUMN IF EXISTS remaining_hours_in_pack;

-- Extend flight_billing_settings for deposits
ALTER TABLE flight_billing_settings ADD COLUMN IF NOT EXISTS deposit_journal_uuid UUID REFERENCES accounting_journals(uuid);
ALTER TABLE flight_billing_settings ADD COLUMN IF NOT EXISTS deposit_bank_account_uuid UUID REFERENCES accounting_accounts(uuid);
ALTER TABLE flight_billing_settings ADD COLUMN IF NOT EXISTS deposit_receivable_account_uuid UUID REFERENCES accounting_accounts(uuid);
```

**New views** (for performance):
```sql
CREATE VIEW vw_member_last_flight AS
SELECT vf.pilot_erp_id, MAX(vf.jour) AS last_flight_date
FROM validated_flights vf
GROUP BY vf.pilot_erp_id;

CREATE VIEW vw_member_financial_summary AS
SELECT 
    al.member_uuid,
    SUM(CASE WHEN al.side = 'debit' THEN al.amount ELSE 0 END) AS total_debit,
    SUM(CASE WHEN al.side = 'credit' THEN al.amount ELSE 0 END) AS total_credit,
    SUM(CASE WHEN al.side = 'debit' THEN al.amount ELSE -al.amount END) AS balance
FROM accounting_lines al
JOIN accounting_entries ae ON al.entry_uuid = ae.uuid
WHERE ae.state = 2  -- posted only
GROUP BY al.member_uuid;
```

---

### Relevant Files (Summary)

| File | Action |
|---|---|
| `backend/models.py` | Add MemberExpense, MemberVolunteerFiscal, VolunteerFiscalSettings, MemberDocument; remove MemberSheet pack fields; add deposit settings columns |
| `backend/api/routes/members.py` | Add logbook, balance, entries, deposit, club expenses, volunteer fiscal, documents, send-portal-access endpoints |
| `backend/api/routes/member_portal.py` | Add change-token endpoint; keep login; share member workspace endpoints |
| `backend/services/members.py` | Add service functions for all new business logic |
| `backend/services/email.py` | **New** — SMTP email service |
| `backend/services/member_portal.py` | Add change_token function; fix deposit stub |
| `backend/schemas/members.py` | Add all new request/response schemas |
| `backend/schemas/member_portal.py` | Update if needed for new endpoints |
| `frontend/src/modules/members/types/workspace.ts` | **New** — WorkspaceContext type |
| `frontend/src/modules/members/components/MemberWorkspaceShell.tsx` | **New** — shared workspace container |
| `frontend/src/modules/members/components/MemberLogbookTab.tsx` | **New** — logbook tab |
| `frontend/src/modules/members/components/MemberBalanceTab.tsx` | **New** — balance & deposits tab |
| `frontend/src/modules/members/components/MemberClubExpensesTab.tsx` | **New** — club expenses tab |
| `frontend/src/modules/members/components/MemberVolunteerFiscalTab.tsx` | **New** — volunteer fiscal tab |
| `frontend/src/modules/members/components/MemberDocumentsTab.tsx` | **New** — documents tab |
| `frontend/src/modules/members/components/MembersListPage.tsx` | Update — new columns + links |
| `frontend/src/modules/members/components/MemberDirectoryTable.tsx` | Update — new columns |
| `frontend/src/modules/members/components/MemberPilotSheetPage.tsx` | Deprecate/redirect |
| `frontend/src/modules/members/components/MemberSheetsPage.tsx` | Update — remove pack fields from form |
| `frontend/src/modules/members/api/index.ts` | Add all new hooks |
| `frontend/src/modules/member-portal/api/index.ts` | Add portal wrappers |
| `frontend/src/modules/member-portal/pages/LoginPage.tsx` | Keep — no change |
| `frontend/src/modules/member-portal/pages/DashboardPage.tsx` | Replace/redirect to workspace |
| `frontend/src/modules/member-portal/pages/FlightsPage.tsx` | Replace/redirect to workspace |
| `frontend/src/modules/member-portal/pages/AccountPage.tsx` | Replace/redirect to workspace |
| `frontend/src/modules/member-portal/pages/ExpensesPage.tsx` | Replace/redirect to workspace |
| `frontend/src/modules/member-portal/components/PortalShell.tsx` | Update navigation to workspace |
| `frontend/src/App.tsx` | Add new routes |
| `packages/i18n/src/resources/fr.ts` | Add translations |
| `packages/i18n/src/resources/en.ts` | Add translations |
| `docs/migrations/046-051.sql` | Migration scripts |

---

### Verification Plan

1. **Phase 1**: Open club workspace route → tabs render → switch tabs → no errors. Open portal → own workspace loads.
2. **Phase 2**: Member with flights sees logbook → filters work → expand shows billing detail.
3. **Phase 3**: Balance shows correct amount → deposit creates real entry → entry appears in table.
4. **Phase 4**: Submit expense → pending → club approves → approved → receipt upload works.
5. **Phase 5**: Upload document → appears → download link works → delete removes file.
6. **Phase 6**: MemberSheet upsert no longer needs pack fields → Daily Ops packs tab unchanged.
7. **Phase 7**: Pilot list shows last flight date + balance → click navigates to workspace tab.
8. **Phase 8**: "Send portal access" sends email → member logs in with token → changes token → old token rejected.
9. **Integration**: Full flow — member receives portal access → logs in → sees own flights → submits expense → club approves → member sees approved status → uploads document → downloads it.
10. **Edge cases**: Member without flights (empty logbook), member with zero balance, member without email, expense rejection, document type filter, member category filter, deleted member (anonymized).

---

### Decisions (Answered)

| Question | Decision |
|---|---|
| Deposit grouped with Balance? | ✅ Yes, same tab |
| MemberSheet pack fields? | ✅ DROP columns now |
| Auto-reimbursement on expense approval? | ✅ Yes, create accounting entry |
| Volunteer expense model? | ✅ Annual fiscal declaration (donation/km), NOT a club expense; one per member per year; proof upload; configurable accounts |
| Volunteer accounting? | ✅ Neutral pass-through: debit offset (471) ↔ credit receipt (467) |
| Priority? | ✅ Logbook first, then Balance, then Club Expenses, Volunteer Fiscal, Documents |
| S3 storage? | ✅ Use existing `/storage/settings` config (already defined, just unused) |

### Remaining Question

1. **Email delivery reliability**: SMTP is synchronous. For v1, should we keep it simple with a blocking send + error toast, or invest in a background task queue (e.g., ARQ or Celery)? **Recommendation**: Keep sync for v1 — add a retry button in the UI if sending fails. Queue later if sending becomes a bottleneck.
