/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque/pricing: Page dédiée à l'édition d'une version tarifaire et de ses articles
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
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Pencil } from 'lucide-react'
import { AxiosError } from 'axios'

import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useFiscalYearsQuery,
  usePricingVersionsQuery,
  useUpdatePricingVersionMutation,
} from '../api'
import {
  VERSION_STATUS_ACTIVE,
  VERSION_STATUS_DRAFT,
  FY_STATE_CLOSED,
  versionScopeLabel,
  VersionBadge,
  ActivateVersionButton,
  VersionForm,
  PricingItemsPanel,
  type VersionFormState,
} from './pricingShared'

export function BankPricingVersionEditPage() {
  const { fiscalYearUuid, versionUuid } = useParams<{ fiscalYearUuid: string; versionUuid: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('banque')

  const canView = useCapability('VIEW_FINANCIALS')
  const canManagePrices = useCapability('MANAGE_PRICES')

  // FY data for breadcrumb and context
  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const selectedFy = (fiscalYearsQuery.data ?? []).find((fy) => fy.uuid === fiscalYearUuid) ?? null

  // Version data — fetched from the FY versions list (cached from the list page)
  const versionsQuery = usePricingVersionsQuery(fiscalYearUuid ?? null, canView)
  const version = (versionsQuery.data ?? []).find((v) => v.uuid === versionUuid) ?? null

  // Mutations
  const updateVersionMutation = useUpdatePricingVersionMutation(fiscalYearUuid ?? '')

  // UI state
  const [editingMeta, setEditingMeta] = useState(false)
  const [confirmActivate, setConfirmActivate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isFyClosed = selectedFy?.state === FY_STATE_CLOSED
  const canEdit =
    canManagePrices && !isFyClosed && version?.status === VERSION_STATUS_DRAFT && !version?.is_locked

  function extractError(e: unknown): string {
    if (e instanceof AxiosError && e.response?.data?.detail) return String(e.response.data.detail)
    return t('pricing.error.generic')
  }

  async function handleUpdateVersion(form: VersionFormState) {
    if (!version) return
    try {
      await updateVersionMutation.mutateAsync({
        uuid: version.uuid,
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
      })
      setEditingMeta(false)
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  async function handleActivate() {
    if (!version) return
    try {
      await updateVersionMutation.mutateAsync({ uuid: version.uuid, status: VERSION_STATUS_ACTIVE })
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-outline-variant bg-white p-6 shadow-sm">
        <p className="text-sm text-on-surface-variant">{t('pricing.noPermission')}</p>
      </section>
    )
  }

  const scope = version ? versionScopeLabel(version, t) : null

  return (
    <section className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-on-surface-variant" aria-label="breadcrumb">
        <button
          type="button"
          onClick={() => navigate('/banque/pricing')}
          className="hover:text-on-surface hover:underline"
        >
          {t('pricing.title')}
        </button>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <button
          type="button"
          onClick={() => navigate('/banque/pricing')}
          className="hover:text-on-surface hover:underline"
        >
          {selectedFy?.code ?? '…'}
        </button>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-on-surface">{version?.name ?? '…'}</span>
      </nav>

      {/* Version metadata card */}
      <div className="rounded-xl border border-outline-variant bg-white p-6 shadow-sm">
        {versionsQuery.isLoading || fiscalYearsQuery.isLoading ? (
          <p className="text-sm text-on-surface-variant">{t('pricing.loading')}</p>
        ) : !version ? (
          <div className="space-y-3">
            <p className="text-sm text-error">{t('pricing.version.notFound')}</p>
            <Button size="sm" variant="ghost" onClick={() => navigate('/banque/pricing')}>
              ← {t('pricing.title')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-on-surface">{version.name}</h1>
                  {scope && (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${scope.className}`}>
                      {scope.label}
                    </span>
                  )}
                  <VersionBadge status={version.status} t={t} />
                  {version.is_locked && (
                    <span className="rounded-full bg-error-container px-2 py-0.5 text-xs text-error">
                      {t('pricing.version.locked')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-on-surface-variant">
                  {version.from_date} → {version.to_date ?? t('pricing.version.openEnd')}
                  {selectedFy && <> · {selectedFy.label}</>}
                </p>
              </div>

              {canEdit && !editingMeta && (
                <div className="flex flex-wrap items-start gap-3">
                  <ActivateVersionButton
                    version={version}
                    onActivate={() => setConfirmActivate(true)}
                    disabled={updateVersionMutation.isPending}
                    t={t}
                  />
                  <Button size="sm" variant="secondary" onClick={() => setEditingMeta(true)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    {t('pricing.version.editMetaTitle')}
                  </Button>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-error bg-error-container px-4 py-2 text-sm text-error">
                {error}
                <button
                  type="button"
                  className="ml-2 opacity-60 hover:opacity-100"
                  onClick={() => setError(null)}
                >
                  ×
                </button>
              </div>
            )}

            {editingMeta && (
              <div className="mt-4">
                <VersionForm
                  initial={{
                    name: version.name,
                    from_date: version.from_date,
                    to_date: version.to_date ?? '',
                    status: version.status,
                  }}
                  saving={updateVersionMutation.isPending}
                  t={t}
                  onSave={handleUpdateVersion}
                  onCancel={() => setEditingMeta(false)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Items card */}
      {version && (
        <div className="rounded-xl border border-outline-variant bg-white p-6 shadow-sm">
          <PricingItemsPanel version={version} canEdit={!!canEdit} />
        </div>
      )}

      {/* Confirm activate dialog */}
      {confirmActivate && version && (
        <ConfirmDialog
          open={confirmActivate}
          title={t('pricing.version.confirmActivateTitle')}
          body={t('pricing.version.confirmActivateBody')}
          confirmLabel={t('pricing.version.activate')}
          onConfirm={() => {
            setConfirmActivate(false)
            handleActivate()
          }}
          onCancel={() => setConfirmActivate(false)}
        />
      )}
    </section>
  )
}
