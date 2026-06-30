/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - rh: CalendarManagementPage — working time calendars and employee assignments
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

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

import {
  useHrCalendars,
  useCreateHrCalendar,
  useUpdateHrCalendar,
  useDeleteHrCalendar,
  useCreateHrPhase,
  useUpdateHrPhase,
  useDeleteHrPhase,
  useHrAssignments,
  useCreateHrAssignment,
  useUpdateHrAssignment,
  useDeleteHrAssignment,
  useHrProfiles,
} from '../api'
import type {
  HrCalendarPhase,
  HrCalendarPhaseInput,
  HrEmployeeCalendarAssignment,
  HrEmployeeProfile,
  HrPhaseDayRuleInput,
  HrWorkingTimeCalendar,
} from '../types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 7]
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtMD(month: number, day: number): string {
  return `${pad2(month)}/${pad2(day)}`
}

// ---------------------------------------------------------------------------
// Phase editor — schedule grid (7 rows × columns)
// ---------------------------------------------------------------------------

interface PhaseFormState {
  name: string
  start_month: string
  start_day: string
  end_month: string
  end_day: string
  day_rules: HrPhaseDayRuleInput[]
}

function defaultDayRules(): HrPhaseDayRuleInput[] {
  return DAYS_OF_WEEK.map((dow) => ({
    day_of_week: dow,
    is_working: dow <= 5,
    expected_hours: dow <= 5 ? '7.00' : '0',
    start_time: null,
    end_time: null,
    apply_on_week: 0,
  }))
}

function phaseToForm(phase: HrCalendarPhase): PhaseFormState {
  const rulesMap = new Map<number, HrPhaseDayRuleInput>()
  for (const r of phase.day_rules) {
    if (r.apply_on_week === 0) rulesMap.set(r.day_of_week, r)
  }
  return {
    name: phase.name,
    start_month: String(phase.start_month),
    start_day: String(phase.start_day),
    end_month: String(phase.end_month),
    end_day: String(phase.end_day),
    day_rules: DAYS_OF_WEEK.map((dow) =>
      rulesMap.get(dow) ?? {
        day_of_week: dow,
        is_working: false,
        expected_hours: '0',
        start_time: null,
        end_time: null,
        apply_on_week: 0,
      }
    ),
  }
}

function formToPhaseInput(form: PhaseFormState): HrCalendarPhaseInput {
  return {
    name: form.name,
    start_month: parseInt(form.start_month),
    start_day: parseInt(form.start_day),
    end_month: parseInt(form.end_month),
    end_day: parseInt(form.end_day),
    day_rules: form.day_rules,
  }
}

// ---------------------------------------------------------------------------
// Phase editor sheet
// ---------------------------------------------------------------------------

interface PhaseSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  calendarUuid: string
  phase: HrCalendarPhase | null
  onSaved: () => void
}

