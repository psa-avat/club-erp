/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - planche: VI sync page — push ERP vouchers to Planche, check presence
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
import { AlertCircle, ArrowUpFromLine, CheckCircle2, Loader2, RefreshCw, Search, X } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { useViEntitlementsQuery } from '../../vi/api'
import { usePlancheViListQuery, usePlancheViPushMutation } from '../api'

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
  const entitlementsQuery = useViEntitlementsQuery()
  const pushMutation = usePlancheViPushMutation()
  const plancheListQuery = usePlancheViListQuery()

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [replace, setReplace] = useState(false)
  const [nameFilter, setNameFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'generic' | 'loaded' | 'scheduled' | null>(null)

  // All active vouchers: generics + Chargé (1) + Planifié (2)
  const rows = useMemo(
    () => (entitlementsQuery.data ?? []).filter(
      (r) => r.is_generic || r.status === 1 || r.status === 2,
    ),
    [entitlementsQuery.data],
  )

  // Rows after applying name search and status display filter
  const visibleRows = useMemo(() => {
    let result = rows
    const q = nameFilter.trim().toLowerCase()
    if (q) {
      result = result.filter((r) =>
        r.code.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.notes?.toLowerCase().includes(q),
      )
    }
    if (statusFilter === 'generic') result = result.filter((r) => r.is_generic)
    else if (statusFilter === 'loaded') result = result.filter((r) => !r.is_generic && r.status === 1)
    else if (statusFilter === 'scheduled') result = result.filter((r) => !r.is_generic && r.status === 2)
    return result
  }, [rows, nameFilter, statusFilter])

  // Set of ERP codes currently present on Planche
  const plancheCodes = useMemo(
    () => new Set(plancheListQuery.data?.codes ?? []),
    [plancheListQuery.data],
  )

  // Auto-select all rows when data first loads
  useEffect(() => {
    if (rows.length > 0) {
      setSelected((prev) => {
        const next: Record<string, boolean> = { ...prev }
        let changed = false
        rows.forEach((r) => {
          if (!(r.uuid in next)) { next[r.uuid] = true; changed = true }
        })
        return changed ? next : prev
      })
    }
  }, [rows])

  const selectedIds = useMemo(
    () => rows.filter((r) => selected[r.uuid]).map((r) => r.uuid),
    [rows, selected],
  )

  const allChecked = visibleRows.length > 0 && visibleRows.every((r) => selected[r.uuid])
  const someChecked = visibleRows.some((r) => selected[r.uuid])

  function toggleAll() {
    if (allChecked) {
      const next = { ...selected }
      visibleRows.forEach((r) => { next[r.uuid] = false })
      setSelected(next)
    } else {
      const next = { ...selected }
      visibleRows.forEach((r) => { next[r.uuid] = true })
      setSelected(next)
    }
  }

  function toggleRow(uuid: string) {
    setSelected((prev) => ({ ...prev, [uuid]: !prev[uuid] }))
  }

  function toggleStatusFilter(value: 'generic' | 'loaded' | 'scheduled') {
    setStatusFilter((prev) => (prev === value ? null : value))
  }

  async function runPush() {
    await pushMutation.mutateAsync({ entitlement_uuids: selectedIds, replace })
    setSelected({})
    void plancheListQuery.refetch()
  }

  const countGeneric   = rows.filter((r) => r.is_generic).length
  const countLoaded    = rows.filter((r) => !r.is_generic && r.status === 1).length
  const countScheduled = rows.filter((r) => !r.is_generic && r.status === 2).length

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">Synchronisation Planche — Bons VI</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Poussez les bons vers Planche.
            {plancheListQuery.data && (
              <span className="ml-1 text-xs">
                · {plancheListQuery.data.codes.length} déjà présent{plancheListQuery.data.codes.length > 1 ? 's' : ''} sur Planche
              </span>
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={plancheListQuery.isFetching}
          onClick={() => void plancheListQuery.refetch()}
          title="Rafraîchir la liste Planche"
        >
          <RefreshCw className={['h-3.5 w-3.5 mr-1', plancheListQuery.isFetching ? 'animate-spin' : ''].join(' ')} />
          Vérifier Planche
        </Button>
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

      {/* Search + display filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Name search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="Rechercher par code, description…"
            className="h-8 w-full rounded-md border border-slate-300 bg-white pl-8 pr-7 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {nameFilter && (
            <button
              type="button"
              onClick={() => setNameFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status display filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Afficher :</span>
          <button
            type="button"
            className={[
              'px-2 py-0.5 rounded border transition-colors',
              statusFilter === 'generic'
                ? 'border-slate-500 bg-slate-200 text-slate-800 font-medium'
                : 'border-slate-300 hover:bg-slate-100',
            ].join(' ')}
            onClick={() => toggleStatusFilter('generic')}
          >
            Génériques ({countGeneric})
          </button>
          <button
            type="button"
            className={[
              'px-2 py-0.5 rounded border transition-colors',
              statusFilter === 'loaded'
                ? 'border-blue-500 bg-blue-100 text-blue-800 font-medium'
                : 'border-blue-300 text-blue-700 hover:bg-blue-50',
            ].join(' ')}
            onClick={() => toggleStatusFilter('loaded')}
          >
            Chargés ({countLoaded})
          </button>
          <button
            type="button"
            className={[
              'px-2 py-0.5 rounded border transition-colors',
              statusFilter === 'scheduled'
                ? 'border-amber-500 bg-amber-100 text-amber-800 font-medium'
                : 'border-amber-300 text-amber-700 hover:bg-amber-50',
            ].join(' ')}
            onClick={() => toggleStatusFilter('scheduled')}
          >
            Planifiés ({countScheduled})
          </button>
          {(statusFilter || nameFilter) && (
            <button
              type="button"
              className="px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-100 transition-colors text-muted-foreground"
              onClick={() => { setStatusFilter(null); setNameFilter('') }}
            >
              Réinitialiser
            </button>
          )}
          <span className="text-muted-foreground ml-1">
            ({visibleRows.length}/{rows.length})
          </span>
        </div>
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

      {entitlementsQuery.error && <Alert>{toErrorMessage(entitlementsQuery.error)}</Alert>}
      {pushMutation.error && <Alert>{toErrorMessage(pushMutation.error)}</Alert>}
      {plancheListQuery.error && (
        <Alert>
          Impossible de vérifier la présence sur Planche : {toErrorMessage(plancheListQuery.error)}
        </Alert>
      )}

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
              <th className="px-3 py-2 text-left">Catégorie</th>
              <th className="px-3 py-2 text-left">Sur Planche</th>
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.map((row) => {
              const onPlanche = plancheCodes.has(row.code)
              return (
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
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {row.scheduled_date ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {row.is_generic
                      ? <Badge variant="secondary" className="text-xs">Générique</Badge>
                      : row.status === 1
                        ? <Badge className="badge-info text-xs">Chargé</Badge>
                        : <Badge className="badge-warning text-xs">Planifié</Badge>
                    }
                  </td>
                  <td className="px-3 py-2">
                    {plancheListQuery.isFetching
                      ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      : plancheListQuery.data
                        ? onPlanche
                          ? <Badge className="badge-success text-xs">✓ Présent</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>
                        : <span className="text-muted-foreground text-xs">?</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">
                    {row.notes ?? '—'}
                  </td>
                </tr>
              )
            })}
            {visibleRows.length === 0 && !entitlementsQuery.isLoading && (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={9}>
                  {rows.length === 0
                    ? 'Aucun bon à synchroniser.'
                    : 'Aucun bon ne correspond aux filtres appliqués.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
