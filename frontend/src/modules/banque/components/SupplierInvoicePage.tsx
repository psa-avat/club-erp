/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Page de saisie facture fournisseur (journal HA)
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
import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { useMemberOptionsQuery } from '../../members/api'
import {
  useAccountsQuery,
  useCreateAccountingEntryMutation,
  useJournalsQuery,
  usePostAccountingEntryMutation,
  type AccountOption,
  type JournalOption,
} from '../api'
import { toErrorMessage } from './journalShared'

function accountOptions(accounts: AccountOption[], prefixes: string[]) {
  return accounts
    .filter((a) => a.is_posting_allowed && prefixes.some((p) => a.code.startsWith(p)))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))
}

export function SupplierInvoicePage() {
  const { t } = useTranslation('banque')
  const navigate = useNavigate()
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')
  const fiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  const membersQuery = useMemberOptionsQuery({ limit: 500 })
  const journalsQuery = useJournalsQuery()
  const accountsQuery = useAccountsQuery()
  const createMutation = useCreateAccountingEntryMutation()
  const postMutation = usePostAccountingEntryMutation()

  const haJournal = useMemo<JournalOption | null>(
    () => journalsQuery.data?.find((j) => j.code === 'HA') ?? null,
    [journalsQuery.data],
  )

  const [supplierMemberUuid, setSupplierMemberUuid] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amountStr, setAmountStr] = useState('')
  const [expenseAccountUuid, setExpenseAccountUuid] = useState('')
  const [supplierAccountUuid, setSupplierAccountUuid] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const members = membersQuery.data ?? []
  const accounts = accountsQuery.data ?? []
  const memberOptions = members.map((m) => ({
    value: m.uuid,
    label: `${m.last_name} ${m.first_name} (${m.account_id})`,
  }))
  const expenseOptions = accountOptions(accounts, ['6', '2'])
  const supplierOptions = accountOptions(accounts, ['40', '44'])

  const amount = useMemo(() => {
    try { return new Decimal(amountStr) } catch { return null }
  }, [amountStr])

  useEffect(() => {
    if (!expenseAccountUuid && expenseOptions.length > 0) {
      setExpenseAccountUuid(expenseOptions[0].value)
    }
  }, [expenseAccountUuid, expenseOptions])

  useEffect(() => {
    if (!supplierAccountUuid && supplierOptions.length > 0) {
      setSupplierAccountUuid(supplierOptions[0].value)
    }
  }, [supplierAccountUuid, supplierOptions])

  const isValid =
    canPost &&
    Boolean(fiscalYearUuid) &&
    haJournal !== null &&
    supplierName.trim().length > 0 &&
    amount !== null &&
    amount.gt(0) &&
    expenseAccountUuid.length > 0 &&
    supplierAccountUuid.length > 0

  function handleSupplierMemberChange(value: string) {
    setSupplierMemberUuid(value)
    if (!value || supplierName.trim().length > 0) return
    const member = members.find((m) => m.uuid === value)
    if (member) {
      setSupplierName(`${member.last_name} ${member.first_name}`.trim())
    }
  }

  const isBusy = createMutation.isPending || postMutation.isPending

  async function handleSave(andPost: boolean) {
    if (!isValid || !amount || !fiscalYearUuid || !haJournal) return

    setErrorMsg(null)
    const amt = amount.toFixed(4)

    try {
      const entry = await createMutation.mutateAsync({
        fiscal_year_uuid: fiscalYearUuid,
        journal_uuid: haJournal.uuid,
        entry_date: entryDate,
        description: supplierName.trim(),
        reference: invoiceRef.trim() || null,
        lines: [
          { account_uuid: expenseAccountUuid, debit: amt, credit: '0.0000', description: supplierName.trim() },
          {
            account_uuid: supplierAccountUuid,
            debit: '0.0000',
            credit: amt,
            description: supplierName.trim(),
            member_uuid: supplierMemberUuid.trim() === '' ? null : supplierMemberUuid,
          },
        ],
      })

      if (andPost) {
        await postMutation.mutateAsync({ entryUuid: entry.uuid, fiscalYearUuid })
      }

      navigate('/banque/operations')
    } catch (err) {
      setErrorMsg(toErrorMessage(err, t('ops.suppliers.saveError')))
    }
  }

  if (!canPost) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
        <button
          type="button"
          onClick={() => navigate('/banque/operations')}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          aria-label={t('billing.back')}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('ops.suppliers.newInvoice')}</h1>
          <p className="text-sm text-slate-500">{t('ops.suppliers.apList')}</p>
        </div>
      </div>

      {haJournal === null && !journalsQuery.isLoading && (
        <div className="rounded-lg bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          {t('ops.suppliers.noHaJournal')}
        </div>
      )}

      {fiscalYearUuid === null && (
        <div className="rounded-lg bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          {t('ops.suppliers.saveError')}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-5">
          {errorMsg && (
            <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-sm text-on-error-container">
              {errorMsg}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <label className="block text-xs font-medium text-slate-600">
                {t('ops.suppliers.fields.supplierMember')}
              </label>
              <SearchableSelect
                options={memberOptions}
                value={supplierMemberUuid}
                onChange={handleSupplierMemberChange}
                placeholder={t('ops.suppliers.fields.supplierMemberPlaceholder')}
                clearable
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="block text-xs font-medium text-slate-600" htmlFor="sp-supplier">
                {t('ops.suppliers.fields.supplier')} *
              </label>
              <Input
                id="sp-supplier"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder={t('ops.suppliers.fields.supplierPlaceholder')}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600" htmlFor="sp-ref">
                {t('ops.suppliers.fields.ref')}
              </label>
              <Input
                id="sp-ref"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                placeholder="FA-2025-001"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600" htmlFor="sp-date">
                {t('ops.suppliers.fields.date')} *
              </label>
              <Input
                id="sp-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
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
                placeholder="0.00"
                className="font-mono"
              />
            </div>

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

          {amount !== null && amount.gt(0) && expenseAccountUuid && supplierAccountUuid && (
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

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => navigate('/banque/operations')} disabled={isBusy}>
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
      </section>
    </div>
  )
}