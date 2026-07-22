/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: dismissible banner for success / info / warning / error feedback
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as React from 'react'

import { cn } from '../../lib/utils'

type BannerVariant = 'success' | 'info' | 'warning' | 'error'

const variantClasses: Record<BannerVariant, string> = {
  success: 'bg-success/15 border-success/30 text-success',
  info:    'bg-accent/15    border-accent/30    text-accent',
  warning: 'bg-warning/15 border-warning/30 text-warning',
  error:   'bg-destructive/15   border-destructive/30   text-destructive',
}

const variantIcons: Record<BannerVariant, string> = {
  success: '✓',
  info:    'ℹ',
  warning: '⚠',
  error:   '✕',
}

interface BannerProps {
  variant?: BannerVariant
  message: React.ReactNode
  onDismiss?: () => void
  className?: string
}

function Banner({ variant = 'info', message, onDismiss, className }: BannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 rounded-sm border px-4 py-3 text-sm',
        variantClasses[variant],
        className,
      )}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 font-bold">
        {variantIcons[variant]}
      </span>
      <div className="flex-1">{message}</div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Fermer"
          onClick={onDismiss}
          className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  )
}

export { Banner }
export type { BannerProps, BannerVariant }
