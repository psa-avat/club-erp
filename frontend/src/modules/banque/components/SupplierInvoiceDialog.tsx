/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Dialog — Saisie d'une facture fournisseur (journal HA)
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
  type AccountOption,
  type JournalOption,
} from '../api'
import { toErrorMessage } from './journalShared'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SupplierInvoiceDialogProps {
  open: boolean
  onClose: () => void
  haJournal: JournalOption
  fiscalYearUuid: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function accountOptions(accounts: AccountOption[], prefixes: string[]) {
  return accounts
    .filter((a) => a.is_posting_allowed && prefixes.some((p) => a.code.startsWith(p)))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SupplierInvoiceDialog({
  open,
  onClose,
  haJournal,
  fiscalYearUuid,
}: SupplierInvoiceDialogProps) {
  const { t } = useTranslation('banque')

  const accountsQuery = useAccountsQuery(open)
  const createMutation = useCreateAccountingEntryMutation()
  const postMutation = usePostAccountingEntryMutation()

  // Form state
  const [supplierName, setSupplierName] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amountStr, setAmountStr] = useState('')
  const [expenseAccountUuid, setExpenseAccountUuid] = useState('')
  const [supplierAccountUuid, setSupplierAccountUuid] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSupplierName('')
      setInvoiceRef('')
      setEntryDate(new Date().toISOString().slice(0, 10))
      setAmountStr('')
      setExpenseAccountUuid('')
      setSupplierAccountUuid('')
      setErrorMsg(null)
    }
  }, [open])

  const accounts = accountsQuery.data ?? []

  const expenseOptions = accountOptions(accounts, ['6', '2'])
  const supplierOptions = accountOptions(accounts, ['40', '44'])

  const amount = (() => {
    try { return new Decimal(amountStr) } catch { return null }
  })()

  const isValid =
    supplierName.trim().length > 0 &&
    amount !== null &&
    amount.gt(0) &&
    expenseAccountUuid.length > 0 &&
    supplierAccountUuid.length > 0

  const isBusy = createMutation.isPending || postMutation.isPending

  async function handleSave(andPost: boolean) {
    if (!isValid || !amount) return
    setErrorMsg(null)
    const amtStr = amount.toFixed(4)
    try {
      const entry = await createMutation.mutateAsync({
        fiscal_year_uuid: fiscalYearUuid,
        journal_uuid: haJournal.uuid,
        entry_date: entryDate,
        description: supplierName.trim(),
        reference: invoiceRef.trim() || null,
        lines: [
          { account_uuid: expenseAccountUuid, debit: amtStr, credit: '0.0000', description: supplierName.trim() },
          { account_uuid: supplierAccountUuid, debit: '0.0000', credit: amtStr, description: supplierName.trim() },
        ],
      })
      if (andPost) {
        await postMutation.mutateAsync({ entryUuid: entry.uuid, fiscalYearUuid })
      }
      onClose()
    } catch (err) {
      setErrorMsg(toErrorMessage(err, t('ops.suppliers.saveError')))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="supplier-invoice-title"
      className="w-full max-w-lg"
    >
      <div className="space-y-5 p-6">
        <h2 id="supplier-invoice-title" className="text-lg font-semibold text-slate-900">
          {t('ops.suppliers.newInvoice')}
        </h2>

        {errorMsg && (
          <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-sm text-on-error-container">
            {errorMsg}
          </p>
        )}

        {/* Header fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="si-supplier">
              {t('ops.suppliers.fields.supplier')} *
            </label>
            <Input
              id="si-supplier"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder={t('ops.suppliers.fields.supplierPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="si-ref">
              {t('ops.suppliers.fields.ref')}
            </label>
            <Input
              id="si-ref"
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
              placeholder="FA-2025-001"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="si-date">
              {t('ops.suppliers.fields.date')} *
            </label>
            <Input
              id="si-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>
        </div>

        {/* Amount */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600" htmlFor="si-amount">
            {t('ops.suppliers.fields.amount')} (€) *
          </label>
          <Input
            id="si-amount"
            type="number"
            min="0"
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0.00"
            className="font-mono"
          />
        </div>

        {/* Accounts */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600">
              {t('ops.suppliers.fields.expenseAccount')} *
            </label>
            <SearchableSelect
              options={expenseOptions}
              value={expenseAccountUuid}
              onChange={setExpenseAccountUuid}
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
        </div>

        {/* Preview */}
        {isValid && amount && (
          <div className="rounded-lg bg-surface-container p-3 font-mono text-xs text-slate-700">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1">
              <span>{t('ops.suppliers.preview.account')}</span>
              <span className="text-right">{t('ops.suppliers.preview.debit')}</span>
              <span className="text-right">{t('ops.suppliers.preview.credit')}</span>

              <span className="truncate">
                {accounts.find((a) => a.uuid === expenseAccountUuid)?.code ?? '—'}
              </span>
              <span className="text-right">{amount.toFixed(2)}</span>
              <span className="text-right text-slate-400">—</span>

              <span className="truncate">
                {accounts.find((a) => a.uuid === supplierAccountUuid)?.code ?? '—'}
              </span>
              <span className="text-right text-slate-400">—</span>
              <span className="text-right">{amount.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            {t('ops.cancel')}
          </Button>
          <Button variant="secondary" onClick={() => handleSave(false)} disabled={!isValid || isBusy}>
            {isBusy ? t('ops.saving') : t('ops.suppliers.saveAsDraft')}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={!isValid || isBusy}>
            {isBusy ? t('ops.saving') : t('ops.suppliers.saveAndPost')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
