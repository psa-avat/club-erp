/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Journal entries browser screen – filter + list + CTA to workspace
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
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronLeft, ChevronRight, Download, Pencil, Undo2, X } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Banner } from '../../../components/ui/banner'
import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { Checkbox } from '../../../components/ui/checkbox'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { StickyActionBar } from '../../../components/ui/sticky-action-bar'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountsQuery,
  useAccountingEntriesQuery,
  useAccountingEntriesCountQuery,
  useBulkPostAccountingEntriesMutation,
  useDeleteAccountingEntryMutation,
  useFiscalYearsQuery,
  useJournalsQuery,
  useReverseAccountingEntryMutation,
} from '../api'
import { apiClient, getAuthRequestConfig } from '../../../api/client'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { entryStateLabel, totals, entryStateBadgeClass, useDebounce, decimalOrZero, normalizeAmountFilter, toErrorMessage } from './journalShared'
import { AccountingImportDialog } from './AccountingImportDialog'
import type { AccountingEntry } from '../api'

type SortKey = 'entry_date' | 'journal' | 'description' | 'reference' | 'amount' | 'state'
type SortDirection = 'asc' | 'desc'
type JournalFilters = {
  journal_uuid: string
  state: number
  search: string
  member: string
  account_code: string
  description: string
  entry_date_from: string
  entry_date_to: string
  amount_min: string
  amount_max: string
  null_tiers: boolean
}

const DEFAULT_FILTERS: JournalFilters = {
  journal_uuid: '',
  state: 0,
  search: '',
  member: '',
  account_code: '',
  description: '',
  entry_date_from: '',
  entry_date_to: '',
  amount_min: '',
  amount_max: '',
  null_tiers: false,
}

function formatDateFr(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  if (!year || !month || !day) return isoDate
  return `${day}/${month}/${year}`
}

function formatAmountFr(amount: string): string {
  const [intPartRaw, decimalRaw = '00'] = amount.split('.')
  const intPart = intPartRaw.replace('-', '')
  const withGrouping = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const sign = intPartRaw.startsWith('-') ? '-' : ''
  return `${sign}${withGrouping},${decimalRaw.padEnd(2, '0').slice(0, 2)}`
}

type Props = {
  defaultState?: number
  lockState?: boolean
}

