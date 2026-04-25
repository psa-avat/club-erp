/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Asset types management: list, create and edit asset types with flight types
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
import { ArrowLeft, Check, ChevronDown, ChevronRight, Pencil, Plus, X } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAssetTypesQuery,
  useCreateAssetTypeMutation,
  useUpdateAssetTypeMutation,
  useFlightTypesQuery,
  useCreateFlightTypeMutation,
  useUpdateFlightTypeMutation,
} from '../api'
import type { AssetType, CreateAssetTypePayload, FlightType } from '../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [1, 2, 3, 4, 5] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

// ── Asset Type Form ───────────────────────────────────────────────────────────

type TypeFormState = {
  code: string
  name: string
  category: number
  is_active: boolean
}

const EMPTY_FORM: TypeFormState = {
  code: '',
  name: '',
  category: 1,
  is_active: true,
}

function typeToForm(at: AssetType): TypeFormState {
  return {
    code: at.code,
    name: at.name,
    category: at.category,
    is_active: at.is_active,
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
      <div className="grid gap-3 sm:grid-cols-3">
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
        <div className="space-y-1">
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

// ── Flight Type Form ──────────────────────────────────────────────────────────

type FtFormState = {
  code: string
  name: string
  description: string
  is_active: boolean
}

const EMPTY_FT: FtFormState = { code: '', name: '', description: '', is_active: true }

function ftToForm(ft: FlightType): FtFormState {
  return { code: ft.code, name: ft.name, description: ft.description ?? '', is_active: ft.is_active }
}

function FlightTypeForm({
  initial,
  isEdit,
  saving,
  error,
  onSave,
  onCancel,
  t,
}: {
  initial: FtFormState
  isEdit: boolean
  saving: boolean
  error: string | null
  onSave: (f: FtFormState) => void
  onCancel: () => void
  t: (k: string) => string
}) {
  const [form, setForm] = useState<FtFormState>(initial)
  function set<K extends keyof FtFormState>(key: K, value: FtFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }
  const valid = form.code.trim() !== '' && form.name.trim() !== ''
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('assetTypes.flightTypes.code')} *</Label>
          <Input
            value={form.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            disabled={isEdit}
            placeholder="EX: SOLO"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('assetTypes.flightTypes.name')} *</Label>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('assetTypes.flightTypes.description')}</Label>
          <Input value={form.description} onChange={(e) => set('description', e.target.value)} className="h-8 text-sm" />
        </div>
      </div>
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

// ── Flight Types Panel ────────────────────────────────────────────────────────

function FlightTypesPanel({
  assetType,
  canManage,
  t,
}: {
  assetType: AssetType
  canManage: boolean
  t: (k: string) => string
}) {
  const ftQuery = useFlightTypesQuery(assetType.uuid)
  const flightTypes = ftQuery.data ?? []

  const createMutation = useCreateFlightTypeMutation(assetType.uuid)
  const updateMutation = useUpdateFlightTypeMutation(assetType.uuid)

  const [showForm, setShowForm] = useState(false)
  const [editingFt, setEditingFt] = useState<FlightType | null>(null)
  const [ftError, setFtError] = useState<string | null>(null)

  async function handleCreate(form: FtFormState) {
    try {
      await createMutation.mutateAsync({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        is_active: form.is_active,
      })
      setShowForm(false)
      setFtError(null)
    } catch (e) {
      setFtError(extractError(e, t('assetTypes.error.saveFailed')))
    }
  }

  async function handleUpdate(form: FtFormState) {
    if (!editingFt) return
    try {
      await updateMutation.mutateAsync({
        uuid: editingFt.uuid,
        name: form.name.trim(),
        description: form.description.trim() || null,
        is_active: form.is_active,
      })
      setEditingFt(null)
      setFtError(null)
    } catch (e) {
      setFtError(extractError(e, t('assetTypes.error.saveFailed')))
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">{t('assetTypes.flightTypes.title')}</p>
        {canManage && !showForm && !editingFt && (
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => { setShowForm(true); setFtError(null) }}
          >
            <Plus className="h-3 w-3" />
            {t('assetTypes.flightTypes.add')}
          </button>
        )}
      </div>

      {ftError && <p className="text-xs text-red-600">{ftError}</p>}

      {showForm && (
        <FlightTypeForm
          initial={EMPTY_FT}
          isEdit={false}
          saving={createMutation.isPending}
          error={null}
          onSave={handleCreate}
          onCancel={() => { setShowForm(false); setFtError(null) }}
          t={t}
        />
      )}

      {ftQuery.isLoading ? (
        <p className="text-xs text-slate-400">{t('states.loading')}</p>
      ) : flightTypes.length === 0 && !showForm ? (
        <p className="rounded border border-dashed border-slate-200 py-2 text-center text-xs text-slate-400">
          {t('assetTypes.flightTypes.none')}
        </p>
      ) : (
        <div className="space-y-1.5">
          {flightTypes.map((ft) =>
            editingFt?.uuid === ft.uuid ? (
              <FlightTypeForm
                key={ft.uuid}
                initial={ftToForm(ft)}
                isEdit
                saving={updateMutation.isPending}
                error={null}
                onSave={handleUpdate}
                onCancel={() => { setEditingFt(null); setFtError(null) }}
                t={t}
              />
            ) : (
              <div key={ft.uuid} className="flex items-center gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-700">{ft.code}</span>
                    <span className="text-sm font-medium text-slate-800">{ft.name}</span>
                    {!ft.is_active && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        {t('assetTypes.inactive')}
                      </span>
                    )}
                  </div>
                  {ft.description && <p className="mt-0.5 text-xs text-slate-500">{ft.description}</p>}
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                    onClick={() => { setEditingFt(ft); setFtError(null) }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// ── Asset Type Row ────────────────────────────────────────────────────────────

function TypeRow({
  assetType,
  canManage,
  expanded,
  onToggle,
  onEdit,
  t,
}: {
  assetType: AssetType
  canManage: boolean
  expanded: boolean
  onToggle: () => void
  onEdit: (at: AssetType) => void
  t: (k: string) => string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex cursor-pointer items-center gap-3 px-4 py-3" onClick={onToggle}>
        <span className="shrink-0 text-slate-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
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
          <p className="mt-0.5 text-xs text-slate-500">{t(`assetTypes.category${assetType.category}`)}</p>
        </div>
        {canManage && (
          <button
            type="button"
            className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={(e) => { e.stopPropagation(); onEdit(assetType) }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-4 pb-4">
          <FlightTypesPanel assetType={assetType} canManage={canManage} t={t} />
        </div>
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
  const [expandedTypeUuid, setExpandedTypeUuid] = useState<string | null>(null)

  const allTypes = typesQuery.data ?? []
  const types = activeOnly ? allTypes.filter((ty) => ty.is_active) : allTypes

  const updateMutation = useUpdateAssetTypeMutation(editingType?.uuid ?? '')

  async function handleCreate(form: TypeFormState) {
    const payload: CreateAssetTypePayload = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
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
        is_active: form.is_active,
      })
      setEditingType(null)
      setFormError(null)
    } catch (e) {
      setFormError(extractError(e, t('assetTypes.error.saveFailed')))
    }
  }

  function toggleExpanded(uuid: string) {
    setExpandedTypeUuid((prev) => (prev === uuid ? null : uuid))
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
                  expanded={expandedTypeUuid === ty.uuid}
                  onToggle={() => toggleExpanded(ty.uuid)}
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

