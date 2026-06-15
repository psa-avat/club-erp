/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Planning page for bulk scheduling and list view
    Copyright (C) 2026  SAFORCADA Patrick
*/

import { useMemo, useState } from 'react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { useBulkScheduleViMutation, useViEntitlementsQuery } from '../api'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    const detail = response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }
  }
  return 'Unexpected error'
}

export function ViPlanningPage() {
  const entitlementsQuery = useViEntitlementsQuery()
  const bulkScheduleMutation = useBulkScheduleViMutation()

  const [scheduledDate, setScheduledDate] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const rows = useMemo(
    () => (entitlementsQuery.data ?? []).filter((row) => row.status === 1 || row.status === 2),
    [entitlementsQuery.data],
  )

  const selectedIds = useMemo(
    () => rows.filter((row) => selected[row.uuid]).map((row) => row.uuid),
    [rows, selected],
  )

  async function applyBulkSchedule() {
    await bulkScheduleMutation.mutateAsync({
      entitlement_uuids: selectedIds,
      scheduled_date: scheduledDate || null,
    })
  }

  function toggleRow(uuid: string) {
    setSelected((current) => ({ ...current, [uuid]: !current[uuid] }))
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-4 rounded-xl border border-outline-variant bg-surface p-6 md:grid-cols-[1fr_auto_auto] md:items-end">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="vi-planning-date">Date planifiée</label>
          <Input id="vi-planning-date" type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
        </div>
        <Button disabled={bulkScheduleMutation.isPending || selectedIds.length === 0} onClick={() => { void applyBulkSchedule() }}>
          Appliquer à {selectedIds.length} droit(s)
        </Button>
        <Button variant="secondary" onClick={() => setSelected({})}>Réinitialiser sélection</Button>
      </div>

      {entitlementsQuery.error ? <Alert>{toErrorMessage(entitlementsQuery.error)}</Alert> : null}
      {bulkScheduleMutation.error ? <Alert>{toErrorMessage(bulkScheduleMutation.error)}</Alert> : null}

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Sel</th>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Planifié</th>
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr key={row.uuid}>
                <td className="px-3 py-2">
                  <input checked={Boolean(selected[row.uuid])} type="checkbox" onChange={() => toggleRow(row.uuid)} />
                </td>
                <td className="px-3 py-2">{row.code}</td>
                <td className="px-3 py-2">{row.status === 1 ? 'Chargé' : 'Planifié'}</td>
                <td className="px-3 py-2">{row.scheduled_date ?? '-'}</td>
                <td className="px-3 py-2">{row.notes ?? '-'}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>Aucun droit à planifier.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
