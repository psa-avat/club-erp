/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - PageHeader: unified page-level header with breadcrumbs, title, supporting text, and actions
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

export interface BreadcrumbItem {
  label: string
  href?: string
  onClick?: () => void
}

export interface PageHeaderProps {
  /** Page title */
  title: string
  /** Optional supporting text below the title */
  supportingText?: string
  /** Action buttons rendered on the right */
  actions?: React.ReactNode
  /** Breadcrumb trail */
  breadcrumb?: BreadcrumbItem[]
  className?: string
}

/**
 * PageHeader — unified page-level header.
 *
 * Provides a consistent layout for breadcrumbs, title, supporting text,
 * and action buttons across all ERP and Portal pages.
 *
 * @example
 *   <PageHeader
 *     title="Members Directory"
 *     supportingText="View and manage all club members"
 *     breadcrumb={[{ label: 'Members', href: '/club/members' }, { label: 'Directory' }]}
 *     actions={<Button>Add Member</Button>}
 *   />
 */
function PageHeader({ title, supportingText, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-on-surface-variant">
          {breadcrumb.map((item, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span aria-hidden="true" className="select-none">/</span>}
              {item.href || item.onClick ? (
                <a
                  href={item.href}
                  onClick={item.onClick ? (e) => { e.preventDefault(); item.onClick?.() } : undefined}
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

PageHeader.displayName = 'PageHeader'

export { PageHeader }
