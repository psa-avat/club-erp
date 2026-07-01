# In-App Documentation / Help Feature

## Context

Club ERP has no in-app help today. The only end-user documentation is `docs/manual/USER_GUIDE.md`
(French, well-structured by module) and a standalone `docs/GUIDE_VI.html` page for the VI module,
neither of which is linked from the application. As the module count has grown (17+ modules,
staff + member portal), users have no way to find "how does this screen work" without leaving the
app and hunting through the repo's `docs/` folder — which most users don't even have access to.

This plan adds a discoverable, module-aligned help system directly in the frontend: a global
entry point for search/browsing, plus contextual deep-links from within each module. Content is
authored once in Markdown and rendered to real HTML in the browser, reusing `USER_GUIDE.md` as the
migration source rather than starting from scratch or hand-writing HTML per module.

**Direct answers to the original questions:**
- **HTML format?** Yes as *rendered output* — author in Markdown, render client-side with
  `react-markdown` (produces real DOM/HTML elements, styled with the app's existing Tailwind/shadcn
  classes, dark-mode included for free). Hand-writing raw `.html` files like `GUIDE_VI.html` is not
  recommended: it forks content away from `USER_GUIDE.md`, needs its own CSS theme, and is an XSS
  risk if ever injected via `dangerouslySetInnerHTML`.
- **Global or per-module?** Both — this is the current standard (Linear/Notion/Stripe-dashboard
  style): a global "?" icon for discovery/browsing, plus contextual deep-links from each module's
  workspace into the same content. Not mutually exclusive, and doesn't require a bespoke help tab
  in all 17 modules on day one.

## Recommended Architecture

New module: `frontend/src/modules/help/`

```
frontend/src/modules/help/
  index.ts                    # public exports (route pages, HelpButton)
  pages/
    HelpCenterPage.tsx         # route: /help and /help/:moduleSlug — TOC + rendered content
  components/
    HelpButton.tsx             # "?" icon for AppHeader, navigates to /help
    HelpContent.tsx            # renders one module's markdown via react-markdown
    HelpToc.tsx                # section nav / anchor list
  content/
    moduleContentMap.ts        # slug -> dynamic import loader, with fr->en fallback
    fr/*.md                    # migrated content, one file per module (see mapping below)
    en/*.md                    # populated incrementally, may be empty in v1
  types.ts
```

**Routing** (`frontend/src/App.tsx`): register inside the existing `<ProtectedRoute><AppShell>`
block, same pattern as other routes:
```
<Route path="/help" element={<HelpCenterPage />} />
<Route path="/help/:moduleSlug" element={<HelpCenterPage />} />
```
Path param (not `?tab=`) because `?tab=` is reserved for sub-navigation *within* a single
workspace; help is a distinct top-level destination. Supports `#anchor` for sub-heading precision
(e.g. `/help/flights#packs`).

**Global entry point** (`frontend/src/shell/components/AppHeader.tsx`): add `HelpButton` next to
the existing notification bell, same `Button variant="ghost" size="icon"` pattern, `HelpCircle`
icon from `lucide-react` (already a dependency). Navigates to `/help` — a slide-in `Sheet` variant
is a reasonable fast-follow but adds state complexity for marginal v1 benefit.

**Member portal**: `PortalShell.tsx` is a fully separate shell/header/auth context from staff
`AppShell`/`AppHeader` (different authenticated principal). It needs its own small help entry point
next to the existing logout button, scoped to a portal-only content subset — see Capability
Gating below. Do not try to reuse the staff `/help` route for portal users.

**Per-module contextual access**: add an optional `helpSlug` prop to `WorkspaceShell`
(`frontend/src/components/ui/workspace-shell.tsx`) — renders a small "?" icon next to
`PageHeader` actions that links to `/help/:helpSlug`. Optional/additive, so it doesn't force every
module to opt in immediately. Wire into `FlightsWorkspacePage`, `MembersWorkspacePage`,
`ViWorkspacePage` first as the v1 proof; expand to remaining modules as fast-follow. Avoids
over-engineering a bespoke "Help" *tab* per `WorkspaceTab[]` array, which would need per-tab
content granularity the source docs don't have yet.

## Rendering & Sanitization

- **`react-markdown` + `remark-gfm`**. `react-markdown` renders to real React elements, not
  `dangerouslySetInnerHTML` — no HTML-string injection surface. `remark-gfm` is required because
  `USER_GUIDE.md` already uses GFM tables (e.g. capability matrices) that plain `react-markdown`
  won't parse without it.
