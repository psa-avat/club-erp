/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Pricing management screen with fiscal year version list
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
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Copy, Trash2, Pencil, Check, X, ChevronDown, ChevronRight, Package } from 'lucide-react'
import { AxiosError } from 'axios'

import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { Dialog } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useFiscalYearsQuery,
  useCreateFiscalYearMutation,
  usePricingVersionsQuery,
  usePricingItemsQuery,
  useCreatePricingVersionMutation,
  useUpdatePricingVersionMutation,
  useDeletePricingVersionMutation,
  useClonePricingVersionMutation,
  useCopyPricingVersionsMutation,
  type FiscalYear,
  type PricingVersion,
} from '../api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import {
  VERSION_STATUS_DRAFT,
  VERSION_STATUS_ACTIVE,
  VERSION_STATUS_ARCHIVED,
  FY_STATE_CLOSED,
  fyStateLabel,
  versionStatusLabel,
  versionScopeLabel,
  todayIsoDate,
  addDaysIsoDate,
  VersionBadge,
  ActivateVersionButton,
  VersionForm,
  type VersionFormState,
} from './pricingShared'

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    <div className="grid gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-4 md:grid-cols-3">
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.fy.year')}</Label>
        <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="h-8 text-sm" />
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
          onClick={() => onSave({ code, label, year: Number(year), start_date: startDate, end_date: endDate })}
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

// ── Sub-component: Version Timeline (list view, no inline edit) ───────────────

