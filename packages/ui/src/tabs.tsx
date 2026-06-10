/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: accessible tab bar with keyboard navigation (Arrow keys) and animated indicator
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

import { cn } from './cn'

export interface TabItem {
  key: string
  label: string
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  activeKey: string
  onChange: (key: string) => void
  className?: string
}

/**
 * Tabs — accessible tab bar with keyboard navigation (Arrow keys, Home, End).
 *
 * @example
 *   <Tabs
 *     items={[{ key: 'a', label: 'Tab A' }, { key: 'b', label: 'Tab B' }]}
 *     activeKey={active}
 *     onChange={setActive}
 *   />
 */
function Tabs({ items, activeKey, onChange, className }: TabsProps) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const enabled = items.filter(t => !t.disabled)

  const focusTab = (key: string) => {
    ;(listRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`))?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent, key: string) => {
    const idx = enabled.findIndex(t => t.key === key)
    if (e.key === 'ArrowRight') {
      const next = enabled[(idx + 1) % enabled.length]
      onChange(next.key)
      focusTab(next.key)
    } else if (e.key === 'ArrowLeft') {
      const prev = enabled[(idx - 1 + enabled.length) % enabled.length]
      onChange(prev.key)
      focusTab(prev.key)
    } else if (e.key === 'Home') {
      onChange(enabled[0].key)
      focusTab(enabled[0].key)
    } else if (e.key === 'End') {
      onChange(enabled[enabled.length - 1].key)
      focusTab(enabled[enabled.length - 1].key)
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cn('flex gap-1 border-b border-outline-variant', className)}
    >
      {items.map(item => {
        const isActive = activeKey === item.key
        return (
          <button
            key={item.key}
            role="tab"
            data-key={item.key}
            aria-selected={isActive}
            disabled={item.disabled}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={e => handleKeyDown(e, item.key)}
            onClick={() => !item.disabled && onChange(item.key)}
            className={cn(
              'relative px-4 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:transition-colors',
              isActive
                ? 'text-on-surface after:bg-primary'
                : 'text-on-surface-variant hover:text-on-surface after:bg-transparent',
              item.disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export { Tabs }
