/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - planche: VI sync and reconciliation page
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
import { AlertCircle, ArrowUpFromLine, CheckCircle2, GitMerge, Loader2 } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { useViEntitlementsQuery } from '../../vi/api'
import { usePlancheViPushMutation, usePlancheViReconcileMutation } from '../api'

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
  try { return parseFloat(v).toFixed(2) + ' €' } catch { return v }
}

export function PlancheViSyncPage() {
  const entitlementsQuery = useViEntitlementsQuery(2)
  const pushMutation = usePlancheViPushMutation()
  const reconcileMutation = usePlancheViReconcileMutation()

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [replace, setReplace] = useState(false)

  const rows = useMemo(
    () => (entitlementsQuery.data ?? []).filter((r) => !r.is_generic),
    [entitlementsQuery.data],
  )

  const selectedIds = useMemo(
    () => rows.filter((r) => selected[r.uuid]).map((r) => r.uuid),
    [rows, selected],
  )

  const allChecked = rows.length > 0 && rows.every((r) => selected[r.uuid])
  const someChecked = rows.some((r) => selected[r.uuid])

  function toggleAll() {
    if (allChecked) {
      setSelected({})
    } else {
      const next: Record<string, boolean> = {}
      rows.forEach((r) => { next[r.uuid] = true })
      setSelected(next)
    }
  }

  function toggleRow(uuid: string) {
    setSelected((prev) => ({ ...prev, [uuid]: !prev[uuid] }))
  }

  async function runPush() {
    await pushMutation.mutateAsync({ entitlement_uuids: selectedIds, replace })
    setSelected({})
  }

  async function runReconcile() {
    await reconcileMutation.mutateAsync({})
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">Synchronisation Planche — Bons VI</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Poussez les bons planifiés vers Planche et rapprochez les références de vols.
          </p>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-outline-variant bg-surface px-4 py-3">
        <Button
          disabled={selectedIds.length === 0 || pushMutation.isPending}
          onClick={() => { void runPush() }}
        >
          {pushMutation.isPending
            ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            : <ArrowUpFromLine className="h-4 w-4 mr-1.5" />
          }
          Pousser vers Planche ({selectedIds.length})
        </Button>

        <Button
          variant="secondary"
          disabled={reconcileMutation.isPending}
          onClick={() => { void runReconcile() }}
        >
          {reconcileMutation.isPending
            ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            : <GitMerge className="h-4 w-4 mr-1.5" />
          }
          Rapprocher depuis vols validés
        </Button>

        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none ml-auto">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Écraser les données existantes sur Planche
        </label>
      </div>

      {/* Push result */}
      {pushMutation.data && (
        <div className="flex items-start gap-3 rounded-lg border border-outline-variant bg-slate-50 p-3 text-sm">
          {pushMutation.data.failed_count > 0
            ? <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            : <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
          }
          <div className="space-y-0.5">
            <p className="font-medium">Résultat de l'envoi</p>
            <p className="text-muted-foreground">
              {pushMutation.data.pushed_count} envoyé{pushMutation.data.pushed_count > 1 ? 's' : ''}
              {pushMutation.data.failed_count > 0 && (
                <span className="text-destructive ml-2">
                  · {pushMutation.data.failed_count} échec{pushMutation.data.failed_count > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Reconcile result */}
      {reconcileMutation.data && (
        <div className="flex items-start gap-3 rounded-lg border border-outline-variant bg-slate-50 p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium">Résultat du rapprochement</p>
            <p className="text-muted-foreground">
              {reconcileMutation.data.total} vol{reconcileMutation.data.total > 1 ? 's' : ''} analysé{reconcileMutation.data.total > 1 ? 's' : ''}
              · {reconcileMutation.data.updated} droit{reconcileMutation.data.updated > 1 ? 's' : ''} mis à jour
              {reconcileMutation.data.unmatched > 0 && (
                <span className="text-amber-600 ml-2">
                  · {reconcileMutation.data.unmatched} référence{reconcileMutation.data.unmatched > 1 ? 's' : ''} non trouvée{reconcileMutation.data.unmatched > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {entitlementsQuery.error && <Alert>{toErrorMessage(entitlementsQuery.error)}</Alert>}
      {pushMutation.error && <Alert>{toErrorMessage(pushMutation.error)}</Alert>}
      {reconcileMutation.error && <Alert>{toErrorMessage(reconcileMutation.error)}</Alert>}

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
              <th className="px-3 py-2 text-left">Date planifiée</th>
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
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
                <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">
                  {row.description ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-mono">
                  {fmtAmount(row.amount_ttc)}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {row.scheduled_date ?? '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">
                  {row.notes ?? '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !entitlementsQuery.isLoading && (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>
                  Aucun bon planifié à pousser.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
