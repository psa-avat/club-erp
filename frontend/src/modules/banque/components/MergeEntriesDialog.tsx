/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Merge-several-drafts-into-one dialog for the ledger
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
import Decimal from 'decimal.js'

import { Dialog, DialogContent } from '../../../components/ui/dialog'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import type { AccountingEntry, AccountingEntryMergePayload, AccountOption } from '../api'

type Props = {
  open: boolean
  entries: AccountingEntry[]
  accounts: AccountOption[]
  isSubmitting: boolean
  onClose: () => void
  onConfirm: (payload: AccountingEntryMergePayload) => Promise<void>
  t: (key: string, options?: Record<string, string | number>) => string
}

type Candidate = {
  accountUuid: string
  side: 'debit' | 'credit'
  total: Decimal
}

function formatAmount(value: string): string {
  return Number(value).toFixed(2)
}

function computeCandidates(entries: AccountingEntry[]): Candidate[] {
  if (entries.length === 0) return []

  type PerEntry = Map<string, { side: 'debit' | 'credit'; amount: Decimal }>

  const perEntryMaps: PerEntry[] = entries.map((entry) => {
    const byAccount = new Map<string, { count: number; side: 'debit' | 'credit'; amount: Decimal }>()
    for (const line of entry.lines) {
      const debit = new Decimal(line.debit || '0')
      const credit = new Decimal(line.credit || '0')
      const side: 'debit' | 'credit' = debit.greaterThan(0) ? 'debit' : 'credit'
      const amount = side === 'debit' ? debit : credit
      const existing = byAccount.get(line.account_uuid)
      if (existing) {
        existing.count += 1
      } else {
        byAccount.set(line.account_uuid, { count: 1, side, amount })
      }
    }
    const map: PerEntry = new Map()
    for (const [accountUuid, value] of byAccount) {
      if (value.count === 1) {
        map.set(accountUuid, { side: value.side, amount: value.amount })
      }
    }
    return map
  })

  const [first, ...rest] = perEntryMaps
  const candidates: Candidate[] = []

  for (const [accountUuid, firstValue] of first) {
    let total = firstValue.amount
    let consistent = true
    for (const otherMap of rest) {
      const otherValue = otherMap.get(accountUuid)
      if (!otherValue || otherValue.side !== firstValue.side) {
        consistent = false
        break
      }
      total = total.plus(otherValue.amount)
    }
    if (consistent) {
      candidates.push({ accountUuid, side: firstValue.side, total })
    }
  }

  return candidates
}

