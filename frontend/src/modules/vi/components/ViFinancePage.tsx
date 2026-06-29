/*
    ERP-CLUB - ERP pour Club de vol à voile
    - ViFinancePage: VI flight reconciliation and realization accounting
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
*/

import { useEffect, useState } from 'react'
import {
  CheckCircle2, AlertCircle, Loader2, X, Plus, Archive, Euro,
} from 'lucide-react'
import Decimal from 'decimal.js'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Label } from '../../../components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../../components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { useActiveFiscalYearQuery, useFiscalYearsQuery } from '../../banque/api'
import {
  type ViEntitlement,
  type ViAccountingSummary,
  type ViFlightLinkResponse,
  useViEntitlementsQuery,
  useViTypesQuery,
  useViAccountingSummaryQuery,
  useCreateViRealizationEntryMutation,
  useCancelViRealizationEntryMutation,
  usePatchViAccountingMetaMutation,
  useAddViFlightLinkMutation,
  useRemoveViFlightLinkMutation,
  useArchiveViEntitlementMutation,
} from '../api'
import { useFlightListQuery, type ValidatedFlightItem } from '../../flights/api'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAmount(v: string | null | undefined): string {
  if (v == null) return '—'
  return new Decimal(v).toFixed(2) + ' €'
}

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

function EntryStateBadge({ state }: { state: number | null }) {
  if (state === 1) return <Badge className="badge-warning">Brouillon</Badge>
  if (state === 2) return <Badge className="badge-success">Validé</Badge>
  if (state === 3) return <Badge className="badge-destructive">Annulé</Badge>
  return null
}

function StatusBadge({ status }: { status: number }) {
  const map: Record<number, [string, string]> = {
    1: ['badge-info', 'Chargé'],
    2: ['badge-warning', 'Planifié'],
    3: ['badge-success', 'Réalisé'],
    4: ['badge-destructive', 'Expiré'],
    5: ['outline', 'Annulé'],
    6: ['badge-success', 'Converti'],
  }
  const [cls, label] = map[status] ?? ['outline', '?']
  return <Badge className={cls !== 'outline' ? cls : undefined} variant={cls === 'outline' ? 'outline' : undefined}>{label}</Badge>
}

// ── Flight picker (inline panel inside sheet) ──────────────────────────────

