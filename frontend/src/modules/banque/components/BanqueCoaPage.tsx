/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Chart of accounts browser – hierarchical by class, collapsible sections
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

import { useCapability } from '../../../auth/hooks/useCapability'
import { useAccountsQuery, type AccountOption } from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Account type number → translation key suffix */
function accountTypeKey(type: number): string {
  const map: Record<number, string> = {
    1: 'asset',
    2: 'liability',
    3: 'equity',
    4: 'expense',
    5: 'revenue',
  }
  return map[type] ?? 'unknown'
}

/** Label for require_id */
function requireIdLabel(requireId: number | undefined, t: (k: string) => string): string | null {
  switch (requireId) {
    case 1: return t('pcg.requireId.member')
    case 2: return t('pcg.requireId.asset')
    case 3: return t('pcg.requireId.supplier')
    default: return null
  }
}

/** Badge color per require_id */
function requireIdBadgeClass(requireId: number | undefined): string {
  switch (requireId) {
    case 1: return 'bg-blue-100 text-blue-700'
    case 2: return 'bg-amber-100 text-amber-700'
    case 3: return 'bg-violet-100 text-violet-700'
    default: return ''
  }
}

/** Badge color per account type */
function accountTypeBadgeClass(type: number): string {
  const map: Record<number, string> = {
    1: 'bg-blue-100 text-blue-700',
    2: 'bg-red-100 text-red-700',
    3: 'bg-purple-100 text-purple-700',
    4: 'bg-orange-100 text-orange-700',
    5: 'bg-teal-100 text-teal-700',
  }
  return map[type] ?? 'bg-slate-100 text-slate-600'
}

/** Returns the PCG class digit (first char of code, '1'–'7') */
function accountClass(code: string): string {
  return code.charAt(0)
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BanqueCoaPage() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const canManage = useCapability('MANAGE_SYSTEM_SETTINGS')

  const accountsQuery = useAccountsQuery(canView)
  const accounts = useMemo(
    () => [...(accountsQuery.data ?? [])].sort((a, b) => a.code.localeCompare(b.code)),
    [accountsQuery.data],
  )

  // Group accounts by class digit
  const classes = useMemo(() => {
    const map = new Map<string, AccountOption[]>()
    for (const account of accounts) {
      const cls = accountClass(account.code)
      const arr = map.get(cls) ?? []
      arr.push(account)
      map.set(cls, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [accounts])

  // Track which classes are expanded (default: all open)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggleClass(cls: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cls)) {
        next.delete(cls)
      } else {
        next.add(cls)
      }
      return next
    })
  }

  if (!canView) {
    return (
      <section className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
        </div>
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
            <h1 className="text-xl font-semibold text-slate-900">{t('coa.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('coa.description')}</p>
          </div>
          {canManage && (
            <Link
              to="/banque/pcg"
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              {t('coa.openPcg')}
            </Link>
          )}
        </div>
        {accounts.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            {accounts.length} {t('coa.accountCount')}
          </p>
        )}
      </div>

      {/* Account tree */}
      {accountsQuery.isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">{t('settings.loading')}</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">{t('coa.empty')}</p>
          {canManage && (
            <Link to="/banque/pcg" className="mt-2 text-sm text-blue-600 hover:underline">
              {t('coa.openPcg')} →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {classes.map(([cls, classAccounts]) => {
            const isCollapsed = collapsed.has(cls)
            return (
              <div
                key={cls}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                {/* Class header — clickable toggle */}
                <button
                  type="button"
                  onClick={() => toggleClass(cls)}
                  className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 font-mono text-sm font-bold text-slate-700">
                      {cls}
                    </span>
                    <div>
                      <span className="font-semibold text-slate-800">
                        {t(`coa.classes.${cls}`)}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">
                        ({classAccounts.length})
                      </span>
                    </div>
                  </div>
                  <span className="text-slate-400">{isCollapsed ? '▸' : '▾'}</span>
                </button>

                {/* Account rows */}
                {!isCollapsed && (
                  <div className="border-t border-slate-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                          <th className="px-6 py-2 text-left font-medium">{t('coa.colCode')}</th>
                          <th className="px-4 py-2 text-left font-medium">{t('coa.colName')}</th>
                          <th className="px-4 py-2 text-left font-medium">{t('coa.colType')}</th>
                          <th className="px-4 py-2 text-left font-medium">{t('pcg.columns.requireId')}</th>
                          <th className="px-4 py-2 text-center font-medium">{t('coa.colPosting')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classAccounts.map((account) => (
                          <tr
                            key={account.uuid}
                            className="border-b border-slate-50 hover:bg-slate-50"
                          >
                            <td className="px-6 py-2 font-mono text-slate-800">{account.code}</td>
                            <td className="px-4 py-2 text-slate-700">{account.name}</td>
                            <td className="px-4 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${accountTypeBadgeClass(account.type)}`}
                              >
                                {t(`coa.types.${accountTypeKey(account.type)}`)}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              {requireIdLabel(account.require_id, t) && (
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${requireIdBadgeClass(account.require_id)}`}>
                                  {requireIdLabel(account.require_id, t)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {account.is_posting_allowed ? (
                                <span className="text-teal-600" title={t('coa.postingAllowed')}>
                                  ✓
                                </span>
                              ) : (
                                <span className="text-slate-300" title={t('coa.postingDenied')}>
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
