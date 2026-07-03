/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: statement detail workspace (lines, matching, discrepancies, report)
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
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCapability } from '@/auth/hooks/useCapability'
import {
  useAccountingEntriesQuery,
  useManualMatchMutation,
  useReconciliationLinesQuery,
  useReconciliationStatementQuery,
  useRunAutoMatchMutation,
  useUnmatchLineMutation,
  type AccountingEntry,
  type BankStatement,
  type BankStatementLine,
} from '../api'
import { normalizeAmountFilter, reconciliationLineStatusBadgeClass, reconciliationStatusBadgeClass, useDebounce } from './journalShared'
import { ReconciliationStatementList } from './ReconciliationStatementList'
import { ReconciliationDiscrepancies } from './ReconciliationDiscrepancies'
import { ReconciliationReport } from './ReconciliationReport'
import { ReconciliationMatchingSettingsDialog } from './ReconciliationMatchingSettingsDialog'

const PAGE_SIZE = 50

export function ReconciliationWorkspace() {
  const [selectedStatementUuid, setSelectedStatementUuid] = useState<string | null>(null)

  if (!selectedStatementUuid) {
    return <ReconciliationStatementList onOpenStatement={setSelectedStatementUuid} />
  }

  return (
    <StatementDetail
      statementUuid={selectedStatementUuid}
      onBack={() => setSelectedStatementUuid(null)}
    />
  )
}

const LINE_STATUSES: BankStatementLine['match_status'][] = [
  'unmatched',
  'auto_matched',
  'manually_matched',
  'discrepancy',
  'excluded',
]

