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
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Banner } from '../../../components/ui/banner'
import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountingEntriesQuery,
  useAccountingEntriesCountQuery,
  useBulkPostAccountingEntriesMutation,
  useDeleteAccountingEntryMutation,
  useFiscalYearsQuery,
  useJournalsQuery,
} from '../api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { entryStateLabel, totals, JournalPageShell, entryStateBadgeClass, useDebounce, decimalOrZero, toErrorMessage } from './journalShared'
import { AccountingImportDialog } from './AccountingImportDialog'

export function JournalEntriesScreen() {
  const { t } = useTranslation('banque')
  const navigate = useNavigate()
  const canView = useCapability('VIEW_FINANCIALS')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')
  const canManageModels = useCapability('MANAGE_ACCOUNTING_SETTINGS')

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const journalsQuery = useJournalsQuery(canView)

  const PAGE_SIZE = 50

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const [filters, setFilters] = useState({ journal_uuid: '', state: 0, search: '' })
  const [page, setPage] = useState(0)
  const [selectedEntryUuids, setSelectedEntryUuids] = useState<string[]>([])
  const debouncedSearch = useDebounce(filters.search, 350)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmBulkPostOpen, setConfirmBulkPostOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fiscalYears = fiscalYearsQuery.data ?? []
  const journals = journalsQuery.data ?? []

  const baseFilters = useMemo(
    () => ({
      fiscal_year_uuid: activeFiscalYearUuid ?? undefined,
      journal_uuid: filters.journal_uuid || undefined,
      state: filters.state || undefined,
      search: debouncedSearch.trim() || undefined,
    }),
    [activeFiscalYearUuid, filters.journal_uuid, filters.state, debouncedSearch],
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

  const draftEntries = useMemo(
    () => entries.filter((entry) => entry.state === 1),
    [entries],
  )
  const allVisibleDraftsSelected =
    draftEntries.length > 0 && draftEntries.every((entry) => selectedEntryUuids.includes(entry.uuid))

  useEffect(() => {
    setSelectedEntryUuids((prev) =>
      prev.filter((uuid) => entries.some((entry) => entry.uuid === uuid && entry.state === 1)),
    )
  }, [entries])

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0)
  }, [baseFilters])

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

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
      </section>
    )
  }

  return (
    <>
    <JournalPageShell canPost={canPost} canManageModels={canManageModels} t={t}>
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
            onClick={() => setFilters({ journal_uuid: '', state: 0, search: '' })}
          >
            {t('journal.entries.resetFilters')}
          </Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
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
          <div className="space-y-1">
            <Label>{t('journal.entries.search')}</Label>
            <Input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
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
            entries.map((entry) => {
              const summary = totals(
                entry.lines.map((line) => {
                  const debit = decimalOrZero(line.debit)
                  const credit = decimalOrZero(line.credit)
                  const amount = debit.greaterThan(0) ? debit : credit.negated()
                  return {
                    account_uuid: line.account_uuid,
                    amount: amount.toFixed(2),
                    description: line.description ?? '',
                    member_uuid: line.member_uuid ?? '',
                  }
                }),
              )
              const isDraftEntry = entry.state === 1
              const entryRef = entry.sequence_number ?? entry.description
              return (
                <div key={entry.uuid} className="flex items-stretch gap-3">
                  {canPost && isDraftEntry ? (
                    <label className="flex shrink-0 items-start pt-4" aria-label={t('journal.entries.bulk.selectOne', { ref: entryRef })}>
                      <input
                        type="checkbox"
                        checked={selectedEntryUuids.includes(entry.uuid)}
                        onChange={() => toggleEntrySelection(entry.uuid)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </label>
                  ) : (
                    <div className="w-4 shrink-0" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={() => navigate(`/banque/journal/entry/${entry.uuid}`)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{entry.sequence_number ?? t('journal.entries.draftSequence')}</p>
                        <p className="text-sm text-slate-700">{entry.description}</p>
                        <p className="text-xs text-slate-500">{entry.entry_date} · {entry.reference ?? t('journal.entries.noReference')}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${entryStateBadgeClass(entry.state)}`}>
                        {entryStateLabel(entry.state, t)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>{entry.lines.length} {t('journal.entries.linesCount')}</span>
                      <span className="font-mono">D {summary.debit} / C {summary.credit}</span>
                    </div>
                  </button>
                  {canPost && isDraftEntry && (
                    <button
                      type="button"
                      title={t('journal.entries.deleteEntry')}
                      disabled={deleteEntryMutation.isPending}
                      className="flex shrink-0 items-center self-stretch rounded-lg border border-red-200 bg-white px-2 text-red-400 transition-colors hover:border-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      onClick={() => {
                        if (window.confirm(t('journal.entries.confirmDelete'))) {
                          deleteEntryMutation.mutate({
                            entryUuid: entry.uuid,
                            fiscalYearUuid: entry.fiscal_year_uuid,
                          })
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

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
    </JournalPageShell>

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
  </>
  )
}
