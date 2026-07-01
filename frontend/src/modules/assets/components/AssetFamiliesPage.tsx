/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Asset families management: list, create and edit asset families with flight types
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
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AxiosError } from 'axios'
import { ArrowLeft, Check, Pencil, Plus, Trash2, X } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAssetCategoriesQuery,
  useAssetFamiliesQuery,
  useCreateAssetFamilyMutation,
  useDeleteAssetFamilyMutation,
  useUpdateAssetFamilyMutation,
} from '../api'
import type { AssetCategory, AssetFamily, CreateAssetFamilyPayload } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

// ── Asset Family Form ─────────────────────────────────────────────────────────

type FamilyFormState = {
  code: string
  name: string
  category_uuid: string
  is_active: boolean
}

const EMPTY_FORM: FamilyFormState = {
  code: '',
  name: '',
  category_uuid: '',
  is_active: true,
}

function familyToForm(af: AssetFamily): FamilyFormState {
  return {
    code: af.code,
    name: af.name,
    category_uuid: af.category_uuid,
    is_active: af.is_active,
  }
}

function FamilyForm({
  initial,
  isEdit,
  categories,
  saving,
  error,
  onSave,
  onCancel,
  t,
}: {
  initial: FamilyFormState
  isEdit: boolean
  categories: AssetCategory[]
  saving: boolean
  error: string | null
  onSave: (f: FamilyFormState) => void
  onCancel: () => void
  t: (k: string) => string
}) {
  const [form, setForm] = useState<FamilyFormState>(initial)

  function set<K extends keyof FamilyFormState>(key: K, value: FamilyFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const valid = form.code.trim() !== '' && form.name.trim() !== '' && form.category_uuid !== ''

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Code — readonly when editing */}
        <div className="space-y-1">
          <Label className="text-xs">{t('assetFamilies.code')} *</Label>
          <Input
            value={form.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            disabled={isEdit}
            placeholder="EX: PLANEUR"
            className="h-8 text-sm font-mono"
          />
        </div>

        {/* Name */}
        <div className="space-y-1">
          <Label className="text-xs">{t('assetFamilies.name')} *</Label>
          <Input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Category */}
        <div className="space-y-1">
          <Label className="text-xs">{t('assetFamilies.category')} *</Label>
          <SearchableSelect
            options={categories.map((c) => ({ value: c.uuid, label: c.name }))}
            value={form.category_uuid || undefined}
            onChange={(val) => set('category_uuid', val ?? '')}
            placeholder={t('assetFamilies.categoryPlaceholder')}
          />
        </div>
      </div>

      {/* Active toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => set('is_active', e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        {t('assetFamilies.active')}
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(form)} disabled={saving || !valid}>
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('assetFamilies.saving') : t('assetFamilies.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1 h-3 w-3" />
          {t('assetFamilies.cancel')}
        </Button>
      </div>
    </div>
  )
}

// ── Asset Family Row ──────────────────────────────────────────────────────────

function FamilyRow({
  assetFamily,
  canManage,
  onEdit,
  onDelete,
  t,
}: {
  assetFamily: AssetFamily
  canManage: boolean
  onEdit: (af: AssetFamily) => void
  onDelete: (af: AssetFamily) => void
  t: (k: string) => string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              {assetFamily.code}
            </span>
            <span className="truncate text-sm font-medium text-slate-900">{assetFamily.name}</span>
            {!assetFamily.is_active && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {t('assetFamilies.inactive')}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{assetFamily.category?.name ?? '—'}</p>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={(e) => { e.stopPropagation(); onEdit(assetFamily) }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(assetFamily) }}
              aria-label={t('assetFamilies.delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AssetFamiliesPage() {
  const { t } = useTranslation('assets')
  const navigate = useNavigate()
  const canManage = useCapability('MANAGE_ASSETS')
  const canView = useCapability('MANAGE_ASSETS') || useCapability('VIEW_FINANCIALS')

  const familiesQuery = useAssetFamiliesQuery(canView)
  const categoriesQuery = useAssetCategoriesQuery(canView)
  const createMutation = useCreateAssetFamilyMutation()

  const [showForm, setShowForm] = useState(false)
  const [editingFamily, setEditingFamily] = useState<AssetFamily | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AssetFamily | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const allFamilies = familiesQuery.data ?? []
  const families = allFamilies
    .filter((af) => (activeOnly ? af.is_active : true))
    .filter((af) => (categoryFilter ? af.category_uuid === categoryFilter : true))
  const categories = categoriesQuery.data ?? []

  const groupedFamilies = categories
    .map((cat) => ({
      category: cat,
      items: families.filter((af) => af.category_uuid === cat.uuid),
    }))
    .filter((group) => group.items.length > 0)

  const updateMutation = useUpdateAssetFamilyMutation(editingFamily?.uuid ?? '')
  const deleteMutation = useDeleteAssetFamilyMutation()

  async function handleCreate(form: FamilyFormState) {
    const payload: CreateAssetFamilyPayload = {
      code: form.code.trim(),
      name: form.name.trim(),
      category_uuid: form.category_uuid,
      is_active: form.is_active,
    }
    try {
      await createMutation.mutateAsync(payload)
      setShowForm(false)
      setFormError(null)
    } catch (e) {
      setFormError(extractError(e, t('assetFamilies.error.saveFailed')))
    }
  }

  async function handleUpdate(form: FamilyFormState) {
    if (!editingFamily) return
    try {
      await updateMutation.mutateAsync({
        name: form.name.trim(),
        category_uuid: form.category_uuid,
        is_active: form.is_active,
      })
      setEditingFamily(null)
      setFormError(null)
    } catch (e) {
      setFormError(extractError(e, t('assetFamilies.error.saveFailed')))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.uuid)
      setDeleteTarget(null)
      setDeleteError(null)
    } catch (e) {
      const message =
        e instanceof AxiosError && e.response?.status === 409
          ? t('assetFamilies.error.deleteInUse')
          : extractError(e, t('assetFamilies.error.deleteFailed'))
      setDeleteError(message)
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
      {/* Header */}
      {/* Actions toolbar */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate('/assets')}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3 w-3" />
          {t('assetFamilies.backToAssets')}
        </button>
        {canManage && !showForm && !editingFamily && (
          <Button size="sm" onClick={() => { setShowForm(true); setFormError(null) }}>
            <Plus className="mr-1 h-4 w-4" />
            {t('assetFamilies.addFamily')}
          </Button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <FamilyForm
            initial={EMPTY_FORM}
            isEdit={false}
            categories={categories}
            saving={createMutation.isPending}
            error={formError}
            onSave={handleCreate}
            onCancel={() => { setShowForm(false); setFormError(null) }}
            t={t}
          />
        </div>
      )}

      {/* List */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {/* Filter bar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            {t('assetFamilies.activeOnly')}
          </label>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-slate-600">{t('filters.category')}</Label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="">{t('filters.allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat.uuid} value={cat.uuid}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {familiesQuery.isLoading ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('states.loading')}</p>
        ) : families.length === 0 ? (
          <p className="rounded border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
            {t('assetFamilies.noFamilies')}
          </p>
        ) : (
          <div className="space-y-4">
            {groupedFamilies.map(({ category, items }) => (
              <div key={category.uuid} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {category.name}
                </h3>
                {items.map((af) =>
                  editingFamily?.uuid === af.uuid ? (
                    <div key={af.uuid} className="rounded-lg border border-slate-200 bg-white p-4">
                      <FamilyForm
                        initial={familyToForm(af)}
                        isEdit
                        categories={categories}
                        saving={updateMutation.isPending}
                        error={formError}
                        onSave={handleUpdate}
                        onCancel={() => { setEditingFamily(null); setFormError(null) }}
                        t={t}
                      />
                    </div>
                  ) : (
                    <FamilyRow
                      key={af.uuid}
                      assetFamily={af}
                      canManage={canManage}
                      onEdit={(af) => { setEditingFamily(af); setFormError(null); setShowForm(false) }}
                      onDelete={(af) => { setDeleteTarget(af); setDeleteError(null) }}
                      t={t}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null) } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assetFamilies.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} ({deleteTarget?.code}) — {t('assetFamilies.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('assetFamilies.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleDelete() }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? t('assetFamilies.saving') : t('assetFamilies.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