export function JournalEntriesScreen({ defaultState, lockState }: Props = {}) {
  const { t } = useTranslation('banque')
  const navigate = useNavigate()
  const canView = useCapability('VIEW_FINANCIALS')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const journalsQuery = useJournalsQuery(canView)
  const accountsQuery = useAccountsQuery(canView)

  const PAGE_SIZE = 25

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const [filters, setFilters] = useState<JournalFilters>({
    ...DEFAULT_FILTERS,
    ...(defaultState !== undefined ? { state: defaultState } : {}),
  })
  const [page, setPage] = useState(0)
  const [selectedEntryUuids, setSelectedEntryUuids] = useState<string[]>([])
  const debouncedSearch = useDebounce(filters.search, 350)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmBulkPostOpen, setConfirmBulkPostOpen] = useState(false)
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [expandedEntryUuid, setExpandedEntryUuid] = useState<string | null>(null)
  const [groupByJournal, setGroupByJournal] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('entry_date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const fiscalYears = fiscalYearsQuery.data ?? []
  const journals = journalsQuery.data ?? []
  const accounts = accountsQuery.data ?? []

  const baseFilters = useMemo(
    () => ({
      fiscal_year_uuid: activeFiscalYearUuid ?? undefined,
      journal_uuid: filters.journal_uuid || undefined,
      state: filters.state || undefined,
      search: debouncedSearch.trim() || undefined,
      member: filters.member.trim() || undefined,
      account_code: filters.account_code.trim() || undefined,
      description: filters.description.trim() || undefined,
      entry_date_from: filters.entry_date_from || undefined,
      entry_date_to: filters.entry_date_to || undefined,
      amount_min: normalizeAmountFilter(filters.amount_min),
      amount_max: normalizeAmountFilter(filters.amount_max),
      null_tiers: filters.null_tiers || undefined,
    }),
    [
      activeFiscalYearUuid,
      filters.journal_uuid,
      filters.state,
      debouncedSearch,
      filters.member,
      filters.account_code,
      filters.description,
      filters.entry_date_from,
      filters.entry_date_to,
      filters.amount_min,
      filters.amount_max,
      filters.null_tiers,
    ],
  )

  const entryFilters = useMemo(
    () => ({ ...baseFilters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [baseFilters, page, PAGE_SIZE],
  )

  const entriesQuery = useAccountingEntriesQuery(entryFilters, canView && Boolean(activeFiscalYearUuid))
  const countQuery = useAccountingEntriesCountQuery(baseFilters, canView && Boolean(activeFiscalYearUuid))
  const entries = entriesQuery.data ?? []
  const totalEntries = countQuery.data ?? 0
  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE))
  const bulkPostMutation = useBulkPostAccountingEntriesMutation()
  const deleteEntryMutation = useDeleteAccountingEntryMutation()
  const reverseEntryMutation = useReverseAccountingEntryMutation()

  const journalByUuid = useMemo(
    () => new Map(journals.map((j) => [j.uuid, j])),
    [journals],
  )

  const accountLabelByUuid = useMemo(
    () => new Map(accounts.map((a) => [a.uuid, `${a.code} — ${a.name}`])),
    [accounts],
  )

  const entriesView = useMemo(
    () => entries.map((entry) => {
      const summary = totals(
        entry.lines.map((line) => {
          const debit = decimalOrZero(line.debit)
          const credit = decimalOrZero(line.credit)
          const amount = debit.greaterThan(0) ? debit : credit.negated()
          return {
            account_uuid: line.account_uuid,
            amount: amount.toFixed(2),
            description: line.description ?? '',
            tiers_uuid: line.tiers_uuid ?? '',
          }
        }),
      )
      return {
        entry,
        journalCode: journalByUuid.get(entry.journal_uuid)?.code ?? '—',
        amount: summary.debit,
      }
    }),
    [entries, journalByUuid],
  )

  const sortedEntriesView = useMemo(() => {
    const items = [...entriesView]
    const multiplier = sortDirection === 'asc' ? 1 : -1

    const compareCore = (a: typeof items[number], b: typeof items[number]) => {
      if (sortKey === 'entry_date') return a.entry.entry_date.localeCompare(b.entry.entry_date) * multiplier
      if (sortKey === 'journal') return a.journalCode.localeCompare(b.journalCode) * multiplier
      if (sortKey === 'description') return a.entry.description.localeCompare(b.entry.description) * multiplier
      if (sortKey === 'reference') return (a.entry.reference ?? '').localeCompare(b.entry.reference ?? '') * multiplier
      if (sortKey === 'amount') return decimalOrZero(a.amount).comparedTo(decimalOrZero(b.amount)) * multiplier
      return (a.entry.state - b.entry.state) * multiplier
    }

    if (groupByJournal) {
      items.sort((a, b) => {
        const groupCmp = a.journalCode.localeCompare(b.journalCode)
        if (groupCmp !== 0) return groupCmp
        return compareCore(a, b)
      })
      return items
    }

    items.sort(compareCore)
    return items
  }, [entriesView, groupByJournal, sortDirection, sortKey])

  const draftEntries = useMemo(
    () => sortedEntriesView.map((row) => row.entry).filter((entry) => entry.state === 1 || entry.state === 3),
    [sortedEntriesView],
  )
  const allVisibleDraftsSelected =
    draftEntries.length > 0 && draftEntries.every((entry) => selectedEntryUuids.includes(entry.uuid))

  useEffect(() => {
    setSelectedEntryUuids((prev) => {
      const allowedDrafts = new Set(entries.filter((entry) => entry.state === 1 || entry.state === 3).map((entry) => entry.uuid))
      return prev.filter((uuid) => allowedDrafts.has(uuid))
    })
  }, [entries])

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0)
  }, [baseFilters])

  useEffect(() => {
    setExpandedEntryUuid((prev) => (prev && entries.some((entry) => entry.uuid === prev) ? prev : null))
  }, [entries])

  useEffect(() => {
    if (!successMessage) return
    const id = setTimeout(() => setSuccessMessage(null), 3000)
    return () => clearTimeout(id)
  }, [successMessage])

  const anyError = localError ?? (
    bulkPostMutation.error ? toErrorMessage(bulkPostMutation.error, t('journal.errors.generic')) : null
  )

  function toggleEntrySelection(entryUuid: string) {
    setSelectedEntryUuids((prev) =>
      prev.includes(entryUuid)
        ? prev.filter((uuid) => uuid !== entryUuid)
        : [...prev, entryUuid],
    )
  }

  function toggleSelectAllDrafts() {
    if (allVisibleDraftsSelected) {
      setSelectedEntryUuids([])
      return
    }
    setSelectedEntryUuids(draftEntries.map((entry) => entry.uuid))
  }

  function toggleSort(column: SortKey) {
    if (sortKey === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(column)
    setSortDirection(column === 'entry_date' ? 'desc' : 'asc')
  }

  const [isExporting, setIsExporting] = useState(false)

  function csvEscape(value: string): string {
    if (value.includes(';') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  async function handleExportCsv() {
    if (!activeFiscalYearUuid) return
    setIsExporting(true)
    try {
      const { data } = await apiClient.get<AccountingEntry[]>('/api/v1/accounting/entries', {
        ...getAuthRequestConfig(),
        params: { ...baseFilters, limit: 5000, offset: 0 },
      })

      const STATE_LABELS: Record<number, string> = { 1: 'Brouillon', 2: 'Validé', 3: 'Annulé' }
      const headers = ['Date', 'Journal', 'Description', 'Référence', 'État', 'Compte', 'Libellé ligne', 'Débit', 'Crédit', 'Tiers']
      const csvRows: string[] = ['﻿' + headers.join(';')]

      for (const entry of data) {
        const journal = journalByUuid.get(entry.journal_uuid)?.code ?? ''
        const stateLabel = STATE_LABELS[entry.state] ?? String(entry.state)
        for (const line of entry.lines) {
          const accountLabel = accountLabelByUuid.get(line.account_uuid) ?? line.account_uuid
          const tiersLabel = [line.tiers_display_ref, line.tiers_display_name].filter(Boolean).join(' — ')
          const row = [
            formatDateFr(entry.entry_date),
            journal,
            csvEscape(entry.description),
            csvEscape(entry.reference ?? ''),
            stateLabel,
            csvEscape(accountLabel),
            csvEscape(line.description ?? ''),
            line.debit.replace('.', ','),
            line.credit.replace('.', ','),
            csvEscape(tiersLabel),
          ].join(';')
          csvRows.push(row)
        }
      }

      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ecritures-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setLocalError('Erreur lors de l\'export CSV')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleBulkPost() {
    if (!activeFiscalYearUuid || selectedEntryUuids.length === 0) return
    setLocalError(null)
    try {
      const postedEntries = await bulkPostMutation.mutateAsync({
        fiscal_year_uuid: activeFiscalYearUuid,
        entry_uuids: selectedEntryUuids,
      })
      setSelectedEntryUuids([])
      setSuccessMessage(t('journal.entries.bulk.posted', { count: postedEntries.length }))
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function handleBulkDeleteDrafts() {
    if (selectedEntryUuids.length === 0) return
    setLocalError(null)
    try {
      const selectedDrafts = entries.filter((entry) =>
        selectedEntryUuids.includes(entry.uuid) && (entry.state === 1 || entry.state === 3),
      )
      for (const draft of selectedDrafts) {
        await deleteEntryMutation.mutateAsync({
          entryUuid: draft.uuid,
          fiscalYearUuid: draft.fiscal_year_uuid,
        })
      }
      setSelectedEntryUuids([])
      setSuccessMessage(t('journal.entries.bulk.deleted', { count: selectedDrafts.length }))
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function handleReverse(entryUuid: string) {
    if (!activeFiscalYearUuid) return
    const reversalReason = window.prompt(t('journal.entries.reversal.reasonPlaceholder'))
    if (!reversalReason || reversalReason.trim() === '') return
    setLocalError(null)
    try {
      await reverseEntryMutation.mutateAsync({
        entryUuid,
        fiscal_year_uuid: activeFiscalYearUuid,
        reversal_reason: reversalReason.trim(),
      })
      setSuccessMessage(t('journal.entries.reversed'))
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
      </section>
    )
  }

  return (
    <>
    <section className="space-y-4">
      {anyError && <Alert>{anyError}</Alert>}
      {successMessage && (
        <Banner variant="success" message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      )}
      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{t('journal.entries.filtersTitle')}</h2>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFilters(DEFAULT_FILTERS)}
          >
            {t('journal.entries.resetFilters')}
          </Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>{t('journal.entries.journal')}</Label>
            <select
              value={filters.journal_uuid}
              onChange={(event) => setFilters((prev) => ({ ...prev, journal_uuid: event.target.value }))}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t('journal.entries.allJournals')}</option>
              {journals.map((journal) => (
                <option key={journal.uuid} value={journal.uuid}>{journal.code} · {journal.name}</option>
              ))}
            </select>
          </div>
          {!lockState && (
          <div className="space-y-1">
            <Label>{t('journal.entries.state')}</Label>
            <select
              value={filters.state}
              onChange={(event) => setFilters((prev) => ({ ...prev, state: Number(event.target.value) }))}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value={0}>{t('journal.entries.allStates')}</option>
              <option value={1}>{t('journal.entries.states.draft')}</option>
              <option value={2}>{t('journal.entries.states.posted')}</option>
              <option value={3}>{t('journal.entries.states.cancelled')}</option>
            </select>
          </div>
          )}
          <div className="space-y-1">
            <Label>{t('journal.entries.search')}</Label>
            <Input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.member')}</Label>
            <Input
              value={filters.member}
              onChange={(event) => setFilters((prev) => ({ ...prev, member: event.target.value }))}
              placeholder={t('journal.entries.memberPlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.accountNumber')}</Label>
            <Input
              value={filters.account_code}
              onChange={(event) => setFilters((prev) => ({ ...prev, account_code: event.target.value }))}
              placeholder={t('journal.entries.accountNumberPlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.libelle')}</Label>
            <Input
              value={filters.description}
              onChange={(event) => setFilters((prev) => ({ ...prev, description: event.target.value }))}
              placeholder={t('journal.entries.libellePlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.dateFrom')}</Label>
            <Input
              type="date"
              value={filters.entry_date_from}
              onChange={(event) => setFilters((prev) => ({ ...prev, entry_date_from: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.dateTo')}</Label>
            <Input
              type="date"
              value={filters.entry_date_to}
              onChange={(event) => setFilters((prev) => ({ ...prev, entry_date_to: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.amountMin')}</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={filters.amount_min}
              onChange={(event) => setFilters((prev) => ({ ...prev, amount_min: event.target.value }))}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.amountMax')}</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={filters.amount_max}
              onChange={(event) => setFilters((prev) => ({ ...prev, amount_max: event.target.value }))}
              placeholder="99999.99"
            />
          </div>
          <div className="flex items-center gap-2 self-end pb-2">
            <Checkbox
              id="null-tiers-filter"
              checked={filters.null_tiers}
              onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, null_tiers: checked === true }))}
            />
            <Label htmlFor="null-tiers-filter" className="cursor-pointer">
              {t('journal.entries.nullTiers')}
            </Label>
          </div>
        </div>
      </div>

      {/* Entry list */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {t('journal.entries.listTitle')}
              {totalEntries > 0 && (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  ({page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalEntries)} / {totalEntries})
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{t('journal.entries.listDescription')}</p>
          </div>
          {canPost && (
            <div className="flex flex-wrap items-center gap-2">
              {activeFiscalYearUuid && draftEntries.length > 0 && (
                <>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={allVisibleDraftsSelected}
                      onChange={toggleSelectAllDrafts}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span>{t('journal.entries.bulk.selectAllDrafts')}</span>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={selectedEntryUuids.length === 0 || bulkPostMutation.isPending}
                    onClick={() => setConfirmBulkPostOpen(true)}
                  >
                    {bulkPostMutation.isPending
                      ? t('journal.entries.bulk.postingSelected')
                      : t('journal.entries.bulk.postSelected', { count: selectedEntryUuids.length })}
                  </Button>
                </>
              )}
              {activeFiscalYearUuid && totalEntries > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isExporting}
                  onClick={() => { void handleExportCsv() }}
                  title="Exporter les écritures filtrées en CSV"
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  {isExporting ? 'Export…' : 'CSV'}
                </Button>
              )}
              {activeFiscalYearUuid && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setImportOpen(true)}
                >
                  {t('journal.import.openBtn')}
                </Button>
              )}
              <a href="/banque/journal/entry/new">
                <Button type="button" size="sm">{t('journal.entries.newDraft')}</Button>
              </a>
            </div>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {entriesQuery.isLoading ? (
            <p className="text-sm text-slate-500">{t('settings.loading')}</p>
          ) : !activeFiscalYearUuid ? (
            <p className="text-sm text-slate-500">{t('journal.entries.selectFiscalYear')}</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-500">{t('journal.entries.empty')}</p>
          ) : (
            <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-slate-200">
              <table className="min-w-[680px] w-full table-fixed border-collapse text-left text-[11px]">
                <colgroup>
                  <col className="w-8" />
                  <col className="w-[88px]" />
                  <col className="w-[52px]" />
                  <col />
                  <col className="w-[100px]" />
                  <col className="w-[104px]" />
                  <col className="w-[72px]" />
                  <col className="w-[72px]" />
                </colgroup>
                <thead>
                  <tr className="h-9 border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="sticky left-0 z-20 w-8 bg-slate-50 px-2">
                      <input
                        type="checkbox"
                        checked={allVisibleDraftsSelected}
                        onChange={toggleSelectAllDrafts}
                        aria-label={t('journal.entries.bulk.selectAllDrafts')}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </th>
                    <th className="sticky left-8 z-20 bg-slate-50 px-2">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('entry_date')}>
                        {t('journal.entries.col.date')}
                        <ChevronDown className={`h-3 w-3 transition-transform ${sortKey === 'entry_date' && sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                      </button>
                    </th>
                    <th className="px-2">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('journal')}>
                        {t('journal.entries.col.journal')}
                        <ChevronDown className={`h-3 w-3 transition-transform ${sortKey === 'journal' && sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                      </button>
                    </th>
                    <th className="px-2">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('description')}>
                        {t('journal.entries.col.description')}
                        <ChevronDown className={`h-3 w-3 transition-transform ${sortKey === 'description' && sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                      </button>
                    </th>
                    <th className="px-2">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('reference')}>
                        {t('journal.entries.col.reference')}
                        <ChevronDown className={`h-3 w-3 transition-transform ${sortKey === 'reference' && sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                      </button>
                    </th>
                    <th className="px-2 text-right">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('amount')}>
                        {t('journal.entries.col.amount')}
                        <ChevronDown className={`h-3 w-3 transition-transform ${sortKey === 'amount' && sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                      </button>
                    </th>
                    <th className="px-2">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('state')}>
                        {t('journal.entries.col.state')}
                        <ChevronDown className={`h-3 w-3 transition-transform ${sortKey === 'state' && sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                      </button>
                    </th>
                    <th className="sticky right-0 z-20 bg-slate-50 px-2 text-right">{t('journal.entries.col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEntriesView.map((row, index) => {
                    const { entry, journalCode, amount } = row
                    const isDraftEntry = entry.state === 1 || entry.state === 3
                    const showGroupHeader = groupByJournal && (index === 0 || sortedEntriesView[index - 1].journalCode !== journalCode)
                    return (
                      <>
                        {showGroupHeader && (
                          <tr className="h-8 border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <td colSpan={8} className="px-3">{t('journal.entries.groupJournalLabel', { journal: journalCode })}</td>
                          </tr>
                        )}

                        <tr
                          key={entry.uuid}
                          className="group h-9 border-b border-slate-100 text-[11px] text-slate-700 hover:bg-slate-50"
                          onClick={() => setExpandedEntryUuid((prev) => (prev === entry.uuid ? null : entry.uuid))}
                        >
                          <td className="sticky left-0 z-10 bg-white px-2 group-hover:bg-slate-50" onClick={(event) => event.stopPropagation()}>
                            {isDraftEntry ? (
                              <input
                                type="checkbox"
                                checked={selectedEntryUuids.includes(entry.uuid)}
                                onChange={() => toggleEntrySelection(entry.uuid)}
                                aria-label={t('journal.entries.bulk.selectOne', { ref: entry.sequence_number ?? entry.description })}
                                className="h-4 w-4 rounded border-slate-300"
                              />
                            ) : null}
                          </td>
                          <td className="sticky left-8 z-10 bg-white px-2 tabular-nums group-hover:bg-slate-50">{formatDateFr(entry.entry_date)}</td>
                          <td className="px-2">
                            <span className="inline-flex min-w-8 justify-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                              {journalCode}
                            </span>
                          </td>
                          <td className="max-w-0 px-2">
                            <p className="truncate" title={entry.description}>{entry.description}</p>
                          </td>
                          <td className="px-2 text-slate-500">
                            <p className="truncate" title={entry.reference ?? ''}>{entry.reference ?? '—'}</p>
                          </td>
                          <td className="px-2 text-right font-mono tabular-nums">{formatAmountFr(amount)}</td>
                          <td className="px-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${entryStateBadgeClass(entry.state)}`}>
                              {entryStateLabel(entry.state, t)}
                            </span>
                          </td>
                          <td className="sticky right-0 z-10 bg-white px-2 text-right group-hover:bg-slate-50" onClick={(event) => event.stopPropagation()}>
                            <div className="inline-flex items-center justify-end gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                              {isDraftEntry && (
                                <>
                                  <button
                                    type="button"
                                    className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                                    aria-label={t('journal.entries.editDraft')}
                                    title={t('journal.entries.editDraft')}
                                    onClick={() => navigate(`/banque/journal/entry/${entry.uuid}`)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                                    aria-label={t('journal.entries.deleteEntry')}
                                    title={t('journal.entries.deleteEntry')}
                                    onClick={() => {
                                      if (window.confirm(t('journal.entries.confirmDelete'))) {
                                        deleteEntryMutation.mutate({
                                          entryUuid: entry.uuid,
                                          fiscalYearUuid: entry.fiscal_year_uuid,
                                        })
                                      }
                                    }}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                              {entry.state === 2 && (
                                <button
                                  type="button"
                                  className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                                  aria-label={t('journal.entries.reverseAction')}
                                  title={t('journal.entries.reverseAction')}
                                  onClick={() => void handleReverse(entry.uuid)}
                                >
                                  <Undo2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {expandedEntryUuid === entry.uuid && (
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <td colSpan={8} className="p-3">
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-700">{t('journal.entries.lineDetailsTitle')}</p>
                                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                                  <table className="min-w-[640px] w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                                        <th className="px-2 py-1 text-left">{t('journal.forms.account')}</th>
                                        <th className="px-2 py-1 text-right">{t('journal.forms.debit')}</th>
                                        <th className="px-2 py-1 text-right">{t('journal.forms.credit')}</th>
                                        <th className="px-2 py-1 text-left">{t('journal.forms.lineDescription')}</th>
                                        <th className="px-2 py-1 text-left">{t('journal.forms.tiers')}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entry.lines.map((line) => (
                                        <tr key={line.uuid} className="border-b border-slate-100 last:border-0">
                                          <td className="px-2 py-1 text-slate-700">
                                            <span className="font-mono text-[11px]">
                                              {accountLabelByUuid.get(line.account_uuid) ?? line.account_uuid}
                                            </span>
                                          </td>
                                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmountFr(line.debit)}</td>
                                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmountFr(line.credit)}</td>
                                          <td className="px-2 py-1 text-slate-600">{line.description ?? '—'}</td>
                                          <td className="px-2 py-1 text-slate-600">
                                            {line.tiers_display_ref || line.tiers_display_name
                                              ? [line.tiers_display_ref, line.tiers_display_name].filter(Boolean).join(' — ')
                                              : '—'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={groupByJournal}
                onChange={(event) => setGroupByJournal(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t('journal.entries.groupByJournal')}
            </label>
          </div>
        )}

        {/* Pagination */}
        {totalEntries > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-sm text-slate-500">
              {t('journal.entries.page', { current: page + 1, total: totalPages })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>

    {canPost && selectedEntryUuids.length > 0 && (
      <StickyActionBar>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={deleteEntryMutation.isPending}
          onClick={() => setConfirmBulkDeleteOpen(true)}
        >
          {deleteEntryMutation.isPending
            ? t('journal.entries.bulk.deletingSelected')
            : t('journal.entries.bulk.deleteSelected', { count: selectedEntryUuids.length })}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={bulkPostMutation.isPending}
          onClick={() => setConfirmBulkPostOpen(true)}
        >
          {bulkPostMutation.isPending
            ? t('journal.entries.bulk.postingSelected')
            : t('journal.entries.bulk.postSelected', { count: selectedEntryUuids.length })}
        </Button>
      </StickyActionBar>
    )}

    <AccountingImportDialog
      open={importOpen}
      onClose={() => setImportOpen(false)}
      fiscalYears={fiscalYears}
      journals={journals}
      defaultFiscalYearUuid={activeFiscalYearUuid || undefined}
    />

    <ConfirmDialog
      open={confirmBulkPostOpen}
      title={t('journal.entries.bulk.confirmTitle')}
      body={t('journal.entries.bulk.confirmBody', { count: selectedEntryUuids.length })}
      confirmLabel={t('journal.entries.bulk.confirmAction', { count: selectedEntryUuids.length })}
      cancelLabel={t('journal.entries.bulk.cancelAction')}
      onCancel={() => setConfirmBulkPostOpen(false)}
      onConfirm={() => {
        setConfirmBulkPostOpen(false)
        void handleBulkPost()
      }}
    />

    <ConfirmDialog
      open={confirmBulkDeleteOpen}
      title={t('journal.entries.bulk.confirmDeleteTitle')}
      body={t('journal.entries.bulk.confirmDeleteBody', { count: selectedEntryUuids.length })}
      confirmLabel={t('journal.entries.bulk.confirmDeleteAction', { count: selectedEntryUuids.length })}
      cancelLabel={t('journal.entries.bulk.cancelAction')}
      onCancel={() => setConfirmBulkDeleteOpen(false)}
      onConfirm={() => {
        setConfirmBulkDeleteOpen(false)
        void handleBulkDeleteDrafts()
      }}
    />
  </>
  )
}
