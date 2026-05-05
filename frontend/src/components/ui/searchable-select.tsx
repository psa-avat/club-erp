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
  placeholder = 'Sélectionner…',
  searchPlaceholder = 'Rechercher…',
  noResultsText = 'Aucun résultat',
  disabled = false,
  className,
  id,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const containerRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)

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

  const close = () => { setOpen(false); setSearch('') }

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onKeyDown={e => { if (e.key === 'Escape') close() }}
    >
      {/* Trigger */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (!disabled) setOpen(v => !v) }}
        className={cn(
          'flex w-full items-center justify-between rounded-shape-sm border border-outline bg-surface px-3 py-2 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          selected ? 'text-on-surface' : 'text-on-surface-variant',
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <svg
          aria-hidden="true"
          className={cn(
            'ml-2 h-4 w-4 shrink-0 text-on-surface-variant transition-transform',
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
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute z-50 mt-1 flex w-full flex-col rounded-shape-md border border-outline-variant bg-surface shadow-surface-3',
            'max-h-64 overflow-hidden',
          )}
        >
          {/* Search */}
          <div className="border-b border-outline-variant p-2">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className={cn(
                'w-full rounded-shape-sm border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface',
                'placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary',
              )}
            />
          </div>

          {/* Options */}
          <ul className="overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-on-surface-variant">{noResultsText}</li>
            ) : (
              filtered.map(opt => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  aria-disabled={opt.disabled}
                  onClick={() => {
                    if (!opt.disabled) {
                      onChange(opt.value)
                      close()
                    }
                  }}
                  className={cn(
                    'flex cursor-pointer items-center px-3 py-2 text-sm transition-colors',
                    opt.value === value
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface hover:bg-surface-container',
                    opt.disabled && 'cursor-not-allowed opacity-40',
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
      )}
    </div>
  )
}

export { SearchableSelect }
export type { SearchableSelectProps, SearchableSelectOption }
