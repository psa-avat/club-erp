/*
    ERP-CLUB - ERP pour Club de vol à voile
    - OpsFlightsTab: Daily operations flights billing cockpit
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
import { useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Play, Send, RotateCw, Eye, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Alert } from '../../../components/ui/alert'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import {
  useBillableFlightsQuery,
  useFlightBillingPreviewMutation,
  useFlightBillingBatchPreviewMutation,
  useFlightBillingBatchApplyMutation,
  type FlightBillingPreviewResponse,
  type FlightBillingBatchPreviewResponse,
  type BillableFlight,
} from '../api'

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDecimal(value: string | number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return numeric.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function formatMoney(amount: string | number | null | undefined): string {
  const formatted = formatDecimal(amount, 2)
  return formatted === '—' ? formatted : `${formatted} EUR`
}

function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 12) : '—'
}

// ── Preview Panel (full detail, matching FlightsPage) ────────────────────

interface FlightPreviewPanelProps {
  preview: FlightBillingPreviewResponse
  flight?: BillableFlight
}

function FlightPreviewPanel({ preview }: FlightPreviewPanelProps) {
  const blockingErrors = preview.errors.filter((e) => e.blocking)

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Aperçu facturation
          </p>
          <p className="text-sm font-medium text-slate-900">
            {preview.flight_date ?? '-'} · {preview.type_label ?? preview.type_of_flight ?? '-'}
          </p>
          <p className="text-xs text-slate-400">Hash: {shortHash(preview.billing_hash)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
          <p className="text-lg font-semibold text-slate-900">{formatMoney(preview.total_amount)}</p>
          <p className={`text-xs ${preview.can_apply ? 'text-emerald-700' : 'text-amber-700'}`}>
            {preview.no_bill ? 'Non facturable' : preview.can_apply ? 'Prêt à appliquer' : 'Blocages'}
          </p>
        </div>
      </div>

      {/* Errors & warnings */}
      {(blockingErrors.length > 0 || preview.warnings.length > 0) && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {blockingErrors.length > 0 && (
            <Alert>
              <span className="font-semibold">Erreurs</span>
              <ul className="mt-1 space-y-1">
                {blockingErrors.map((err) => (
                  <li key={`${err.scope}-${err.code}-${err.message}`} className="text-xs">{err.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          {preview.warnings.length > 0 && (
            <Alert>
              <span className="font-semibold">Avertissements</span>
              <ul className="mt-1 space-y-1">
                {preview.warnings.map((w) => (
                  <li key={`${w.scope}-${w.code}-${w.message}`} className="text-xs">{w.message}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      {/* Payers & applied lines */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-slate-900">Payeurs</h3>
          <div className="mt-2 space-y-2">
            {preview.payers.length === 0 ? (
              <p className="text-sm text-slate-500">Aucun payeur</p>
            ) : preview.payers.map((payer) => (
              <div key={`${payer.role}-${payer.member_uuid}`} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{payer.member_name ?? payer.member_account_id ?? '—'}</p>
                  <p className="text-xs text-slate-500">{payer.role} · {payer.reason}</p>
                </div>
                <span className="text-slate-700">{formatDecimal(Number(payer.share) * 100, 0)}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Article</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Payeur</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">Qté</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">PU</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">Forfait</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">Montant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.applied_lines.map((line, index) => (
                <tr key={`${line.pricing_item_uuid}-${line.payer_member_uuid}-${index}`}>
                  <td className="px-3 py-2 text-slate-800">{line.pricing_item_name ?? '—'}<br /><span className="text-slate-500">{line.source} · {line.asset_code ?? '—'}</span></td>
                  <td className="px-3 py-2 text-slate-700">{line.payer_member_account_id ?? line.payer_role}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatDecimal(line.quantity, 4)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatMoney(line.applied_unit_price)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{line.discount_reason ? formatDecimal(line.pack_hours_used, 2) : '—'}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-900">{formatMoney(line.amount)}</td>
                </tr>
              ))}
              {preview.applied_lines.length === 0 && (
                <tr><td className="px-3 py-5 text-center text-slate-500" colSpan={6}>Aucune ligne</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Accounting lines */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Compte</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Membre</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Description</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Débit</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Crédit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.accounting_lines.map((line, index) => (
              <tr key={`${line.side}-${line.account_code}-${index}`}>
                <td className="px-3 py-2 text-slate-800">{line.account_code ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{line.member_account_id_snapshot ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{line.description ?? '—'}</td>
                <td className="px-3 py-2 text-right text-slate-700">{Number(line.debit) > 0 ? formatMoney(line.debit) : '—'}</td>
                <td className="px-3 py-2 text-right text-slate-700">{Number(line.credit) > 0 ? formatMoney(line.credit) : '—'}</td>
              </tr>
            ))}
            {preview.accounting_lines.length === 0 && (
              <tr><td className="px-3 py-5 text-center text-slate-500" colSpan={5}>Aucune ligne</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────

export function OpsFlightsTab() {
  const { t } = useTranslation(['banque', 'common'])
  const canEditFlights = useCapability('EDIT_FLIGHTS')
  const canManagePrices = useCapability('MANAGE_PRICES')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedFlight, setExpandedFlight] = useState<string | null>(null)
  const [flightPreviews, setFlightPreviews] = useState<Record<string, FlightBillingPreviewResponse>>({})
  const [batchPreview, setBatchPreview] = useState<FlightBillingBatchPreviewResponse | null>(null)

  const { data: flights = [], isLoading, refetch } = useBillableFlightsQuery(
    dateFrom || undefined,
    dateTo || undefined,
    true,
  )

  const previewMutation = useFlightBillingPreviewMutation()
  const batchPreviewMutation = useFlightBillingBatchPreviewMutation()
  const batchApplyMutation = useFlightBillingBatchApplyMutation()

  // ── Handlers ──────────────────────────────────────────────────────────

  function toggleExpand(flight: BillableFlight) {
    const willExpand = expandedFlight !== flight.uuid
    setExpandedFlight(willExpand ? flight.uuid : null)

    // Auto-load preview on expand if not already loaded
    if (willExpand && !flightPreviews[flight.uuid]) {
      previewMutation.mutate({ flightUuid: flight.uuid, fiscalYearUuid: activeFiscalYearUuid }, {
        onSuccess: (data) => {
          setFlightPreviews((prev) => ({ ...prev, [flight.uuid]: data }))
        },
      })
    }
  }

  function handleRowPreview(flight: BillableFlight) {
    // Always expand the row first
    setExpandedFlight(flight.uuid)

    if (flightPreviews[flight.uuid]) {
      // Already loaded → stay expanded, preview visible
      return
    }
    // Load preview data
    previewMutation.mutate({ flightUuid: flight.uuid, fiscalYearUuid: activeFiscalYearUuid }, {
      onSuccess: (data) => {
        setFlightPreviews((prev) => ({ ...prev, [flight.uuid]: data }))
      },
    })
  }

  function handleBatchPreview() {
    batchPreviewMutation.mutate(
      {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        fiscal_year_uuid: activeFiscalYearUuid,
      },
      {
        onSuccess: setBatchPreview,
      },
    )
  }

  function handleBatchApply() {
    if (!activeFiscalYearUuid) return
    const uuids = flights.map((f) => f.uuid)
    batchApplyMutation.mutate(
      {
        flight_uuids: uuids,
        fiscal_year_uuid: activeFiscalYearUuid,
      },
      {
        onSuccess: () => {
          setBatchPreview(null)
          setFlightPreviews({})
        },
      },
    )
  }

  // ── Derived state ─────────────────────────────────────────────────────

  const isPreviewing = previewMutation.isPending
  const isBatchPreviewing = batchPreviewMutation.isPending
  const isApplying = batchApplyMutation.isPending
  const busy = isLoading || isPreviewing || isBatchPreviewing || isApplying

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="h-8 rounded-lg border border-slate-300 px-2 text-sm"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span className="text-xs text-slate-400">→</span>
          <input
            type="date"
            className="h-8 rounded-lg border border-slate-300 px-2 text-sm"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetch()}
            disabled={busy}
            title="Rafraîchir"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {(canEditFlights || canManagePrices) && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || flights.length === 0}
              onClick={handleBatchPreview}
            >
              {isBatchPreviewing ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="mr-1 h-3.5 w-3.5" />
              )}
              {t('ops.flights.preview')}
            </Button>
          )}
          {canEditFlights && canPost && (
            <Button
              size="sm"
              disabled={busy || flights.length === 0 || !activeFiscalYearUuid}
              onClick={handleBatchApply}
            >
              {isApplying ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1 h-3.5 w-3.5" />
              )}
              {t('ops.flights.apply')}
            </Button>
          )}
        </div>
      </div>

      {/* Batch preview result */}
      {batchPreview && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {t('ops.flights.batchPreview.title', { count: batchPreview.total })}
              </p>
              <p className="text-xs text-slate-500">
                {batchPreview.billable_count} {t('ops.flights.batchPreview.billable')}{batchPreview.billable_count > 1 ? 's' : ''}
                {batchPreview.error_count > 0 && (
                  <span className="ml-2 text-amber-600">
                    <AlertTriangle className="inline h-3 w-3" /> {batchPreview.error_count} {t('ops.flights.batchPreview.errors')}{batchPreview.error_count > 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-slate-900">{formatMoney(batchPreview.total_amount)}</p>
            </div>
          </div>
          {batchPreview.total_amount !== '0' && canPost && activeFiscalYearUuid && (
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={handleBatchApply} disabled={isApplying}>
                {isApplying ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                {t('ops.flights.batchPreview.applyAll')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Batch apply result */}
      {batchApplyMutation.data && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-900">
              {t('ops.flights.success.applied', { count: batchApplyMutation.data.success_count })}
            </p>
            {batchApplyMutation.data.error_count > 0 && (
              <p className="text-sm text-amber-700">
                ({batchApplyMutation.data.error_count} erreur{batchApplyMutation.data.error_count > 1 ? 's' : ''})
              </p>
            )}
          </div>
        </div>
      )}

      {/* Flights table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            <span className="ml-2 text-sm text-slate-400">{t('common.loading')}</span>
          </div>
        ) : flights.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center">
            <p className="text-sm text-slate-400">{t('ops.flights.empty')}</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3 font-medium text-slate-600">Date</th>
                <th className="px-4 py-3 font-medium text-slate-600">Pilote</th>
                <th className="px-4 py-3 font-medium text-slate-600">Second / Charge à</th>
                <th className="px-4 py-3 font-medium text-slate-600">Machine</th>
                <th className="px-4 py-3 font-medium text-slate-600">Type</th>
                <th className="px-4 py-3 font-medium text-slate-600">Total</th>
                <th className="px-4 py-3 font-medium text-slate-600">Statut</th>
                <th className="px-4 py-3 font-medium text-slate-600">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <Fragment key={f.uuid}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                        onClick={() => toggleExpand(f)}
                      >
                        {expandedFlight === f.uuid ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{f.jour ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{f.pilot_name ?? f.pilot_erp_id ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {f.second_pilot_name && <span>2nd: {f.second_pilot_name}</span>}
                      {f.second_pilot_name && f.charge_to_name && <span className="mx-1">·</span>}
                      {f.charge_to_name && <span>Fact: {f.charge_to_name}</span>}
                      {!f.second_pilot_name && !f.charge_to_name && <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{f.asset_code ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {f.type_label ?? String(f.type_of_flight ?? '—')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-slate-900">
                      {f.total_preview ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        f.status === 'posted' ? 'bg-green-100 text-green-700' :
                        f.status === 'applied' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {f.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {canEditFlights && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40"
                            title="Aperçu facturation"
                            disabled={isPreviewing && previewMutation.variables?.flightUuid === f.uuid}
                            onClick={() => handleRowPreview(f)}
                          >
                            {isPreviewing && previewMutation.variables?.flightUuid === f.uuid ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedFlight === f.uuid && (
                    <tr>
                      <td colSpan={9} className="bg-slate-50/50 px-6 py-4">
                        {/* Flight comments & modification reason */}
                        {(f.observations || f.correction_reason) && (
                          <div className="mb-3 flex flex-wrap gap-3">
                            {f.observations && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700" title={f.observations}>
                                💬 {f.observations.length > 50 ? f.observations.slice(0, 50) + '…' : f.observations}
                              </span>
                            )}
                            {f.correction_reason && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700" title={f.correction_reason}>
                                ✏️ Corr.: {f.correction_reason.length > 50 ? f.correction_reason.slice(0, 50) + '…' : f.correction_reason}
                              </span>
                            )}
                          </div>
                        )}

                        {previewMutation.error && previewMutation.variables?.flightUuid === f.uuid ? (
                          <Alert>
                            <p className="text-sm text-red-700">
                              {previewMutation.error instanceof Error ? previewMutation.error.message : t('ops.flights.errors.preview')}
                            </p>
                          </Alert>
                        ) : flightPreviews[f.uuid] ? (
                          <FlightPreviewPanel
                            preview={flightPreviews[f.uuid]}
                            flight={f}
                          />
                        ) : (
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Chargement de l'aperçu…
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Global errors */}
      {batchPreviewMutation.error && (
        <Alert>
          <p className="text-sm text-red-700">
            {batchPreviewMutation.error instanceof Error ? batchPreviewMutation.error.message : t('ops.flights.errors.preview')}
          </p>
        </Alert>
      )}
      {batchApplyMutation.error && (
        <Alert>
          <p className="text-sm text-red-700">
            {batchApplyMutation.error instanceof Error ? batchApplyMutation.error.message : t('ops.flights.errors.apply')}
          </p>
        </Alert>
      )}
    </div>
  )
}