- Custom component overrides per markdown element (`h2`, `table`, `a`, `code`) map to the app's
  existing Tailwind/shadcn typography classes — gives native dark-mode support for free, unlike
  `GUIDE_VI.html`'s fixed light-only CSS variables.
- Skip `rehype-raw` — don't embed literal HTML blocks; convert any HTML-only content (like
  `GUIDE_VI.html`) to markdown during migration instead, to avoid reopening the sanitization
  question later.
- New deps in `frontend/package.json`: `react-markdown`, `remark-gfm` (verify React 19 peer
  compatibility at implementation time).

## Content Migration

Split `USER_GUIDE.md` into one file per module, colocated under `frontend/src/modules/help/content/`
so Vite can bundle/code-split it via `?raw` imports + dynamic `import()` — each `/help/:slug` visit
only downloads that module's chunk, not all 18 sections.

**Mapping from `USER_GUIDE.md` sections to module slugs** (not 1:1 — resolve before migrating):

| USER_GUIDE.md section | Target slug | Note |
|---|---|---|
| §6 Membres | `members` | 1:1 |
| §7 Aéronefs & Équipements | `assets` | maps to `modules/assets` |
| §8 Vols | `flights` | |
| §9 Facturation des vols & Packs | `flights` (subsection) | app unifies this under `/workspace/flights?tab=packs` |
| §10 Vols d'Initiation (VI) | `vi` | **merge `docs/GUIDE_VI.html` content in here**, converted to markdown |
| §11 Comptabilité + §12 Banque + §13 Tarifs | `finance` (+ optional standalone `tarifs`) | module folder is `banque`, nav label is "Finance"; `/workspace/tarifs` has its own route — recommend `finance.md` for §11/§12, separate `tarifs.md` for §13 |
| §14 Portail Membre | `portal` | maps to `modules/member-portal`; portal-only content |
| §15 Intégrations externes | `admin` (subsection) or `integrations` | surfaced under `/admin?tab=parametres&subtab=...` today |
| §16 Administration système | `admin` | |
| §17 Tableau de bord | `dashboard` | |
| §18 FAQ | `faq` | standalone, linked from Help Center landing |
| §1-5 (Présentation, Rôles, Navigation) | Help Center landing intro | not module-specific |

Flag this mapping table as a checklist item at the top of the migration PR — the Comptabilité /
Banque / Tarifs split in particular needs a human decision, don't guess silently during migration.

`docs/GUIDE_VI.html` is retired/archived to `docs/archive/` once its content is folded into
`vi.md`. Other `docs/*.html` files (`flux_comptables.html`, `doc-deep.html`, etc.) are confirmed
AI-generated mockups, not end-user docs — out of scope, do not migrate.

**Canonical source after migration**: recommend `docs/manual/USER_GUIDE.md` either gets marked
superseded (with `docs/README.md` pointing readers at the new split-file location) or stays as a
periodically-regenerated concatenation for offline/non-technical readers — decide at
implementation time; do not let the content fork into two divergently-maintained copies.

## i18n

Long-form prose does not belong in `packages/i18n`'s short key→string resources. Instead:
- Content lives in locale-named directories (`content/fr/*.md`, `content/en/*.md`).
- `moduleContentMap.ts` resolves `(slug, locale)` and falls back to `fr` if the `en` file is
  missing, showing a short "not yet translated" banner (a real i18n key, `help.notTranslatedYet`,
  in a new `help` namespace in `packages/i18n/src/resources/{fr,en}.ts`).
- **v1 ships French-only content** with this fallback built and tested — translating ~15 files is
  a separate, larger effort than building the delivery mechanism. Track English translation
  per-module as fast-follow (highest-traffic modules first).
- UI chrome (page title, TOC labels, "not yet translated" banner) uses the new `help` namespace
  in both `fr.ts` and `en.ts` immediately, per the existing fr+en pairing convention.

## Search

Out of scope for v1. Content is modest (~659 lines split across ~13-15 files) — TOC/section
navigation (`HelpToc.tsx`, a simple anchor list) is sufficient to answer "where's help for module
X." Fast-follow: client-side `fuse.js` search over a small pre-built index (headings + first-N
words per section) — no backend/hosted search service needed given the content size.

