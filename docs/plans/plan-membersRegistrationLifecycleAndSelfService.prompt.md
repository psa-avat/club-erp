## Plan: Members Registration Lifecycle, Anonymization Review & Self-Service Design

### TL;DR

Fix the registration dialog's default end-date logic to implement the real club rule (registering from Oct 1 carries a member active through the whole next year), add a manual review screen for anonymization instead of only a blind bulk job, adopt the existing (unbuilt) Core/External/Business UX split so suppliers stay in the same `members` table but get their own screen, and fully spec — but do not yet build — a self-registration flow (public sign-up → committee pick → configurable account entry → dedicated or external form → Planche push).

This plan builds on top of an already fairly mature module: `Member`, `MemberRegistration`, `Committee`/`CommitteeMember`, `MemberSheet`, price/pricing-item based registration completion, an automatic anonymization job, and a working Planche pilot push are all implemented. See "Current State" below for exact references.

---

### Current State (verified in code)

| Capability | Status | Reference |
|---|---|---|
| Unique member directory, 8 categories incl. `8 = Client/Supplier` (`FO-` prefix) | ✅ built | `backend/models.py:446` (`Member`) |
| Dated registration periods (`start_date`/`end_date`, status, type) | ✅ built | `backend/models.py:618` (`MemberRegistration`) |
| Registration action + dialog ("Finalize Registration" → slide-over) | ✅ built | `frontend/src/modules/members/components/RegistrationPanel.tsx` |
| Default end date proposal using the Oct-1 rule | ❌ missing — currently hardcoded `${year}-01-01` → `${year}-12-31` | `RegistrationPanel.tsx:223-224` |
| List/filter members unregistered for a year | ✅ built (`registration_state=registered\|unregistered`) | `backend/services/members.py:271-282` |
| Bulk automatic anonymization (never deletes; keeps `uuid`/`account_id`) | ✅ built, threshold-only, no preview | `backend/services/members.py:1291` (`anonymize_inactive_members`), `POST /api/v1/members/anonymize-inactive` at `backend/api/routes/members.py:242` |
| Manual review before anonymizing (pick cutoff, see candidates, select) | ❌ missing | — |
| Supplier/Business UX split (own screen, same table) | 📝 planned, not built | `docs/plans/plan-membersUxSplitByCategoryGroup.prompt.md` |
| Self-registration (public sign-up, form, committee pick, account entry config) | ❌ missing entirely | — |
| Planche push for members (pilots) | ✅ built, currently manual admin action | `backend/services/planche_integration.py:577` (`batch_push_pilots`), `POST /api/v1/planche/pilots/push` at `backend/api/routes/planche.py:152` |
| Member self-service portal (existing members only, login-gated) | ✅ built | `frontend/src/modules/member-portal/` |

Notable existing quirk (informational, not in scope to fix here): `members.status` CHECK constraint allows only `1..3` and code reuses `status = 3` for both "Resigned" and "Anonymized" (`ANONYMIZED_MEMBER_STATUS = 3` in `backend/constants.py:78`), which differs from the 4-value enum described in the spec doc. This has a direct consequence for Phase 4 design below (no spare status value for a "pending signup" state).

---

### Design Decisions

| Decision | Choice |
|---|---|
| Suppliers (category 8) | Keep one physical `members` table; implement the existing Core/External/Business screen-split plan so suppliers get a dedicated view without a schema change |
| Registration end-date default | Based on the **chosen `start_date`**: if `start_date >= Oct 1` of year Y, default `end_date = Dec 31` of Y+1; otherwise default `end_date = Dec 31` of Y. Always editable before submit. |
| Self-registration | Fully specify schema/endpoints/UI/config in this plan (Phase 4) as a later build phase — not implemented in this pass |
| Anonymization | Add a manual review screen: staff pick a cutoff date, see matching members, select which to anonymize, instead of only the blind automatic sweep |

---

### Included vs Excluded

| Included | Excluded (future / explicitly out of scope here) |
|---|---|
| Oct-1 default end-date rule in the registration dialog | Changing the underlying `member_registrations` schema |
| Anonymization preview endpoint + review screen | Fixing the `status` enum overload (Resigned vs Anonymized) |
| Adopting the Core/External/Business supplier UX split | Splitting suppliers into a separate physical table/module |
| Full design spec for self-registration (schema, endpoints, config, form strategy) | Building the self-registration feature itself |
| Noting Planche push integration points for self-registration | Changing Planche push to run automatically for existing manual registrations |

