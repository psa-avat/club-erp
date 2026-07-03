/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: discrepancy review panel (accept / exclude / correcting entry)
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
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAccountsQuery, useReconciliationDiscrepanciesQuery, useResolveDiscrepancyMutation, type Discrepancy } from '../api'

const TYPE_BADGE: Record<Discrepancy['type'], string> = {
  missing_entry: 'badge-destructive',
  amount_variance: 'badge-warning',
  timing: 'badge-warning',
  duplicate: 'badge-destructive',
}

interface Props {
  statementUuid: string
}

export function ReconciliationDiscrepancies({ statementUuid }: Props) {
  const { t } = useTranslation('banque')
  const { data: discrepancies, isLoading } = useReconciliationDiscrepanciesQuery(statementUuid)
  const { data: accounts } = useAccountsQuery()
  const resolveMutation = useResolveDiscrepancyMutation()
  const [counterAccountByLine, setCounterAccountByLine] = useState<Record<string, string>>({})

  async function resolve(lineUuid: string, action: 'accept' | 'exclude' | 'create_correcting_entry') {
    const counterAccountUuid = counterAccountByLine[lineUuid]
    if (action === 'create_correcting_entry' && !counterAccountUuid) {
      toast.error(t('reconciliation.discrepancies.counterAccountRequired', 'Sélectionnez un compte de contrepartie.'))
      return
    }
    try {
      await resolveMutation.mutateAsync({
        line_uuid: lineUuid,
        action,
        counter_account_uuid: action === 'create_correcting_entry' ? counterAccountUuid : undefined,
      })
      toast.success(t('reconciliation.discrepancies.resolved', 'Écart résolu'))
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err instanceof Error ? err.message : t('reconciliation.discrepancies.error', 'Échec de la résolution'))
      toast.error(detail)
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading', 'Chargement…')}</p>
  }

  if (!discrepancies || discrepancies.length === 0) {
    return (
      <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
        {t('reconciliation.discrepancies.empty', 'Aucun écart détecté.')}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {discrepancies.map((d) => (
        <div key={`${d.line_uuid}-${d.type}`} className="space-y-2 rounded-lg border bg-card px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Badge className={TYPE_BADGE[d.type]}>{t(`reconciliation.discrepancyType.${d.type}`, d.type)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{d.description}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void resolve(d.line_uuid, 'accept')}>
              {t('reconciliation.discrepancies.accept', 'Accepter')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void resolve(d.line_uuid, 'exclude')}>
              {t('reconciliation.discrepancies.exclude', 'Exclure')}
            </Button>
            <Select
              value={counterAccountByLine[d.line_uuid] ?? ''}
              onValueChange={(v) => setCounterAccountByLine((prev) => ({ ...prev, [d.line_uuid]: v }))}
            >
              <SelectTrigger className="h-8 w-48">
                <SelectValue placeholder={t('reconciliation.discrepancies.counterAccount', 'Compte contrepartie')} />
              </SelectTrigger>
              <SelectContent>
                {(accounts ?? []).filter((a) => a.is_posting_allowed).map((a) => (
                  <SelectItem key={a.uuid} value={a.uuid}>{a.code} · {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => void resolve(d.line_uuid, 'create_correcting_entry')}>
              {t('reconciliation.discrepancies.createEntry', "Générer l'écriture")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
