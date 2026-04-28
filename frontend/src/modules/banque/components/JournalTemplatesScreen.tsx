/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Journal entry templates screen – template list and editor
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

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountingEntryModelsQuery,
  useAccountsQuery,
  useCreateAccountingEntryModelMutation,
  useDeleteAccountingEntryModelMutation,
  useJournalsQuery,
  useUpdateAccountingEntryModelMutation,
  type AccountingEntryModel,
} from '../api'
import {
  JournalPageShell,
  LineEditor,
  RECURRENCE_OPTIONS,
  buildModelLines,
  emptyLine,
  emptyModelForm,
  isBalanced,
  mapModelToForm,
  recurrenceLabel,
  toErrorMessage,
  type LineFormState,
  type ModelFormState,
} from './journalShared'

export function JournalTemplatesScreen() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')
  const canManageModels = useCapability('MANAGE_ACCOUNTING_SETTINGS')

  const journalsQuery = useJournalsQuery(canView)
  const accountsQuery = useAccountsQuery(canView)
  const modelsQuery = useAccountingEntryModelsQuery(canView)

  const journals = journalsQuery.data ?? []
  const accounts = accountsQuery.data?.filter((account) => account.is_posting_allowed) ?? []
  const models = modelsQuery.data ?? []

  const [modelForm, setModelForm] = useState<ModelFormState>(() => emptyModelForm())
  const [selectedModelUuid, setSelectedModelUuid] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const createModelMutation = useCreateAccountingEntryModelMutation()
  const updateModelMutation = useUpdateAccountingEntryModelMutation()
  const deleteModelMutation = useDeleteAccountingEntryModelMutation()

  useEffect(() => {
    if (createModelMutation.isSuccess || updateModelMutation.isSuccess) {
      setSuccessMessage(t('journal.models.saved'))
      const id = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(id)
    }
  }, [createModelMutation.isSuccess, updateModelMutation.isSuccess, t])

  useEffect(() => {
    if (journals.length > 0 && modelForm.journal_uuid === '') {
      setModelForm((prev) => ({ ...prev, journal_uuid: journals[0].uuid }))
    }
  }, [journals, modelForm.journal_uuid])

  function resetModelForm() {
    setSelectedModelUuid(null)
    setModelForm((prev) => ({ ...emptyModelForm(), journal_uuid: prev.journal_uuid }))
  }

  function selectModel(model: AccountingEntryModel) {
    setSelectedModelUuid(model.uuid)
    setModelForm(mapModelToForm(model))
    setLocalError(null)
  }

  function updateModelLine(index: number, patch: Partial<LineFormState>) {
    setModelForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  }

  const modelCanSave =
    modelForm.code.trim() !== '' &&
    modelForm.name.trim() !== '' &&
    modelForm.journal_uuid !== '' &&
    modelForm.lines.every((line) => line.account_uuid !== '') &&
    isBalanced(modelForm.lines)

  async function handleSaveModel() {
    setLocalError(null)
    const payload = {
      code: modelForm.code.trim(),
      name: modelForm.name.trim(),
      journal_uuid: modelForm.journal_uuid,
      description: modelForm.description.trim() || null,
      default_reference: modelForm.default_reference.trim() || null,
      recurrence_type: modelForm.recurrence_type,
      is_active: modelForm.is_active,
      lines: buildModelLines(modelForm.lines),
    }
    try {
      if (selectedModelUuid) {
        await updateModelMutation.mutateAsync({ templateUuid: selectedModelUuid, payload })
      } else {
        const created = await createModelMutation.mutateAsync(payload)
        setSelectedModelUuid(created.uuid)
      }
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function handleDeleteModel(templateUuid: string) {
    if (!window.confirm(t('journal.models.confirmDelete'))) return
    setLocalError(null)
    try {
      await deleteModelMutation.mutateAsync(templateUuid)
      if (selectedModelUuid === templateUuid) resetModelForm()
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
      </section>
    )
  }

  const anyError =
    localError ??
    (createModelMutation.error || updateModelMutation.error || deleteModelMutation.error
      ? toErrorMessage(
          createModelMutation.error ?? updateModelMutation.error ?? deleteModelMutation.error,
          t('journal.errors.generic'),
        )
      : null)

  return (
    <JournalPageShell canPost={canPost} canManageModels={canManageModels} t={t}>
      {anyError && <Alert>{anyError}</Alert>}
      {successMessage && <Alert className="border-green-200 bg-green-50 text-green-800">{successMessage}</Alert>}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        {/* Template editor */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {selectedModelUuid ? t('journal.models.editTitle') : t('journal.models.newTitle')}
            </h2>
            <Button type="button" variant="ghost" onClick={resetModelForm}>
              {t('journal.models.reset')}
            </Button>
          </div>

          {!canManageModels && (
            <p className="mt-3 text-sm text-slate-500">{t('journal.models.noPermission')}</p>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('journal.models.code')}</Label>
              <Input
                value={modelForm.code}
                onChange={(event) => setModelForm((prev) => ({ ...prev, code: event.target.value }))}
                disabled={!canManageModels}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('journal.models.name')}</Label>
              <Input
                value={modelForm.name}
                onChange={(event) => setModelForm((prev) => ({ ...prev, name: event.target.value }))}
                disabled={!canManageModels}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('journal.entries.journal')}</Label>
              <select
                value={modelForm.journal_uuid}
                onChange={(event) => setModelForm((prev) => ({ ...prev, journal_uuid: event.target.value }))}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                disabled={!canManageModels}
              >
                <option value="">{t('journal.entries.selectJournal')}</option>
                {journals.map((journal) => (
                  <option key={journal.uuid} value={journal.uuid}>{journal.code} · {journal.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('journal.models.recurrence.label')}</Label>
              <select
                value={modelForm.recurrence_type}
                onChange={(event) => setModelForm((prev) => ({ ...prev, recurrence_type: Number(event.target.value) }))}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                disabled={!canManageModels}
              >
                {RECURRENCE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{recurrenceLabel(value, t)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('journal.models.defaultReference')}</Label>
              <Input
                value={modelForm.default_reference}
                onChange={(event) => setModelForm((prev) => ({ ...prev, default_reference: event.target.value }))}
                disabled={!canManageModels}
              />
            </div>
            <label className="mt-7 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={modelForm.is_active}
                onChange={(event) => setModelForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                disabled={!canManageModels}
              />
              {t('journal.models.active')}
            </label>
          </div>

          <div className="mt-3 space-y-1">
            <Label>{t('journal.models.descriptionLabel')}</Label>
            <Input
              value={modelForm.description}
              onChange={(event) => setModelForm((prev) => ({ ...prev, description: event.target.value }))}
              disabled={!canManageModels}
            />
          </div>

          <div className="mt-4">
            <LineEditor
              title={t('journal.models.linesTitle')}
              lines={modelForm.lines}
              accounts={accounts}
              onChange={updateModelLine}
              onAdd={() => setModelForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}
              onRemove={(index) =>
                setModelForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
              }
              t={t}
            />
          </div>

          {canManageModels && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!modelCanSave || createModelMutation.isPending || updateModelMutation.isPending}
                onClick={() => void handleSaveModel()}
              >
                {createModelMutation.isPending || updateModelMutation.isPending
                  ? t('journal.models.saving')
                  : selectedModelUuid ? t('journal.models.saveChanges') : t('journal.models.saveModel')}
              </Button>
              {selectedModelUuid && (
                <Button
                  type="button" variant="destructive"
                  onClick={() => void handleDeleteModel(selectedModelUuid)}
                >
                  {t('journal.models.deleteModel')}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Template list */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{t('journal.models.listTitle')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('journal.models.listDescription')}</p>
          <div className="mt-4 space-y-3">
            {modelsQuery.isLoading ? (
              <p className="text-sm text-slate-500">{t('settings.loading')}</p>
            ) : models.length === 0 ? (
              <p className="text-sm text-slate-500">{t('journal.models.empty')}</p>
            ) : (
              models.map((model) => (
                <div key={model.uuid} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{model.code} · {model.name}</p>
                      <p className="text-xs text-slate-500">
                        {recurrenceLabel(model.recurrence_type, t)} ·{' '}
                        {model.is_active ? t('journal.models.statusActive') : t('journal.models.statusInactive')}
                      </p>
                    </div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => selectModel(model)}>
                      {t('journal.models.editAction')}
                    </Button>
                  </div>
                  {model.description && <p className="mt-2 text-sm text-slate-600">{model.description}</p>}
                  <div className="mt-3 text-xs text-slate-500">
                    {model.lines.length} {t('journal.entries.linesCount')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </JournalPageShell>
  )
}
