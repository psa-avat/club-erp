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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import Decimal from 'decimal.js'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCapability } from '@/auth/hooks/useCapability'
import {
  useAccountingEntryQuery,
  useAccountsQuery,
  useDetectDiscrepanciesMutation,
  useManualMatchMutation,
  useReconciliationCandidatesQuery,
  useReconciliationLinesQuery,
  useReconciliationStatementQuery,
  useResolveDiscrepancyMutation,
  useRunAutoMatchMutation,
  useUnmatchLineMutation,
  type BankStatement,
  type BankStatementLine,
} from '../api'
import { normalizeAmountFilter, reconciliationLineStatusBadgeClass, reconciliationStatusBadgeClass } from './journalShared'
import { ReconciliationStatementList } from './ReconciliationStatementList'
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

// The default queue: unresolved lines (unmatched + discrepancy) first, per the
// UI system plan — opening a statement should land on actionable work, not a
// full browse-everything table. Sent as a comma-separated match_status filter.
const UNRESOLVED_STATUS_FILTER = 'unmatched,discrepancy'

type AppliedLineFilters = {
  description?: string
  match_status?: string
  date_from?: string
  date_to?: string
  amount_min?: string
  amount_max?: string
}

function StatementDetail({ statementUuid, onBack }: { statementUuid: string; onBack: () => void }) {
  const { t } = useTranslation('banque')
  const { data: statement, isLoading } = useReconciliationStatementQuery(statementUuid)
  const runMatchMutation = useRunAutoMatchMutation()
  const detectDiscrepanciesMutation = useDetectDiscrepanciesMutation()
  const [includeDrafts, setIncludeDrafts] = useState(true)
  const unmatchMutation = useUnmatchLineMutation()
  const [expandedLineUuid, setExpandedLineUuid] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const canManageSettings = useCapability('MANAGE_SYSTEM_SETTINGS')

  // Only the free-text libellé filter needs an explicit apply step (to avoid firing a
  // query per keystroke) — it has its own local draft state, committed via the Filtrer
  // button or Enter. Status/date/amount are discrete one-shot picks (a Select choice,
  // a date, a completed number), so they apply immediately on change.
  const [filterDescription, setFilterDescription] = useState('')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')
  const [appliedFilters, setAppliedFilters] = useState<AppliedLineFilters>({ match_status: UNRESOLVED_STATUS_FILTER })
  const [page, setPage] = useState(0)

  function setFilter(patch: Partial<AppliedLineFilters>) {
    setAppliedFilters((prev) => ({ ...prev, ...patch }))
    setPage(0)
  }

  function applyDescriptionFilter() {
    setFilter({ description: filterDescription.trim() || undefined })
  }

  function clearFilters() {
    setFilterDescription('')
    setFilterAmountMin('')
    setFilterAmountMax('')
    setAppliedFilters({})
    setPage(0)
  }

  const linesFilters = useMemo(
    () => ({ ...appliedFilters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [appliedFilters, page],
  )

  const linesQuery = useReconciliationLinesQuery(statement?.uuid ?? null, linesFilters, Boolean(statement))
  const lines = linesQuery.data?.items ?? []
  const totalLines = linesQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalLines / PAGE_SIZE))

  async function handleRunMatch() {
    if (!statement) return
    const result = await runMatchMutation.mutateAsync({ statementUuid: statement.uuid, includeDrafts })
    // Discrepancy classification (timing/duplicate/amount_variance/missing_entry) scans
    // every line server-side, so it's only triggered once here — not as an ambient query.
    await detectDiscrepanciesMutation.mutateAsync(statement.uuid)
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
          <Button
            size="sm"
            onClick={() => void handleRunMatch()}
            disabled={runMatchMutation.isPending || detectDiscrepanciesMutation.isPending}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            {runMatchMutation.isPending || detectDiscrepanciesMutation.isPending
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

      <form
        onSubmit={(e) => {
          e.preventDefault()
          applyDescriptionFilter()
        }}
        className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-3"
      >
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
          <Select
            value={appliedFilters.match_status || 'all'}
            onValueChange={(v) => setFilter({ match_status: v === 'all' ? undefined : v })}
          >
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNRESOLVED_STATUS_FILTER}>
                {t('reconciliation.workspace.filters.unresolved', 'À traiter')}
              </SelectItem>
              <SelectItem value="all">{t('reconciliation.workspace.filters.all', 'Tous')}</SelectItem>
              {LINE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(`reconciliation.lineStatus.${s}`, s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('reconciliation.workspace.filters.dateFrom', 'Du')}</Label>
          <Input
            type="date"
            value={appliedFilters.date_from ?? ''}
            onChange={(e) => setFilter({ date_from: e.target.value || undefined })}
            className="h-8 w-36"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('reconciliation.workspace.filters.dateTo', 'Au')}</Label>
          <Input
            type="date"
            value={appliedFilters.date_to ?? ''}
            onChange={(e) => setFilter({ date_to: e.target.value || undefined })}
            className="h-8 w-36"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t('reconciliation.workspace.filters.amountMin', 'Montant min')}
          </Label>
          <Input
            type="number"
            step="0.01"
            value={filterAmountMin}
            onChange={(e) => {
              setFilterAmountMin(e.target.value)
              setFilter({ amount_min: normalizeAmountFilter(e.target.value) })
            }}
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
            onChange={(e) => {
              setFilterAmountMax(e.target.value)
              setFilter({ amount_max: normalizeAmountFilter(e.target.value) })
            }}
            className="h-8 w-28"
          />
        </div>
        <Button type="submit" size="sm">
          {t('reconciliation.workspace.filters.apply', 'Filtrer')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={clearFilters}>
          {t('reconciliation.workspace.filters.clear', 'Effacer les filtres')}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('reconciliation.workspace.filters.count', '{{count}} / {{total}} ligne(s)', {
            count: lines.length,
            total: totalLines,
          })}
        </span>
      </form>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-2">
          <DataTable<BankStatementLine>
            columns={[
              {
                key: 'expand',
                header: '',
                className: 'w-8',
                cell: (row) =>
                  // 'excluded' lines have no candidate entry and nothing to visualize —
                  // every other status (including already-matched) keeps the chevron so
                  // the chosen entry can still be reviewed after matching.
                  row.match_status !== 'excluded' ? (
                    <button
                      type="button"
                      onClick={() => setExpandedLineUuid(expandedLineUuid === row.uuid ? null : row.uuid)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={
                        row.match_status === 'auto_matched' || row.match_status === 'manually_matched'
                          ? t('reconciliation.workspace.viewMatch', "Voir l'écriture associée")
                          : t('reconciliation.workspace.associate', 'Associer')
                      }
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
                  <span className="inline-flex items-center gap-1">
                    <Badge className={reconciliationLineStatusBadgeClass(row.match_status)}>
                      {t(`reconciliation.lineStatus.${row.match_status}`, row.match_status)}
                    </Badge>
                    {row.match_confidence && (
                      <span className="text-[10px] text-muted-foreground">({row.match_confidence})</span>
                    )}
                  </span>
                ),
              },
            ]}
            data={lines}
            getRowKey={(row) => row.uuid}
            expandedRow={expandedLineUuid}
            renderExpanded={(row) => (
              <ExpandedLineContent
                statement={statement}
                line={row}
                includeDrafts={includeDrafts}
                onResolved={() => setExpandedLineUuid(null)}
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
        </div>
      </div>

      <ReconciliationMatchingSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

/** Everything needed to resolve one line lives in a single expanded row: the
 * discrepancy summary + resolve actions (when flagged), and the candidate list
 * to associate — or re-associate — a GL entry. No separate side panel. */
function ExpandedLineContent({
  statement,
  line,
  includeDrafts,
  onResolved,
}: {
  statement: BankStatement
  line: BankStatementLine
  includeDrafts: boolean
  onResolved: () => void
}) {
  const isMatched = line.match_status === 'auto_matched' || line.match_status === 'manually_matched'
  return (
    <div className="space-y-3 border-y bg-muted/30 px-4 py-3">
      {line.match_status === 'discrepancy' && <DiscrepancyActions line={line} onResolved={onResolved} />}
      {isMatched ? (
        <MatchedEntrySummary line={line} />
      ) : (
        <CandidateEntriesList statement={statement} line={line} includeDrafts={includeDrafts} onMatched={onResolved} />
      )}
    </div>
  )
}

/** Read-only view of the entry a matched line is associated with — the chevron stays
 * available after matching precisely so this can be reviewed without dissociating first. */
function MatchedEntrySummary({ line }: { line: BankStatementLine }) {
  const { t } = useTranslation('banque')
  const { data: entry, isLoading } = useAccountingEntryQuery(line.matched_entry_uuid, line.matched_fiscal_year_uuid)

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {t('reconciliation.workspace.matchedEntry', 'Écriture associée')}
      </p>
      {isLoading && <p className="text-sm text-muted-foreground">{t('common.loading', 'Chargement…')}</p>}
      {!isLoading && !entry && (
        <p className="text-sm text-muted-foreground">
          {t('reconciliation.workspace.matchedEntryNotFound', 'Écriture associée introuvable.')}
        </p>
      )}
      {entry && (
        <div className="flex items-center justify-between gap-2 rounded border bg-card px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            {entry.entry_date} · {entry.description}
            {entry.state === 1 && (
              <Badge className="ml-2 badge-warning">{t('reconciliation.workspace.draft', 'Brouillon')}</Badge>
            )}
            {entry.reference && <span className="ml-2 text-xs text-muted-foreground">{entry.reference}</span>}
          </span>
          {line.match_confidence && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{line.match_confidence}</span>
          )}
        </div>
      )}
    </div>
  )
}

const DISCREPANCY_TYPE_BADGE: Record<string, string> = {
  missing_entry: 'badge-destructive',
  amount_variance: 'badge-warning',
  timing: 'badge-warning',
  duplicate: 'badge-destructive',
}

function DiscrepancyActions({ line, onResolved }: { line: BankStatementLine; onResolved: () => void }) {
  const { t } = useTranslation('banque')
  const { data: accounts } = useAccountsQuery()
  const resolveMutation = useResolveDiscrepancyMutation()
  const [counterAccount, setCounterAccount] = useState('')

  async function resolve(action: 'accept' | 'exclude' | 'create_correcting_entry') {
    if (action === 'create_correcting_entry' && !counterAccount) {
      toast.error(t('reconciliation.discrepancies.counterAccountRequired', 'Sélectionnez un compte de contrepartie.'))
      return
    }
    try {
      await resolveMutation.mutateAsync({
        line_uuid: line.uuid,
        action,
        counter_account_uuid: action === 'create_correcting_entry' ? counterAccount : undefined,
      })
      toast.success(t('reconciliation.discrepancies.resolved', 'Écart résolu'))
      onResolved()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err instanceof Error ? err.message : t('reconciliation.discrepancies.error', 'Échec de la résolution'))
      toast.error(detail)
    }
  }

  return (
    <div className="space-y-2 rounded border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        {line.discrepancy_type && (
          <Badge className={DISCREPANCY_TYPE_BADGE[line.discrepancy_type] ?? 'badge-warning'}>
            {t(`reconciliation.discrepancyType.${line.discrepancy_type}`, line.discrepancy_type)}
          </Badge>
        )}
        {line.discrepancy_notes && <span className="text-xs text-muted-foreground">{line.discrepancy_notes}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!line.matched_entry_uuid} onClick={() => void resolve('accept')}>
          {t('reconciliation.discrepancies.accept', 'Accepter')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void resolve('exclude')}>
          {t('reconciliation.discrepancies.exclude', 'Exclure')}
        </Button>
        <Select value={counterAccount} onValueChange={setCounterAccount}>
          <SelectTrigger className="h-8 w-48">
            <SelectValue placeholder={t('reconciliation.discrepancies.counterAccount', 'Compte contrepartie')} />
          </SelectTrigger>
          <SelectContent>
            {(accounts ?? []).filter((a) => a.is_posting_allowed).map((a) => (
              <SelectItem key={a.uuid} value={a.uuid}>{a.code} · {a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => void resolve('create_correcting_entry')}>
          {t('reconciliation.discrepancies.createEntry', "Générer l'écriture")}
        </Button>
      </div>
    </div>
  )
}

function CandidateEntriesList({
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
  // Backend-scored candidates: same eligibility/scoring/internal-transfer-cap logic
  // run_auto_match uses, so this list can never show a candidate auto-match would
  // rank or flag differently — and an already-matched entry never appears here,
  // since an entry can only ever be reconciled to one line at a time.
  const { data: candidates, isLoading } = useReconciliationCandidatesQuery(line.uuid, includeDrafts)
  const manualMatchMutation = useManualMatchMutation()

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
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {t('reconciliation.workspace.pickEntry', 'Associer une écriture')}
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {isLoading && <p className="text-sm text-muted-foreground">{t('common.loading', 'Chargement…')}</p>}
        {!isLoading && (candidates ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('reconciliation.workspace.noEntries', 'Aucune écriture dans le seuil de montant configuré.')}
          </p>
        )}
        {(candidates ?? []).map((candidate) => {
          const isExactAmount = new Decimal(candidate.amount_diff).isZero()
          return (
            <button
              key={candidate.entry_uuid}
              type="button"
              onClick={() => void handlePick(candidate.entry_uuid)}
              disabled={manualMatchMutation.isPending}
              className="flex w-full items-center justify-between gap-2 rounded border bg-card px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
            >
              <span className="min-w-0 truncate">
                {candidate.entry_date} · {candidate.description}
                {candidate.state === 1 && (
                  <Badge className="ml-2 badge-warning">{t('reconciliation.workspace.draft', 'Brouillon')}</Badge>
                )}
                {candidate.is_internal_transfer && (
                  <Badge className="ml-2 badge-info">
                    {t('reconciliation.workspace.internalTransfer', 'Virement interne')}
                  </Badge>
                )}
                {candidate.reference && <span className="ml-2 text-xs text-muted-foreground">{candidate.reference}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{candidate.score}</span>
                <span className={`font-mono text-xs ${isExactAmount ? 'font-semibold text-success' : 'text-muted-foreground'}`}>
                  {new Decimal(candidate.amount).toFixed(2)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
