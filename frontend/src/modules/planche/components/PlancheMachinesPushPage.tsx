/*
    ERP-CLUB - ERP pour Club de vol a voile
    - Logiciel libre de gestion d'un club de vol a voile
    - planche: manual machines push page for Planche integration
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
  useMachinesPushMutation,
  useMachinesPushPreviewQuery,
  usePlancheSettingsQuery,
  type PlancheMachinesPushResponse,
} from '../api'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }

    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) {
      return response.data.message
    }

    if (detail && typeof detail === 'object' && 'message' in detail) {
      const message = (detail as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) {
        return message
      }
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

export function PlancheMachinesPushPage() {
  const { t } = useTranslation('planche')

  const settingsQuery = usePlancheSettingsQuery(true)
  const previewQuery = useMachinesPushPreviewQuery(true)
  const pushMutation = useMachinesPushMutation()

  const [lastResult, setLastResult] = useState<PlancheMachinesPushResponse | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const canPush = useMemo(() => {
    if (!settingsQuery.data?.settings) {
      return false
    }
    return isSettingsConfigured(settingsQuery.data.settings)
  }, [settingsQuery.data])

  const busy = settingsQuery.isLoading || previewQuery.isLoading || pushMutation.isPending

  const preview = previewQuery.data
  const eligibleCount = preview?.eligible_count ?? 0
  const previewLastSync = preview?.last_synced_at

  async function handlePush() {
    const response = await pushMutation.mutateAsync()
    setLastResult(response)
    setConfirmOpen(false)
    void previewQuery.refetch()
  }

  return (
    <section className="space-y-4">
      <div className="space-y-4 rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-900">{t('machinesPush.card.title')}</h2>
          <p className="text-sm text-slate-600">{t('machinesPush.card.description')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('machinesPush.status.settings')}</p>
            <p className={canPush ? 'text-sm font-medium text-green-700' : 'text-sm font-medium text-amber-700'}>
              {canPush ? t('machinesPush.status.ready') : t('machinesPush.status.missing')}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('machinesPush.status.lastSync')}</p>
            <p className="text-sm font-medium text-slate-900">
              {(lastResult?.last_synced_at ?? previewLastSync)
                ? new Date(lastResult?.last_synced_at ?? previewLastSync ?? '').toLocaleString()
                : t('machinesPush.status.never')}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('machinesPush.preview.eligible')}</p>
          <p className="text-xl font-semibold text-slate-900">{eligibleCount}</p>
        </div>

        {!canPush ? <Alert>{t('machinesPush.validation.configureFirst')}</Alert> : null}
        {previewQuery.isError ? <Alert>{toErrorMessage(previewQuery.error)}</Alert> : null}

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy || !canPush}
            onClick={() => {
              setConfirmOpen(true)
            }}
            type="button"
          >
            {t('machinesPush.actions.pushNow')}
          </Button>
        </div>

        {settingsQuery.isLoading ? <p className="text-sm text-slate-600">{t('state.loading')}</p> : null}
        {pushMutation.isError ? <Alert>{toErrorMessage(pushMutation.error)}</Alert> : null}

        {lastResult ? (
          <div className="space-y-2 rounded-lg border border-outline-variant bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{t('machinesPush.result.title')}</p>
            <p className="text-sm text-slate-700">
              {t('machinesPush.result.summary', {
                pushed: lastResult.pushed_count,
                failed: lastResult.failed_count,
              })}
            </p>

            {lastResult.errors.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                {lastResult.errors.map((error, index) => (
                  <li key={`machine-${index}`}>{error}</li>
                ))}
              </ul>
            ) : (
              <Alert variant="success">{t('machinesPush.result.success')}</Alert>
            )}
          </div>
        ) : null}
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-labelledby="planche-machines-push-confirm-title"
        aria-describedby="planche-machines-push-confirm-body"
      >
        <div className="space-y-4 p-6">
          <h2 id="planche-machines-push-confirm-title" className="text-lg font-semibold text-slate-900">
            {t('machinesPush.confirm.title')}
          </h2>

          <p id="planche-machines-push-confirm-body" className="text-sm text-slate-600">
            {t('machinesPush.confirm.description')}
          </p>

          <div className="rounded-lg border border-outline-variant bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('machinesPush.preview.eligible')}</p>
            <p className="text-lg font-semibold text-slate-900">{eligibleCount}</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('machinesPush.confirm.cancel')}
            </Button>
            <Button disabled={busy || !canPush} onClick={() => { void handlePush() }} type="button">
              {pushMutation.isPending ? t('machinesPush.actions.pushing') : t('machinesPush.confirm.push')}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}
