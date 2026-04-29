/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: list item primitive for browse lists (leading, headline, supporting, trailing)
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

interface ListItemProps {
  leading?: React.ReactNode
  headline: React.ReactNode
  supporting?: React.ReactNode
  trailing?: React.ReactNode
  onClick?: () => void
  className?: string
  as?: 'li' | 'div'
}

function ListItem({
  leading,
  headline,
  supporting,
  trailing,
  onClick,
  className,
  as: Tag = 'div',
}: ListItemProps) {
  return (
    <Tag
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        'flex items-center gap-3 px-4 py-3 text-sm',
        onClick &&
          'cursor-pointer transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
        className,
      )}
    >
      {leading && <div className="shrink-0 text-on-surface-variant">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-on-surface">{headline}</div>
        {supporting && (
          <div className="mt-0.5 truncate text-xs text-on-surface-variant">{supporting}</div>
        )}
      </div>
      {trailing && <div className="shrink-0 text-on-surface-variant">{trailing}</div>}
    </Tag>
  )
}

export { ListItem }
export type { ListItemProps }
