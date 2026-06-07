import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMemberPortalExpenses, useMemberPortalDeclareExpense } from '../api'

export function ExpensesPage() {
  const { t } = useTranslation('common')
  const { data, isLoading, refetch } = useMemberPortalExpenses()
  const declareMutation = useMemberPortalDeclareExpense()

  const [showForm, setShowForm] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMsg(null)
    if (!amount || Number(amount) <= 0) {
      setError(t('portal.expenseAmountInvalid'))
      return
    }
    if (!reason.trim()) {
      setError(t('portal.expenseReasonRequired'))
      return
    }
    try {
      await declareMutation.mutateAsync({ amount, reason })
      setMsg(t('portal.expenseSaved'))
      setShowForm(false)
      setAmount('')
      setReason('')
      refetch()
    } catch {
      setError(t('portal.expenseError'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('portal.expenses')}</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showForm ? t('portal.cancel') : t('portal.declareExpense')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('portal.newExpense')}</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">{t('portal.expenseAmount')}</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">{t('portal.expenseReason')}</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={declareMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {declareMutation.isPending ? `${t('portal.depositSubmit')}…` : t('portal.depositSubmit')}
            </button>
            {msg && <p className="text-sm text-green-600">{msg}</p>}
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-400">{t('portal.loading')}</p>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          {data.items.map((expense) => (
            <div key={expense.uuid} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">{expense.reason}</p>
                  <p className="text-xs text-slate-400">
                    {expense.created_at ? new Date(expense.created_at).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-800">{expense.amount} €</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      expense.status === 'approved'
                        ? 'bg-green-100 text-green-700'
                        : expense.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {expense.status === 'approved'
                      ? t('portal.expenseApproved')
                      : expense.status === 'rejected'
                        ? t('portal.expenseRejected')
                        : t('portal.expensePending')}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 py-12 text-center">
          <p className="text-sm text-slate-400">{t('portal.expenseEmpty')}</p>
        </div>
      )}
    </div>
  )
}
