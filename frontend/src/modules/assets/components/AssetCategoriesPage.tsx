/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Asset categories management: list, create and edit categories, configure their 4 GL accounts
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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AxiosError } from 'axios'
import { Check, Pencil, Plus, Settings2, X } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useAccountsQuery } from '../../banque/api'
import {
  useAssetCategoriesQuery,
  useCreateAssetCategoryMutation,
  useUpdateAssetCategoryMutation,
} from '../api'
import type { AssetCategory, AssetCategoryAccountingPatch, CreateAssetCategoryPayload } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

function accountOptions(accounts: ReturnType<typeof useAccountsQuery>['data'], prefix: string) {
  return (accounts ?? [])
    .filter((a) => a.is_posting_allowed && a.code.startsWith(prefix))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))
}

// ── Accounting dialog (4 GL accounts) ─────────────────────────────────────────

type AccountingState = {
  acquisition_account_uuid: string | null
  depreciation_account_uuid: string | null
  charge_account_uuid: string | null
  revenue_account_uuid: string | null
}

function fromCategory(cat: AssetCategory): AccountingState {
  return {
    acquisition_account_uuid: cat.acquisition_account_uuid,
    depreciation_account_uuid: cat.depreciation_account_uuid,
    charge_account_uuid: cat.charge_account_uuid,
    revenue_account_uuid: cat.revenue_account_uuid,
  }
}

