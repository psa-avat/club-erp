/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Reversal creation dialog for posted accounting entries
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

import { Dialog, DialogContent } from '../../../components/ui/dialog'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import type { AccountingEntry, AccountOption } from '../api'

type Props = {
  open: boolean
  entry: AccountingEntry | null
  accounts: AccountOption[]
  isSubmitting: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
  t: (key: string, options?: Record<string, string | number>) => string
}

function formatAmount(value: string): string {
  return Number(value).toFixed(2)
}

export function ReversalDialog({
  open,
  entry,
  accounts,
  isSubmitting,
  onClose,
  onConfirm,
  t,
}: Props) {
  const [reason, setReason] = useState('')

  const accountLabelByUuid = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of accounts) {
      map.set(account.uuid, `${account.code} · ${account.name}`)
    }
    return map
  }, [accounts])

  const lines = entry?.lines ?? []
  const entryRef = entry?.sequence_number ?? entry?.uuid.slice(0, 8) ?? ''

  async function handleConfirm() {
    if (reason.trim() === '') return
    await onConfirm(reason.trim())
    setReason('')
  }

  function handleClose() {
    setReason('')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
    >
      <DialogContent className="sm:max-w-4xl" aria-labelledby="reversal-dialog-title" aria-describedby="reversal-dialog-description">
        <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="reversal-dialog-title" className="text-lg font-semibold text-on-surface">
              {t('journal.entries.reversal.title')}
            </h2>
            <p id="reversal-dialog-description" className="mt-1 text-sm text-on-surface-variant">
              {t('journal.entries.reversal.description')}
            </p>
          </div>
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t('journal.entries.reversal.cancel')}
          </Button>
        </div>

        {entry && (
          <div className="mt-4 rounded-shape-md border border-outline-variant bg-surface-container p-4">
            <div className="grid gap-2 text-sm text-on-surface sm:grid-cols-4">
              <p>
                <span className="font-medium">{t('journal.entries.reversal.entry')}:</span> {entry.sequence_number ?? entry.uuid.slice(0, 8)}
              </p>
              <p>
                <span className="font-medium">{t('journal.entries.entryDate')}:</span> {entry.entry_date}
              </p>
              <p>
                <span className="font-medium">{t('journal.entries.reference')}:</span> {entry.reference ?? '—'}
              </p>
              <p>
                <span className="font-medium">{t('journal.entries.descriptionLabel')}:</span> {entry.description}
              </p>
            </div>

            <div className="mt-3 overflow-x-auto rounded-shape-sm border border-outline-variant bg-surface">
              <table className="min-w-full divide-y divide-outline-variant text-sm">
                <thead className="bg-surface-container">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.forms.account')}</th>
                    <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.entries.reversal.originalDebit')}</th>
                    <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.entries.reversal.originalCredit')}</th>
                    <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.entries.reversal.reversalDebit')}</th>
                    <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.entries.reversal.reversalCredit')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant bg-surface">
                  {lines.map((line) => (
                    <tr key={line.uuid}>
                      <td className="px-3 py-2 text-on-surface">{accountLabelByUuid.get(line.account_uuid) ?? line.account_uuid}</td>
                      <td className="px-3 py-2 text-on-surface">{formatAmount(line.debit)}</td>
                      <td className="px-3 py-2 text-on-surface">{formatAmount(line.credit)}</td>
                      <td className="px-3 py-2 text-on-surface">{formatAmount(line.credit)}</td>
                      <td className="px-3 py-2 text-on-surface">{formatAmount(line.debit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2">
          <Label>{t('journal.entries.reversal.reason')}</Label>
          <Input
            value={reason}
            disabled={isSubmitting}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('journal.entries.reversal.reasonPlaceholder')}
          />
        </div>

        <div className="mt-4 rounded-shape-md border border-success-container bg-success-container p-4 text-sm text-on-success-container">
          <p className="mb-2 font-semibold">{t('journal.entries.reversal.previewTitle')}</p>
          <p>✓ {t('journal.entries.reversal.previewOriginal', { ref: entryRef })}</p>
          <p>✓ {t('journal.entries.reversal.previewNewDraft')}</p>
          <p>✓ {t('journal.entries.reversal.previewLink')}</p>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t('journal.entries.reversal.cancel')}
          </Button>
          <Button
            type="button"
            disabled={isSubmitting || reason.trim() === '' || !entry}
            onClick={() => void handleConfirm()}
          >
            {isSubmitting
              ? t('journal.entries.reversal.creating')
              : t('journal.entries.reversal.confirm')}
          </Button>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  )
}
