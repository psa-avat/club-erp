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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Dialog, DialogContent } from '@/components/ui/dialog'
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

function StatementDetail({ statementUuid, onBack }: { statementUuid: string; onBack: () => void }) {
  const { t } = useTranslation('banque')
  const { data: statement, isLoading } = useReconciliationStatementQuery(statementUuid)
  const runMatchMutation = useRunAutoMatchMutation()
  const [pickerLine, setPickerLine] = useState<BankStatementLine | null>(null)
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const unmatchMutation = useUnmatchLineMutation()

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
            data={statement.lines}
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
                {t('reconciliation.workspace.noLines', 'Aucune ligne dans ce relevé.')}
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