function StatementDetail({ statementUuid, onBack }: { statementUuid: string; onBack: () => void }) {
  const { t } = useTranslation('banque')
  const { data: statement, isLoading } = useReconciliationStatementQuery(statementUuid)
  const runMatchMutation = useRunAutoMatchMutation()
  const [includeDrafts, setIncludeDrafts] = useState(true)
  const unmatchMutation = useUnmatchLineMutation()
  const [expandedLineUuid, setExpandedLineUuid] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const canManageSettings = useCapability('MANAGE_SYSTEM_SETTINGS')

  const [filterDescription, setFilterDescription] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')
  const [page, setPage] = useState(0)

  const debouncedDescription = useDebounce(filterDescription, 350)

  const baseLineFilters = useMemo(
    () => ({
      description: debouncedDescription.trim() || undefined,
      match_status: filterStatus || undefined,
      date_from: filterDateFrom || undefined,
      date_to: filterDateTo || undefined,
      amount_min: normalizeAmountFilter(filterAmountMin),
      amount_max: normalizeAmountFilter(filterAmountMax),
    }),
    [debouncedDescription, filterStatus, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax],
  )

  // Reset to page 0 whenever a filter changes, so the user isn't left on an out-of-range page.
  useEffect(() => {
    setPage(0)
  }, [baseLineFilters])

  const linesFilters = useMemo(
    () => ({ ...baseLineFilters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [baseLineFilters, page],
  )

  const linesQuery = useReconciliationLinesQuery(statement?.uuid ?? null, linesFilters, Boolean(statement))
  const lines = linesQuery.data?.items ?? []
  const totalLines = linesQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalLines / PAGE_SIZE))

  function clearFilters() {
    setFilterDescription('')
    setFilterStatus('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterAmountMin('')
    setFilterAmountMax('')
  }

  async function handleRunMatch() {
    if (!statement) return
    const result = await runMatchMutation.mutateAsync({ statementUuid: statement.uuid, includeDrafts })
    toast.success(
      t('reconciliation.workspace.matchResult', '{{auto}} auto · {{review}} à vérifier · {{unmatched}} non trouvé(s)', {
        auto: result.auto_matched,
        review: result.flagged_review,
        unmatched: result.unmatched,
      }),
    )
  }

  async function handleUnmatch(line: BankStatementLine) {
    await unmatchMutation.mutateAsync({ line_uuid: line.uuid, reason: 'unmatched by user' })
    toast.success(t('reconciliation.workspace.unmatched', 'Ligne dissociée'))
  }

  if (isLoading || !statement) {
    return <p className="text-sm text-muted-foreground">{t('common.loading', 'Chargement…')}</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('reconciliation.workspace.back', 'Retour')}
          </Button>
          <div>
            <h2 className="text-base font-semibold">
              {t('reconciliation.workspace.title', 'Relevé du {{date}}', { date: statement.statement_date })}
            </h2>
            <Badge className={reconciliationStatusBadgeClass(statement.status)}>
              {t(`reconciliation.status.${statement.status}`, statement.status)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={includeDrafts}
              onChange={(e) => setIncludeDrafts(e.target.checked)}
            />
            {t('reconciliation.workspace.includeDrafts', 'Inclure les brouillons')}
          </label>
          <Button size="sm" onClick={() => void handleRunMatch()} disabled={runMatchMutation.isPending}>
            <RefreshCw className="mr-1 h-4 w-4" />
            {runMatchMutation.isPending
              ? t('reconciliation.workspace.matching', 'Matching…')
              : t('reconciliation.workspace.runMatch', 'Lancer le matching')}
          </Button>
          {canManageSettings && (
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="mr-1 h-4 w-4" />
              {t('reconciliation.settings.title', 'Paramètres de matching')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t('reconciliation.workspace.filters.description', 'Libellé')}
          </Label>
          <Input
            value={filterDescription}
            onChange={(e) => setFilterDescription(e.target.value)}
            placeholder={t('reconciliation.workspace.filters.descriptionPlaceholder', 'Rechercher…')}
            className="h-8 w-48"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t('reconciliation.workspace.filters.status', 'Statut')}
          </Label>
          <Select value={filterStatus || 'all'} onValueChange={(v) => setFilterStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('reconciliation.workspace.filters.all', 'Tous')}</SelectItem>
              {LINE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(`reconciliation.lineStatus.${s}`, s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('reconciliation.workspace.filters.dateFrom', 'Du')}</Label>
          <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-8 w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('reconciliation.workspace.filters.dateTo', 'Au')}</Label>
          <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="h-8 w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t('reconciliation.workspace.filters.amountMin', 'Montant min')}
          </Label>
          <Input
            type="number"
            step="0.01"
            value={filterAmountMin}
            onChange={(e) => setFilterAmountMin(e.target.value)}
            className="h-8 w-28"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t('reconciliation.workspace.filters.amountMax', 'Montant max')}
          </Label>
          <Input
            type="number"
            step="0.01"
            value={filterAmountMax}
            onChange={(e) => setFilterAmountMax(e.target.value)}
            className="h-8 w-28"
          />
        </div>
        <Button size="sm" variant="outline" onClick={clearFilters}>
          {t('reconciliation.workspace.filters.clear', 'Effacer les filtres')}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('reconciliation.workspace.filters.count', '{{count}} / {{total}} ligne(s)', {
            count: lines.length,
            total: totalLines,
          })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-2">
          <DataTable<BankStatementLine>
            columns={[
              {
                key: 'expand',
                header: '',
                className: 'w-8',
                cell: (row) =>
                  row.match_status === 'unmatched' || row.match_status === 'discrepancy' ? (
                    <button
                      type="button"
                      onClick={() => setExpandedLineUuid(expandedLineUuid === row.uuid ? null : row.uuid)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={t('reconciliation.workspace.associate', 'Associer')}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${expandedLineUuid === row.uuid ? '' : '-rotate-90'}`} />
                    </button>
                  ) : null,
              },
              { key: 'line_date', header: t('reconciliation.workspace.columns.date', 'Date'), cell: (row) => row.line_date },
              {
                key: 'description',
                header: t('reconciliation.workspace.columns.description', 'Libellé'),
                cell: (row) => row.description || '—',
              },
              {
                key: 'amount',
                header: t('reconciliation.workspace.columns.amount', 'Montant'),
                cell: (row) => <span className="font-mono">{row.amount}</span>,
              },
              {
                key: 'match_status',
                header: t('reconciliation.workspace.columns.status', 'Statut'),
                cell: (row) => (
                  <Badge className={reconciliationLineStatusBadgeClass(row.match_status)}>
                    {t(`reconciliation.lineStatus.${row.match_status}`, row.match_status)}
                  </Badge>
                ),
              },
            ]}
            data={lines}
            getRowKey={(row) => row.uuid}
            expandedRow={expandedLineUuid}
            renderExpanded={(row) => (
              <CandidateEntriesSubList
                statement={statement}
                line={row}
                includeDrafts={includeDrafts}
                onMatched={() => setExpandedLineUuid(null)}
              />
            )}
            actions={(row) =>
              (row.match_status === 'auto_matched' || row.match_status === 'manually_matched') && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive hover:underline"
                  onClick={() => void handleUnmatch(row)}
                >
                  {t('reconciliation.workspace.dissociate', 'Dissocier')}
                </button>
              )
            }
            emptyState={
              <p className="py-8 text-center text-sm text-muted-foreground">
                {linesQuery.isLoading
                  ? t('common.loading', 'Chargement…')
                  : statement.line_count === 0
                    ? t('reconciliation.workspace.noLines', 'Aucune ligne dans ce relevé.')
                    : t('reconciliation.workspace.noLinesMatchFilters', 'Aucune ligne ne correspond aux filtres.')}
              </p>
            }
          />

          {totalLines > 0 && (
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="h-4 w-4" />
                {t('reconciliation.workspace.prev', 'Précédent')}
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                {t('reconciliation.workspace.pageInfo', 'Page {{page}} / {{total}}', { page: page + 1, total: totalPages })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('reconciliation.workspace.next', 'Suivant')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <ReconciliationReport statement={statement} />
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('reconciliation.workspace.discrepancies', 'Écarts à résoudre')}</h3>
            <ReconciliationDiscrepancies statementUuid={statement.uuid} />
          </div>
        </div>
      </div>

      <ReconciliationMatchingSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

/** Cheap client-side relevance ordering (closest date first) — the full weighted
 * score lives server-side in run_auto_match; this is just a browsing aid. */
function daysBetween(isoDate: string, other: string): number {
  return Math.abs((new Date(isoDate).getTime() - new Date(other).getTime()) / 86_400_000)
}

function CandidateEntriesSubList({
  statement,
  line,
  includeDrafts,
  onMatched,
}: {
  statement: BankStatement
  line: BankStatementLine
  includeDrafts: boolean
  onMatched: () => void
}) {
  const { t } = useTranslation('banque')
  const { data: entries, isLoading } = useAccountingEntriesQuery({
    fiscal_year_uuid: statement.fiscal_year_uuid,
    journal_uuid: statement.journal_uuid,
    ...(includeDrafts ? {} : { state: 2 }),
    limit: 100,
  })
  const manualMatchMutation = useManualMatchMutation()

  const sortedEntries = useMemo(() => {
    const list: AccountingEntry[] = entries ?? []
    return [...list].sort((a, b) => daysBetween(a.entry_date, line.line_date) - daysBetween(b.entry_date, line.line_date))
  }, [entries, line.line_date])

  async function handlePick(entryUuid: string) {
    try {
      await manualMatchMutation.mutateAsync({
        line_uuid: line.uuid,
        entry_uuid: entryUuid,
        fiscal_year_uuid: statement.fiscal_year_uuid,
        include_drafts: includeDrafts,
      })
      toast.success(t('reconciliation.workspace.associated', 'Ligne associée'))
      onMatched()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err instanceof Error ? err.message : t('reconciliation.workspace.associateError', "Échec de l'association"))
      toast.error(detail)
    }
  }

  return (
    <div className="space-y-2 border-y bg-muted/30 px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t('reconciliation.workspace.pickEntry', 'Associer une écriture')}
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {isLoading && <p className="text-sm text-muted-foreground">{t('common.loading', 'Chargement…')}</p>}
        {!isLoading && sortedEntries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('reconciliation.workspace.noEntries', 'Aucune écriture postée disponible.')}
          </p>
        )}
        {sortedEntries.map((entry) => (
          <button
            key={entry.uuid}
            type="button"
            onClick={() => void handlePick(entry.uuid)}
            disabled={manualMatchMutation.isPending}
            className="flex w-full items-center justify-between gap-2 rounded border bg-card px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
          >
            <span className="truncate">
              {entry.entry_date} · {entry.description}
              {entry.state === 1 && (
                <Badge className="ml-2 badge-warning">{t('reconciliation.workspace.draft', 'Brouillon')}</Badge>
              )}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{entry.reference || '—'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
