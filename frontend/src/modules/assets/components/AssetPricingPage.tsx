/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Asset pricing page: FY selector, version timeline, items CRUD
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
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AxiosError } from 'axios'
import Decimal from 'decimal.js'
import { Plus, Pencil, Trash2, Check, X, ArrowLeft } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useFiscalYearsQuery,
  type FiscalYear,
} from '../../banque/api'
import {
  useAssetQuery,
  useAssetTypesQuery,
  useAssetPricingVersionsQuery,
  useCreateAssetPricingVersionMutation,
  useUpdateAssetPricingVersionMutation,
  useDeleteAssetPricingVersionMutation,
  usePricingItemsQuery,
  useCreatePricingItemMutation,
  useUpdatePricingItemMutation,
  useDeletePricingItemMutation,
  useFlightTypesQuery,
} from '../api'
import type { AssetPricingVersion, PricingItem, CreatePricingItemPayload } from '../types'

// �"?�"? Constants �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

const VERSION_STATUS_DRAFT = 1
const VERSION_STATUS_ACTIVE = 2
const VERSION_STATUS_ARCHIVED = 3
const FY_STATE_CLOSED = 2

const UNIT_LABELS: Record<number, string> = {
  1: 'PerHour',
  2: 'PerMinute',
  3: 'PerLaunch',
  4: 'PerFlight',
  5: 'Fixed',
}

// �"?�"? Helpers �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

function versionStatusClass(status: number): string {
  if (status === VERSION_STATUS_DRAFT) return 'bg-yellow-100 text-yellow-800'
  if (status === VERSION_STATUS_ACTIVE) return 'bg-green-100 text-green-800'
  return 'bg-slate-100 text-slate-500'
}

function timelineBar(fy: FiscalYear, version: AssetPricingVersion) {
  const fyStart = new Date(fy.start_date).getTime()
  const fyEnd = new Date(fy.end_date).getTime()
  const fyLen = fyEnd - fyStart
  const vStart = new Date(version.from_date).getTime()
  const vEnd = version.to_date ? new Date(version.to_date).getTime() : fyEnd
  const left = Math.max(0, Math.min(100, ((vStart - fyStart) / fyLen) * 100))
  const width = Math.max(1, Math.min(100 - left, ((vEnd - vStart) / fyLen) * 100))
  return { left: `${left.toFixed(1)}%`, width: `${width.toFixed(1)}%` }
}

function formatPrice(value: string | null | undefined): string {
  if (!value) return '�?"'
  try { return new Decimal(value).toFixed(2) } catch { return value }
}

// �"?�"? Version Badge �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

