/*
    ERP-CLUB - ERP pour Club de vol à voile
    - ViReportsPage: Realized/converted VI voucher report and KPIs
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
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'
import {
  Banknote,
  CheckCircle2,
  Download,
  Hourglass,
  PiggyBank,
  Plane,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { KpiCard } from '../../../components/ui/kpi-card'
import { DataTable, type ColumnDef } from '../../../components/ui/data-table'
import { exportRowsToCsv } from '../../../lib/exportCsv'
import {
  type ViReportVoucherRow,
  useViRealizedReportQuery,
} from '../api'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAmount(v: string | null | undefined): string {
  if (v == null) return '—'
  return new Decimal(v).toFixed(2) + ' €'
}

function fmtPercent(v: number): string {
  return `${(v * 100).toFixed(1)} %`
}

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return 'Erreur inattendue'
}

function StatusBadge({ status }: { status: number }) {
  const map: Record<number, [string, string]> = {
    3: ['badge-success', 'Réalisé'],
    6: ['badge-success', 'Converti'],
  }
  const [cls, label] = map[status] ?? ['outline', '?']
  return <Badge className={cls}>{label}</Badge>
}

function EntryStateBadge({ state }: { state: number | null }) {
  if (state === 1) return <Badge className="badge-warning">Brouillon</Badge>
  if (state === 2) return <Badge className="badge-success">Validé</Badge>
  if (state === 3) return <Badge className="badge-destructive">Annulé</Badge>
  return null
}

// ── Expanded row: flight dates + accounting entry lines ────────────────────

function VoucherDetail({ row }: { row: ViReportVoucherRow }) {
  return (
    <div className="bg-muted/30 px-6 py-4 space-y-4 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
          Vols associés ({row.flight_count})
        </p>
        {row.flight_dates.length === 0 ? (
          <p className="text-muted-foreground text-xs">Aucun vol associé</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.flight_dates.map((d, i) => (
              <Badge key={`${d}-${i}`} variant="outline" className="font-mono text-xs">
                {d}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Écriture de réalisation
            </p>
            {row.realization.entry_date && <EntryStateBadge state={row.realization.state} />}
          </div>
          {row.realization.lines.length === 0 ? (
            <p className="text-muted-foreground text-xs">Aucune écriture</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-normal py-1">Compte</th>
                  <th className="text-right font-normal py-1">Débit</th>
                  <th className="text-right font-normal py-1">Crédit</th>
                </tr>
              </thead>
              <tbody>
                {row.realization.lines.map((ln, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="py-1">
                      <span className="font-mono">{ln.account_code}</span>
                      {ln.account_name && <span className="text-muted-foreground ml-1">{ln.account_name}</span>}
                    </td>
                    <td className="text-right tabular-nums py-1">
                      {new Decimal(ln.debit).isZero() ? '—' : fmtAmount(ln.debit)}
                    </td>
                    <td className="text-right tabular-nums py-1">
                      {new Decimal(ln.credit).isZero() ? '—' : fmtAmount(ln.credit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {row.realization.entry_date && (
            <p className="text-muted-foreground text-xs mt-1">Date : {row.realization.entry_date}</p>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Écriture de conversion
            </p>
            {row.conversion.entry_date && <EntryStateBadge state={row.conversion.state} />}
          </div>
          {row.conversion.lines.length === 0 ? (
            <p className="text-muted-foreground text-xs">Bon non converti</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-normal py-1">Compte</th>
                  <th className="text-right font-normal py-1">Débit</th>
                  <th className="text-right font-normal py-1">Crédit</th>
                </tr>
              </thead>
              <tbody>
                {row.conversion.lines.map((ln, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="py-1">
                      <span className="font-mono">{ln.account_code}</span>
                      {ln.account_name && <span className="text-muted-foreground ml-1">{ln.account_name}</span>}
                    </td>
                    <td className="text-right tabular-nums py-1">
                      {new Decimal(ln.debit).isZero() ? '—' : fmtAmount(ln.debit)}
                    </td>
                    <td className="text-right tabular-nums py-1">
                      {new Decimal(ln.credit).isZero() ? '—' : fmtAmount(ln.credit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {row.conversion.entry_date && (
            <p className="text-muted-foreground text-xs mt-1">Date : {row.conversion.entry_date}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export function ViReportsPage() {
  const { t } = useTranslation('vi')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedUuid, setExpandedUuid] = useState<string | null>(null)

  const reportQuery = useViRealizedReportQuery(dateFrom || undefined, dateTo || undefined)
  const vouchers = reportQuery.data?.vouchers ?? []
  const kpis = reportQuery.data?.kpis

  const totalFlights = useMemo(
    () => vouchers.reduce((sum, v) => sum + v.flight_count, 0),
    [vouchers],
  )

  function exportCsv() {
    const headers = [
      t('reports.table.code'),
      t('reports.table.type'),
      t('reports.table.status'),
      t('reports.table.realisationDate'),
      t('reports.table.amount'),
      t('reports.table.insurance'),
      t('reports.table.flightCount'),
      t('reports.table.flightDates'),
    ]
    const rows = vouchers.map((v) => [
      v.code,
      v.vi_type_code ?? '',
      v.status === 6 ? 'Converti' : 'Réalisé',
      v.realisation_date ?? '',
      fmtAmount(v.amount_ttc),
      fmtAmount(v.insurance_amount),
      v.flight_count,
      v.flight_dates.join(' | '),
    ])
    exportRowsToCsv('vi-bons-realises.csv', headers, rows)
  }

  const columns: ColumnDef<ViReportVoucherRow>[] = [
    {
      key: 'code',
      header: t('reports.table.code'),
      sortable: true,
      cell: (row) => <span className="font-mono font-medium">{row.code}</span>,
    },
    {
      key: 'type',
      header: t('reports.table.type'),
      cell: (row) => row.vi_type_code
        ? <Badge variant="outline" className="font-mono text-xs">{row.vi_type_code}</Badge>
        : '—',
    },
    {
      key: 'status',
      header: t('reports.table.status'),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'realisation_date',
      header: t('reports.table.realisationDate'),
      sortable: true,
      cell: (row) => row.realisation_date ?? '—',
    },
    {
      key: 'amount',
      header: t('reports.table.amount'),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      sortable: true,
      cell: (row) => fmtAmount(row.amount_ttc),
    },
    {
      key: 'insurance',
      header: t('reports.table.insurance'),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      cell: (row) => fmtAmount(row.insurance_amount),
    },
    {
      key: 'flights',
      header: t('reports.table.flightCount'),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      sortable: true,
      cell: (row) => row.flight_count,
    },
    {
      key: 'buyer',
      header: t('reports.table.buyer'),
      cell: (row) => row.registered_member_name ?? row.buyer_member_name ?? '—',
    },
  ]

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">{t('reports.title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('reports.description')}</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="vi-report-from" className="text-xs">{t('reports.filters.from')}</Label>
            <Input
              id="vi-report-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vi-report-to" className="text-xs">{t('reports.filters.to')}</Label>
            <Input
              id="vi-report-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9"
            />
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={vouchers.length === 0}>
            <Download className="h-4 w-4 mr-1" />
            {t('reports.exportCsv')}
          </Button>
        </div>
      </div>

      {reportQuery.error && <Alert>{toErrorMessage(reportQuery.error)}</Alert>}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('reports.kpi.realized')}
          value={String(kpis?.realized_count ?? 0)}
          hint={t('reports.kpi.realizedHint', { count: kpis?.converted_count ?? 0 })}
          icon={CheckCircle2}
          accent="success"
        />
        <KpiCard
          label={t('reports.kpi.remaining')}
          value={String(kpis?.remaining_count ?? 0)}
          hint={t('reports.kpi.remainingHint')}
          icon={Hourglass}
          accent="warning"
        />
        <KpiCard
          label={t('reports.kpi.conversionRate')}
          value={fmtPercent(kpis?.conversion_rate ?? 0)}
          hint={t('reports.kpi.conversionRateHint')}
          icon={TrendingUp}
        />
        <KpiCard
          label={t('reports.kpi.advancesUnrealized')}
          value={fmtAmount(kpis?.advances_unrealized)}
          hint={t('reports.kpi.advancesUnrealizedHint')}
          icon={Banknote}
        />
        <KpiCard
          label={t('reports.kpi.netFlightRevenue')}
          value={fmtAmount(kpis?.net_flight_revenue)}
          hint={t('reports.kpi.netFlightRevenueHint', { count: totalFlights })}
          icon={Banknote}
          accent="success"
        />
        <KpiCard
          label={t('reports.kpi.flightCost')}
          value={fmtAmount(kpis?.flight_cost)}
          hint={t('reports.kpi.flightCostHint')}
          icon={Plane}
        />
        <KpiCard
          label={t('reports.kpi.margin')}
          value={fmtAmount(kpis?.margin)}
          hint={t('reports.kpi.marginHint')}
          icon={PiggyBank}
          accent={kpis && new Decimal(kpis.margin).isNegative() ? 'destructive' : 'success'}
        />
        <KpiCard
          label={t('reports.kpi.insurance')}
          value={fmtAmount(kpis?.insurance_collected)}
          hint={t('reports.kpi.insuranceHint', {
            paid: fmtAmount(kpis?.insurance_paid),
            count: kpis?.insurance_voucher_count ?? 0,
          })}
          icon={Shield}
        />
      </div>

      {/* Top pilots */}
      {kpis && kpis.top_pilots.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{t('reports.topPilots.title')}</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {kpis.top_pilots.map((p, i) => (
              <div
                key={p.account_id ?? p.member_name}
                className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">#{i + 1}</p>
                  <p className="text-sm font-medium truncate">{p.member_name}</p>
                </div>
                <span className="tabular-nums text-sm font-semibold shrink-0">{p.flight_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vouchers table */}
      <div className="rounded-xl border bg-card">
        <DataTable
          columns={columns}
          data={vouchers}
          getRowKey={(row) => row.entitlement_uuid}
          onRowClick={(row) =>
            setExpandedUuid((prev) => (prev === row.entitlement_uuid ? null : row.entitlement_uuid))
          }
          expandedRow={expandedUuid}
          renderExpanded={(row) => <VoucherDetail row={row} />}
          defaultSortKey="realisation_date"
          defaultSortDir="desc"
          emptyState={
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              {reportQuery.isLoading ? t('reports.loading') : t('reports.empty')}
            </p>
          }
        />
      </div>
    </section>
  )
}
