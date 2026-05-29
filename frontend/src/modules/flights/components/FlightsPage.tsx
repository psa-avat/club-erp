/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - flights: Flights page with validated flight listing and Planche import
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
import { Calculator } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'

import {
  useFlightBillingPreviewMutation,
  useFlightListQuery,
  type FlightBillingPreviewResponse,
  type FlightListFilters,
  type ValidatedFlightItem,
} from '../api'

const FLIGHT_TYPE_LABELS: Record<number, string> = {
  0: 'Instruction',
  1: 'Solo',
  2: 'Initiation',
  3: 'Partage',
  4: 'Passager',
  5: 'Lâcher',
  6: 'Supervisé',
  7: 'Essai',
}

/** Flight types where second pilot should show as trigram instead of name. */
const TRIGRAM_FLIGHT_TYPES = new Set([0, 5, 6]) // Instruction, Lâcher, Supervisé

function formatFlightType(value: number | null): string {
  if (value === null || value === undefined) return '-'
  return FLIGHT_TYPE_LABELS[value] ?? `Type ${value}`
}

function formatSecondPilot(flight: ValidatedFlightItem): string {
  if (!flight.second_pilot_erp_id) return '-'
  // Lâcher (5), Supervisé (6), Instruction (0) → show trigram, else name
  if (flight.type_of_flight !== null && TRIGRAM_FLIGHT_TYPES.has(flight.type_of_flight)) {
    return flight.second_pilot_trigram ?? flight.second_pilot_name ?? flight.second_pilot_erp_id
  }
  return flight.second_pilot_name ?? flight.second_pilot_erp_id
}

function formatDuration(takeoff: string, landing: string): string {
  const [th, tm] = takeoff.split(':').map(Number)
  const [lh, lm] = landing.split(':').map(Number)
  if (isNaN(th) || isNaN(tm) || isNaN(lh) || isNaN(lm)) return `${takeoff} → ${landing}`
  const start = th * 60 + tm
  const end = lh * 60 + lm
  let diff = end - start
  if (diff < 0) diff += 1440 // cross-midnight
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return `${h}h${m.toString().padStart(2, '0')}`
}

const LAUNCH_METHOD_LABELS: Record<number, string> = {
  0: 'Extérieur',
  1: 'Treuil',
  2: 'Remorqueur',
  3: 'Autonome',
}

function formatLaunchMethod(flight: ValidatedFlightItem): string {
  const method = flight.launch_method
  if (method === null || method === undefined) return '-'
  if (method === 0) return 'Extérieur'
  if (method === 3) return 'Autonome'
  const label = LAUNCH_METHOD_LABELS[method] ?? `Méthode ${method}`
  return flight.launch_asset_code ? `${label} ${flight.launch_asset_code}` : label
}


function formatDecimal(value: string | number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || value === '') return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return numeric.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function formatMoney(value: string | number | null | undefined): string {
  const formatted = formatDecimal(value, 2)
  return formatted === '-' ? formatted : `${formatted} EUR`
}

function shortHash(value: string | null): string {
  return value ? value.slice(0, 12) : '-'
}