function VersionBadge({ status, t }: { status: number; t: (k: string) => string }) {
  const label =
    status === VERSION_STATUS_DRAFT
      ? t('pricing.statusDraft')
      : status === VERSION_STATUS_ACTIVE
      ? t('pricing.statusActive')
      : t('pricing.statusArchived')
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${versionStatusClass(status)}`}>
      {label}
    </span>
  )
}

// �"?�"? Version Form �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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
  t: (k: string) => string
}) {
  const [form, setForm] = useState<VersionFormState>(initial)
  function set<K extends keyof VersionFormState>(key: K, value: VersionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">{t('pricing.versionName')}</Label>
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.fromDate')}</Label>
        <Input type="date" value={form.from_date} onChange={(e) => set('from_date', e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.toDate')}</Label>
        <Input type="date" value={form.to_date} onChange={(e) => set('to_date', e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('pricing.versionStatus')}</Label>
        <select
          value={form.status}
          onChange={(e) => set('status', Number(e.target.value))}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value={VERSION_STATUS_DRAFT}>{t('pricing.statusDraft')}</option>
          <option value={VERSION_STATUS_ACTIVE}>{t('pricing.statusActive')}</option>
          <option value={VERSION_STATUS_ARCHIVED}>{t('pricing.statusArchived')}</option>
        </select>
      </div>
      <div className="flex items-end gap-2 sm:col-span-3">
        <Button size="sm" onClick={() => onSave(form)} disabled={saving || !form.name || !form.from_date}>
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('pricing.saving') : t('pricing.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1 h-3 w-3" />
          {t('pricing.cancel')}
        </Button>
      </div>
    </div>
  )
}

// �"?�"? Pricing Item Form �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

type ItemFormState = {
  name: string
  unit: number
  base_price: string
  threshold_unit_count: string
  threshold_price: string
  flight_type_uuid: string
}

const EMPTY_ITEM: ItemFormState = {
  name: '',
  unit: 1,
  base_price: '',
  threshold_unit_count: '',
  threshold_price: '',
  flight_type_uuid: '',
}

function itemToForm(item: PricingItem): ItemFormState {
  return {
    name: item.name,
    unit: item.unit,
    base_price: item.base_price,
    threshold_unit_count: item.threshold_unit_count ?? '',
    threshold_price: item.threshold_price ?? '',
    flight_type_uuid: item.flight_type_uuid ?? '',
  }
}

function buildItemPayload(form: ItemFormState): CreatePricingItemPayload {
  const hasThreshold = form.threshold_unit_count !== '' && form.threshold_price !== ''
  return {
    name: form.name.trim(),
    unit: form.unit,
    base_price: form.base_price.trim(),
    flight_type_uuid: form.flight_type_uuid || null,
    threshold_unit_count: hasThreshold ? form.threshold_unit_count : null,
    threshold_price: hasThreshold ? form.threshold_price : null,
  }
}

function PricingItemForm({
  initial,
  flightTypes,
  onSave,
  onCancel,
  saving,
  t,
}: {
  initial: ItemFormState
  flightTypes: Array<{ uuid: string; name: string }>
  onSave: (f: ItemFormState) => void
  onCancel: () => void
  saving: boolean
  t: (k: string) => string
}) {
  const [form, setForm] = useState<ItemFormState>(initial)
  function set<K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const thresholdComplete =
    (form.threshold_unit_count !== '' && form.threshold_price !== '') ||
    (form.threshold_unit_count === '' && form.threshold_price === '')
  const valid = form.name.trim() !== '' && form.base_price !== '' && thresholdComplete

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">{t('pricing.itemName')} *</Label>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.itemUnit')}</Label>
          <select
            value={form.unit}
            onChange={(e) => set('unit', Number(e.target.value))}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            {Object.entries(UNIT_LABELS).map(([k, label]) => (
              <option key={k} value={Number(k)}>
                {t(`pricing.unit${label}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.basePrice')} *</Label>
          <Input
            value={form.base_price}
            onChange={(e) => set('base_price', e.target.value)}
            placeholder="0.0000"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.flightType')}</Label>
          <select
            value={form.flight_type_uuid}
            onChange={(e) => set('flight_type_uuid', e.target.value)}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            <option value="">{t('pricing.noFlightType')}</option>
            {flightTypes.map((ft) => (
              <option key={ft.uuid} value={ft.uuid}>{ft.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Threshold pair */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.thresholdCount')}</Label>
          <Input
            value={form.threshold_unit_count}
            onChange={(e) => set('threshold_unit_count', e.target.value)}
            placeholder="0"
            className={`h-8 text-sm font-mono ${!thresholdComplete ? 'border-red-400' : ''}`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.thresholdPrice')}</Label>
          <Input
            value={form.threshold_price}
            onChange={(e) => set('threshold_price', e.target.value)}
            placeholder="0.0000"
            className={`h-8 text-sm font-mono ${!thresholdComplete ? 'border-red-400' : ''}`}
          />
        </div>
      </div>
      {!thresholdComplete && (
        <p className="text-xs text-red-600">{t('pricing.thresholdPairRequired')}</p>
      )}





      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(form)} disabled={saving || !valid}>
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('pricing.saving') : t('pricing.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1 h-3 w-3" />
          {t('pricing.cancel')}
        </Button>
      </div>
    </div>
  )
}

// �"?�"? Pricing Items Panel �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

function PricingItemsPanel({
  version,
  assetTypeUuid,
  canEdit,
  t,
}: {
  version: AssetPricingVersion
  assetTypeUuid: string
  canEdit: boolean
  t: (k: string) => string
}) {
  const itemsQuery = usePricingItemsQuery(version.uuid, true)
  const items = itemsQuery.data ?? []

  const flightTypesQuery = useFlightTypesQuery(assetTypeUuid)
  const flightTypes = flightTypesQuery.data ?? []

  const createMutation = useCreatePricingItemMutation(version.uuid)
  const updateMutation = useUpdatePricingItemMutation(version.uuid)
  const deleteMutation = useDeletePricingItemMutation(version.uuid)

  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<PricingItem | null>(null)
  const [itemError, setItemError] = useState<string | null>(null)

  async function handleCreate(form: ItemFormState) {
    try {
      await createMutation.mutateAsync(buildItemPayload(form))
      setShowForm(false)
      setItemError(null)
    } catch (e) {
      setItemError(extractError(e, t('pricing.error.saveFailed')))
    }
  }

  async function handleUpdate(form: ItemFormState) {
    if (!editingItem) return
    try {
      await updateMutation.mutateAsync({ uuid: editingItem.uuid, ...buildItemPayload(form) })
      setEditingItem(null)
      setItemError(null)
    } catch (e) {
      setItemError(extractError(e, t('pricing.error.saveFailed')))
    }
  }

  async function handleDelete(item: PricingItem) {
    if (!window.confirm(t('pricing.confirmDeleteItem'))) return
    try {
      await deleteMutation.mutateAsync(item.uuid)
      setItemError(null)
    } catch (e) {
      setItemError(extractError(e, t('pricing.error.deleteFailed')))
    }
  }

  const isLocked = version.is_locked
  const editable = canEdit && !isLocked

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-700">{t('pricing.items')}</h3>
        {editable && !showForm && !editingItem && (
          <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-3 w-3" />
            {t('pricing.addItem')}
          </Button>
        )}
      </div>

      {itemError && <p className="text-xs text-red-600">{itemError}</p>}

      {showForm && (
        <PricingItemForm
          initial={EMPTY_ITEM}
          flightTypes={flightTypes}
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          saving={createMutation.isPending}
          t={t}
        />
      )}

      {itemsQuery.isLoading ? (
        <p className="text-xs text-slate-500">{t('states.loading')}</p>
      ) : items.length === 0 && !showForm ? (
        <p className="rounded border border-dashed border-slate-200 py-3 text-center text-xs text-slate-500">
          {t('pricing.noItems')}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) =>
            editingItem?.uuid === item.uuid ? (
              <PricingItemForm
                key={item.uuid}
                initial={itemToForm(item)}
                flightTypes={flightTypes}
                onSave={handleUpdate}
                onCancel={() => setEditingItem(null)}
                saving={updateMutation.isPending}
                t={t}
              />
            ) : (
              <div
                key={item.uuid}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {t(`pricing.unit${UNIT_LABELS[item.unit] ?? ''}`)} ·{' '}
                    {formatPrice(item.base_price)}
                    {item.threshold_price && ` · >${item.threshold_unit_count}: ${formatPrice(item.threshold_price)}`}
                  </p>
                </div>
                {editable && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => setEditingItem(item)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => handleDelete(item)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// �"?�"? Main Component �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

export function AssetPricingPage() {
  const { t } = useTranslation('assets')
  const navigate = useNavigate()
  const { uuid } = useParams<{ uuid: string }>()

  const canManagePrices = useCapability('MANAGE_PRICES')
  const canView = useCapability('MANAGE_ASSETS') || useCapability('VIEW_FINANCIALS')

  const assetQuery = useAssetQuery(uuid ?? null)
  const asset = assetQuery.data ?? null

  const typesQuery = useAssetTypesQuery(canView)
  const assetType = useMemo(
    () => (typesQuery.data ?? []).find((t) => t.uuid === asset?.asset_type_uuid) ?? null,
    [typesQuery.data, asset],
  )

  const currentYear = new Date().getFullYear()
  const fyQuery = useFiscalYearsQuery(canView)
  const allFy = useMemo(
    () => [...(fyQuery.data ?? [])].sort((a, b) => b.year - a.year),
    [fyQuery.data],
  )

  const defaultFy =
    allFy.find((fy) => fy.year === currentYear && fy.state !== FY_STATE_CLOSED) ??
    allFy[0] ??
    null
  const [selectedFyUuid, setSelectedFyUuid] = useState<string | null>(null)
  const selectedFy = allFy.find((fy) => fy.uuid === (selectedFyUuid ?? defaultFy?.uuid)) ?? null

  const versionsQuery = useAssetPricingVersionsQuery(
    asset?.asset_type_uuid ?? null,
    selectedFy?.uuid ?? null,
    canView,
  )
  const versions = versionsQuery.data ?? []

  const createVersionMutation = useCreateAssetPricingVersionMutation(
    selectedFy?.uuid ?? '',
    asset?.asset_type_uuid ?? '',
  )
  const updateVersionMutation = useUpdateAssetPricingVersionMutation(
    selectedFy?.uuid ?? '',
    asset?.asset_type_uuid ?? '',
  )
  const deleteVersionMutation = useDeleteAssetPricingVersionMutation(
    selectedFy?.uuid ?? '',
    asset?.asset_type_uuid ?? '',
  )

  const [showNewVersionForm, setShowNewVersionForm] = useState(false)
  const [editingVersion, setEditingVersion] = useState<AssetPricingVersion | null>(null)
  const [expandedVersionUuid, setExpandedVersionUuid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateVersion(form: VersionFormState) {
    try {
      const created = await createVersionMutation.mutateAsync({
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
      })
      setShowNewVersionForm(false)
      setExpandedVersionUuid(created.uuid)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('pricing.error.saveFailed')))
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
      setError(extractError(e, t('pricing.error.saveFailed')))
    }
  }

  async function handleDeleteVersion(v: AssetPricingVersion) {
    if (!window.confirm(t('pricing.confirmDeleteVersion', { name: v.name }))) return
    try {
      await deleteVersionMutation.mutateAsync(v.uuid)
      if (expandedVersionUuid === v.uuid) setExpandedVersionUuid(null)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('pricing.error.deleteFailed')))
    }
  }

  const isFyClosed = selectedFy?.state === FY_STATE_CLOSED
  const canEdit = canManagePrices && !isFyClosed

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <button
          type="button"
          className="mb-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          onClick={() => navigate(uuid ? `/assets/${uuid}` : '/assets')}
        >
          <ArrowLeft className="h-3 w-3" />
          {t('actions.backToDetail')}
        </button>
        <h1 className="text-xl font-semibold text-slate-900">
          {asset ? `${asset.name} — ` : ''}{t('pricing.title')}
        </h1>
        {assetType && (
          <p className="mt-1 text-sm text-slate-500">
            {t('pricing.typeLabel')}: {assetType.name}
          </p>
        )}
      </div>

      {error && (
        <Alert>
          <p className="text-sm">{error}</p>
        </Alert>
      )}

      {/* FY Selector */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-xs font-semibold">{t('pricing.fiscalYear')}</Label>
          <div className="flex flex-wrap gap-2">
            {allFy.map((fy) => (
              <button
                key={fy.uuid}
                type="button"
                onClick={() => {
                  setSelectedFyUuid(fy.uuid)
                  setShowNewVersionForm(false)
                  setEditingVersion(null)
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  (selectedFy?.uuid ?? defaultFy?.uuid) === fy.uuid
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {fy.code}
                {fy.state === FY_STATE_CLOSED && (
                  <span className="ml-1 text-slate-400">({t('pricing.fyClosed')})</span>
                )}
              </button>
            ))}
            {allFy.length === 0 && (
              <p className="text-xs text-slate-500">{t('pricing.noFiscalYears')}</p>
            )}
          </div>
        </div>
      </div>

      {selectedFy && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* Version header */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              {t('pricing.versions')} — {selectedFy.label}
            </h2>
            {canEdit && !showNewVersionForm && !editingVersion && (
              <Button size="sm" onClick={() => setShowNewVersionForm(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('pricing.addVersion')}
              </Button>
            )}
          </div>

          {showNewVersionForm && (
            <div className="mb-4">
              <VersionForm
                initial={{
                  name: '',
                  from_date: selectedFy.start_date,
                  to_date: '',
                  status: VERSION_STATUS_DRAFT,
                }}
                onSave={handleCreateVersion}
                onCancel={() => setShowNewVersionForm(false)}
                saving={createVersionMutation.isPending}
                t={t}
              />
            </div>
          )}

          {versionsQuery.isLoading ? (
            <p className="text-sm text-slate-500">{t('states.loading')}</p>
          ) : versions.length === 0 && !showNewVersionForm ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              {t('pricing.noVersions')}
            </p>
          ) : (
            <>
              {/* Visual timeline */}
              {versions.length > 0 && (
                <div className="mb-4 relative h-6 rounded-md bg-slate-100">
                  {versions.map((v) => {
                    const { left, width } = timelineBar(selectedFy, v)
                    return (
                      <div
                        key={v.uuid}
                        title={`${v.name} · ${v.from_date} �?' ${v.to_date ?? '�^z'}`}
                        className={`absolute top-0 h-full rounded opacity-80 hover:opacity-100 ${versionStatusClass(v.status)}`}
                        style={{ left, width }}
                      />
                    )
                  })}
                </div>
              )}

              {/* Version rows */}
              <div className="space-y-3">
                {versions.map((v) =>
                  editingVersion?.uuid === v.uuid ? (
                    <VersionForm
                      key={v.uuid}
                      initial={{
                        name: v.name,
                        from_date: v.from_date,
                        to_date: v.to_date ?? '',
                        status: v.status,
                      }}
                      onSave={handleUpdateVersion}
                      onCancel={() => setEditingVersion(null)}
                      saving={updateVersionMutation.isPending}
                      t={t}
                    />
                  ) : (
                    <div
                      key={v.uuid}
                      className="rounded-lg border border-slate-200 bg-white"
                    >
                      {/* Version header row */}
                      <div
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5"
                        onClick={() =>
                          setExpandedVersionUuid((prev) =>
                            prev === v.uuid ? null : v.uuid,
                          )
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">{v.name}</p>
                          <p className="text-xs text-slate-500">
                            {v.from_date} �?' {v.to_date ?? t('pricing.openEnd')}
                          </p>
                        </div>
                        <VersionBadge status={v.status} t={t} />
                        {v.is_locked && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                            {t('pricing.locked')}
                          </span>
                        )}
                        {canEdit && !v.is_locked && (
                          <div
                            className="flex shrink-0 gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              onClick={() => setEditingVersion(v)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => handleDeleteVersion(v)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Expanded items */}
                      {expandedVersionUuid === v.uuid && (
                        <div className="px-4 pb-4">
                          <PricingItemsPanel
                            version={v}
                            assetTypeUuid={asset?.asset_type_uuid ?? ''}
                            canEdit={canEdit && !v.is_locked}
                            t={t}
                          />
                        </div>
                      )}
                    </div>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
