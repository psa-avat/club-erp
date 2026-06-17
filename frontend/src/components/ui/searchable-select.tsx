/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: searchable select (combobox) for long option lists (accounts, members…)
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

interface SearchableSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value?: string
  onChange: (value: string) => void
  clearable?: boolean
  clearLabel?: string
  placeholder?: string
  searchPlaceholder?: string
  noResultsText?: string
  disabled?: boolean
  className?: string
  id?: string
}

function SearchableSelect({
  options,
  value,
  onChange,
  clearable = false,
  clearLabel = 'Clear selection',
  placeholder = 'Sélectionner…',
  searchPlaceholder = 'Rechercher…',
  noResultsText = 'Aucun résultat',
  disabled = false,
  className,
  id,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  // Close on outside click
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus search input when dropdown opens
  React.useEffect(() => {
    if (open) {
      const id = setTimeout(() => searchRef.current?.focus(), 10)
      return () => clearTimeout(id)
    }
  }, [open])

  // Reset active index when filtered options change
  React.useEffect(() => {
    setActiveIndex(0)
  }, [filtered.length])

  const close = () => { setOpen(false); setSearch(''); setActiveIndex(0) }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close()
      return
    }
    if (!open) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && filtered[activeIndex] && !filtered[activeIndex].disabled) {
      e.preventDefault()
      onChange(filtered[activeIndex].value)
      close()
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(filtered.length - 1)
    }
  }

  // Scroll active option into view
  React.useEffect(() => {
    if (!open || !listRef.current) return
    const activeEl = listRef.current.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${filtered[activeIndex].value}` : undefined}
        onClick={() => { if (!disabled) setOpen(v => !v) }}
        className={cn(
          'flex w-full items-center justify-between rounded-shape-sm border border-outline bg-surface px-3 py-2 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          selected ? 'text-on-surface' : 'text-on-surface-variant',
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <span className="ml-2 flex items-center gap-1">
          {clearable && selected && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={clearLabel}
              title={clearLabel}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onChange('')
                close()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange('')
                  close()
                }
              }}
              className="inline-flex h-4 w-4 items-center justify-center rounded text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z" clipRule="evenodd" />
              </svg>
            </span>
          ) : null}
          <svg
            aria-hidden="true"
            className={cn(
              'h-4 w-4 shrink-0 text-on-surface-variant transition-transform',
              open && 'rotate-180',
            )}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {/* Dropdown — fixed positioning to escape modal stacking contexts */}
      {open && containerRef.current && (
        <FixedDropdown
          containerRef={containerRef}
          id={id}
          search={search}
          searchRef={searchRef}
          onSearchChange={setSearch}
          searchPlaceholder={searchPlaceholder}
          filtered={filtered}
          listRef={listRef}
          activeIndex={activeIndex}
          noResultsText={noResultsText}
          value={value}
          onChange={onChange}
          onClose={close}
        />
      )}
    </div>
  )
}

// Fixed-position dropdown — renders outside any modal's stacking context
function FixedDropdown({
  containerRef,
  id,
  search,
  searchRef,
  onSearchChange,
  searchPlaceholder,
  filtered,
  listRef,
  activeIndex,
  noResultsText,
  value,
  onChange,
  onClose,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  id?: string
  search: string
  searchRef: React.RefObject<HTMLInputElement | null>
  onSearchChange: (v: string) => void
  searchPlaceholder: string
  filtered: { value: string; label: string; disabled?: boolean }[]
  listRef: React.RefObject<HTMLUListElement | null>
  activeIndex: number
  noResultsText: string
  value?: string
  onChange: (v: string) => void
  onClose: () => void
}) {
  const [style, setStyle] = React.useState<React.CSSProperties>({})

  // Calculate position relative to viewport
  React.useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setStyle({
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      zIndex: 9999,
    })
  }, [containerRef])

  // Focus search on mount
  React.useEffect(() => {
    const id = setTimeout(() => searchRef.current?.focus(), 10)
    return () => clearTimeout(id)
  }, [searchRef])

  return (
    <div
      role="listbox"
      id={`${id}-listbox`}
      style={style}
      className={cn(
        'flex flex-col rounded-shape-md border border-outline-variant bg-surface shadow-surface-3',
        'max-h-64 overflow-hidden',
      )}
    >
      {/* Search */}
      <div className="border-b border-outline-variant p-2">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className={cn(
            'w-full rounded-shape-sm border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface',
            'placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary',
          )}
        />
      </div>

      {/* Options */}
      <ul ref={listRef} className="overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-on-surface-variant">{noResultsText}</li>
        ) : (
          filtered.map((opt, index) => (
            <li
              key={opt.value}
              id={`${id}-option-${opt.value}`}
              role="option"
              data-option-index={index}
              aria-selected={opt.value === value}
              aria-disabled={opt.disabled}
              onClick={() => {
                if (!opt.disabled) {
                  onChange(opt.value)
                  onClose()
                }
              }}
              className={cn(
                'flex cursor-pointer items-center px-3 py-2 text-sm transition-colors',
                opt.value === value
                  ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface hover:bg-surface-container',
                    opt.disabled && 'cursor-not-allowed opacity-40',
                    index === activeIndex && 'bg-surface-container-high',
                  )}
                >
                  {/* Check mark for selected */}
                  <span className="mr-2 h-4 w-4 shrink-0">
                    {opt.value === value && (
                      <svg
                        aria-hidden="true"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        </div>
  )
}

export { SearchableSelect }
export type { SearchableSelectProps, SearchableSelectOption }
