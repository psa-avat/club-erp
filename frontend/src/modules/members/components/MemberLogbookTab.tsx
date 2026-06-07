/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Logbook tab — flight history with billing status for club and portal
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
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'

import { Input } from '../../../components/ui/input'
import { DataTable } from '../../../components/ui/data-table'
import type { ColumnDef } from '../../../components/ui/data-table'
import { useMemberLogbookQuery } from '../api'
import { useMemberPortalLogbookQuery } from '../../member-portal/api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import type { LogbookItem, LogbookFilters } from '../types'
import type { WorkspaceMode } from '../types/workspace'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h${m.toString().padStart(2, '0')}`
}

function billingStateBadge(state: string | null, t: (key: string) => string): { label: string; class: string } {
  switch (state) {
    case 'pending':
      return { label: t('statePending'), class: 'bg-slate-100 text-slate-700' }
    case 'applied':
      return { label: t('stateDraft'), class: 'bg-amber-100 text-amber-800' }
    case 'posted':
      return { label: t('statePosted'), class: 'bg-emerald-100 text-emerald-800' }
    default:
      return { label: state ?? '—', class: 'bg-slate-100 text-slate-500' }
  }
}

function formatMoney(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return amount
  return numeric.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function roleLabel(role: string | null, t: (key: string) => string): string {
  switch (role) {
    case 'pilot': return t('logbookPilot')
    case 'second_pilot': return t('logbookInstructorShort')
    case 'pilot_and_second': return t('logbookPilotAndInstructor')
    default: return '—'
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MemberLogbookTabProps {
  memberUuid: string
  mode: WorkspaceMode
}

// ---------------------------------------------------------------------------
// Expandable row content
// ---------------------------------------------------------------------------

function ExpandedRowContent({ flight, t }: { flight: LogbookItem; t: (key: string) => string }) {
  return (
    <div className="space-y-3 bg-slate-50 p-4">
      {/* Flight details */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
        <div>
          <span className="font-medium text-slate-500">{t('logbookTakeoff')} :</span>{' '}
          <span className="text-slate-800">{flight.takeoff_time ?? '—'}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">{t('logbookLanding')} :</span>{' '}
          <span className="text-slate-800">{flight.landing_time ?? '—'}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">{t('logbookDurationLabel')} :</span>{' '}
          <span className="text-slate-800">{formatMinutes(flight.duration_minutes)}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">{t('logbookDistanceLabel')} :</span>{' '}
          <span className="text-slate-800">{flight.flight_km != null ? `${flight.flight_km} km` : '—'}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">{t('logbookEngineTime')} :</span>{' '}
          <span className="text-slate-800">{flight.engine_time != null ? `${flight.engine_time} h` : '—'}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">{t('logbookLaunchLabel')} :</span>{' '}
          <span className="text-slate-800">{flight.launch_label ?? `type ${flight.launch_method}`}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">{t('logbookSecondPilot')} :</span>{' '}
          <span className="text-slate-800">{flight.second_pilot_name ?? '—'}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">{t('logbookGrossAmount')} :</span>{' '}
          <span className="text-slate-800">{formatMoney(flight.gross_amount)} €</span>
        </div>
      </div>

      {/* Errors */}
      {flight.errors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {flight.errors.map((err, i) => (<p key={i}>⚠ {err}</p>))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MemberLogbookTab
// ---------------------------------------------------------------------------

export function MemberLogbookTab({ memberUuid, mode }: MemberLogbookTabProps) {
  const navigate = useNavigate()  ; const { t } = useTranslation('common');  const { activeFiscalYearData } = useFiscalYearStore()
  const fy = activeFiscalYearData

  const [dateFrom, setDateFrom] = useState(fy?.start_date ?? '')
  const [dateTo, setDateTo] = useState(fy?.end_date ?? '')
  const [expandedPilot, setExpandedPilot] = useState<string | null>(null)
  const [expandedInstructor, setExpandedInstructor] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<'machine' | 'type' | 'launch' | ''>('')

  // Sync date inputs when fiscal year changes
  useEffect(() => {
    if (fy?.start_date && !dateFrom) setDateFrom(fy.start_date)
    if (fy?.end_date && !dateTo) setDateTo(fy.end_date)
  }, [fy?.start_date, fy?.end_date])

  const filters: LogbookFilters = {
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
    ...(groupBy && { group_by: groupBy }),
  }

  const clubQuery = useMemberLogbookQuery(memberUuid, filters)
  const portalQuery = useMemberPortalLogbookQuery(filters, mode === 'portal')
  const { data } = mode === 'portal' ? portalQuery : clubQuery

  const flights = data?.items ?? []
  const summary = data?.summary
  const grouped = data?.grouped ?? []

  // Split flights: instructor (second_pilot) vs pilot/other
  const instructorFlights = flights.filter((f) => f.role === 'second_pilot')
  const otherFlights = flights.filter((f) => f.role !== 'second_pilot')

  function makeColumns(
    expanded: string | null,
    onToggle: (uuid: string) => void,
  ): ColumnDef<LogbookItem>[] {
    return [
    {
      key: 'expand',
      header: '',
      className: 'w-8',
      cell: (row) => (
        <button
          type="button"
          onClick={() => onToggle(row.flight_uuid)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          {expanded === row.flight_uuid ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      ),
    },
    {
      key: 'date',
      header: t('logbookDate'),
      sortable: true,
      className: 'min-w-[100px]',
      cell: (row) => <span className="text-sm text-slate-800">{formatDate(row.flight_date)}</span>,
    },
    {
      key: 'machine',
      header: t('logbookMachine'),
      className: 'min-w-[100px]',
      cell: (row) => <span className="text-sm font-medium text-slate-800">{row.asset_code ?? '—'}</span>,
    },
    {
      key: 'type',
      header: t('logbookType'),
      className: 'min-w-[100px]',
      cell: (row) => <span className="text-sm text-slate-700">{row.type_label ?? `type ${row.type_of_flight}`}</span>,
    },
    {
      key: 'role',
      header: t('logbookRole'),
      className: 'min-w-[90px]',
      cell: (row) => <span className="text-sm text-slate-700">{roleLabel(row.role, t)}</span>,
    },
    {
      key: 'duration',
      header: t('logbookDurationLabel'),
      className: 'min-w-[80px] text-right',
      cell: (row) => <span className="text-sm text-slate-700">{formatMinutes(row.duration_minutes)}</span>,
    },
    {
      key: 'pilot',
      header: t('logbookPilot'),
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell min-w-[120px]',
      cell: (row) => <span className="text-sm text-slate-700">{row.pilot_name ?? '—'}</span>,
    },
    {
      key: 'status',
      header: t('logbookBilling'),
      className: 'min-w-[120px]',
      cell: (row) => {
        const badge = billingStateBadge(row.billing_quote_state, t)
        return (
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.class}`}>
              {badge.label}
            </span>
            {row.has_discount && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700" title={t('logbookPackDiscount')}>
                🔵 Pack
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'amount',
      header: t('logbookAmount'),
      className: 'min-w-[100px] text-right',
      cell: (row) => (
        <span className={`text-sm font-medium ${Number(row.gross_amount) > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
          {formatMoney(row.gross_amount)} €
        </span>
      ),
    },
  ]

  }

  const pilotColumns = makeColumns(expandedPilot, (uuid) => setExpandedPilot(expandedPilot === uuid ? null : uuid))
  const instructorColumns = makeColumns(expandedInstructor, (uuid) => setExpandedInstructor(expandedInstructor === uuid ? null : uuid))

  return (
    <div className="space-y-4">
      {/* ── KPI Strip ── */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">{t('logbookTotalFlights')}</p>
            <p className="mt-0.5 text-xl font-semibold text-slate-800">{summary.total_flight_count}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">{t('logbookDuration')}</p>
            <p className="mt-0.5 text-xl font-semibold text-slate-800">{formatMinutes(summary.total_duration_minutes)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">{t('logbookInstructor')}</p>
            <p className="mt-0.5 text-xl font-semibold text-slate-800">{formatMinutes(summary.second_pilot_duration_minutes)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">{t('logbookSupervised')}</p>
            <p className="mt-0.5 text-xl font-semibold text-slate-800">
              {summary.supervised_flight_count} {t('logbookGroupFlights').toLowerCase()} · {formatMinutes(summary.supervised_duration_minutes)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">{t('logbookDistance')}</p>
            <p className="mt-0.5 text-xl font-semibold text-slate-800">{summary.total_km.toLocaleString('fr-FR')} km</p>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500" htmlFor="logbook-from">{t('logbookFilterFrom')}</label>
          <Input
            id="logbook-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500" htmlFor="logbook-to">{t('logbookFilterTo')}</label>
          <Input
            id="logbook-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>

        {/* Group by selector */}
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as 'machine' | 'type' | 'launch' | '')}
          className="h-8 rounded border border-slate-300 bg-white px-2 text-sm text-slate-700"
        >
          <option value="">{t('logbookViewList')}</option>
          <option value="machine">{t('logbookViewByMachine')}</option>
          <option value="type">{t('logbookViewByType')}</option>
          <option value="launch">{t('logbookViewByLaunch')}</option>
        </select>

        <div className="ml-auto text-xs text-slate-400">
          {data ? `${data.total} ${t('logbookGroupFlights').toLowerCase()}` : ''}
        </div>
      </div>

      {/* ── Grouped summary table ── */}
      {groupBy && grouped.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">{groupBy === 'machine' ? t('logbookGroupMachine') : groupBy === 'type' ? t('logbookGroupType') : t('logbookGroupLaunch')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-slate-500">{t('logbookGroupFlights')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-slate-500">{t('logbookGroupDuration')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-slate-500">{t('logbookGroupDistance')}</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <tr key={g.group_key} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-800">{g.group_label}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{g.flight_count}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatMinutes(g.total_duration_minutes)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{g.total_km.toLocaleString('fr-FR')} km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail tables (only when not grouped) ── */}
      {!groupBy && (
        <div className="space-y-6">
          {/* Other flights (pilot / pilot_and_second) */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {t('logbookAsPilot')} ({otherFlights.length})
            </h3>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <DataTable
                columns={pilotColumns}
                data={otherFlights}
                getRowKey={(row) => row.flight_uuid}
                defaultSortKey="date"
                expandedRow={expandedPilot}
                renderExpanded={(row) => <ExpandedRowContent flight={row} t={t} />}
                emptyState={
                  <div className="p-8 text-center text-sm text-slate-500">
                    {t('logbookEmptyPilot')}
                  </div>
                }
                actions={(row) =>
                  mode === 'club' ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/banque/operations?flight=${row.flight_uuid}`)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      title={t('logbookSeeOps')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  ) : undefined
                }
              />
            </div>
          </div>

          {/* Instructor flights (second_pilot) */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {t('logbookAsInstructor')} ({instructorFlights.length})
            </h3>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <DataTable
                columns={instructorColumns}
                data={instructorFlights}
                getRowKey={(row) => row.flight_uuid}
                defaultSortKey="date"
                expandedRow={expandedInstructor}
                renderExpanded={(row) => <ExpandedRowContent flight={row} t={t} />}
                emptyState={
                  <div className="p-8 text-center text-sm text-slate-500">
                    {t('logbookEmptyInstructor')}
                  </div>
                }
                actions={(row) =>
                  mode === 'club' ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/banque/operations?flight=${row.flight_uuid}`)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      title={t('logbookSeeOps')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  ) : undefined
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
