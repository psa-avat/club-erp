/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Planning page — schedule non-generic vouchers, per-row and bulk date editing
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
import { CheckCircle2, Loader2 } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useBulkScheduleViMutation,
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

function fmtAmount(v: string | null | undefined): string {
  if (v == null) return '—'
  try {
    const n = parseFloat(v)
    return n.toFixed(2) + ' €'
  } catch { return v }
}

// ── Per-row inline date cell ───────────────────────────────────────────────

function InlineDateCell({ row }: { row: ViEntitlement }) {
  const patchMutation = usePatchViEntitlementMutation()
  const [value, setValue] = useState(row.scheduled_date ?? '')

  async function handleBlur() {
    const newDate = value || null
    if (newDate === (row.scheduled_date ?? null)) return
    await patchMutation.mutateAsync({
      entitlementUuid: row.uuid,
      payload: { scheduled_date: newDate },
    })
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { void handleBlur() }}
        disabled={patchMutation.isPending}
        className="h-7 w-32 text-xs border rounded px-2 bg-background disabled:opacity-50 tabular-nums"
      />
      {patchMutation.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {patchMutation.isSuccess && !patchMutation.isPending && (
        <CheckCircle2 className="h-3 w-3 text-green-600" />
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<number, string> = { 1: 'Chargé', 2: 'Planifié' }

export function ViPlanningPage() {
  const entitlementsQuery = useViEntitlementsQuery()
  const bulkScheduleMutation = useBulkScheduleViMutation()

  const [bulkDate, setBulkDate] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | '1' | '2'>('all')

  // Non-generic, Chargé or Planifié only
  const baseRows = useMemo(
    () => (entitlementsQuery.data ?? []).filter(
      (r) => !r.is_generic && (r.status === 1 || r.status === 2),
    ),
    [entitlementsQuery.data],
  )

  const filteredRows = useMemo(() => {
    let rows = baseRows
    if (statusFilter !== 'all') rows = rows.filter((r) => r.status === Number(statusFilter))
    const q = search.trim().toLowerCase()
    if (q) rows = rows.filter(
      (r) => r.code.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
    )
    return rows
  }, [baseRows, statusFilter, search])

  const selectedIds = useMemo(
    () => filteredRows.filter((r) => selected[r.uuid]).map((r) => r.uuid),
    [filteredRows, selected],
  )

  const allChecked = filteredRows.length > 0 && filteredRows.every((r) => selected[r.uuid])
  const someChecked = filteredRows.some((r) => selected[r.uuid])

  function toggleAll() {
    if (allChecked) {
      setSelected({})
    } else {
      const next: Record<string, boolean> = {}
      filteredRows.forEach((r) => { next[r.uuid] = true })
      setSelected(next)
    }
  }

  function toggleRow(uuid: string) {
    setSelected((prev) => ({ ...prev, [uuid]: !prev[uuid] }))
  }

  async function applyBulkDate() {
    await bulkScheduleMutation.mutateAsync({
      entitlement_uuids: selectedIds,
      scheduled_date: bulkDate || null,
    })
    setSelected({})
  }

  const statusBadgeClass = (status: number) =>
    status === 1 ? 'badge badge-info' : 'badge badge-warning'

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Planification des bons VI</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Assignez une date de vol à chaque bon. Les bons génériques sont gérés séparément (Sync Planche).
        </p>
      </div>

      {/* Filter bar */}
      <div className="grid gap-3 rounded-xl border border-outline-variant bg-surface p-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <Label className="text-xs">Rechercher</Label>
          <Input
            placeholder="Code ou description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Statut</Label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | '1' | '2')}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="all">Chargé + Planifié</option>
            <option value="1">Chargé uniquement</option>
            <option value="2">Planifié uniquement</option>
          </select>
        </div>
      </div>

      {/* Bulk toolbar — only when items selected */}
      {someChecked && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="text-sm font-medium text-blue-800 self-center">
            {selectedIds.length} bon{selectedIds.length > 1 ? 's' : ''} sélectionné{selectedIds.length > 1 ? 's' : ''}
          </span>
          <div className="space-y-1">
            <Label className="text-xs text-blue-700">Date planifiée</Label>
            <input
              type="date"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
              className="h-8 text-sm border rounded px-2 bg-white"
            />
          </div>
          <Button
            size="sm"
            disabled={bulkScheduleMutation.isPending || selectedIds.length === 0}
            onClick={() => { void applyBulkDate() }}
          >
            {bulkScheduleMutation.isPending
              ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
              : null
            }
            Appliquer à {selectedIds.length} bon{selectedIds.length > 1 ? 's' : ''}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected({})}
          >
            Réinitialiser
          </Button>
        </div>
      )}

      {entitlementsQuery.error && <Alert>{toErrorMessage(entitlementsQuery.error)}</Alert>}
      {bulkScheduleMutation.error && <Alert>{toErrorMessage(bulkScheduleMutation.error)}</Alert>}

      {entitlementsQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked }}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-slate-300"
                />
              </th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Montant TTC</th>
              <th className="px-3 py-2 text-left">Validité</th>
              <th className="px-3 py-2 text-left">Date planifiée</th>
              <th className="px-3 py-2 text-left">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredRows.map((row) => (
              <tr
                key={row.uuid}
                className={selected[row.uuid] ? 'bg-blue-50/60' : 'hover:bg-slate-50/60'}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[row.uuid])}
                    onChange={() => toggleRow(row.uuid)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </td>
                <td className="px-3 py-2">
                  {row.vi_type_code
                    ? <Badge variant="outline" className="font-mono text-xs">{row.vi_type_code}</Badge>
                    : <span className="text-muted-foreground text-xs">—</span>
                  }
                </td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{row.code}</td>
                <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">
                  {row.description ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-mono">
                  {fmtAmount(row.amount_ttc)}
                </td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">
                  {row.validity_date ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <InlineDateCell key={row.uuid} row={row} />
                </td>
                <td className="px-3 py-2">
                  <span className={statusBadgeClass(row.status)}>
                    {STATUS_LABELS[row.status] ?? String(row.status)}
                  </span>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && !entitlementsQuery.isLoading && (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={8}>
                  Aucun bon à planifier.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
