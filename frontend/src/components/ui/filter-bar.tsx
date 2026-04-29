/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: filter bar with filter chips, reset button, result count
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
import { Button } from './button'

interface FilterChipProps {
  label: string
  active: boolean
  onToggle: () => void
  className?: string
}

function FilterChip({ label, active, onToggle, className }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center rounded-shape-full border px-3 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active
          ? 'border-primary bg-primary text-on-primary'
          : 'border-outline bg-surface text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
        className,
      )}
    >
      {label}
    </button>
  )
}

interface FilterBarProps {
  chips?: FilterChipProps[]
  onReset?: () => void
  resultCount?: number
  /** Arbitrary filter controls (selects, inputs) rendered alongside chips */
  children?: React.ReactNode
  className?: string
}

function FilterBar({ chips, onReset, resultCount, children, className }: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {chips?.map((chip, i) => <FilterChip key={i} {...chip} />)}
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          Réinitialiser
        </Button>
      )}
      {resultCount !== undefined && (
        <span className="ml-auto text-xs text-on-surface-variant">
          {resultCount} résultat{resultCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

export { FilterBar, FilterChip }
export type { FilterBarProps, FilterChipProps }
