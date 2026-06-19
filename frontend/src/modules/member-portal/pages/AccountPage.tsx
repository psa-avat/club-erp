import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useMemberPortalAccountSummaryQuery,
  useMemberPortalAccountEntriesQuery,
  useMemberPortalDeposit,
} from '../api'
import { useFiscalYearStore } from '@/store/fiscalYearStore'

export function AccountPage() {
  const { t } = useTranslation('common')
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const { data: account, isLoading } = useMemberPortalAccountSummaryQuery(activeFiscalYearUuid)
  const { data: entries, isLoading: entriesLoading } = useMemberPortalAccountEntriesQuery({
    fiscalYearUuid: activeFiscalYearUuid ?? undefined,
    limit: 50,
  })
  const depositMutation = useMemberPortalDeposit()

  const [showDeposit, setShowDeposit] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositMethod, setDepositMethod] = useState('bank_transfer')
  const [depositMsg, setDepositMsg] = useState<string | null>(null)

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault()
    setDepositMsg(null)
    try {
      const result = await depositMutation.mutateAsync({
        amount: depositAmount,
        payment_method: depositMethod,
      })
      setDepositMsg(result.message)
      setShowDeposit(false)
      setDepositAmount('')
    } catch {
      setDepositMsg(t('portal.depositError'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('portalMyAccount')}</h1>
        <button
          type="button"
          onClick={() => setShowDeposit(!showDeposit)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showDeposit ? t('portal.cancel') : t('portal.makeDeposit')}
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">{t('portalLoading')}</p>
      ) : account ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{t('portalBalance')}</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">
                {account.current_balance} €
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{t('portalPendingEntries')}</p>
              <p className="mt-1 text-2xl font-bold text-amber-600">
                {account.pending_total} €
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{t('portalPostedEntries')}</p>
              <p className="mt-1 text-2xl font-bold text-green-600">
                {account.posted_total} €
              </p>
            </div>
          </div>
        </>
      ) : null}

      {/* Deposit form */}
      {showDeposit && (
        <form onSubmit={handleDeposit} className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('portalDepositTitle')}</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">{t('portalDepositAmount')}</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">{t('portalDepositMethod')}</label>
              <select
                value={depositMethod}
                onChange={(e) => setDepositMethod(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="bank_transfer">{t('portalDepositBankTransfer')}</option>
                <option value="check">{t('portalDepositCheck')}</option>
                <option value="cash">{t('portalDepositCash')}</option>
                <option value="card">{t('portalDepositCard')}</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={depositMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {depositMutation.isPending ? `${t('portalDepositSubmit')}…` : t('portal.depositSubmit')}
            </button>
            {depositMsg && <p className="text-sm text-green-600">{depositMsg}</p>}
          </div>
        </form>
      )}

      {/* Account entries */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-700">Écritures comptables</h2>
        {entriesLoading ? (
          <p className="text-sm text-slate-400">Chargement…</p>
        ) : entries && entries.items.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Référence</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Description</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Débit</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Crédit</th>
                  <th className="px-3 py-2 text-center font-medium text-slate-500">État</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.items.map((entry) => (
                  <tr key={entry.entry_uuid} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">{entry.entry_date ?? '—'}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{entry.reference ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{entry.description ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {Number(entry.debit) > 0 ? `${entry.debit} €` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {Number(entry.credit) > 0 ? `${entry.credit} €` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.state === 2
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {entry.state === 2 ? 'Comptabilisé' : 'Brouillon'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Aucune écriture</p>
        )}
      </section>
    </div>
  )
}
