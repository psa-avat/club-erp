import * as React from 'react'

import { cn } from './cn'

interface EmptyStateProps extends React.ComponentProps<'div'> {
  /** Icon component (lucide-react or any) */
  icon?: React.ReactNode
  /** Primary message */
  title: string
  /** Secondary description */
  description?: string
  /** Optional call-to-action */
  action?: React.ReactNode
}

/**
 * EmptyState — affiché quand une liste ou une vue ne contient aucune donnée.
 *
 * @example
 *   <EmptyState
 *     icon={<InboxIcon className="h-8 w-8" />}
 *     title="Aucun vol trouvé"
 *     description="Modifiez vos filtres pour voir plus de résultats."
 *     action={<Button onClick={resetFilters}>Réinitialiser les filtres</Button>}
 *   />
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="text-slate-400">{icon}</div>
      ) : (
        <svg
          className="h-10 w-10 text-slate-300"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
          />
        </svg>
      )}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {description && (
          <p className="text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
