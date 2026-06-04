/*
    ERP-CLUB - ERP pour Club de vol à voile
    - banque: OpsPacksTab — pack purchases listing and management
    Copyright (C) 2026  SAFORCADA Patrick
    ...
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Plus, Loader2 } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { useCapability } from '../../../auth/hooks/useCapability'
import { usePackPurchasesQuery } from '../api'
import { PackPurchaseDialog } from './PackPurchaseDialog'

export function OpsPacksTab() {
  const { t } = useTranslation(['banque', 'common'])
  const canManagePrices = useCapability('MANAGE_PRICES')
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  const { data: purchases, isLoading } = usePackPurchasesQuery(activeFiscalYearUuid, !!activeFiscalYearUuid)
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)

  function formatEur(value: string | number | null | undefined): string {
    if (!value) return '—'
    const n = Number(value)
    return Number.isFinite(n) ? `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} EUR` : '—'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('ops.packs.title', 'Forfaits')}
        </h2>
        {canManagePrices && (
          <Button size="sm" onClick={() => setShowPurchaseDialog(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('ops.packs.sell', 'Vendre un forfait')}
          </Button>
        )}
      </div>

      <PackPurchaseDialog
        open={showPurchaseDialog}
        onClose={() => setShowPurchaseDialog(false)}
      />

      {isLoading ? (
        <div className="flex min-h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : !purchases?.items?.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          {t('ops.packs.empty', 'Aucun forfait acheté pour cet exercice.')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.member', 'Membre')}</th>
                <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.pack', 'Forfait')}</th>
                <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.date', 'Date')}</th>
                <th className="px-4 py-3 font-medium text-slate-600 text-right">{t('ops.packs.qtyBought', 'Acheté')}</th>
                <th className="px-4 py-3 font-medium text-slate-600 text-right">{t('ops.packs.qtyRemaining', 'Restant')}</th>
                <th className="px-4 py-3 font-medium text-slate-600 text-right">{t('ops.packs.price', 'Montant')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchases.items.map((p) => (
                <tr key={p.entry_uuid}>
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
                  <td className="px-4 py-3 text-slate-900">{p.member_name ?? p.member_uuid}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">{p.pack_code ?? p.pack_type}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.entry_date ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{p.units_purchased}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{p.units_remaining}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{formatEur(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
