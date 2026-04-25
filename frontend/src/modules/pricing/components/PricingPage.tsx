/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - pricing: Unified pricing management screen (all versions, all asset types, grouped by FY)
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import Decimal from 'decimal.js'
import { Plus, Pencil, Trash2, Check, X, ChevronDown, ChevronRight } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import { apiClient, getAuthRequestConfig } from '../../../api/client'
import {
  useFiscalYearsQuery,
  useUpdatePricingVersionMutation,
  useDeletePricingVersionMutation,
  type FiscalYear,
} from '../../banque/api'
import {
  useAssetTypesQuery,
  usePricingItemsQuery,
  useCreatePricingItemMutation,
  useUpdatePricingItemMutation,
  useDeletePricingItemMutation,
  useFlightTypesQuery,
} from '../../assets/api'
import type {
  AssetType,
  AssetPricingVersion,
  PricingItem,
  TierPayload,
  CreatePricingItemPayload,
} from '../../assets/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const VERSION_STATUS_DRAFT = 1
const VERSION_STATUS_ACTIVE = 2
const FY_STATE_CLOSED = 2

const UNIT_LABELS: Record<number, string> = {
  1: 'PerHour',
  2: 'PerMinute',
  3: 'PerLaunch',
  4: 'PerFlight',
  5: 'Fixed',
}

// ── Query Keys ────────────────────────────────────────────────────────────────

const pricingQueryKeys = {
  allVersions: (fyUuid: string) => ['pricing', 'all-versions', fyUuid] as const,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

function formatPrice(value: string | null | undefined): string {
  if (!value) return '—'
  try { return new Decimal(value).toFixed(2) } catch { return value }
}

function versionStatusClass(status: number): string {
  if (status === VERSION_STATUS_DRAFT) return 'bg-yellow-100 text-yellow-800'
  if (status === VERSION_STATUS_ACTIVE) return 'bg-green-100 text-green-800'
  return 'bg-slate-100 text-slate-500'
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useAllPricingVersionsQuery(fiscalYearUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: pricingQueryKeys.allVersions(fiscalYearUuid ?? ''),
    enabled: enabled && Boolean(fiscalYearUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<AssetPricingVersion[]>(
        '/api/v1/accounting/pricing/versions',
        {
          ...getAuthRequestConfig(),
          params: { fiscal_year_uuid: fiscalYearUuid },
        },
      )
      return data
    },
  })
}

function useCreatePricingVersionMutation(fiscalYearUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      name: string
      from_date: string
      to_date?: string | null
      status: number
      asset_type_uuid?: string | null
    }) => {
      const { data } = await apiClient.post<AssetPricingVersion>(
        '/api/v1/accounting/pricing/versions',
        { ...payload, fiscal_year_uuid: fiscalYearUuid },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pricingQueryKeys.allVersions(fiscalYearUuid) })
    },
  })
}

// ── Version Badge ─────────────────────────────────────────────────────────────

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

// ── Version Form ──────────────────────────────────────────────────────────────

type VersionFormState = {
  name: string
  from_date: string
  to_date: string
  status: number
  asset_type_uuid: string
}

