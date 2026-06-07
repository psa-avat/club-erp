/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Balance & Deposits tab — account summary, entries table, deposit form
    Copyright (C) 2026  SAFORCADA Patrick
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Landmark, PiggyBank, ArrowDownToLine } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { DataTable } from '../../../components/ui/data-table'
import type { ColumnDef } from '../../../components/ui/data-table'
import { useMemberAccountSummaryQuery, useMemberAccountEntriesQuery, useCreateMemberDepositMutation } from '../api'
import { useMemberPortalAccountSummaryQuery, useMemberPortalAccountEntriesQuery, useMemberPortalDepositMutation } from '../../member-portal/api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import type { AccountEntryItem, AccountSummary } from '../types'
import type { WorkspaceMode } from '../types/workspace'

interface MemberBalanceTabProps {
  memberUuid: string
  mode: WorkspaceMode
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return dateStr }
}

function formatEuro(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function stateBadge(state: number, t: (key: string) => string): { label: string; class: string } {
  if (state === 1) return { label: t('stateDraft'), class: 'bg-amber-100 text-amber-800' }
  if (state === 2) return { label: t('statePosted'), class: 'bg-emerald-100 text-emerald-800' }
  return { label: t('stateCancelled'), class: 'bg-red-100 text-red-800' }
}

function BalanceCards({ summary, t }: { summary: AccountSummary | undefined; t: (key: string) => string }) {
  if (!summary) return null
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-slate-400" />
          <p className="text-xs font-medium text-slate-500">{t('balanceCurrent')}</p>
        </div>
        <p className={`mt-0.5 text-xl font-semibold ${Number(summary.current_balance) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {formatEuro(summary.current_balance)}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-slate-400" />
          <p className="text-xs font-medium text-slate-500">{t('balancePosted')}</p>
        </div>
        <p className="mt-0.5 text-xl font-semibold text-slate-800">{formatEuro(summary.posted_total)}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-400" />
          <p className="text-xs font-medium text-slate-500">{t('balancePending')}</p>
        </div>
        <p className="mt-0.5 text-xl font-semibold text-amber-700">{formatEuro(summary.pending_total)}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <ArrowDownToLine className="h-4 w-4 text-slate-400" />
          <p className="text-xs font-medium text-slate-500">{t('balanceCurrency')}</p>
        </div>
        <p className="mt-0.5 text-xl font-semibold text-slate-800">{summary.currency}</p>
      </div>
    </div>
  )
}

function DepositSection({ memberUuid, mode, t }: { memberUuid: string; mode: WorkspaceMode; t: (key: string) => string }) {
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [reference, setReference] = useState('')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const clubMutation = useCreateMemberDepositMutation()
  const portalMutation = useMemberPortalDepositMutation()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSuccessMsg(null)
    const numAmount = Number(amount)
    if (!numAmount || numAmount <= 0) return

    try {
      const result = mode === 'portal'
        ? await portalMutation.mutateAsync({ amount, payment_method: paymentMethod, reference: reference || undefined })
        : await clubMutation.mutateAsync({ memberUuid, payload: { amount, payment_method: paymentMethod, reference: reference || undefined } })
      setSuccessMsg(result.message || t('balanceDeposit'))
      setAmount('')
      setReference('')
    } catch {
      setSuccessMsg(t('portalDepositError'))
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-700">{t('balanceDeposit')}</h4>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">{t('balanceAmount')}</label>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-32" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">{t('balancePaymentMethod')}</label>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="h-9 rounded border border-slate-300 bg-white px-2 text-sm">
            <option value="bank_transfer">{t('balanceTransfer')}</option>
            <option value="check">{t('balanceCheck')}</option>
            <option value="cash">{t('balanceCash')}</option>
            <option value="card">{t('balanceCard')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">{t('balanceReference')}</label>
          <Input type="text" value={reference} onChange={(e) => setReference(e.target.value)} className="h-9 w-40" placeholder={t('balanceOptional')} />
        </div>
        <Button type="submit" size="sm" disabled={clubMutation.isPending || portalMutation.isPending}>
          {clubMutation.isPending || portalMutation.isPending ? t('balanceSaving') : t('balanceSave')}
        </Button>
      </form>
      {successMsg && <p className="mt-2 text-sm text-emerald-700">{successMsg}</p>}
    </div>
  )
}

export function MemberBalanceTab({ memberUuid, mode }: MemberBalanceTabProps) {
  const { t } = useTranslation('common')
  const { activeFiscalYearUuid } = useFiscalYearStore()

  const clubSummary = useMemberAccountSummaryQuery(memberUuid, activeFiscalYearUuid)
  const portalSummary = useMemberPortalAccountSummaryQuery(activeFiscalYearUuid, mode === 'portal')
  const summary = mode === 'portal' ? portalSummary.data : clubSummary.data

  const clubEntries = useMemberAccountEntriesQuery(memberUuid, { fiscalYearUuid: activeFiscalYearUuid ?? undefined, limit: 50 })
  const portalEntries = useMemberPortalAccountEntriesQuery({ fiscalYearUuid: activeFiscalYearUuid ?? undefined, limit: 50 }, mode === 'portal')
  const entries = mode === 'portal' ? portalEntries.data : clubEntries.data

  const columns: ColumnDef<AccountEntryItem>[] = [
    { key: 'date', header: t('balanceDate'), sortable: true, className: 'min-w-[90px]', cell: (r) => <span className="text-sm text-slate-800">{formatDate(r.entry_date)}</span> },
    { key: 'journal', header: t('balanceJournal'), className: 'min-w-[60px]', cell: (r) => <span className="text-sm text-slate-700">{r.journal_code ?? '—'}</span> },
    { key: 'description', header: t('balanceDescription'), className: 'min-w-[200px]', cell: (r) => <span className="text-sm text-slate-700">{r.description ?? '—'}</span> },
    { key: 'reference', header: t('balanceRef'), className: 'min-w-[100px]', cell: (r) => <span className="text-sm font-mono text-slate-600">{r.reference ?? '—'}</span> },
    { key: 'state', header: t('balanceState'), className: 'min-w-[90px]', cell: (r) => { const b = stateBadge(r.state, t); return <span className={`rounded px-2 py-0.5 text-xs font-medium ${b.class}`}>{b.label}</span> } },
    { key: 'debit', header: t('balanceDebit'), className: 'min-w-[90px] text-right', cell: (r) => <span className="text-sm text-slate-700">{formatEuro(r.debit)}</span> },
    { key: 'credit', header: t('balanceCredit'), className: 'min-w-[90px] text-right', cell: (r) => <span className="text-sm text-slate-700">{formatEuro(r.credit)}</span> },
  ]

  return (
    <div className="space-y-4">
      <BalanceCards summary={summary} t={t} />
      <DepositSection memberUuid={memberUuid} mode={mode} t={t} />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <DataTable
          columns={columns}
          data={entries?.items ?? []}
          getRowKey={(r) => r.entry_uuid}
          defaultSortKey="date"
          emptyState={<div className="p-8 text-center text-sm text-slate-500">{t('balanceEmpty')}</div>}
        />
      </div>
    </div>
  )
}
