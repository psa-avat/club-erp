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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Decimal from 'decimal.js'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useAccountsQuery, useFiscalYearsQuery, useGeneralLedgerQuery, type AccountOption } from '../api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'

const PAGE_SIZE = 100

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: string): string {
  const d = new Decimal(v || '0')
  if (d.isZero()) return '—'
  return d.abs().toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function fmtBalance(v: string): string {
  return new Decimal(v || '0').toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function isNegative(v: string): boolean {
  return new Decimal(v || '0').isNegative()
}

function formatDateFr(iso: string): string {
  const [y, m, day] = iso.split('-')
  if (!y || !m || !day) return iso
  return `${day}/${m}/${y}`
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function GrandLivreScreen() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')

  const fiscalYears = useFiscalYearsQuery(canView).data ?? []
  const accountsQuery = useAccountsQuery(canView)
  const globalFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  const accounts = accountsQuery.data ?? []

  const [selectedAccountUuid, setSelectedAccountUuid] = useState<string>('')
  const [fiscalYearUuid, setFiscalYearUuid] = useState<string>(globalFiscalYearUuid ?? '')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [postedOnly, setPostedOnly] = useState(true)
  const [page, setPage] = useState(0)

  const selectedAccount: AccountOption | undefined = accounts.find(
    (a) => a.uuid === selectedAccountUuid,
  )

  const ledgerQuery = useGeneralLedgerQuery(
    {
      fiscal_year_uuid: fiscalYearUuid,
      account_uuid: selectedAccountUuid || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      posted_only: postedOnly,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    canView && Boolean(selectedAccountUuid) && Boolean(fiscalYearUuid),
  )
  const ledger = ledgerQuery.data
  const lines = ledger?.lines ?? []
  const totalLines = ledger?.total_lines ?? 0
  const totalPages = Math.max(1, Math.ceil(totalLines / PAGE_SIZE))

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
              onChange={(v) => { setSelectedAccountUuid(v ?? ''); setPage(0) }}
              placeholder={t('grandLivre.selectAccount', 'Sélectionner un compte…')}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.fiscalYear', 'Exercice')}</Label>
            <select
              value={fiscalYearUuid}
              onChange={(e) => { setFiscalYearUuid(e.target.value); setPage(0) }}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t('grandLivre.selectFiscalYear', 'Sélectionnez un exercice')}</option>
              {fiscalYears.map((fy) => (
                <option key={fy.uuid} value={fy.uuid}>{fy.label ?? fy.code}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.dateFrom', 'Date de')}</Label>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0) }} />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.dateTo', 'Date à')}</Label>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0) }} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={postedOnly}
                onChange={(e) => { setPostedOnly(e.target.checked); setPage(0) }}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t('grandLivre.postedOnly', 'Validées seulement')}
            </label>
          </div>
        </div>
        {postedOnly ? (
          <span className="badge-success mt-2 inline-flex rounded-full px-2 py-0.5 text-xs">
            {t('reports.postedOnlyBadge')}
          </span>
        ) : (
          <span className="badge-warning mt-2 inline-flex rounded-full px-2 py-0.5 text-xs">
            {t('reports.draftsIncludedWarning')}
          </span>
        )}
      </div>

      {/* Ledger table */}
      {selectedAccountUuid && fiscalYearUuid && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Account header */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-6 py-4">
            <p className="text-sm font-semibold text-slate-900">
              {ledger?.account_code ?? selectedAccount?.code} · {ledger?.account_name ?? selectedAccount?.name}
            </p>
            {ledger && !new Decimal(ledger.opening_balance).isZero() && (
              <p className="text-sm text-slate-500">
                {t('grandLivre.openingBalance', "Solde à l'ouverture")} :{' '}
                <span className="font-mono font-semibold">{fmtBalance(ledger.opening_balance)}</span>
              </p>
            )}
          </div>

          {ledgerQuery.isLoading ? (
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
                  {lines.map((line) => (
                    <tr key={line.line_uuid} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-700">{formatDateFr(line.entry_date)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">{line.journal_code}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">{line.sequence_number ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-700">
                        {line.line_description || line.entry_description}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">{line.tiers_display_name ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{fmt(line.debit)}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{fmt(line.credit)}</td>
                      <td className={`px-4 py-2 text-right font-mono font-semibold ${isNegative(line.running_balance) ? 'text-red-600' : 'text-slate-900'}`}>
                        {fmtBalance(line.running_balance)}
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
                      {fmt(ledger?.total_debit ?? '0')}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">
                      {fmt(ledger?.total_credit ?? '0')}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">
                      {fmtBalance(ledger?.closing_balance ?? '0')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {totalLines > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <span className="text-sm text-slate-500">
                {t('journal.entries.page', { current: page + 1, total: totalPages })}
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(!selectedAccountUuid || !fiscalYearUuid) && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="text-sm text-slate-500">{t('grandLivre.selectAccountPrompt', 'Sélectionnez un exercice et un compte pour afficher le grand livre.')}</p>
        </div>
      )}
    </section>
  )
}
