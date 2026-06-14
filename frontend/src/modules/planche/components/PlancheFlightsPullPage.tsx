/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - planche: manual flights fetch page for Planche integration
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
  usePlancheSettingsQuery,
  plancheSettingsFromResponse,
} from '../api'
import {
  useFlightsFetchMutation,
  useFlightStatsQuery,
  type FlightFetchResponse,
} from '../../flights/api'

type FetchMode = 'incremental' | 'daterange'

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

export function PlancheFlightsPullPage() {
  const { t } = useTranslation('planche')

  const settingsQuery = usePlancheSettingsQuery(true)
  const fetchMutation = useFlightsFetchMutation()

  const [mode, setMode] = useState<FetchMode>('incremental')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [lastResult, setLastResult] = useState<FlightFetchResponse | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const settings = settingsQuery.data ? plancheSettingsFromResponse(settingsQuery.data) : null
  const canFetch = useMemo(() => isSettingsConfigured(settings ?? {}), [settings])
  const busy = settingsQuery.isLoading || fetchMutation.isPending

  // Extract cursor + last fetch timestamp from settings
  const settingsRaw = settingsQuery.data?.settings as
    | Record<string, unknown>
    | undefined
  const syncCursorFlights = (settingsRaw?.sync_cursor_flights as string) ?? null
  const lastFetchAt = (settingsRaw?.last_fetch_at as string) ?? null

  const statsQuery = useFlightStatsQuery()
  const stats = statsQuery.data

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
    if (!canFetch) return false
    if (mode === 'daterange') {
      return Boolean(fromDate && toDate)
    }
    return true
  }

  async function handleFetch() {
    setErrorMessage(null)
    setLastResult(null)
    try {
      const response = await fetchMutation.mutateAsync(buildRequest())
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
      setErrorMessage(t('flightsFetch.result.moreWithoutCursor'))
      return
    }
    try {
      const response = await fetchMutation.mutateAsync({
        cursor: lastResult.next_cursor,
        limit: 500,
      })
      setLastResult(response)
    } catch (err) {
      setErrorMessage(toErrorMessage(err))
    }
  }

  const canContinue = lastResult?.has_more && !!lastResult.next_cursor && !fetchMutation.isPending
  const hasMoreWithoutCursor = lastResult?.has_more && !lastResult.next_cursor

  return (
    <section className="space-y-4">
      {/* KPI Dashboard */}
      {statsQuery.isLoading ? (
        <div className="rounded-2xl border border-outline-variant bg-surface p-4 text-sm text-slate-500">
          {t('flightsFetch.stats.loading')}
        </div>
      ) : stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Total flights */}
          <KpiCard
            label={t('flightsFetch.stats.totalFlights')}
            value={stats.total_flights}
          />
          {/* By status */}
          <KpiCard
            label={t('flightsFetch.stats.byStatus')}
            subItems={[
              { label: t('flightsFetch.stats.validated'), value: stats.by_status.validated ?? 0, variant: 'info' },
              { label: t('flightsFetch.stats.transferred'), value: stats.by_status.transferred ?? 0, variant: 'success' },
              { label: t('flightsFetch.stats.modified'), value: stats.by_status.modified ?? 0, variant: 'warning' },
            ]}
          />
          {/* Unbilled / splits */}
          <KpiCard
            label={t('flightsFetch.stats.billing')}
            subItems={[
              { label: t('flightsFetch.stats.unbilled'), value: stats.unbilled_count, variant: 'warning' },
              { label: t('flightsFetch.stats.instructionSplit'), value: stats.instruction_split_count, variant: 'info' },
              { label: t('flightsFetch.stats.modifiedAfterTransfer'), value: stats.modified_after_transfer_count, variant: 'warning' },
            ]}
          />
          {/* Planche sync status */}
          <KpiCard
            label={t('flightsFetch.stats.plancheSync')}
            subItems={[
              {
                label: t('flightsFetch.stats.pendingFetch'),
                value: stats.pending_planche_count !== null ? stats.pending_planche_count : '?',
                variant: (stats.pending_planche_count ?? 0) > 0 ? 'warning' : 'success',
              },
              {
                label: t('flightsFetch.stats.lastFetch'),
                value: stats.last_fetch_at
                  ? new Date(stats.last_fetch_at).toLocaleString()
                  : t('flightsFetch.status.never'),
                variant: 'neutral',
              },
            ]}
          />
        </div>
      ) : null}

      {/* Main Card */}
      <div className="space-y-4 rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-900">{t('flightsFetch.card.title')}</h2>
          <p className="text-sm text-slate-600">{t('flightsFetch.card.description')}</p>
        </div>

        {/* Status Indicators */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('flightsFetch.status.settings')}
            </p>
            <p className={canFetch ? 'text-sm font-medium text-green-700' : 'text-sm font-medium text-amber-700'}>
              {canFetch ? t('flightsFetch.status.ready') : t('flightsFetch.status.missing')}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('flightsFetch.status.cursor')}
            </p>
            <p className="truncate text-sm font-medium text-slate-900" title={syncCursorFlights ?? undefined}>
              {syncCursorFlights
                ? `${syncCursorFlights.slice(0, 30)}...`
                : t('flightsFetch.status.notAvailable')}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('flightsFetch.status.lastSync')}
            </p>
            <p className="text-sm font-medium text-slate-900">
              {lastFetchAt
                ? new Date(lastFetchAt).toLocaleString()
                : lastResult
                  ? new Date().toLocaleString()
                  : t('flightsFetch.status.never')}
            </p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-800">{t('flightsFetch.mode.label')}</p>
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
              <p className="text-sm font-semibold text-slate-900">{t('flightsFetch.mode.incremental')}</p>
              <p className="mt-1 text-xs text-slate-600">{t('flightsFetch.mode.incrementalDesc')}</p>
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
              <p className="text-sm font-semibold text-slate-900">{t('flightsFetch.mode.dateRange')}</p>
              <p className="mt-1 text-xs text-slate-600">{t('flightsFetch.mode.dateRangeDesc')}</p>
            </button>
          </div>
        </div>

        {/* Date Range Inputs */}
        {mode === 'daterange' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="flights-fetch-from">{t('flightsFetch.mode.from')}</Label>
              <Input
                id="flights-fetch-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flights-fetch-to">{t('flightsFetch.mode.to')}</Label>
              <Input
                id="flights-fetch-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Validation Messages */}
        {!canFetch && <Alert>{t('flightsFetch.validation.configureFirst')}</Alert>}
        {mode === 'daterange' && (!fromDate || !toDate) && canFetch && (
          <Alert>{t('flightsFetch.validation.selectDateRange')}</Alert>
        )}
        {errorMessage && <Alert>{errorMessage}</Alert>}

        {/* Fetch Button */}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy || !canFetch || (mode === 'daterange' && (!fromDate || !toDate))}
            onClick={() => setConfirmOpen(true)}
            type="button"
          >
            {fetchMutation.isPending
              ? t('flightsFetch.actions.fetching')
              : t('flightsFetch.actions.fetchNow')}
          </Button>
        </div>

        {/* Results Section */}
        {lastResult && (
          <div className="space-y-3 rounded-lg border border-outline-variant bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{t('flightsFetch.result.title')}</p>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <ResultStat label={t('flightsFetch.result.total')} value={lastResult.total} />
              <ResultStat label={t('flightsFetch.result.created')} value={lastResult.created} variant="success" />
              <ResultStat label={t('flightsFetch.result.updated')} value={lastResult.updated} variant="info" />
              <ResultStat label={t('flightsFetch.result.skipped')} value={lastResult.skipped} />
              <ResultStat label={t('flightsFetch.result.idempotent')} value={lastResult.idempotent} />
              <ResultStat label={t('flightsFetch.result.snapshots')} value={lastResult.snapshots_created} />
              <ResultStat
                label={t('flightsFetch.result.modifiedAfterTransfer')}
                value={lastResult.modified_after_transfer}
                variant={lastResult.modified_after_transfer > 0 ? 'warning' : 'neutral'}
              />
              <ResultStat
                label={t('flightsFetch.result.hasMore')}
                value={lastResult.has_more ? t('flightsFetch.result.yes') : t('flightsFetch.result.no')}
              />
            </div>

            {lastResult.next_cursor && (
              <p className="truncate text-xs text-slate-500" title={lastResult.next_cursor}>
                {t('flightsFetch.result.nextCursor')}: {lastResult.next_cursor.slice(0, 40)}...
              </p>
            )}

            {/* Diagnostic summary: flight failures */}
            {(lastResult.failed_count ?? 0) > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-800">
                  {t('flightsFetch.result.failedFlights')}: {lastResult.failed_count}
                </p>
                <div className="mt-1 flex gap-4 text-xs text-red-700">
                  {(lastResult.missing_required_field_count ?? 0) > 0 && (
                    <span>⚠ {t('flightsFetch.result.missingFields')}: {lastResult.missing_required_field_count}</span>
                  )}
                  {(lastResult.constraint_violation_count ?? 0) > 0 && (
                    <span>⚠ {t('flightsFetch.result.constraintViolations')}: {lastResult.constraint_violation_count}</span>
                  )}
                </div>
                {lastResult.error_details && lastResult.error_details.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-red-700">
                      {t('flightsFetch.result.showDetails')} ({lastResult.error_details.length})
                    </summary>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-red-700">
                      {lastResult.error_details.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {lastResult.has_more ? (
              hasMoreWithoutCursor ? (
                <p className="text-sm text-amber-700">
                  {t('flightsFetch.result.moreWithoutCursor')}
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
                  {fetchMutation.isPending
                    ? t('flightsFetch.actions.fetching')
                    : t('flightsFetch.actions.continue')}
                </Button>
              )
            ) : lastResult.total > 0 ? (
              <Alert variant="success">{t('flightsFetch.result.success')}</Alert>
            ) : (
              <p className="text-sm text-slate-600">{t('flightsFetch.result.noChanges')}</p>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-labelledby="planche-flights-fetch-confirm-title"
        aria-describedby="planche-flights-fetch-confirm-body"
      >
        <div className="space-y-4 p-6">
          <h2 id="planche-flights-fetch-confirm-title" className="text-lg font-semibold text-slate-900">
            {t('flightsFetch.confirm.title')}
          </h2>

          <p id="planche-flights-fetch-confirm-body" className="text-sm text-slate-600">
            {mode === 'incremental'
              ? t('flightsFetch.confirm.descriptionIncremental')
              : t('flightsFetch.confirm.descriptionDateRange', {
                  from: fromDate || '...',
                  to: toDate || '...',
                })}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('flightsFetch.mode.label')}
              </p>
              <p className="text-sm font-medium text-slate-900">
                {mode === 'incremental'
                  ? t('flightsFetch.mode.incremental')
                  : t('flightsFetch.mode.dateRange')}
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('flightsFetch.status.cursor')}
              </p>
              <p className="truncate text-sm font-medium text-slate-900">
                {syncCursorFlights
                  ? `${syncCursorFlights.slice(0, 20)}...`
                  : t('flightsFetch.status.notAvailable')}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('flightsFetch.confirm.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!canConfirm() || fetchMutation.isPending}
              onClick={() => {
                void handleFetch()
              }}
            >
              {fetchMutation.isPending
                ? t('flightsFetch.actions.fetching')
                : t('flightsFetch.confirm.fetch')}
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

type SubItem = { label: string; value: string | number; variant?: 'neutral' | 'success' | 'info' | 'warning' }

function KpiCard({ label, value, subItems }: { label: string; value?: string | number; subItems?: SubItem[] }) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface p-4 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      {value !== undefined && (
        <p className="text-2xl font-bold text-slate-900">{value}</p>
      )}
      {subItems && (
        <div className="mt-2 space-y-1">
          {subItems.map((item, i) => {
            const colorMap = {
              neutral: 'text-slate-700',
              success: 'text-green-700',
              info: 'text-blue-700',
              warning: 'text-amber-700',
            }
            return (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{item.label}</span>
                <span className={`font-semibold ${colorMap[item.variant ?? 'neutral']}`}>{item.value}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
