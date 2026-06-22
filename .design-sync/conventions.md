# Club ERP Design System — Conventions

## Stack

- **React 19** + **TypeScript** — all components are TSX
- **Tailwind CSS v4** — utility classes; no runtime CSS-in-JS
- **shadcn/ui + Radix primitives** — components are thin wrappers over Radix
- **OKLCH color tokens** — defined as CSS custom properties in `src/index.css`
- **`cn()` utility** — always use `cn(baseClasses, conditional, className)` to merge classes; never raw string concatenation
- **`lucide-react`** for icons

## Color tokens (from `src/index.css`)

All colors are OKLCH-based CSS variables. Use these Tailwind utility names — **do not** use Material Design token names (`text-on-primary`, `bg-surface`, etc.):

| Role | Tailwind class |
|---|---|
| Page background | `bg-background` |
| Card / panel fill | `bg-card` |
| Muted / subtle fill | `bg-muted` |
| Primary action fill | `bg-primary` |
| Destructive action fill | `bg-destructive` |
| Success fill | `bg-success` |
| Warning fill | `bg-warning` |
| Default text | `text-foreground` |
| Secondary text | `text-muted-foreground` |
| Text on primary bg | `text-primary-foreground` |
| Text on card | `text-card-foreground` |
| Border default | `border-border` |
| Input outline | `border-input` |
| Focus ring | `ring-ring` |

## Typography

- Body / UI font: **Inter** (400, 500, 600, 700)
- Monospace: **JetBrains Mono** (400, 500, 700)
- Loaded via `@fontsource/inter` and `@fontsource/jetbrains-mono`

## Spacing, radius, and layout

- Border radius tokens: `rounded-sm` (`--radius-sm`), `rounded-md` (`--radius-md`), `rounded-lg` (`--radius-lg`), `rounded-xl` (`--radius-xl`)
- Avoid hard-coded `px` spacings; prefer Tailwind scale (`gap-4`, `p-6`, etc.)
- Workspace pages use `WorkspaceShell` + `PageHeader` — no `max-w-7xl` cap, full width

## Component patterns

### Provider requirement

All components must render inside `ThemeProvider` (for CSS variables) and `SonnerToaster` (for toasts). In designs, wrap in the provided shell that includes both.

### Composition model

Components accept a `className` prop and merge it with `cn()`. Internal sub-elements are exposed via sub-components (e.g. `Card`, `CardHeader`, `CardContent`, `CardFooter`) not props.

### Status badges

Use the `Badge` component with these variant-like classes:
- Success → `badge-success`
- Warning → `badge-warning`
- Error/Destructive → `badge-destructive`
- Info → `badge-info`

### Dialogs and sheets

- `Dialog` — small forms, confirmations (modal, centered)
- `Sheet` — large/complex forms (slides from the side)
- `AlertDialog` — destructive confirmations (requires explicit confirm button)

### Data tables

Use the `DataTable` composition pattern. Do not add header/filter props directly to the table component.

### Toasts

`import { toast } from 'sonner'` — use `toast.success`, `toast.error`, `toast.loading`.

## Financial / numeric values

Always use `decimal.js` (`Decimal`) for money, prices, account balances, and any threshold comparisons. **Never use JavaScript floating-point arithmetic** for financial values.

## i18n

All user-facing text must go through `react-i18next`. French (`fr.ts`) and English (`en.ts`) translations live in `packages/i18n/src/resources/`. Use `useTranslation('namespace')` in components.

## Module structure

Feature code lives in `frontend/src/modules/<module-name>/`. Each module exposes its public surface through `index.ts`. Internal structure: `api/`, `components/`, `types/`, occasionally `store/`. Import within the app using the `@/` alias (`@/modules/…`, `@/components/ui/…`).
