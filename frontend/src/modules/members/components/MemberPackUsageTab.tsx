/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Pack Usage tab — pack purchases and consumption for a member
    Copyright (C) 2026  SAFORCADA Patrick
*/
import { useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ShoppingBag, Loader2 } from 'lucide-react'

import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { usePackPurchasesQuery } from '../../banque/api'
import type { WorkspaceMode } from '../types/workspace'

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
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const { data: purchases, isLoading } = usePackPurchasesQuery(activeFiscalYearUuid, memberUuid, !!activeFiscalYearUuid)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!purchases || purchases.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
        <ShoppingBag className="h-10 w-10" />
        <p className="text-sm">{t('ops.packs.noPurchases', "Aucun forfait acheté")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="w-8 px-2 py-3" />
              <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.pack', 'Forfait')}</th>
              <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.date', 'Date')}</th>
              <th className="px-4 py-3 font-medium text-slate-600 text-right">{t('ops.packs.qtyBought', 'Acheté')}</th>
              <th className="px-4 py-3 font-medium text-slate-600 text-right">{t('ops.packs.qtyRemaining', 'Restant')}</th>
              <th className="px-4 py-3 font-medium text-slate-600 text-right">{t('ops.packs.price', 'Montant')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {purchases.items.map((p) => (
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
                </tr>
                {/* Expanded: consumption flights detail */}
                {expandedEntry === p.entry_uuid && p.consumptions?.length > 0 && (
                  <tr key={`${p.entry_uuid}-detail`}>
                    <td colSpan={6} className="bg-slate-50 px-6 py-4">
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
                                <th className="px-3 py-2 font-medium text-slate-600 text-right">{t('ops.packs.qtyConsumed', 'Qté cons.')}</th>
                                <th className="px-3 py-2 font-medium text-slate-600 text-right">{t('ops.packs.unitDiscount', 'Remise unit.')}</th>
                                <th className="px-3 py-2 font-medium text-slate-600 text-right">{t('ops.packs.totalDiscount', 'Remise totale')}</th>
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
    </div>
  )
}