export function MergeEntriesDialog({
  open,
  entries,
  accounts,
  isSubmitting,
  onClose,
  onConfirm,
  t,
}: Props) {
  const [consolidationAccountUuid, setConsolidationAccountUuid] = useState('')
  const [entryDate, setEntryDate] = useState('')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')

  const accountLabelByUuid = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of accounts) {
      map.set(account.uuid, `${account.code} · ${account.name}`)
    }
    return map
  }, [accounts])

  const journalUuids = useMemo(() => new Set(entries.map((entry) => entry.journal_uuid)), [entries])
  const differentJournals = journalUuids.size > 1

  const candidates = useMemo(() => computeCandidates(entries), [entries])

  const defaultEntryDate = useMemo(
    () => entries.reduce((latest, entry) => (entry.entry_date > latest ? entry.entry_date : latest), entries[0]?.entry_date ?? ''),
    [entries],
  )

  useEffect(() => {
    if (!open) return
    setConsolidationAccountUuid(candidates.length === 1 ? candidates[0].accountUuid : '')
    setEntryDate(defaultEntryDate)
    setDescription(t('journal.entries.merge.defaultDescription', { count: entries.length, date: defaultEntryDate }))
    setReference('')
  }, [open, candidates, defaultEntryDate, entries.length, t])

  function handleClose() {
    onClose()
  }

  async function handleConfirm() {
    if (entries.length === 0 || !consolidationAccountUuid || description.trim() === '') return
    await onConfirm({
      fiscal_year_uuid: entries[0].fiscal_year_uuid,
      entry_date: entryDate,
      description: description.trim(),
      reference: reference.trim() === '' ? null : reference.trim(),
      consolidation_account_uuid: consolidationAccountUuid,
      entry_uuids: entries.map((entry) => entry.uuid),
    })
  }

  const otherLines = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.lines
          .filter((line) => line.account_uuid !== consolidationAccountUuid)
          .map((line) => ({ ...line, sourceEntryRef: entry.sequence_number ?? entry.uuid.slice(0, 8) })),
      ),
    [entries, consolidationAccountUuid],
  )

  const selectedCandidate = candidates.find((candidate) => candidate.accountUuid === consolidationAccountUuid)

  const canConfirm =
    entries.length >= 2 && !differentJournals && Boolean(consolidationAccountUuid) && description.trim() !== ''

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogContent className="sm:max-w-4xl" aria-labelledby="merge-dialog-title" aria-describedby="merge-dialog-description">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="merge-dialog-title" className="text-lg font-semibold text-foreground">
                {t('journal.entries.merge.title')}
              </h2>
              <p id="merge-dialog-description" className="mt-1 text-sm text-muted-foreground">
                {t('journal.entries.merge.description')}
              </p>
            </div>
            <Button type="button" variant="ghost" onClick={handleClose}>
              {t('journal.entries.merge.cancel')}
            </Button>
          </div>

          {differentJournals && (
            <p className="rounded-md border border-error bg-destructive/15 p-3 text-sm text-error">
              {t('journal.entries.merge.differentJournalsError')}
            </p>
          )}

          {!differentJournals && candidates.length === 0 && entries.length >= 2 && (
            <p className="rounded-md border border-error bg-destructive/15 p-3 text-sm text-error">
              {t('journal.entries.merge.noCommonAccountError')}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('journal.entries.merge.consolidationAccountLabel')}</Label>
              <Select value={consolidationAccountUuid} onValueChange={setConsolidationAccountUuid} disabled={candidates.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={t('journal.entries.merge.consolidationAccountLabel')} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.accountUuid} value={candidate.accountUuid}>
                      {accountLabelByUuid.get(candidate.accountUuid) ?? candidate.accountUuid} — {formatAmount(candidate.total.toFixed(4))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('journal.entries.entryDate')}</Label>
              <Input type="date" value={entryDate} disabled={isSubmitting} onChange={(event) => setEntryDate(event.target.value)} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>{t('journal.entries.descriptionLabel')}</Label>
              <Input
                value={description}
                disabled={isSubmitting}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('journal.entries.merge.descriptionPlaceholder')}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>{t('journal.entries.reference')}</Label>
              <Input value={reference} disabled={isSubmitting} onChange={(event) => setReference(event.target.value)} />
            </div>
          </div>

          {selectedCandidate && (
            <div className="rounded-md border border-border bg-muted p-4">
              <p className="mb-2 text-sm font-medium text-foreground">
                {t('journal.entries.merge.previewConsolidatedLine')}: {accountLabelByUuid.get(selectedCandidate.accountUuid) ?? selectedCandidate.accountUuid} —{' '}
                {formatAmount(selectedCandidate.total.toFixed(4))} ({selectedCandidate.side === 'debit' ? t('journal.forms.debit') : t('journal.forms.credit')})
              </p>
              <p className="mb-2 text-sm font-medium text-foreground">{t('journal.entries.merge.previewOtherLines')}</p>
              <div className="max-h-48 overflow-y-auto overflow-x-auto rounded-sm border border-border bg-card">
                <table className="min-w-full divide-y divide-outline-variant text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.account')}</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.debit')}</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.credit')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant bg-card">
                    {otherLines.map((line) => (
                      <tr key={line.uuid}>
                        <td className="px-3 py-2 text-foreground">{accountLabelByUuid.get(line.account_uuid) ?? line.account_uuid}</td>
                        <td className="px-3 py-2 text-foreground">{formatAmount(line.debit)}</td>
                        <td className="px-3 py-2 text-foreground">{formatAmount(line.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {t('journal.entries.merge.deleteSourcesNotice', { count: entries.length })}
          </p>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={handleClose}>
              {t('journal.entries.merge.cancel')}
            </Button>
            <Button type="button" disabled={isSubmitting || !canConfirm} onClick={() => void handleConfirm()}>
              {isSubmitting ? t('journal.entries.merge.creating') : t('journal.entries.merge.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
