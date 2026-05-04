/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Accounting dashboard – FY hero bar, entry stats, journal activity, recent entries
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

import { Button } from '../../../components/ui/button'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountingEntriesQuery,
  useFiscalYearsQuery,
  useJournalsQuery,
  type AccountingEntry,
} from '../api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { AccountingImportDialog } from './AccountingImportDialog'
import {
  ENTRY_STATE_DRAFT,
  ENTRY_STATE_POSTED,
  entryStateBadgeClass,
  entryStateLabel,
  decimalOrZero,
} from './journalShared'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fyStateBadgeClass(state: number): string {
  if (state === 1) return 'bg-teal-100 text-teal-700'
  if (state === 3) return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

function fyStateLabel(state: number, t: (key: string) => string): string {
  if (state === 1) return t('pricing.fy.stateOpen')
  if (state === 3) return t('pricing.fy.stateReopened')
  return t('pricing.fy.stateClosed')
}

function sumDebit(entries: AccountingEntry[]): Decimal {
  return entries.reduce(
    (sum, entry) => entry.lines.reduce((s, line) => s.plus(decimalOrZero(line.debit)), sum),
    new Decimal(0),
  )
}

function sumCredit(entries: AccountingEntry[]): Decimal {
  return entries.reduce(
    (sum, entry) => entry.lines.reduce((s, line) => s.plus(decimalOrZero(line.credit)), sum),
    new Decimal(0),
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BanqueDashboardPage() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')

  const [importOpen, setImportOpen] = useState(false)

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const activeFiscalYearData = useFiscalYearStore((s) => s.activeFiscalYearData)

  const fyEnabled = canView && Boolean(activeFiscalYearUuid)

  const draftQuery = useAccountingEntriesQuery(
    { fiscal_year_uuid: activeFiscalYearUuid ?? undefined, state: ENTRY_STATE_DRAFT, limit: 500 },
    fyEnabled,
  )
  const postedQuery = useAccountingEntriesQuery(
    { fiscal_year_uuid: activeFiscalYearUuid ?? undefined, state: ENTRY_STATE_POSTED, limit: 500 },
    fyEnabled,
  )
  const journalsQuery = useJournalsQuery(canView)
  const fiscalYearsQuery = useFiscalYearsQuery(canView)

  const draftEntries = draftQuery.data ?? []
  const postedEntries = postedQuery.data ?? []
  const journals = journalsQuery.data ?? []
  const fiscalYears = fiscalYearsQuery.data ?? []

  const loading = draftQuery.isLoading || postedQuery.isLoading

  // Totals for draft entries only
  const draftDebits = useMemo(() => sumDebit(draftEntries), [draftEntries])
  const draftCredits = useMemo(() => sumCredit(draftEntries), [draftEntries])
  
  // Totals for posted entries only
  const postedDebits = useMemo(() => sumDebit(postedEntries), [postedEntries])
  const postedCredits = useMemo(() => sumCredit(postedEntries), [postedEntries])
  
  // Overall totals (draft + posted)
  const totalDebits = useMemo(() => draftDebits.plus(postedDebits), [draftDebits, postedDebits])
  const totalCredits = useMemo(() => draftCredits.plus(postedCredits), [draftCredits, postedCredits])

  const journalActivity = useMemo(() => {
    const map = new Map<string, { name: string; code: string; count: number; debit: Decimal }>()
    for (const entry of postedEntries) {
      const j = journals.find((jj) => jj.uuid === entry.journal_uuid)
      if (!j) continue
      const existing = map.get(j.uuid) ?? { name: j.name, code: j.code, count: 0, debit: new Decimal(0) }
      const entryDebit = entry.lines.reduce(
        (sum, line) => sum.plus(decimalOrZero(line.debit)),
        new Decimal(0),
      )
      map.set(j.uuid, { ...existing, count: existing.count + 1, debit: existing.debit.plus(entryDebit) })
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  }, [postedEntries, journals])

  const lastPosted = useMemo(() => {
    const sorted = [...postedEntries].sort(
      (a, b) => (b.sequence_number ?? '').localeCompare(a.sequence_number ?? ''),
    )
    return sorted[0] ?? null
  }, [postedEntries])

  const recentEntries = useMemo(
    () =>
      [...draftEntries, ...postedEntries]
        .sort(
          (a, b) =>
            b.entry_date.localeCompare(a.entry_date) ||
            (b.created_at ?? '').localeCompare(a.created_at ?? ''),
        )
        .slice(0, 10),
    [draftEntries, postedEntries],
  )

  return (
    <section className="space-y-4">
      {/* FY Hero Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2">
          <Link to="/banque" className="text-xs text-slate-400 hover:text-slate-600">
            ← {t('journal.back')}
          </Link>
        </div>
        {activeFiscalYearData ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-slate-900">{activeFiscalYearData.code}</h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${fyStateBadgeClass(activeFiscalYearData.state)}`}
                >
                  {fyStateLabel(activeFiscalYearData.state, t)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {activeFiscalYearData.start_date} → {activeFiscalYearData.end_date}
                {lastPosted && (
                  <span className="ml-3 text-slate-400">
                    · {t('dashboard.fyHero.lastPosted')}:{' '}
                    <span className="font-mono text-slate-600">{lastPosted.sequence_number}</span>
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {canPost && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
                  {t('journal.import.openBtn')}
                </Button>
              )}
              <Link to="/banque/journal/entry/new">
                <Button type="button" size="sm">
                  {t('dashboard.actions.newEntry')}
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t('dashboard.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('dashboard.fyHero.noFy')}</p>
          </div>
        )}
      </div>

      {/* 4-up stat cards */}
      {activeFiscalYearUuid && (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('dashboard.cards.drafts')}
            </p>
            <p className="mt-2 text-3xl font-bold text-amber-600">
              {loading ? '—' : draftEntries.length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('dashboard.cards.posted')}
            </p>
            <p className="mt-2 text-3xl font-bold text-teal-700">
              {loading ? '—' : postedEntries.length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('dashboard.cards.totalDebits')}
            </p>
            <p className="mt-2 font-mono text-xl font-bold text-slate-800">
              {loading ? '—' : totalDebits.toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('dashboard.cards.totalCredits')}
            </p>
            <p className="mt-2 font-mono text-xl font-bold text-slate-800">
              {loading ? '—' : totalCredits.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Journal activity + Recent entries */}
      {activeFiscalYearUuid && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Journal activity breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-800">{t('dashboard.journals.title')}</h2>
            {loading ? (
              <p className="mt-4 text-sm text-slate-500">{t('settings.loading')}</p>
            ) : journalActivity.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t('dashboard.journals.empty')}</p>
            ) : (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">{t('journal.entries.journal')}</th>
                    <th className="pb-2 text-right font-medium">{t('dashboard.journals.entries')}</th>
                    <th className="pb-2 text-right font-medium">{t('journal.forms.debit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {journalActivity.map((row) => (
                    <tr key={row.code} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-2">
                        <span className="mr-2 font-mono text-xs text-slate-400">{row.code}</span>
                        {row.name}
                      </td>
                      <td className="py-2 text-right font-medium text-teal-700">{row.count}</td>
                      <td className="py-2 text-right font-mono text-slate-700">
                        {row.debit.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent entries */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-800">
              {t('dashboard.recentEntries.title')}
            </h2>
            {loading ? (
              <p className="mt-4 text-sm text-slate-500">{t('settings.loading')}</p>
            ) : recentEntries.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t('dashboard.recentEntries.empty')}</p>
            ) : (
              <div className="mt-4 space-y-2">
                {recentEntries.map((entry) => (
                  <Link
                    key={entry.uuid}
                    to={`/banque/journal/entry/${entry.uuid}`}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <span className="block truncate font-medium text-slate-800">
                        {entry.description}
                      </span>
                      <span className="text-xs text-slate-500">
                        {entry.entry_date} ·{' '}
                        {entry.sequence_number ?? t('journal.entries.draftSequence')}
                      </span>
                    </div>
                    <span
                      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${entryStateBadgeClass(entry.state)}`}
                    >
                      {entryStateLabel(entry.state, t)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AccountingImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        fiscalYears={fiscalYears}
        journals={journals}
        defaultFiscalYearUuid={activeFiscalYearUuid ?? undefined}
      />
    </section>
  )
}