## Capability / Role Gating

- **Staff help** (`/help`, reached via `AppHeader`): visible to all authenticated staff regardless
  of capability. Documentation isn't a security boundary — hiding it from someone who lacks a
  capability doesn't protect anything, and discoverability has value even for features a user
  can't yet access. Individual sections *may* be visually de-emphasized for modules the user's
  role doesn't touch (mirroring `navigation.ts`'s `requiredCapability` filtering), but this is a
  nice-to-have, not a v1 requirement.
- **Portal help**: member-portal users must never see staff-oriented sections (Comptabilité,
  Admin, RH, integrations). Implement as a separate, smaller content list reachable only from
  `PortalShell` (e.g. `/member-portal/help` or a Sheet), reusing the same `HelpContent` rendering
  primitive but a portal-scoped slug list — not capability-filtering the staff `/help` route, since
  portal auth is a fully separate principal that can't reach `AppShell`-gated routes anyway.

## Phased Rollout

**v1**
- `frontend/src/modules/help/` module: `HelpCenterPage`, `react-markdown` + `remark-gfm` rendering,
  TOC navigation, no search.
- Routes `/help`, `/help/:moduleSlug` in `App.tsx`.
- `HelpButton` in `AppHeader.tsx` (staff) + minimal equivalent in `PortalShell.tsx` (portal, scoped
  content).
- Content migrated for highest-traffic modules first: `members`, `flights` (incl. packs/billing),
  `vi` (incl. `GUIDE_VI.html` merge), `finance`, `dashboard`, `faq`. Remaining modules can ship
  with a "coming soon" placeholder (reuse existing `PlaceholderPage` pattern) if time-boxed.
- `helpSlug` wired into 2-3 `WorkspaceShell` usages (`flights`, `members`) as proof of the
  contextual-link pattern.
- French-only content with the fallback mechanism built and tested even though `en/` may be empty.
- New `help` i18n namespace for chrome strings, both languages.

**Fast-follow (v1.1+)**
- `fuse.js` search.
- English translation, module by module.
- Remaining modules' content + `helpSlug` wiring across all `WorkspaceShell` usages.
- Optional slide-in `HelpSheet` for quick lookups without a full page navigation.
- Decide/implement the `USER_GUIDE.md` ↔ split-content sync story once content stabilizes.

## Critical Files

- `frontend/src/App.tsx` — register `/help` and `/help/:moduleSlug` routes
- `frontend/src/shell/components/AppHeader.tsx` — add global `HelpButton`
- `frontend/src/modules/member-portal/components/PortalShell.tsx` — portal-scoped help entry point
- `frontend/src/components/ui/workspace-shell.tsx` — optional `helpSlug` prop for contextual links
- `docs/manual/USER_GUIDE.md` — migration source
- `docs/GUIDE_VI.html` — content to merge into `vi.md`, then archive
- `packages/i18n/src/resources/fr.ts` / `en.ts` — new `help` namespace for chrome strings
- `frontend/package.json` — add `react-markdown`, `remark-gfm`

## Verification

1. `pnpm --filter @club-erp/web build` — TypeScript compiles, Vite resolves `?raw` imports and new
   dynamic-import chunks, new deps are valid against installed React 19.
2. `pnpm --filter @club-erp/web lint`.
3. Manual check via `pnpm --filter @club-erp/web dev`:
   - Visit `/help` — TOC/landing renders, no console errors.
   - Visit `/help/members`, `/help/flights`, `/help/vi` — headings/tables/links render correctly,
     matches app theme in light and dark mode.
   - Click `HelpButton` in `AppHeader` — navigates to `/help`.
   - From a `WorkspaceShell` with `helpSlug` wired, click the contextual "?" — deep-links to the
     right `/help/:slug`.
   - Switch language to English while viewing a help page — "not yet translated" fallback banner
     appears instead of a blank/broken page.
   - Log in as a member-portal user — portal help shows only portal-relevant content; staff-only
     sections are unreachable.
   - Log in as a low-privilege staff user — Help Center still renders without crashing.
4. Confirm new `help` namespace keys exist in both `fr.ts` and `en.ts` — a missing key shows raw
   key text, catch this visually in step 3.
5. Content spot-check: diff each migrated file's rendered output against its `USER_GUIDE.md`
   section — confirm GFM tables (e.g. capability matrices) render as tables, not garbled text.