function FlightPicker({
  onPick,
  onClose,
  isPending,
}: {
  onPick: (flightUuid: string) => void
  onClose: () => void
  isPending: boolean
}) {
  const currentYear = new Date().getFullYear()
  const [dateFrom, setDateFrom] = useState(`${currentYear}-01-01`)
  const [dateTo, setDateTo] = useState(`${currentYear}-12-31`)
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(1)

  const flightsQuery = useFlightListQuery(page, 50, {
    type_of_flight: 2,  // INITIATION
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    unlinked_vi: true,
  })

  const allFlights: ValidatedFlightItem[] = flightsQuery.data?.items ?? []
  const totalPages = flightsQuery.data?.total_pages ?? 1

  const flights = searchText.trim()
    ? allFlights.filter((f) => {
        const q = searchText.trim().toLowerCase()
        return (
          f.vi_erp_id?.toLowerCase().includes(q) ||
          f.pilot_name?.toLowerCase().includes(q) ||
          f.observations?.toLowerCase().includes(q) ||
          f.asset_code?.toLowerCase().includes(q)
        )
      })
    : allFlights

  return (
    <div className="rounded-lg border border-outline-variant bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Choisir un vol VI</span>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="h-3 w-3" /></Button>
      </div>

      {/* Filters row */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-[110px]">
          <Label className="text-xs">Du</Label>
          <input
            type="date"
            className="w-full text-xs border rounded px-2 py-1 bg-background"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
          />
        </div>
        <div className="flex-1 min-w-[110px]">
          <Label className="text-xs">Au</Label>
          <input
            type="date"
            className="w-full text-xs border rounded px-2 py-1 bg-background"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <Label className="text-xs">Chercher (bon VI, pilote…)</Label>
          <input
            type="text"
            placeholder="Ex: VI2026-0001"
            className="w-full text-xs border rounded px-2 py-1 bg-background"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {flightsQuery.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />Chargement…
        </div>
      )}

      <div className="rounded border text-xs bg-background overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[80px_60px_1fr_1fr_55px] gap-2 px-3 py-1.5 bg-muted/50 font-medium text-muted-foreground border-b">
          <span>Date</span>
          <span>Aéronef</span>
          <span>Pilote</span>
          <span>Bon VI</span>
          <span className="text-right">Durée</span>
        </div>

        <div className="overflow-y-auto max-h-60 divide-y">
          {flights.length === 0 && !flightsQuery.isLoading && (
            <p className="px-3 py-4 text-center text-muted-foreground">Aucun vol VI trouvé</p>
          )}
          {flights.map((f) => (
            <button
              key={f.uuid}
              type="button"
              disabled={isPending}
              onClick={() => onPick(f.uuid)}
              className="w-full px-3 py-2 text-left hover:bg-muted/60 disabled:opacity-50 space-y-0.5"
            >
              <div className="grid grid-cols-[80px_60px_1fr_1fr_55px] gap-2 items-center">
                <span className="font-mono">{f.jour ?? '—'}</span>
                <span className="font-medium">{f.asset_code ?? '—'}</span>
                <span className="text-muted-foreground truncate">{f.pilot_name ?? '—'}</span>
                <span className="truncate">
                  {f.vi_erp_id
                    ? <span className="font-mono text-blue-600">{f.vi_erp_id}</span>
                    : <span className="text-muted-foreground">—</span>
                  }
                </span>
                <span className="text-right tabular-nums">
                  {parseDuration(f.takeoff_time, f.landing_time)}
                </span>
              </div>
              {f.observations && (
                <div className="text-muted-foreground truncate pl-0.5 italic">
                  {f.observations}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</Button>
          <span className="text-muted-foreground">{page}/{totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>→</Button>
        </div>
      )}
    </div>
  )
}

// ── Flight link row ────────────────────────────────────────────────────────

function FlightLinkRow({
  link,
  entitlementUuid,
  onRemoved,
}: {
  link: ViFlightLinkResponse
  entitlementUuid: string
  onRemoved: () => void
}) {
  const removeMutation = useRemoveViFlightLinkMutation()

  async function handleRemove() {
    await removeMutation.mutateAsync({ entitlementUuid, linkUuid: link.uuid })
    onRemoved()
  }

  const durationText = link.duration_minutes != null
    ? `${Math.floor(link.duration_minutes / 60)}h${String(link.duration_minutes % 60).padStart(2, '0')}`
    : '—'

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30 text-sm">
      <span className="text-xs text-muted-foreground w-5 shrink-0">#{link.sequence}</span>
      <span className="font-mono text-xs">{link.flight_date ?? '—'}</span>
      <span className="font-medium">{link.aircraft_code ?? '—'}</span>
      <span className="text-muted-foreground text-xs">{durationText}</span>
      <div className="ml-auto flex items-center gap-1">
        {link.analytical_entry_uuid && (
          <Badge variant="outline" className="text-xs">Analytique</Badge>
        )}
        {!link.analytical_entry_uuid && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1 text-destructive hover:text-destructive"
            disabled={removeMutation.isPending}
            onClick={() => { void handleRemove() }}
            title="Supprimer ce lien"
          >
            {removeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          </Button>
        )}
      </div>
      {removeMutation.isError && (
        <span className="text-xs text-destructive">{toErrorMessage(removeMutation.error)}</span>
      )}
    </div>
  )
}

// ── Main entitlement sheet ─────────────────────────────────────────────────

function ViEntitlementSheet({
  entitlement,
  open,
  onOpenChange,
}: {
  entitlement: ViEntitlement
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fyQuery = useFiscalYearsQuery()
  const activeFyQuery = useActiveFiscalYearQuery()
  const summaryQuery = useViAccountingSummaryQuery(open ? entitlement.uuid : null)
  const viTypesQuery = useViTypesQuery()

  const createRealizationMutation = useCreateViRealizationEntryMutation()
  const cancelRealizationMutation = useCancelViRealizationEntryMutation()
  const patchMetaMutation = usePatchViAccountingMetaMutation()
  const addFlightLinkMutation = useAddViFlightLinkMutation()
  const archiveMutation = useArchiveViEntitlementMutation()

  const [selectedFyUuid, setSelectedFyUuid] = useState('')
  const [showFlightPicker, setShowFlightPicker] = useState(false)
  const [amountInput, setAmountInput] = useState('')

  const summary: ViAccountingSummary | undefined = summaryQuery.data
  const viType = viTypesQuery.data?.find((t) => t.code === entitlement.vi_type_code)

  // Sync amountInput when summary loads (don't overwrite while user is typing)
  useEffect(() => {
    if (summary?.amount_ttc != null) {
      setAmountInput(new Decimal(summary.amount_ttc).toFixed(2))
    }
  }, [summary?.amount_ttc])
  const activeFyUuid = activeFyQuery.data?.uuid ?? ''
  const effectiveFyUuid = selectedFyUuid || activeFyUuid
  const fiscalYears = (fyQuery.data ?? []).filter((fy) => fy.state !== 2)

  const realization = summary?.realization
  const hasRealization = Boolean(realization?.entry_uuid)
  const isPosted = realization?.state === 2
  const isGeneric = entitlement.is_generic
  const maxFlights = summary?.max_flights ?? 1
  const links = summary?.flight_links ?? []
  const canAddFlight = !isGeneric && links.length < maxFlights && !hasRealization

  const isPending = createRealizationMutation.isPending || cancelRealizationMutation.isPending
    || patchMetaMutation.isPending || addFlightLinkMutation.isPending || archiveMutation.isPending

  async function handleSaveAmount() {
    let parsed: Decimal
    try { parsed = new Decimal(amountInput) } catch { return }
    if (parsed.lte(0)) return
    await patchMetaMutation.mutateAsync({
      entitlementUuid: entitlement.uuid,
      payload: { amount_ttc: parsed.toFixed(4) },
    })
  }

  async function handleAddFlight(flightUuid: string) {
    await addFlightLinkMutation.mutateAsync({ entitlementUuid: entitlement.uuid, payload: { flight_uuid: flightUuid } })
    setShowFlightPicker(false)
  }

  async function handleCreateRealization() {
    await createRealizationMutation.mutateAsync({
      entitlementUuid: entitlement.uuid,
      payload: { fiscal_year_uuid: effectiveFyUuid },
    })
  }

  async function handleCancelRealization() {
    await cancelRealizationMutation.mutateAsync(entitlement.uuid)
  }

  async function handleArchive() {
    const today = new Date().toISOString().slice(0, 10)
    await archiveMutation.mutateAsync({ entitlementUuid: entitlement.uuid, date: today })
    onOpenChange(false)
  }

  const canCreateRealization = !hasRealization && Boolean(effectiveFyUuid) && Boolean(summary?.amount_ttc) && !isGeneric

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            Bon VI — {entitlement.code}
            {entitlement.vi_type_code && (
              <Badge variant="outline" className="font-mono">{entitlement.vi_type_code}</Badge>
            )}
            {isGeneric && <Badge className="badge-info">Générique</Badge>}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 pt-4">
          {summaryQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          )}

          {/* Section 1 — Informations bon */}
          <fieldset className="space-y-3 rounded-lg border border-outline-variant p-4">
            <legend className="text-sm font-medium px-1">Informations bon</legend>

            {/* Editable amount — locked once realization entry is posted */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Montant TTC (€)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex : 90.00"
                  disabled={isPosted || isPending}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-36 h-8 text-sm border rounded px-2 tabular-nums bg-background disabled:opacity-50"
                />
                {!isPosted && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending || !amountInput}
                    onClick={() => { void handleSaveAmount() }}
                  >
                    {patchMetaMutation.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : 'Enregistrer'
                    }
                  </Button>
                )}
                {patchMetaMutation.isSuccess && !patchMetaMutation.isPending && (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
              </div>
              {patchMetaMutation.isError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {toErrorMessage(patchMetaMutation.error)}
                </p>
              )}
            </div>

            {/* Breakdown + buyer (read-only) */}
            {(summary?.insurance_amount || summary?.buyer_member_name) && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {summary?.insurance_amount && (
                  <>
                    <span className="text-muted-foreground">dont assurance</span>
                    <span className="tabular-nums">{fmtAmount(summary.insurance_amount)}</span>
                    <span className="text-muted-foreground">Part vol</span>
                    <span className="tabular-nums">{fmtAmount(summary.flight_portion)}</span>
                  </>
                )}
                {summary?.buyer_member_name && (
                  <>
                    <span className="text-muted-foreground">Acheteur</span>
                    <span>{summary.buyer_member_name}</span>
                  </>
                )}
              </div>
            )}
          </fieldset>

          {/* Section 2 — Vols liés (non-generic only) */}
          {!isGeneric && (
            <fieldset className="space-y-2 rounded-lg border border-outline-variant p-4">
              <legend className="text-sm font-medium px-1 flex items-center gap-2">
                Vols liés
                <span className="text-muted-foreground font-normal">{links.length}/{maxFlights}</span>
              </legend>

              {links.length === 0 && (
                <p className="text-xs text-muted-foreground">Aucun vol associé</p>
              )}
              {links.map((lk) => (
                <FlightLinkRow
                  key={lk.uuid}
                  link={lk}
                  entitlementUuid={entitlement.uuid}
                  onRemoved={() => { void summaryQuery.refetch() }}
                />
              ))}

              {canAddFlight && !showFlightPicker && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowFlightPicker(true)}
                  disabled={isPending}
                >
                  <Plus className="h-3 w-3 mr-1" />Ajouter un vol
                </Button>
              )}

              {showFlightPicker && (
                <FlightPicker
                  onPick={(uuid) => { void handleAddFlight(uuid) }}
                  onClose={() => setShowFlightPicker(false)}
                  isPending={addFlightLinkMutation.isPending}
                />
              )}

              {addFlightLinkMutation.isError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {toErrorMessage(addFlightLinkMutation.error)}
                </p>
              )}

              {hasRealization && !isPosted && (
                <p className="text-xs text-muted-foreground">
                  Vols verrouillés — annulez l'écriture de réalisation pour modifier.
                </p>
              )}
              {hasRealization && isPosted && (
                <p className="text-xs text-muted-foreground">
                  Écriture de réalisation validée — vols non modifiables.
                </p>
              )}
            </fieldset>
          )}

          {/* Section 3 — Écriture de réalisation */}
          {!isGeneric && (
            <fieldset className="space-y-3 rounded-lg border border-outline-variant p-4">
              <legend className="text-sm font-medium px-1">Écriture VI (réalisation)</legend>

              {/* Config warnings */}
              {viType && !viType.client_account_uuid && (
                <p className="text-xs text-destructive">⚠ Compte avances (419100) non configuré sur le type VI.</p>
              )}
              {viType && !viType.revenue_account_uuid && (
                <p className="text-xs text-destructive">⚠ Compte produit (706x) non configuré sur le type VI.</p>
              )}

              {/* Entry preview */}
              <div className="font-mono text-xs space-y-1 bg-muted/40 rounded p-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">D {viType?.client_account_code ?? '419xxx'}</span>
                  <span className="font-semibold">{fmtAmount(summary?.amount_ttc)}</span>
                </div>
                <div className="flex justify-between pl-4">
                  <span className="text-muted-foreground">C {viType?.revenue_account_code ?? '706x'}</span>
                  <span>{fmtAmount(summary?.flight_portion ?? summary?.amount_ttc)}</span>
                </div>
                {viType?.insurance_amount != null && viType.insurance_amount > 0 && (
                  <div className="flex justify-between pl-4">
                    <span className="text-muted-foreground">C {viType.insurance_account_code ?? '401'} (assurance)</span>
                    <span>{fmtAmount(summary?.insurance_amount)}</span>
                  </div>
                )}
              </div>

              {/* Fiscal year + state */}
              {!hasRealization && (
                <div className="space-y-1">
                  <Label className="text-xs">Exercice fiscal</Label>
                  <Select value={selectedFyUuid || activeFyUuid} onValueChange={setSelectedFyUuid}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Sélectionner…" />
                    </SelectTrigger>
                    <SelectContent>
                      {fiscalYears.map((fy) => (
                        <SelectItem key={fy.uuid} value={fy.uuid}>{fy.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {hasRealization && (
                <div className="flex items-center gap-2">
                  <EntryStateBadge state={realization?.state ?? null} />
                  {realization?.entry_date && (
                    <span className="text-xs text-muted-foreground">{realization.entry_date}</span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {!hasRealization && (
                  <Button
                    size="sm"
                    onClick={() => { void handleCreateRealization() }}
                    disabled={!canCreateRealization || isPending}
                  >
                    {createRealizationMutation.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      : <Euro className="h-3 w-3 mr-1" />
                    }
                    Créer l'écriture VI
                  </Button>
                )}
                {hasRealization && !isPosted && entitlement.status !== 6 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => { void handleCancelRealization() }}
                    disabled={isPending}
                  >
                    {cancelRealizationMutation.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      : <X className="h-3 w-3 mr-1" />
                    }
                    Annuler l'écriture
                  </Button>
                )}
                {hasRealization && isPosted && entitlement.status !== 6 && (
                  <p className="text-xs text-muted-foreground">Écriture validée — annulation via le module comptabilité.</p>
                )}
                {entitlement.status === 6 && (
                  <p className="text-xs text-muted-foreground">Bon converti — écriture de réalisation non annulable.</p>
                )}
              </div>

              {createRealizationMutation.isError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {toErrorMessage(createRealizationMutation.error)}
                </p>
              )}
              {cancelRealizationMutation.isError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {toErrorMessage(cancelRealizationMutation.error)}
                </p>
              )}
              {createRealizationMutation.isSuccess && !isPending && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Écriture créée
                </p>
              )}
            </fieldset>
          )}

          {isGeneric && (
            <p className="text-sm text-muted-foreground rounded-lg border border-outline-variant p-4">
              Bon générique — pas d'écriture de réalisation individuelle.
              Les vols facturés contre ce bon sont visibles dans le journal VI.
            </p>
          )}

          {/* Section 4 — Archivage */}
          {hasRealization && entitlement.status !== 3 && entitlement.status !== 6 && (
            <fieldset className="space-y-2 rounded-lg border border-outline-variant p-4">
              <legend className="text-sm font-medium px-1">Archivage</legend>
              <p className="text-xs text-muted-foreground">
                Marque le bon comme réalisé (statut Réalisé). Il ne pourra plus être utilisé.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { void handleArchive() }}
                disabled={isPending}
              >
                {archiveMutation.isPending
                  ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  : <Archive className="h-3 w-3 mr-1" />
                }
                Archiver le bon
              </Button>
              {archiveMutation.isError && (
                <p className="text-xs text-destructive">{toErrorMessage(archiveMutation.error)}</p>
              )}
            </fieldset>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<number, string> = {
  1: 'Chargé',
  2: 'Planifié',
  3: 'Réalisé',
  4: 'Expiré',
  5: 'Annulé',
  6: 'Converti',
}

export function ViFinancePage() {
  const entitlementsQuery = useViEntitlementsQuery()
  const [selectedEntitlement, setSelectedEntitlement] = useState<ViEntitlement | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [search, setSearch] = useState('')

  const allRows = entitlementsQuery.data ?? []

  const statusRows = (() => {
    if (statusFilter === 'active') return allRows.filter((r) => r.status <= 2)
    if (statusFilter === 'all') return allRows
    const n = Number(statusFilter)
    return allRows.filter((r) => r.status === n)
  })()

  const rows = search.trim()
    ? statusRows.filter((r) => {
        const q = search.trim().toLowerCase()
        return r.code.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)
      })
    : statusRows

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">Réconciliation & Réalisations VI</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Associez les vols aux bons et créez les écritures VI (D 419 / C 706x + C 401).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Filtrer par code ou description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm border rounded px-3 py-1 bg-background w-56"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 text-sm border rounded px-2 bg-background"
          >
            <option value="active">Actifs (Chargé + Planifié)</option>
            <option value="all">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {entitlementsQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Vols</th>
              <th className="px-3 py-2 text-left">Statut</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => {
              const isMuted = row.status === 3 || row.status === 6
              return (
                <tr
                  key={row.uuid}
                  className={isMuted ? 'opacity-50' : undefined}
                >
                  <td className="px-3 py-2 font-mono">
                    {row.code}
                    {row.is_generic && (
                      <Badge className="badge-info ml-2 text-xs">Générique</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.vi_type_code && (
                      <Badge variant="outline" className="font-mono">{row.vi_type_code}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">
                    {row.description ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {row.is_generic ? (
                      <Badge variant="outline" className="text-xs">Générique</Badge>
                    ) : row.flight_link_count > 0 ? (
                      <Badge className="badge-success text-xs">{row.flight_link_count} vol{row.flight_link_count > 1 ? 's' : ''}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedEntitlement(row)}
                    >
                      Ouvrir
                    </Button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && !entitlementsQuery.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">
                  Aucun bon VI{statusFilter === 'active' ? ' actif' : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedEntitlement && (
        <ViEntitlementSheet
          entitlement={selectedEntitlement}
          open={Boolean(selectedEntitlement)}
          onOpenChange={(open) => { if (!open) setSelectedEntitlement(null) }}
        />
      )}
    </section>
  )
}
