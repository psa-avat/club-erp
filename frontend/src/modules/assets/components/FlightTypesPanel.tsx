/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - FlightTypesPanel: global flight type CRUD (standalone, used in Tarifs workspace)
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
import { AxiosError } from 'axios'
import { Check, Pencil, Plus, X } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useFlightTypesQuery,
  useCreateFlightTypeMutation,
  useUpdateFlightTypeMutation,
} from '../api'
import type { FlightType } from '../types'

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

type FtFormState = {
  code: string
  name: string
  description: string
  is_active: boolean
  launch_type: string
}

const EMPTY_FT: FtFormState = { code: '', name: '', description: '', is_active: true, launch_type: '' }

function ftToForm(ft: FlightType): FtFormState {
  return {
    code: ft.code,
    name: ft.name,
    description: ft.description ?? '',
    is_active: ft.is_active,
    launch_type: ft.launch_type != null ? String(ft.launch_type) : '',
  }
}

function FlightTypeForm({
  initial,
  isEdit,
  saving,
  onSave,
  onCancel,
  t,
}: {
  initial: FtFormState
  isEdit: boolean
  saving: boolean
  onSave: (f: FtFormState) => void
  onCancel: () => void
  t: (k: string, defaultValue?: string) => string
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
          <Label className="text-xs">{t('assetFamilies.flightTypes.code')} *</Label>
          <Input
            value={form.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            disabled={isEdit}
            placeholder="EX: SOLO"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('assetFamilies.flightTypes.name')} *</Label>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('assetFamilies.flightTypes.description')}</Label>
          <Input value={form.description} onChange={(e) => set('description', e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('assetFamilies.flightTypes.launchType', 'Launch type')}</Label>
          <Input
            value={form.launch_type}
            onChange={(e) => setForm((prev) => ({ ...prev, launch_type: e.target.value }))}
            placeholder="Ex: 0, 1, 10, 11…"
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
        {t('assetFamilies.active')}
      </label>
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

export function FlightTypesPanel() {
  const { t } = useTranslation('assets')
  const canManage = useCapability('MANAGE_ASSETS')

  const ftQuery = useFlightTypesQuery()
  const flightTypes = ftQuery.data ?? []

  const createMutation = useCreateFlightTypeMutation()
  const updateMutation = useUpdateFlightTypeMutation()

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
        launch_type: form.launch_type ? Number(form.launch_type) : null,
      })
      setShowForm(false)
      setFtError(null)
    } catch (e) {
      setFtError(extractError(e, t('assetFamilies.error.saveFailed')))
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
        launch_type: form.launch_type ? Number(form.launch_type) : null,
      })
      setEditingFt(null)
      setFtError(null)
    } catch (e) {
      setFtError(extractError(e, t('assetFamilies.error.saveFailed')))
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">{t('assetFamilies.flightTypes.title')}</p>
        {canManage && !showForm && !editingFt && (
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => { setShowForm(true); setFtError(null) }}
          >
            <Plus className="h-3 w-3" />
            {t('assetFamilies.flightTypes.add')}
          </button>
        )}
      </div>

      {ftError && <p className="mt-2 text-xs text-red-600">{ftError}</p>}

      {showForm && (
        <div className="mt-3">
          <FlightTypeForm
            initial={EMPTY_FT}
            isEdit={false}
            saving={createMutation.isPending}
            onSave={handleCreate}
            onCancel={() => { setShowForm(false); setFtError(null) }}
            t={t}
          />
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {ftQuery.isLoading ? (
          <p className="text-xs text-slate-400">{t('states.loading')}</p>
        ) : flightTypes.length === 0 && !showForm ? (
          <p className="rounded border border-dashed border-slate-200 py-2 text-center text-xs text-slate-400">
            {t('assetFamilies.flightTypes.none')}
          </p>
        ) : (
          flightTypes.map((ft) =>
            editingFt?.uuid === ft.uuid ? (
              <FlightTypeForm
                key={ft.uuid}
                initial={ftToForm(ft)}
                isEdit
                saving={updateMutation.isPending}
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
                        {t('assetFamilies.inactive')}
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
          )
        )}
      </div>
    </div>
  )
}
