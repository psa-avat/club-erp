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
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'

import { Input } from '../../../components/ui/input'
import { DataTable } from '../../../components/ui/data-table'
import type { ColumnDef } from '../../../components/ui/data-table'
import { useMemberLogbookQuery } from '../api'
import { useMemberPortalLogbookQuery } from '../../member-portal/api'
import { useMembersStore } from '../store'
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

function billingStateBadge(state: string | null): { label: string; class: string } {
  switch (state) {
    case 'pending':
      return { label: 'En attente', class: 'bg-slate-100 text-slate-700' }
    case 'applied':
      return { label: 'Brouillon', class: 'bg-amber-100 text-amber-800' }
    case 'posted':
      return { label: 'Comptabilisé', class: 'bg-emerald-100 text-emerald-800' }
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

function ExpandedRowContent({ flight }: { flight: LogbookItem }) {
  return (
    <div className="space-y-3 bg-slate-50 p-4">
      {/* Flight details */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
        <div>
          <span className="font-medium text-slate-500">Décollage :</span>{' '}
          <span className="text-slate-800">{flight.takeoff_time ?? '—'}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">Atterrissage :</span>{' '}
          <span className="text-slate-800">{flight.landing_time ?? '—'}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">Durée :</span>{' '}
          <span className="text-slate-800">{formatMinutes(flight.duration_minutes)}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">Lancement :</span>{' '}
          <span className="text-slate-800">{flight.launch_label ?? `type ${flight.launch_method}`}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">Second pilote :</span>{' '}
          <span className="text-slate-800">{flight.second_pilot_name ?? '—'}</span>
        </div>
        <div>
          <span className="font-medium text-slate-500">Montant brut :</span>{' '}
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
  const navigate = useNavigate()
  const { selectedYear } = useMembersStore()

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const filters: LogbookFilters = {
    year: selectedYear,
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  }

  const clubQuery = useMemberLogbookQuery(memberUuid, filters)
  const portalQuery = useMemberPortalLogbookQuery(filters)
  const { data, isLoading } = mode === 'portal' ? portalQuery : clubQuery

  const flights = data?.items ?? []

  const columns: ColumnDef<LogbookItem>[] = [
    {
      key: 'expand',
      header: '',
      className: 'w-8',
      cell: (row) => (
        <button
          type="button"
          onClick={() => setExpandedRow(expandedRow === row.flight_uuid ? null : row.flight_uuid)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          {expandedRow === row.flight_uuid ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      className: 'min-w-[100px]',
      cell: (row) => <span className="text-sm text-slate-800">{formatDate(row.flight_date)}</span>,
    },
    {
      key: 'machine',
      header: 'Machine',
      className: 'min-w-[100px]',
      cell: (row) => <span className="text-sm font-medium text-slate-800">{row.asset_code ?? '—'}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      className: 'min-w-[100px]',
      cell: (row) => <span className="text-sm text-slate-700">{row.type_label ?? `type ${row.type_of_flight}`}</span>,
    },
    {
      key: 'duration',
      header: 'Durée',
      className: 'min-w-[80px] text-right',
      cell: (row) => <span className="text-sm text-slate-700">{formatMinutes(row.duration_minutes)}</span>,
    },
    {
      key: 'pilot',
      header: 'Pilote',
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell min-w-[120px]',
      cell: (row) => <span className="text-sm text-slate-700">{row.pilot_name ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Facturation',
      className: 'min-w-[120px]',
      cell: (row) => {
        const badge = billingStateBadge(row.billing_quote_state)
        return (
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.class}`}>
              {badge.label}
            </span>
            {row.has_discount && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700" title="Remise forfait appliquée">
                🔵 Pack
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'amount',
      header: 'Montant',
      className: 'min-w-[100px] text-right',
      cell: (row) => (
        <span className={`text-sm font-medium ${Number(row.gross_amount) > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
          {formatMoney(row.gross_amount)} €
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500" htmlFor="logbook-from">Du</label>
          <Input
            id="logbook-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500" htmlFor="logbook-to">Au</label>
          <Input
            id="logbook-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>

        <div className="ml-auto text-xs text-slate-400">
          {data ? `${data.total} vol${data.total !== 1 ? 's' : ''}` : ''}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <DataTable
          columns={columns}
          data={flights}
          getRowKey={(row) => row.flight_uuid}
          defaultSortKey="date"
          emptyState={
            <div className="p-8 text-center text-sm text-slate-500">
              {isLoading ? 'Chargement du carnet de vol…' : 'Aucun vol enregistré pour cette période.'}
            </div>
          }
          actions={(row) =>
            mode === 'club' ? (
              <button
                type="button"
                onClick={() => navigate(`/banque/operations?flight=${row.flight_uuid}`)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Voir dans les opérations"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            ) : undefined
          }
        />

        {/* Expanded row */}
        {expandedRow && (
          <ExpandedRowContent flight={flights.find((f) => f.flight_uuid === expandedRow)!} />
        )}
      </div>
    </div>
  )
}
