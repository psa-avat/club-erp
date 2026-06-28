/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Trial balance – all accounts with debit, credit and balance per fiscal year
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

import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountBalancesQuery,
  useFiscalYearsQuery,
  type AccountBalance,
} from '../api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'

// ── Helpers ───────────────────────────────────────────────────────────────────

function d(value: string | null | undefined): Decimal {
  if (!value) return new Decimal(0)
  try { return new Decimal(value) } catch { return new Decimal(0) }
}

function fmt(value: Decimal): string {
  return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function accountClass(code: string): string {
  return code.charAt(0)
}

function groupByClass(accounts: AccountBalance[]): Map<string, AccountBalance[]> {
  const map = new Map<string, AccountBalance[]>()
  for (const acc of accounts) {
    const cls = accountClass(acc.code)
    const list = map.get(cls) ?? []
    list.push(acc)
    map.set(cls, list)
  }
  return map
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AccountTrialBalancePage() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const activeFiscalYearData = useFiscalYearStore((s) => s.activeFiscalYearData)

  const [selectedFyUuid, setSelectedFyUuid] = useState<string | null>(null)
  const [postedOnly, setPostedOnly] = useState(true)

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const fiscalYears = fiscalYearsQuery.data ?? []

  const effectiveFyUuid = selectedFyUuid ?? activeFiscalYearUuid

  const selectedFy = useMemo(
    () => fiscalYears.find((fy) => fy.uuid === effectiveFyUuid) ?? activeFiscalYearData,
    [fiscalYears, effectiveFyUuid, activeFiscalYearData],
  )

  const balancesQuery = useAccountBalancesQuery(effectiveFyUuid, postedOnly, canView)
  const balances = useMemo(
    () => [...(balancesQuery.data ?? [])].sort((a, b) => a.code.localeCompare(b.code)),
    [balancesQuery.data],
  )

  const byClass = useMemo(() => {
    return Array.from(groupByClass(balances).entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [balances])

  const totalDebit = useMemo(
    () => balances.reduce((sum, a) => sum.plus(d(a.total_debit)), new Decimal(0)),
    [balances],
  )
  const totalCredit = useMemo(
    () => balances.reduce((sum, a) => sum.plus(d(a.total_credit)), new Decimal(0)),
    [balances],
  )
  const totalBalance = totalDebit.minus(totalCredit)

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t('trialBalance.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('trialBalance.description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
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
            {(selectedFy as { start_date: string; end_date: string }).start_date}
            {' → '}
            {(selectedFy as { start_date: string; end_date: string }).end_date}
            {postedOnly && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
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
      ) : balances.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
          {t('coa.empty')}
        </div>
      ) : (
        <>
          {/* Per-class tables */}
          <div className="space-y-2">
            {byClass.map(([cls, classAccounts]) => {
              const classDebit = classAccounts.reduce((s, a) => s.plus(d(a.total_debit)), new Decimal(0))
              const classCredit = classAccounts.reduce((s, a) => s.plus(d(a.total_credit)), new Decimal(0))
              const classBalance = classDebit.minus(classCredit)

              return (
                <div
                  key={cls}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  {/* Class header */}
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 font-mono text-sm font-bold text-slate-700">
                        {cls}
                      </span>
                      <span className="font-semibold text-slate-800">
                        {t(`coa.classes.${cls}`)}
                      </span>
                      <span className="text-xs text-slate-400">({classAccounts.length})</span>
                    </div>
                    <div className="flex gap-8 font-mono text-xs text-slate-500">
                      <span>{fmt(classDebit)}</span>
                      <span>{fmt(classCredit)}</span>
                      <span className={classBalance.isNegative() ? 'text-rose-600' : 'text-slate-700'}>
                        {classBalance.isNegative() ? '(' : ''}{fmt(classBalance.abs())}{classBalance.isNegative() ? ')' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Account rows */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-400">
                        <th className="px-5 py-2 text-left font-medium">{t('trialBalance.colCode')}</th>
                        <th className="px-4 py-2 text-left font-medium">{t('trialBalance.colName')}</th>
                        <th className="px-4 py-2 text-right font-medium">{t('trialBalance.colDebit')}</th>
                        <th className="px-4 py-2 text-right font-medium">{t('trialBalance.colCredit')}</th>
                        <th className="px-4 py-2 text-right font-medium">{t('trialBalance.colBalance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classAccounts.map((acc) => {
                        const bal = d(acc.balance)
                        return (
                          <tr
                            key={acc.account_uuid}
                            className="border-b border-slate-50 hover:bg-slate-50"
                          >
                            <td className="px-5 py-2 font-mono text-slate-600">{acc.code}</td>
                            <td className="px-4 py-2 text-slate-700">{acc.name}</td>
                            <td className="px-4 py-2 text-right font-mono text-slate-700">
                              {d(acc.total_debit).isZero() ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                fmt(d(acc.total_debit))
                              )}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-slate-700">
                              {d(acc.total_credit).isZero() ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                fmt(d(acc.total_credit))
                              )}
                            </td>
                            <td
                              className={`px-4 py-2 text-right font-mono font-medium ${
                                bal.isZero()
                                  ? 'text-slate-300'
                                  : bal.isNegative()
                                    ? 'text-rose-600'
                                    : 'text-slate-900'
                              }`}
                            >
                              {bal.isZero()
                                ? '—'
                                : bal.isNegative()
                                  ? `(${fmt(bal.abs())})`
                                  : fmt(bal)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>

          {/* Grand total */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t-2 border-slate-300 bg-slate-50">
                  <td className="px-5 py-3 font-bold text-slate-800" colSpan={2}>
                    {t('trialBalance.grandTotal')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                    {fmt(totalDebit)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                    {fmt(totalCredit)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-bold ${
                      totalBalance.isZero()
                        ? 'text-slate-400'
                        : totalBalance.isNegative()
                          ? 'text-rose-700'
                          : 'text-slate-900'
                    }`}
                  >
                    {totalBalance.isZero()
                      ? '—'
                      : totalBalance.isNegative()
                        ? `(${fmt(totalBalance.abs())})`
                        : fmt(totalBalance)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
