/*
    ERP-CLUB - ERP pour Club de vol a voile
    - Logiciel libre de gestion d'un club de vol a voile
    - planche: manual members push page for Planche integration
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
import {
  usePilotsPushMutation,
  usePilotsPushPreviewQuery,
  usePlancheSettingsQuery,
  type PlanchePilotsPushResponse,
} from '../api'
import { PilotsMissingDebug } from './PilotsMissingDebug'

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

export function PlancheMembersPushPage() {
  const { t } = useTranslation('planche')

  const settingsQuery = usePlancheSettingsQuery(true)
  const previewQuery = usePilotsPushPreviewQuery(true)
  const pushMutation = usePilotsPushMutation()
  const [lastResult, setLastResult] = useState<PlanchePilotsPushResponse | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dryRunEnabled, setDryRunEnabled] = useState(true)

  const canPush = useMemo(() => {
    if (!settingsQuery.data?.settings) {
      return false
    }
    return isSettingsConfigured(settingsQuery.data.settings)
  }, [settingsQuery.data])

  const busy = settingsQuery.isLoading || previewQuery.isLoading || pushMutation.isPending

  const preview = previewQuery.data
  const eligibleCount = preview?.eligible_count ?? 0
  const excludedCount = preview?.excluded_count ?? 0
  const previewLastSync = preview?.last_synced_at

  async function handlePush() {
    const response = await pushMutation.mutateAsync({ dry_run: dryRunEnabled })
    setLastResult(response)
    setConfirmOpen(false)
    setDryRunEnabled(true)
    void previewQuery.refetch()
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-outline-variant bg-gradient-to-r from-cyan-900 via-sky-900 to-blue-900 p-6 text-white shadow-sm">
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">{t('membersPush.hero.kicker')}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t('membersPush.hero.title')}</h1>
          <p className="max-w-2xl text-sm text-cyan-50/90">{t('membersPush.hero.description')}</p>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-900">{t('membersPush.card.title')}</h2>
          <p className="text-sm text-slate-600">{t('membersPush.card.description')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('membersPush.status.settings')}</p>
            <p className={canPush ? 'text-sm font-medium text-green-700' : 'text-sm font-medium text-amber-700'}>
              {canPush ? t('membersPush.status.ready') : t('membersPush.status.missing')}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('membersPush.status.lastSync')}</p>
            <p className="text-sm font-medium text-slate-900">
              {(lastResult?.last_synced_at ?? previewLastSync)
                ? new Date(lastResult?.last_synced_at ?? previewLastSync ?? '').toLocaleString()
                : t('membersPush.status.never')}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('membersPush.preview.eligible')}</p>
            <p className="text-xl font-semibold text-slate-900">{eligibleCount}</p>
          </div>
          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('membersPush.preview.excluded')}</p>
            <p className="text-xl font-semibold text-slate-900">{excludedCount}</p>
          </div>
        </div>

        {/* Planche Reconciliation Stats */}
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-900">{t('membersPush.reconciliation.title')}</p>
          <div className="grid gap-2 text-sm text-blue-800 sm:grid-cols-2">
            <div>
              <p className="font-medium">{t('membersPush.reconciliation.plancheTotalPilots')}</p>
              <p className="text-lg font-bold text-blue-900">{preview?.planche_total_pilots ?? 0}</p>
            </div>
            <div>
              <p className="font-medium">{t('membersPush.reconciliation.plancheWithErpId')}</p>
              <p className="text-lg font-bold text-green-700">{preview?.planche_pilots_with_erp_id ?? 0}</p>
            </div>
            <div>
              <p className="font-medium">{t('membersPush.reconciliation.plancheMissingErpId')}</p>
              <p className="text-lg font-bold text-amber-700">{preview?.planche_pilots_missing_erp_id ?? 0}</p>
            </div>
            <div>
              <p className="font-medium">{t('membersPush.reconciliation.planchemorphaned')}</p>
              <p className="text-lg font-bold text-red-700">{preview?.planche_pilots_orphaned ?? 0}</p>
            </div>
            <div>
              <p className="font-medium">{t('membersPush.reconciliation.erpFoundOnPlanche')}</p>
              <p className="text-lg font-bold text-green-700">{preview?.erp_pilots_found_on_planche ?? 0}</p>
            </div>
            <div>
              <p className="font-medium">{t('membersPush.reconciliation.erpNotOnPlanche')}</p>
              <p className="text-lg font-bold text-orange-700">{preview?.erp_pilots_not_on_planche ?? 0}</p>
            </div>
          </div>
        </div>

        {!canPush ? <Alert>{t('membersPush.validation.configureFirst')}</Alert> : null}
        {previewQuery.isError ? <Alert>{toErrorMessage(previewQuery.error)}</Alert> : null}

        <PilotsMissingDebug />

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy || !canPush}
            onClick={() => {
              setConfirmOpen(true)
            }}
            type="button"
          >
            {t('membersPush.actions.pushNow')}
          </Button>
        </div>

        {settingsQuery.isLoading ? <p className="text-sm text-slate-600">{t('state.loading')}</p> : null}

        {pushMutation.isError ? <Alert>{toErrorMessage(pushMutation.error)}</Alert> : null}

        {lastResult ? (
          <div className="space-y-2 rounded-lg border border-outline-variant bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{t('membersPush.result.title')}</p>
            {lastResult.dry_run ? (
              <p className="text-sm text-slate-700">
                {t('membersPush.result.dryRunSummary', {
                  eligible: lastResult.dry_run_eligible_count ?? 0,
                  excluded: lastResult.dry_run_excluded_count ?? 0,
                })}
              </p>
            ) : (
              <div className="space-y-1 text-sm text-slate-700">
                <p>
                  {t('membersPush.result.summary', {
                    pushed: lastResult.pushed_count,
                    failed: lastResult.failed_count,
                  })}
                </p>
                {typeof lastResult.processed_count === 'number' ? (
                  <p>
                    Processed: {lastResult.processed_count}
                    {typeof lastResult.total_chunks === 'number' && typeof lastResult.chunk_size === 'number'
                      ? ` | Chunks: ${lastResult.total_chunks} x ${lastResult.chunk_size}`
                      : ''}
                  </p>
                ) : null}
                {typeof lastResult.created_count === 'number' && typeof lastResult.updated_count === 'number' ? (
                  <p>
                    Created: {lastResult.created_count} | Updated: {lastResult.updated_count} | Repaired erp_id:{' '}
                    {lastResult.repaired_erp_id_count ?? 0} | Skipped unchanged: {lastResult.skipped_unchanged_count ?? 0}
                  </p>
                ) : null}
              </div>
            )}

            {lastResult.dry_run ? (
              <Alert variant="success">{t('membersPush.result.dryRunSuccess')}</Alert>
            ) : lastResult.errors.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                {lastResult.errors.map((error, index) => (
                  <li key={`${error.pilot_id ?? 'pilot'}-${index}`}>
                    {error.pilot_id ?? t('membersPush.result.unknownPilot')}: {error.error_msg ?? t('membersPush.result.unknownError')}
                  </li>
                ))}
              </ul>
            ) : (
              <Alert variant="success">{t('membersPush.result.success')}</Alert>
            )}
          </div>
        ) : null}
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-labelledby="planche-members-push-confirm-title"
        aria-describedby="planche-members-push-confirm-body"
      >
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="planche-members-push-confirm-title" className="text-lg font-semibold text-slate-900">
              {t('membersPush.confirm.title')}
            </h2>
            {dryRunEnabled ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                {t('membersPush.confirm.dryRunBadge')}
              </span>
            ) : null}
          </div>

          <p id="planche-members-push-confirm-body" className="text-sm text-slate-600">
            {t('membersPush.confirm.description')}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('membersPush.preview.eligible')}</p>
              <p className="text-lg font-semibold text-slate-900">{eligibleCount}</p>
            </div>
            <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('membersPush.preview.excluded')}</p>
              <p className="text-lg font-semibold text-slate-900">{excludedCount}</p>
            </div>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              {t('membersPush.preview.excludedInactive')}: {preview?.excluded_inactive_count ?? 0}
            </p>
            <p>
              {t('membersPush.preview.excludedNoFly')}: {preview?.can_fly_false_count ?? 0}
            </p>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-outline-variant bg-slate-50 p-3 text-sm text-slate-800">
            <input
              checked={dryRunEnabled}
              type="checkbox"
              onChange={(event) => setDryRunEnabled(event.target.checked)}
            />
            <span>{t('membersPush.confirm.dryRunToggle')}</span>
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('membersPush.confirm.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!canPush || pushMutation.isPending || eligibleCount <= 0}
              onClick={() => {
                void handlePush()
              }}
            >
              {pushMutation.isPending
                ? t('membersPush.actions.pushing')
                : dryRunEnabled
                  ? t('membersPush.confirm.runDryRun')
                  : t('membersPush.confirm.push')}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}
