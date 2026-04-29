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
import { Plus, Copy, Trash2, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { AxiosError } from 'axios'
import Decimal from 'decimal.js'

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
  useCreatePricingVersionMutation,
  useUpdatePricingVersionMutation,
  useDeletePricingVersionMutation,
  useClonePricingVersionMutation,
  useCopyPricingVersionsMutation,
  useAccountsQuery,
  type FiscalYear,
  type PricingVersion,
} from '../api'
import {
  usePricingItemsQuery,
  useCreatePricingItemMutation,
  useUpdatePricingItemMutation,
  useDeletePricingItemMutation,
  useFlightTypesQuery,
} from '../../assets/api'
import type { PricingItem, TierPayload, CreatePricingItemPayload } from '../../assets/types'

// ── Constants ────────────────────────────────────────────────────────────────

const VERSION_STATUS_DRAFT = 1
const VERSION_STATUS_ACTIVE = 2
const VERSION_STATUS_ARCHIVED = 3

const FY_STATE_OPEN = 1
const FY_STATE_CLOSED = 2

// ── Helpers ──────────────────────────────────────────────────────────────────

function fyStateLabel(state: number, t: (k: string) => string): { label: string; className: string } {
  if (state === FY_STATE_OPEN) return { label: t('pricing.fy.stateOpen'), className: 'bg-success-container text-on-success-container' }
  if (state === FY_STATE_CLOSED) return { label: t('pricing.fy.stateClosed'), className: 'bg-surface-container text-on-surface-variant' }
  return { label: t('pricing.fy.stateReopened'), className: 'bg-warning-container text-on-warning-container' }
}

function versionStatusLabel(status: number, t: (k: string) => string): { label: string; className: string } {
  if (status === VERSION_STATUS_DRAFT) return { label: t('pricing.version.statusDraft'), className: 'bg-warning-container text-on-warning-container' }
  if (status === VERSION_STATUS_ACTIVE) return { label: t('pricing.version.statusActive'), className: 'bg-success-container text-on-success-container' }
  return { label: t('pricing.version.statusArchived'), className: 'bg-surface-container text-on-surface-variant' }
}

// ── Pricing item helpers ──────────────────────────────────────────────────────

const UNIT_LABELS: Record<number, string> = {
  1: 'FlightTime',
  2: 'EngineTimeMin',
  3: 'EngineTime1_100h',
  4: 'FlightDuration',
  5: 'PerFlight',
  6: 'Fixed',
}

function formatPrice(value: string | null | undefined): string {
  if (!value) return '—'
  try { return new Decimal(value).toFixed(2) } catch { return value ?? '—' }
}

function getFromQtyStep(unit: number): string {
  return unit === 1 ? '0.1' : '1'
}

function getFromQtyPlaceholder(unit: number): string {
  return unit === 1 ? '0.0' : '0'
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

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
  name: '', unit: 1, base_price: '', pack_price: '',
  age_discount_percent: '0.00', gl_account_credit_uuid: '', tiers: [], flight_type_uuid: '',
}