function CategoryAccountingDialog({
  category,
  open,
  onOpenChange,
  t,
}: {
  category: AssetCategory
  open: boolean
  onOpenChange: (open: boolean) => void
  t: (k: string) => string
}) {
  const updateMutation = useUpdateAssetCategoryMutation()
  const accountsQuery = useAccountsQuery()

  const [state, setState] = useState<AccountingState>(() => fromCategory(category))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      setState(fromCategory(category))
      setSaved(false)
    }
  }, [open, category])

  const acquisitionOpts = accountOptions(accountsQuery.data, '2')
  const depreciationOpts = accountOptions(accountsQuery.data, '28')
  const chargeOpts = accountOptions(accountsQuery.data, '6')
  const revenueOpts = accountOptions(accountsQuery.data, '7')

  function set<K extends keyof AccountingState>(key: K, value: AccountingState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    const patch: AssetCategoryAccountingPatch = {
      acquisition_account_uuid: state.acquisition_account_uuid,
      depreciation_account_uuid: state.depreciation_account_uuid,
      charge_account_uuid: state.charge_account_uuid,
      revenue_account_uuid: state.revenue_account_uuid,
    }
    await updateMutation.mutateAsync({ uuid: category.uuid, ...patch })
    setSaved(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            {t('assetCategories.accountsDialogTitle')} — {category.name}
            <span className="font-mono text-xs text-muted-foreground">({category.code})</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                {t('assetCategories.acquisitionAccount')}
                {category.acquisition_account_code && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{category.acquisition_account_code}</span>
                )}
              </Label>
              <SearchableSelect
                options={acquisitionOpts}
                value={state.acquisition_account_uuid ?? undefined}
                onChange={(val) => set('acquisition_account_uuid', val ?? null)}
                placeholder="Ex: 218xxx"
              />
              <p className="text-xs text-muted-foreground">{t('assetCategories.acquisitionAccountHelp')}</p>
            </div>
            <div className="space-y-2">
              <Label>
                {t('assetCategories.depreciationAccount')}
                {category.depreciation_account_code && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{category.depreciation_account_code}</span>
                )}
              </Label>
              <SearchableSelect
                options={depreciationOpts}
                value={state.depreciation_account_uuid ?? undefined}
                onChange={(val) => set('depreciation_account_uuid', val ?? null)}
                placeholder="Ex: 281xxx"
              />
              <p className="text-xs text-muted-foreground">{t('assetCategories.depreciationAccountHelp')}</p>
            </div>
            <div className="space-y-2">
              <Label>
                {t('assetCategories.chargeAccount')}
                {category.charge_account_code && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{category.charge_account_code}</span>
                )}
              </Label>
              <SearchableSelect
                options={chargeOpts}
                value={state.charge_account_uuid ?? undefined}
                onChange={(val) => set('charge_account_uuid', val ?? null)}
                placeholder="Ex: 615xxx"
              />
              <p className="text-xs text-muted-foreground">{t('assetCategories.chargeAccountHelp')}</p>
            </div>
            <div className="space-y-2">
              <Label>
                {t('assetCategories.revenueAccount')}
                {category.revenue_account_code && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{category.revenue_account_code}</span>
                )}
              </Label>
              <SearchableSelect
                options={revenueOpts}
                value={state.revenue_account_uuid ?? undefined}
                onChange={(val) => set('revenue_account_uuid', val ?? null)}
                placeholder="Ex: 7xxxxx"
              />
              <p className="text-xs text-muted-foreground">{t('assetCategories.revenueAccountHelp')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-outline-variant pt-4">
            <Button onClick={() => { void handleSave() }} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('assetCategories.saving') : t('assetCategories.save')}
            </Button>
            {saved && !updateMutation.isPending && (
              <span className="text-sm text-green-600">{t('assetCategories.saved')}</span>
            )}
            {updateMutation.isError && (
              <span className="text-sm text-destructive">{extractError(updateMutation.error, t('assetCategories.error.saveFailed'))}</span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Category Form (code / name / description / active) ────────────────────────

type CategoryFormState = {
  code: string
  name: string
  description: string
  is_active: boolean
}

const EMPTY_FORM: CategoryFormState = {
  code: '',
  name: '',
  description: '',
  is_active: true,
}

function categoryToForm(cat: AssetCategory): CategoryFormState {
  return {
    code: cat.code,
    name: cat.name,
    description: cat.description ?? '',
    is_active: cat.is_active,
  }
}

function CategoryForm({
  initial,
  isEdit,
  saving,
  error,
  onSave,
  onCancel,
  t,
}: {
  initial: CategoryFormState
  isEdit: boolean
  saving: boolean
  error: string | null
  onSave: (f: CategoryFormState) => void
  onCancel: () => void
  t: (k: string) => string
}) {
  const [form, setForm] = useState<CategoryFormState>(initial)

  function set<K extends keyof CategoryFormState>(key: K, value: CategoryFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const valid = form.code.trim() !== '' && form.name.trim() !== ''

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('assetCategories.code')} *</Label>
          <Input
            value={form.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            disabled={isEdit}
            placeholder="EX: AIRCRAFT"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('assetCategories.name')} *</Label>
          <Input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('assetCategories.description')}</Label>
          <Input
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => set('is_active', e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        {t('assetCategories.active')}
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(form)} disabled={saving || !valid}>
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('assetCategories.saving') : t('assetCategories.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1 h-3 w-3" />
          {t('assetCategories.cancel')}
        </Button>
      </div>
    </div>
  )
}

// ── Category Row ──────────────────────────────────────────────────────────────

function CategoryRow({
  category,
  canManage,
  onEdit,
  onConfigureAccounts,
  t,
}: {
  category: AssetCategory
  canManage: boolean
  onEdit: (cat: AssetCategory) => void
  onConfigureAccounts: (cat: AssetCategory) => void
  t: (k: string) => string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              {category.code}
            </span>
            <span className="truncate text-sm font-medium text-slate-900">{category.name}</span>
            {!category.is_active && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {t('assetCategories.inactive')}
              </span>
            )}
          </div>
          {category.description && (
            <p className="mt-0.5 text-xs text-slate-500">{category.description}</p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => onConfigureAccounts(category)}>
              <Settings2 className="mr-1 h-3.5 w-3.5" />
              {t('assetCategories.accounts')}
            </Button>
            <button
              type="button"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={(e) => { e.stopPropagation(); onEdit(category) }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AssetCategoriesPage() {
  const { t } = useTranslation('assets')
  const canManage = useCapability('MANAGE_ASSETS')
  const canView = useCapability('MANAGE_ASSETS') || useCapability('VIEW_FINANCIALS')

  const categoriesQuery = useAssetCategoriesQuery(canView)
  const createMutation = useCreateAssetCategoryMutation()

  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState<AssetCategory | null>(null)
  const [accountsDialogCategory, setAccountsDialogCategory] = useState<AssetCategory | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(false)
  const allCategories = categoriesQuery.data ?? []
  const categories = activeOnly ? allCategories.filter((c) => c.is_active) : allCategories

  const updateMutation = useUpdateAssetCategoryMutation()

  async function handleCreate(form: CategoryFormState) {
    const payload: CreateAssetCategoryPayload = {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      is_active: form.is_active,
    }
    try {
      await createMutation.mutateAsync(payload)
      setShowForm(false)
      setFormError(null)
    } catch (e) {
      setFormError(extractError(e, t('assetCategories.error.saveFailed')))
    }
  }

  async function handleUpdate(form: CategoryFormState) {
    if (!editingCategory) return
    try {
      await updateMutation.mutateAsync({
        uuid: editingCategory.uuid,
        name: form.name.trim(),
        description: form.description.trim() || null,
        is_active: form.is_active,
      })
      setEditingCategory(null)
      setFormError(null)
    } catch (e) {
      setFormError(extractError(e, t('assetCategories.error.saveFailed')))
    }
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {canManage && !showForm && !editingCategory && (
          <Button size="sm" onClick={() => { setShowForm(true); setFormError(null) }}>
            <Plus className="mr-1 h-4 w-4" />
            {t('assetCategories.addCategory')}
          </Button>
        )}
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <CategoryForm
            initial={EMPTY_FORM}
            isEdit={false}
            saving={createMutation.isPending}
            error={formError}
            onSave={handleCreate}
            onCancel={() => { setShowForm(false); setFormError(null) }}
            t={t}
          />
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            {t('assetCategories.activeOnly')}
          </label>
        </div>

        {categoriesQuery.isLoading ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('states.loading')}</p>
        ) : categories.length === 0 ? (
          <p className="rounded border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
            {t('assetCategories.noCategories')}
          </p>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) =>
              editingCategory?.uuid === cat.uuid ? (
                <div key={cat.uuid} className="rounded-lg border border-slate-200 bg-white p-4">
                  <CategoryForm
                    initial={categoryToForm(cat)}
                    isEdit
                    saving={updateMutation.isPending}
                    error={formError}
                    onSave={handleUpdate}
                    onCancel={() => { setEditingCategory(null); setFormError(null) }}
                    t={t}
                  />
                </div>
              ) : (
                <CategoryRow
                  key={cat.uuid}
                  category={cat}
                  canManage={canManage}
                  onEdit={(cat) => { setEditingCategory(cat); setFormError(null); setShowForm(false) }}
                  onConfigureAccounts={(cat) => setAccountsDialogCategory(cat)}
                  t={t}
                />
              ),
            )}
          </div>
        )}
      </div>

      {accountsDialogCategory && (
        <CategoryAccountingDialog
          category={accountsDialogCategory}
          open={accountsDialogCategory !== null}
          onOpenChange={(open) => { if (!open) setAccountsDialogCategory(null) }}
          t={t}
        />
      )}
    </section>
  )
}
