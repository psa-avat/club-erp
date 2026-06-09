import * as React from 'react'

import { cn } from './cn'

interface SkeletonProps extends React.ComponentProps<'div'> {
  /** Skeleton shape variant */
  variant?: 'text' | 'circular' | 'rectangular'
}

/**
 * Skeleton — placeholder de chargement.
 * Affiche une animation de pulsation pour indiquer que le contenu est en cours de chargement.
 *
 * @example
 *   <Skeleton className="h-4 w-48" />           // line of text
 *   <Skeleton variant="circular" className="h-10 w-10" />  // avatar
 *   <Skeleton variant="rectangular" className="h-32 w-full" />  // card
 */
function Skeleton({ className, variant = 'text', ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-slate-200',
        variant === 'circular' && 'rounded-full',
        variant === 'text' && 'rounded-sm',
        variant === 'rectangular' && 'rounded-md',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
export type { SkeletonProps }