function VersionForm({
  initial,
  assetTypes,
  onSave,
  onCancel,
  saving,
  t,
}: {
  initial: VersionFormState
  assetTypes: AssetType[]
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
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">{t('pricing.assetType')}</Label>
        <select
          value={form.asset_type_uuid}
          onChange={(e) => set('asset_type_uuid', e.target.value)}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value="">{t('pricing.globalVersion')}</option>
          {assetTypes.map((at) => (
            <option key={at.uuid} value={at.uuid}>{at.name}</option>
          ))}
        </select>
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
          <option value={1}>{t('pricing.statusDraft')}</option>
          <option value={2}>{t('pricing.statusActive')}</option>
          <option value={3}>{t('pricing.statusArchived')}</option>
        </select>
      </div>
      <div className="flex items-end gap-2">
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

// ── Pricing Item Form ─────────────────────────────────────────────────────────

type ItemFormState = {
  name: string
  unit: number
  base_price: string
  pack_price: string
  tiers: TierPayload[]
  flight_type_uuid: string
}

const EMPTY_ITEM: ItemFormState = { name: '', unit: 1, base_price: '', pack_price: '', tiers: [], flight_type_uuid: '' }

function itemToForm(item: PricingItem): ItemFormState {
  return {
    name: item.name,
    unit: item.unit,
    base_price: item.base_price,
    pack_price: item.pack_price ?? '',
    tiers: item.tiers.map((t) => ({ from_qty: t.from_qty, price: t.price })),
    flight_type_uuid: item.flight_type_uuid ?? '',
  }
}

function buildItemPayload(form: ItemFormState): CreatePricingItemPayload {
  return {
    name: form.name.trim(),
    unit: form.unit,
    base_price: form.base_price.trim(),
    pack_price: form.pack_price.trim() !== '' ? form.pack_price.trim() : null,
    flight_type_uuid: form.flight_type_uuid || null,
    tiers: form.tiers.filter((t) => t.from_qty !== '' && t.price !== ''),
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
  function addTier() {
    setForm((prev) => ({ ...prev, tiers: [...prev.tiers, { from_qty: '', price: '' }] }))
  }
  function updateTier(index: number, field: keyof TierPayload, value: string) {
    setForm((prev) => ({
      ...prev,
      tiers: prev.tiers.map((row, i) => i === index ? { ...row, [field]: value } : row),
    }))
  }
  function removeTier(index: number) {
    setForm((prev) => ({ ...prev, tiers: prev.tiers.filter((_, i) => i !== index) }))
  }
  const valid = form.name.trim() !== '' && form.base_price !== ''
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
              <option key={k} value={Number(k)}>{t(`pricing.unit${label}`)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.basePrice')} *</Label>
          <Input value={form.base_price} onChange={(e) => set('base_price', e.target.value)} placeholder="0.0000" className="h-8 text-sm font-mono" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.packPrice')}</Label>
          <Input value={form.pack_price} onChange={(e) => set('pack_price', e.target.value)} placeholder="0.0000" className="h-8 text-sm font-mono" />
        </div>
        {flightTypes.length > 0 && (
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
        )}
      </div>
      <div className="space-y-2">
        <Label className="text-xs">{t('pricing.tiers')}</Label>
        {form.tiers.length === 0 && <p className="text-xs text-slate-400">{t('pricing.noTiers')}</p>}
        {form.tiers.length > 0 && (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-slate-500">
              <span>{t('pricing.tierFrom')}</span>
              <span>{t('pricing.tierPrice')}</span>
              <span />
            </div>
            {form.tiers.map((tier, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input value={tier.from_qty} onChange={(e) => updateTier(i, 'from_qty', e.target.value)} placeholder="0" className="h-7 text-sm font-mono" />
                <Input value={tier.price} onChange={(e) => updateTier(i, 'price', e.target.value)} placeholder="0.0000" className="h-7 text-sm font-mono" />
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => removeTier(i)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" variant="ghost" type="button" onClick={addTier}>
          <Plus className="mr-1 h-3 w-3" />
          {t('pricing.addTier')}
        </Button>
      </div>
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

// ── Pricing Items Panel ───────────────────────────────────────────────────────

function PricingItemsPanel({
  version,
  canEdit,
  t,
}: {
  version: AssetPricingVersion
  canEdit: boolean
  t: (k: string) => string
}) {
  const itemsQuery = usePricingItemsQuery(version.uuid, true)
  const items = itemsQuery.data ?? []

  const flightTypesQuery = useFlightTypesQuery(version.asset_type_uuid)
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
    } catch (e) {
      setItemError(extractError(e, t('pricing.error.deleteFailed')))
    }
  }

  const editable = canEdit && !version.is_locked

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">{t('pricing.items')}</p>
        {editable && !showForm && !editingItem && (
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-3 w-3" />
            {t('pricing.addItem')}
          </button>
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
        <p className="text-xs text-slate-400">{t('states.loading')}</p>
      ) : items.length === 0 && !showForm ? (
        <p className="rounded border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
          {t('pricing.noItems')}
        </p>
      ) : (
        <div className="space-y-1.5">
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
                className="flex items-center gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{item.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {t(`pricing.unit${UNIT_LABELS[item.unit] ?? ''}`)}
                    {' · '}{formatPrice(item.base_price)} €
                    {item.pack_price && <> · Pack: {formatPrice(item.pack_price)} €</>}
                    {item.tiers.length > 0 && (
                      <> · {item.tiers.map((tier) => `${tier.from_qty}→${formatPrice(tier.price)}€`).join(' · ')}</>
                    )}
                  </p>
                </div>
                {editable && (
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
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

// ── Version Card ──────────────────────────────────────────────────────────────

function VersionCard({
  version,
  assetTypes,
  fyUuid,
  canEdit,
  expanded,
  onToggle,
  t,
}: {
  version: AssetPricingVersion
  assetTypes: AssetType[]
  fyUuid: string
  canEdit: boolean
  expanded: boolean
  onToggle: () => void
  t: (k: string) => string
}) {
  const [editing, setEditing] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)

  const updateMutation = useUpdatePricingVersionMutation(fyUuid)
  const deleteMutation = useDeletePricingVersionMutation(fyUuid)

  // Also invalidate the unified versions list
  const queryClient = useQueryClient()
  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: pricingQueryKeys.allVersions(fyUuid) })
  }

  async function handleUpdate(form: VersionFormState) {
    try {
      await updateMutation.mutateAsync({
        uuid: version.uuid,
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
      })
      invalidateAll()
      setEditing(false)
      setCardError(null)
    } catch (e) {
      setCardError(extractError(e, t('pricing.error.saveFailed')))
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('pricing.confirmDeleteVersion', { name: version.name }))) return
    try {
      await deleteMutation.mutateAsync(version.uuid)
      invalidateAll()
    } catch (e) {
      setCardError(extractError(e, t('pricing.error.deleteFailed')))
    }
  }

  const editInitial: VersionFormState = {
    name: version.name,
    from_date: version.from_date,
    to_date: version.to_date ?? '',
    status: version.status,
    asset_type_uuid: version.asset_type_uuid ?? '',
  }

  if (editing) {
    return (
      <VersionForm
        initial={editInitial}
        assetTypes={assetTypes}
        onSave={handleUpdate}
        onCancel={() => setEditing(false)}
        saving={updateMutation.isPending}
        t={t}
      />
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {cardError && <p className="px-4 pt-2 text-xs text-red-600">{cardError}</p>}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5"
        onClick={onToggle}
      >
        <span className="shrink-0 text-slate-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">{version.name}</p>
          <p className="text-xs text-slate-500">
            {version.from_date} → {version.to_date ?? t('pricing.openEnd')}
          </p>
        </div>
        <VersionBadge status={version.status} t={t} />
        {version.is_locked && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
            {t('pricing.locked')}
          </span>
        )}
        {canEdit && !version.is_locked && (
          <div className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="px-4 pb-4">
          <PricingItemsPanel version={version} canEdit={canEdit} t={t} />
        </div>
      )}
    </div>
  )
}

// ── Versions Section ──────────────────────────────────────────────────────────

function VersionsSection({
  title,
  versions,
  assetTypes,
  fyUuid,
  canEdit,
  expandedUuid,
  onToggle,
  t,
}: {
  title: string
  versions: AssetPricingVersion[]
  assetTypes: AssetType[]
  fyUuid: string
  canEdit: boolean
  expandedUuid: string | null
  onToggle: (uuid: string) => void
  t: (k: string) => string
}) {
  if (versions.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {versions.map((v) => (
        <VersionCard
          key={v.uuid}
          version={v}
          assetTypes={assetTypes}
          fyUuid={fyUuid}
          canEdit={canEdit}
          expanded={expandedUuid === v.uuid}
          onToggle={() => onToggle(v.uuid)}
          t={t}
        />
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PricingPage() {
  const { t } = useTranslation('assets')
  const canManagePrices = useCapability('MANAGE_PRICES')
  const canView = useCapability('MANAGE_PRICES') || useCapability('VIEW_FINANCIALS')

  const fyQuery = useFiscalYearsQuery(canView)
  const allFy = useMemo(
    () => [...(fyQuery.data ?? [])].sort((a, b) => b.year - a.year),
    [fyQuery.data],
  )
  const currentYear = new Date().getFullYear()
  const defaultFy =
    allFy.find((fy) => fy.year === currentYear && fy.state !== FY_STATE_CLOSED) ?? allFy[0] ?? null

  const [selectedFyUuid, setSelectedFyUuid] = useState<string | null>(null)
  const selectedFy = allFy.find((fy) => fy.uuid === (selectedFyUuid ?? defaultFy?.uuid)) ?? null

  const isFyClosed = selectedFy?.state === FY_STATE_CLOSED
  const canEdit = canManagePrices && !isFyClosed

  const versionsQuery = useAllPricingVersionsQuery(selectedFy?.uuid ?? null, canView)
  const versions = versionsQuery.data ?? []

  const assetTypesQuery = useAssetTypesQuery(canView)
  const assetTypes = assetTypesQuery.data ?? []

  // Group versions: null = global, others by asset_type_uuid
  const globalVersions = useMemo(
    () => versions.filter((v) => v.asset_type_uuid === null),
    [versions],
  )
  const versionsByType = useMemo(() => {
    const map = new Map<string, AssetPricingVersion[]>()
    for (const v of versions) {
      if (v.asset_type_uuid === null) continue
      const arr = map.get(v.asset_type_uuid) ?? []
      arr.push(v)
      map.set(v.asset_type_uuid, arr)
    }
    return map
  }, [versions])

  const [showNewVersionForm, setShowNewVersionForm] = useState(false)
  const [expandedVersionUuid, setExpandedVersionUuid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createMutation = useCreatePricingVersionMutation(selectedFy?.uuid ?? '')

  async function handleCreate(form: VersionFormState) {
    try {
      const created = await createMutation.mutateAsync({
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
        asset_type_uuid: form.asset_type_uuid || null,
      })
      setShowNewVersionForm(false)
      setExpandedVersionUuid(created.uuid)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('pricing.error.saveFailed')))
    }
  }

  function toggleExpanded(uuid: string) {
    setExpandedVersionUuid((prev) => (prev === uuid ? null : uuid))
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('noPermission')}</p>
      </section>
    )
  }

  const newVersionInitial: VersionFormState = {
    name: '',
    from_date: selectedFy?.start_date ?? '',
    to_date: '',
    status: 1,
    asset_type_uuid: '',
  }

  return (
    <section className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('pricing.title')}</h1>
          {isFyClosed && (
            <p className="mt-1 text-xs text-amber-600">{t('pricing.fyClosedWarning')}</p>
          )}
        </div>
        {canEdit && !showNewVersionForm && (
          <Button onClick={() => setShowNewVersionForm(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('pricing.newVersion')}
          </Button>
        )}
      </div>

      {/* FY tabs */}
      {allFy.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allFy.map((fy) => {
            const active = fy.uuid === selectedFy?.uuid
            return (
              <button
                key={fy.uuid}
                type="button"
                onClick={() => setSelectedFyUuid(fy.uuid)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {fy.label ?? fy.year}
              </button>
            )
          })}
        </div>
      )}

      {error && <Alert variant="destructive"><p className="text-sm">{error}</p></Alert>}

      {/* New version form */}
      {showNewVersionForm && (
        <VersionForm
          initial={newVersionInitial}
          assetTypes={assetTypes}
          onSave={handleCreate}
          onCancel={() => setShowNewVersionForm(false)}
          saving={createMutation.isPending}
          t={t}
        />
      )}

      {/* Versions list */}
      {versionsQuery.isLoading ? (
        <p className="text-sm text-slate-500">{t('states.loading')}</p>
      ) : versions.length === 0 && !showNewVersionForm ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center">
          <p className="text-sm text-slate-500">{t('pricing.noVersions')}</p>
          {canEdit && (
            <button
              type="button"
              className="mt-2 text-sm font-medium text-slate-700 underline hover:text-slate-900"
              onClick={() => setShowNewVersionForm(true)}
            >
              {t('pricing.newVersion')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Global versions */}
          <VersionsSection
            title={t('pricing.globalVersions')}
            versions={globalVersions}
            assetTypes={assetTypes}
            fyUuid={selectedFy?.uuid ?? ''}
            canEdit={canEdit}
            expandedUuid={expandedVersionUuid}
            onToggle={toggleExpanded}
            t={t}
          />

          {/* Per asset-type versions */}
          {assetTypes
            .filter((at) => versionsByType.has(at.uuid))
            .map((at) => (
              <VersionsSection
                key={at.uuid}
                title={at.name}
                versions={versionsByType.get(at.uuid) ?? []}
                assetTypes={assetTypes}
                fyUuid={selectedFy?.uuid ?? ''}
                canEdit={canEdit}
                expandedUuid={expandedVersionUuid}
                onToggle={toggleExpanded}
                t={t}
              />
            ))}
        </div>
      )}
    </section>
  )
}

