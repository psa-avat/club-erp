/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: KPI summary strip for the Members Directory page
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

import type { MemberSummary } from '../types'

type Props = {
  members: MemberSummary[]
  selectedYear: number
}

type KpiTileProps = {
  label: string
  value: number
  subLabel?: string
  highlight?: boolean
}

function KpiTile({ label, value, subLabel, highlight = false }: KpiTileProps) {
  return (
    <div className="rounded-shape-md border border-outline-variant bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className={['mt-1 text-2xl font-semibold tabular-nums', highlight ? 'text-orange-600' : 'text-on-surface'].join(' ')}>
        {value}
      </p>
      {subLabel ? <p className="mt-0.5 text-xs text-on-surface-variant">{subLabel}</p> : null}
    </div>
  )
}

/**
 * Displays four KPI tiles derived client-side from the current member list query result.
 * Values are recomputed whenever the members array changes.
 */
export function MemberKpiStrip({ members, selectedYear }: Props) {
  const total = members.length
  const isOperationallyActive = (status: number) => status === 1

  // Pending Renewals: active members whose registration_status is not yet Completed (3)
  // Proxy for last_registration_year < selectedYear until the list endpoint exposes that field.
  const pendingRenewals = members.filter((m) => isOperationallyActive(m.status) && m.registration_status !== 3).length

  const activeInstructors = members.filter((m) => m.is_instructor && isOperationallyActive(m.status)).length

  // Guest / Temp Passes: Temporary Member category (2)
  const guestTempPasses = members.filter((m) => m.member_category === 2).length

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiTile label="Total membres" value={total} />
      <KpiTile
        label="Renouvellements en attente"
        value={pendingRenewals}
        subLabel={`Avant fin ${selectedYear}`}
        highlight={pendingRenewals > 0}
      />
      <KpiTile label="Instructeurs actifs" value={activeInstructors} />
      <KpiTile label="Membres temporaires" value={guestTempPasses} />
    </div>
  )
}
