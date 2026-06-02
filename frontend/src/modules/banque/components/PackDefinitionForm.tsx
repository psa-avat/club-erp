/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque/packs: Pack definition form — edit metadata + applicability links
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
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select } from '../../../components/ui/select'
import type { PackDefinition, ApplicableItem } from '../../banque/types/packs'

export type PackFormState = {
  code: string
  name: string
  fiscal_year_uuid: string
  pack_type: string
  quantity_allowance: string
  quantity_unit: string
  eligible_asset_type_uuid: string | null
  pack_sales_account_uuid: string | null
  rem_discount_account_uuid: string | null
  priority: number
}

export type ApplicableItemFormEntry = {
  pricing_item_uuid: string
  discounted_unit_price: string
  _key: string // local unique key for React list rendering
}

type Props = {
  initial: PackFormState
  applicability: ApplicableItemFormEntry[]
  fiscalYears: { uuid: string; code: string }[]
  pricingItems: { uuid: string; name: string; base_price: string }[]
  accounts: { uuid: string; code: string; name: string }[]
  assetTypes: { uuid: string; code: string; name: string }[]
  saving: boolean
  onSave: (form: PackFormState, items: ApplicableItemFormEntry[]) => Promise<void>
  onCancel: () => void
}

let _itemKey = 0
function nextKey(): string {
  _itemKey += 1
  return `item_${_itemKey}`
}

export function PackDefinitionForm({
  initial,
  applicability,
  fiscalYears,
  pricingItems,
  accounts,
  assetTypes,
  saving,
  onSave,
  onCancel,
}: Props) {
  const { t } = useTranslation('banque')

  const [form, setForm] = useState<PackFormState>(initial)
  const [items, setItems] = useState<ApplicableItemFormEntry[]>(applicability)

  const set = (field: keyof PackFormState, value: string | number) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { pricing_item_uuid: '', discounted_unit_price: '0', _key: nextKey() },
    ])

  const updateItem = (key: string, field: 'pricing_item_uuid' | 'discounted_unit_price', value: string) =>
    setItems((prev) => prev.map((i) => (i._key === key ? { ...i, [field]: value } : i)))

  const removeItem = (key: string) =>
    setItems((prev) => prev.filter((i) => i._key !== key))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(form, items)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Metadata Section ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">{t('packs.form.metadata')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="code">{t('packs.form.code')}</Label>
            <Input id="code" value={form.code} onChange={(e) => set('code', e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">{t('packs.form.name')}</Label>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pack_type">{t('packs.form.packType')}</Label>
            <Select id="pack_type" value={form.pack_type} onChange={(e) => set('pack_type', e.target.value)}>
              <option value="flight_hours">Flight hours</option>
              <option value="winch_launches">Winch launches</option>
              <option value="tow_launches">Tow launches</option>
              <option value="engine_time">Engine time</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fiscal_year">{t('packs.form.fiscalYear')}</Label>
            <Select id="fiscal_year" value={form.fiscal_year_uuid} onChange={(e) => set('fiscal_year_uuid', e.target.value)} required>
              <option value="">{t('common.select')}</option>
              {fiscalYears.map((fy) => (
                <option key={fy.uuid} value={fy.uuid}>{fy.code}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="qty">{t('packs.form.quantityAllowance')}</Label>
            <Input id="qty" type="number" step="0.01" min="0" value={form.quantity_allowance}
              onChange={(e) => set('quantity_allowance', e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="unit">{t('packs.form.quantityUnit')}</Label>
            <Select id="unit" value={form.quantity_unit} onChange={(e) => set('quantity_unit', e.target.value)}>
              <option value="hours">Hours</option>
              <option value="launches">Launches</option>
              <option value="centihours">Centihours</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="asset_type">{t('packs.form.eligibleAssetType')}</Label>
            <Select id="asset_type" value={form.eligible_asset_type_uuid ?? ''}
              onChange={(e) => set('eligible_asset_type_uuid', e.target.value || null)}>
              <option value="">{t('common.all')}</option>
              {assetTypes.map((at) => (
                <option key={at.uuid} value={at.uuid}>{at.code} — {at.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sales_acct">{t('packs.form.salesAccount')}</Label>
            <Select id="sales_acct" value={form.pack_sales_account_uuid ?? ''}
              onChange={(e) => set('pack_sales_account_uuid', e.target.value || null)}>
              <option value="">{t('common.default')}</option>
              {accounts.map((a) => (
                <option key={a.uuid} value={a.uuid}>{a.code} — {a.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="disc_acct">{t('packs.form.discountAccount')}</Label>
            <Select id="disc_acct" value={form.rem_discount_account_uuid ?? ''}
              onChange={(e) => set('rem_discount_account_uuid', e.target.value || null)}>
              <option value="">{t('common.default')}</option>
              {accounts.map((a) => (
                <option key={a.uuid} value={a.uuid}>{a.code} — {a.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="priority">{t('packs.form.priority')}</Label>
            <Input id="priority" type="number" min="0" value={form.priority}
              onChange={(e) => set('priority', parseInt(e.target.value, 10) || 0)} />
          </div>
        </div>
      </div>

      {/* ── Applicability Section ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{t('packs.form.applicableRates')}</h3>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="mr-1 h-4 w-4" /> {t('common.add')}
          </Button>
        </div>
        {items.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">{t('packs.form.noRates')}</p>
        )}
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item._key} className="flex items-end gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">{t('packs.form.pricingItem')}</Label>
                <Select value={item.pricing_item_uuid}
                  onChange={(e) => updateItem(item._key, 'pricing_item_uuid', e.target.value)}>
                  <option value="">{t('common.select')}</option>
                  {pricingItems.map((pi) => (
                    <option key={pi.uuid} value={pi.uuid}>
                      {pi.name} (base: {pi.base_price})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-40 space-y-1">
                <Label className="text-xs">{t('packs.form.discountedPrice')}</Label>
                <Input type="number" step="0.0001" min="0" value={item.discounted_unit_price}
                  onChange={(e) => updateItem(item._key, 'discounted_unit_price', e.target.value)} />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(item._key)} className="mb-0.5">
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}
