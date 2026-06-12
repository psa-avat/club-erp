/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - PageHeader: unified page-level header (shadcn style)
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
  /** Optional supporting text below the title (alias: description) */
  supportingText?: string
  /** Optional description text (Lovable compat) */
  description?: string
  /** Action buttons rendered on the right */
  actions?: React.ReactNode
  /** Breadcrumb trail */
  breadcrumb?: BreadcrumbItem[]
  className?: string
}

/**
 * PageHeader — unified page-level header (shadcn style).
 *
 * API rétrocompatible : accepte `supportingText` (ancien) et `description`
 * (Lovable). Affiche le breadcrumb, le titre, le texte secondaire et les actions.
 */
function PageHeader({ title, supportingText, description, actions, breadcrumb, className }: PageHeaderProps) {
  const desc = supportingText ?? description

  return (
    <div className={cn('mb-6 border-b pb-5', className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {breadcrumb.map((item, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span aria-hidden="true" className="select-none text-muted-foreground/50">/</span>}
              {item.href || item.onClick ? (
                <a
                  href={item.href}
                  onClick={item.onClick ? (e) => { e.preventDefault(); item.onClick?.() } : undefined}
                  className="cursor-pointer transition-colors hover:text-foreground"
                >
                  {item.label}
                </a>
              ) : (
                <span className="text-foreground">{item.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {desc && (
            <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}

PageHeader.displayName = 'PageHeader'

export { PageHeader }
