/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Grand livre – per-account ledger with running balance
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

import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountsQuery,
  useAccountingEntriesQuery,
  useFiscalYearsQuery,
  useJournalsQuery,
  type AccountOption,
} from '../api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { ENTRY_STATE_POSTED } from './journalShared'

// ── Types ─────────────────────────────────────────────────────────────────────

type LedgerLine = {
  entry_uuid: string
  entry_date: string
  journal_code: string
  sequence_number: string | null
  entry_description: string
  line_description: string | null
  tiers_display_name: string | null
  debit: Decimal
  credit: Decimal
  balance: Decimal
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function d(v: string | null | undefined): Decimal {
  if (!v) return new Decimal(0)
  try { return new Decimal(v) } catch { return new Decimal(0) }
}

function fmt(v: Decimal): string {
  if (v.isZero()) return '—'
  return v.abs().toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function fmtBalance(v: Decimal): string {
  return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function formatDateFr(iso: string): string {
  const [y, m, day] = iso.split('-')
  if (!y || !m || !day) return iso
  return `${day}/${m}/${y}`
}

// credit-normal account types: Liability=2, Equity=3, Revenue=5
function isCreditNormal(accountType: number): boolean {
  return accountType === 2 || accountType === 3 || accountType === 5
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function GrandLivreScreen() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')

  const fiscalYears = useFiscalYearsQuery(canView).data ?? []
  const accountsQuery = useAccountsQuery(canView)
  const journalsQuery = useJournalsQuery(canView)
  const globalFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  const accounts = accountsQuery.data ?? []
  const journalMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const j of journalsQuery.data ?? []) map[j.uuid] = j.code
    return map
  }, [journalsQuery.data])

  const [selectedAccountUuid, setSelectedAccountUuid] = useState<string>('')
  const [fiscalYearUuid, setFiscalYearUuid] = useState<string>(globalFiscalYearUuid ?? '')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [postedOnly, setPostedOnly] = useState(false)

  const selectedAccount: AccountOption | undefined = accounts.find(
    (a) => a.uuid === selectedAccountUuid,
  )

  const entriesQuery = useAccountingEntriesQuery(
    {
      fiscal_year_uuid: fiscalYearUuid || undefined,
      account_code: selectedAccount?.code,
      state: postedOnly ? ENTRY_STATE_POSTED : undefined,
      entry_date_from: dateFrom || undefined,
      entry_date_to: dateTo || undefined,
      limit: 500,
    },
    canView && Boolean(selectedAccountUuid),
  )

  // Build ledger lines: extract matching lines from each entry, sort by date asc, compute running balance
  const { lines, openingBalance } = useMemo(() => {
    if (!selectedAccount || !entriesQuery.data) return { lines: [], openingBalance: new Decimal(0) }

    const creditNormal = isCreditNormal(selectedAccount.type)

    const rawLines: Omit<LedgerLine, 'balance'>[] = []
    const entries = [...entriesQuery.data].sort((a, b) =>
      a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0,
    )

    for (const entry of entries) {
      const journalCode = journalMap[entry.journal_uuid] ?? '—'
      for (const line of entry.lines) {
        if (line.account_uuid !== selectedAccountUuid) continue
        rawLines.push({
          entry_uuid: entry.uuid,
          entry_date: entry.entry_date,
          journal_code: journalCode,
          sequence_number: entry.sequence_number,
          entry_description: entry.description,
          line_description: line.description ?? null,
          tiers_display_name: line.tiers_display_name ?? null,
          debit: d(line.debit),
          credit: d(line.credit),
        })
      }
    }

    // Running balance: debit-normal = debit - credit; credit-normal = credit - debit
    let running = new Decimal(0)
    const ledgerLines: LedgerLine[] = rawLines.map((row) => {
      const movement = creditNormal
        ? row.credit.minus(row.debit)
        : row.debit.minus(row.credit)
      running = running.plus(movement)
      return { ...row, balance: running }
    })

    return { lines: ledgerLines, openingBalance: new Decimal(0) }
  }, [selectedAccount, entriesQuery.data, journalMap, selectedAccountUuid])

  const totals = useMemo(() => {
    let totalDebit = new Decimal(0)
    let totalCredit = new Decimal(0)
    for (const line of lines) {
      totalDebit = totalDebit.plus(line.debit)
      totalCredit = totalCredit.plus(line.credit)
    }
    return { debit: totalDebit, credit: totalCredit }
  }, [lines])

  const accountOptions = accounts.map((a) => ({
    value: a.uuid,
    label: `${a.code} · ${a.name}`,
  }))

  if (!canView) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">{t('journal.noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          {t('grandLivre.title', 'Grand livre')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 md:col-span-2">
            <Label>{t('grandLivre.account', 'Compte')}</Label>
            <SearchableSelect
              options={accountOptions}
              value={selectedAccountUuid}
              onChange={(v) => setSelectedAccountUuid(v ?? '')}
              placeholder={t('grandLivre.selectAccount', 'Sélectionner un compte…')}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.fiscalYear', 'Exercice')}</Label>
            <select
              value={fiscalYearUuid}
              onChange={(e) => setFiscalYearUuid(e.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t('grandLivre.allYears', 'Tous les exercices')}</option>
              {fiscalYears.map((fy) => (
                <option key={fy.uuid} value={fy.uuid}>{fy.label ?? fy.code}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.dateFrom', 'Date de')}</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.dateTo', 'Date à')}</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={postedOnly}
                onChange={(e) => setPostedOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t('grandLivre.postedOnly', 'Validées seulement')}
            </label>
          </div>
        </div>
      </div>

      {/* Ledger table */}
      {selectedAccountUuid && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Account header */}
          <div className="border-b border-slate-200 px-6 py-4">
            <p className="text-sm font-semibold text-slate-900">
              {selectedAccount?.code} · {selectedAccount?.name}
            </p>
            {openingBalance && !openingBalance.isZero() && (
              <p className="mt-1 text-sm text-slate-500">
                {t('grandLivre.openingBalance', 'Solde à l\'ouverture')} :{' '}
                <span className="font-mono font-semibold">{fmtBalance(openingBalance)}</span>
              </p>
            )}
          </div>

          {entriesQuery.isLoading ? (
            <div className="p-6 text-sm text-slate-500">{t('settings.loading', 'Chargement…')}</div>
          ) : lines.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              {t('grandLivre.empty', 'Aucun mouvement pour ce compte.')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">{t('journal.entries.date', 'Date')}</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">{t('grandLivre.journal', 'Journal')}</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">{t('grandLivre.sequence', 'N°')}</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">{t('grandLivre.libelle', 'Libellé')}</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">{t('grandLivre.tiers', 'Tiers')}</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600">{t('grandLivre.debit', 'Débit')}</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600">{t('grandLivre.credit', 'Crédit')}</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600">{t('grandLivre.runningBalance', 'Solde')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line, idx) => (
                    <tr key={`${line.entry_uuid}-${idx}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-700">{formatDateFr(line.entry_date)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">{line.journal_code}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">{line.sequence_number ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-700">
                        {line.line_description || line.entry_description}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">{line.tiers_display_name ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">
                        {line.debit.isZero() ? '' : fmt(line.debit)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">
                        {line.credit.isZero() ? '' : fmt(line.credit)}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono font-semibold ${line.balance.isNegative() ? 'text-red-600' : 'text-slate-900'}`}>
                        {fmtBalance(line.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td colSpan={5} className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                      {t('grandLivre.totals', 'Totaux')}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">
                      {fmt(totals.debit)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">
                      {fmt(totals.credit)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">
                      {fmtBalance(lines[lines.length - 1]?.balance ?? new Decimal(0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {!selectedAccountUuid && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="text-sm text-slate-500">{t('grandLivre.selectAccountPrompt', 'Sélectionnez un compte pour afficher son grand livre.')}</p>
        </div>
      )}
    </section>
  )
}
