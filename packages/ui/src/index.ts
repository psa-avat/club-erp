/**
 * @club-erp/ui — Design system partagé ERP Club + Portail Membre
 *
 * Exports :
 *   - Skeleton       → placeholder de chargement (pulse animation)
 *   - ErrorBoundary  → capture d'erreurs React avec fallback UI
 *   - EmptyState     → vue vide avec titre, description et CTA
 *   - cn             → utilitaire de fusion de classes Tailwind
 *
 * Tokens CSS accessibles via : @import "@club-erp/ui/tokens.css"
 */

export { Skeleton } from './Skeleton'
export type { SkeletonProps } from './Skeleton'

export { ErrorBoundary } from './ErrorBoundary'

export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { cn } from './cn'

