/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Asset detail page: lifecycle summary and accounting references
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
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AxiosError } from 'axios'
import Decimal from 'decimal.js'
import { Pencil, BarChart3, ArrowLeft } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useAssetQuery, useTransitionAssetStatusMutation } from '../api'
import type { AssetStatusHistoryEntry } from '../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<number, string> = {
  1: 'operational',
  2: 'maintenance',
  3: 'outOfService',
  4: 'disposed',
}

const STATUS_COLORS: Record<number, string> = {
  1: 'bg-green-100 text-green-800',
  2: 'bg-amber-100 text-amber-800',
  3: 'bg-red-100 text-red-800',
  4: 'bg-slate-100 text-slate-500',
}

const NEXT_STATUSES: Record<number, number[]> = {
  1: [2, 3, 4],
  2: [1, 3, 4],
  3: [1, 2, 4],
  4: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDecimal(value: string | null): string {
  if (!value) return '—'
  try {
    return new Decimal(value).toFixed(2)
  } catch {
    return value
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

// ── Status Timeline ───────────────────────────────────────────────────────────

function StatusTimeline({
  history,
  t,
}: {
  history: AssetStatusHistoryEntry[]
  t: (k: string) => string
}) {
  if (history.length === 0) {
    return (
      <p className="text-xs text-slate-500">{t('assets.detail.noHistory')}</p>
    )
  }

  return (
    <ol className="space-y-2">
      {[...history].reverse().map((entry) => (
        <li key={entry.uuid} className="flex items-start gap-3">
          <span
            className={`mt-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[entry.status] ?? 'bg-slate-100 text-slate-500'}`}
          >
            {t(`assets.status.${STATUS_LABELS[entry.status] ?? 'unknown'}`)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">
              {formatDate(entry.changed_at)}
              {entry.changed_by != null && ` · #${entry.changed_by}`}
            </p>
            {entry.reason && <p className="text-xs text-slate-700">{entry.reason}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

// ── Status Transition Form ────────────────────────────────────────────────────

function TransitionForm({
  currentStatus,
  onTransition,
  saving,
  t,
}: {
  currentStatus: number
  onTransition: (status: number, reason: string) => void
  saving: boolean
  t: (k: string) => string
}) {
  const [status, setStatus] = useState<number>(NEXT_STATUSES[currentStatus]?.[0] ?? 1)
  const [reason, setReason] = useState('')

  const nextStatuses = NEXT_STATUSES[currentStatus] ?? []
  if (nextStatuses.length === 0) return null

  return (
    <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
      <div className="space-y-1">
        <Label className="text-xs">{t('assets.detail.newStatus')}</Label>
        <select
          value={status}
          onChange={(e) => setStatus(Number(e.target.value))}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {nextStatuses.map((s) => (
            <option key={s} value={s}>
              {t(`assets.status.${STATUS_LABELS[s]}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">{t('assets.detail.transitionReason')}</Label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('assets.detail.reasonPlaceholder')}
          className="h-8 text-sm"
        />
      </div>
      <div className="flex items-end sm:col-span-3">
        <Button
          size="sm"
          onClick={() => onTransition(status, reason)}
          disabled={saving}
        >
          {saving ? t('assets.detail.transitioning') : t('assets.detail.applyTransition')}
        </Button>
      </div>
    </div>
  )
}

// ── Info Row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-medium text-slate-800">{value ?? '—'}</span>
    </div>
  )
}

// ── Depreciation Summary ──────────────────────────────────────────────────────

function DepreciationSummary({
  purchasePrice,
  residualValue,
  depreciationStartDate,
  durationMonths,
  t,
}: {
  purchasePrice: string | null
  residualValue: string | null
  depreciationStartDate: string | null
  durationMonths: number | null
  t: (k: string) => string
}) {
  let annualDepreciation = '—'
  let depreciableBase = '—'
  let elapsedMonths = '—'
  let remainingMonths = '—'
  let bookValue = '—'

  try {
    if (purchasePrice && durationMonths) {
      const price = new Decimal(purchasePrice)
      const residual = residualValue ? new Decimal(residualValue) : new Decimal(0)
      const base = price.minus(residual)
      depreciableBase = base.toFixed(2)
      annualDepreciation = base.dividedBy(durationMonths).times(12).toFixed(2)

      if (depreciationStartDate) {
        const start = new Date(depreciationStartDate)
        const now = new Date()
        const elapsed = Math.max(
          0,
          (now.getFullYear() - start.getFullYear()) * 12 +
            (now.getMonth() - start.getMonth()),
        )
        elapsedMonths = String(Math.min(elapsed, durationMonths))
        remainingMonths = String(Math.max(0, durationMonths - elapsed))
        const accumulated = base.dividedBy(durationMonths).times(Math.min(elapsed, durationMonths))
        bookValue = Decimal.max(price.minus(accumulated), residual).toFixed(2)
      }
    }
  } catch {
    // non-critical: keep defaults
  }

  return (
    <div className="space-y-0.5">
      <InfoRow label={t('assets.detail.depreciableBase')} value={depreciableBase} />
      <InfoRow label={t('assets.detail.annualDepreciation')} value={annualDepreciation} />
      <InfoRow label={t('assets.detail.elapsedMonths')} value={elapsedMonths} />
      <InfoRow label={t('assets.detail.remainingMonths')} value={remainingMonths} />
      <InfoRow label={t('assets.detail.bookValue')} value={bookValue} />
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AssetDetailPage() {
  const { t } = useTranslation('assets')
  const navigate = useNavigate()
  const { uuid } = useParams<{ uuid: string }>()
  const canManage = useCapability('MANAGE_ASSETS')

  const assetQuery = useAssetQuery(uuid ?? null)
  const asset = assetQuery.data ?? null

  const transitionMutation = useTransitionAssetStatusMutation(uuid ?? '')
  const [transitionError, setTransitionError] = useState<string | null>(null)

  async function handleTransition(status: number, reason: string) {
    try {
      await transitionMutation.mutateAsync({ status, reason: reason || null })
      setTransitionError(null)
    } catch (e) {
      setTransitionError(extractError(e, t('assets.error.transitionFailed')))
    }
  }

  if (assetQuery.isLoading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('assets.states.loading')}</p>
      </section>
    )
  }

  if (!asset) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('assets.states.notFound')}</p>
      </section>
    )
  }

  const currentStatusColor = STATUS_COLORS[asset.status] ?? 'bg-slate-100 text-slate-500'
  const currentStatusKey = STATUS_LABELS[asset.status] ?? 'unknown'

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              className="mb-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
              onClick={() => navigate('/assets')}
            >
              <ArrowLeft className="h-3 w-3" />
              {t('assets.actions.backToList')}
            </button>
            <h1 className="text-xl font-semibold text-slate-900">{asset.name}</h1>
            <p className="mt-0.5 text-sm text-slate-500">{asset.code}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${currentStatusColor}`}>
              {t(`assets.status.${currentStatusKey}`)}
            </span>
            {canManage && (
              <Button size="sm" variant="ghost" onClick={() => navigate(`/assets/${uuid}/edit`)}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t('assets.actions.edit')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => navigate(`/assets/${uuid}/pricing`)}>
              <BarChart3 className="mr-1 h-3.5 w-3.5" />
              {t('assets.actions.pricing')}
            </Button>
          </div>
        </div>
      </div>

      {transitionError && (
        <Alert>
          <p className="text-sm">{transitionError}</p>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Identity card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('assets.detail.identity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              <InfoRow label={t('assets.form.type')} value={asset.asset_type_uuid} />
              <InfoRow label={t('assets.form.registrationNumber')} value={asset.registration_number} />
              <InfoRow label={t('assets.form.serialNumber')} value={asset.serial_number} />
              <InfoRow label={t('assets.form.manufacturer')} value={asset.manufacturer} />
              <InfoRow label={t('assets.form.model')} value={asset.model} />
              <InfoRow label={t('assets.form.yearOfManufacture')} value={asset.year_of_manufacture} />
              <InfoRow
                label={t('assets.form.ownership')}
                value={
                  asset.ownership === 1
                    ? t('assets.ownership.club')
                    : t('assets.ownership.private')
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Depreciation summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('assets.detail.depreciationSummary')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 space-y-0.5">
              <InfoRow label={t('assets.form.purchaseDate')} value={formatDate(asset.purchase_date)} />
              <InfoRow
                label={t('assets.form.purchasePrice')}
                value={formatDecimal(asset.purchase_price)}
              />
              <InfoRow
                label={t('assets.form.depreciationStartDate')}
                value={formatDate(asset.depreciation_start_date)}
              />
              <InfoRow
                label={t('assets.form.depreciationMonths')}
                value={asset.depreciation_duration_months}
              />
              <InfoRow
                label={t('assets.form.residualValue')}
                value={formatDecimal(asset.residual_value)}
              />
            </div>
            <DepreciationSummary
              purchasePrice={asset.purchase_price}
              residualValue={asset.residual_value}
              depreciationStartDate={asset.depreciation_start_date}
              durationMonths={asset.depreciation_duration_months}
              t={t}
            />
          </CardContent>
        </Card>

        {/* Accounting references */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('assets.detail.accountingRefs')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              <InfoRow
                label={t('assets.form.acquisitionAccountUuid')}
                value={asset.acquisition_account_uuid}
              />
              <InfoRow
                label={t('assets.detail.accountCodeSnapshot')}
                value={asset.accounting_account_code_snapshot}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lifecycle / status transitions */}
      {canManage && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">{t('assets.detail.lifecycle')}</h2>
          <StatusTimeline history={asset.status_history} t={t} />
          <TransitionForm
            currentStatus={asset.status}
            onTransition={handleTransition}
            saving={transitionMutation.isPending}
            t={t}
          />
        </div>
      )}
    </section>
  )
}
