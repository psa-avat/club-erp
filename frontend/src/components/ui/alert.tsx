import * as React from 'react'

import { cn } from '../../lib/utils'

function Alert({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="alert"
      className={cn('rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700', className)}
      {...props}
    />
  )
}

export { Alert }
