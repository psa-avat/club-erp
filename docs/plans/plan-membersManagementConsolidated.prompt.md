## Plan: Members Management — Consolidated (Registration Lifecycle, Recap Emails, Anonymization, Self-Service)

### TL;DR

Consolidates two prior efforts into one plan: `plan-membersRegistrationLifecycleAndSelfService.prompt.md` (registration end-date rule, anonymization review, supplier UX split, self-registration design) and the ad-hoc member recap email feature. Two of the four original items are now **done** (supplier UX split, recap emails). This document tracks what's actually left: the Oct-1 registration end-date rule and the anonymization review screen, plus the still-deferred self-registration design.

This supersedes and replaces `plan-membersRegistrationLifecycleAndSelfService.prompt.md` and `plan-membersUxSplitByCategoryGroup.prompt.md`, both moved to `docs/archive/` as completed/consolidated.

---

### Status Summary

| Item | Status | Notes |
|---|---|---|
| Supplier UX split (Core/External/Business screens) | ✅ Done | Implemented independently of this plan; verified in `MembersListPage.tsx` (`SCREEN_CATEGORY_MAP`) |
| Member recap emails (single + bulk send, message templates, dedicated capability) | ✅ Done | Shipped in this session — see "Shipped: Recap Emails" below |
| Registration default end-date rule (Oct 1 → covers through next year) | ❌ Remaining | Phase 1 below |
| Anonymization review screen (preview + selective anonymize) | ❌ Remaining | Phase 2 below |
| Self-registration (public sign-up, form, committee pick, account entry config) | 📝 Spec only | Phase 3 below — design intentionally not built yet |

---

### Shipped: Supplier UX Split

Originally `plan-membersUxSplitByCategoryGroup.prompt.md`. No schema change — same `members` table, frontend-only category-group mapping and routing:
- Screens: Core = categories `{1,2,3,4,6}`, External = `{5,7}`, Business = `{8}` (client/supplier).
- Per-screen KPI strip, filters, and workflow guards (registration workflow hidden on the Business screen).
- Verified in `frontend/src/modules/members/components/MembersListPage.tsx` (`SCREEN_CATEGORY_MAP`, `SCREEN_META`, `allowRegistrationWorkflow`).

No further action needed here.

---

### Shipped: Recap Emails

Wires the previously-dead "send portal access" stub button into a real flow: a member gets an email with flight count, flight hours, and account balance, plus a free-text message the sender writes or prefills from a small CRUD list of templates. Also added a bulk "send to all members" action.

