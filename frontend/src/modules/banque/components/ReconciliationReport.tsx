/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: summary, closure, and JSON export
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
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Lock } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  downloadReconciliationReport,
  useCloseReconciliationMutation,
  useReconciliationReportQuery,
  type BankStatement,
} from '../api'

interface Props {
  statement: BankStatement
}

export function ReconciliationReport({ statement }: Props) {
  const { t } = useTranslation('banque')
  const { data: report } = useReconciliationReportQuery(statement.uuid)
  const closeMutation = useCloseReconciliationMutation()

  const unresolvedCount = report?.unresolved_lines.length ?? 0
  const canClose = statement.status !== 'reconciled' && unresolvedCount === 0

  async function handleClose() {
    try {
      await closeMutation.mutateAsync(statement.uuid)
      toast.success(t('reconciliation.report.closed', 'Rapprochement clôturé'))
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err instanceof Error ? err.message : t('reconciliation.report.closeError', 'Échec de la clôture'))
      toast.error(detail)
    }
  }

  async function handleDownload() {
    await downloadReconciliationReport(statement.uuid, `rapprochement_${statement.statement_date}`)
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{t('reconciliation.report.title', 'Rapport de rapprochement')}</h3>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">{t('reconciliation.report.opening', 'Solde initial')}</dt>
        <dd className="text-right font-mono">{statement.opening_balance}</dd>
        <dt className="text-muted-foreground">{t('reconciliation.report.closing', 'Solde final')}</dt>
        <dd className="text-right font-mono">{statement.closing_balance}</dd>
        {statement.reconciled_balance !== null && (
          <>
            <dt className="text-muted-foreground">{t('reconciliation.report.reconciled', 'Solde rapproché')}</dt>
            <dd className="text-right font-mono">{statement.reconciled_balance}</dd>
          </>
        )}
        {report && Object.entries(report.status_counts).map(([status, count]) => (
          <Fragment key={status}>
            <dt className="text-muted-foreground">
              {t(`reconciliation.status.${status}`, status)}
            </dt>
            <dd className="text-right">{count}</dd>
          </Fragment>
        ))}
      </dl>

      {!canClose && statement.status !== 'reconciled' && (
        <p className="text-xs text-muted-foreground">
          {t('reconciliation.report.unresolvedHint', '{{count}} ligne(s) non résolue(s) avant clôture.', { count: unresolvedCount })}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={handleClose} disabled={!canClose || closeMutation.isPending}>
          <Lock className="mr-1 h-4 w-4" />
          {statement.status === 'reconciled'
            ? t('reconciliation.report.alreadyClosed', 'Clôturé')
            : t('reconciliation.report.close', 'Clôturer')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void handleDownload()}>
          <Download className="mr-1 h-4 w-4" />
          {t('reconciliation.report.downloadJson', 'Exporter JSON')}
        </Button>
      </div>
    </div>
  )
}
