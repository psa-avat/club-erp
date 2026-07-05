/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: statement list with import/delete actions
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
import { FileUp, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import Decimal from 'decimal.js'

import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useFiscalYearStore } from '@/store/fiscalYearStore'
import {
  useDeleteReconciliationStatementMutation,
  useJournalsQuery,
  useReconciliationStatementsQuery,
  type BankStatementSummary,
} from '../api'
import { reconciliationStatusBadgeClass } from './journalShared'
import { ReconciliationImportPanel } from './ReconciliationImportPanel'
import { CsvMappingWizard } from './CsvMappingWizard'

interface Props {
  onOpenStatement: (statementUuid: string) => void
}

export function ReconciliationStatementList({ onOpenStatement }: Props) {
  const { t } = useTranslation('banque')
  const fiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid) ?? undefined

  const [importOpen, setImportOpen] = useState(false)
  const [mappingsOpen, setMappingsOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BankStatementSummary | null>(null)

  const { data, isLoading } = useReconciliationStatementsQuery({ fiscal_year_uuid: fiscalYearUuid })
  const { data: journals } = useJournalsQuery()
  const deleteMutation = useDeleteReconciliationStatementMutation()

  const journalLabel = (journalUuid: string) => {
    const journal = (journals ?? []).find((j) => j.uuid === journalUuid)
    return journal ? `${journal.code} · ${journal.name}` : journalUuid.slice(0, 8)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteMutation.mutateAsync(deleteTarget.uuid)
    toast.success(t('reconciliation.list.deleted', 'Relevé supprimé'))
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('reconciliation.list.title', 'Relevés bancaires')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('reconciliation.list.description', 'Import, matching et clôture des relevés bancaires.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setMappingsOpen(true)}>
            <Settings2 className="mr-1 h-4 w-4" />
            {t('reconciliation.list.csvMappings', 'Mappings CSV')}
          </Button>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <FileUp className="mr-1 h-4 w-4" />
            {t('reconciliation.list.import', 'Importer un relevé')}
          </Button>
        </div>
      </div>

      <DataTable<BankStatementSummary>
        columns={[
          {
            key: 'statement_date',
            header: t('reconciliation.list.columns.date', 'Date'),
            cell: (row) => row.statement_date,
          },
          {
            key: 'journal_uuid',
            header: t('reconciliation.list.columns.journal', 'Journal'),
            cell: (row) => journalLabel(row.journal_uuid),
          },
          {
            key: 'line_count',
            header: t('reconciliation.list.columns.lines', 'Lignes'),
            cell: (row) => row.line_count,
          },
          {
            key: 'unresolved_count',
            header: t('reconciliation.list.columns.toReview', 'À traiter'),
            cell: (row) =>
              row.unresolved_count > 0 ? (
                <Badge className="badge-warning">{row.unresolved_count}</Badge>
              ) : (
                <span className="text-muted-foreground">0</span>
              ),
          },
          {
            key: 'live_balance_difference',
            header: t('reconciliation.list.columns.balanceDifference', 'Écart'),
            cell: (row) => {
              const diff = new Decimal(row.live_balance_difference)
              return (
                <span className={diff.isZero() ? 'text-muted-foreground' : 'font-semibold text-destructive'}>
                  {diff.toFixed(2)}
                </span>
              )
            },
          },
          {
            key: 'closing_balance',
            header: t('reconciliation.list.columns.closingBalance', 'Solde final'),
            cell: (row) => row.closing_balance,
          },
          {
            key: 'status',
            header: t('reconciliation.list.columns.status', 'Statut'),
            cell: (row) => (
              <Badge className={reconciliationStatusBadgeClass(row.status)}>
                {t(`reconciliation.status.${row.status}`, row.status)}
              </Badge>
            ),
          },
        ]}
        data={data?.items ?? []}
        getRowKey={(row) => row.uuid}
        onRowClick={(row) => onOpenStatement(row.uuid)}
        actions={(row) => (
          row.status !== 'reconciled' ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(row) }}
              aria-label={t('reconciliation.list.delete', 'Supprimer')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null
        )}
        emptyState={
          <p className="py-8 text-center text-sm text-muted-foreground">
            {isLoading
              ? t('common.loading', 'Chargement…')
              : t('reconciliation.list.empty', 'Aucun relevé importé pour cet exercice.')}
          </p>
        }
      />

      <ReconciliationImportPanel
        open={importOpen}
        onClose={() => setImportOpen(false)}
        defaultFiscalYearUuid={fiscalYearUuid}
        onImported={(statementUuid) => onOpenStatement(statementUuid)}
      />

      <CsvMappingWizard open={mappingsOpen} onClose={() => setMappingsOpen(false)} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('reconciliation.list.deleteConfirmTitle', 'Supprimer ce relevé ?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('reconciliation.list.deleteConfirmDescription', 'Cette action est irréversible.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('reconciliation.list.cancel', 'Annuler')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleDelete() }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('reconciliation.list.deleteConfirm', 'Supprimer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
