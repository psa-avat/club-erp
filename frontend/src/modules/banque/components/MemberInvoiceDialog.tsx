/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Dialog — Facturation d'un membre (journal VT)
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

import { Dialog, DialogContent } from '../../../components/ui/dialog'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useMemberOptionsQuery } from '../../members/api'
import {
  useAccountsQuery,
  useCreateAccountingEntryMutation,
  usePostAccountingEntryMutation,
  type JournalOption,
} from '../api'
import { toErrorMessage } from './journalShared'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MemberInvoiceDialogProps {
  open: boolean
  onClose: () => void
  vtJournal: JournalOption
  fiscalYearUuid: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemberInvoiceDialog({
  open,
  onClose,
  vtJournal,
  fiscalYearUuid,
}: MemberInvoiceDialogProps) {
  const { t } = useTranslation('banque')

  const membersQuery = useMemberOptionsQuery({ limit: 500 })
  const accountsQuery = useAccountsQuery(open)
  const createMutation = useCreateAccountingEntryMutation()
  const postMutation = usePostAccountingEntryMutation()

  const [memberUuid, setMemberUuid] = useState('')
  const [description, setDescription] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amountStr, setAmountStr] = useState('')
  const [revenueAccountUuid, setRevenueAccountUuid] = useState('')
  const [receivableAccountUuid, setReceivableAccountUuid] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset on open
  useEffect(() => {
    if (open) {
      setMemberUuid('')
      setDescription('')
      setInvoiceRef('')
      setEntryDate(new Date().toISOString().slice(0, 10))
      setAmountStr('')
      setRevenueAccountUuid('')
      setReceivableAccountUuid('')
      setErrorMsg(null)
    }
  }, [open])

  const accounts = accountsQuery.data ?? []
  const members = membersQuery.data ?? []

  // Auto-select first 411 account as default receivable
  useEffect(() => {
    if (accounts.length > 0 && !receivableAccountUuid) {
      const first411 = accounts.find((a) => a.is_posting_allowed && a.code.startsWith('411'))
      if (first411) setReceivableAccountUuid(first411.uuid)
    }
  }, [accounts, receivableAccountUuid])

  const memberOptions = members.map((m) => ({
    value: m.uuid,
    label: `${m.last_name} ${m.first_name} (${m.account_id})`,
  }))

  const revenueOptions = accounts
    .filter((a) => a.is_posting_allowed && a.code.startsWith('7'))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))

  const receivableOptions = accounts
    .filter((a) => a.is_posting_allowed && a.code.startsWith('411'))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))

  const amount = (() => {
    try { return new Decimal(amountStr) } catch { return null }
  })()

  const selectedMember = members.find((m) => m.uuid === memberUuid)

  const isValid =
    memberUuid.length > 0 &&
    description.trim().length > 0 &&
    amount !== null &&
    amount.gt(0) &&
    revenueAccountUuid.length > 0 &&
    receivableAccountUuid.length > 0

  const isBusy = createMutation.isPending || postMutation.isPending

  async function handleSave(andPost: boolean) {
    if (!isValid || !amount || !selectedMember) return
    setErrorMsg(null)
    const amtStr = amount.toFixed(4)
    const desc = description.trim()
    try {
      const entry = await createMutation.mutateAsync({
        fiscal_year_uuid: fiscalYearUuid,
        journal_uuid: vtJournal.uuid,
        entry_date: entryDate,
        description: desc,
        reference: invoiceRef.trim() || null,
        lines: [
          {
            account_uuid: receivableAccountUuid,
            debit: amtStr,
            credit: '0.0000',
            description: desc,
            tiers_uuid: memberUuid,
          },
          {
            account_uuid: revenueAccountUuid,
            debit: '0.0000',
            credit: amtStr,
            description: desc,
          },
        ],
      })
      if (andPost) {
        await postMutation.mutateAsync({ entryUuid: entry.uuid, fiscalYearUuid })
      }
      onClose()
    } catch (err) {
      setErrorMsg(toErrorMessage(err, t('ops.sales.saveError')))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
    >
      <DialogContent className="sm:max-w-lg" aria-labelledby="member-invoice-title">
        <div className="space-y-5">
        <h2 id="member-invoice-title" className="text-lg font-semibold text-slate-900">
          {t('ops.sales.newInvoice')}
        </h2>

        {errorMsg && (
          <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-sm text-on-error-container">
            {errorMsg}
          </p>
        )}

        {/* Member picker */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            {t('ops.sales.fields.member')} *
          </label>
          <SearchableSelect
            options={memberOptions}
            value={memberUuid}
            onChange={setMemberUuid}
            placeholder={t('ops.sales.fields.memberPlaceholder')}
          />
        </div>

        {/* Description + Reference */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="mi-desc">
              {t('ops.sales.fields.description')} *
            </label>
            <Input
              id="mi-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('ops.sales.fields.descPlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="mi-ref">
              {t('ops.sales.fields.ref')}
            </label>
            <Input
              id="mi-ref"
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
              placeholder="FA-2025-001"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="mi-date">
              {t('ops.sales.fields.date')} *
            </label>
            <Input
              id="mi-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>
        </div>

        {/* Amount */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600" htmlFor="mi-amount">
            {t('ops.sales.fields.amount')} (€) *
          </label>
          <Input
            id="mi-amount"
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
              {t('ops.sales.fields.receivableAccount')} *
            </label>
            <SearchableSelect
              options={receivableOptions}
              value={receivableAccountUuid}
              onChange={setReceivableAccountUuid}
              placeholder={t('ops.sales.fields.accountPlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600">
              {t('ops.sales.fields.revenueAccount')} *
            </label>
            <SearchableSelect
              options={revenueOptions}
              value={revenueAccountUuid}
              onChange={setRevenueAccountUuid}
              placeholder={t('ops.sales.fields.accountPlaceholder')}
            />
          </div>
        </div>

        {/* Accounting preview */}
        {isValid && amount && (
          <div className="rounded-lg bg-surface-container p-3 font-mono text-xs text-slate-700">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {t('ops.sales.preview.title')}
            </p>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1">
              <span>{t('ops.sales.preview.account')}</span>
              <span className="text-right">{t('ops.sales.preview.debit')}</span>
              <span className="text-right">{t('ops.sales.preview.credit')}</span>

              <span className="truncate">
                {accounts.find((a) => a.uuid === receivableAccountUuid)?.code ?? '—'}
                {selectedMember ? ` (${selectedMember.last_name})` : ''}
              </span>
              <span className="text-right">{amount.toFixed(2)}</span>
              <span className="text-right text-slate-400">—</span>

              <span className="truncate">
                {accounts.find((a) => a.uuid === revenueAccountUuid)?.code ?? '—'}
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
            {isBusy ? t('ops.saving') : t('ops.sales.saveAsDraft')}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={!isValid || isBusy}>
            {isBusy ? t('ops.saving') : t('ops.sales.saveAndPost')}
          </Button>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  )
}
