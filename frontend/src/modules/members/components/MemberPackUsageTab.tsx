/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Pack Usage tab — pack purchases and consumption for a member
    Copyright (C) 2026  SAFORCADA Patrick
*/
import { useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ShoppingBag, Loader2, Download } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { useActiveFiscalYearQuery, usePackPurchasesQuery } from '../../banque/api'
import type { WorkspaceMode } from '../types/workspace'

const PAGE_SIZE = 50

interface MemberPackUsageTabProps {
  memberUuid: string
  mode: WorkspaceMode
}

function formatEur(value: string | number | null | undefined): string {
  if (!value) return '—'
  const n = Number(value)
  return Number.isFinite(n) ? `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} EUR` : '—'
}

export function MemberPackUsageTab({ memberUuid, mode: _mode }: MemberPackUsageTabProps) {
  const { t } = useTranslation(['banque', 'common'])
  const storeFyUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const { data: activeFy } = useActiveFiscalYearQuery(!storeFyUuid)
  const fiscalYearUuid = storeFyUuid ?? (activeFy?.uuid ?? null)

  const [page, setPage] = useState(1)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)

  const { data: purchases, isLoading } = usePackPurchasesQuery(
    fiscalYearUuid,
    memberUuid,
    !!fiscalYearUuid,
    undefined,
    page,
    PAGE_SIZE,
  )

  const items = purchases?.items ?? []
  const totalPages = purchases?.total_pages ?? 1

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!purchases || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
        <ShoppingBag className="h-10 w-10" />
        <p className="text-sm">{t('ops.packs.noPurchases', "Aucun forfait acheté")}</p>
      </div>
    )
  }

  function exportToCsv() {
    const headers = [
      t('ops.packs.pack', 'Forfait'),
      t('ops.packs.date', 'Date achat'),
      t('ops.packs.qtyBought', 'Acheté'),
      t('ops.packs.qtyRemaining', 'Restant'),
      t('ops.packs.price', 'Montant achat'),
      t('ops.packs.totalDiscount', 'Remise'),
      t('ops.packs.flightDate', 'Date vol'),
      t('ops.packs.assetCode', 'Machine'),
      t('ops.packs.qtyConsumed', 'Qté cons.'),
      t('ops.packs.unitDiscount', 'Remise unit.'),
      t('ops.packs.totalDiscount', 'Remise totale vol'),
    ]
    const rows: string[][] = []
    for (const p of items) {
      if (p.consumptions && p.consumptions.length > 0) {
        for (const c of p.consumptions) {
          rows.push([
            p.pack_code ?? p.pack_type ?? '',
            p.entry_date ?? '',
            String(p.units_purchased),
            String(p.units_remaining),
            Number(p.amount).toFixed(2).replace('.', ','),
            Number(p.total_discount).toFixed(2).replace('.', ','),
            c.flight_date ?? '',
            c.asset_code ?? '',
            String(c.quantity_consumed),
            Number(c.discount_unit_price).toFixed(2).replace('.', ','),
            Number(c.total_discount_amount).toFixed(2).replace('.', ','),
          ])
        }
      } else {
        rows.push([
          p.pack_code ?? p.pack_type ?? '',
          p.entry_date ?? '',
          String(p.units_purchased),
          String(p.units_remaining),
          Number(p.amount).toFixed(2).replace('.', ','),
          Number(p.total_discount).toFixed(2).replace('.', ','),
          '', '', '', '', '',
        ])
      }
    }
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `forfaits-${memberUuid.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={exportToCsv}
          className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" />
          {t('ops.packs.exportCsv', 'Exporter CSV')}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="w-8 px-2 py-3" />
              <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.pack', 'Forfait')}</th>
              <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.date', 'Date')}</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.qtyBought', 'Acheté')}</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.qtyRemaining', 'Restant')}</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.price', 'Montant')}</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.totalDiscount', 'Remise')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((p) => (
              <Fragment key={p.entry_uuid}>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-2 py-3">
                    {p.consumptions?.length > 0 && (
                      <button
                        type="button"
                        className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                        onClick={() => setExpandedEntry(expandedEntry === p.entry_uuid ? null : p.entry_uuid)}
                      >
                        {expandedEntry === p.entry_uuid ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">
                      {p.pack_code ?? p.pack_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.entry_date ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{p.units_purchased}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{p.units_remaining}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{formatEur(p.amount)}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {Number(p.total_discount) > 0 ? (
                      <span className="text-blue-700">{formatEur(p.total_discount)}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
                {expandedEntry === p.entry_uuid && p.consumptions?.length > 0 && (
                  <tr key={`${p.entry_uuid}-detail`}>
                    <td colSpan={7} className="bg-slate-50 px-6 py-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t('ops.packs.flightsInvolved', 'Vols concernés')}
                        </p>
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-slate-200 bg-slate-100">
                              <tr>
                                <th className="px-3 py-2 font-medium text-slate-600">{t('ops.packs.flightDate', 'Date')}</th>
                                <th className="px-3 py-2 font-medium text-slate-600">{t('ops.packs.assetCode', 'Machine')}</th>
                                <th className="px-3 py-2 text-right font-medium text-slate-600">{t('ops.packs.qtyConsumed', 'Qté cons.')}</th>
                                <th className="px-3 py-2 text-right font-medium text-slate-600">{t('ops.packs.unitDiscount', 'Remise unit.')}</th>
                                <th className="px-3 py-2 text-right font-medium text-slate-600">{t('ops.packs.totalDiscount', 'Remise totale')}</th>
                                <th className="px-3 py-2 font-medium text-slate-600">{t('ops.packs.validFrom', 'Valide dès')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {p.consumptions.map((c) => (
                                <tr key={c.consumption_uuid}>
                                  <td className="px-3 py-2 text-slate-900">{c.flight_date ?? '—'}</td>
                                  <td className="px-3 py-2 text-slate-700">{c.asset_code ?? '—'}</td>
                                  <td className="px-3 py-2 text-right font-mono text-slate-900">{c.quantity_consumed}</td>
                                  <td className="px-3 py-2 text-right font-mono text-slate-900">{formatEur(c.discount_unit_price)}</td>
                                  <td className="px-3 py-2 text-right font-mono text-slate-900">{formatEur(c.total_discount_amount)}</td>
                                  <td className="px-3 py-2 text-slate-600">{c.valid_from ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t('common.prev', 'Précédent')}
          </Button>
          <span className="px-2 text-sm text-slate-700">
            {t('common.pageInfo', { defaultValue: 'Page {{page}}/{{total}}', page, total: totalPages })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('common.next', 'Suivant')}
          </Button>
        </div>
      )}
    </div>
  )
}
