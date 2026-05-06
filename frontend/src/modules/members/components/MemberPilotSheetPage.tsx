/*
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Pilot sheet page — accounting ledger + flight log per member
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
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'
import { Trash2 } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { ClubPageShell } from './ClubPageShell'
import { useMemberQuery } from '../api'
import {
  useAccountingEntriesQuery,
  useDeleteAccountingEntryMutation,
  useFiscalYearsQuery,
  useJournalsQuery,
  type AccountingEntry,
  type JournalOption,
} from '../../banque/api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { memberCategoryLabel } from './membersShared'
import type { MemberSheet } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decimalOrZero(value: string | null | undefined): Decimal {
  try {
    return new Decimal(value ?? '0')
  } catch {
    return new Decimal(0)
  }
}

function formatEuro(value: Decimal): string {
  const n = value.toNumber()
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function entryStateLabel(state: number, t: (key: string) => string): string {
  if (state === 1) return t('pilotSheet.account.stateDraft')
  if (state === 2) return t('pilotSheet.account.statePosted')
  return t('pilotSheet.account.stateCancelled')
}

function entryStateBadgeClass(state: number): string {
  if (state === 1) return 'bg-amber-100 text-amber-800'
  if (state === 2) return 'bg-emerald-100 text-emerald-800'
  return 'bg-red-100 text-red-800'
}

// ---------------------------------------------------------------------------
// Initials avatar
// ---------------------------------------------------------------------------

function InitialsCircle({ first, last }: { first: string; last: string }) {
  const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-bold text-on-primary shadow-sm">
      {initials}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Member header card
// ---------------------------------------------------------------------------

function MemberHeader({
  memberUuid,
}: {
  memberUuid: string
}) {
  const { t } = useTranslation('members')
  const navigate = useNavigate()
  const memberQuery = useMemberQuery(memberUuid)
  const member = memberQuery.data ?? null

  if (memberQuery.isLoading) {
    return (
      <div className="rounded-shape-lg border border-outline-variant bg-surface p-6 shadow-surface-1">
        <div className="h-12 w-64 animate-pulse rounded bg-surface-variant" />
      </div>
    )
  }

  if (!member) return null

  const categoryLabel = memberCategoryLabel(member.member_category)

  return (
    <div className="rounded-shape-lg border border-outline-variant bg-surface shadow-surface-1">
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <InitialsCircle first={member.first_name} last={member.last_name} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-on-surface">
                {member.first_name} {member.last_name}
              </h1>
              <span className="rounded-shape-full bg-primary-container px-2.5 py-0.5 text-xs font-medium text-on-primary-container">
                {categoryLabel}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-sm text-on-surface-variant">{member.account_id}</p>
            {member.trigram ? (
              <p className="text-xs text-on-surface-variant">
                Trigramme&nbsp;: <span className="font-medium">{member.trigram}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/club/members')}
            className="inline-flex items-center gap-1.5 rounded-shape-sm border border-outline-variant bg-surface px-3 py-1.5 text-sm text-on-surface-variant transition-colors hover:bg-surface-container"
          >
            ← {t('pilotSheet.backToList')}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/club/members/${memberUuid}/edit`)}
            className="inline-flex items-center gap-1.5 rounded-shape-sm border border-outline bg-surface px-3 py-1.5 text-sm text-on-surface transition-colors hover:bg-surface-container"
          >
            {t('pilotSheet.editMember')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/banque/journal/entry/new')}
            className="inline-flex items-center gap-1.5 rounded-shape-sm bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors hover:opacity-90"
          >
            {t('pilotSheet.addEntry')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

type KpiCardProps = {
  label: string
  value: string
  valueClass?: string
  sub?: string
}

function KpiCard({ label, value, valueClass = 'text-on-surface', sub }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-shape-lg border border-outline-variant bg-surface p-5 shadow-surface-1">
      <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {sub ? <p className="text-xs text-on-surface-variant">{sub}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level KPI strip (always visible regardless of active tab)
// ---------------------------------------------------------------------------

function MemberKpiStrip({
  memberUuid,
  memberAccountId,
  memberSheets,
}: {
  memberUuid: string
  memberAccountId: string
  memberSheets: MemberSheet[]
}) {
  const { t } = useTranslation('members')
  const entriesQuery = useAccountingEntriesQuery({ member_uuid: memberUuid, limit: 500 }, true)
  const entries: AccountingEntry[] = entriesQuery.data ?? []

  const balance = useMemo(() => {
    let d = new Decimal(0)
    let c = new Decimal(0)
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.member_uuid === memberUuid) {
          d = d.plus(decimalOrZero(line.debit))
          c = c.plus(decimalOrZero(line.credit))
        }
      }
    }
    return d.minus(c)
  }, [entries, memberUuid])

  const totalHours = useMemo(
    () => memberSheets.reduce((acc, s) => acc.plus(decimalOrZero(s.hours_count)), new Decimal(0)),
    [memberSheets],
  )

  // From the member's perspective: credit > debit = positive = green
  const memberBalance = balance.negated()
  const balanceColorClass = memberBalance.isZero()
    ? 'text-on-surface'
    : memberBalance.greaterThan(0)
      ? 'text-emerald-700 font-semibold'
      : 'text-error font-semibold'

  const seasonCount = memberSheets.length
  const seasonSub =
    seasonCount > 0
      ? `${seasonCount} saison${seasonCount > 1 ? 's' : ''}`
      : t('pilotSheet.kpi.comingSoon')

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <KpiCard
        label={t('pilotSheet.kpi.balance')}
        value={
          entriesQuery.isLoading
            ? '…'
            : `${memberBalance.greaterThan(0) ? '+' : ''}${formatEuro(memberBalance)} €`
        }
        valueClass={balanceColorClass}
        sub={memberAccountId}
      />
      <KpiCard
        label={t('pilotSheet.kpi.flightHours')}
        value={totalHours.isZero() ? '—' : `${totalHours.toFixed(1)} h`}
        sub={seasonSub}
      />
      <KpiCard
        label={t('pilotSheet.kpi.lastFlight')}
        value="—"
        sub={t('pilotSheet.kpi.comingSoon')}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Account tab
// ---------------------------------------------------------------------------

function AccountTab({
  memberUuid,
}: {
  memberUuid: string
}) {
  const { t } = useTranslation('members')
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const [selectedFiscalYearUuid, setSelectedFiscalYearUuid] = useState<string>(
    activeFiscalYearUuid ?? '',
  )

  const fiscalYearsQuery = useFiscalYearsQuery(true)
  const fiscalYears = fiscalYearsQuery.data ?? []

  const deleteEntryMutation = useDeleteAccountingEntryMutation()

  const journalsQuery = useJournalsQuery(true)
  const journalMap = useMemo(() => {
    const map = new Map<string, JournalOption>()
    for (const j of journalsQuery.data ?? []) map.set(j.uuid, j)
    return map
  }, [journalsQuery.data])

  const entryFilters = useMemo(
    () => ({
      fiscal_year_uuid: selectedFiscalYearUuid || undefined,
      member_uuid: memberUuid,
      limit: 500,
    }),
    [selectedFiscalYearUuid, memberUuid],
  )

  const entriesQuery = useAccountingEntriesQuery(entryFilters, true)
  const entries: AccountingEntry[] = useMemo(
    () =>
      [...(entriesQuery.data ?? [])].sort(
        (a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime(),
      ),
    [entriesQuery.data],
  )

  // Compute balance from lines tagged to this member
  const balance = useMemo(() => {
    let totalDebit = new Decimal(0)
    let totalCredit = new Decimal(0)
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.member_uuid === memberUuid) {
          totalDebit = totalDebit.plus(decimalOrZero(line.debit))
          totalCredit = totalCredit.plus(decimalOrZero(line.credit))
        }
      }
    }
    return totalDebit.minus(totalCredit)
  }, [entries, memberUuid])

  // Entry-level debit/credit sums for the totals footer row
  const entryTotals = useMemo(() => {
    let d = new Decimal(0)
    let c = new Decimal(0)
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.member_uuid === memberUuid) {
          d = d.plus(decimalOrZero(line.debit))
          c = c.plus(decimalOrZero(line.credit))
        }
      }
    }
    return { debit: d, credit: c }
  }, [entries, memberUuid])

  // From the member's perspective: credit > debit = positive = green
  const memberBalance = balance.negated()
  const balanceColorClass = memberBalance.isZero()
    ? 'text-on-surface'
    : memberBalance.greaterThan(0)
      ? 'text-emerald-700 font-semibold'
      : 'text-error font-semibold'

  return (
    <div className="space-y-4">
      {/* Fiscal year filter */}
      <div className="flex items-center gap-3">
        <label
          htmlFor="pilot-sheet-fy"
          className="text-sm font-medium text-on-surface-variant"
        >
          {t('pilotSheet.account.fiscalYear')}
        </label>
        <select
          id="pilot-sheet-fy"
          value={selectedFiscalYearUuid}
          onChange={(e) => setSelectedFiscalYearUuid(e.target.value)}
          className="h-9 rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
        >
          <option value="">{t('pilotSheet.account.allFiscalYears')}</option>
          {fiscalYears.map((fy) => (
            <option key={fy.uuid} value={fy.uuid}>
              {fy.label} ({fy.year})
            </option>
          ))}
        </select>
      </div>

      {/* Entries table */}
      <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface">
        {entriesQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-on-surface-variant">Chargement…</div>
        ) : entries.length === 0 ? (
          <p className="p-8 text-center text-sm text-on-surface-variant">
            {t('pilotSheet.account.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  <th className="px-3 py-2.5">{t('pilotSheet.account.columns.date')}</th>
                  <th className="px-3 py-2.5">{t('pilotSheet.account.columns.journal')}</th>
                  <th className="px-3 py-2.5">{t('pilotSheet.account.columns.description')}</th>
                  <th className="hidden px-3 py-2.5 sm:table-cell">
                    {t('pilotSheet.account.columns.reference')}
                  </th>
                  <th className="px-3 py-2.5 text-right">{t('pilotSheet.account.columns.debit')}</th>
                  <th className="px-3 py-2.5 text-right">{t('pilotSheet.account.columns.credit')}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {entries.map((entry) => {
                  // Compute debit/credit for this member on this entry
                  let lineDebit = new Decimal(0)
                  let lineCredit = new Decimal(0)
                  for (const line of entry.lines) {
                    if (line.member_uuid === memberUuid) {
                      lineDebit = lineDebit.plus(decimalOrZero(line.debit))
                      lineCredit = lineCredit.plus(decimalOrZero(line.credit))
                    }
                  }
                  const hasDebit = lineDebit.greaterThan(0)
                  const hasCredit = lineCredit.greaterThan(0)
                  return (
                    <tr
                      key={entry.uuid}
                      className="transition-colors hover:bg-surface-container/50"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-on-surface-variant">
                        {formatDate(entry.entry_date)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">
                          {journalMap.get(entry.journal_uuid)?.code ?? '—'}
                        </span>
                      </td>
                      <td className="max-w-xs px-3 py-2">
                        <Link
                          to={`/banque/journal/entry/${entry.uuid}?fiscal_year_uuid=${entry.fiscal_year_uuid}`}
                          className="truncate text-primary underline-offset-2 hover:underline"
                          title={entry.description}
                        >
                          {entry.description}
                        </Link>
                        <span
                          className={`ml-2 inline-flex items-center rounded-shape-full px-1.5 py-px text-[10px] font-medium ${entryStateBadgeClass(entry.state)}`}
                        >
                          {entryStateLabel(entry.state, t)}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-on-surface-variant sm:table-cell">
                        {entry.reference ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-on-surface">
                        {hasDebit ? formatEuro(lineDebit) : ''}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-on-surface">
                        {hasCredit ? formatEuro(lineCredit) : ''}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {entry.state === 1 && (
                          <button
                            type="button"
                            title={t('pilotSheet.account.deleteEntry')}
                            className="rounded p-1 text-error opacity-70 transition-opacity hover:opacity-100 disabled:opacity-30"
                            disabled={deleteEntryMutation.isPending}
                            onClick={() => {
                              if (window.confirm(t('pilotSheet.account.confirmDelete'))) {
                                deleteEntryMutation.mutate({
                                  entryUuid: entry.uuid,
                                  fiscalYearUuid: entry.fiscal_year_uuid,
                                })
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t border-outline-variant bg-surface-container">
                <tr className="font-medium">
                  <td colSpan={4} className="px-3 py-2 text-xs uppercase tracking-wide text-on-surface-variant">
                    {t('pilotSheet.account.totals')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatEuro(entryTotals.debit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatEuro(entryTotals.credit)}
                  </td>
                  <td />
                </tr>
                <tr className={`font-semibold ${balanceColorClass}`}>
                  <td colSpan={4} className="px-3 py-2 text-xs uppercase tracking-wide">
                    {t('pilotSheet.account.balance')}
                  </td>
                  <td colSpan={2} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {memberBalance.greaterThan(0) ? '+' : ''}{formatEuro(memberBalance)} €{' '}
                    {memberBalance.isZero()
                      ? ''
                      : memberBalance.greaterThan(0)
                        ? '(créditeur)'
                        : '(débiteur)'}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Flight log tab (placeholder)
// ---------------------------------------------------------------------------

function FlightLogTab() {
  const { t } = useTranslation('members')
  const ghostRows = [1, 2, 3, 4, 5]

  return (
    <div className="space-y-4">
      {/* Coming-soon banner */}
      <div className="rounded-shape-lg border border-blue-200 bg-blue-50 p-5">
        <div className="flex gap-3">
          <div className="mt-0.5 shrink-0 text-blue-500">
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z"
              />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-blue-900">{t('pilotSheet.flights.comingSoonTitle')}</p>
            <p className="mt-1 text-sm text-blue-800">
              {t('pilotSheet.flights.comingSoonDescription')}
            </p>
          </div>
        </div>
      </div>

      {/* Ghost preview table */}
      <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface opacity-50">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                <th className="px-3 py-2.5">{t('pilotSheet.flights.columns.date')}</th>
                <th className="px-3 py-2.5">{t('pilotSheet.flights.columns.aircraft')}</th>
                <th className="px-3 py-2.5">{t('pilotSheet.flights.columns.role')}</th>
                <th className="hidden px-3 py-2.5 sm:table-cell">
                  {t('pilotSheet.flights.columns.depArr')}
                </th>
                <th className="px-3 py-2.5">{t('pilotSheet.flights.columns.duration')}</th>
                <th className="px-3 py-2.5">{t('pilotSheet.flights.columns.status')}</th>
                <th className="px-3 py-2.5">{t('pilotSheet.flights.columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {ghostRows.map((i) => (
                <tr key={i}>
                  {[120, 80, 60, 100, 60, 80, 40].map((w, j) => (
                    <td
                      key={j}
                      className={j === 3 ? 'hidden px-3 py-3 sm:table-cell' : 'px-3 py-3'}
                    >
                      <div
                        className="animate-pulse rounded bg-surface-variant"
                        style={{ width: `${w}px`, height: '12px' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function MemberPilotSheetPage() {
  const { t } = useTranslation('members')
  const { memberUuid } = useParams<{ memberUuid: string }>()
  const [activeTab, setActiveTab] = useState<'account' | 'flights'>('flights')

  const memberQuery = useMemberQuery(memberUuid ?? null)
  const member = memberQuery.data ?? null

  if (!memberUuid) return null

  const combinedError = memberQuery.error

  return (
    <ClubPageShell>
      {combinedError ? (
        <Alert>{String((combinedError as Error)?.message ?? combinedError)}</Alert>
      ) : null}

      {/* Header */}
      <MemberHeader memberUuid={memberUuid} />

      {/* KPI strip — always visible */}
      <MemberKpiStrip
        memberUuid={memberUuid}
        memberAccountId={member?.account_id ?? ''}
        memberSheets={member?.member_sheets ?? []}
      />

      {/* Tab strip */}
      <div className="flex border-b border-outline-variant">
        {(['flights', 'account'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              'px-5 py-3 text-sm font-medium transition-colors',
              activeTab === tab
                ? 'border-b-2 border-primary text-primary'
                : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            {tab === 'account'
              ? t('pilotSheet.tabs.account')
              : t('pilotSheet.tabs.flights')}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'account' ? (
        <AccountTab memberUuid={memberUuid} />
      ) : (
        <FlightLogTab />
      )}
    </ClubPageShell>
  )
}