**Backend**:
- New capability `CAP_SEND_MEMBER_EMAILS` (`backend/constants.py`), seeded and auto-granted to `admin`; `finance` recommended as an explicit grant (documented in `docs/product/SPEC_ROLES_CAPABILITIES.md`, not yet applied as a DB grant — that's a runtime admin-UI action, not code).
- `MemberRecapMessageTemplate` model + `docs/migrations/084_member_recap_message_templates.sql`.
- `backend/services/member_recap.py`: flight-totals aggregate, single/bulk send (skips members without email, does not count them as failures), template CRUD.
- `backend/services/email.py`: new `send_member_recap_email`, same FastMail/config pattern as the existing PIN sender.
- Routes on the members router behind `recap_email_guard` (`CAP_SEND_MEMBER_EMAILS`, not `CAP_MANAGE_USERS`): template CRUD, `POST /{member_uuid}/send-recap-email`, `POST /recap-emails/send-bulk`.
- `PORTAL_BASE_URL` env var (defaults to `http://localhost:8080`), documented in `deploy/README.md`.
- `backend/tests/test_member_recap_email.py`: 9 tests (flight-total math, escaping/formatting, skip/tally logic, template CRUD, capability-guard wiring on every new route).

**Frontend**:
- `RecapMessageComposer.tsx`: shared compose dialog (template picker + editable textarea).
- `MemberWorkspaceShell.tsx`: stub button wired to a real single-member send, capability-gated.
- `MembersListPage.tsx`: "Send recap to all" bulk action (compose → confirm dialog), plus a link to template management.
- `MemberRecapTemplatesPage.tsx`: capability-gated CRUD screen, route `/club/members/recap-templates`.
- i18n keys in `fr.ts`/`en.ts` under `members.recapEmail.*`.

**Verified**: full backend suite 361/361 passing (venv rebuilt against Python 3.13 to match `backend/Dockerfile`); frontend `tsc -b && vite build` clean.

**Known follow-up (not blocking)**: `deploy/schema-erp-club.sql` (the pg_dump snapshot) was not regenerated for the new table — that file is normally refreshed by dumping the DB after migrations apply, not hand-edited.

---

### Remaining Work

#### Phase 1 — Registration Default End-Date Rule

**Problem**: `RegistrationPanel.tsx` still hardcodes `${year}-01-01` → `${year}-12-31` regardless of when the registration actually starts, contradicting the club's real rule (Oct 1+ start → covers the rest of this year AND all of next year).

**Steps**:
1. Add a single source-of-truth helper in the backend: `compute_default_registration_period(start_date: date) -> tuple[date, date, int]` in `backend/services/members.py`, next to the other registration helpers (near `create_member_registration`). Rule:
   - If `start_date.month >= 10` (Oct/Nov/Dec): `end_date = date(start_date.year + 1, 12, 31)`, `registered_for_year = start_date.year + 1`.
   - Else: `end_date = date(start_date.year, 12, 31)`, `registered_for_year = start_date.year`.
2. Expose it via a small read-only endpoint: `GET /api/v1/members/{member_uuid}/registrations/default-period?start_date=YYYY-MM-DD` → `{ start_date, end_date, registered_for_year }`. Keeps the rule server-side (single source of truth, reusable later by self-registration in Phase 3) instead of duplicating date math in TypeScript.
3. Frontend: `RegistrationPanel.tsx` calls this endpoint when the panel opens (default `start_date = today`) and whenever the staff member edits the start date field. Populate `end_date` and `registered_for_year` from the response but leave both fields editable — the endpoint only *proposes* a default.
4. Verify against `_is_permanent_member_category` — permanent categories reject registration entirely, so the new endpoint should short-circuit the same way and surface the existing `PERMANENT_MEMBER_REGISTRATION_ERROR`.
5. Backend test: add cases for Sep 30 (same-year end), Oct 1 (next-year end), Dec 31 (next-year end), and Jan 1 (same-year end) boundaries.

**Files**: `backend/services/members.py`, `backend/api/routes/members.py`, `backend/schemas/members.py` (response schema), `frontend/src/modules/members/components/RegistrationPanel.tsx`, `frontend/src/modules/members/api/index.ts` (new query hook), relevant `backend/tests/`.

**Verification**: Opening "Finalize Registration" on/after Oct 1 proposes Dec 31 of next year; before Oct 1 proposes Dec 31 of the current year; staff can still override both dates before validating.

---

#### Phase 2 — Anonymization Review Screen

**Problem**: `anonymize_inactive_members` only runs as a blind bulk sweep against a fixed year-threshold — there is no way to see who is about to be anonymized, or to anonymize an individual member ahead of the threshold.

**Steps**:
1. Add `GET /api/v1/members/anonymize-inactive/preview?as_of_date=YYYY-MM-DD` (default `as_of_date = today`) reusing the same "no active registration covering `as_of_date`" query, but returning a list (`uuid`, `account_id`, `first_name`, `last_name`, `member_category`, `last_registration_date`, `status`) instead of mutating anything.
2. Extend `anonymize_inactive_members` to accept an optional `member_uuids: list[UUID] | None` parameter: when provided, anonymize exactly that set (still excluding already-anonymized members); when omitted, keep today's full-sweep behavior unchanged so any existing scheduled job keeps working.
3. Extend the request schema behind `POST /api/v1/members/anonymize-inactive` with the optional `member_uuids` and `as_of_date` fields.
4. Frontend: new admin page/panel (e.g. `MemberAnonymizationPage.tsx`) — cutoff date picker (defaulting to the configured `anonymize_after_unregistered_years` threshold), a table of candidates with checkboxes, and an `AlertDialog`/`ConfirmDialog`-gated "Anonymize selected" action (irreversible PII clearing).
5. Wire into shell navigation under Admin, gated by `CAP_MANAGE_USERS` (matching the existing route's guard).
6. Add i18n keys under the `members` namespace.

**Files**: `backend/services/members.py`, `backend/api/routes/members.py`, `backend/schemas/members.py`, new `frontend/src/modules/members/components/MemberAnonymizationPage.tsx`, `frontend/src/modules/members/api/index.ts`, `frontend/src/shell/navigation.ts`, `packages/i18n/src/resources/{fr,en}.ts`.

**Verification**: Setting a cutoff date lists exactly the members with no active registration covering it; selecting a subset and confirming anonymizes only those; existing threshold-based sweep endpoint behavior is unchanged when called without `member_uuids`.

---

#### Phase 3 — Self-Registration Design (spec only, build later)

**Goal**: let a prospective member self-register from a public (unauthenticated) page, resulting in: an accounting/account entry, a committee subscription, and a filled-out form — all admin-configurable — culminating in the member being pushed to Planche.

**Why a staging table, not a draft `Member` row**: `members.status` only allows `1..3` today (Active/Suspended/Resigned, with `3` overloaded for Anonymized — see `ANONYMIZED_MEMBER_STATUS` in `backend/constants.py`). There is no spare value for "submitted, not yet approved," and members are never deleted with `account_id` never reused — so a raw, possibly-spam or abandoned public submission must **not** consume a real `Member` row or an `account_id` sequence value. A separate staging table, `member_self_registration_requests`, holds the raw submission. Only on admin approval does the service create the real `Member` (+ `MemberRegistration` + `CommitteeMember` + accounting rows), reusing the existing `complete-registration` machinery (`RegistrationCompletionRequest` / `complete_member_registration`) rather than inventing a parallel code path.

**Schema (design, not yet implemented)**:
- `member_self_registration_settings` (singleton-per-club row, mirrors the `SystemSetting` pattern already used for `anonymize_after_unregistered_years`): `enabled`, `default_member_category`, `allowed_committee_uuids` (or NULL = any active committee), `accounting_template_uuid` / default `pricing_item_uuids`, `external_form_url` (when set, the "form to fill out" is a link to an external form instead of/alongside built-in fields), `auto_push_to_planche` (currently answered — see below).
- `member_self_registration_requests`: submitted identity/contact fields (mirrors `Member`), `requested_category`, `requested_committee_uuids`, `external_form_completed`, `status` (`pending`/`approved`/`rejected`), `submitted_at`, `reviewed_by`, `reviewed_at`, `rejection_reason`, `created_member_uuid` (nullable, filled on approval).

**Endpoints (design)**:
- `GET /api/v1/member-self-registration/config` — public, returns active settings for rendering the public form.
- `POST /api/v1/member-self-registration/requests` — public, creates a `pending` request (rate-limited / captcha'd — open question).
- `GET /api/v1/member-self-registration/requests` — admin list (`CAP_MANAGE_USERS`), filter by status.
- `POST /api/v1/member-self-registration/requests/{uuid}/approve` — creates the `Member`, then delegates to the existing registration-completion service, using Phase 1's default end-date rule for the proposed period.
- `POST /api/v1/member-self-registration/requests/{uuid}/reject`.
- `PUT /api/v1/member-self-registration/settings` — admin config.

**Frontend (design)**: new public route (e.g. `/join`) rendering the built-in form or redirecting to `external_form_url`; admin review queue (approve/reject, reusing `RegistrationPanel`-style fare/committee selection); admin settings page.

**Planche push trigger on approval**: confirmed **manual** — approval only creates the `Member` + registration + committee + accounting rows; the new member is included next time staff click "Push to Planche" (`POST /api/v1/planche/pilots/push`), same as any admin-created member today. No new code path needed.

**Files (future build, not this pass)**: `backend/models.py`, new `docs/migrations/0XX_member_self_registration.sql`, `backend/schemas/member_self_registration.py`, `backend/services/member_self_registration.py`, `backend/api/routes/member_self_registration.py`, new `frontend/src/modules/member-self-registration/` module, `frontend/src/App.tsx` (public route), i18n files.

---

### Decisions (Answered, carried forward)

| Question | Decision |
|---|---|
| Keep suppliers in the members table? | Yes — one table, Core/External/Business UI split (done) |
| End-date default rule basis | Chosen `start_date`, not today's date |
| Self-registration scope now | Design/spec only; build later |
| Anonymization review | Add manual preview + selective anonymize screen |
| Self-registration approval → Planche push | Manual — no new push trigger |
| Recap email trigger | Admin-triggered (button + confirmation), not a cron job |
| Recap email content | Summary numbers only (flight count, hours, balance) + portal link — no flight-by-flight detail |
| Recap email capability | Dedicated `SEND_MEMBER_EMAILS`, not folded into `MANAGE_USERS` |

---

### Verification Plan (remaining phases only)

1. **Phase 1**: Registration dialog proposes correct default `end_date`/`registered_for_year` across the Sep30/Oct1/Dec31/Jan1 boundaries; overrides still work; permanent categories still rejected.
2. **Phase 2**: Preview lists exactly the expected members for a given cutoff date; selective anonymize only affects chosen members; existing full-sweep call path unaffected.
3. **Phase 3**: Design review only — no runtime verification in this pass.
