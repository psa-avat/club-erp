/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: sortable data table with row actions and empty state support
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

type SortDir = 'asc' | 'desc'

interface ColumnDef<T> {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  sortable?: boolean
  className?: string
  headerClassName?: string
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  getRowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  actions?: (row: T) => React.ReactNode
  defaultSortKey?: string
  defaultSortDir?: SortDir
  className?: string
  emptyState?: React.ReactNode
}

function DataTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  actions,
  defaultSortKey,
  defaultSortDir = 'asc',
  className,
  emptyState,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | undefined>(defaultSortKey)
  const [sortDir, setSortDir] = React.useState<SortDir>(defaultSortDir)

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-outline-variant">
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                aria-sort={
                  col.sortable
                    ? sortKey === col.key
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                    : undefined
                }
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                className={cn(
                  'px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-on-surface-variant',
                  col.sortable && 'cursor-pointer select-none hover:text-on-surface',
                  col.headerClassName,
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    <svg
                      aria-hidden="true"
                      className={cn(
                        'h-3 w-3 transition-transform',
                        sortDir === 'desc' && 'rotate-180',
                      )}
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 5a.75.75 0 01.75.75v6.638l1.96-2.158a.75.75 0 111.08 1.04l-3.25 3.5a.75.75 0 01-1.08 0l-3.25-3.5a.75.75 0 111.08-1.04l1.96 2.158V5.75A.75.75 0 0110 5z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </span>
              </th>
            ))}
            {actions && (
              <th scope="col" className="w-12 px-3 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-outline-variant last:border-0',
                onRowClick && 'cursor-pointer transition-colors hover:bg-surface-container',
              )}
            >
              {columns.map(col => (
                <td key={col.key} className={cn('px-3 py-3 text-on-surface', col.className)}>
                  {col.cell(row)}
                </td>
              ))}
              {actions && (
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1">{actions(row)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { DataTable }
export type { DataTableProps, ColumnDef, SortDir }