function PhaseSheet({ open, onOpenChange, calendarUuid, phase, onSaved }: PhaseSheetProps) {
  const { t } = useTranslation('rh')
  const createPhase = useCreateHrPhase()
  const updatePhase = useUpdateHrPhase()

  const [form, setForm] = useState<PhaseFormState>({
    name: '',
    start_month: '1',
    start_day: '1',
    end_month: '12',
    end_day: '31',
    day_rules: defaultDayRules(),
  })

  useEffect(() => {
    if (open) {
      setForm(
        phase
          ? phaseToForm(phase)
          : {
              name: '',
              start_month: '1',
              start_day: '1',
              end_month: '12',
              end_day: '31',
              day_rules: defaultDayRules(),
            }
      )
    }
  }, [open, phase?.uuid])

  function setRule(dow: number, field: keyof HrPhaseDayRuleInput, value: unknown) {
    setForm((prev) => ({
      ...prev,
      day_rules: prev.day_rules.map((r) =>
        r.day_of_week === dow ? { ...r, [field]: value } : r
      ),
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = formToPhaseInput(form)
    try {
      if (phase) {
        await updatePhase.mutateAsync({ calendarUuid, phaseUuid: phase.uuid, data: payload })
        toast.success(t('phase.edit') + ' — OK')
      } else {
        await createPhase.mutateAsync({ calendarUuid, data: payload })
        toast.success(t('phase.add') + ' — OK')
      }
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  const isPending = createPhase.isPending || updatePhase.isPending

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{phase ? t('phase.edit') : t('phase.add')}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-1">
            <Label>{t('phase.fields.name')}</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{t('phase.fields.start')}</Label>
              <div className="flex gap-2">
                <Select
                  value={form.start_month}
                  onValueChange={(v) => setForm((p) => ({ ...p, start_month: v }))}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {pad2(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="self-center text-muted-foreground">/</span>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={form.start_day}
                  onChange={(e) => setForm((p) => ({ ...p, start_day: e.target.value }))}
                  className="w-16"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('phase.fields.end')}</Label>
              <div className="flex gap-2">
                <Select
                  value={form.end_month}
                  onValueChange={(v) => setForm((p) => ({ ...p, end_month: v }))}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {pad2(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="self-center text-muted-foreground">/</span>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={form.end_day}
                  onChange={(e) => setForm((p) => ({ ...p, end_day: e.target.value }))}
                  className="w-16"
                  required
                />
              </div>
            </div>
          </div>

          {/* Weekly schedule grid */}
          <div className="space-y-2">
            <Label>{t('phase.fields.schedule')}</Label>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">{t('calendar.fields.day_of_week')}</TableHead>
                    <TableHead className="w-20 text-center">{t('calendar.fields.is_working')}</TableHead>
                    <TableHead className="w-24">{t('calendar.fields.expected_hours')}</TableHead>
                    <TableHead className="w-28">{t('calendar.fields.start_time')}</TableHead>
                    <TableHead className="w-28">{t('calendar.fields.end_time')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.day_rules.map((rule) => (
                    <TableRow key={rule.day_of_week}>
                      <TableCell className="font-medium text-sm">
                        {t(`calendar.days.${rule.day_of_week}`)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={rule.is_working}
                          onCheckedChange={(v) => setRule(rule.day_of_week, 'is_working', !!v)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.25"
                          min="0"
                          max="24"
                          value={rule.expected_hours}
                          onChange={(e) =>
                            setRule(rule.day_of_week, 'expected_hours', e.target.value)
                          }
                          disabled={!rule.is_working}
                          className="w-20"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={rule.start_time ?? ''}
                          onChange={(e) =>
                            setRule(rule.day_of_week, 'start_time', e.target.value || null)
                          }
                          disabled={!rule.is_working}
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={rule.end_time ?? ''}
                          onChange={(e) =>
                            setRule(rule.day_of_week, 'end_time', e.target.value || null)
                          }
                          disabled={!rule.is_working}
                          className="w-28"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:cancel', 'Annuler')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t('common:saving', 'Enregistrement...') : t('common:save', 'Enregistrer')}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Calendars tab
// ---------------------------------------------------------------------------

function CalendarsTab() {
  const { t } = useTranslation('rh')
  const { data: calendars = [], isLoading } = useHrCalendars()
  const createCalendar = useCreateHrCalendar()
  const updateCalendar = useUpdateHrCalendar()
  const deleteCalendar = useDeleteHrCalendar()
  const deletePhase = useDeleteHrPhase()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [calDialog, setCalDialog] = useState<{
    open: boolean
    editing: HrWorkingTimeCalendar | null
  }>({ open: false, editing: null })
  const [calForm, setCalForm] = useState({ name: '', description: '' })
  const [deleteCalTarget, setDeleteCalTarget] = useState<HrWorkingTimeCalendar | null>(null)

  const [phaseSheet, setPhaseSheet] = useState<{
    open: boolean
    calendarUuid: string
    phase: HrCalendarPhase | null
  }>({ open: false, calendarUuid: '', phase: null })
  const [deletePhaseTarget, setDeletePhaseTarget] = useState<{
    calendarUuid: string
    phase: HrCalendarPhase
  } | null>(null)

  function toggleExpand(uuid: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(uuid) ? next.delete(uuid) : next.add(uuid)
      return next
    })
  }

  function openCreateCal() {
    setCalForm({ name: '', description: '' })
    setCalDialog({ open: true, editing: null })
  }

  function openEditCal(cal: HrWorkingTimeCalendar) {
    setCalForm({ name: cal.name, description: cal.description ?? '' })
    setCalDialog({ open: true, editing: cal })
  }

  async function handleCalSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = { name: calForm.name, description: calForm.description || null }
    try {
      if (calDialog.editing) {
        await updateCalendar.mutateAsync({ uuid: calDialog.editing.uuid, data: payload })
        toast.success(t('calendar.edit') + ' — OK')
      } else {
        const created = await createCalendar.mutateAsync(payload)
        toast.success(t('calendar.add') + ' — OK')
        setExpanded((prev) => new Set([...prev, created.uuid]))
      }
      setCalDialog({ open: false, editing: null })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  async function handleDeleteCal() {
    if (!deleteCalTarget) return
    try {
      await deleteCalendar.mutateAsync(deleteCalTarget.uuid)
      toast.success(t('calendar.delete_confirm') + ' — OK')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    } finally {
      setDeleteCalTarget(null)
    }
  }

  async function handleDeletePhase() {
    if (!deletePhaseTarget) return
    try {
      await deletePhase.mutateAsync({
        calendarUuid: deletePhaseTarget.calendarUuid,
        phaseUuid: deletePhaseTarget.phase.uuid,
      })
      toast.success(t('phase.delete_confirm') + ' — OK')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    } finally {
      setDeletePhaseTarget(null)
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-4">{t('common:loading', 'Chargement...')}</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreateCal}>
          <Plus className="mr-1 h-4 w-4" />
          {t('calendar.add')}
        </Button>
      </div>

      {calendars.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t('calendar.no_results')}</p>
      ) : (
        <div className="space-y-3">
          {calendars.map((cal: HrWorkingTimeCalendar) => {
            const isOpen = expanded.has(cal.uuid)
            return (
              <div key={cal.uuid} className="rounded-md border bg-card">
                {/* Calendar header */}
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    className="flex items-center gap-2 flex-1 text-left"
                    onClick={() => toggleExpand(cal.uuid)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-semibold">{cal.name}</span>
                    <Badge variant="outline" className="ml-1 text-xs">
                      {t('calendar.phase_count', {
                        count: cal.phases.length,
                        defaultValue: `${cal.phases.length} phase(s)`,
                      })}
                    </Badge>
                    {cal.description && (
                      <span className="text-sm text-muted-foreground ml-2">{cal.description}</span>
                    )}
                  </button>
                  <Button variant="ghost" size="icon" onClick={() => openEditCal(cal)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => setDeleteCalTarget(cal)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Phases list */}
                {isOpen && (
                  <div className="border-t px-4 py-3 space-y-3">
                    {cal.phases.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('phase.no_results')}</p>
                    ) : (
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('phase.fields.name')}</TableHead>
                              <TableHead>{t('phase.fields.start')}</TableHead>
                              <TableHead>{t('phase.fields.end')}</TableHead>
                              <TableHead>{t('phase.fields.days_configured')}</TableHead>
                              <TableHead />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {cal.phases.map((phase: HrCalendarPhase) => (
                              <TableRow key={phase.uuid}>
                                <TableCell className="font-medium">{phase.name}</TableCell>
                                <TableCell className="font-mono text-sm">
                                  {fmtMD(phase.start_month, phase.start_day)}
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {fmtMD(phase.end_month, phase.end_day)}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {phase.day_rules.filter((r) => r.is_working).length}
                                  {' '}{t('phase.working_days')}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      setPhaseSheet({
                                        open: true,
                                        calendarUuid: cal.uuid,
                                        phase,
                                      })
                                    }
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive"
                                    onClick={() =>
                                      setDeletePhaseTarget({ calendarUuid: cal.uuid, phase })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPhaseSheet({ open: true, calendarUuid: cal.uuid, phase: null })
                      }
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      {t('phase.add')}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create/edit calendar dialog */}
      <Dialog open={calDialog.open} onOpenChange={(v) => setCalDialog((p) => ({ ...p, open: v }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {calDialog.editing ? t('calendar.edit') : t('calendar.add')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCalSubmit} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>{t('calendar.fields.name')}</Label>
              <Input
                value={calForm.name}
                onChange={(e) => setCalForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>{t('calendar.fields.description')}</Label>
              <Textarea
                value={calForm.description}
                onChange={(e) => setCalForm((p) => ({ ...p, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCalDialog({ open: false, editing: null })}
              >
                {t('common:cancel', 'Annuler')}
              </Button>
              <Button type="submit" disabled={createCalendar.isPending || updateCalendar.isPending}>
                {t('common:save', 'Enregistrer')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete calendar confirmation */}
      <AlertDialog
        open={!!deleteCalTarget}
        onOpenChange={(v) => { if (!v) setDeleteCalTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('calendar.delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('calendar.delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel', 'Annuler')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCal} className="bg-destructive text-destructive-foreground">
              {t('common:delete', 'Supprimer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Phase editor sheet */}
      <PhaseSheet
        open={phaseSheet.open}
        onOpenChange={(v) => setPhaseSheet((p) => ({ ...p, open: v }))}
        calendarUuid={phaseSheet.calendarUuid}
        phase={phaseSheet.phase}
        onSaved={() => {}}
      />

      {/* Delete phase confirmation */}
      <AlertDialog
        open={!!deletePhaseTarget}
        onOpenChange={(v) => { if (!v) setDeletePhaseTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('phase.delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('phase.delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel', 'Annuler')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePhase} className="bg-destructive text-destructive-foreground">
              {t('common:delete', 'Supprimer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assignments tab
// ---------------------------------------------------------------------------

interface AssignmentFormState {
  member_uuid: string
  calendar_uuid: string
  effective_from: string
  effective_to: string
}

function AssignmentsTab() {
  const { t } = useTranslation('rh')
  const { data: assignments = [], isLoading } = useHrAssignments()
  const { data: calendars = [] } = useHrCalendars()
  const { data: profiles = [] } = useHrProfiles(false)
  const createAssignment = useCreateHrAssignment()
  const updateAssignment = useUpdateHrAssignment()
  const deleteAssignment = useDeleteHrAssignment()

  const [dialog, setDialog] = useState<{
    open: boolean
    editing: HrEmployeeCalendarAssignment | null
  }>({ open: false, editing: null })
  const [form, setForm] = useState<AssignmentFormState>({
    member_uuid: '',
    calendar_uuid: '',
    effective_from: '',
    effective_to: '',
  })
  const [deleteTarget, setDeleteTarget] = useState<HrEmployeeCalendarAssignment | null>(null)

  function openCreate() {
    setForm({ member_uuid: '', calendar_uuid: '', effective_from: '', effective_to: '' })
    setDialog({ open: true, editing: null })
  }

  function openEdit(a: HrEmployeeCalendarAssignment) {
    setForm({
      member_uuid: a.member_uuid,
      calendar_uuid: a.calendar_uuid,
      effective_from: a.effective_from,
      effective_to: a.effective_to ?? '',
    })
    setDialog({ open: true, editing: a })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      member_uuid: form.member_uuid,
      calendar_uuid: form.calendar_uuid,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
    }
    try {
      if (dialog.editing) {
        await updateAssignment.mutateAsync({ uuid: dialog.editing.uuid, data: payload })
        toast.success(t('assignment.edit') + ' — OK')
      } else {
        await createAssignment.mutateAsync(payload)
        toast.success(t('assignment.add') + ' — OK')
      }
      setDialog({ open: false, editing: null })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteAssignment.mutateAsync(deleteTarget.uuid)
      toast.success(t('assignment.delete_confirm') + ' — OK')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    } finally {
      setDeleteTarget(null)
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-4">{t('common:loading', 'Chargement...')}</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('assignment.add')}
        </Button>
      </div>

      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t('assignment.no_results')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assignment.fields.employee')}</TableHead>
                <TableHead>{t('assignment.fields.calendar')}</TableHead>
                <TableHead>{t('assignment.fields.effective_from')}</TableHead>
                <TableHead>{t('assignment.fields.effective_to')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a: HrEmployeeCalendarAssignment) => (
                <TableRow key={a.uuid}>
                  <TableCell>
                    <span className="font-medium">
                      {a.member_last_name} {a.member_first_name}
                    </span>
                    {a.member_account_id && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {a.member_account_id}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{a.calendar_name ?? '—'}</TableCell>
                  <TableCell className="font-mono text-sm">{a.effective_from}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {a.effective_to ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(a)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => setDeleteTarget(a)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/edit dialog */}
      <Dialog open={dialog.open} onOpenChange={(v) => setDialog((p) => ({ ...p, open: v }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog.editing ? t('assignment.edit') : t('assignment.add')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            {!dialog.editing && (
              <div className="space-y-1">
                <Label>{t('assignment.fields.employee')}</Label>
                <Select
                  value={form.member_uuid}
                  onValueChange={(v) => setForm((p) => ({ ...p, member_uuid: v }))}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('assignment.pick_employee', 'Sélectionner un employé…')} />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((p: HrEmployeeProfile) => (
                      <SelectItem key={p.member_uuid} value={p.member_uuid}>
                        {p.member_last_name} {p.member_first_name}
                        {p.member_account_id && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {p.member_account_id}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>{t('assignment.fields.calendar')}</Label>
              <Select
                value={form.calendar_uuid}
                onValueChange={(v) => setForm((p) => ({ ...p, calendar_uuid: v }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('assignment.pick_calendar', 'Sélectionner un calendrier…')} />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((c: HrWorkingTimeCalendar) => (
                    <SelectItem key={c.uuid} value={c.uuid}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('assignment.fields.effective_from')}</Label>
                <Input
                  type="date"
                  value={form.effective_from}
                  onChange={(e) => setForm((p) => ({ ...p, effective_from: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>{t('assignment.fields.effective_to')}</Label>
                <Input
                  type="date"
                  value={form.effective_to}
                  onChange={(e) => setForm((p) => ({ ...p, effective_to: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog({ open: false, editing: null })}
              >
                {t('common:cancel', 'Annuler')}
              </Button>
              <Button
                type="submit"
                disabled={createAssignment.isPending || updateAssignment.isPending}
              >
                {t('common:save', 'Enregistrer')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assignment.delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('assignment.delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel', 'Annuler')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {t('common:delete', 'Supprimer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function CalendarManagementPage() {
  const { t } = useTranslation('rh')

  return (
    <Tabs defaultValue="calendars">
      <TabsList className="mb-4">
        <TabsTrigger value="calendars">{t('calendar.title')}</TabsTrigger>
        <TabsTrigger value="assignments">{t('assignment.title')}</TabsTrigger>
      </TabsList>

      <TabsContent value="calendars">
        <CalendarsTab />
      </TabsContent>

      <TabsContent value="assignments">
        <AssignmentsTab />
      </TabsContent>
    </Tabs>
  )
}
