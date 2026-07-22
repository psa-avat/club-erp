## Plan: Members UX Split By Category Group

Split the Members experience into 3 dedicated screens (Core, External, Business) while keeping one members table and existing backend APIs. This reduces user confusion without schema migration by using category-based filters and route-level context.

**Steps**
1. Phase 1: Routing and screen model
1. Add route context for screen group on Members list page (Core, External, Business).
2. Keep one shared list page/component and drive data by category group mapping.
3. Set default entry route to Core.
4. Ensure deep-linking and browser navigation preserve selected screen and filters.

2. Phase 2: Category group mapping and query wiring
1. Define frontend-only group mapping:
: Core = categories 1, 2, 3, 4, 6
: External = categories  5, 7
: Business = category 8
2. Update list query strategy so each screen fetches only its mapped categories.
3. Preserve single-member create/edit/detail routes and payload model.
4. Keep backend unchanged unless multi-category filtering endpoint is needed for performance.

3. Phase 3: Screen-specific list and filters
1. Reuse existing members table and filter drawer with per-screen defaults.
2. Hide irrelevant category choices inside each screen context (or lock by group).
3. Keep shared search/status/capability filters consistent across all screens.
4. Add contextual subtitle/help text per screen to explain intended records.

4. Phase 4: KPI strip specialization
1. Refactor KPI strip to accept current screen group and compute relevant indicators.
2. Core KPIs: active members, can-fly, instructors, volunteers.
3. External KPIs: temporary, external pilots, partner organizations.
4. Business KPIs: supplier/client entities and optional activity marker.

5. Phase 5: Workflow guards and UX consistency
1. Disable/hide registration workflow actions in Business screen.
2. Keep registration flow active for Core and configurable for External.
3. Validate that actions exposed in each screen align with business intent.

6. Phase 6: CSV import and category integrity
1. Extend backend CSV category mapping to include category 8 aliases if missing.
2. Update import error messages/documentation to reflect all 8 categories.
3. Verify imported records appear in the correct screen group.

7. Phase 7: QA and rollout
1. Add tests for route-to-category mapping, filter behavior, and KPI counts.
2. Add tests for registration action visibility rules by screen.
3. Perform UX validation with staff: find/create/edit/register tasks across all 3 screens.
4. Roll out with release note and quick in-app guidance.

**Relevant files**
- `/home/erpadmin/club-erp/frontend/src/modules/members/components/MembersListPage.tsx` — add screen-aware routing context and group-based query/filter wiring.
- `/home/erpadmin/club-erp/frontend/src/modules/members/components/MemberFilterDrawer.tsx` — adapt filter controls per screen context.
- `/home/erpadmin/club-erp/frontend/src/modules/members/components/MemberDirectoryTable.tsx` — keep shared table but tune labels/badges for grouped screens.
- `/home/erpadmin/club-erp/frontend/src/modules/members/components/MemberKpiStrip.tsx` — refactor to compute KPIs by screen group.
- `/home/erpadmin/club-erp/frontend/src/modules/members/store/index.ts` — store selected screen and synchronized filter defaults.
- `/home/erpadmin/club-erp/frontend/src/modules/members/components/membersShared.tsx` — centralize category-group helper mapping and labels.
- `/home/erpadmin/club-erp/frontend/src/modules/members/index.ts` (and route declarations in shell/router files) — register new list routes and Core default redirect.
- `/home/erpadmin/club-erp/backend/services/members.py` — update `_MEMBER_CATEGORY_MAP` for category 8 import aliases.
- `/home/erpadmin/club-erp/packages/i18n/src/resources/fr.ts` — add/adjust labels for Core/External/Business screens and helper text.
- `/home/erpadmin/club-erp/packages/i18n/src/resources/en.ts` — add/adjust labels for Core/External/Business screens and helper text.

**Verification**
1. Navigate to each screen directly by URL and confirm correct dataset segregation.
2. Confirm filter interactions never leak categories outside the current screen group.
3. Verify Business screen does not present annual registration workflow actions.
4. Validate KPI totals against raw category counts for each screen.
5. Import CSV rows for categories including 8 and confirm placement in the right screen.
6. Run frontend diagnostics/tests and backend tests for import mapping.

**Decisions**
- User-approved split: 3 screens.
- User-approved default landing: Core.
- Keep one physical members table and existing domain models.
- Preserve existing create/edit/detail forms to avoid duplicate maintenance.

**Further Considerations**
1. Decide whether External screen should allow registration completion for category 7 (organizations) or only categories 2/5.
2. Choose between tabbed navigation under one base route vs. explicit three-route sidebar entries.
3. Consider a read-only “All members” admin view for audit/search across all groups.