/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - FiscalYearCloseChecklist: shows why a fiscal year can/cannot be closed yet
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

import { CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useFiscalYearCloseReadinessQuery } from '../api'

type Props = {
  fiscalYearUuid: string
}

/**
 * FiscalYearCloseChecklist — lists the blockers preventing a fiscal year from
 * closing (drafts, unreconciled lines, discrepancies), each linked to where it
 * can be resolved. Missing tiers / due recurring entries are shown as
 * informational — they don't block close_fiscal_year() server-side.
 */
export function FiscalYearCloseChecklist({ fiscalYearUuid }: Props) {
  const { t } = useTranslation('banque')
  const readinessQuery = useFiscalYearCloseReadinessQuery(fiscalYearUuid)
  const readiness = readinessQuery.data

  if (readinessQuery.isLoading || !readiness) {
    return <p className="text-sm text-muted-foreground">{t('fiscalYears.closeChecklist.loading', 'Chargement…')}</p>
  }

  const items = [
    {
      ok: !readiness.has_unposted_entries,
      label: t('fiscalYears.closeChecklist.unposted', '{{count}} écriture(s) en brouillon', {
        count: readiness.unposted_entries_count,
      }),
      to: '/workspace/finance?tab=comptabilite&section=saisie&subtab=journal&preset=drafts',
      blocking: true,
    },
    {
      ok: !readiness.has_unreconciled_bank_lines,
      label: t('fiscalYears.closeChecklist.unreconciled', '{{count}} ligne(s) bancaire(s) à rapprocher', {
        count: readiness.unreconciled_bank_lines_count,
      }),
      to: '/workspace/finance?tab=comptabilite&section=rapprochement',
      blocking: true,
    },
    {
      ok: !readiness.has_reconciliation_discrepancies,
      label: t('fiscalYears.closeChecklist.discrepancies', '{{count}} écart(s) de rapprochement', {
        count: readiness.discrepancy_count,
      }),
      to: '/workspace/finance?tab=comptabilite&section=rapprochement',
      blocking: true,
    },
    {
      ok: readiness.reports_balanced,
      label: t('fiscalYears.closeChecklist.reportsBalanced', 'Débit = Crédit sur les écritures validées'),
      to: undefined,
      blocking: true,
    },
    {
      ok: !readiness.has_missing_required_tiers,
      label: t('fiscalYears.closeChecklist.missingTiers', '{{count}} écriture(s) sans tiers', {
        count: readiness.missing_required_tiers_count,
      }),
      to: '/workspace/finance?tab=comptabilite&section=saisie&subtab=journal&preset=missing-tiers',
      blocking: false,
    },
    {
      ok: !readiness.has_due_recurring_entries,
      label: t('fiscalYears.closeChecklist.dueRecurring', '{{count}} écriture(s) récurrente(s) due(s)', {
        count: readiness.due_recurring_entries_count,
      }),
      to: '/workspace/finance?tab=comptabilite&section=parametres&subtab=recurrentes',
      blocking: false,
    },
  ]

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <p className="text-sm font-semibold text-foreground">
        {readiness.can_close
          ? t('fiscalYears.closeChecklist.readyTitle', "Prêt à clôturer")
          : t('fiscalYears.closeChecklist.notReadyTitle', 'Blocages avant clôture')}
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-sm">
            {item.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--color-success)]" />
            ) : (
              <XCircle className={`h-4 w-4 shrink-0 ${item.blocking ? 'text-destructive' : 'text-[color:var(--color-warning)]'}`} />
            )}
            <span className={item.ok ? 'text-muted-foreground' : 'text-foreground'}>{item.label}</span>
            {!item.ok && item.to && (
              <Link to={item.to} className="ml-auto text-xs text-accent underline underline-offset-2">
                {t('fiscalYears.closeChecklist.resolve', 'Résoudre')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
