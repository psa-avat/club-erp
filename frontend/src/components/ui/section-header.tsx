/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: intra-page section header (shadcn style)
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

import { cn } from '@/lib/utils'

interface SectionHeaderProps {
  title: string
  supportingText?: string
  action?: React.ReactNode
  className?: string
}

function SectionHeader({ title, supportingText, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-4', className)}>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {supportingText && (
          <p className="mt-0.5 text-sm text-muted-foreground">{supportingText}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export { SectionHeader }
export type { SectionHeaderProps }
