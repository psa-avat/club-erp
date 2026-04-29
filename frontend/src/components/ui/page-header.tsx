/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: page-level header with title, supporting text, actions, breadcrumb
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

interface BreadcrumbItem {
  label: string
  href?: string
  onClick?: () => void
}

interface PageHeaderProps {
  title: string
  supportingText?: string
  actions?: React.ReactNode
  breadcrumb?: BreadcrumbItem[]
  className?: string
}

function PageHeader({ title, supportingText, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Fil d'Ariane" className="mb-1 flex items-center gap-1 text-xs text-on-surface-variant">
          {breadcrumb.map((item, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span aria-hidden="true" className="select-none">/</span>}
              {item.href || item.onClick ? (
                <a
                  href={item.href}
                  onClick={item.onClick}
                  className="cursor-pointer transition-colors hover:text-on-surface"
                >
                  {item.label}
                </a>
              ) : (
                <span className="text-on-surface">{item.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-on-surface">{title}</h1>
          {supportingText && (
            <p className="mt-0.5 text-sm text-on-surface-variant">{supportingText}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}

export { PageHeader }
export type { PageHeaderProps, BreadcrumbItem }
