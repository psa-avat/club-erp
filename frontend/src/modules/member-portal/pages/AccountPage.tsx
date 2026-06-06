import { useState } from 'react'
import { useMemberPortalAccount, useMemberPortalAccountEntries, useMemberPortalDeposit } from '../api'

export function AccountPage() {
  const { data: account, isLoading } = useMemberPortalAccount()
  const { data: entries, isLoading: entriesLoading } = useMemberPortalAccountEntries()
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
      setDepositMsg('Erreur lors de l\'enregistrement du dépôt')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Mon compte</h1>
        <button
          type="button"
          onClick={() => setShowDeposit(!showDeposit)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showDeposit ? 'Annuler' : 'Faire un dépôt'}
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Chargement…</p>
      ) : account ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Solde</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">
                {account.current_balance} €
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">En attente</p>
              <p className="mt-1 text-2xl font-bold text-amber-600">
                {account.pending_entries_count}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Comptabilisées</p>
              <p className="mt-1 text-2xl font-bold text-green-600">
                {account.posted_entries_count}
              </p>
            </div>
          </div>

          {account.active_packs.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-700">Forfaits actifs</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {account.active_packs.map((pack) => (
                  <div key={pack.pack_type} className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-sm font-medium text-slate-700">{pack.pack_type_label}</p>
                    <p className="text-xs text-slate-500">
                      Restant: {pack.units_remaining} / {pack.total_purchased}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : null}

      {/* Deposit form */}
      {showDeposit && (
        <form onSubmit={handleDeposit} className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Enregistrer un dépôt</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">Montant</label>
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
              <label className="block text-xs font-medium text-slate-600">Mode de paiement</label>
              <select
                value={depositMethod}
                onChange={(e) => setDepositMethod(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="bank_transfer">Virement bancaire</option>
                <option value="check">Chèque</option>
                <option value="cash">Espèces</option>
                <option value="card">Carte bancaire</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={depositMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {depositMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
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
                  <tr key={entry.uuid} className="hover:bg-slate-50">
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
