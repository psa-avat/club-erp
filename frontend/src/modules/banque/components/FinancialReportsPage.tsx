/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Financial reports – Income Statement and Balance Sheet
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
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'

import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountBalancesQuery,
  useFiscalYearsQuery,
  type AccountBalance,
  type FiscalYear,
} from '../api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'

// ── Constants ─────────────────────────────────────────────────────────────────
// Account types as per AccountBase schema: 1=Asset 2=Liability 3=Equity 4=Expense 5=Revenue
const TYPE_ASSET = 1
const TYPE_LIABILITY = 2
const TYPE_EQUITY = 3
const TYPE_EXPENSE = 4
const TYPE_REVENUE = 5

// ── Helpers ───────────────────────────────────────────────────────────────────

function d(value: string | null | undefined): Decimal {
  if (!value) return new Decimal(0)
  try { return new Decimal(value) } catch { return new Decimal(0) }
}

function fmt(value: Decimal): string {
  return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')
}

function fmtWithSign(value: Decimal): string {
  const s = fmt(value.abs())
  return value.isNegative() ? `(${s})` : s
}

// Group accounts by first digit of code (class 1–7 in PCG)
function getClass(code: string): string {
  return code.charAt(0)
}

function groupByClass(accounts: AccountBalance[]): Map<string, AccountBalance[]> {
  const map = new Map<string, AccountBalance[]>()
  for (const acc of accounts) {
    const cls = getClass(acc.code)
    const list = map.get(cls) ?? []
    list.push(acc)
    map.set(cls, list)
  }
  return map
}

// ── Income Statement ──────────────────────────────────────────────────────────