---

### Phase 1 — Registration Default End-Date Rule

**Problem**: `RegistrationPanel.tsx:223-224` always proposes `${year}-01-01` → `${year}-12-31` regardless of when the registration actually starts, contradicting the club's real rule (Oct 1+ start → covers the rest of this year AND all of next year).

**Steps**:
1. Add a single source-of-truth helper in the backend: `compute_default_registration_period(start_date: date) -> tuple[date, date, int]` in `backend/services/members.py`, next to the other registration helpers (near `create_member_registration` at line 1006). Rule:
   - If `start_date.month >= 10` (Oct/Nov/Dec): `end_date = date(start_date.year + 1, 12, 31)`, `registered_for_year = start_date.year + 1`.
   - Else: `end_date = date(start_date.year, 12, 31)`, `registered_for_year = start_date.year`.
2. Expose it via a small read-only endpoint: `GET /api/v1/members/{member_uuid}/registrations/default-period?start_date=YYYY-MM-DD` → `{ start_date, end_date, registered_for_year }`. Keeps the rule server-side (single source of truth, reusable later by self-registration in Phase 4) instead of duplicating date math in TypeScript.
3. Frontend: `RegistrationPanel.tsx` calls this endpoint when the panel opens (default `start_date = today`) and whenever the staff member edits the start date field. Populate `end_date` and `registered_for_year` from the response but leave both fields editable — the endpoint only *proposes* a default.
4. Verify against `_is_permanent_member_category` (`backend/services/members.py:1016`) — permanent categories reject registration entirely, so the new endpoint should short-circuit the same way and surface the existing `PERMANENT_MEMBER_REGISTRATION_ERROR`.
5. Backend test: `backend/tests/test_members*.py` — add cases for Sep 30 (same-year end), Oct 1 (next-year end), Dec 31 (next-year end), and Jan 1 (same-year end) boundaries.

**Files**: `backend/services/members.py`, `backend/api/routes/members.py`, `backend/schemas/members.py` (response schema), `frontend/src/modules/members/components/RegistrationPanel.tsx`, `frontend/src/modules/members/api/index.ts` (new query hook), relevant `backend/tests/`.

**Verification**: Opening "Finalize Registration" on/after Oct 1 proposes Dec 31 of next year; before Oct 1 proposes Dec 31 of the current year; staff can still override both dates before validating.

---

### Phase 2 — Anonymization Review Screen

**Problem**: `anonymize_inactive_members` (`backend/services/members.py:1291`) only runs as a blind bulk sweep against a fixed year-threshold — there is no way to see who is about to be anonymized, or to anonymize an individual member ahead of the threshold.

