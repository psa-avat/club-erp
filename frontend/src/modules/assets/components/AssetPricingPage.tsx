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
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useFiscalYearsQuery,
  useAccountsQuery,
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
import type { AssetPricingVersion, PricingItem, CreatePricingItemPayload, TierPayload } from '../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const VERSION_STATUS_DRAFT = 1
const VERSION_STATUS_ACTIVE = 2
const VERSION_STATUS_ARCHIVED = 3
const FY_STATE_CLOSED = 2

const UNIT_LABELS: Record<number, string> = {
  1: 'FlightTime',
  2: 'EngineTimeMin',
  3: 'EngineTime1_100h',
  4: 'FlightDuration',
  5: 'PerFlight',
  6: 'Fixed',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

function versionStatusClass(status: number): string {
  if (status === VERSION_STATUS_DRAFT) return 'bg-warning-container text-on-warning-container'
  if (status === VERSION_STATUS_ACTIVE) return 'bg-success-container text-on-success-container'
  return 'bg-surface-container text-on-surface-variant'
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
  if (!value) return '—'
  try { return new Decimal(value).toFixed(2) } catch { return value }
}

function getFromQtyStep(unit: number): string {
  return unit === 1 ? '0.1' : '1'
}

function getFromQtyPlaceholder(unit: number): string {
  return unit === 1 ? '0.0' : '0'
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

// ── Version Form ─────────────────────────────────────────────────────────────

type VersionFormState = {
  name: string
  from_date: string
  to_date: string
  status: number
  use_pack: boolean
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
    <div className="grid gap-3 rounded-shape-md border border-outline-variant bg-surface-variant p-4 sm:grid-cols-4">
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
          className="h-8 w-full rounded-shape-sm border border-outline bg-surface px-2 text-sm text-on-surface outline-none focus:border-primary"
        >
          <option value={VERSION_STATUS_DRAFT}>{t('pricing.statusDraft')}</option>
          <option value={VERSION_STATUS_ACTIVE}>{t('pricing.statusActive')}</option>
          <option value={VERSION_STATUS_ARCHIVED}>{t('pricing.statusArchived')}</option>
        </select>
      </div>
      <div className="flex items-center gap-2 pt-4">
        <input
          id="use-pack"
          type="checkbox"
          checked={form.use_pack}
          onChange={(e) => set('use_pack', e.target.checked)}
          className="h-4 w-4 rounded border-outline"
        />
        <Label htmlFor="use-pack" className="text-xs">{t('pricing.usePack')}</Label>
        <span className="text-[11px] text-on-surface-variant">{t('pricing.usePackHelp')}</span>
      </div>
      <div className="flex items-end gap-2 sm:col-span-3">
        <Button className="h-8 rounded-md px-3 text-xs" onClick={() => onSave(form)} disabled={saving || !form.name || !form.from_date}>
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('pricing.saving') : t('pricing.save')}
        </Button>
        <Button className="h-8 rounded-md bg-transparent px-3 text-xs text-on-surface hover:bg-surface-container" onClick={onCancel}>
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
  age_discount_percent: string
  gl_account_credit_uuid: string
  tiers: TierPayload[]
  flight_type_uuid: string
}

const EMPTY_ITEM: ItemFormState = {
  name: '',
  unit: 1,
  base_price: '',
  pack_price: '',
  age_discount_percent: '0.00',
  gl_account_credit_uuid: '',
  tiers: [],
  flight_type_uuid: '',
}

function itemToForm(item: PricingItem): ItemFormState {
  return {
    name: item.name,
    unit: item.unit,
    base_price: parseFloat(item.base_price).toFixed(2),
    pack_price: item.pack_price != null ? parseFloat(item.pack_price).toFixed(2) : '',
    age_discount_percent: parseFloat(item.age_discount_percent).toFixed(2),
    gl_account_credit_uuid: item.gl_account_credit_uuid ?? '',
    tiers: item.tiers.map((t) => ({
      from_qty: t.from_qty,
      price: parseFloat(t.price).toFixed(2),
      pack_price: t.pack_price != null ? parseFloat(t.pack_price).toFixed(2) : '',
    })),
    flight_type_uuid: item.flight_type_uuid ?? '',
  }
}

function buildItemPayload(form: ItemFormState): CreatePricingItemPayload {
  return {
    name: form.name.trim(),
    unit: form.unit,
    base_price: form.base_price.trim(),
    pack_price: form.pack_price.trim() !== '' ? form.pack_price.trim() : null,
    age_discount_percent: form.age_discount_percent.trim() !== '' ? form.age_discount_percent.trim() : '0',
    gl_account_credit_uuid: form.gl_account_credit_uuid || null,
    flight_type_uuid: form.flight_type_uuid || null,
    tiers: form.tiers.filter((t) => t.from_qty !== '' && t.price !== '').map((t) => ({
      from_qty: t.from_qty,
      price: t.price,
      pack_price: t.pack_price && t.pack_price.trim() !== '' ? t.pack_price.trim() : undefined,
    })),
  }
}

function PricingItemForm({
  initial,
  flightTypes,
  revenueAccounts,
  usePack,
  onSave,
  onCancel,
  saving,
  t,
}: {
  initial: ItemFormState
  flightTypes: Array<{ uuid: string; name: string }>
  revenueAccounts: Array<{ uuid: string; code: string; name: string }>
  usePack: boolean
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
    setForm((prev) => ({ ...prev, tiers: [...prev.tiers, { from_qty: '', price: '', pack_price: '' }] }))
  }
  function updateTier(index: number, field: keyof TierPayload, value: string) {
    setForm((prev) => {
      const tiers = prev.tiers.map((t, i) => i === index ? { ...t, [field]: value } : t)
      return { ...prev, tiers }
    })
  }
  function removeTier(index: number) {
    setForm((prev) => ({ ...prev, tiers: prev.tiers.filter((_, i) => i !== index) }))
  }

  const valid = form.name.trim() !== '' && form.base_price !== ''

  return (
    <div className="space-y-3 rounded-shape-md border border-outline-variant bg-surface-variant p-4">
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
            className="h-8 w-full rounded-shape-sm border border-outline bg-surface px-2 text-sm text-on-surface outline-none focus:border-primary"
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
            type="number"
            min="0"
            step="0.01"
            value={form.base_price}
            onChange={(e) => set('base_price', e.target.value)}
            placeholder="0.00"
            className="h-8 text-sm font-mono"
          />
          <p className="text-[11px] text-on-surface-variant">{t('pricing.basePriceHelp')}</p>
        </div>
        {usePack && (
          <div className="space-y-1">
            <Label className="text-xs">{t('pricing.packPrice')}</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.pack_price}
              onChange={(e) => set('pack_price', e.target.value)}
              placeholder="0.00"
              className="h-8 text-sm font-mono"
            />
            <p className="text-[11px] text-on-surface-variant">{t('pricing.packPriceHelp')}</p>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.ageDiscountPercent')}</Label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.age_discount_percent}
            onChange={(e) => set('age_discount_percent', e.target.value)}
            placeholder="0.00"
            className="h-8 text-sm font-mono"
          />
          <p className="text-[11px] text-on-surface-variant">{t('pricing.ageDiscountPercentHelp')}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.glAccountCredit')}</Label>
          <select
            value={form.gl_account_credit_uuid}
            onChange={(e) => set('gl_account_credit_uuid', e.target.value)}
            className="h-8 w-full rounded-shape-sm border border-outline bg-surface px-2 text-sm text-on-surface outline-none focus:border-primary"
          >
            <option value="">{t('pricing.noAccount')}</option>
            {revenueAccounts.map((a) => (
              <option key={a.uuid} value={a.uuid}>{a.code} — {a.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-on-surface-variant">{t('pricing.glAccountCreditHelp')}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.flightType')}</Label>
          <select
            value={form.flight_type_uuid}
            onChange={(e) => set('flight_type_uuid', e.target.value)}
            className="h-8 w-full rounded-shape-sm border border-outline bg-surface px-2 text-sm text-on-surface outline-none focus:border-primary"
          >
            <option value="">{t('pricing.noFlightType')}</option>
            {flightTypes.map((ft) => (
              <option key={ft.uuid} value={ft.uuid}>{ft.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Progressive price tiers */}
      <div className="space-y-2">
        <Label className="text-xs">{t('pricing.tiers')}</Label>
        <p className="text-[11px] text-on-surface-variant">{t('pricing.tiersHelp')}</p>
        {form.tiers.length === 0 && (
          <p className="text-xs text-on-surface-variant">{t('pricing.noTiers')}</p>
        )}
        {form.tiers.length > 0 && (
          <div className="space-y-1">
            <div className={`grid gap-2 text-xs font-medium text-on-surface-variant ${usePack ? 'grid-cols-[1fr_1fr_1fr_auto]' : 'grid-cols-[1fr_1fr_auto]'}`}>
              <span>{t('pricing.tierFrom')}</span>
              <span>{t('pricing.tierPrice')}</span>
              {usePack && <span>{t('pricing.tierPackPrice')}</span>}
              <span />
            </div>
            {form.tiers.map((tier, i) => (
              <div key={i} className={`items-center gap-2 grid ${usePack ? 'grid-cols-[1fr_1fr_1fr_auto]' : 'grid-cols-[1fr_1fr_auto]'}`}>
                <Input
                  type="number"
                  min={getFromQtyStep(form.unit)}
                  step={getFromQtyStep(form.unit)}
                  value={tier.from_qty}
                  onChange={(e) => updateTier(i, 'from_qty', e.target.value)}
                  placeholder={getFromQtyPlaceholder(form.unit)}
                  className="h-7 text-sm font-mono"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tier.price}
                  onChange={(e) => updateTier(i, 'price', e.target.value)}
                  placeholder="0.00"
                  className="h-7 text-sm font-mono"
                />
                {usePack && (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={tier.pack_price ?? ''}
                    onChange={(e) => updateTier(i, 'pack_price', e.target.value)}
                    placeholder="0.00"
                    className="h-7 text-sm font-mono"
                  />
                )}
                <button
                  type="button"
                  className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                  onClick={() => removeTier(i)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Button className="h-8 rounded-md bg-transparent px-3 text-xs text-on-surface hover:bg-surface-container" type="button" onClick={addTier}>
          <Plus className="mr-1 h-3 w-3" />
          {t('pricing.addTier')}
        </Button>
      </div>

      <div className="flex gap-2">
        <Button className="h-8 rounded-md px-3 text-xs" onClick={() => onSave(form)} disabled={saving || !valid}>
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('pricing.saving') : t('pricing.save')}
        </Button>
        <Button className="h-8 rounded-md bg-transparent px-3 text-xs text-on-surface hover:bg-surface-container" onClick={onCancel}>
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

  const flightTypesQuery = useFlightTypesQuery()
  const flightTypes = flightTypesQuery.data ?? []

  const accountsQuery = useAccountsQuery()
  const revenueAccounts = (accountsQuery.data ?? []).filter((a) => a.type === 5 && a.is_posting_allowed)

  const createMutation = useCreatePricingItemMutation(version.uuid)
  const updateMutation = useUpdatePricingItemMutation(version.uuid)
  const deleteMutation = useDeletePricingItemMutation(version.uuid)

  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<PricingItem | null>(null)
  const [itemError, setItemError] = useState<string | null>(null)
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<PricingItem | null>(null)

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
    try {
      await deleteMutation.mutateAsync(item.uuid)
      setItemError(null)
    } catch (e) {
      setItemError(extractError(e, t('pricing.error.deleteFailed')))
    }
  }

  const isLocked = version.is_locked
  const editable = canEdit && !isLocked && version.status === VERSION_STATUS_DRAFT

  return (
    <div className="mt-4 space-y-3 border-t border-outline-variant pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-on-surface-variant">{t('pricing.items')}</h3>
        {editable && !showForm && !editingItem && (
          <Button className="h-8 rounded-md bg-transparent px-3 text-xs text-on-surface hover:bg-surface-container" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-3 w-3" />
            {t('pricing.addItem')}
          </Button>
        )}
      </div>

      {itemError && <p className="text-xs text-error">{itemError}</p>}

      {showForm && (
        <PricingItemForm
          initial={EMPTY_ITEM}
          flightTypes={flightTypes}
          revenueAccounts={revenueAccounts}
          usePack={version.use_pack}
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          saving={createMutation.isPending}
          t={t}
        />
      )}

      {itemsQuery.isLoading ? (
        <p className="text-xs text-on-surface-variant">{t('states.loading')}</p>
      ) : items.length === 0 && !showForm ? (
        <p className="rounded-shape-sm border border-dashed border-outline-variant py-3 text-center text-xs text-on-surface-variant">
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
                revenueAccounts={revenueAccounts}
                usePack={version.use_pack}
                onSave={handleUpdate}
                onCancel={() => setEditingItem(null)}
                saving={updateMutation.isPending}
                t={t}
              />
            ) : (
              <div
                key={item.uuid}
                className="flex items-center gap-3 rounded-shape-sm border border-outline-variant bg-surface px-4 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{item.name}</p>
                  <p className="text-xs text-on-surface-variant">
                    {t(`pricing.unit${UNIT_LABELS[item.unit] ?? ''}`)}{' · '}
                    {formatPrice(item.base_price)}
                    {item.pack_price && ` · Pack: ${formatPrice(item.pack_price)}`}
                    {item.tiers.length > 0 && ` · ${item.tiers.map((tier) => `${tier.from_qty}→${formatPrice(tier.price)}`).join(' · ')}`}
                  </p>
                </div>
                {editable && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                      onClick={() => setEditingItem(item)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                      onClick={() => setConfirmDeleteItem(item)}
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
      {confirmDeleteItem && (
        <ConfirmDialog
          open={!!confirmDeleteItem}
          title={t('pricing.confirmDeleteItemTitle')}
          body={t('pricing.confirmDeleteItem')}
          confirmLabel={t('delete')}
          onConfirm={() => { setConfirmDeleteItem(null); handleDelete(confirmDeleteItem) }}
          onCancel={() => setConfirmDeleteItem(null)}
        />
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

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
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<AssetPricingVersion | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateVersion(form: VersionFormState) {
    try {
      const created = await createVersionMutation.mutateAsync({
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
        use_pack: form.use_pack,
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
        use_pack: form.use_pack,
      })
      setEditingVersion(null)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('pricing.error.saveFailed')))
    }
  }

  async function handleDeleteVersion(v: AssetPricingVersion) {
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
      <section className="rounded-shape-lg border border-outline-variant bg-surface p-6 shadow-surface-1">
        <p className="text-sm text-on-surface-variant">{t('noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-shape-lg border border-outline-variant bg-surface p-6 shadow-surface-1">
        <button
          type="button"
          className="mb-2 flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface"
          onClick={() => navigate(uuid ? `/assets/${uuid}` : '/assets')}
        >
          <ArrowLeft className="h-3 w-3" />
          {t('actions.backToDetail')}
        </button>
        <h1 className="text-xl font-semibold text-on-surface">
          {asset ? `${asset.name} — ` : ''}{t('pricing.title')}
        </h1>
        {assetType && (
          <p className="mt-1 text-sm text-on-surface-variant">
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
      <div className="rounded-shape-lg border border-outline-variant bg-surface p-4 shadow-surface-1">
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
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-variant'
                }`}
              >
                {fy.code}
                {fy.state === FY_STATE_CLOSED && (
                  <span className="ml-1 text-on-surface-variant">({t('pricing.fyClosed')})</span>
                )}
              </button>
            ))}
            {allFy.length === 0 && (
              <p className="text-xs text-on-surface-variant">{t('pricing.noFiscalYears')}</p>
            )}
          </div>
        </div>
      </div>

      {selectedFy && (
        <div className="rounded-shape-lg border border-outline-variant bg-surface p-6 shadow-surface-1">
          {/* Version header */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-on-surface-variant">
              {t('pricing.versions')} — {selectedFy.label}
            </h2>
            {canEdit && !showNewVersionForm && !editingVersion && (
              <Button className="h-8 rounded-md px-3 text-xs" onClick={() => setShowNewVersionForm(true)}>
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
                  use_pack: true,
                }}
                onSave={handleCreateVersion}
                onCancel={() => setShowNewVersionForm(false)}
                saving={createVersionMutation.isPending}
                t={t}
              />
            </div>
          )}

          {versionsQuery.isLoading ? (
            <p className="text-sm text-on-surface-variant">{t('states.loading')}</p>
          ) : versions.length === 0 && !showNewVersionForm ? (
            <p className="rounded-shape-md border border-dashed border-outline-variant p-6 text-center text-sm text-on-surface-variant">
              {t('pricing.noVersions')}
            </p>
          ) : (
            <>
              {/* Visual timeline */}
              {versions.length > 0 && (
                <div className="relative mb-4 h-6 rounded-shape-sm bg-surface-container">
                  {versions.map((v) => {
                    const { left, width } = timelineBar(selectedFy, v)
                    return (
                      <div
                        key={v.uuid}
                        title={`${v.name} · ${v.from_date} → ${v.to_date ?? '∞'}`}
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
                        use_pack: v.use_pack,
                      }}
                      onSave={handleUpdateVersion}
                      onCancel={() => setEditingVersion(null)}
                      saving={updateVersionMutation.isPending}
                      t={t}
                    />
                  ) : (
                    <div
                      key={v.uuid}
                      className="rounded-shape-md border border-outline-variant bg-surface"
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
                          <p className="text-sm font-medium text-on-surface">{v.name}</p>
                          <p className="text-xs text-on-surface-variant">
                            {v.from_date} → {v.to_date ?? t('pricing.openEnd')}
                          </p>
                        </div>
                        <VersionBadge status={v.status} t={t} />
                        {v.is_locked && (
                          <span className="rounded-full bg-error-container px-2 py-0.5 text-xs text-error">
                            {t('pricing.locked')}
                          </span>
                        )}
                        {canEdit && !v.is_locked && v.status === VERSION_STATUS_DRAFT && (
                          <div
                            className="flex shrink-0 gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="rounded p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                              onClick={() => setEditingVersion(v)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                              onClick={() => setConfirmDeleteVersion(v)}
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
      {confirmDeleteVersion && (
        <ConfirmDialog
          open={!!confirmDeleteVersion}
          title={t('pricing.confirmDeleteVersionTitle')}
          body={t('pricing.confirmDeleteVersion', { name: confirmDeleteVersion.name })}
          confirmLabel={t('delete')}
          onConfirm={() => { const v = confirmDeleteVersion; setConfirmDeleteVersion(null); handleDeleteVersion(v) }}
          onCancel={() => setConfirmDeleteVersion(null)}
        />
      )}
    </section>
  )
}
