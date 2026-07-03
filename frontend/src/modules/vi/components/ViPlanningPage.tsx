/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Planning page — 4-week calendar with drag-and-drop scheduling
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

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import {
  usePatchViEntitlementMutation,
  useViEntitlementsQuery,
  type ViEntitlement,
} from '../api'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    const detail = response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return 'Erreur inattendue'
}

function dateToIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Voucher card ──────────────────────────────────────────────────────────────

function VoucherCard({
  row,
  isDragging,
  onDragStart,
  onDragEnd,
  onUnschedule,
}: {
  row: ViEntitlement
  isDragging: boolean
  onDragStart: (uuid: string) => void
  onDragEnd: () => void
  onUnschedule?: () => void
}) {
  const isRealized = row.status === 3
  const isSentToPlanche = row.planche_synced_at != null

  return (
    <div
      draggable={!isRealized}
      onDragStart={() => { if (!isRealized) onDragStart(row.uuid) }}
      onDragEnd={onDragEnd}
      title={row.description ?? row.code}
      className={[
        'group relative flex flex-col gap-0.5 rounded border px-1.5 py-1 text-xs shadow-sm select-none transition-opacity',
        isRealized ? 'cursor-default' : 'cursor-grab',
        isDragging ? 'opacity-30' : 'opacity-100',
        isRealized
          ? 'bg-emerald-50 border-emerald-200'
          : isSentToPlanche
            ? 'bg-violet-50 border-violet-200 hover:border-violet-400'
            : row.status === 1
              ? 'bg-blue-50 border-blue-200 hover:border-blue-400'
              : 'bg-amber-50 border-amber-200 hover:border-amber-400',
      ].join(' ')}
    >
      {onUnschedule && !isRealized && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onUnschedule() }}
          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center h-4 w-4 rounded-full bg-slate-500 text-white hover:bg-destructive transition-colors z-10"
          title="Retirer la date"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        <span className="font-mono font-semibold leading-tight truncate">{row.code}</span>
        {row.vi_type_code && (
          <Badge variant="outline" className="text-[10px] font-mono px-1 py-0 leading-tight shrink-0">
            {row.vi_type_code}
          </Badge>
        )}
      </div>
      {row.amount_ttc && (
        <span className="text-muted-foreground tabular-nums leading-tight">
          {parseFloat(row.amount_ttc).toFixed(0)} €
        </span>
      )}
    </div>
  )
}

// ── Day cell ──────────────────────────────────────────────────────────────────

