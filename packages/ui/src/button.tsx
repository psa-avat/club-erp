import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from './cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-shape-sm text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-primary text-on-primary hover:bg-primary-hover focus-visible:ring-primary',
        secondary: 'bg-surface-container text-on-surface hover:bg-surface-container-high focus-visible:ring-outline',
        ghost: 'text-on-surface-variant hover:bg-surface-container focus-visible:ring-outline',
        destructive: 'bg-error text-on-error hover:bg-error-hover focus-visible:ring-error',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: VariantProps<typeof buttonVariants>['variant']
  size?: VariantProps<typeof buttonVariants>['size']
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button }
