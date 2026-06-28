/*
    ERP-CLUB - ERP pour Club de vol à voile
    - ViReconciliationPage: Reconcile unlinked initiation flights with VI vouchers
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
*/

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Link2, Loader2 } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { useFlightListQuery, type ValidatedFlightItem } from '../../flights/api'
import {
  type ViEntitlement,
  useViEntitlementsQuery,
  useAddViFlightLinkMutation,
} from '../api'

// ── Helpers ────────────────────────────────────────────────────────────────

function parseDuration(takeoff: string | null, landing: string | null): string {
  if (!takeoff || !landing) return '—'
  try {
    const [th, tm] = takeoff.split(':').map(Number)
    const [lh, lm] = landing.split(':').map(Number)
    const mins = lh * 60 + lm - (th * 60 + tm)
    if (mins <= 0) return '—'
    return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
  } catch {
    return '—'
  }
}

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return 'Erreur inattendue'
}

// ── Voucher picker dialog ─────────────────────────────────────────────────

function VoucherPickerDialog({
  flight,
  open,
  onOpenChange,
  onLinked,
}: {
  flight: ValidatedFlightItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onLinked: () => void
}) {
  const entitlementsQuery = useViEntitlementsQuery()
  const addLinkMutation = useAddViFlightLinkMutation()
  const [selectedUuid, setSelectedUuid] = useState('')
  const [search, setSearch] = useState('')

  // Active non-generic vouchers only (LOADED=1, SCHEDULED=2)
  const candidates: ViEntitlement[] = useMemo(() => {
    return (entitlementsQuery.data ?? []).filter(
      (e) => !e.is_generic && e.status <= 2,
    )
  }, [entitlementsQuery.data])

  // Pre-select voucher if vi_erp_id on the flight matches a code
  useEffect(() => {
    if (!open) return
    setSelectedUuid('')
    setSearch('')
    if (flight.vi_erp_id) {
      const match = candidates.find((e) => e.code === flight.vi_erp_id)
      if (match) setSelectedUuid(match.uuid)
    }
  }, [open, flight.vi_erp_id, candidates])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(
      (e) =>
        e.code.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.vi_type_code?.toLowerCase().includes(q),
    )
  }, [candidates, search])

  async function handleLink() {
    if (!selectedUuid) return
    await addLinkMutation.mutateAsync({
      entitlementUuid: selectedUuid,
      payload: { flight_uuid: flight.uuid },
    })
    onLinked()
  }

  const duration = parseDuration(flight.takeoff_time, flight.landing_time)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Associer un bon VI</DialogTitle>
        </DialogHeader>

        {/* Flight summary */}
        <div className="rounded-lg bg-muted/40 border px-4 py-3 text-sm space-y-1">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-mono">{flight.jour ?? '—'}</span>
            <span className="font-semibold">{flight.asset_code ?? '—'}</span>
            <span className="text-muted-foreground">{flight.pilot_name ?? '—'}</span>
            <span className="ml-auto tabular-nums">{duration}</span>
          </div>
          {flight.vi_erp_id && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Bon Planche :</span>
              <span className="font-mono text-xs text-blue-600">{flight.vi_erp_id}</span>
            </div>
          )}
          {flight.observations && (
            <p className="text-xs text-muted-foreground italic">{flight.observations}</p>
          )}
        </div>

        {/* Voucher search */}
        <div className="space-y-2">
          <Input
            placeholder="Rechercher un bon (code, description…)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm"
          />

          {entitlementsQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Chargement…
            </div>
          )}

          <div className="overflow-y-auto max-h-64 rounded border divide-y bg-background">
            {filtered.length === 0 && !entitlementsQuery.isLoading && (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                Aucun bon VI actif trouvé
              </p>
            )}
            {filtered.map((e) => {
              const isSelected = e.uuid === selectedUuid
              return (
                <button
                  key={e.uuid}
                  type="button"
                  onClick={() => setSelectedUuid(e.uuid)}
                  className={[
                    'w-full flex items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors',
                    isSelected
                      ? 'bg-primary/10 border-l-2 border-primary'
                      : 'hover:bg-muted/50',
                  ].join(' ')}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{e.code}</span>
                      {e.vi_type_code && (
                        <Badge variant="outline" className="text-xs font-mono">{e.vi_type_code}</Badge>
                      )}
                      {e.status === 2 && (
                        <Badge className="badge-warning text-xs">Planifié</Badge>
                      )}
                    </div>
                    {e.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{e.description}</p>
                    )}
                    {e.scheduled_date && (
                      <p className="text-xs text-muted-foreground">{e.scheduled_date}</p>
                    )}
                  </div>
                  {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                </button>
              )
            })}
          </div>
        </div>

        {addLinkMutation.isError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {toErrorMessage(addLinkMutation.error)}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => { void handleLink() }}
            disabled={!selectedUuid || addLinkMutation.isPending}
          >
            {addLinkMutation.isPending
              ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
              : <Link2 className="h-3 w-3 mr-1" />
            }
            Associer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export function ViReconciliationPage() {
  const [showAll, setShowAll] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedFlight, setSelectedFlight] = useState<ValidatedFlightItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const flightsQuery = useFlightListQuery(page, 50, {
    type_of_flight: 2,
    unlinked_vi: !showAll,
  })

  const flights = flightsQuery.data?.items ?? []
  const totalPages = flightsQuery.data?.total_pages ?? 1
  const total = flightsQuery.data?.total ?? 0

  function openDialog(flight: ValidatedFlightItem) {
    setSelectedFlight(flight)
    setDialogOpen(true)
  }

  function handleLinked() {
    setDialogOpen(false)
    void flightsQuery.refetch()
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">Réconciliation des vols d'initiation</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Associez chaque vol d'initiation à son bon VI.
            {total > 0 && (
              <span className="ml-1 font-medium">{total} vol{total > 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => { setShowAll(e.target.checked); setPage(1) }}
          />
          Afficher tous les vols d'initiation
        </label>
      </div>

      {flightsQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Pilote</th>
              <th className="px-3 py-2 text-left">Machine</th>
              <th className="px-3 py-2 text-left">Bon VI (Planche)</th>
              <th className="px-3 py-2 text-left">Observations</th>
              <th className="px-3 py-2 text-left">Durée</th>
              <th className="px-3 py-2 text-left"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {flights.map((f) => {
              const duration = parseDuration(f.takeoff_time, f.landing_time)
              return (
                <tr key={f.uuid} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{f.jour ?? '—'}</td>
                  <td className="px-3 py-2">{f.pilot_name ?? '—'}</td>
                  <td className="px-3 py-2 font-medium">{f.asset_code ?? '—'}</td>
                  <td className="px-3 py-2">
                    {f.vi_erp_id
                      ? <span className="font-mono text-blue-600">{f.vi_erp_id}</span>
                      : <span className="text-muted-foreground">—</span>
                    }
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">
                    {f.observations ?? '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{duration}</td>
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDialog(f)}
                    >
                      <Link2 className="h-3 w-3 mr-1" />
                      Associer
                    </Button>
                  </td>
                </tr>
              )
            })}
            {flights.length === 0 && !flightsQuery.isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-sm">
                  {showAll
                    ? "Aucun vol d'initiation trouvé"
                    : "Tous les vols d'initiation sont réconciliés"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Précédent
          </Button>
          <span className="text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Suivant →
          </Button>
        </div>
      )}

      {selectedFlight && (
        <VoucherPickerDialog
          flight={selectedFlight}
          open={dialogOpen}
          onOpenChange={(open) => { if (!open) setDialogOpen(false) }}
          onLinked={handleLinked}
        />
      )}
    </section>
  )
}
