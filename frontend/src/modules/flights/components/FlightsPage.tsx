/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - flights: Flights page with validated flight listing and Planche import
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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Dialog } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'

import {
  useFlightListQuery,
  useFlightsPullMutation,
  type FlightListFilters,
  type FlightPullResponse,
  type ValidatedFlightItem,
} from '../api'

import {
  usePlancheSettingsQuery,
  plancheSettingsFromResponse,
} from '../../planche/api'

type PullMode = 'incremental' | 'daterange'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }

    if (typeof detail === 'object' && detail !== null) {
      const detailMessage = (detail as { message?: unknown }).message
      if (typeof detailMessage === 'string' && detailMessage.length > 0) {
        return detailMessage
      }
      const detailStatusCode = (detail as { status_code?: unknown }).status_code
      if (typeof detailStatusCode === 'number') {
        return `Request failed with status ${detailStatusCode}`
      }
    }

    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) {
      return response.data.message
    }
  }

  return 'Unexpected error'
}

const FLIGHT_TYPE_LABELS: Record<number, string> = {
  0: 'Instruction',
  1: 'Solo',
  2: 'Initiation',
  3: 'Partage',
  4: 'Passager',
  5: 'Lâcher',
  6: 'Supervisé',
  7: 'Essai',
}

/** Flight types where second pilot should show as trigram instead of name. */
const TRIGRAM_FLIGHT_TYPES = new Set([0, 5, 6]) // Instruction, Lâcher, Supervisé

function formatFlightType(value: number | null): string {
  if (value === null || value === undefined) return '-'
  return FLIGHT_TYPE_LABELS[value] ?? `Type ${value}`
}

function formatSecondPilot(flight: ValidatedFlightItem): string {
  if (!flight.second_pilot_erp_id) return '-'
  // Lâcher (5), Supervisé (6), Instruction (0) → show trigram, else name
  if (flight.type_of_flight !== null && TRIGRAM_FLIGHT_TYPES.has(flight.type_of_flight)) {
    return flight.second_pilot_trigram ?? flight.second_pilot_name ?? flight.second_pilot_erp_id
  }
  return flight.second_pilot_name ?? flight.second_pilot_erp_id
}

function formatDuration(takeoff: string, landing: string): string {
  const [th, tm] = takeoff.split(':').map(Number)
  const [lh, lm] = landing.split(':').map(Number)
  if (isNaN(th) || isNaN(tm) || isNaN(lh) || isNaN(lm)) return `${takeoff} → ${landing}`
  const start = th * 60 + tm
  const end = lh * 60 + lm
  let diff = end - start
  if (diff < 0) diff += 1440 // cross-midnight
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return `${h}h${m.toString().padStart(2, '0')}`
}

const LAUNCH_METHOD_LABELS: Record<number, string> = {
  0: 'Extérieur',
  1: 'Treuil',
  2: 'Remorqueur',
  3: 'Autonome',
}

function formatLaunchMethod(flight: ValidatedFlightItem): string {
  const method = flight.launch_method
  if (method === null || method === undefined) return '-'
  if (method === 0) return 'Extérieur'
  if (method === 3) return 'Autonome'
  const label = LAUNCH_METHOD_LABELS[method] ?? `Méthode ${method}`
  return flight.launch_asset_code ? `${label} ${flight.launch_asset_code}` : label
}

function highlightType(flight: ValidatedFlightItem): boolean {
  const hasSplit = (flight.instruction_split ?? 0) > 0
  const hasChargeTo = !!flight.charge_to_erp_id && flight.charge_to_erp_id !== flight.pilot_erp_id
  return hasSplit || hasChargeTo
}

function isSettingsConfigured(settings: {
  base_url?: string
  connection_id?: string
  token?: string
  user?: string
  password?: string
}) {
  return Boolean(
    settings.base_url?.trim() &&
      settings.connection_id?.trim() &&
      settings.token?.trim() &&
      settings.user?.trim() &&
      settings.password?.trim(),
  )
}

