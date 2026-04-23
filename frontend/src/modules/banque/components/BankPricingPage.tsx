/*   
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Pricing management screen with fiscal year version timeline
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
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Copy, Trash2, Pencil, Check, X } from 'lucide-react'
import { AxiosError } from 'axios'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useFiscalYearsQuery,
  useCreateFiscalYearMutation,
  usePricingVersionsQuery,
  useCreatePricingVersionMutation,
  useUpdatePricingVersionMutation,
  useDeletePricingVersionMutation,
  useCopyPricingVersionsMutation,
  type FiscalYear,
  type PricingVersion,
} from '../api'

// ── Constants ────────────────────────────────────────────────────────────────

const VERSION_STATUS_DRAFT = 1
const VERSION_STATUS_ACTIVE = 2
const VERSION_STATUS_ARCHIVED = 3

const FY_STATE_OPEN = 1
const FY_STATE_CLOSED = 2

// ── Helpers ──────────────────────────────────────────────────────────────────

function fyStateLabel(state: number, t: (k: string) => string): { label: string; className: string } {
  if (state === FY_STATE_OPEN) return { label: t('pricing.fy.stateOpen'), className: 'bg-green-100 text-green-800' }
  if (state === FY_STATE_CLOSED) return { label: t('pricing.fy.stateClosed'), className: 'bg-slate-100 text-slate-600' }
  return { label: t('pricing.fy.stateReopened'), className: 'bg-amber-100 text-amber-800' }
}

function versionStatusLabel(status: number, t: (k: string) => string): { label: string; className: string } {
  if (status === VERSION_STATUS_DRAFT) return { label: t('pricing.version.statusDraft'), className: 'bg-yellow-100 text-yellow-800' }
  if (status === VERSION_STATUS_ACTIVE) return { label: t('pricing.version.statusActive'), className: 'bg-green-100 text-green-800' }
  return { label: t('pricing.version.statusArchived'), className: 'bg-slate-100 text-slate-600' }
}

/** Compute the % coverage of a version inside its fiscal year for the timeline bar */
function timelineBar(fy: FiscalYear, version: PricingVersion) {
  const fyStart = new Date(fy.start_date).getTime()
  const fyEnd = new Date(fy.end_date).getTime()
  const fyLen = fyEnd - fyStart
  const vStart = new Date(version.from_date).getTime()
  const vEnd = version.to_date ? new Date(version.to_date).getTime() : fyEnd
  const left = Math.max(0, Math.min(100, ((vStart - fyStart) / fyLen) * 100))
  const width = Math.max(1, Math.min(100 - left, ((vEnd - vStart) / fyLen) * 100))
  return { left: `${left.toFixed(1)}%`, width: `${width.toFixed(1)}%` }
}

// ── Sub-component: Fiscal Year Badge ─────────────────────────────────────────

function FyBadge({ state, t }: { state: number; t: (k: string) => string }) {
  const { label, className } = fyStateLabel(state, t)
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>
  )
}

// ── Sub-component: Version Status Badge ─────────────────────────────────────

function VersionBadge({ status, t }: { status: number; t: (k: string) => string }) {
  const { label, className } = versionStatusLabel(status, t)
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>
  )
}

// ── Sub-component: Inline version form ───────────────────────────────────────

type VersionFormState = {
  name: string
  from_date: string
  to_date: string
  status: number
}

