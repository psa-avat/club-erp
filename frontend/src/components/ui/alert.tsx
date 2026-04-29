import * as React from 'react'

import { cn } from '../../lib/utils'

type AlertVariant = 'error' | 'success' | 'warning' | 'info'

const alertVariantClasses: Record<AlertVariant, string> = {
  error:   'border-error-container   bg-error-container   text-on-error-container',
  success: 'border-success-container bg-success-container text-on-success-container',
  warning: 'border-warning-container bg-warning-container text-on-warning-container',
  info:    'border-info-container    bg-info-container    text-on-info-container',
}

interface AlertProps extends React.ComponentProps<'div'> {
  variant?: AlertVariant
}

function Alert({ className, variant = 'error', ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn('rounded-shape-sm border px-4 py-3 text-sm', alertVariantClasses[variant], className)}
      {...props}
    />
  )
}

export { Alert }
export type { AlertVariant }
