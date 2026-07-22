/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Onglet Ventes membres — facturation et recouvrement (Phase 3)
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
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'

import { Button } from '../../../components/ui/button'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountingEntriesQuery,
  useAccountBalancesQuery,
  useJournalsQuery,
  type AccountingEntry,
  type AccountBalance,
  type JournalOption,
} from '../api'
import {
  ENTRY_STATE_DRAFT,
  ENTRY_STATE_POSTED,
  OPS_STATUS,
  type OpsStatus,
  opsStatusBadgeClass,
  opsStatusLabel,
} from './journalShared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpsSalesTabProps {
  fiscalYearUuid: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OVERDUE_DAYS = 30

function formatAmount(amount: Decimal): string {
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

function daysOld(entryDate: string): number {
  const diff = Date.now() - new Date(entryDate).getTime()
  return Math.floor(diff / 86_400_000)
}

function deriveArStatus(entry: AccountingEntry): OpsStatus {
  if (entry.state === ENTRY_STATE_DRAFT) return OPS_STATUS.DRAFT
  if (entry.state === ENTRY_STATE_POSTED) {
    return daysOld(entry.entry_date) > OVERDUE_DAYS ? OPS_STATUS.OVERDUE : OPS_STATUS.PENDING
  }
  return OPS_STATUS.ARCHIVED
}

function entryTotalDebit(entry: AccountingEntry): Decimal {
  return entry.lines.reduce((sum, l) => sum.plus(new Decimal(l.debit)), new Decimal(0))
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ArRowProps {
  entry: AccountingEntry
  status: OpsStatus
  t: (key: string) => string
}

function ArRow({ entry, status, t }: ArRowProps) {
  const amount = entryTotalDebit(entry)
  const age = daysOld(entry.entry_date)

  return (
    <tr className="group border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-slate-800 truncate max-w-xs">
        {entry.description}
      </td>
      <td className="px-2 py-2.5 text-xs text-slate-500">
        {entry.reference ?? '—'}
      </td>
      <td className="px-2 py-2.5 text-xs text-slate-500 tabular-nums">
        {entry.entry_date}
      </td>
      <td className="px-2 py-2.5 text-xs tabular-nums">
        {entry.state === ENTRY_STATE_POSTED ? (
          <span className={age > OVERDUE_DAYS ? 'font-semibold text-error' : 'text-slate-500'}>
            {age}j
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-right text-sm font-mono tabular-nums text-slate-700">
        {formatAmount(amount)}
      </td>
      <td className="px-2 py-2.5">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${opsStatusBadgeClass(status)}`}>
          {opsStatusLabel(status, t)}
        </span>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Member debtors section (from account balances)
// ---------------------------------------------------------------------------

interface DebtorRowProps {
  balance: AccountBalance
  t: (key: string) => string
}

function DebtorRow({ balance, t }: DebtorRowProps) {
  const bal = new Decimal(balance.balance)
  const isDebtor = bal.gt(0)
  if (!isDebtor) return null

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="py-2 pl-4 pr-2 text-sm font-medium text-slate-800">
        {balance.code}
      </td>
      <td className="px-2 py-2 text-sm text-slate-700 truncate max-w-xs">
        {balance.name}
      </td>
      <td className="px-2 py-2 text-right font-mono text-sm tabular-nums">
        <span className={bal.gt(0) ? 'text-error font-semibold' : 'text-slate-500'}>
          {formatAmount(bal)}
        </span>
      </td>
      <td className="py-2 pl-2 pr-4 text-right">
        <span className="text-xs text-slate-400">{t('ops.sales.debtors.backendGap')}</span>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function OpsSalesTab({ fiscalYearUuid }: OpsSalesTabProps) {
  const { t } = useTranslation('banque')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')

  const navigate = useNavigate()
  const journalsQuery = useJournalsQuery()
  const [activeSection, setActiveSection] = useState<'invoices' | 'debtors'>('invoices')

  // Resolve VT journal
  const vtJournal = useMemo<JournalOption | null>(
    () => journalsQuery.data?.find((j) => j.code === 'VT') ?? null,
    [journalsQuery.data],
  )

  // Fetch VT entries
  const entriesQuery = useAccountingEntriesQuery(
    {
      fiscal_year_uuid: fiscalYearUuid,
      journal_uuid: vtJournal?.uuid,
      limit: 200,
    },
    Boolean(vtJournal && fiscalYearUuid),
  )

  // Fetch account balances for 411 (member receivables)
  const balancesQuery = useAccountBalancesQuery(fiscalYearUuid, true, Boolean(fiscalYearUuid))

  const entries = entriesQuery.data ?? []
  const allBalances = balancesQuery.data ?? []

  // Member receivable accounts (411x) with positive balance (members who owe)
  const debtorBalances = useMemo(
    () => allBalances.filter((b) => b.code.startsWith('411') && new Decimal(b.balance).gt(0)),
    [allBalances],
  )

  // Summary KPIs
  const { overdueCount, arTotal, draftCount } = useMemo(() => {
    let overdueCount = 0
    let arTotal = new Decimal(0)
    let draftCount = 0
    for (const e of entries) {
      const s = deriveArStatus(e)
      const amt = entryTotalDebit(e)
      if (s === OPS_STATUS.OVERDUE) { overdueCount++; arTotal = arTotal.plus(amt) }
      else if (s === OPS_STATUS.PENDING) arTotal = arTotal.plus(amt)
      else if (s === OPS_STATUS.DRAFT) draftCount++
    }
    return { overdueCount, arTotal, draftCount }
  }, [entries])

  const debtorTotal = useMemo(
    () => debtorBalances.reduce((sum, b) => sum.plus(new Decimal(b.balance)), new Decimal(0)),
    [debtorBalances],
  )

  const isLoading = journalsQuery.isLoading || entriesQuery.isLoading

  // ── Render ────────────────────────────────────────────────────────────────

  if (!vtJournal && !journalsQuery.isLoading) {
    return (
      <div className="rounded-lg bg-warning/15 px-4 py-3 text-sm text-warning">
        {t('ops.sales.noVtJournal')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{t('ops.sales.kpi.overdue')}</p>
          <p className={`mt-1 text-2xl font-bold ${overdueCount > 0 ? 'text-error' : 'text-slate-700'}`}>
            {overdueCount}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{t('ops.sales.kpi.arTotal')}</p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-700">
            {formatAmount(arTotal)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{t('ops.sales.kpi.draft')}</p>
          <p className="mt-1 text-2xl font-bold text-slate-700">{draftCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{t('ops.sales.kpi.debtors')}</p>
          <p className={`mt-1 text-2xl font-bold font-mono ${debtorTotal.gt(0) ? 'text-error' : 'text-slate-700'}`}>
            {formatAmount(debtorTotal)}
          </p>
        </div>
      </div>

      {/* Section toggle + CTA */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(['invoices', 'debtors'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setActiveSection(s)}
              className={[
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                activeSection === s
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              {t(`ops.sales.sections.${s}`)}
            </button>
          ))}
        </div>
        {canPost && vtJournal && (
          <Button size="sm" onClick={() => navigate('/banque/facturation-membres')}>
            + {t('ops.sales.newInvoice')}
          </Button>
        )}
      </div>

      {/* AR Invoices section */}
      {activeSection === 'invoices' && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-slate-400">
              {t('ops.loading')}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <p className="text-sm text-slate-500">{t('ops.sales.empty')}</p>
              {canPost && vtJournal && (
                <Button size="sm" variant="secondary" onClick={() => navigate('/banque/facturation-membres')}>
                  {t('ops.sales.newInvoice')}
                </Button>
              )}
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="py-2 pl-4 pr-2">{t('ops.sales.col.description')}</th>
                  <th className="px-2 py-2">{t('ops.sales.col.ref')}</th>
                  <th className="px-2 py-2">{t('ops.sales.col.date')}</th>
                  <th className="px-2 py-2">{t('ops.sales.col.age')}</th>
                  <th className="px-2 py-2 text-right">{t('ops.sales.col.amount')}</th>
                  <th className="px-2 py-2">{t('ops.sales.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <ArRow
                    key={entry.uuid}
                    entry={entry}
                    status={deriveArStatus(entry)}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Debtors section */}
      {activeSection === 'debtors' && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {balancesQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-slate-400">
              {t('ops.loading')}
            </div>
          ) : debtorBalances.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-slate-500">{t('ops.sales.debtors.empty')}</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="py-2 pl-4 pr-2">{t('ops.sales.debtors.col.code')}</th>
                  <th className="px-2 py-2">{t('ops.sales.debtors.col.name')}</th>
                  <th className="px-2 py-2 text-right">{t('ops.sales.debtors.col.balance')}</th>
                  <th className="py-2 pl-2 pr-4 text-right">{t('ops.sales.debtors.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {debtorBalances.map((b) => (
                  <DebtorRow key={b.account_uuid} balance={b} t={t} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

    </div>
  )
}