function VersionForm({
  initial,
  onSave,
  onCancel,
  saving,
  t,
}: {
  initial: VersionFormState
  onSave: (v: VersionFormState) => void
  onCancel: () => void
  saving: boolean
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const [form, setForm] = useState<VersionFormState>(initial)

  function set(field: keyof VersionFormState, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
      <div className="space-y-1 md:col-span-2">
        <Label className="text-xs">{t('pricing.version.name')}</Label>
        <Input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={t('pricing.version.namePlaceholder')}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.version.fromDate')}</Label>
        <Input
          type="date"
          value={form.from_date}
          onChange={(e) => set('from_date', e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.version.toDate')}</Label>
        <Input
          type="date"
          value={form.to_date}
          onChange={(e) => set('to_date', e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.version.status')}</Label>
        <select
          value={form.status}
          onChange={(e) => set('status', Number(e.target.value))}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value={VERSION_STATUS_DRAFT}>{t('pricing.version.statusDraft')}</option>
          <option value={VERSION_STATUS_ACTIVE}>{t('pricing.version.statusActive')}</option>
          <option value={VERSION_STATUS_ARCHIVED}>{t('pricing.version.statusArchived')}</option>
        </select>
      </div>
      <div className="flex items-end gap-2 md:col-span-3">
        <Button
          size="sm"
          onClick={() => onSave(form)}
          disabled={saving || !form.name || !form.from_date}
        >
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('pricing.version.saving') : t('pricing.version.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1 h-3 w-3" />
          {t('pricing.version.cancel')}
        </Button>
      </div>
    </div>
  )
}

// ── Sub-component: New Fiscal Year form ──────────────────────────────────────

function NewFyForm({
  onSave,
  onCancel,
  saving,
  defaultYear,
  t,
}: {
  onSave: (v: { code: string; label: string; year: number; start_date: string; end_date: string }) => void
  onCancel: () => void
  saving: boolean
  defaultYear: number
  t: (k: string) => string
}) {
  const [year, setYear] = useState(String(defaultYear))
  const [code, setCode] = useState(`FY${defaultYear}`)
  const [label, setLabel] = useState(`Exercice ${defaultYear}`)
  const [startDate, setStartDate] = useState(`${defaultYear}-01-01`)
  const [endDate, setEndDate] = useState(`${defaultYear}-12-31`)

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.fy.year')}</Label>
        <Input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.fy.code')}</Label>
        <Input value={code} onChange={(e) => setCode(e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.fy.label')}</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.fy.startDate')}</Label>
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.fy.endDate')}</Label>
        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="flex items-end gap-2">
        <Button
          size="sm"
          onClick={() =>
            onSave({ code, label, year: Number(year), start_date: startDate, end_date: endDate })
          }
          disabled={saving || !code || !label || !year}
        >
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('pricing.fy.creating') : t('pricing.fy.create')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1 h-3 w-3" />
          {t('pricing.version.cancel')}
        </Button>
      </div>
    </div>
  )
}

// ── Sub-component: Version Timeline ──────────────────────────────────────────

function VersionTimeline({
  fy,
  versions,
  canEdit,
  t,
  onDelete,
  onEdit,
}: {
  fy: FiscalYear
  versions: PricingVersion[]
  canEdit: boolean
  t: (k: string, opts?: Record<string, unknown>) => string
  onDelete: (v: PricingVersion) => void
  onEdit: (v: PricingVersion) => void
}) {
  if (versions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
        {t('pricing.version.empty')}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Visual timeline */}
      <div className="relative h-6 rounded-md bg-slate-100">
        {versions.map((v) => {
          const { left, width } = timelineBar(fy, v)
          const { className } = versionStatusLabel(v.status, t)
          return (
            <div
              key={v.uuid}
              title={`${v.name} · ${v.from_date} → ${v.to_date ?? '∞'}`}
              className={`absolute top-0 h-full rounded ${className} opacity-80 transition-opacity hover:opacity-100`}
              style={{ left, width }}
            />
          )
        })}
      </div>

      {/* Version list */}
      <div className="space-y-2">
        {versions.map((v) => (
          <div
            key={v.uuid}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{v.name}</p>
              <p className="text-xs text-slate-500">
                {v.from_date} → {v.to_date ?? t('pricing.version.openEnd')}
              </p>
            </div>
            <VersionBadge status={v.status} t={t} />
            {v.is_locked && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                {t('pricing.version.locked')}
              </span>
            )}
            {canEdit && !v.is_locked && fy.state !== FY_STATE_CLOSED && (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title={t('pricing.version.editTitle')}
                  onClick={() => onEdit(v)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title={t('pricing.version.deleteTitle')}
                  onClick={() => onDelete(v)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function BankPricingPage() {
  const { t } = useTranslation('banque')
  const canManagePrices = useCapability('MANAGE_PRICES')
  const canView = useCapability('VIEW_FINANCIALS')

  const currentYear = new Date().getFullYear()

  // Data
  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const allFiscalYears = fiscalYearsQuery.data ?? []

  // Sort: future → current → past
  const sortedFiscalYears = useMemo(
    () => [...allFiscalYears].sort((a, b) => b.year - a.year),
    [allFiscalYears],
  )

  const futureFiscalYears = sortedFiscalYears.filter((fy) => fy.year > currentYear)
  const currentFiscalYears = sortedFiscalYears.filter(
    (fy) => fy.year === currentYear && fy.state !== FY_STATE_CLOSED,
  )
  const pastFiscalYears = sortedFiscalYears.filter(
    (fy) => fy.year < currentYear || fy.state === FY_STATE_CLOSED,
  )

  // Selected FY
  const defaultFy = currentFiscalYears[0] ?? futureFiscalYears[0] ?? pastFiscalYears[0] ?? null
  const [selectedFyUuid, setSelectedFyUuid] = useState<string | null>(null)
  const selectedFy =
    allFiscalYears.find((fy) => fy.uuid === (selectedFyUuid ?? defaultFy?.uuid)) ?? null

  // Pricing versions for selected FY
  const versionsQuery = usePricingVersionsQuery(selectedFy?.uuid ?? null, canView)
  const versions = versionsQuery.data ?? []

  // Mutations
  const createFyMutation = useCreateFiscalYearMutation()
  const createVersionMutation = useCreatePricingVersionMutation()
  const updateVersionMutation = useUpdatePricingVersionMutation(selectedFy?.uuid ?? '')
  const deleteVersionMutation = useDeletePricingVersionMutation(selectedFy?.uuid ?? '')
  const copyVersionsMutation = useCopyPricingVersionsMutation()

  // UI state
  const [showNewFyForm, setShowNewFyForm] = useState(false)
  const [showNewVersionForm, setShowNewVersionForm] = useState(false)
  const [editingVersion, setEditingVersion] = useState<PricingVersion | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The previous FY for copy operation
  const prevFy = selectedFy
    ? sortedFiscalYears.find((fy) => fy.year === selectedFy.year - 1) ?? null
    : null

  function handleSelectFy(uuid: string) {
    setSelectedFyUuid(uuid)
    setShowNewVersionForm(false)
    setEditingVersion(null)
    setError(null)
  }

  async function handleCreateFy(payload: {
    code: string
    label: string
    year: number
    start_date: string
    end_date: string
  }) {
    try {
      const created = await createFyMutation.mutateAsync(payload)
      setShowNewFyForm(false)
      setSelectedFyUuid(created.uuid)
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  async function handleCreateVersion(form: VersionFormState) {
    if (!selectedFy) return
    try {
      await createVersionMutation.mutateAsync({
        fiscal_year_uuid: selectedFy.uuid,
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
      })
      setShowNewVersionForm(false)
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  async function handleUpdateVersion(form: VersionFormState) {
    if (!editingVersion) return
    try {
      await updateVersionMutation.mutateAsync({
        uuid: editingVersion.uuid,
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
      })
      setEditingVersion(null)
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  async function handleDeleteVersion(v: PricingVersion) {
    if (!window.confirm(t('pricing.version.confirmDelete', { name: v.name }))) return
    try {
      await deleteVersionMutation.mutateAsync(v.uuid)
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  async function handleCopyFromPrev() {
    if (!selectedFy || !prevFy) return
    if (!window.confirm(t('pricing.version.confirmCopy', { from: prevFy.code, to: selectedFy.code })))
      return
    try {
      await copyVersionsMutation.mutateAsync({
        source_fiscal_year_uuid: prevFy.uuid,
        target_fiscal_year_uuid: selectedFy.uuid,
      })
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  function extractError(e: unknown): string {
    if (e instanceof AxiosError && e.response?.data?.detail) {
      return String(e.response.data.detail)
    }
    return t('pricing.error.generic')
  }

  const isFyClosed = selectedFy?.state === FY_STATE_CLOSED
  const canEditVersions = canManagePrices && !isFyClosed
  const nextDefaultYear = (sortedFiscalYears[0]?.year ?? currentYear) + 1

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('pricing.noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{t('pricing.title')}</h1>
            <p className="text-sm text-slate-600">{t('pricing.description')}</p>
          </div>
          {canManagePrices && !showNewFyForm && (
            <Button size="sm" variant="outline" onClick={() => setShowNewFyForm(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('pricing.fy.new')}
            </Button>
          )}
        </div>

        {showNewFyForm && (
          <div className="mt-4">
            <NewFyForm
              defaultYear={nextDefaultYear}
              saving={createFyMutation.isPending}
              t={t}
              onSave={handleCreateFy}
              onCancel={() => setShowNewFyForm(false)}
            />
          </div>
        )}
      </div>

      {fiscalYearsQuery.isLoading && (
        <p className="text-sm text-slate-500">{t('pricing.loading')}</p>
      )}

      {/* Fiscal year tabs */}
      {allFiscalYears.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* FY selector strip */}
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
            {/* Future fiscal years */}
            {futureFiscalYears.map((fy) => (
              <button
                key={fy.uuid}
                type="button"
                onClick={() => handleSelectFy(fy.uuid)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  (selectedFyUuid ?? defaultFy?.uuid) === fy.uuid
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {fy.code}
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                  {t('pricing.fy.upcoming')}
                </span>
              </button>
            ))}

            {/* Current fiscal years */}
            {currentFiscalYears.map((fy) => (
              <button
                key={fy.uuid}
                type="button"
                onClick={() => handleSelectFy(fy.uuid)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  (selectedFyUuid ?? defaultFy?.uuid) === fy.uuid
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {fy.code}
                <FyBadge state={fy.state} t={t} />
              </button>
            ))}

            {/* Past fiscal years */}
            {pastFiscalYears.length > 0 && (
              <select
                value={
                  pastFiscalYears.some((fy) => fy.uuid === (selectedFyUuid ?? defaultFy?.uuid))
                    ? (selectedFyUuid ?? defaultFy?.uuid)
                    : ''
                }
                onChange={(e) => e.target.value && handleSelectFy(e.target.value)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">{t('pricing.fy.selectHistory')}</option>
                {pastFiscalYears.map((fy) => (
                  <option key={fy.uuid} value={fy.uuid}>
                    {fy.code} — {t(`pricing.fy.state${fy.state === FY_STATE_CLOSED ? 'Closed' : 'Open'}`)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Selected FY content */}
          {selectedFy && (
            <div className="p-6 space-y-4">
              {/* FY info bar */}
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{selectedFy.label}</h2>
                <FyBadge state={selectedFy.state} t={t} />
                <span className="text-sm text-slate-500">
                  {selectedFy.start_date} → {selectedFy.end_date}
                </span>
                {isFyClosed && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {t('pricing.fy.readOnly')}
                  </span>
                )}
              </div>

              {/* Error banner */}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {error}
                  <button
                    type="button"
                    className="ml-2 text-red-400 hover:text-red-600"
                    onClick={() => setError(null)}
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Actions row */}
              <div className="flex flex-wrap gap-2">
                {canEditVersions && !showNewVersionForm && !editingVersion && (
                  <Button size="sm" onClick={() => setShowNewVersionForm(true)}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('pricing.version.new')}
                  </Button>
                )}
                {canEditVersions && prevFy && !showNewVersionForm && !editingVersion && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={copyVersionsMutation.isPending}
                    onClick={handleCopyFromPrev}
                  >
                    <Copy className="mr-1 h-4 w-4" />
                    {copyVersionsMutation.isPending
                      ? t('pricing.version.copying')
                      : t('pricing.version.copyFrom', { code: prevFy.code })}
                  </Button>
                )}
              </div>

              {/* New version form */}
              {showNewVersionForm && (
                <VersionForm
                  initial={{
                    name: '',
                    from_date: selectedFy.start_date,
                    to_date: selectedFy.end_date,
                    status: VERSION_STATUS_DRAFT,
                  }}
                  saving={createVersionMutation.isPending}
                  t={t}
                  onSave={handleCreateVersion}
                  onCancel={() => setShowNewVersionForm(false)}
                />
              )}

              {/* Edit version form */}
              {editingVersion && (
                <VersionForm
                  initial={{
                    name: editingVersion.name,
                    from_date: editingVersion.from_date,
                    to_date: editingVersion.to_date ?? '',
                    status: editingVersion.status,
                  }}
                  saving={updateVersionMutation.isPending}
                  t={t}
                  onSave={handleUpdateVersion}
                  onCancel={() => setEditingVersion(null)}
                />
              )}

              {/* Versions timeline */}
              {versionsQuery.isLoading ? (
                <p className="text-sm text-slate-500">{t('pricing.loading')}</p>
              ) : (
                <VersionTimeline
                  fy={selectedFy}
                  versions={versions}
                  canEdit={canEditVersions}
                  t={t}
                  onDelete={handleDeleteVersion}
                  onEdit={(v) => {
                    setEditingVersion(v)
                    setShowNewVersionForm(false)
                  }}
                />
              )}
            </div>
          )}

          {allFiscalYears.length > 0 && !selectedFy && (
            <p className="p-6 text-sm text-slate-500">{t('pricing.fy.selectPrompt')}</p>
          )}
        </div>
      )}

      {!fiscalYearsQuery.isLoading && allFiscalYears.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">{t('pricing.fy.empty')}</p>
          {canManagePrices && !showNewFyForm && (
            <Button className="mt-3" size="sm" onClick={() => setShowNewFyForm(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('pricing.fy.new')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
