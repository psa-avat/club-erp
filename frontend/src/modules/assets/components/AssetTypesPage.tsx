/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Asset types management: list, create and edit asset types
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
import { ArrowLeft, Check, Pencil, Plus, X } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAssetTypesQuery,
  useCreateAssetTypeMutation,
  useUpdateAssetTypeMutation,
} from '../api'
import type { AssetType, CreateAssetTypePayload } from '../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [1, 2, 3, 4, 5] as const
const STRATEGIES = [1, 2, 3, 4, 5, 6] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

// ── Type Form ─────────────────────────────────────────────────────────────────

type TypeFormState = {
  code: string
  name: string
  category: number
  pricing_strategy: number
  is_active: boolean
}

const EMPTY_FORM: TypeFormState = {
  code: '',
  name: '',
  category: 1,
  pricing_strategy: 1,
  is_active: true,
}

function typeToForm(t: AssetType): TypeFormState {
  return {
    code: t.code,
    name: t.name,
    category: t.category,
    pricing_strategy: t.pricing_strategy,
    is_active: t.is_active,
  }
}

function TypeForm({
  initial,
  isEdit,
  saving,
  error,
  onSave,
  onCancel,
  t,
}: {
  initial: TypeFormState
  isEdit: boolean
  saving: boolean
  error: string | null
  onSave: (f: TypeFormState) => void
  onCancel: () => void
  t: (k: string) => string
}) {
  const [form, setForm] = useState<TypeFormState>(initial)

  function set<K extends keyof TypeFormState>(key: K, value: TypeFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const valid = form.code.trim() !== '' && form.name.trim() !== ''

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {/* Code — readonly when editing */}
        <div className="space-y-1">
          <Label className="text-xs">{t('assetTypes.code')} *</Label>
          <Input
            value={form.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            disabled={isEdit}
            placeholder="EX: PLANEUR"
            className="h-8 text-sm font-mono"
          />
        </div>

        {/* Name */}
        <div className="space-y-1 sm:col-span-1 md:col-span-1">
          <Label className="text-xs">{t('assetTypes.name')} *</Label>
          <Input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Category */}
        <div className="space-y-1">
          <Label className="text-xs">{t('assetTypes.category')}</Label>
          <select
            value={form.category}
            onChange={(e) => set('category', Number(e.target.value))}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`assetTypes.category${c}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Pricing strategy */}
        <div className="space-y-1">
          <Label className="text-xs">{t('assetTypes.pricingStrategy')}</Label>
          <select
            value={form.pricing_strategy}
            onChange={(e) => set('pricing_strategy', Number(e.target.value))}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {t(`assetTypes.strategy${s}`)}
              </option>
            ))}
          </select>
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
        {t('assetTypes.active')}
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(form)} disabled={saving || !valid}>
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('assetTypes.saving') : t('assetTypes.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1 h-3 w-3" />
          {t('assetTypes.cancel')}
        </Button>
      </div>
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function TypeRow({
  assetType,
  canManage,
  onEdit,
  t,
}: {
  assetType: AssetType
  canManage: boolean
  onEdit: (at: AssetType) => void
  t: (k: string) => string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
            {assetType.code}
          </span>
          <span className="truncate text-sm font-medium text-slate-900">{assetType.name}</span>
          {!assetType.is_active && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {t('assetTypes.inactive')}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {t(`assetTypes.category${assetType.category}`)}
          {' · '}
          {t(`assetTypes.strategy${assetType.pricing_strategy}`)}
        </p>
      </div>
      {canManage && (
        <button
          type="button"
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          onClick={() => onEdit(assetType)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AssetTypesPage() {
  const { t } = useTranslation('assets')
  const navigate = useNavigate()
  const canManage = useCapability('MANAGE_ASSETS')
  const canView = useCapability('MANAGE_ASSETS') || useCapability('VIEW_FINANCIALS')

  const typesQuery = useAssetTypesQuery(canView)
  const createMutation = useCreateAssetTypeMutation()

  const [showForm, setShowForm] = useState(false)
  const [editingType, setEditingType] = useState<AssetType | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(false)

  const allTypes = typesQuery.data ?? []
  const types = activeOnly ? allTypes.filter((ty) => ty.is_active) : allTypes

  const updateMutation = useUpdateAssetTypeMutation(editingType?.uuid ?? '')

  async function handleCreate(form: TypeFormState) {
    const payload: CreateAssetTypePayload = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
      pricing_strategy: form.pricing_strategy,
      is_active: form.is_active,
    }
    try {
      await createMutation.mutateAsync(payload)
      setShowForm(false)
      setFormError(null)
    } catch (e) {
      setFormError(extractError(e, t('assetTypes.error.saveFailed')))
    }
  }

  async function handleUpdate(form: TypeFormState) {
    if (!editingType) return
    try {
      await updateMutation.mutateAsync({
        name: form.name.trim(),
        category: form.category,
        pricing_strategy: form.pricing_strategy,
        is_active: form.is_active,
      })
      setEditingType(null)
      setFormError(null)
    } catch (e) {
      setFormError(extractError(e, t('assetTypes.error.saveFailed')))
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
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate('/assets')}
              className="mb-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
            >
              <ArrowLeft className="h-3 w-3" />
              {t('assetTypes.backToAssets')}
            </button>
            <h1 className="text-xl font-semibold text-slate-900">{t('assetTypes.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('assetTypes.description')}</p>
          </div>
          {canManage && !showForm && !editingType && (
            <Button size="sm" onClick={() => { setShowForm(true); setFormError(null) }}>
              <Plus className="mr-1 h-4 w-4" />
              {t('assetTypes.addType')}
            </Button>
          )}
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <TypeForm
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

      {/* List */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {/* Filter bar */}
        <div className="mb-3 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            {t('assetTypes.activeOnly')}
          </label>
        </div>

        {typesQuery.isLoading ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('states.loading')}</p>
        ) : types.length === 0 ? (
          <p className="rounded border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
            {t('assetTypes.noTypes')}
          </p>
        ) : (
          <div className="space-y-2">
            {types.map((ty) =>
              editingType?.uuid === ty.uuid ? (
                <div key={ty.uuid} className="rounded-lg border border-slate-200 bg-white p-4">
                  <TypeForm
                    initial={typeToForm(ty)}
                    isEdit
                    saving={updateMutation.isPending}
                    error={formError}
                    onSave={handleUpdate}
                    onCancel={() => { setEditingType(null); setFormError(null) }}
                    t={t}
                  />
                </div>
              ) : (
                <TypeRow
                  key={ty.uuid}
                  assetType={ty}
                  canManage={canManage}
                  onEdit={(at) => { setEditingType(at); setFormError(null); setShowForm(false) }}
                  t={t}
                />
              ),
            )}
          </div>
        )}
      </div>
    </section>
  )
}