**Steps**:
1. Add `GET /api/v1/members/anonymize-inactive/preview?as_of_date=YYYY-MM-DD` (default `as_of_date = today`) reusing the same "no active registration covering `as_of_date`" query as lines 1309-1320, but returning a list (`uuid`, `account_id`, `first_name`, `last_name`, `member_category`, `last_registration_date`, `status`) instead of mutating anything.
2. Extend `anonymize_inactive_members` to accept an optional `member_uuids: list[UUID] | None` parameter: when provided, anonymize exactly that set (still excluding already-anonymized members); when omitted, keep today's full-sweep behavior unchanged so any existing scheduled job keeps working.
3. Extend the request schema behind `POST /api/v1/members/anonymize-inactive` (`backend/api/routes/members.py:242`) with the optional `member_uuids` and `as_of_date` fields.
4. Frontend: new admin page/panel (e.g. `MemberAnonymizationPage.tsx` in `frontend/src/modules/members/components/`) — cutoff date picker (defaulting to the configured `anonymize_after_unregistered_years` threshold), a table of candidates with checkboxes, and an `AlertDialog`-gated "Anonymize selected" action (irreversible PII clearing, per project convention for destructive confirmations).
5. Wire into shell navigation under Admin, gated by `CAP_MANAGE_USERS` (matching the existing route's guard).
6. Add i18n keys under the `members` namespace in `packages/i18n/src/resources/fr.ts` and `en.ts`.

**Files**: `backend/services/members.py`, `backend/api/routes/members.py`, `backend/schemas/members.py`, new `frontend/src/modules/members/components/MemberAnonymizationPage.tsx`, `frontend/src/modules/members/api/index.ts`, `frontend/src/shell/navigation.ts`, `packages/i18n/src/resources/{fr,en}.ts`.

**Verification**: Setting a cutoff date lists exactly the members with no active registration covering it; selecting a subset and confirming anonymizes only those; existing threshold-based sweep endpoint behavior is unchanged when called without `member_uuids`.

---

### Phase 3 — Adopt Supplier UX Split (Core / External / Business)

Promote `docs/plans/plan-membersUxSplitByCategoryGroup.prompt.md` into active scope, unchanged in approach (no schema migration — same `members` table, frontend-only category-group mapping and routing). Execute its 7 phases as written:
- Route-level screen context (Core/External/Business), default landing = Core.
- Category-group mapping: Core = {1,2,3,4,6}, External = {5,7}, Business = {8}.
- Per-screen KPI strip, filters, and workflow-guard rules (e.g. hide the registration workflow on the Business screen).
- CSV import category-8 alias coverage in `backend/services/members.py` (`_MEMBER_CATEGORY_MAP`).

**Files**: as listed in that plan doc — `MembersListPage.tsx`, `MemberFilterDrawer.tsx`, `MemberDirectoryTable.tsx`, `MemberKpiStrip.tsx`, `members/store/index.ts`, `membersShared.tsx`, `App.tsx`/shell routing, `backend/services/members.py`, i18n files.

**Verification**: as listed in that plan doc.

---

### Phase 4 — Self-Registration Design (spec only, build later)

**Goal**: let a prospective member self-register from a public (unauthenticated) page, resulting in: an accounting/account entry, a committee subscription, and a filled-out form — all admin-configurable — culminating in the member being pushed to Planche.

#### Why a staging table, not a draft `Member` row

`members.status` only allows `1..3` today (Active/Suspended/Resigned, with 3 overloaded for Anonymized — see "Current State"). There is no spare value for "submitted, not yet approved," and per the project rule members are never deleted and `account_id` is never reused — so a raw, possibly-spam or abandoned public submission must **not** consume a real `Member` row or an `account_id` sequence value.

Recommendation: a separate staging table, `member_self_registration_requests`, holds the raw submission. Only on admin approval does the service create the real `Member` (+ `MemberRegistration` + `CommitteeMember` + accounting rows), reusing the existing `complete-registration` machinery (`RegistrationCompletionRequest` / `complete_member_registration`, `backend/api/routes/members.py:404`) rather than inventing a parallel code path.

#### Schema (design, not yet implemented)

- `member_self_registration_settings` (singleton-per-club row, mirrors the `SystemSetting` pattern already used for `anonymize_after_unregistered_years`):
  - `enabled BOOLEAN`
  - `default_member_category SMALLINT`
  - `allowed_committee_uuids UUID[]` (or NULL = any active committee) — self-service committee choices offered
  - `accounting_template_uuid` / default `pricing_item_uuids` — which fare(s) a self-registration charges, reusing the existing pricing-item/accounting-template mechanism from `RegistrationCompletionRequest`
  - `external_form_url TEXT NULL` — when set, the "form to fill out" is a link to an external form (e.g. Google Forms/Typeform) shown either instead of or alongside the built-in fields; when NULL, only the built-in fixed field set is used
  - `auto_push_to_planche BOOLEAN` — see open question below

- `member_self_registration_requests`:
  - `uuid`, submitted identity/contact fields (mirrors `Member`'s identity fields), `requested_category`, `requested_committee_uuids`, `external_form_completed BOOLEAN` (self-attested, if `external_form_url` configured), `status` (`pending` / `approved` / `rejected`), `submitted_at`, `reviewed_by`, `reviewed_at`, `rejection_reason`, `created_member_uuid` (nullable, filled on approval)

#### Endpoints (design)

- `GET /api/v1/member-self-registration/config` — public, returns the active settings (category options, committee options, external form URL) needed to render the public form
- `POST /api/v1/member-self-registration/requests` — public, creates a `pending` request (rate-limited / captcha'd — see open question)
- `GET /api/v1/member-self-registration/requests` — admin list (`CAP_MANAGE_USERS`), filter by status
- `POST /api/v1/member-self-registration/requests/{uuid}/approve` — admin action: creates the `Member`, then delegates to the existing registration-completion service for the registration period + committee + accounting rows, using Phase 1's default end-date rule for the proposed period
- `POST /api/v1/member-self-registration/requests/{uuid}/reject`
- `PUT /api/v1/member-self-registration/settings` — admin config (`CAP_MANAGE_SYSTEM_SETTINGS` or `CAP_MANAGE_USERS`)

#### Frontend (design)

- New public route (outside the authenticated shell), e.g. `/join`, rendering the built-in form (or an embed/redirect to `external_form_url` when configured)
- Admin review queue page (pending requests → approve/reject), reusing `RegistrationPanel`-style fare/committee selection UI where possible
- Admin settings page for `member_self_registration_settings`

#### Open question to confirm before building

**Planche push trigger on approval.** Today, pushing members to Planche is a manual admin action (`POST /api/v1/planche/pilots/push`). For self-registration, should approval:
(a) leave it manual — the new member is simply included next time staff click "Push to Planche" (simplest, consistent with today's behavior), or
(b) auto-trigger a push for that one member right after approval?
Recommendation: (a) for v1 — no code path changes needed, lowest risk — revisit (b) once the manual flow's reliability in production is confirmed.

**Files (future build, not this pass)**: `backend/models.py`, new `docs/migrations/0XX_member_self_registration.sql`, `backend/schemas/member_self_registration.py`, `backend/services/member_self_registration.py`, `backend/api/routes/member_self_registration.py`, new `frontend/src/modules/member-self-registration/` module, `frontend/src/App.tsx` (public route), i18n files.

---

### Relevant Files (summary)

| File | Phase | Action |
|---|---|---|
| `backend/services/members.py` | 1, 2, 3 | Add `compute_default_registration_period`; extend `anonymize_inactive_members` with `member_uuids`; extend `_MEMBER_CATEGORY_MAP` |
| `backend/api/routes/members.py` | 1, 2 | Add default-period endpoint; extend anonymize-inactive request schema |
| `backend/schemas/members.py` | 1, 2 | New response/request schemas |
| `frontend/src/modules/members/components/RegistrationPanel.tsx` | 1 | Replace hardcoded Jan1/Dec31 default with server-proposed period |
| `frontend/src/modules/members/components/MemberAnonymizationPage.tsx` | 2 | New review screen |
| `frontend/src/modules/members/components/{MembersListPage,MemberFilterDrawer,MemberDirectoryTable,MemberKpiStrip}.tsx` | 3 | Per existing UX-split plan |
| `frontend/src/shell/navigation.ts`, `App.tsx` | 2, 3 | New routes/nav entries |
| `packages/i18n/src/resources/{fr,en}.ts` | 1, 2, 3 | New keys |
| (future) `backend/models.py`, new migration, `member_self_registration*` modules | 4 | Design only this pass |

---

### Verification Plan

1. **Phase 1**: Registration dialog proposes correct default `end_date`/`registered_for_year` across the Sep30/Oct1/Dec31/Jan1 boundaries; overrides still work; permanent categories still rejected.
2. **Phase 2**: Preview lists exactly the expected members for a given cutoff date; selective anonymize only affects chosen members; existing full-sweep call path unaffected.
3. **Phase 3**: Per `plan-membersUxSplitByCategoryGroup.prompt.md`'s own verification steps.
4. **Phase 4**: Design review only — no runtime verification in this pass.

---

### Decisions (Answered)

| Question | Decision |
|---|---|
| Keep suppliers in the members table? | Yes — one table, adopt the Core/External/Business UI split |
| End-date default rule basis | Chosen `start_date`, not today's date |
| Self-registration scope now | Design/spec only in this plan; build later |
| Anonymization review | Add manual preview + selective anonymize screen |

### Remaining Open Question

- Self-registration approval → Planche push: manual (recommended, no change needed) vs. automatic single-member push. Needs a decision before Phase 4 implementation begins.