function BillingPreviewPanel({ preview }: { preview: FlightBillingPreviewResponse }) {
  const { t } = useTranslation('flights')
  const blockingErrors = preview.errors.filter((error) => error.blocking)

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('billing.title')}</p>
          <h2 className="text-lg font-semibold text-slate-900">
            {preview.flight_date ?? '-'} · {preview.type_label ?? preview.type_of_flight ?? '-'}
          </h2>
          <p className="text-xs text-slate-500">{t('billing.hash')}: {shortHash(preview.billing_hash)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('billing.total')}</p>
          <p className="text-2xl font-semibold text-slate-900">{formatMoney(preview.total_amount)}</p>
          <p className={preview.can_apply ? 'text-xs text-emerald-700' : 'text-xs text-amber-700'}>
            {preview.no_bill ? t('billing.noBill') : preview.can_apply ? t('billing.ready') : t('billing.blocked')}
          </p>
        </div>
      </div>

      {(blockingErrors.length > 0 || preview.warnings.length > 0) && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {blockingErrors.length > 0 && (
            <Alert>
              <span className="font-semibold">{t('billing.errors')}</span>
              <ul className="mt-1 space-y-1">
                {blockingErrors.map((error) => (
                  <li key={`${error.scope}-${error.code}-${error.message}`}>{error.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          {preview.warnings.length > 0 && (
            <Alert>
              <span className="font-semibold">{t('billing.warnings')}</span>
              <ul className="mt-1 space-y-1">
                {preview.warnings.map((warning) => (
                  <li key={`${warning.scope}-${warning.code}-${warning.message}`}>{warning.message}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-slate-900">{t('billing.payers')}</h3>
          <div className="mt-2 space-y-2">
            {preview.payers.length === 0 ? (
              <p className="text-sm text-slate-500">{t('billing.empty')}</p>
            ) : preview.payers.map((payer) => (
              <div key={`${payer.role}-${payer.member_uuid}`} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{payer.member_name ?? payer.member_account_id ?? '-'}</p>
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
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('billing.item')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('billing.payer')}</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">{t('billing.quantity')}</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">{t('billing.unitPrice')}</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">{t('billing.pack')}</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">{t('billing.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.applied_lines.map((line, index) => (
                <tr key={`${line.pricing_item_uuid}-${line.payer_member_uuid}-${index}`}>
                  <td className="px-3 py-2 text-slate-800">{line.pricing_item_name ?? '-'}<br /><span className="text-slate-500">{line.source} · {line.asset_code ?? '-'}</span></td>
                  <td className="px-3 py-2 text-slate-700">{line.payer_member_account_id ?? line.payer_role}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatDecimal(line.quantity, 4)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatMoney(line.applied_unit_price)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{line.discount_reason ? formatDecimal(line.pack_hours_used, 2) : '-'}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-900">{formatMoney(line.amount)}</td>
                </tr>
              ))}
              {preview.applied_lines.length === 0 && (
                <tr><td className="px-3 py-5 text-center text-slate-500" colSpan={6}>{t('billing.empty')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('billing.account')}</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('billing.member')}</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('billing.description')}</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">{t('billing.debit')}</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">{t('billing.credit')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.accounting_lines.map((line, index) => (
              <tr key={`${line.side}-${line.account_code}-${index}`}>
                <td className="px-3 py-2 text-slate-800">{line.account_code ?? '-'}</td>
                <td className="px-3 py-2 text-slate-700">{line.member_account_id_snapshot ?? '-'}</td>
                <td className="px-3 py-2 text-slate-700">{line.description ?? '-'}</td>
                <td className="px-3 py-2 text-right text-slate-700">{Number(line.debit) > 0 ? formatMoney(line.debit) : '-'}</td>
                <td className="px-3 py-2 text-right text-slate-700">{Number(line.credit) > 0 ? formatMoney(line.credit) : '-'}</td>
              </tr>
            ))}
            {preview.accounting_lines.length === 0 && (
              <tr><td className="px-3 py-5 text-center text-slate-500" colSpan={5}>{t('billing.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function highlightType(flight: ValidatedFlightItem): boolean {
  const hasSplit = (flight.instruction_split ?? 0) > 0
  const hasChargeTo = !!flight.charge_to_erp_id && flight.charge_to_erp_id !== flight.pilot_erp_id
  return hasSplit || hasChargeTo
}

export function FlightsPage() {
  const { t } = useTranslation('flights')

  // Pagination for the flights table
  const [flightPage, setFlightPage] = useState(1)
  const flightPageSize = 50

  // Filter state
  const [filters, setFilters] = useState<FlightListFilters>({})
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterType, setFilterType] = useState<number | null>(null)
  const [filterLaunch, setFilterLaunch] = useState<number | null>(null)
  const [filterPilot, setFilterPilot] = useState('')
  const [filterAsset, setFilterAsset] = useState('')
  const [filterStatus, setFilterStatus] = useState<number | null>(null)

  // Apply filters: reset to page 1 when filters change
  function applyFilters() {
    const next: FlightListFilters = {}
    if (filterDateFrom) next.date_from = filterDateFrom
    if (filterDateTo) next.date_to = filterDateTo
    if (filterType !== null) next.type_of_flight = filterType
    if (filterLaunch !== null) next.launch_method = filterLaunch
    if (filterPilot.trim()) next.pilot_query = filterPilot.trim()
    if (filterAsset.trim()) next.asset_code = filterAsset.trim()
    if (filterStatus !== null) next.erp_status = filterStatus
    setFilters(next)
    setFlightPage(1)
  }

  // Clear all filters
  function clearFilters() {
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterType(null)
    setFilterLaunch(null)
    setFilterPilot('')
    setFilterAsset('')
    setFilterStatus(null)
    setFilters({})
    setFlightPage(1)
  }

  const hasActiveFilters = Object.keys(filters).length > 0
  const flightsQuery = useFlightListQuery(flightPage, flightPageSize, filters)
  const billingPreviewMutation = useFlightBillingPreviewMutation()
  const [billingPreview, setBillingPreview] = useState<FlightBillingPreviewResponse | null>(null)

  function previewBilling(flight: ValidatedFlightItem) {
    billingPreviewMutation.mutate(flight.uuid, {
      onSuccess: setBillingPreview,
    })
  }

  return (
    <section className="space-y-4">
      {/* Hero Banner */}
      <div className="rounded-2xl border border-outline-variant bg-gradient-to-r from-indigo-950 via-purple-900 to-violet-800 p-6 text-white shadow-sm">
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-100">
            {t('hero.kicker')}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{t('hero.title')}</h1>
          <p className="max-w-2xl text-sm text-violet-50/90">{t('hero.description')}</p>
        </div>
      </div>

      {/* Filters bar */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Date from */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterDateFrom')}</Label>
            <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
          </div>
          {/* Date to */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterDateTo')}</Label>
            <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
          </div>
          {/* Flight type */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterType')}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterType ?? ''}
              onChange={(e) => setFilterType(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('table.filterAll')}</option>
              <option value="0">Instruction</option>
              <option value="1">Solo</option>
              <option value="2">Initiation</option>
              <option value="3">Partage</option>
              <option value="4">Passager</option>
              <option value="5">Lâcher</option>
              <option value="6">Supervisé</option>
              <option value="7">Essai</option>
            </select>
          </div>
          {/* Launch method */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterLaunch')}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterLaunch ?? ''}
              onChange={(e) => setFilterLaunch(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('table.filterAll')}</option>
              <option value="0">Extérieur</option>
              <option value="1">Treuil</option>
              <option value="2">Remorqueur</option>
              <option value="3">Autonome</option>
            </select>
          </div>
          {/* Pilot search */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterPilot')}</Label>
            <Input
              placeholder={t('table.filterPilotPlaceholder')}
              value={filterPilot}
              onChange={(e) => setFilterPilot(e.target.value)}
            />
          </div>
          {/* Asset code */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterAsset')}</Label>
            <Input
              placeholder={t('table.filterAssetPlaceholder')}
              value={filterAsset}
              onChange={(e) => setFilterAsset(e.target.value)}
            />
          </div>
          {/* Status */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('table.filterStatus')}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterStatus ?? ''}
              onChange={(e) => setFilterStatus(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('table.filterAll')}</option>
              <option value="0">Validé</option>
              <option value="1">Transféré</option>
              <option value="2">Modifié</option>
            </select>
          </div>
          {/* Actions */}
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={applyFilters} type="button">
              {t('table.filterApply')}
            </Button>
            {hasActiveFilters && (
              <Button size="sm" variant="secondary" onClick={clearFilters} type="button">
                {t('table.filterClear')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Flights table */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{t('table.title')}</h2>
            <p className="text-sm text-slate-600">{t('table.description')}</p>
          </div>
          <div className="text-sm text-slate-600">
            {t('table.count', { total: flightsQuery.data?.total ?? 0 })}
          </div>
        </div>

        {flightsQuery.isLoading ? (
          <p className="text-sm text-slate-600">{t('state.loading')}</p>
        ) : flightsQuery.error ? (
          <Alert>{t('table.loadError')}</Alert>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-outline-variant">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.date')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.glider')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.type')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.pilot')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.secondPilot')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.duration')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.launch')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.launchPilot')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('table.chargeTo')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">{t('table.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {flightsQuery.data?.items.map((flight) => (
                    <tr key={flight.uuid}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-800">
                        {flight.jour ? new Date(flight.jour).toLocaleDateString('fr-FR') : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-800">{flight.asset_code ?? '-'}</td>
                      <td className={`px-3 py-2 ${highlightType(flight) ? 'font-bold text-amber-600' : 'text-slate-800'}`}>{formatFlightType(flight.type_of_flight)}</td>
                      <td className="px-3 py-2 text-slate-800">{flight.pilot_name ?? flight.pilot_erp_id ?? '-'}</td>
                      <td className="px-3 py-2 text-slate-800">{formatSecondPilot(flight)}</td>
                      <td className="px-3 py-2 text-slate-800">
                        {flight.takeoff_time && flight.landing_time
                          ? formatDuration(flight.takeoff_time, flight.landing_time)
                          : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-800">{formatLaunchMethod(flight)}</td>
                      <td className="px-3 py-2 text-slate-800">{flight.launch_pilot_trigram ?? '-'}</td>
                      <td className="px-3 py-2 text-slate-800">{flight.charge_to_erp_id ?? '-'}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => previewBilling(flight)}
                          disabled={billingPreviewMutation.isPending && billingPreviewMutation.variables === flight.uuid}
                          title={t('billing.preview')}
                          aria-label={t('billing.preview')}
                        >
                          <Calculator className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(!flightsQuery.data || flightsQuery.data.items.length === 0) && (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={10}>
                        {t('table.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {billingPreviewMutation.error && (
              <div className="mt-4">
                <Alert>{t('billing.loadError')}</Alert>
              </div>
            )}

            {billingPreview && (
              <div className="mt-4">
                <BillingPreviewPanel preview={billingPreview} />
              </div>
            )}

            {/* Pagination */}
            {flightsQuery.data && flightsQuery.data.total_pages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={flightPage <= 1}
                  onClick={() => setFlightPage((p) => Math.max(1, p - 1))}
                >
                  {t('table.prev')}
                </Button>
                <span className="px-2 text-sm text-slate-700">
                  {t('table.pageInfo', {
                    page: flightPage,
                    total: flightsQuery.data.total_pages,
                  })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={flightPage >= (flightsQuery.data.total_pages)}
                  onClick={() => setFlightPage((p) => p + 1)}
                >
                  {t('table.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

    </section>
  )
}
