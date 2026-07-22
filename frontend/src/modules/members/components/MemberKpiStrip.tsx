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

import { useTranslation } from 'react-i18next'

import type { MemberSummary, MembersScreen } from '../types'

type Props = {
  members: MemberSummary[]
  selectedYear: number
  screen: MembersScreen
}

type KpiTileProps = {
  label: string
  value: number
  subLabel?: string
  highlight?: boolean
}

type KpiItem = {
  label: string
  value: number
  subLabel?: string
  highlight?: boolean
}

function KpiTile({ label, value, subLabel, highlight = false }: KpiTileProps) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={['mt-1 text-2xl font-semibold tabular-nums', highlight ? 'text-orange-600' : 'text-foreground'].join(' ')}>
        {value}
      </p>
      {subLabel ? <p className="mt-0.5 text-xs text-muted-foreground">{subLabel}</p> : null}
    </div>
  )
}

function isOperationallyActive(member: MemberSummary): boolean {
  return member.status === 1
}

function countMembers(members: MemberSummary[], predicate: (member: MemberSummary) => boolean): number {
  return members.filter(predicate).length
}

function getKpisForScreen(
  members: MemberSummary[],
  screen: MembersScreen,
  t: (key: string) => string,
): KpiItem[] {
  const total = members.length

  if (screen === 'core') {
    return [
      { label: t('kpiStrip.core.totalMembers'), value: total },
      {
        label: t('kpiStrip.core.activeMembers'),
        value: countMembers(members, (member) => isOperationallyActive(member)),
      },
      {
        label: t('kpiStrip.core.membersCanFly'),
        value: countMembers(members, (member) => member.can_fly && isOperationallyActive(member)),
      },
      {
        label: t('kpiStrip.core.activeInstructors'),
        value: countMembers(members, (member) => member.is_instructor && isOperationallyActive(member)),
      },
      {
        label: t('kpiStrip.core.activeVolunteers'),
        value: countMembers(members, (member) => member.member_category === 6 && isOperationallyActive(member)),
      },
    ]
  }

  if (screen === 'external') {
    return [
      { label: t('kpiStrip.external.totalExternal'), value: total },
      {
        label: t('kpiStrip.external.externalPilots'),
        value: countMembers(members, (member) => member.member_category === 5),
      },
      {
        label: t('kpiStrip.external.partnerOrganizations'),
        value: countMembers(members, (member) => member.member_category === 7),
      },
      {
        label: t('kpiStrip.external.activeExternal'),
        value: countMembers(members, (member) => isOperationallyActive(member)),
      },
    ]
  }

  return [
    { label: t('kpiStrip.business.businessContacts'), value: total },
    {
      label: t('kpiStrip.business.active'),
      value: countMembers(members, (member) => isOperationallyActive(member)),
    },
    {
      label: t('kpiStrip.business.inactive'),
      value: countMembers(members, (member) => !isOperationallyActive(member)),
    },
    {
      label: t('kpiStrip.business.withEmail'),
      value: countMembers(members, (member) => Boolean(member.email?.trim())),
    },
  ]
}

/**
 * Displays screen-specific KPI tiles derived client-side from the current member list query result.
 * Values are recomputed whenever the members array changes.
 */
export function MemberKpiStrip({ members, selectedYear: _selectedYear, screen }: Props) {
  const { t } = useTranslation('members')
  const kpis = getKpisForScreen(members, screen, t)

  return (
    <div
      className={[
        'grid grid-cols-2 gap-3',
        screen === 'core' ? 'md:grid-cols-5' : 'md:grid-cols-4',
      ].join(' ')}
    >
      {kpis.map((kpi) => (
        <KpiTile key={kpi.label} label={kpi.label} value={kpi.value} subLabel={kpi.subLabel} highlight={kpi.highlight} />
      ))}
    </div>
  )
}
