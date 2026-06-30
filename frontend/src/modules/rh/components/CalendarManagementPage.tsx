/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - rh: CalendarManagementPage — seasons, calendars, and assignments management
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
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import {
  useHrSeasons,
  useCreateHrSeason,
  useUpdateHrSeason,
  useDeleteHrSeason,
  useHrCalendars,
  useCreateHrCalendar,
  useUpdateHrCalendar,
  useDeleteHrCalendar,
  useHrAssignments,
  useCreateHrAssignment,
  useUpdateHrAssignment,
  useDeleteHrAssignment,
  useHrProfiles,
} from '../api'
import type {
  HrCalendarAssignment,
  HrEmployeeProfile,
  HrSeason,
  HrWorkCalendar,
  HrWorkCalendarDay,
} from '../types'

// ---------------------------------------------------------------------------
// Seasons tab
// ---------------------------------------------------------------------------

interface SeasonFormState {
  name: string
  start_date: string
  end_date: string
  description: string
}

const defaultSeasonForm: SeasonFormState = {
  name: '',
  start_date: '',
  end_date: '',
  description: '',
}

function SeasonsTab() {
  const { t } = useTranslation('rh')
  const { data: seasons = [], isLoading } = useHrSeasons()
  const createMutation = useCreateHrSeason()
  const updateMutation = useUpdateHrSeason()
  const deleteMutation = useDeleteHrSeason()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [form, setForm] = useState<SeasonFormState>(defaultSeasonForm)
  const [deleteTarget, setDeleteTarget] = useState<HrSeason | null>(null)

  function openCreate() {
    setEditingUuid(null)
    setForm(defaultSeasonForm)
    setDialogOpen(true)
  }

  function openEdit(s: HrSeason) {
    setEditingUuid(s.uuid)
    setForm({
      name: s.name,
      start_date: s.start_date,
      end_date: s.end_date,
      description: s.description ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      name: form.name,
      start_date: form.start_date,
      end_date: form.end_date,
      description: form.description || null,
    }
    try {
      if (editingUuid) {
        await updateMutation.mutateAsync({ uuid: editingUuid, data: payload })
      } else {
        await createMutation.mutateAsync(payload as Omit<HrSeason, 'uuid' | 'created_at' | 'updated_at'>)
      }
      setDialogOpen(false)
      toast.success('OK')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.uuid)
      toast.success('Saison supprimée')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    } finally {
      setDeleteTarget(null)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('season.add')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common:loading', 'Chargement...')}</p>
      ) : seasons.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t('season.no_results')}</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('season.fields.name')}</TableHead>
                <TableHead>{t('season.fields.start_date')}</TableHead>
                <TableHead>{t('season.fields.end_date')}</TableHead>
                <TableHead>{t('season.fields.description')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {seasons.map((s: HrSeason) => (
                <TableRow key={s.uuid}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.start_date}</TableCell>
                  <TableCell>{s.end_date}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.description ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(s)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUuid ? t('season.edit') : t('season.add')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>{t('season.fields.name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('season.fields.start_date')}</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>{t('season.fields.end_date')}</Label>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('season.fields.description')}</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('season.delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('season.delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calendars tab
// ---------------------------------------------------------------------------

const DAY_KEYS = ['1', '2', '3', '4', '5', '6', '7'] as const
const APPLY_WEEK_KEYS = ['0', '1', '2', '3', '4', '5'] as const

interface DayFormRow {
  day_of_week: number
  is_working: boolean
  expected_hours: string
  start_time: string
  end_time: string
  apply_on_week: number
}

function buildDefaultDays(): DayFormRow[] {
  return DAY_KEYS.map((d) => ({
    day_of_week: parseInt(d),
    is_working: parseInt(d) <= 5, // Mon–Fri working by default
    expected_hours: parseInt(d) <= 5 ? '7.00' : '0',
    start_time: '',
    end_time: '',
    apply_on_week: 0,
  }))
}

function calendarDaysToForm(days: HrWorkCalendarDay[]): DayFormRow[] {
  // Group by day_of_week, take apply_on_week=0 entry per day for simple form
  const result = buildDefaultDays()
  for (const d of days) {
    if (d.apply_on_week === 0) {
      const idx = result.findIndex((r) => r.day_of_week === d.day_of_week)
      if (idx >= 0) {
        result[idx] = {
          day_of_week: d.day_of_week,
          is_working: d.is_working,
          expected_hours: d.expected_hours,
          start_time: d.start_time ?? '',
          end_time: d.end_time ?? '',
          apply_on_week: 0,
        }
      }
    }
  }
  return result
}

function CalendarsTab() {
  const { t } = useTranslation('rh')
  const { data: calendars = [], isLoading } = useHrCalendars()
  const createMutation = useCreateHrCalendar()
  const updateMutation = useUpdateHrCalendar()
  const deleteMutation = useDeleteHrCalendar()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [calName, setCalName] = useState('')
  const [calDesc, setCalDesc] = useState('')
  const [dayRows, setDayRows] = useState<DayFormRow[]>(buildDefaultDays())
  const [expandedUuid, setExpandedUuid] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HrWorkCalendar | null>(null)

  function openCreate() {
    setEditingUuid(null)
    setCalName('')
    setCalDesc('')
    setDayRows(buildDefaultDays())
    setSheetOpen(true)
  }

  function openEdit(c: HrWorkCalendar) {
    setEditingUuid(c.uuid)
    setCalName(c.name)
    setCalDesc(c.description ?? '')
    setDayRows(calendarDaysToForm(c.days))
    setSheetOpen(true)
  }

  function updateDayRow(idx: number, field: keyof DayFormRow, value: string | boolean | number) {
    setDayRows((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const days = dayRows.map((r) => ({
      day_of_week: r.day_of_week,
      is_working: r.is_working,
      expected_hours: r.expected_hours,
      start_time: r.start_time || null,
      end_time: r.end_time || null,
      apply_on_week: r.apply_on_week,
    }))
    try {
      if (editingUuid) {
        await updateMutation.mutateAsync({ uuid: editingUuid, data: { name: calName, description: calDesc || null, days } })
      } else {
        await createMutation.mutateAsync({ name: calName, description: calDesc || undefined, days })
      }
      setSheetOpen(false)
      toast.success('OK')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.uuid)
      toast.success('Calendrier supprimé')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    } finally {
      setDeleteTarget(null)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('calendar.add')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common:loading', 'Chargement...')}</p>
      ) : calendars.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t('calendar.no_results')}</p>
      ) : (
        <div className="space-y-2">
          {calendars.map((c: HrWorkCalendar) => {
            const isExpanded = expandedUuid === c.uuid
            return (
              <div key={c.uuid} className="rounded-md border bg-card">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="font-medium text-sm hover:underline text-left"
                      onClick={() => setExpandedUuid(isExpanded ? null : c.uuid)}
                    >
                      {c.name}
                    </button>
                    {c.description && (
                      <span className="text-xs text-muted-foreground">{c.description}</span>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {t('calendar.day_count', { count: c.days.length })}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {isExpanded && c.days.length > 0 && (
                  <div className="border-t px-4 py-3 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('calendar.fields.day_of_week')}</TableHead>
                          <TableHead>{t('calendar.fields.is_working')}</TableHead>
                          <TableHead>{t('calendar.fields.expected_hours')}</TableHead>
                          <TableHead>{t('calendar.fields.start_time')}</TableHead>
                          <TableHead>{t('calendar.fields.end_time')}</TableHead>
                          <TableHead>{t('calendar.fields.apply_on_week')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {c.days.map((d: HrWorkCalendarDay) => (
                          <TableRow key={d.uuid}>
                            <TableCell>{t(`calendar.days.${d.day_of_week}`, String(d.day_of_week))}</TableCell>
                            <TableCell>
                              <Badge className={d.is_working ? 'badge-success' : ''} variant={d.is_working ? 'default' : 'secondary'}>
                                {d.is_working ? 'Oui' : 'Non'}
                              </Badge>
                            </TableCell>
                            <TableCell>{d.expected_hours}h</TableCell>
                            <TableCell>{d.start_time ?? '—'}</TableCell>
                            <TableCell>{d.end_time ?? '—'}</TableCell>
                            <TableCell>
                              {t(`calendar.apply_on_week_options.${d.apply_on_week}`, String(d.apply_on_week))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingUuid ? t('calendar.edit') : t('calendar.add')}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1">
              <Label>{t('calendar.fields.name')}</Label>
              <Input
                value={calName}
                onChange={(e) => setCalName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>{t('calendar.fields.description')}</Label>
              <Input
                value={calDesc}
                onChange={(e) => setCalDesc(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('calendar.title')} — jours</p>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('calendar.fields.day_of_week')}</TableHead>
                      <TableHead>{t('calendar.fields.is_working')}</TableHead>
                      <TableHead>{t('calendar.fields.expected_hours')}</TableHead>
                      <TableHead>{t('calendar.fields.start_time')}</TableHead>
                      <TableHead>{t('calendar.fields.end_time')}</TableHead>
                      <TableHead>{t('calendar.fields.apply_on_week')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dayRows.map((row, idx) => (
                      <TableRow key={row.day_of_week}>
                        <TableCell className="font-medium text-sm">
                          {t(`calendar.days.${row.day_of_week}`, String(row.day_of_week))}
                        </TableCell>
                        <TableCell>
                          <Checkbox
                            checked={row.is_working}
                            onCheckedChange={(v) => updateDayRow(idx, 'is_working', !!v)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="24"
                            className="w-20"
                            value={row.expected_hours}
                            onChange={(e) => updateDayRow(idx, 'expected_hours', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="time"
                            className="w-28"
                            value={row.start_time}
                            onChange={(e) => updateDayRow(idx, 'start_time', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="time"
                            className="w-28"
                            value={row.end_time}
                            onChange={(e) => updateDayRow(idx, 'end_time', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={String(row.apply_on_week)}
                            onValueChange={(v) => updateDayRow(idx, 'apply_on_week', parseInt(v))}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {APPLY_WEEK_KEYS.map((wk) => (
                                <SelectItem key={wk} value={wk}>
                                  {t(`calendar.apply_on_week_options.${wk}`, wk)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('calendar.delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('calendar.delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Supprimer
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

function AssignmentsTab() {
  const { t } = useTranslation('rh')
  const { data: assignments = [], isLoading } = useHrAssignments()
  const { data: profiles = [] } = useHrProfiles(false)
  const { data: seasons = [] } = useHrSeasons()
  const { data: calendars = [] } = useHrCalendars()
  const createMutation = useCreateHrAssignment()
  const updateMutation = useUpdateHrAssignment()
  const deleteMutation = useDeleteHrAssignment()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [formMember, setFormMember] = useState('')
  const [formSeason, setFormSeason] = useState('')
  const [formCalendar, setFormCalendar] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<HrCalendarAssignment | null>(null)

  function openCreate() {
    setEditingUuid(null)
    setFormMember('')
    setFormSeason('')
    setFormCalendar('')
    setDialogOpen(true)
  }

  function openEdit(a: HrCalendarAssignment) {
    setEditingUuid(a.uuid)
    setFormCalendar(a.calendar_uuid)
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingUuid) {
        await updateMutation.mutateAsync({ uuid: editingUuid, calendar_uuid: formCalendar })
      } else {
        await createMutation.mutateAsync({
          member_uuid: formMember,
          season_uuid: formSeason,
          calendar_uuid: formCalendar,
        })
      }
      setDialogOpen(false)
      toast.success('OK')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.uuid)
      toast.success('Affectation supprimée')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    } finally {
      setDeleteTarget(null)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('assignment.add')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common:loading', 'Chargement...')}</p>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t('assignment.no_results')}</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assignment.fields.employee')}</TableHead>
                <TableHead>{t('assignment.fields.season')}</TableHead>
                <TableHead>{t('assignment.fields.calendar')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a: HrCalendarAssignment) => (
                <TableRow key={a.uuid}>
                  <TableCell className="font-medium">
                    {a.member_last_name} {a.member_first_name}
                    {a.member_account_id && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({a.member_account_id})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{a.season_name ?? '—'}</TableCell>
                  <TableCell>{a.calendar_name ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(a)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUuid ? t('assignment.edit') : t('assignment.add')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!editingUuid && (
              <>
                <div className="space-y-1">
                  <Label>{t('assignment.fields.employee')}</Label>
                  <Select value={formMember} onValueChange={setFormMember} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un employé..." />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p: HrEmployeeProfile) => (
                        <SelectItem key={p.member_uuid} value={p.member_uuid}>
                          {p.member_last_name} {p.member_first_name}
                          {p.member_trigram ? ` (${p.member_trigram})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t('assignment.fields.season')}</Label>
                  <Select value={formSeason} onValueChange={setFormSeason} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une saison..." />
                    </SelectTrigger>
                    <SelectContent>
                      {seasons.map((s: HrSeason) => (
                        <SelectItem key={s.uuid} value={s.uuid}>
                          {s.name} ({s.start_date} – {s.end_date})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label>{t('assignment.fields.calendar')}</Label>
              <Select value={formCalendar} onValueChange={setFormCalendar} required>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un calendrier..." />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((c: HrWorkCalendar) => (
                    <SelectItem key={c.uuid} value={c.uuid}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assignment.delete_confirm')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Supprimer
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('calendar.description')}
      </p>
      <Tabs defaultValue="seasons">
        <TabsList>
          <TabsTrigger value="seasons">{t('season.title')}</TabsTrigger>
          <TabsTrigger value="calendars">{t('calendar.title')}</TabsTrigger>
          <TabsTrigger value="assignments">{t('assignment.title')}</TabsTrigger>
        </TabsList>
        <TabsContent value="seasons" className="mt-4">
          <SeasonsTab />
        </TabsContent>
        <TabsContent value="calendars" className="mt-4">
          <CalendarsTab />
        </TabsContent>
        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
