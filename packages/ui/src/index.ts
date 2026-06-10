/**
 * @club-erp/ui — Design system partagé ERP Club + Portail Membre
 *
 * Exports :
 *   - Skeleton          → placeholder de chargement (pulse animation)
 *   - ErrorBoundary     → capture d'erreurs React avec fallback UI
 *   - EmptyState        → vue vide avec titre, description et CTA
 *   - cn                → utilitaire de fusion de classes Tailwind
 *   - Button            → bouton avec variantes (default, secondary, ghost, destructive)
 *   - Alert             → alertes avec variantes (error, success, warning, info)
 *
 * Tokens CSS accessibles via : @import "@club-erp/ui/tokens.css"
 */

export { Skeleton } from './Skeleton'
export type { SkeletonProps } from './Skeleton'

export { ErrorBoundary } from './ErrorBoundary'

export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { Button } from './button'
export type { ButtonProps } from './button'

export { Alert } from './alert'
export type { AlertVariant } from './alert'

export { cn } from './cn'
