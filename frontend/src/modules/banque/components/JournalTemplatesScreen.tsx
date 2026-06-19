/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Journal entry templates screen – refonte UI avec KPI, Table, Dialog
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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Play,
  Eye,
  CalendarClock,
  Repeat,
  CheckCircle2,
  AlertTriangle,
  Pencil,
} from 'lucide-react'
import { toast } from 'sonner'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { Switch } from '../../../components/ui/switch'
import { Separator } from '../../../components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../../../components/ui/sheet'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useMembersQuery } from '../../members/api'
import { useAssetsQuery } from '../../assets/api'
import {
  useAccountingEntryModelsQuery,
  useAccountsQuery,
  useCreateAccountingEntryModelMutation,
  useDeleteAccountingEntryModelMutation,
  useJournalsQuery,
  useUpdateAccountingEntryModelMutation,
  usePreviewEntryGenerationMutation,
  useGenerateEntryMutation,
  useGenerateDueEntriesMutation,
  type AccountingEntryModel,
  type PreviewResponse,
} from '../api'
import {
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

function fmtEUR(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
}

export function JournalTemplatesScreen() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const canManageModels = useCapability('MANAGE_ACCOUNTING_SETTINGS')

  const journalsQuery = useJournalsQuery(canView)
  const accountsQuery = useAccountsQuery(canView)
  const modelsQuery = useAccountingEntryModelsQuery(canView)
  const membersQuery = useMembersQuery({ search: '' })
  const assetsQuery = useAssetsQuery({}, canView)

  const journals = journalsQuery.data ?? []
  const accounts = accountsQuery.data?.filter((account) => account.is_posting_allowed) ?? []
  const models = modelsQuery.data ?? []
  const members = membersQuery.data?.filter((m) => m.status === 1) ?? []
  const assets = assetsQuery.data ?? []

  const [modelForm, setModelForm] = useState<ModelFormState>(() => emptyModelForm())
  const [selectedModelUuid, setSelectedModelUuid] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  // Dialog state
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [previewingTemplate, setPreviewingTemplate] = useState<AccountingEntryModel | null>(null)
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null)
  const [generatingTemplate, setGeneratingTemplate] = useState<AccountingEntryModel | null>(null)
  const [generateDate, setGenerateDate] = useState<string>('')
  const [confirmDeleteUuid, setConfirmDeleteUuid] = useState<string | null>(null)

  const createModelMutation = useCreateAccountingEntryModelMutation()
  const updateModelMutation = useUpdateAccountingEntryModelMutation()
  const deleteModelMutation = useDeleteAccountingEntryModelMutation()
  const previewMutation = usePreviewEntryGenerationMutation()
  const generateMutation = useGenerateEntryMutation()
  const generateDueMutation = useGenerateDueEntriesMutation()

  // KPI calculations
  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const due = models.filter(
      (m) => m.is_active && m.next_scheduled_date && m.next_scheduled_date <= today,
    ).length
    return {
      total: models.length,
      active: models.filter((m) => m.is_active).length,
      due,
    }
  }, [models])

  // Set default journal when loaded
  useEffect(() => {
    if (journals.length > 0 && modelForm.journal_uuid === '') {
      setModelForm((prev) => ({ ...prev, journal_uuid: journals[0].uuid }))
    }
  }, [journals, modelForm.journal_uuid])

  // ── Dialog handlers ────────────────────────────────────────────────────────

  function openNewTemplate() {
    setSelectedModelUuid(null)
    setModelForm((prev) => ({ ...emptyModelForm(), journal_uuid: prev.journal_uuid }))
    setIsEditorOpen(true)
  }

  function openEditTemplate(model: AccountingEntryModel) {
    setSelectedModelUuid(model.uuid)
    setModelForm(mapModelToForm(model))
    setLocalError(null)
    setIsEditorOpen(true)
  }

  function closeEditor() {
    setIsEditorOpen(false)
  }

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
      valid_from: modelForm.valid_from || null,
      valid_until: modelForm.valid_until || null,
      lines: buildModelLines(modelForm.lines),
    }
    try {
      if (selectedModelUuid) {
        await updateModelMutation.mutateAsync({ templateUuid: selectedModelUuid, payload })
        toast.success(t('journal.models.saved'))
      } else {
        const created = await createModelMutation.mutateAsync(payload)
        setSelectedModelUuid(created.uuid)
        toast.success(t('journal.models.saved'))
      }
      closeEditor()
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function handleDeleteModel(templateUuid: string) {
    setLocalError(null)
    try {
      await deleteModelMutation.mutateAsync(templateUuid)
      if (selectedModelUuid === templateUuid) {
        setSelectedModelUuid(null)
        setModelForm((prev) => ({ ...emptyModelForm(), journal_uuid: prev.journal_uuid }))
      }
      toast.success(t('journal.models.deleted') || 'Modèle supprimé')
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function openPreview(model: AccountingEntryModel) {
    setPreviewingTemplate(model)
    setPreviewData(null)
    try {
      const targetDate = model.next_scheduled_date || new Date().toISOString().slice(0, 10)
      const result = await previewMutation.mutateAsync({
        templateUuid: model.uuid,
        targetDate,
      })
      setPreviewData(result)
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
      setPreviewingTemplate(null)
    }
  }

  function openGenerate(model: AccountingEntryModel) {
    setGeneratingTemplate(model)
    setGenerateDate(model.next_scheduled_date || new Date().toISOString().slice(0, 10))
  }

  async function handleGenerate() {
    if (!generatingTemplate) return
    try {
      const result = await generateMutation.mutateAsync({
        templateUuid: generatingTemplate.uuid,
        targetDate: generateDate,
      })
      if (result.was_already_generated) {
        toast.info(t('journal.models.recurring.result.alreadyExists', { reference: result.reference }))
      } else {
        toast.success(
          t('journal.models.recurring.result.success', {
            reference: result.reference,
            fiscalYear: result.fiscal_year_uuid.slice(0, 8),
          }),
        )
      }
      setGeneratingTemplate(null)
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function handleGenerateAll() {
    try {
      const result = await generateDueMutation.mutateAsync()
      const msg = `${result.generated.length} générée(s)`
      if (result.errors.length > 0) {
        toast.warning(`${msg}, ${result.errors.length} erreur(s)`)
      } else {
        toast.success(msg)
      }
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
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

  if (!canView) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">{t('journal.noPermission')}</p>
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
    <>
      <ConfirmDialog
        open={confirmDeleteUuid !== null}
        title={t('journal.models.confirmDeleteTitle')}
        body={t('journal.models.confirmDelete')}
        confirmLabel={t('journal.models.deleteModel')}
        variant="destructive"
        onConfirm={() => {
          if (confirmDeleteUuid) void handleDeleteModel(confirmDeleteUuid)
          setConfirmDeleteUuid(null)
        }}
        onCancel={() => setConfirmDeleteUuid(null)}
      />
      {anyError && <Alert>{anyError}</Alert>}

      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => void handleGenerateAll()}
            disabled={kpis.due === 0 || generateDueMutation.isPending}
          >
            <CalendarClock className="mr-2 h-4 w-4" />
            {t('journal.models.recurring.generateDue', { count: kpis.due })}
          </Button>
          {canManageModels && (
            <Button onClick={openNewTemplate}>
              <Plus className="mr-2 h-4 w-4" />
              {t('journal.models.recurring.newModel')}
            </Button>
          )}
        </div>

        {/* ── KPI Cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('journal.models.recurring.kpi.total')}
                </div>
                <div className="mt-1 text-2xl font-semibold">{kpis.total}</div>
              </div>
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                <Repeat className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('journal.models.recurring.kpi.active')}
                </div>
                <div className="mt-1 text-2xl font-semibold">{kpis.active}</div>
              </div>
              <div className="rounded-md bg-emerald-500/15 p-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('journal.models.recurring.kpi.due')}
                </div>
                <div className="mt-1 text-2xl font-semibold">{kpis.due}</div>
              </div>
              <div
                className={
                  'rounded-md p-2 ' +
                  (kpis.due > 0
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'bg-primary/10 text-primary')
                }
              >
                <CalendarClock className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Template Table ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('journal.models.listTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {modelsQuery.isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">{t('settings.loading')}</div>
            ) : models.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">{t('journal.models.empty')}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('journal.models.code')}</TableHead>
                    <TableHead>{t('journal.models.name')}</TableHead>
                    <TableHead>{t('journal.models.recurrence.label')}</TableHead>
                    <TableHead>{t('journal.models.recurring.nextScheduled')}</TableHead>
                    <TableHead>{t('journal.models.recurring.lastGenerated')}</TableHead>
                    <TableHead>{t('journal.entries.actions.state') || 'État'}</TableHead>
                    <TableHead className="text-right">{t('journal.forms.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model) => (
                    <TableRow key={model.uuid}>
                      <TableCell className="font-mono text-xs">{model.code}</TableCell>
                      <TableCell className="font-medium">{model.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {recurrenceLabel(model.recurrence_type, t)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{model.next_scheduled_date || '—'}</TableCell>
                      <TableCell className="text-xs">{model.last_generated_at?.slice(0, 10) || '—'}</TableCell>
                      <TableCell>
                        {model.is_active ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
                            {t('journal.models.statusActive')}
                          </Badge>
                        ) : (
                          <Badge variant="outline">{t('journal.models.statusInactive')}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void openPreview(model)}
                          >
                            <Eye className="mr-1 h-4 w-4" />
                            {t('journal.models.recurring.preview')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openGenerate(model)}
                          >
                            <Play className="mr-1 h-4 w-4" />
                            {t('journal.models.recurring.generateNow')}
                          </Button>
                          {canManageModels && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditTemplate(model)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Template Editor Sheet ────────────────────────────────────────── */}
      <Sheet open={isEditorOpen} onOpenChange={(open) => { if (!open) closeEditor() }}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 sm:max-w-[min(90vw,80rem)]"
          onInteractOutside={(e) => {
            // Prevent sheet close when interacting with a portaled SearchableSelect dropdown
            // (covers both pointer clicks on items and auto-focus of the search input)
            const originalEvent = (e as unknown as CustomEvent<{ originalEvent: Event }>).detail?.originalEvent
            const target = originalEvent?.target as HTMLElement | null
            if (target?.closest?.('[data-searchable-select-portal]')) {
              e.preventDefault()
            }
          }}
        >
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>
              {selectedModelUuid
                ? `${t('journal.models.editTitle')} — ${modelForm.code || ''}`
                : t('journal.models.recurring.newModel')}
            </SheetTitle>
            <SheetDescription>{t('journal.models.descriptionLabel')}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('journal.models.code')}</Label>
                  <Input
                    value={modelForm.code}
                    onChange={(e) => setModelForm((prev) => ({ ...prev, code: e.target.value }))}
                    disabled={!canManageModels}
                    placeholder="COTIS-MENSUELLE"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('journal.models.name')}</Label>
                  <Input
                    value={modelForm.name}
                    onChange={(e) => setModelForm((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={!canManageModels}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('journal.entries.journal')}</Label>
                  <Select
                    value={modelForm.journal_uuid}
                    onValueChange={(v) => setModelForm((prev) => ({ ...prev, journal_uuid: v }))}
                    disabled={!canManageModels}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('journal.entries.selectJournal')} />
                    </SelectTrigger>
                    <SelectContent>
                      {journals.map((j) => (
                        <SelectItem key={j.uuid} value={j.uuid}>{j.code} · {j.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('journal.models.recurrence.label')}</Label>
                  <Select
                    value={String(modelForm.recurrence_type)}
                    onValueChange={(v) => setModelForm((prev) => ({ ...prev, recurrence_type: Number(v) }))}
                    disabled={!canManageModels}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRENCE_OPTIONS.map((value) => (
                        <SelectItem key={value} value={String(value)}>{recurrenceLabel(value, t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('journal.models.recurring.validFrom')}</Label>
                  <Input
                    type="date"
                    value={modelForm.valid_from}
                    onChange={(e) => setModelForm((prev) => ({ ...prev, valid_from: e.target.value }))}
                    disabled={!canManageModels}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('journal.models.recurring.validUntil')}</Label>
                  <Input
                    type="date"
                    value={modelForm.valid_until}
                    onChange={(e) => setModelForm((prev) => ({ ...prev, valid_until: e.target.value }))}
                    disabled={!canManageModels}
                  />
                </div>
              </div>

              {/* Scheduling info (read-only) */}
              <div className="rounded-md border bg-muted/40 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('journal.models.recurring.nextScheduled')}</span>
                  <span className="font-mono">{modelForm.next_scheduled_date || '—'}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">{t('journal.models.recurring.lastGenerated')}</span>
                  <span className="font-mono">{modelForm.last_generated_at?.slice(0, 10) || '—'}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="model-active"
                  checked={modelForm.is_active}
                  onCheckedChange={(v) => setModelForm((prev) => ({ ...prev, is_active: v }))}
                  disabled={!canManageModels}
                />
                <Label htmlFor="model-active" className="text-sm">{t('journal.models.active')}</Label>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t('journal.models.linesTitle')}</h3>
                {canManageModels && (
                  <Button variant="outline" size="sm" onClick={() => setModelForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}>
                    <Plus className="mr-1 h-4 w-4" /> {t('journal.forms.addLine')}
                  </Button>
                )}
              </div>

              <LineEditor
                title=""
                lines={modelForm.lines}
                accounts={accounts}
                members={members}
                assets={assets}
                onChange={updateModelLine}
                onAdd={() => setModelForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}
                onRemove={(index) =>
                  setModelForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
                }
                disabled={!canManageModels}
                t={t}
              />

              {/* Totaux */}
              {modelForm.lines.length > 0 && (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
                  <span className="font-medium">{t('journal.forms.total')}</span>
                  <div className="flex items-center gap-4 font-mono">
                    <span>D {fmtEUR(Number(modelForm.lines.reduce((s, l) => s + (Number(l.amount) > 0 ? Number(l.amount) : 0), 0)))}</span>
                    <span>C {fmtEUR(Number(modelForm.lines.reduce((s, l) => s + (Number(l.amount) < 0 ? -Number(l.amount) : 0), 0)))}</span>
                    {isBalanced(modelForm.lines) || modelForm.lines.some((l) => l.formula_type === 'rounding_adjustment') ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Équilibré
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <AlertTriangle className="mr-1 h-3 w-3" /> Déséquilibré
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <SheetFooter className="border-t px-6 py-4">
            <Button variant="ghost" onClick={closeEditor}>
              {t('journal.models.cancel')}
            </Button>
            <Button
              onClick={() => void handleSaveModel()}
              disabled={!modelCanSave || !canManageModels || createModelMutation.isPending || updateModelMutation.isPending}
            >
              {createModelMutation.isPending || updateModelMutation.isPending
                ? t('journal.models.saving')
                : selectedModelUuid ? t('journal.models.saveChanges') : t('journal.models.saveModel')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Preview Dialog ──────────────────────────────────────────────── */}
      <Dialog open={previewingTemplate !== null} onOpenChange={(open) => { if (!open) setPreviewingTemplate(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('journal.models.recurring.preview')} — {previewData?.reference || ''}
            </DialogTitle>
            <DialogDescription>
              {previewData?.description || ''}
              {previewData && (
                <span className="block mt-1 text-xs">
                  Exercice : {previewData.fiscal_year_label}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {previewMutation.isPending ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('settings.loading')}
            </div>
          ) : previewData ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('journal.forms.account')}</TableHead>
                    <TableHead>{t('journal.forms.lineDescription')}</TableHead>
                    <TableHead className="text-right">{t('journal.entries.debit') || 'Débit'}</TableHead>
                    <TableHead className="text-right">{t('journal.entries.credit') || 'Crédit'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.lines.map((line, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">{line.account_code}</TableCell>
                      <TableCell className="text-xs">{line.description}</TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(line.debit) > 0 ? fmtEUR(Number(line.debit)) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(line.credit) > 0 ? fmtEUR(Number(line.credit)) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex gap-4 font-mono">
                  <span>D {fmtEUR(Number(previewData.total_debit))}</span>
                  <span>C {fmtEUR(Number(previewData.total_credit))}</span>
                </div>
                {previewData.is_balanced ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Équilibré
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertTriangle className="mr-1 h-3 w-3" /> Déséquilibré
                  </Badge>
                )}
              </div>

              {previewData.warnings.length > 0 && (
                <div className="space-y-1">
                  {previewData.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreviewingTemplate(null)}>
              {t('journal.models.close') || 'Fermer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Generate Dialog ─────────────────────────────────────────────── */}
      <Dialog open={generatingTemplate !== null} onOpenChange={(open) => { if (!open) setGeneratingTemplate(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('journal.models.recurring.generateNow')} — {generatingTemplate?.code || ''}
            </DialogTitle>
            <DialogDescription>
              {t('journal.models.recurring.generateDescription') ||
                "L'écriture sera créée en Draft et visible dans le journal."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('journal.models.recurring.targetDate') || 'Date cible'}</Label>
            <Input
              type="date"
              value={generateDate}
              onChange={(e) => setGenerateDate(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setGeneratingTemplate(null)}>
              {t('journal.models.cancel') || 'Annuler'}
            </Button>
            <Button
              onClick={() => void handleGenerate()}
              disabled={generateMutation.isPending}
            >
              <Play className="mr-1 h-4 w-4" />
              {generateMutation.isPending ? t('journal.models.saving') : t('journal.models.recurring.generateNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