export function FlightsPage() {
  const { t } = useTranslation('flights')

  const settingsQuery = usePlancheSettingsQuery(true)
  const pullMutation = useFlightsPullMutation()

  const [mode, setMode] = useState<PullMode>('incremental')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [lastResult, setLastResult] = useState<FlightPullResponse | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Pagination for the flights table
  const [flightPage, setFlightPage] = useState(1)
  const flightPageSize = 50

  // Filter state
  const [filters, setFilters] = useState<FlightListFilters>({})
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterType, setFilterType] = useState<number | null>(null)
  const [filterLaunch, setFilterLaunch] = useState<number | null>(null)
  const [filterPilot, setFilterPilot] = useState('')
  const [filterAsset, setFilterAsset] = useState('')
  const [filterStatus, setFilterStatus] = useState<number | null>(null)

  // Apply filters: reset to page 1 when filters change
  function applyFilters() {
    const next: FlightListFilters = {}
    if (filterDateFrom) next.date_from = filterDateFrom
    if (filterDateTo) next.date_to = filterDateTo
    if (filterType !== null) next.type_of_flight = filterType
    if (filterLaunch !== null) next.launch_method = filterLaunch
    if (filterPilot.trim()) next.pilot_query = filterPilot.trim()
    if (filterAsset.trim()) next.asset_code = filterAsset.trim()
    if (filterStatus !== null) next.erp_status = filterStatus
    setFilters(next)
    setFlightPage(1)
  }

  // Clear all filters
  function clearFilters() {
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterType(null)
    setFilterLaunch(null)
    setFilterPilot('')
    setFilterAsset('')
    setFilterStatus(null)
    setFilters({})
    setFlightPage(1)
  }

  const hasActiveFilters = Object.keys(filters).length > 0
  const flightsQuery = useFlightListQuery(flightPage, flightPageSize, filters)

  const settings = settingsQuery.data ? plancheSettingsFromResponse(settingsQuery.data) : null
  const canPull = useMemo(() => isSettingsConfigured(settings ?? {}), [settings])
  const busy = settingsQuery.isLoading || pullMutation.isPending

  // Extract cursor info from settings
  const settingsRaw = settingsQuery.data?.settings as
    | Record<string, unknown>
    | undefined
  const syncCursorFlights = (settingsRaw?.sync_cursor_flights as string) ?? null

  function buildRequest() {
    if (mode === 'incremental') {
      return { cursor: syncCursorFlights || undefined, limit: 500 }
    }
    return {
      from_date: fromDate || null,
      to_date: toDate || null,
      limit: 500,
    }
  }

  function canConfirm(): boolean {
    if (!canPull) return false
    if (mode === 'daterange') {
      return Boolean(fromDate && toDate)
    }
    return true
  }

  async function handlePull() {
    setErrorMessage(null)
    setLastResult(null)
    try {
      const response = await pullMutation.mutateAsync(buildRequest())
      setLastResult(response)
    } catch (err) {
      setErrorMessage(toErrorMessage(err))
    } finally {
      setConfirmOpen(false)
    }
  }

  async function handleContinue() {
    setErrorMessage(null)
    if (!lastResult?.next_cursor) {
      setErrorMessage(t('pull.result.moreWithoutCursor'))
      return
    }
    try {
      const response = await pullMutation.mutateAsync({
        cursor: lastResult.next_cursor,
        limit: 500,
      })
      setLastResult(response)
    } catch (err) {
      setErrorMessage(toErrorMessage(err))
    }
  }

  const canContinue = lastResult?.has_more && !!lastResult.next_cursor && !pullMutation.isPending
  const hasMoreWithoutCursor = lastResult?.has_more && !lastResult.next_cursor

  return (
    <section className="space-y-4">
      {/* Hero Banner */}
      <div className="rounded-2xl border border-outline-variant bg-gradient-to-r from-indigo-950 via-purple-900 to-violet-800 p-6 text-white shadow-sm">
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-100">
            {t('hero.kicker')}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{t('hero.title')}</h1>
          <p className="max-w-2xl text-sm text-violet-50/90">{t('hero.description')}</p>
        </div>
      </div>

      {/* Import Card */}
      <div className="space-y-4 rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-900">{t('pull.card.title')}</h2>
          <p className="text-sm text-slate-600">{t('pull.card.description')}</p>
        </div>

        {/* Status Indicators */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('pull.status.settings')}
            </p>
            <p className={canPull ? 'text-sm font-medium text-green-700' : 'text-sm font-medium text-amber-700'}>
              {canPull ? t('pull.status.ready') : t('pull.status.missing')}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('pull.status.cursor')}
            </p>
            <p className="truncate text-sm font-medium text-slate-900" title={syncCursorFlights ?? undefined}>
              {syncCursorFlights
                ? `${syncCursorFlights.slice(0, 30)}...`
                : t('pull.status.notAvailable')}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('pull.status.lastSync')}
            </p>
            <p className="text-sm font-medium text-slate-900">
              {lastResult
                ? new Date().toLocaleString()
                : t('pull.status.never')}
            </p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-800">{t('pull.mode.label')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className={`rounded-lg border p-4 text-left transition-all ${
                mode === 'incremental'
                  ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200'
                  : 'border-outline-variant bg-slate-50 hover:bg-slate-100'
              }`}
              onClick={() => setMode('incremental')}
            >
              <p className="text-sm font-semibold text-slate-900">{t('pull.mode.incremental')}</p>
              <p className="mt-1 text-xs text-slate-600">{t('pull.mode.incrementalDesc')}</p>
            </button>
            <button
              type="button"
              className={`rounded-lg border p-4 text-left transition-all ${
                mode === 'daterange'
                  ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200'
                  : 'border-outline-variant bg-slate-50 hover:bg-slate-100'
              }`}
              onClick={() => setMode('daterange')}
            >
              <p className="text-sm font-semibold text-slate-900">{t('pull.mode.dateRange')}</p>
              <p className="mt-1 text-xs text-slate-600">{t('pull.mode.dateRangeDesc')}</p>
            </button>
          </div>
        </div>

        {/* Date Range Inputs */}
        {mode === 'daterange' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="flights-pull-from">{t('pull.mode.from')}</Label>
              <Input
                id="flights-pull-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flights-pull-to">{t('pull.mode.to')}</Label>
              <Input
                id="flights-pull-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Validation Messages */}
        {!canPull && <Alert>{t('pull.validation.configureFirst')}</Alert>}
        {mode === 'daterange' && (!fromDate || !toDate) && canPull && (
          <Alert>{t('pull.validation.selectDateRange')}</Alert>
        )}
        {errorMessage && <Alert>{errorMessage}</Alert>}

        {/* Pull Button */}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy || !canPull || (mode === 'daterange' && (!fromDate || !toDate))}
            onClick={() => setConfirmOpen(true)}
            type="button"
          >
            {pullMutation.isPending
              ? t('pull.actions.pulling')
              : t('pull.actions.pullNow')}
          </Button>
        </div>

        {/* Results Section */}
        {lastResult && (
          <div className="space-y-3 rounded-lg border border-outline-variant bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{t('pull.result.title')}</p>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <ResultStat label={t('pull.result.total')} value={lastResult.total} />
              <ResultStat label={t('pull.result.created')} value={lastResult.created} variant="success" />
              <ResultStat label={t('pull.result.updated')} value={lastResult.updated} variant="info" />
              <ResultStat label={t('pull.result.skipped')} value={lastResult.skipped} />
              <ResultStat label={t('pull.result.idempotent')} value={lastResult.idempotent} />
              <ResultStat label={t('pull.result.snapshots')} value={lastResult.snapshots_created} />
              <ResultStat
                label={t('pull.result.modifiedAfterTransfer')}
                value={lastResult.modified_after_transfer}
                variant={lastResult.modified_after_transfer > 0 ? 'warning' : 'neutral'}
              />
              <ResultStat
                label={t('pull.result.hasMore')}
                value={lastResult.has_more ? t('pull.result.yes') : t('pull.result.no')}
              />
            </div>

            {lastResult.next_cursor && (
              <p className="truncate text-xs text-slate-500" title={lastResult.next_cursor}>
                {t('pull.result.nextCursor')}: {lastResult.next_cursor.slice(0, 40)}...
              </p>
            )}

            {lastResult.error_details && lastResult.error_details.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-700">{t('pull.result.errors')}</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                  {lastResult.error_details.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {lastResult.has_more ? (
              hasMoreWithoutCursor ? (
                <p className="text-sm text-amber-700">
                  {t('pull.result.moreWithoutCursor')}
                </p>
              ) : (
                <Button
                  disabled={!canContinue}
                  onClick={() => {
                    void handleContinue()
                  }}
                  type="button"
                  variant="secondary"
                >
                  {pullMutation.isPending
                    ? t('pull.actions.pulling')
                    : t('pull.actions.continue')}
                </Button>
              )
            ) : lastResult.total > 0 ? (
              <Alert variant="success">{t('pull.result.success')}</Alert>
            ) : (
              <p className="text-sm text-slate-600">{t('pull.result.noChanges')}</p>
            )}
          </div>
        )}
      </div>

      {/* Filters bar */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Date from */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterDateFrom')}</Label>
            <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
          </div>
          {/* Date to */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterDateTo')}</Label>
            <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
          </div>
          {/* Flight type */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterType')}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterType ?? ''}
              onChange={(e) => setFilterType(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('table.filterAll')}</option>
              <option value="0">Instruction</option>
              <option value="1">Solo</option>
              <option value="2">Initiation</option>
              <option value="3">Partage</option>
              <option value="4">Passager</option>
              <option value="5">Lâcher</option>
              <option value="6">Supervisé</option>
              <option value="7">Essai</option>
            </select>
          </div>
          {/* Launch method */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterLaunch')}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterLaunch ?? ''}
              onChange={(e) => setFilterLaunch(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('table.filterAll')}</option>
              <option value="0">Extérieur</option>
              <option value="1">Treuil</option>
              <option value="2">Remorqueur</option>
              <option value="3">Autonome</option>
            </select>
          </div>
          {/* Pilot search */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterPilot')}</Label>
            <Input
              placeholder={t('table.filterPilotPlaceholder')}
              value={filterPilot}
              onChange={(e) => setFilterPilot(e.target.value)}
            />
          </div>
          {/* Asset code */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterAsset')}</Label>
            <Input
              placeholder={t('table.filterAssetPlaceholder')}
              value={filterAsset}
              onChange={(e) => setFilterAsset(e.target.value)}
            />
          </div>
          {/* Status */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterStatus')}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterStatus ?? ''}
              onChange={(e) => setFilterStatus(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('table.filterAll')}</option>
              <option value="0">Validé</option>
              <option value="1">Transféré</option>
              <option value="2">Modifié</option>
            </select>
          </div>
          {/* Actions */}
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={applyFilters} type="button">
              {t('table.filterApply')}
            </Button>
            {hasActiveFilters && (
              <Button size="sm" variant="secondary" onClick={clearFilters} type="button">
                {t('table.filterClear')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Flights table */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{t('table.title')}</h2>
            <p className="text-sm text-slate-600">{t('table.description')}</p>
          </div>
          <div className="text-sm text-slate-600">
            {t('table.count', { total: flightsQuery.data?.total ?? 0 })}
          </div>
        </div>

        {flightsQuery.isLoading ? (
          <p className="text-sm text-slate-600">{t('state.loading')}</p>
        ) : flightsQuery.error ? (
          <Alert>{t('table.loadError')}</Alert>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-outline-variant">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.date')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.glider')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.type')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.pilot')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.secondPilot')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.duration')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.launch')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.launchPilot')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.chargeTo')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {flightsQuery.data?.items.map((flight) => (
                    <tr key={flight.uuid}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-800">
                        {flight.jour ? new Date(flight.jour).toLocaleDateString('fr-FR') : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-800">{flight.asset_code ?? '-'}</td>
                      <td className={`px-3 py-2 ${highlightType(flight) ? 'font-bold text-amber-600' : 'text-slate-800'}`}>{formatFlightType(flight.type_of_flight)}</td>
                      <td className="px-3 py-2 text-slate-800">{flight.pilot_name ?? flight.pilot_erp_id ?? '-'}</td>
                      <td className="px-3 py-2 text-slate-800">{formatSecondPilot(flight)}</td>
                      <td className="px-3 py-2 text-slate-800">
                        {flight.takeoff_time && flight.landing_time
                          ? formatDuration(flight.takeoff_time, flight.landing_time)
                          : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-800">{formatLaunchMethod(flight)}</td>
                      <td className="px-3 py-2 text-slate-800">{flight.launch_pilot_trigram ?? '-'}</td>
                      <td className="px-3 py-2 text-slate-800">{flight.charge_to_erp_id ?? '-'}</td>
                    </tr>
                  ))}
                  {(!flightsQuery.data || flightsQuery.data.items.length === 0) && (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={9}>
                        {t('table.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {flightsQuery.data && flightsQuery.data.total_pages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={flightPage <= 1}
                  onClick={() => setFlightPage((p) => Math.max(1, p - 1))}
                >
                  {t('table.prev')}
                </Button>
                <span className="px-2 text-sm text-slate-700">
                  {t('table.pageInfo', {
                    page: flightPage,
                    total: flightsQuery.data.total_pages,
                  })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={flightPage >= (flightsQuery.data.total_pages)}
                  onClick={() => setFlightPage((p) => p + 1)}
                >
                  {t('table.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-labelledby="flights-pull-confirm-title"
        aria-describedby="flights-pull-confirm-body"
      >
        <div className="space-y-4 p-6">
          <h2 id="flights-pull-confirm-title" className="text-lg font-semibold text-slate-900">
            {t('pull.confirm.title')}
          </h2>

          <p id="flights-pull-confirm-body" className="text-sm text-slate-600">
            {mode === 'incremental'
              ? t('pull.confirm.descriptionIncremental')
              : t('pull.confirm.descriptionDateRange', {
                  from: fromDate || '...',
                  to: toDate || '...',
                })}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('pull.mode.label')}
              </p>
              <p className="text-sm font-medium text-slate-900">
                {mode === 'incremental'
                  ? t('pull.mode.incremental')
                  : t('pull.mode.dateRange')}
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('pull.status.cursor')}
              </p>
              <p className="truncate text-sm font-medium text-slate-900">
                {syncCursorFlights
                  ? `${syncCursorFlights.slice(0, 20)}...`
                  : t('pull.status.notAvailable')}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('pull.confirm.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!canConfirm() || pullMutation.isPending}
              onClick={() => {
                void handlePull()
              }}
            >
              {pullMutation.isPending
                ? t('pull.actions.pulling')
                : t('pull.confirm.pull')}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}

function ResultStat({
  label,
  value,
  variant = 'neutral',
}: {
  label: string
  value: string | number
  variant?: 'neutral' | 'success' | 'info' | 'warning'
}) {
  const colorMap = {
    neutral: 'text-slate-900',
    success: 'text-green-700',
    info: 'text-blue-700',
    warning: 'text-amber-700',
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${colorMap[variant]}`}>{value}</p>
    </div>
  )
}