function VersionTimeline({
  fy, versions, canEdit, activationDisabled, expandedUuid, onToggleExpand, t,
  onDelete, onEdit, onActivate, onRevertToDraft, onArchive, onClone,
}: {
  fy: FiscalYear
  versions: PricingVersion[]
  canEdit: boolean
  activationDisabled: boolean
  expandedUuid: string | null
  onToggleExpand: (uuid: string) => void
  t: (k: string, opts?: Record<string, unknown>) => string
  onDelete: (v: PricingVersion) => void
  onEdit: (v: PricingVersion) => void
  onActivate: (v: PricingVersion) => void
  onRevertToDraft: (v: PricingVersion) => void
  onArchive: (v: PricingVersion) => void
  onClone: (v: PricingVersion) => void
}) {
  if (versions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-outline-variant p-4 text-center text-sm text-on-surface-variant">
        {t('pricing.version.empty')}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Visual timeline */}
      <div className="relative h-6 rounded-shape-sm bg-surface-container">
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
        {versions.map((v) => {
          const scope = versionScopeLabel(v, t)
          return (
            <div key={v.uuid}>
              <div
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-outline-variant bg-white px-4 py-2"
                onClick={() => onToggleExpand(v.uuid)}
              >
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface"
                  onClick={(e) => { e.stopPropagation(); onToggleExpand(v.uuid); }}
                >
                  {expandedUuid === v.uuid ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{v.name}</p>
                  <p className="text-xs text-on-surface-variant">
                    {v.from_date} → {v.to_date ?? t('pricing.version.openEnd')}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${scope.className}`}>{scope.label}</span>
                <VersionBadge status={v.status} t={t} />
                {v.is_locked && (
                  <span className="rounded-full bg-error-container px-2 py-0.5 text-xs text-error">
                    {t('pricing.version.locked')}
                  </span>
                )}
                {canEdit && !v.is_locked && v.status === VERSION_STATUS_DRAFT && fy.state !== FY_STATE_CLOSED && (
                  <div className="flex shrink-0 items-start gap-1" onClick={(e) => e.stopPropagation()}>
                    <ActivateVersionButton version={v} onActivate={onActivate} disabled={activationDisabled} t={t} />
                    <button
                      type="button"
                      className="rounded p-1 text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface"
                      title={t('pricing.version.editTitle')}
                      onClick={() => onEdit(v)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                      title={t('pricing.version.deleteTitle')}
                      onClick={() => onDelete(v)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {canEdit && !v.is_locked && v.status === VERSION_STATUS_ACTIVE && fy.state !== FY_STATE_CLOSED && (
                  <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-lowest"
                      title={t('pricing.version.cloneTitle')}
                      onClick={() => onClone(v)}
                    >
                      {t('pricing.version.clone')}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-on-warning-container hover:bg-warning-container"
                      title={t('pricing.version.archiveTitle')}
                      onClick={() => onArchive(v)}
                    >
                      {t('pricing.version.archive')}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-lowest"
                      title={t('pricing.version.revertTitle')}
                      onClick={() => onRevertToDraft(v)}
                    >
                      {t('pricing.version.revert')}
                    </button>
                  </div>
                )}
              </div>
              {expandedUuid === v.uuid && (
                <div className="border-x border-b border-outline-variant rounded-b-lg bg-surface-container-lowest px-6 py-3">
                  <VersionItemsList versionUuid={v.uuid} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Sub-component: Expanded version items list ────────────────────────────────

function VersionItemsList({ versionUuid }: { versionUuid: string }) {
  const { t } = useTranslation('assets')
  const itemsQuery = usePricingItemsQuery(versionUuid, true)
  const items = itemsQuery.data ?? []

  if (itemsQuery.isLoading) {
    return <p className="text-xs text-on-surface-variant">{t('states.loading')}</p>
  }

  if (items.length === 0) {
    return (
      <p className="rounded border border-dashed border-outline-variant py-3 text-center text-xs text-on-surface-variant">
        {t('pricing.noItems')}
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div
          key={item.uuid}
          className="flex items-center gap-3 rounded-shape-sm border border-outline-variant bg-white px-3 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-on-surface">{item.name}</p>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              {item.base_price} €
              {item.gl_account_credit_uuid && (
                <> · Compte: {item.gl_account_credit_uuid.slice(0, 8)}…</>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function BankPricingPage() {
  const { t } = useTranslation('banque')
  const navigate = useNavigate()
  const canManagePrices = useCapability('MANAGE_PRICES')
  const canView = useCapability('VIEW_FINANCIALS')

  const currentYear = new Date().getFullYear()

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const allFiscalYears = fiscalYearsQuery.data ?? []

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

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

  const defaultFy = allFiscalYears.find((fy) => fy.uuid === activeFiscalYearUuid)
    ?? currentFiscalYears[0] ?? futureFiscalYears[0] ?? pastFiscalYears[0] ?? null
  const [selectedFyUuid, setSelectedFyUuid] = useState<string | null>(null)
  const selectedFy =
    allFiscalYears.find((fy) => fy.uuid === (selectedFyUuid ?? defaultFy?.uuid)) ?? null

  const versionsQuery = usePricingVersionsQuery(selectedFy?.uuid ?? null, canView)
  const versions = versionsQuery.data ?? []

  const createFyMutation = useCreateFiscalYearMutation()
  const createVersionMutation = useCreatePricingVersionMutation()
  const updateVersionMutation = useUpdatePricingVersionMutation(selectedFy?.uuid ?? '')
  const deleteVersionMutation = useDeletePricingVersionMutation(selectedFy?.uuid ?? '')
  const cloneVersionMutation = useClonePricingVersionMutation(selectedFy?.uuid ?? '')
  const copyVersionsMutation = useCopyPricingVersionsMutation()

  const [showNewFyForm, setShowNewFyForm] = useState(false)
  const [showNewVersionForm, setShowNewVersionForm] = useState(false)
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<PricingVersion | null>(null)
  const [confirmActivateVersion, setConfirmActivateVersion] = useState<PricingVersion | null>(null)
  const [confirmRevertVersion, setConfirmRevertVersion] = useState<PricingVersion | null>(null)
  const [confirmCopyFromPrev, setConfirmCopyFromPrev] = useState(false)
  const [archiveVersion, setArchiveVersion] = useState<PricingVersion | null>(null)
  const [archiveEndDate, setArchiveEndDate] = useState(todayIsoDate())
  const [archiveCreateNext, setArchiveCreateNext] = useState(true)
  const [archiveNextName, setArchiveNextName] = useState('')
  const [archiveNextFromDate, setArchiveNextFromDate] = useState(todayIsoDate())
  const [cloneSourceVersion, setCloneSourceVersion] = useState<PricingVersion | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloneFromDate, setCloneFromDate] = useState(todayIsoDate())
  const [cloneToDate, setCloneToDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expandedVersionUuid, setExpandedVersionUuid] = useState<string | null>(null)

  const prevFy = selectedFy
    ? sortedFiscalYears.find((fy) => fy.year === selectedFy.year - 1) ?? null
    : null

  function handleSelectFy(uuid: string) {
    setSelectedFyUuid(uuid)
    setShowNewVersionForm(false)
    setError(null)
  }

  function handleToggleExpandVersion(uuid: string) {
    setExpandedVersionUuid((prev) => (prev === uuid ? null : uuid))
  }

  async function handleCreateFy(payload: {
    code: string; label: string; year: number; start_date: string; end_date: string
  }) {
    try {
      const created = await createFyMutation.mutateAsync(payload)
      setShowNewFyForm(false)
      setSelectedFyUuid(created.uuid)
      setError(null)
    } catch (e) { setError(extractError(e)) }
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
    } catch (e) { setError(extractError(e)) }
  }

  async function handleDeleteVersion(v: PricingVersion) {
    try {
      await deleteVersionMutation.mutateAsync(v.uuid)
      setError(null)
    } catch (e) { setError(extractError(e)) }
  }

  async function handleCopyFromPrev() {
    if (!selectedFy || !prevFy) return
    try {
      await copyVersionsMutation.mutateAsync({
        source_fiscal_year_uuid: prevFy.uuid,
        target_fiscal_year_uuid: selectedFy.uuid,
      })
      setError(null)
    } catch (e) { setError(extractError(e)) }
  }

  async function handleActivateVersion(v: PricingVersion) {
    try {
      await updateVersionMutation.mutateAsync({ uuid: v.uuid, status: VERSION_STATUS_ACTIVE })
      setError(null)
    } catch (e) { setError(extractError(e)) }
  }

  async function handleRevertToDraft(v: PricingVersion) {
    try {
      await updateVersionMutation.mutateAsync({ uuid: v.uuid, status: VERSION_STATUS_DRAFT })
      setError(null)
    } catch (e) { setError(extractError(e)) }
  }

  function openCloneDialog(v: PricingVersion) {
    const defaultFromDate = v.to_date ? addDaysIsoDate(v.to_date, 1) : todayIsoDate()
    setCloneSourceVersion(v)
    setCloneName(`${v.name} - ${t('pricing.version.new')}`)
    setCloneFromDate(defaultFromDate)
    setCloneToDate('')
  }

  async function handleCloneVersion() {
    if (!cloneSourceVersion) return
    try {
      await cloneVersionMutation.mutateAsync({
        source_version_uuid: cloneSourceVersion.uuid,
        name: cloneName,
        from_date: cloneFromDate,
        to_date: cloneToDate || null,
        use_pack: cloneSourceVersion.use_pack,
      })
      setCloneSourceVersion(null)
      setError(null)
    } catch (e) { setError(extractError(e)) }
  }

  function openArchiveDialog(v: PricingVersion) {
    const defaultEndDate = todayIsoDate()
    setArchiveVersion(v)
    setArchiveEndDate(defaultEndDate)
    setArchiveCreateNext(true)
    setArchiveNextName(`${v.name} - ${t('pricing.version.new')}`)
    setArchiveNextFromDate(addDaysIsoDate(defaultEndDate, 1))
  }

  async function handleArchiveVersion() {
    if (!archiveVersion) return
    try {
      await updateVersionMutation.mutateAsync({
        uuid: archiveVersion.uuid,
        status: VERSION_STATUS_ARCHIVED,
        to_date: archiveEndDate,
      })
      if (archiveCreateNext) {
        await cloneVersionMutation.mutateAsync({
          source_version_uuid: archiveVersion.uuid,
          name: archiveNextName,
          from_date: archiveNextFromDate,
          to_date: null,
          use_pack: archiveVersion.use_pack,
        })
      }
      setArchiveVersion(null)
      setError(null)
    } catch (e) { setError(extractError(e)) }
  }

  function extractError(e: unknown): string {
    if (e instanceof AxiosError && e.response?.data?.detail) return String(e.response.data.detail)
    return t('pricing.error.generic')
  }

  const isFyClosed = selectedFy?.state === FY_STATE_CLOSED
  const canEditVersions = canManagePrices && !isFyClosed
  const nextDefaultYear = (sortedFiscalYears[0]?.year ?? currentYear) + 1

  if (!canView) {
    return (
      <section className="rounded-xl border border-outline-variant bg-white p-6 shadow-sm">
        <p className="text-sm text-on-surface-variant">{t('pricing.noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-outline-variant bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-on-surface">{t('pricing.title')}</h1>
            <p className="text-sm text-on-surface-variant">{t('pricing.description')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/banque/packs"
              className="inline-flex items-center justify-center whitespace-nowrap rounded-shape-sm text-sm font-medium transition-all h-8 rounded-md px-3 text-xs text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-outline"
            >
              <Package className="mr-1 h-4 w-4" />
              {t('pricing.packs')}
            </Link>
            {canManagePrices && !showNewFyForm && (
              <Button size="sm" variant="secondary" onClick={() => setShowNewFyForm(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {t('pricing.fy.new')}
              </Button>
            )}
          </div>
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
        <p className="text-sm text-on-surface-variant">{t('pricing.loading')}</p>
      )}

      {allFiscalYears.length > 0 && (
        <div className="rounded-xl border border-outline-variant bg-white shadow-sm">
          {/* FY selector strip */}
          <div className="flex flex-wrap gap-2 border-b border-outline-variant px-4 py-3">
            {futureFiscalYears.map((fy) => (
              <button
                key={fy.uuid}
                type="button"
                onClick={() => handleSelectFy(fy.uuid)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  (selectedFyUuid ?? defaultFy?.uuid) === fy.uuid
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface hover:bg-surface-container-highest'
                }`}
              >
                {fy.code}
                <span className="rounded-full bg-primary-container px-1.5 py-0.5 text-xs text-on-primary-container">
                  {t('pricing.fy.upcoming')}
                </span>
              </button>
            ))}
            {currentFiscalYears.map((fy) => (
              <button
                key={fy.uuid}
                type="button"
                onClick={() => handleSelectFy(fy.uuid)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  (selectedFyUuid ?? defaultFy?.uuid) === fy.uuid
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface hover:bg-surface-container-highest'
                }`}
              >
                {fy.code}
                <FyBadge state={fy.state} t={t} />
              </button>
            ))}
            {pastFiscalYears.length > 0 && (
              <select
                value={
                  pastFiscalYears.some((fy) => fy.uuid === (selectedFyUuid ?? defaultFy?.uuid))
                    ? (selectedFyUuid ?? defaultFy?.uuid)
                    : ''
                }
                onChange={(e) => e.target.value && handleSelectFy(e.target.value)}
                className="rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-outline-variant"
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

          {selectedFy && (
            <div className="space-y-4 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-on-surface">{selectedFy.label}</h2>
                <FyBadge state={selectedFy.state} t={t} />
                <span className="text-sm text-on-surface-variant">
                  {selectedFy.start_date} → {selectedFy.end_date}
                </span>
                {isFyClosed && (
                  <span className="rounded-full bg-surface-container px-2 py-0.5 text-xs text-on-surface-variant">
                    {t('pricing.fy.readOnly')}
                  </span>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-error bg-error-container px-4 py-2 text-sm text-error">
                  {error}
                  <button type="button" className="ml-2 text-error opacity-60 hover:opacity-100" onClick={() => setError(null)}>×</button>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {canEditVersions && !showNewVersionForm && (
                  <Button size="sm" onClick={() => setShowNewVersionForm(true)}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('pricing.version.new')}
                  </Button>
                )}
                {canEditVersions && prevFy && !showNewVersionForm && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={copyVersionsMutation.isPending}
                    onClick={() => setConfirmCopyFromPrev(true)}
                  >
                    <Copy className="mr-1 h-4 w-4" />
                    {copyVersionsMutation.isPending
                      ? t('pricing.version.copying')
                      : t('pricing.version.copyFrom', { code: prevFy.code })}
                  </Button>
                )}
              </div>

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

              {versionsQuery.isLoading ? (
                <p className="text-sm text-on-surface-variant">{t('pricing.loading')}</p>
              ) : (
                <VersionTimeline
                  fy={selectedFy}
                  versions={versions}
                  canEdit={canEditVersions}
                  activationDisabled={updateVersionMutation.isPending}
                  expandedUuid={expandedVersionUuid}
                  onToggleExpand={handleToggleExpandVersion}
                  t={t}
                  onDelete={(v) => setConfirmDeleteVersion(v)}
                  onEdit={(v) => navigate(`/banque/pricing/versions/${selectedFy.uuid}/${v.uuid}/edit`)}
                  onActivate={(v) => setConfirmActivateVersion(v)}
                  onRevertToDraft={(v) => setConfirmRevertVersion(v)}
                  onArchive={(v) => openArchiveDialog(v)}
                  onClone={(v) => openCloneDialog(v)}
                />
              )}
            </div>
          )}

          {allFiscalYears.length > 0 && !selectedFy && (
            <p className="p-6 text-sm text-on-surface-variant">{t('pricing.fy.selectPrompt')}</p>
          )}
        </div>
      )}

      {!fiscalYearsQuery.isLoading && allFiscalYears.length === 0 && (
        <div className="rounded-xl border border-dashed border-outline-variant bg-white p-8 text-center">
          <p className="text-sm text-on-surface-variant">{t('pricing.fy.empty')}</p>
          {canManagePrices && !showNewFyForm && (
            <Button className="mt-3" size="sm" onClick={() => setShowNewFyForm(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('pricing.fy.new')}
            </Button>
          )}
        </div>
      )}

      {confirmDeleteVersion && (
        <ConfirmDialog
          open={!!confirmDeleteVersion}
          title={t('pricing.version.confirmDeleteTitle')}
          body={t('pricing.version.confirmDelete', { name: confirmDeleteVersion.name })}
          confirmLabel={t('pricing.version.deleteTitle')}
          onConfirm={() => { const v = confirmDeleteVersion; setConfirmDeleteVersion(null); handleDeleteVersion(v) }}
          onCancel={() => setConfirmDeleteVersion(null)}
        />
      )}

      {confirmActivateVersion && (
        <ConfirmDialog
          open={!!confirmActivateVersion}
          title={t('pricing.version.confirmActivateTitle')}
          body={t('pricing.version.confirmActivateBody')}
          confirmLabel={t('pricing.version.activate')}
          onConfirm={() => { const v = confirmActivateVersion; setConfirmActivateVersion(null); handleActivateVersion(v) }}
          onCancel={() => setConfirmActivateVersion(null)}
        />
      )}

      {confirmRevertVersion && (
        <ConfirmDialog
          open={!!confirmRevertVersion}
          title={t('pricing.version.confirmRevertTitle')}
          body={t('pricing.version.confirmRevertBody')}
          confirmLabel={t('pricing.version.revert')}
          onConfirm={() => { const v = confirmRevertVersion; setConfirmRevertVersion(null); handleRevertToDraft(v) }}
          onCancel={() => setConfirmRevertVersion(null)}
        />
      )}

      {confirmCopyFromPrev && selectedFy && prevFy && (
        <ConfirmDialog
          open={confirmCopyFromPrev}
          title={t('pricing.version.confirmCopyTitle')}
          body={t('pricing.version.confirmCopy', { from: prevFy.code, to: selectedFy.code })}
          confirmLabel={t('pricing.version.copyFrom', { code: prevFy.code })}
          onConfirm={() => { setConfirmCopyFromPrev(false); handleCopyFromPrev() }}
          onCancel={() => setConfirmCopyFromPrev(false)}
        />
      )}

      <Dialog open={!!cloneSourceVersion} onClose={() => setCloneSourceVersion(null)}>
        <div className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">{t('pricing.version.cloneDialogTitle')}</h3>
            <p className="mt-1 text-xs text-on-surface-variant">{t('pricing.version.cloneDialogBody')}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('pricing.version.name')}</Label>
            <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('pricing.version.fromDate')}</Label>
              <Input type="date" value={cloneFromDate} onChange={(e) => setCloneFromDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('pricing.version.toDate')}</Label>
              <Input type="date" value={cloneToDate} onChange={(e) => setCloneToDate(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCloneSourceVersion(null)}>{t('pricing.version.cancel')}</Button>
            <Button
              type="button"
              onClick={handleCloneVersion}
              disabled={cloneVersionMutation.isPending || !cloneName || !cloneFromDate}
            >
              {cloneVersionMutation.isPending ? t('pricing.version.saving') : t('pricing.version.clone')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!archiveVersion} onClose={() => setArchiveVersion(null)}>
        <div className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">{t('pricing.version.archiveDialogTitle')}</h3>
            <p className="mt-1 text-xs text-on-surface-variant">{t('pricing.version.archiveDialogBody')}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('pricing.version.archiveEndDate')}</Label>
            <Input type="date" value={archiveEndDate} onChange={(e) => setArchiveEndDate(e.target.value)} className="h-8 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-xs text-on-surface">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-outline-variant"
              checked={archiveCreateNext}
              onChange={(e) => setArchiveCreateNext(e.target.checked)}
            />
            {t('pricing.version.createNext')}
          </label>
          {archiveCreateNext && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">{t('pricing.version.nextName')}</Label>
                <Input value={archiveNextName} onChange={(e) => setArchiveNextName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('pricing.version.nextFromDate')}</Label>
                <Input type="date" value={archiveNextFromDate} onChange={(e) => setArchiveNextFromDate(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setArchiveVersion(null)}>{t('pricing.version.cancel')}</Button>
            <Button
              type="button"
              onClick={handleArchiveVersion}
              disabled={
                updateVersionMutation.isPending ||
                !archiveEndDate ||
                (archiveCreateNext && (!archiveNextName || !archiveNextFromDate))
              }
            >
              {(updateVersionMutation.isPending || cloneVersionMutation.isPending)
                ? t('pricing.version.saving')
                : t('pricing.version.archive')}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}
