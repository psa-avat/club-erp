/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - planche: manual flights pull page for Planche integration
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
  usePlancheFlightsPullMutation,
  usePlancheSettingsQuery,
  plancheSettingsFromResponse,
  type FlightPullResponse,
} from '../api'

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
  const pullMutation = usePlancheFlightsPullMutation()

  const [mode, setMode] = useState<PullMode>('incremental')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [lastResult, setLastResult] = useState<FlightPullResponse | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
      setErrorMessage(t('flightsPull.result.moreWithoutCursor'))
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
            {t('flightsPull.hero.kicker')}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{t('flightsPull.hero.title')}</h1>
          <p className="max-w-2xl text-sm text-violet-50/90">{t('flightsPull.hero.description')}</p>
        </div>
      </div>

      {/* Main Card */}
      <div className="space-y-4 rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-900">{t('flightsPull.card.title')}</h2>
          <p className="text-sm text-slate-600">{t('flightsPull.card.description')}</p>
        </div>

        {/* Status Indicators */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('flightsPull.status.settings')}
            </p>
            <p className={canPull ? 'text-sm font-medium text-green-700' : 'text-sm font-medium text-amber-700'}>
              {canPull ? t('flightsPull.status.ready') : t('flightsPull.status.missing')}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('flightsPull.status.cursor')}
            </p>
            <p className="truncate text-sm font-medium text-slate-900" title={syncCursorFlights ?? undefined}>
              {syncCursorFlights
                ? `${syncCursorFlights.slice(0, 30)}...`
                : t('flightsPull.status.notAvailable')}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('flightsPull.status.lastSync')}
            </p>
            <p className="text-sm font-medium text-slate-900">
              {lastResult
                ? new Date().toLocaleString()
                : t('flightsPull.status.never')}
            </p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-800">{t('flightsPull.mode.label')}</p>
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
              <p className="text-sm font-semibold text-slate-900">{t('flightsPull.mode.incremental')}</p>
              <p className="mt-1 text-xs text-slate-600">{t('flightsPull.mode.incrementalDesc')}</p>
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
              <p className="text-sm font-semibold text-slate-900">{t('flightsPull.mode.dateRange')}</p>
              <p className="mt-1 text-xs text-slate-600">{t('flightsPull.mode.dateRangeDesc')}</p>
            </button>
          </div>
        </div>

        {/* Date Range Inputs */}
        {mode === 'daterange' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="flights-pull-from">{t('flightsPull.mode.from')}</Label>
              <Input
                id="flights-pull-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flights-pull-to">{t('flightsPull.mode.to')}</Label>
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
        {!canPull && <Alert>{t('flightsPull.validation.configureFirst')}</Alert>}
        {mode === 'daterange' && (!fromDate || !toDate) && canPull && (
          <Alert>{t('flightsPull.validation.selectDateRange')}</Alert>
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
              ? t('flightsPull.actions.pulling')
              : t('flightsPull.actions.pullNow')}
          </Button>
        </div>

        {/* Results Section */}
        {lastResult && (
          <div className="space-y-3 rounded-lg border border-outline-variant bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{t('flightsPull.result.title')}</p>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <ResultStat label={t('flightsPull.result.total')} value={lastResult.total} />
              <ResultStat label={t('flightsPull.result.created')} value={lastResult.created} variant="success" />
              <ResultStat label={t('flightsPull.result.updated')} value={lastResult.updated} variant="info" />
              <ResultStat label={t('flightsPull.result.skipped')} value={lastResult.skipped} />
              <ResultStat label={t('flightsPull.result.idempotent')} value={lastResult.idempotent} />
              <ResultStat label={t('flightsPull.result.snapshots')} value={lastResult.snapshots_created} />
              <ResultStat
                label={t('flightsPull.result.modifiedAfterTransfer')}
                value={lastResult.modified_after_transfer}
                variant={lastResult.modified_after_transfer > 0 ? 'warning' : 'neutral'}
              />
              <ResultStat
                label={t('flightsPull.result.hasMore')}
                value={lastResult.has_more ? t('flightsPull.result.yes') : t('flightsPull.result.no')}
              />
            </div>

            {lastResult.next_cursor && (
              <p className="truncate text-xs text-slate-500" title={lastResult.next_cursor}>
                {t('flightsPull.result.nextCursor')}: {lastResult.next_cursor.slice(0, 40)}...
              </p>
            )}

            {lastResult.error_details && lastResult.error_details.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-700">{t('flightsPull.result.errors')}</p>
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
                  {t('flightsPull.result.moreWithoutCursor')}
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
                    ? t('flightsPull.actions.pulling')
                    : t('flightsPull.actions.continue')}
                </Button>
              )
            ) : lastResult.total > 0 ? (
              <Alert variant="success">{t('flightsPull.result.success')}</Alert>
            ) : (
              <p className="text-sm text-slate-600">{t('flightsPull.result.noChanges')}</p>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-labelledby="planche-flights-pull-confirm-title"
        aria-describedby="planche-flights-pull-confirm-body"
      >
        <div className="space-y-4 p-6">
          <h2 id="planche-flights-pull-confirm-title" className="text-lg font-semibold text-slate-900">
            {t('flightsPull.confirm.title')}
          </h2>

          <p id="planche-flights-pull-confirm-body" className="text-sm text-slate-600">
            {mode === 'incremental'
              ? t('flightsPull.confirm.descriptionIncremental')
              : t('flightsPull.confirm.descriptionDateRange', {
                  from: fromDate || '...',
                  to: toDate || '...',
                })}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('flightsPull.mode.label')}
              </p>
              <p className="text-sm font-medium text-slate-900">
                {mode === 'incremental'
                  ? t('flightsPull.mode.incremental')
                  : t('flightsPull.mode.dateRange')}
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('flightsPull.status.cursor')}
              </p>
              <p className="truncate text-sm font-medium text-slate-900">
                {syncCursorFlights
                  ? `${syncCursorFlights.slice(0, 20)}...`
                  : t('flightsPull.status.notAvailable')}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('flightsPull.confirm.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!canConfirm() || pullMutation.isPending}
              onClick={() => {
                void handlePull()
              }}
            >
              {pullMutation.isPending
                ? t('flightsPull.actions.pulling')
                : t('flightsPull.confirm.pull')}
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
