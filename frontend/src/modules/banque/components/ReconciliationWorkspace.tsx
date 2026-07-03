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
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import Decimal from 'decimal.js'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useAccountingEntriesQuery,
  useManualMatchMutation,
  useReconciliationStatementQuery,
  useRunAutoMatchMutation,
  useUnmatchLineMutation,
  type BankStatement,
  type BankStatementLine,
} from '../api'
import { reconciliationLineStatusBadgeClass, reconciliationStatusBadgeClass } from './journalShared'
import { ReconciliationStatementList } from './ReconciliationStatementList'
import { ReconciliationDiscrepancies } from './ReconciliationDiscrepancies'
import { ReconciliationReport } from './ReconciliationReport'

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

/** Parses a filter input as a Decimal, tolerating incomplete typing (e.g. "-", "1."). */
function parseFilterDecimal(raw: string): Decimal | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return new Decimal(trimmed)
  } catch {
    return null
  }
}

function StatementDetail({ statementUuid, onBack }: { statementUuid: string; onBack: () => void }) {
  const { t } = useTranslation('banque')
  const { data: statement, isLoading } = useReconciliationStatementQuery(statementUuid)
  const runMatchMutation = useRunAutoMatchMutation()
  const [pickerLine, setPickerLine] = useState<BankStatementLine | null>(null)
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const unmatchMutation = useUnmatchLineMutation()

  const [filterDescription, setFilterDescription] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')

  const filteredLines = useMemo(() => {
    if (!statement) return []
    const descriptionQuery = filterDescription.trim().toLowerCase()
    const minAmount = parseFilterDecimal(filterAmountMin)
    const maxAmount = parseFilterDecimal(filterAmountMax)

    return statement.lines.filter((line) => {
      if (descriptionQuery && !(line.description ?? '').toLowerCase().includes(descriptionQuery)) return false
      if (filterStatus && line.match_status !== filterStatus) return false
      if (filterDateFrom && line.line_date < filterDateFrom) return false
      if (filterDateTo && line.line_date > filterDateTo) return false
      if (minAmount && new Decimal(line.amount).lessThan(minAmount)) return false
      if (maxAmount && new Decimal(line.amount).greaterThan(maxAmount)) return false
      return true
    })
  }, [statement, filterDescription, filterStatus, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax])

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
            count: filteredLines.length,
            total: statement.lines.length,
          })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable<BankStatementLine>
            columns={[
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
            data={filteredLines}
            getRowKey={(row) => row.uuid}
            actions={(row) => (
              <div className="flex gap-2">
                {(row.match_status === 'unmatched' || row.match_status === 'discrepancy') && (
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => setPickerLine(row)}
                  >
                    {t('reconciliation.workspace.associate', 'Associer')}
                  </button>
                )}
                {(row.match_status === 'auto_matched' || row.match_status === 'manually_matched') && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive hover:underline"
                    onClick={() => void handleUnmatch(row)}
                  >
                    {t('reconciliation.workspace.dissociate', 'Dissocier')}
                  </button>
                )}
              </div>
            )}
            emptyState={
              <p className="py-8 text-center text-sm text-muted-foreground">
                {statement.lines.length === 0
                  ? t('reconciliation.workspace.noLines', 'Aucune ligne dans ce relevé.')
                  : t('reconciliation.workspace.noLinesMatchFilters', 'Aucune ligne ne correspond aux filtres.')}
              </p>
            }
          />
        </div>

        <div className="space-y-4">
          <ReconciliationReport statement={statement} />
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('reconciliation.workspace.discrepancies', 'Écarts à résoudre')}</h3>
            <ReconciliationDiscrepancies statementUuid={statement.uuid} />
          </div>
        </div>
      </div>

      {pickerLine && (
        <EntryPickerDialog
          statement={statement}
          line={pickerLine}
          includeDrafts={includeDrafts}
          onClose={() => setPickerLine(null)}
        />
      )}
    </div>
  )
}

function EntryPickerDialog({
  statement,
  line,
  includeDrafts,
  onClose,
}: {
  statement: BankStatement
  line: BankStatementLine
  includeDrafts: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('banque')
  const { data: entries, isLoading } = useAccountingEntriesQuery({
    fiscal_year_uuid: statement.fiscal_year_uuid,
    journal_uuid: statement.journal_uuid,
    ...(includeDrafts ? {} : { state: 2 }),
    limit: 100,
  })
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
      onClose()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err instanceof Error ? err.message : t('reconciliation.workspace.associateError', "Échec de l'association"))
      toast.error(detail)
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogContent className="sm:max-w-lg" aria-labelledby="entry-picker-title">
        <div className="space-y-3">
          <div>
            <h2 id="entry-picker-title" className="text-lg font-semibold text-foreground">
              {t('reconciliation.workspace.pickEntry', 'Associer une écriture')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {line.line_date} · {line.description || '—'} · {line.amount}
            </p>
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {isLoading && <p className="text-sm text-muted-foreground">{t('common.loading', 'Chargement…')}</p>}
            {!isLoading && (entries ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('reconciliation.workspace.noEntries', 'Aucune écriture postée disponible.')}
              </p>
            )}
            {(entries ?? []).map((entry) => (
              <button
                key={entry.uuid}
                type="button"
                onClick={() => void handlePick(entry.uuid)}
                className="flex w-full items-center justify-between gap-2 rounded border px-3 py-2 text-left text-sm hover:bg-muted"
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

          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('reconciliation.workspace.cancel', 'Annuler')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