function itemToForm(item: PricingItem): ItemFormState {
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

function buildItemPayload(form: ItemFormState): CreatePricingItemPayload {
  return {
    name: form.name.trim(),
    unit: form.unit,
    base_price: form.base_price.trim(),
    pack_price: form.pack_price.trim() !== '' ? form.pack_price.trim() : null,
    age_discount_percent: form.age_discount_percent.trim() !== '' ? form.age_discount_percent.trim() : '0',
    gl_account_credit_uuid: form.gl_account_credit_uuid || null,
    flight_type_uuid: form.flight_type_uuid || null,
    tiers: form.tiers
      .filter((t) => t.from_qty !== '' && t.price !== '')
      .map((t) => ({
        from_qty: t.from_qty,
        price: t.price,
        pack_price: t.pack_price && t.pack_price.trim() !== '' ? t.pack_price.trim() : undefined,
      })),
  }
}

// ── Sub-component: Pricing Item Form ─────────────────────────────────────────

function PricingItemForm({
  initial,
  flightTypes,
  revenueAccounts,
  usePack,
  onSave,
  onCancel,
  saving,
}: {
  initial: ItemFormState
  flightTypes: Array<{ uuid: string; name: string }>
  revenueAccounts: Array<{ uuid: string; code: string; name: string }>
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
    <div className="space-y-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-4">
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
            className="h-8 w-full rounded-shape-sm border border-outline-variant bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-outline-variant"
          >
            {Object.entries(UNIT_LABELS).map(([k, label]) => (
              <option key={k} value={Number(k)}>{t(`pricing.unit${label}`)}</option>
            ))}
          </select>
        </div>
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
        {usePack && (
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
        {flightTypes.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">{t('pricing.flightType')}</Label>
            <select
              value={form.flight_type_uuid}
              onChange={(e) => set('flight_type_uuid', e.target.value)}
              className="h-8 w-full rounded-shape-sm border border-outline-variant bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-outline-variant"
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
        <p className="text-[11px] text-on-surface-variant">{t('pricing.tiersHelp')}</p>
        {form.tiers.length === 0 && <p className="text-xs text-on-surface-variant">{t('pricing.noTiers')}</p>}
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
                  type="number" min="0" step="0.01"
                  value={tier.price}
                  onChange={(e) => updateTier(i, 'price', e.target.value)}
                  placeholder="0.00"
                  className="h-7 text-sm font-mono"
                />
                {usePack && (
                  <Input
                    type="number" min="0" step="0.01"
                    value={tier.pack_price ?? ''}
                    onChange={(e) => updateTier(i, 'pack_price', e.target.value)}
                    placeholder="0.00"
                    className="h-7 text-sm font-mono"
                  />
                )}
                <button type="button" className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error" onClick={() => removeTier(i)}>
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

// ── Sub-component: Pricing Items Panel ───────────────────────────────────────

function PricingItemsPanel({
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

  function extractItemError(e: unknown): string {
    if (e instanceof AxiosError && e.response?.data?.detail) return String(e.response.data.detail)
    return t('pricing.error.saveFailed')
  }

  async function handleCreate(form: ItemFormState) {
    try {
      await createMutation.mutateAsync(buildItemPayload(form))
      setShowForm(false)
      setItemError(null)
    } catch (e) { setItemError(extractItemError(e)) }
  }

  async function handleUpdate(form: ItemFormState) {
    if (!editingItem) return
    try {
      await updateMutation.mutateAsync({ uuid: editingItem.uuid, ...buildItemPayload(form) })
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
    <div className="mt-3 space-y-3 border-t border-outline-variant pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-on-surface-variant">{t('pricing.items')}</p>
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
  onActivate,
  onRevertToDraft,
  onArchive,
  onClone,
}: {
  fy: FiscalYear
  versions: PricingVersion[]
  canEdit: boolean
  t: (k: string, opts?: Record<string, unknown>) => string
  onDelete: (v: PricingVersion) => void
  onEdit: (v: PricingVersion) => void
  onActivate: (v: PricingVersion) => void
  onRevertToDraft: (v: PricingVersion) => void
  onArchive: (v: PricingVersion) => void
  onClone: (v: PricingVersion) => void
}) {
  const [expandedUuid, setExpandedUuid] = useState<string | null>(null)

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
          const isExpanded = expandedUuid === v.uuid
          return (
            <div
              key={v.uuid}
              className="rounded-lg border border-outline-variant bg-white"
            >
              {/* Version row header */}
              <div className="flex items-center gap-3 px-4 py-2">
                <button
                  type="button"
                  className="shrink-0 text-on-surface-variant hover:text-on-surface"
                  title={isExpanded ? t('pricing.version.collapse') : t('pricing.version.expand')}
                  onClick={() => setExpandedUuid(isExpanded ? null : v.uuid)}
                >
                  {isExpanded
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{v.name}</p>
                  <p className="text-xs text-on-surface-variant">
                    {v.from_date} → {v.to_date ?? t('pricing.version.openEnd')}
                  </p>
                </div>
                <VersionBadge status={v.status} t={t} />
                {v.is_locked && (
                  <span className="rounded-full bg-error-container px-2 py-0.5 text-xs text-error">
                    {t('pricing.version.locked')}
                  </span>
                )}
                {canEdit && !v.is_locked && v.status === VERSION_STATUS_DRAFT && fy.state !== FY_STATE_CLOSED && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-on-success-container hover:bg-success-container"
                      title={t('pricing.version.activateTitle')}
                      onClick={() => onActivate(v)}
                    >
                      {t('pricing.version.activate')}
                    </button>
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
                  <div className="flex shrink-0 gap-1">
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

              {/* Expanded: pricing items panel */}
              {isExpanded && (
                <div className="border-t border-outline-variant px-4 pb-4">
                  <PricingItemsPanel version={v} canEdit={canEdit} />
                </div>
              )}
            </div>
          )
        })}
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
  const cloneVersionMutation = useClonePricingVersionMutation(selectedFy?.uuid ?? '')
  const copyVersionsMutation = useCopyPricingVersionsMutation()

  // UI state
  const [showNewFyForm, setShowNewFyForm] = useState(false)
  const [showNewVersionForm, setShowNewVersionForm] = useState(false)
  const [editingVersion, setEditingVersion] = useState<PricingVersion | null>(null)
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
    try {
      await deleteVersionMutation.mutateAsync(v.uuid)
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  async function handleCopyFromPrev() {
    if (!selectedFy || !prevFy) return
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

  async function handleActivateVersion(v: PricingVersion) {
    try {
      await updateVersionMutation.mutateAsync({
        uuid: v.uuid,
        status: VERSION_STATUS_ACTIVE,
      })
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
  }

  async function handleRevertToDraft(v: PricingVersion) {
    try {
      await updateVersionMutation.mutateAsync({
        uuid: v.uuid,
        status: VERSION_STATUS_DRAFT,
      })
      setError(null)
    } catch (e) {
      setError(extractError(e))
    }
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
    } catch (e) {
      setError(extractError(e))
    }
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
          {canManagePrices && !showNewFyForm && (
            <Button size="sm" variant="secondary" onClick={() => setShowNewFyForm(true)}>
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
        <p className="text-sm text-on-surface-variant">{t('pricing.loading')}</p>
      )}

      {/* Fiscal year tabs */}
      {allFiscalYears.length > 0 && (
        <div className="rounded-xl border border-outline-variant bg-white shadow-sm">
          {/* FY selector strip */}
          <div className="flex flex-wrap gap-2 border-b border-outline-variant px-4 py-3">
            {/* Future fiscal years */}
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

            {/* Current fiscal years */}
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

            {/* Past fiscal years */}
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

          {/* Selected FY content */}
          {selectedFy && (
            <div className="p-6 space-y-4">
              {/* FY info bar */}
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

              {/* Error banner */}
              {error && (
                <div className="rounded-lg border border-error bg-error-container px-4 py-2 text-sm text-error">
                  {error}
                  <button
                    type="button"
                    className="ml-2 text-error opacity-60 hover:opacity-100"
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
                <p className="text-sm text-on-surface-variant">{t('pricing.loading')}</p>
              ) : (
                <VersionTimeline
                  fy={selectedFy}
                  versions={versions}
                  canEdit={canEditVersions}
                  t={t}
                  onDelete={(v) => setConfirmDeleteVersion(v)}
                  onEdit={(v) => {
                    setEditingVersion(v)
                    setShowNewVersionForm(false)
                  }}
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
          onConfirm={() => {
            const version = confirmDeleteVersion
            setConfirmDeleteVersion(null)
            handleDeleteVersion(version)
          }}
          onCancel={() => setConfirmDeleteVersion(null)}
        />
      )}

      {confirmActivateVersion && (
        <ConfirmDialog
          open={!!confirmActivateVersion}
          title={t('pricing.version.confirmActivateTitle')}
          body={t('pricing.version.confirmActivateBody')}
          confirmLabel={t('pricing.version.activate')}
          onConfirm={() => {
            const version = confirmActivateVersion
            setConfirmActivateVersion(null)
            handleActivateVersion(version)
          }}
          onCancel={() => setConfirmActivateVersion(null)}
        />
      )}

      {confirmRevertVersion && (
        <ConfirmDialog
          open={!!confirmRevertVersion}
          title={t('pricing.version.confirmRevertTitle')}
          body={t('pricing.version.confirmRevertBody')}
          confirmLabel={t('pricing.version.revert')}
          onConfirm={() => {
            const version = confirmRevertVersion
            setConfirmRevertVersion(null)
            handleRevertToDraft(version)
          }}
          onCancel={() => setConfirmRevertVersion(null)}
        />
      )}

      {confirmCopyFromPrev && selectedFy && prevFy && (
        <ConfirmDialog
          open={confirmCopyFromPrev}
          title={t('pricing.version.confirmCopyTitle')}
          body={t('pricing.version.confirmCopy', { from: prevFy.code, to: selectedFy.code })}
          confirmLabel={t('pricing.version.copyFrom', { code: prevFy.code })}
          onConfirm={() => {
            setConfirmCopyFromPrev(false)
            handleCopyFromPrev()
          }}
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
            <Button type="button" variant="ghost" onClick={() => setCloneSourceVersion(null)}>
              {t('pricing.version.cancel')}
            </Button>
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
                <Input
                  type="date"
                  value={archiveNextFromDate}
                  onChange={(e) => setArchiveNextFromDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setArchiveVersion(null)}>
              {t('pricing.version.cancel')}
            </Button>
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
