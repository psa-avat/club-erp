/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: segmented button for 2-4 exclusive options (replaces custom pill selectors)
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

import { cn } from '../../lib/utils'

interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

interface SegmentedButtonProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

function SegmentedButton<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedButtonProps<T>) {
  return (
    <div
      role="radiogroup"
      className={cn('inline-flex overflow-hidden rounded-sm border border-border', className)}
    >
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          disabled={opt.disabled}
          onClick={() => !opt.disabled && onChange(opt.value)}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
            i > 0 && 'border-l border-border',
            value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
            opt.disabled && 'cursor-not-allowed opacity-40',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export { SegmentedButton }
export type { SegmentedButtonProps, SegmentedOption }
