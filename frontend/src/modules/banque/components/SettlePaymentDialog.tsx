/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Dialog — Règlement d'une facture fournisseur (crée une écriture BQ)
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
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'

import { Dialog } from '../../../components/ui/dialog'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import {
  useAccountsQuery,
  useCreateAccountingEntryMutation,
  usePostAccountingEntryMutation,
  type AccountingEntry,
  type AccountOption,
  type JournalOption,
} from '../api'
import { toErrorMessage } from './journalShared'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettlePaymentDialogProps {
  open: boolean
  onClose: () => void
  /** The HA entry (supplier invoice) being settled. */
  sourceEntry: AccountingEntry | null
  bqJournal: JournalOption | null
  fiscalYearUuid: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Total credit amount of an HA entry = invoice amount. */
function entryInvoiceAmount(entry: AccountingEntry): Decimal {
  return entry.lines.reduce((sum, l) => sum.plus(new Decimal(l.credit)), new Decimal(0))
}

/** The supplier (40x / 44x) credit account from the HA entry. */
function supplierAccountUuidFromEntry(
  entry: AccountingEntry,
  accounts: AccountOption[],
): string {
  const creditLines = entry.lines.filter((l) => new Decimal(l.credit).gt(0))
  const match = creditLines.find((l) => {
    const acc = accounts.find((a) => a.uuid === l.account_uuid)
    return acc && (acc.code.startsWith('40') || acc.code.startsWith('44'))
  })
  return match?.account_uuid ?? ''
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettlePaymentDialog({
  open,
  onClose,
  sourceEntry,
  bqJournal,
  fiscalYearUuid,
}: SettlePaymentDialogProps) {
  const { t } = useTranslation('banque')

  const accountsQuery = useAccountsQuery(open)
  const createMutation = useCreateAccountingEntryMutation()
  const postMutation = usePostAccountingEntryMutation()

  const accounts = accountsQuery.data ?? []

  const defaultAmount = sourceEntry ? entryInvoiceAmount(sourceEntry).toFixed(2) : ''
  const defaultSupplierAccount = sourceEntry
    ? supplierAccountUuidFromEntry(sourceEntry, accounts)
    : ''

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentRef, setPaymentRef] = useState('')
  const [amountStr, setAmountStr] = useState(defaultAmount)
  const [bankAccountUuid, setBankAccountUuid] = useState('')
  const [supplierAccountUuid, setSupplierAccountUuid] = useState(defaultSupplierAccount)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Sync defaults when source entry or accounts load
  useEffect(() => {
    if (open) {
      setEntryDate(new Date().toISOString().slice(0, 10))
      setPaymentRef('')
      setErrorMsg(null)
      if (sourceEntry) {
        setAmountStr(entryInvoiceAmount(sourceEntry).toFixed(2))
      }
    }
  }, [open, sourceEntry])

  useEffect(() => {
    if (accounts.length > 0 && sourceEntry) {
      setSupplierAccountUuid(supplierAccountUuidFromEntry(sourceEntry, accounts))
    }
  }, [accounts, sourceEntry])

  const bankOptions = accounts
    .filter((a) => a.is_posting_allowed && a.code.startsWith('512'))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))

  const supplierOptions = accounts
    .filter((a) => a.is_posting_allowed && (a.code.startsWith('40') || a.code.startsWith('44')))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))

  const amount = (() => {
    try { return new Decimal(amountStr) } catch { return null }
  })()

  const isValid =
    amount !== null &&
    amount.gt(0) &&
    bankAccountUuid.length > 0 &&
    supplierAccountUuid.length > 0 &&
    bqJournal !== null

  const isBusy = createMutation.isPending || postMutation.isPending

  if (!sourceEntry) return null

  async function handleSettle() {
    if (!isValid || !amount || !bqJournal) return
    setErrorMsg(null)
    const amtStr = amount.toFixed(4)
    const description = `Règlement — ${sourceEntry!.description}`
    try {
      const entry = await createMutation.mutateAsync({
        fiscal_year_uuid: fiscalYearUuid,
        journal_uuid: bqJournal.uuid,
        entry_date: entryDate,
        description,
        reference: paymentRef.trim() || sourceEntry!.reference,
        lines: [
          { account_uuid: supplierAccountUuid, debit: amtStr, credit: '0.0000', description },
          { account_uuid: bankAccountUuid, debit: '0.0000', credit: amtStr, description },
        ],
      })
      await postMutation.mutateAsync({ entryUuid: entry.uuid, fiscalYearUuid })
      onClose()
    } catch (err) {
      setErrorMsg(toErrorMessage(err, t('ops.suppliers.settleError')))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="settle-payment-title"
      className="w-full max-w-md"
    >
      <div className="space-y-5 p-6">
        <div>
          <h2 id="settle-payment-title" className="text-lg font-semibold text-slate-900">
            {t('ops.suppliers.settleTitle')}
          </h2>
          <p className="mt-1 text-sm text-slate-500 truncate">
            {sourceEntry.description}
            {sourceEntry.reference ? ` · ${sourceEntry.reference}` : ''}
          </p>
        </div>

        {errorMsg && (
          <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-sm text-on-error-container">
            {errorMsg}
          </p>
        )}

        {bqJournal === null && (
          <p className="rounded-lg bg-warning-container px-4 py-2 text-sm text-on-warning-container">
            {t('ops.suppliers.noBqJournal')}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="sp-date">
              {t('ops.suppliers.fields.paymentDate')} *
            </label>
            <Input
              id="sp-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="sp-ref">
              {t('ops.suppliers.fields.paymentRef')}
            </label>
            <Input
              id="sp-ref"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="VIR-001"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600" htmlFor="sp-amount">
            {t('ops.suppliers.fields.amount')} (€) *
          </label>
          <Input
            id="sp-amount"
            type="number"
            min="0"
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="font-mono"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            {t('ops.suppliers.fields.bankAccount')} *
          </label>
          <SearchableSelect
            options={bankOptions}
            value={bankAccountUuid}
            onChange={setBankAccountUuid}
            placeholder={t('ops.suppliers.fields.accountPlaceholder')}
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            {t('ops.suppliers.fields.supplierAccount')} *
          </label>
          <SearchableSelect
            options={supplierOptions}
            value={supplierAccountUuid}
            onChange={setSupplierAccountUuid}
            placeholder={t('ops.suppliers.fields.accountPlaceholder')}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            {t('ops.cancel')}
          </Button>
          <Button onClick={handleSettle} disabled={!isValid || isBusy}>
            {isBusy ? t('ops.saving') : t('ops.suppliers.confirmSettle')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