function IncomeStatement({
  balances,
  t,
}: {
  balances: AccountBalance[]
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const revenues = balances.filter((a) => a.type === TYPE_REVENUE)
  const expenses = balances.filter((a) => a.type === TYPE_EXPENSE)

  const revenueByClass = groupByClass(revenues)
  const expenseByClass = groupByClass(expenses)

  // Revenue: credit normal balance → positive = credit > debit
  const totalRevenue = revenues.reduce(
    (sum, a) => sum.plus(d(a.total_credit).minus(d(a.total_debit))),
    new Decimal(0),
  )

  // Expenses: debit normal balance → positive = debit > credit
  const totalExpenses = expenses.reduce(
    (sum, a) => sum.plus(d(a.total_debit).minus(d(a.total_credit))),
    new Decimal(0),
  )

  const netResult = totalRevenue.minus(totalExpenses)

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('reports.income.totalRevenue')}
          </p>
          <p className="mt-2 font-mono text-2xl font-bold text-teal-700">{fmt(totalRevenue)} €</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('reports.income.totalExpenses')}
          </p>
          <p className="mt-2 font-mono text-2xl font-bold text-rose-700">{fmt(totalExpenses)} €</p>
        </div>
        <div
          className={`rounded-xl border p-5 shadow-sm ${
            netResult.gte(0)
              ? 'border-teal-200 bg-teal-50'
              : 'border-rose-200 bg-rose-50'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('reports.income.netResult')}
          </p>
          <p
            className={`mt-2 font-mono text-2xl font-bold ${
              netResult.gte(0) ? 'text-teal-800' : 'text-rose-800'
            }`}
          >
            {netResult.gte(0) ? '' : '−'}{fmt(netResult.abs())} €
          </p>
        </div>
      </div>

      {/* Detail table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('reports.table.account')}
              </th>
              <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('reports.table.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue section */}
            <tr className="border-t border-slate-200 bg-teal-50">
              <td colSpan={2} className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-teal-700">
                {t('reports.income.sectionRevenue')}
              </td>
            </tr>
            {Array.from(revenueByClass.entries()).map(([cls, accounts]) => {
              const classTotal = accounts.reduce(
                (sum, a) => sum.plus(d(a.total_credit).minus(d(a.total_debit))),
                new Decimal(0),
              )
              return [
                ...accounts.map((acc) => {
                  const amount = d(acc.total_credit).minus(d(acc.total_debit))
                  return (
                    <tr key={acc.account_uuid} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-5 py-2">
                        <span className="font-mono text-xs text-slate-400 mr-2">{acc.code}</span>
                        {acc.name}
                      </td>
                      <td className="px-5 py-2 text-right font-mono">{fmt(amount)} €</td>
                    </tr>
                  )
                }),
                <tr key={`rev-total-${cls}`} className="border-t border-teal-200 bg-teal-50/50">
                  <td className="px-5 py-2 text-sm font-semibold text-teal-700">
                    {t('reports.table.classTotal', { cls })}
                  </td>
                  <td className="px-5 py-2 text-right font-mono font-semibold text-teal-700">
                    {fmt(classTotal)} €
                  </td>
                </tr>,
              ]
            })}
            <tr className="border-t-2 border-teal-300 bg-teal-100">
              <td className="px-5 py-3 font-bold text-teal-800">{t('reports.income.totalRevenue')}</td>
              <td className="px-5 py-3 text-right font-mono font-bold text-teal-800">
                {fmt(totalRevenue)} €
              </td>
            </tr>

            {/* Expenses section */}
            <tr className="border-t border-slate-200 bg-rose-50">
              <td colSpan={2} className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-rose-700">
                {t('reports.income.sectionExpenses')}
              </td>
            </tr>
            {Array.from(expenseByClass.entries()).map(([cls, accounts]) => {
              const classTotal = accounts.reduce(
                (sum, a) => sum.plus(d(a.total_debit).minus(d(a.total_credit))),
                new Decimal(0),
              )
              return [
                ...accounts.map((acc) => {
                  const amount = d(acc.total_debit).minus(d(acc.total_credit))
                  return (
                    <tr key={acc.account_uuid} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-5 py-2">
                        <span className="font-mono text-xs text-slate-400 mr-2">{acc.code}</span>
                        {acc.name}
                      </td>
                      <td className="px-5 py-2 text-right font-mono">{fmt(amount)} €</td>
                    </tr>
                  )
                }),
                <tr key={`exp-total-${cls}`} className="border-t border-rose-200 bg-rose-50/50">
                  <td className="px-5 py-2 text-sm font-semibold text-rose-700">
                    {t('reports.table.classTotal', { cls })}
                  </td>
                  <td className="px-5 py-2 text-right font-mono font-semibold text-rose-700">
                    {fmt(classTotal)} €
                  </td>
                </tr>,
              ]
            })}
            <tr className="border-t-2 border-rose-300 bg-rose-100">
              <td className="px-5 py-3 font-bold text-rose-800">{t('reports.income.totalExpenses')}</td>
              <td className="px-5 py-3 text-right font-mono font-bold text-rose-800">
                {fmt(totalExpenses)} €
              </td>
            </tr>

            {/* Net result */}
            <tr
              className={`border-t-4 ${
                netResult.gte(0) ? 'border-teal-400 bg-teal-100' : 'border-rose-400 bg-rose-100'
              }`}
            >
              <td className="px-5 py-4 text-base font-bold text-slate-900">
                {t('reports.income.netResult')}
              </td>
              <td
                className={`px-5 py-4 text-right font-mono text-base font-bold ${
                  netResult.gte(0) ? 'text-teal-800' : 'text-rose-800'
                }`}
              >
                {netResult.gte(0) ? '' : '−'}{fmt(netResult.abs())} €
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────

function BalanceSheet({
  balances,
  t,
}: {
  balances: AccountBalance[]
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const assets = balances.filter((a) => a.type === TYPE_ASSET)
  const liabilities = balances.filter((a) => a.type === TYPE_LIABILITY)
  const equity = balances.filter((a) => a.type === TYPE_EQUITY)

  const assetsByClass = groupByClass(assets)
  const liabByClass = groupByClass(liabilities)
  const equityByClass = groupByClass(equity)

  // Assets: debit normal balance → net = debit − credit
  const totalAssets = assets.reduce(
    (sum, a) => sum.plus(d(a.total_debit).minus(d(a.total_credit))),
    new Decimal(0),
  )

  // Liabilities & equity: credit normal balance → net = credit − debit
  const totalLiabilities = liabilities.reduce(
    (sum, a) => sum.plus(d(a.total_credit).minus(d(a.total_debit))),
    new Decimal(0),
  )
  const totalEquity = equity.reduce(
    (sum, a) => sum.plus(d(a.total_credit).minus(d(a.total_debit))),
    new Decimal(0),
  )
  const totalPassif = totalLiabilities.plus(totalEquity)

  const isBalanced = totalAssets.minus(totalPassif).abs().lt('0.01')

  function renderSection(
    label: string,
    byClass: Map<string, AccountBalance[]>,
    getAmount: (a: AccountBalance) => Decimal,
    colorClass: string,
    borderClass: string,
    bgClass: string,
    totalLabel: string,
    total: Decimal,
  ) {
    return (
      <>
        <tr className={`border-t border-slate-200 ${bgClass}`}>
          <td colSpan={3} className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider ${colorClass}`}>
            {label}
          </td>
        </tr>
        {Array.from(byClass.entries()).map(([cls, accounts]) => {
          const classTotal = accounts.reduce((sum, a) => sum.plus(getAmount(a)), new Decimal(0))
          return [
            ...accounts.map((acc) => {
              const amount = getAmount(acc)
              return (
                <tr key={acc.account_uuid} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-1.5">
                    <span className="font-mono text-xs text-slate-400 mr-2">{acc.code}</span>
                    <span className="text-sm">{acc.name}</span>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-sm">
                    {fmtWithSign(amount)} €
                  </td>
                  <td />
                </tr>
              )
            }),
            <tr key={`total-${cls}`} className={`border-t ${borderClass} ${bgClass} opacity-80`}>
              <td className={`px-4 py-1.5 text-xs font-semibold ${colorClass}`}>
                {t('reports.table.classTotal', { cls })}
              </td>
              <td className={`px-4 py-1.5 text-right font-mono text-xs font-semibold ${colorClass}`}>
                {fmtWithSign(classTotal)} €
              </td>
              <td />
            </tr>,
          ]
        })}
        <tr className={`border-t-2 ${borderClass}`}>
          <td className="px-4 py-3 font-bold">{totalLabel}</td>
          <td className="px-4 py-3 text-right font-mono font-bold">{fmt(total)} €</td>
          <td />
        </tr>
      </>
    )
  }

  return (
    <div className="space-y-6">
      {/* Balance indicator */}
      <div
        className={`flex items-center gap-3 rounded-xl border p-4 ${
          isBalanced
            ? 'border-teal-200 bg-teal-50 text-teal-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
      >
        <span className="text-lg">{isBalanced ? '✓' : '⚠'}</span>
        <div>
          <p className="font-semibold">
            {isBalanced ? t('reports.balance.balanced') : t('reports.balance.unbalanced')}
          </p>
          <p className="text-sm">
            {t('reports.balance.assets')}: {fmt(totalAssets)} € &nbsp;·&nbsp;
            {t('reports.balance.passif')}: {fmt(totalPassif)} €
          </p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Actif */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-indigo-600 px-5 py-3">
            <p className="font-bold text-white">{t('reports.balance.actif')}</p>
            <p className="font-mono text-sm text-indigo-200">{fmt(totalAssets)} €</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {renderSection(
                t('reports.balance.sectionAssets'),
                assetsByClass,
                (a) => d(a.total_debit).minus(d(a.total_credit)),
                'text-indigo-700',
                'border-indigo-200',
                'bg-indigo-50/40',
                t('reports.balance.totalAssets'),
                totalAssets,
              )}
            </tbody>
          </table>
        </div>

        {/* Passif */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-slate-700 px-5 py-3">
            <p className="font-bold text-white">{t('reports.balance.passif')}</p>
            <p className="font-mono text-sm text-slate-300">{fmt(totalPassif)} €</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {renderSection(
                t('reports.balance.sectionEquity'),
                equityByClass,
                (a) => d(a.total_credit).minus(d(a.total_debit)),
                'text-emerald-700',
                'border-emerald-200',
                'bg-emerald-50/40',
                t('reports.balance.totalEquity'),
                totalEquity,
              )}
              {renderSection(
                t('reports.balance.sectionLiabilities'),
                liabByClass,
                (a) => d(a.total_credit).minus(d(a.total_debit)),
                'text-slate-700',
                'border-slate-200',
                'bg-slate-50/40',
                t('reports.balance.totalLiabilities'),
                totalLiabilities,
              )}
              <tr className="border-t-4 border-slate-400 bg-slate-100">
                <td colSpan={3} className="px-4 py-3 font-bold">
                  {t('reports.balance.totalPassif')} &nbsp; {fmt(totalPassif)} €
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'income' | 'balance'

export function FinancialReportsPage() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const [activeTab, setActiveTab] = useState<Tab>('income')
  const [postedOnly, setPostedOnly] = useState(false)

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const activeFiscalYearData = useFiscalYearStore((s) => s.activeFiscalYearData)

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const fiscalYears = fiscalYearsQuery.data ?? []

  const [selectedFyUuid, setSelectedFyUuid] = useState<string | null>(null)
  const effectiveFyUuid = selectedFyUuid ?? activeFiscalYearUuid

  const selectedFy = useMemo(
    () => fiscalYears.find((fy) => fy.uuid === effectiveFyUuid) ?? (activeFiscalYearData as FiscalYear | null),
    [fiscalYears, effectiveFyUuid, activeFiscalYearData],
  )

  const balancesQuery = useAccountBalancesQuery(effectiveFyUuid, postedOnly, canView)
  const balances = balancesQuery.data ?? []

  const tabClass = (tab: Tab) =>
    `rounded-t-lg border px-5 py-2.5 text-sm font-medium transition-colors ${
      activeTab === tab
        ? 'border-b-white border-slate-200 bg-white text-slate-900'
        : 'border-transparent bg-transparent text-slate-500 hover:text-slate-700'
    }`

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2">
          <Link to="/banque" className="text-xs text-slate-400 hover:text-slate-600">
            ← {t('journal.back')}
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('reports.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('reports.description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* FY selector */}
            <select
              value={effectiveFyUuid ?? ''}
              onChange={(e) => setSelectedFyUuid(e.target.value || null)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value="">{t('reports.selectFy')}</option>
              {fiscalYears.map((fy) => (
                <option key={fy.uuid} value={fy.uuid}>
                  {fy.code} · {fy.start_date} → {fy.end_date}
                </option>
              ))}
            </select>
            {/* Posted-only toggle */}
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={postedOnly}
                onChange={(e) => setPostedOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t('reports.postedOnly')}
            </label>
          </div>
        </div>
        {selectedFy && (
          <p className="mt-2 text-xs text-slate-400">
            {selectedFy.start_date} → {selectedFy.end_date}
            {postedOnly && (
              <span className="ml-2 rounded-full bg-success-container px-2 py-0.5 text-on-success-container">
                {t('reports.postedOnlyBadge')}
              </span>
            )}
          </p>
        )}
      </div>

      {!effectiveFyUuid ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          {t('reports.noFySelected')}
        </div>
      ) : balancesQuery.isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          {t('settings.loading')}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="-mb-px flex gap-1">
            <button type="button" className={tabClass('income')} onClick={() => setActiveTab('income')}>
              {t('reports.tabs.income')}
            </button>
            <button type="button" className={tabClass('balance')} onClick={() => setActiveTab('balance')}>
              {t('reports.tabs.balance')}
            </button>
          </div>

          <div className="rounded-b-xl rounded-tr-xl">
            {activeTab === 'income' ? (
              <IncomeStatement balances={balances} t={t} />
            ) : (
              <BalanceSheet balances={balances} t={t} />
            )}
          </div>
        </>
      )}
    </section>
  )
}
