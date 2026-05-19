/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - planche: VI sync and reconciliation page
    Copyright (C) 2026  SAFORCADA Patrick
*/

import { useMemo, useState } from 'react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { useViEntitlementsQuery } from '../../vi/api'
import { usePlancheViPushMutation, usePlancheViReconcileMutation } from '../api'

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

export function PlancheViSyncPage() {
  const entitlementsQuery = useViEntitlementsQuery(2)
  const pushMutation = usePlancheViPushMutation()
  const reconcileMutation = usePlancheViReconcileMutation()

  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const rows = entitlementsQuery.data ?? []
  const selectedIds = useMemo(() => rows.filter((row) => selected[row.uuid]).map((row) => row.uuid), [rows, selected])

  async function runPush() {
    await pushMutation.mutateAsync({ entitlement_uuids: selectedIds })
  }

  async function runReconcile() {
    await reconcileMutation.mutateAsync({})
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-outline-variant bg-surface p-6">
        <h1 className="text-xl font-semibold text-slate-900">Planche VI - Push et rapprochement</h1>
        <p className="text-sm text-slate-600">Sélectionnez des droits planifiés puis poussez vers Planche. Lancez ensuite le rapprochement.</p>
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button disabled={selectedIds.length === 0 || pushMutation.isPending} onClick={() => { void runPush() }}>
            Pousser vers Planche ({selectedIds.length})
          </Button>
          <Button variant="secondary" disabled={reconcileMutation.isPending} onClick={() => { void runReconcile() }}>
            Rapprocher depuis vols validés
          </Button>
        </div>

        {pushMutation.data ? (
          <div className="mb-3 rounded-lg border border-outline-variant bg-slate-50 p-3 text-sm text-slate-700">
            <p>Envoyés: {pushMutation.data.pushed_count}</p>
            <p>Échecs: {pushMutation.data.failed_count}</p>
          </div>
        ) : null}

        {reconcileMutation.data ? (
          <div className="mb-3 rounded-lg border border-outline-variant bg-slate-50 p-3 text-sm text-slate-700">
            <p>Vols analysés: {reconcileMutation.data.total}</p>
            <p>Droits mis à jour: {reconcileMutation.data.updated}</p>
            <p>Références non trouvées: {reconcileMutation.data.unmatched}</p>
          </div>
        ) : null}

        {entitlementsQuery.error ? <Alert>{toErrorMessage(entitlementsQuery.error)}</Alert> : null}
        {pushMutation.error ? <Alert>{toErrorMessage(pushMutation.error)}</Alert> : null}
        {reconcileMutation.error ? <Alert>{toErrorMessage(reconcileMutation.error)}</Alert> : null}

        <div className="overflow-x-auto rounded-xl border border-outline-variant">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Sel</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Date planifiée</th>
                <th className="px-3 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <tr key={row.uuid}>
                  <td className="px-3 py-2">
                    <input checked={Boolean(selected[row.uuid])} type="checkbox" onChange={() => setSelected((current) => ({ ...current, [row.uuid]: !current[row.uuid] }))} />
                  </td>
                  <td className="px-3 py-2">{row.code}</td>
                  <td className="px-3 py-2">{row.scheduled_date ?? '-'}</td>
                  <td className="px-3 py-2">{row.notes ?? '-'}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>Aucun droit planifié à pousser.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
