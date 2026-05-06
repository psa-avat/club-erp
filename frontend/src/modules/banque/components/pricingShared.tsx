/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque/pricing: Composants partagés et helpers pour les pages de gestion des tarifs
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
import { useTranslation } from 'react-i18next'
import { Plus, Check, X, Pencil, Trash2 } from 'lucide-react'
import { AxiosError } from 'axios'
import Decimal from 'decimal.js'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useAccountsQuery, type PricingVersion } from '../api'
import {
  useFlightTypesQuery,
  usePricingItemsQuery,
  useCreatePricingItemMutation,
  useUpdatePricingItemMutation,
  useDeletePricingItemMutation,
} from '../../assets/api'
import type { PricingItem, TierPayload, CreatePricingItemPayload } from '../../assets/types'

// ── Constants ────────────────────────────────────────────────────────────────

export const VERSION_STATUS_DRAFT = 1
export const VERSION_STATUS_ACTIVE = 2
export const VERSION_STATUS_ARCHIVED = 3

export const FY_STATE_OPEN = 1
export const FY_STATE_CLOSED = 2

export const UNIT_LABELS: Record<number, string> = {
  1: 'FlightTime',
  2: 'EngineTimeMin',
  3: 'EngineTime1_100h',
  4: 'FlightDuration',
  5: 'PerFlight',
  6: 'Fixed',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function fyStateLabel(state: number, t: (k: string) => string): { label: string; className: string } {
  if (state === FY_STATE_OPEN) return { label: t('pricing.fy.stateOpen'), className: 'bg-success-container text-on-success-container' }
  if (state === FY_STATE_CLOSED) return { label: t('pricing.fy.stateClosed'), className: 'bg-surface-container text-on-surface-variant' }
  return { label: t('pricing.fy.stateReopened'), className: 'bg-warning-container text-on-warning-container' }
}

export function versionStatusLabel(status: number, t: (k: string) => string): { label: string; className: string } {
  if (status === VERSION_STATUS_DRAFT) return { label: t('pricing.version.statusDraft'), className: 'bg-warning-container text-on-warning-container' }
  if (status === VERSION_STATUS_ACTIVE) return { label: t('pricing.version.statusActive'), className: 'bg-success-container text-on-success-container' }
  return { label: t('pricing.version.statusArchived'), className: 'bg-surface-container text-on-surface-variant' }
}

export function versionScopeLabel(version: PricingVersion, t: (k: string) => string): { label: string; className: string } {
  if (version.asset_type_uuid !== null) {
    return { label: t('pricing.version.assetScope'), className: 'bg-primary-container text-on-primary-container' }
  }
  return { label: t('pricing.version.genericScope'), className: 'bg-surface-container-high text-on-surface-variant' }
}

export function formatPrice(value: string | null | undefined): string {
  if (!value) return '—'
  try { return new Decimal(value).toFixed(2) } catch { return value ?? '—' }
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function addDaysIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getFromQtyStep(unit: number): string {
  return unit === 1 ? '0.1' : '1'
}

export function getFromQtyPlaceholder(unit: number): string {
  return unit === 1 ? '0.0' : '0'
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ItemFormState = {
  name: string
  unit: number
  base_price: string
  pack_price: string
  age_discount_percent: string
  gl_account_credit_uuid: string
  tiers: TierPayload[]
  flight_type_uuid: string
}

export const EMPTY_ITEM: ItemFormState = {
  name: '', unit: 1, base_price: '', pack_price: '',
  age_discount_percent: '0.00', gl_account_credit_uuid: '', tiers: [], flight_type_uuid: '',
}

export type VersionFormState = {
  name: string
  from_date: string
  to_date: string
  status: number
}

// ── Payload builders ──────────────────────────────────────────────────────────

export function itemToForm(item: PricingItem): ItemFormState {
  return {
    name: item.name,
    unit: item.unit,
    base_price: parseFloat(item.base_price).toFixed(2),
    pack_price: item.pack_price != null ? parseFloat(item.pack_price).toFixed(2) : '',
    age_discount_percent: parseFloat(item.age_discount_percent).toFixed(2),
    tiers: item.tiers.map((t) => ({
      from_qty: t.from_qty,
      price: parseFloat(t.price).toFixed(2),
      pack_price: t.pack_price != null ? parseFloat(t.pack_price).toFixed(2) : '',
    })),
    gl_account_credit_uuid: item.gl_account_credit_uuid ?? '',
    flight_type_uuid: item.flight_type_uuid ?? '',
  }
}

export function buildItemPayload(
  form: ItemFormState,
  options: { isAssetScoped: boolean; usePack: boolean },
): CreatePricingItemPayload {
  if (options.isAssetScoped) {
    return {
      name: form.name.trim(),
      unit: form.unit,
      base_price: form.base_price.trim(),
      pack_price: options.usePack && form.pack_price.trim() !== '' ? form.pack_price.trim() : null,
      age_discount_percent: form.age_discount_percent.trim() !== '' ? form.age_discount_percent.trim() : '0',
      gl_account_credit_uuid: form.gl_account_credit_uuid || null,
      flight_type_uuid: form.flight_type_uuid || null,
      tiers: form.tiers
        .filter((tier) => tier.from_qty !== '' && tier.price !== '')
        .map((tier) => ({
          from_qty: tier.from_qty,
          price: tier.price,
          pack_price:
            options.usePack && tier.pack_price && tier.pack_price.trim() !== ''
              ? tier.pack_price.trim()
              : undefined,
        })),
    }
  }
  return {
    name: form.name.trim(),
    unit: 6,
    base_price: form.base_price.trim(),
    pack_price: null,
    age_discount_percent: form.age_discount_percent.trim() !== '' ? form.age_discount_percent.trim() : '0',
    gl_account_credit_uuid: form.gl_account_credit_uuid || null,
    flight_type_uuid: null,
    tiers: [],
  }
}

// ── Sub-component: Version Status Badge ─────────────────────────────────────

export function VersionBadge({ status, t }: { status: number; t: (k: string) => string }) {
  const { label, className } = versionStatusLabel(status, t)
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>
  )
}

// ── Sub-component: Activate Button with GL Account Check ──────────────────────

export function ActivateVersionButton({
  version,
  onActivate,
  disabled = false,
  t,
}: {
  version: PricingVersion
  onActivate: (v: PricingVersion) => void
  disabled?: boolean
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const itemsQuery = usePricingItemsQuery(version.uuid, true)
  const items = itemsQuery.data ?? []

  const missingGlCount = items.filter((item) => !item.gl_account_credit_uuid).length
  const totalCount = items.length
  const completeCount = totalCount - missingGlCount
  const readinessPct = totalCount > 0 ? Math.round((completeCount / totalCount) * 100) : 0
  const canActivate = !disabled && missingGlCount === 0 && totalCount > 0

  const helperText = missingGlCount > 0
    ? t('pricing.version.guard.missingGlAccounts', { count: missingGlCount })
    : totalCount === 0
      ? t('pricing.version.guard.noItems')
      : t('pricing.version.guard.ready')

  return (
    <div className="space-y-2" title={helperText}>
      <button
        type="button"
        disabled={!canActivate}
        className={`rounded px-2 py-1 text-xs transition-colors ${
          canActivate
            ? 'text-on-success-container hover:bg-success-container'
            : 'text-on-surface-variant cursor-not-allowed opacity-50'
        }`}
        title={t('pricing.version.activateTitle')}
        onClick={() => onActivate(version)}
      >
        {t('pricing.version.activate')}
      </button>
      <div className="w-44 space-y-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-container">
          <div
            className={`h-full rounded-full transition-all ${
              missingGlCount === 0 && totalCount > 0 ? 'bg-success-container' : 'bg-warning-container'
            }`}
            style={{ width: `${readinessPct}%` }}
          />
        </div>
        <p className="text-[11px] text-on-surface-variant">
          {t('pricing.version.guard.progress', { complete: completeCount, total: totalCount, pct: readinessPct })}
        </p>
        <p className={`text-[11px] ${missingGlCount === 0 && totalCount > 0 ? 'text-success' : 'text-on-surface-variant'}`}>
          {helperText}
        </p>
      </div>
    </div>
  )
}

// ── Sub-component: Version metadata form ─────────────────────────────────────

export function VersionForm({
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
    <div className="grid gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-4 md:grid-cols-4">
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
          className="h-8 w-full rounded-shape-sm border border-outline-variant bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-outline-variant"
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

// ── Sub-component: Pricing Item Form ─────────────────────────────────────────

export function PricingItemForm({
  initial,
  flightTypes,
  revenueAccounts,
  isAssetScoped,
  usePack,
  onSave,
  onCancel,
  saving,
}: {
  initial: ItemFormState
  flightTypes: Array<{ uuid: string; name: string }>
  revenueAccounts: Array<{ uuid: string; code: string; name: string }>
  isAssetScoped: boolean
  usePack: boolean
  onSave: (f: ItemFormState) => void
  onCancel: () => void
  saving: boolean
}) {
  const { t } = useTranslation('assets')
  const [form, setForm] = useState<ItemFormState>(initial)
  function set<K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function addTier() {
    setForm((prev) => ({ ...prev, tiers: [...prev.tiers, { from_qty: '', price: '', pack_price: '' }] }))
  }

  function updateTier(index: number, field: keyof TierPayload, value: string) {
    setForm((prev) => {
      const tiers = prev.tiers.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier))
      return { ...prev, tiers }
    })
  }

  function removeTier(index: number) {
    setForm((prev) => ({ ...prev, tiers: prev.tiers.filter((_, i) => i !== index) }))
  }

  const valid = form.name.trim() !== '' && form.base_price !== ''

  return (
    <div className="space-y-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-4">
      <p className="text-xs text-on-surface-variant">
        {isAssetScoped ? t('pricing.tiersHelp') : t('pricing.genericItemHelp')}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">{t('pricing.itemName')} *</Label>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-sm" />
        </div>
        {isAssetScoped ? (
          <div className="space-y-1">
            <Label className="text-xs">{t('pricing.itemUnit')}</Label>
            <select
              value={form.unit}
              onChange={(e) => set('unit', Number(e.target.value))}
              className="h-8 w-full rounded-shape-sm border border-outline-variant bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-outline-variant"
            >
              {Object.entries(UNIT_LABELS).map(([unit, label]) => (
                <option key={unit} value={Number(unit)}>
                  {t(`pricing.unit${label}`)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs">{t('pricing.itemMode')}</Label>
            <div className="flex h-8 items-center rounded-shape-sm border border-outline-variant bg-white px-2 text-sm text-on-surface">
              {t('pricing.genericItemMode')}
            </div>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">{t('pricing.basePrice')} *</Label>
          <Input
            type="number" min="0" step="0.01"
            value={form.base_price}
            onChange={(e) => set('base_price', e.target.value)}
            placeholder="0.00"
            className="h-8 text-sm font-mono"
          />
          <p className="text-[11px] text-on-surface-variant">{t('pricing.basePriceHelp')}</p>
        </div>
        {isAssetScoped && usePack && (
          <div className="space-y-1">
            <Label className="text-xs">{t('pricing.packPrice')}</Label>
            <Input
              type="number" min="0" step="0.01"
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
            type="number" min="0" max="100" step="0.01"
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
            className="h-8 w-full rounded-shape-sm border border-outline-variant bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-outline-variant"
          >
            <option value="">{t('pricing.noAccount')}</option>
            {revenueAccounts.map((a) => (
              <option key={a.uuid} value={a.uuid}>{a.code} — {a.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-on-surface-variant">{t('pricing.glAccountCreditHelp')}</p>
        </div>
        {isAssetScoped && (
          <div className="space-y-1">
            <Label className="text-xs">{t('pricing.flightType')}</Label>
            <select
              value={form.flight_type_uuid}
              onChange={(e) => set('flight_type_uuid', e.target.value)}
              className="h-8 w-full rounded-shape-sm border border-outline-variant bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-outline-variant"
            >
              <option value="">{t('pricing.noFlightType')}</option>
              {flightTypes.map((flightType) => (
                <option key={flightType.uuid} value={flightType.uuid}>
                  {flightType.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {isAssetScoped && (
        <div className="space-y-2">
          <Label className="text-xs">{t('pricing.tiers')}</Label>
          <p className="text-[11px] text-on-surface-variant">{t('pricing.tiersHelp')}</p>
          {form.tiers.length === 0 && (
            <p className="text-xs text-on-surface-variant">{t('pricing.noTiers')}</p>
          )}
          {form.tiers.length > 0 && (
            <div className="space-y-1">
              <div
                className={`grid gap-2 text-xs font-medium text-on-surface-variant ${
                  usePack ? 'grid-cols-[1fr_1fr_1fr_auto]' : 'grid-cols-[1fr_1fr_auto]'
                }`}
              >
                <span>{t('pricing.tierFrom')}</span>
                <span>{t('pricing.tierPrice')}</span>
                {usePack && <span>{t('pricing.tierPackPrice')}</span>}
                <span />
              </div>
              {form.tiers.map((tier, index) => (
                <div
                  key={index}
                  className={`grid items-center gap-2 ${
                    usePack ? 'grid-cols-[1fr_1fr_1fr_auto]' : 'grid-cols-[1fr_1fr_auto]'
                  }`}
                >
                  <Input
                    type="number"
                    min={getFromQtyStep(form.unit)}
                    step={getFromQtyStep(form.unit)}
                    value={tier.from_qty}
                    onChange={(e) => updateTier(index, 'from_qty', e.target.value)}
                    placeholder={getFromQtyPlaceholder(form.unit)}
                    className="h-7 text-sm font-mono"
                  />
                  <Input
                    type="number" min="0" step="0.01"
                    value={tier.price}
                    onChange={(e) => updateTier(index, 'price', e.target.value)}
                    placeholder="0.00"
                    className="h-7 text-sm font-mono"
                  />
                  {usePack && (
                    <Input
                      type="number" min="0" step="0.01"
                      value={tier.pack_price ?? ''}
                      onChange={(e) => updateTier(index, 'pack_price', e.target.value)}
                      placeholder="0.00"
                      className="h-7 text-sm font-mono"
                    />
                  )}
                  <button
                    type="button"
                    className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                    onClick={() => removeTier(index)}
                  >
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

// ── Sub-component: Pricing Items Panel ───────────────────────────────────────

export function PricingItemsPanel({
  version,
  canEdit,
}: {
  version: PricingVersion
  canEdit: boolean
}) {
  const { t } = useTranslation('assets')
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
  const isAssetScoped = version.asset_type_uuid !== null

  function extractItemError(e: unknown): string {
    if (e instanceof AxiosError && e.response?.data?.detail) return String(e.response.data.detail)
    return t('pricing.error.saveFailed')
  }

  async function handleCreate(form: ItemFormState) {
    try {
      await createMutation.mutateAsync(buildItemPayload(form, { isAssetScoped, usePack: version.use_pack }))
      setShowForm(false)
      setItemError(null)
    } catch (e) { setItemError(extractItemError(e)) }
  }

  async function handleUpdate(form: ItemFormState) {
    if (!editingItem) return
    try {
      await updateMutation.mutateAsync({
        uuid: editingItem.uuid,
        ...buildItemPayload(form, { isAssetScoped, usePack: version.use_pack }),
      })
      setEditingItem(null)
      setItemError(null)
    } catch (e) { setItemError(extractItemError(e)) }
  }

  async function handleDelete(item: PricingItem) {
    if (!window.confirm(t('pricing.confirmDeleteItem'))) return
    try {
      await deleteMutation.mutateAsync(item.uuid)
    } catch (e) { setItemError(extractItemError(e)) }
  }

  const editable = canEdit && !version.is_locked && version.status === VERSION_STATUS_DRAFT

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-on-surface">{t('pricing.items')}</p>
        {editable && !showForm && !editingItem && (
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-3 w-3" />
            {t('pricing.addItem')}
          </button>
        )}
      </div>

      {itemError && <p className="text-xs text-error">{itemError}</p>}

      {showForm && (
        <PricingItemForm
          initial={EMPTY_ITEM}
          flightTypes={flightTypes}
          revenueAccounts={revenueAccounts}
          isAssetScoped={isAssetScoped}
          usePack={version.use_pack}
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          saving={createMutation.isPending}
        />
      )}

      {itemsQuery.isLoading ? (
        <p className="text-xs text-on-surface-variant">{t('states.loading')}</p>
      ) : items.length === 0 && !showForm ? (
        <p className="rounded border border-dashed border-outline-variant py-3 text-center text-xs text-on-surface-variant">
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
                revenueAccounts={revenueAccounts}
                isAssetScoped={isAssetScoped}
                usePack={version.use_pack}
                onSave={handleUpdate}
                onCancel={() => setEditingItem(null)}
                saving={updateMutation.isPending}
              />
            ) : (
              <div
                key={item.uuid}
                className="flex items-center gap-3 rounded-shape-sm border border-outline-variant bg-surface-container-lowest px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{item.name}</p>
                  <p className="mt-0.5 truncate text-xs text-on-surface-variant">
                    {isAssetScoped ? (
                      <>
                        {t(`pricing.unit${UNIT_LABELS[item.unit] ?? ''}`)}{' · '}
                        {formatPrice(item.base_price)}
                        {version.use_pack && item.pack_price && ` · Pack: ${formatPrice(item.pack_price)}`}
                        {item.tiers.length > 0 &&
                          ` · ${item.tiers.map((tier) => `${tier.from_qty}→${formatPrice(tier.price)}`).join(' · ')}`}
                      </>
                    ) : (
                      <>
                        {t('pricing.genericItemMode')}
                        {' · '}{formatPrice(item.base_price)} €
                        {item.age_discount_percent !== '0' && item.age_discount_percent !== '0.00' && (
                          <> · {t('pricing.ageDiscountSummary', { percent: formatPrice(item.age_discount_percent) })}</>
                        )}
                      </>
                    )}
                  </p>
                </div>
                {editable && (
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      className="rounded p-1 text-on-surface-variant hover:bg-white hover:text-on-surface"
                      onClick={() => setEditingItem(item)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
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