function DayCell({
  day,
  iso,
  isToday,
  isWeekend,
  rows,
  draggingUuid,
  onDrop,
  onDragStart,
  onDragEnd,
  onUnschedule,
}: {
  day: Date
  iso: string
  isToday: boolean
  isWeekend: boolean
  rows: ViEntitlement[]
  draggingUuid: string | null
  onDrop: (iso: string) => void
  onDragStart: (uuid: string) => void
  onDragEnd: () => void
  onUnschedule: (uuid: string) => void
}) {
  const [isOver, setIsOver] = useState(false)

  return (
    <div
      className={[
        'min-h-[90px] p-1 flex flex-col gap-1',
        isToday ? 'bg-blue-50' : isWeekend ? 'bg-slate-50/60' : 'bg-white',
        isOver && draggingUuid ? 'ring-2 ring-inset ring-primary' : '',
      ].join(' ')}
      onDragOver={(e) => { e.preventDefault(); setIsOver(true) }}
      onDragLeave={() => setIsOver(false)}
      onDrop={() => { setIsOver(false); onDrop(iso) }}
    >
      <span className={[
        'text-xs tabular-nums self-end leading-none',
        isToday ? 'text-primary font-bold' : 'text-muted-foreground',
      ].join(' ')}>
        {day.getDate()}
      </span>
      {rows.map((row) => (
        <VoucherCard
          key={row.uuid}
          row={row}
          isDragging={draggingUuid === row.uuid}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onUnschedule={() => onUnschedule(row.uuid)}
        />
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export function ViPlanningPage() {
  const { t } = useTranslation('vi')
  const entitlementsQuery = useViEntitlementsQuery()
  const patchMutation = usePatchViEntitlementMutation()

  const [weekOffset, setWeekOffset] = useState(0)
  const [draggingUuid, setDraggingUuid] = useState<string | null>(null)
  const [unscheduledOver, setUnscheduledOver] = useState(false)
  const [search, setSearch] = useState('')

  // Stable today string — computed once on mount, not on every render
  const today = useMemo(() => dateToIso(new Date()), [])

  // Monday of current week, shifted by weekOffset * 28 days
  const windowStart = useMemo(() => {
    const d = new Date()
    const dow = d.getDay() // 0=Sun … 6=Sat
    const monday = new Date(d)
    monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1) + weekOffset * 28)
    monday.setHours(0, 0, 0, 0)
    return monday
  }, [weekOffset])

  const days = useMemo(
    () => Array.from({ length: 28 }, (_, i) => {
      const d = new Date(windowStart)
      d.setDate(windowStart.getDate() + i)
      return d
    }),
    [windowStart],
  )

  const periodLabel = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    const start = days[0]
    const end = days[27]
    if (start.getFullYear() === end.getFullYear()) {
      return `${fmt(start)} – ${fmt(end)} ${end.getFullYear()}`
    }
    return `${fmt(start)} ${start.getFullYear()} – ${fmt(end)} ${end.getFullYear()}`
  }, [days])

  // Non-generic, still relevant to the calendar: Chargé=1, Planifié=2, Réalisé=3 (locked, shown for reference)
  const baseRows = useMemo(
    () => (entitlementsQuery.data ?? []).filter(
      (r) => !r.is_generic && (r.status === 1 || r.status === 2 || r.status === 3),
    ),
    [entitlementsQuery.data],
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return baseRows
    return baseRows.filter(
      (r) => r.code.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
    )
  }, [baseRows, search])

  const byDate = useMemo(() => {
    const map: Record<string, ViEntitlement[]> = {}
    filteredRows.forEach((r) => {
      if (r.scheduled_date) {
        if (!map[r.scheduled_date]) map[r.scheduled_date] = []
        map[r.scheduled_date].push(r)
      }
    })
    return map
  }, [filteredRows])

  const unscheduled = useMemo(
    () => filteredRows.filter((r) => !r.scheduled_date),
    [filteredRows],
  )

  async function handleDropOnDay(iso: string) {
    if (!draggingUuid) return
    const uuid = draggingUuid
    setDraggingUuid(null)
    await patchMutation.mutateAsync({
      entitlementUuid: uuid,
      payload: { scheduled_date: iso },
    })
  }

  async function handleUnschedule(uuid: string) {
    await patchMutation.mutateAsync({
      entitlementUuid: uuid,
      payload: { scheduled_date: null },
    })
  }

  async function handleDropOnUnscheduled() {
    if (!draggingUuid) return
    const uuid = draggingUuid
    setDraggingUuid(null)
    setUnscheduledOver(false)
    await patchMutation.mutateAsync({
      entitlementUuid: uuid,
      payload: { scheduled_date: null },
    })
  }

  function handleDragEnd() {
    setDraggingUuid(null)
    setUnscheduledOver(false)
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">Planification des bons VI</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Glissez un bon vers un jour pour le planifier.
            {unscheduled.length > 0 && (
              <span className="ml-1">
                {unscheduled.length} non planifié{unscheduled.length > 1 ? 's' : ''}.
              </span>
            )}
          </p>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setWeekOffset((w) => w - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[220px] text-center">{periodLabel}</span>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {weekOffset !== 0 && (
            <Button size="sm" variant="ghost" onClick={() => setWeekOffset(0)}>
              Aujourd'hui
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <Input
        placeholder="Rechercher un bon (code, description…)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm text-sm"
      />

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-blue-50 border border-blue-200" />
          {t('planning.legend.loaded')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-50 border border-amber-200" />
          {t('planning.legend.scheduled')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-violet-50 border border-violet-200" />
          {t('planning.legend.sentToPlanche')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-50 border border-emerald-200" />
          {t('planning.legend.realized')}
        </span>
      </div>

      {entitlementsQuery.error && <Alert>{toErrorMessage(entitlementsQuery.error)}</Alert>}
      {patchMutation.error && <Alert>{toErrorMessage(patchMutation.error)}</Alert>}

      {entitlementsQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}

      {/* Calendar grid */}
      <div className="rounded-xl border border-outline-variant overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-7 divide-x border-b bg-slate-50">
          {DAY_NAMES.map((d) => (
            <div key={d} className="px-2 py-1.5 text-xs font-semibold text-center text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* 4 week rows */}
        {Array.from({ length: 4 }, (_, week) => (
          <div key={week} className={['grid grid-cols-7 divide-x', week > 0 ? 'border-t' : ''].join(' ')}>
            {Array.from({ length: 7 }, (_, dow) => {
              const day = days[week * 7 + dow]
              const iso = dateToIso(day)
              return (
                <DayCell
                  key={iso}
                  day={day}
                  iso={iso}
                  isToday={iso === today}
                  isWeekend={day.getDay() === 0 || day.getDay() === 6}
                  rows={byDate[iso] ?? []}
                  draggingUuid={draggingUuid}
                  onDrop={(d) => { void handleDropOnDay(d) }}
                  onDragStart={setDraggingUuid}
                  onDragEnd={handleDragEnd}
                  onUnschedule={(uuid) => { void handleUnschedule(uuid) }}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Unscheduled drop zone */}
      <div
        className={[
          'rounded-xl border-2 border-dashed p-3 min-h-[64px] transition-colors',
          unscheduledOver && draggingUuid ? 'border-primary bg-primary/5' : 'border-slate-300',
        ].join(' ')}
        onDragOver={(e) => { e.preventDefault(); setUnscheduledOver(true) }}
        onDragLeave={() => setUnscheduledOver(false)}
        onDrop={() => { void handleDropOnUnscheduled() }}
      >
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Non planifiés{unscheduled.length > 0 ? ` (${unscheduled.length})` : ''} — déposez ici pour retirer une date
        </p>
        <div className="flex flex-wrap gap-2">
          {unscheduled.map((row) => (
            <VoucherCard
              key={row.uuid}
              row={row}
              isDragging={draggingUuid === row.uuid}
              onDragStart={setDraggingUuid}
              onDragEnd={handleDragEnd}
            />
          ))}
          {unscheduled.length === 0 && !entitlementsQuery.isLoading && (
            <p className="text-xs text-muted-foreground italic">Tous les bons sont planifiés.</p>
          )}
        </div>
      </div>
    </section>
  )
}
