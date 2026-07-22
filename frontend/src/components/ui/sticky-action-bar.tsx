/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: sticky action bar — fixed bottom on mobile, inline on desktop
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

interface StickyActionBarProps {
  children: React.ReactNode
  className?: string
}

function StickyActionBar({ children, className }: StickyActionBarProps) {
  return (
    <div
      className={cn(
        // Mobile: fixed bottom strip
        'fixed bottom-0 left-0 right-0 z-30 flex items-center justify-end gap-2',
        'border-t border-border bg-card px-4 py-3 shadow-surface-3',
        // Desktop: static inline row (no fixed positioning)
        'md:static md:z-auto md:border-0 md:bg-transparent md:px-0 md:py-0 md:shadow-none',
        className,
      )}
    >
      {children}
    </div>
  )
}

export { StickyActionBar }
export type { StickyActionBarProps }
