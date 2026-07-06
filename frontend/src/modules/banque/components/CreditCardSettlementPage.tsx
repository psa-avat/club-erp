/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Credit card (CB) daily settlement — generates the settlement entry
      (one line per payment + bank line) and the bank fee entry
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
import Decimal from 'decimal.js'

import { Alert } from '../../../components/ui/alert'
import { Banner } from '../../../components/ui/banner'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useMembersQuery } from '../../members/api'
import { useAssetsQuery } from '../../assets/api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import {
  useAccountsQuery,
  useBanqueModuleSettingsQuery,
  useBulkPostAccountingEntriesMutation,
  useCreateAccountingEntryMutation,
  useJournalsQuery,
} from '../api'
import { decimalOrZero, toErrorMessage } from './journalShared'

type PaymentRow = {
  account_uuid: string
  tiers_uuid: string
  description: string
  amount: string
}

function emptyRow(): PaymentRow {
  return { account_uuid: '', tiers_uuid: '', description: '', amount: '' }
}

export function CreditCardSettlementPage() {
  const { t } = useTranslation('banque')
  const today = new Date().toISOString().slice(0, 10)

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const journalsQuery = useJournalsQuery(true)
  const accountsQuery = useAccountsQuery(true)
  const membersQuery = useMembersQuery({ search: '' })
  const assetsQuery = useAssetsQuery({}, true)
  const settingsQuery = useBanqueModuleSettingsQuery('credit_card_payments', true)

  const createEntryMutation = useCreateAccountingEntryMutation()
  const bulkPostMutation = useBulkPostAccountingEntriesMutation()

  const [entryDate, setEntryDate] = useState(today)
  const [rows, setRows] = useState<PaymentRow[]>([emptyRow(), emptyRow()])
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createdEntries, setCreatedEntries] = useState<{ settlementUuid: string; feeUuid: string | null } | null>(null)

  const accounts = (accountsQuery.data ?? []).filter((a) => a.is_posting_allowed)
  const members = membersQuery.data ?? []
  const assets = assetsQuery.data ?? []
  const bqJournal = (journalsQuery.data ?? []).find((j) => j.code === 'BQ')

  const rawSettings = settingsQuery.data?.settings ?? {}
  const bankAccountUuid = typeof rawSettings.bank_account_uuid === 'string' ? rawSettings.bank_account_uuid : ''
  const feesAccountUuid = typeof rawSettings.fees_account_uuid === 'string' ? rawSettings.fees_account_uuid : ''
  const feePercentage =
    typeof rawSettings.fee_percentage === 'string' || typeof rawSettings.fee_percentage === 'number'
      ? String(rawSettings.fee_percentage)
      : '0'

  const memberOptions = members
    .filter((m) => !m.account_id.startsWith('FO-'))
    .map((m) => ({ value: m.uuid, label: `${m.last_name} ${m.first_name}`.trim() }))
  const supplierOptions = members
    .filter((m) => m.account_id.startsWith('FO-'))
    .map((m) => ({ value: m.uuid, label: `${m.last_name} ${m.first_name} (${m.account_id})`.trim() }))
  const assetOptions = assets.map((a) => ({ value: a.uuid, label: `${a.code} · ${a.name}` }))
  const accountOptions = accounts.map((a) => ({ value: a.uuid, label: `${a.code} · ${a.name}` }))

  const total = rows.reduce((sum, row) => sum.plus(decimalOrZero(row.amount)), new Decimal(0))
  const validRows = rows.filter((row) => row.account_uuid !== '' && decimalOrZero(row.amount).greaterThan(0))
  const feePct = decimalOrZero(feePercentage)
  const feeAmount = total.mul(feePct).div(100)

  const settingsMissing = !bankAccountUuid || (feePct.greaterThan(0) && !feesAccountUuid)

  function updateRow(index: number, patch: Partial<PaymentRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  const canSubmit =
    Boolean(activeFiscalYearUuid) && Boolean(bqJournal) && !settingsMissing && validRows.length > 0 && !isSubmitting

  async function handleGenerate() {
    if (!activeFiscalYearUuid || !bqJournal) return
    setLocalError(null)
    setSuccessMessage(null)
    setCreatedEntries(null)
    setIsSubmitting(true)
    try {
      const settlementLines = [
        ...validRows.map((row) => ({
          account_uuid: row.account_uuid,
          debit: '0',
          credit: decimalOrZero(row.amount).toFixed(2),
          description: row.description.trim() || null,
          tiers_uuid: row.tiers_uuid || null,
        })),
        {
          account_uuid: bankAccountUuid,
          debit: total.toFixed(2),
          credit: '0',
          description: null,
          tiers_uuid: null,
        },
      ]

      const settlementEntry = await createEntryMutation.mutateAsync({
        fiscal_year_uuid: activeFiscalYearUuid,
        journal_uuid: bqJournal.uuid,
        entry_date: entryDate,
        description: t('creditCard.settlementDescription', { date: entryDate }),
        reference: null,
        lines: settlementLines,
      })

      let feeEntryUuid: string | null = null
      if (feeAmount.greaterThan(0)) {
        const feeEntry = await createEntryMutation.mutateAsync({
          fiscal_year_uuid: activeFiscalYearUuid,
          journal_uuid: bqJournal.uuid,
          entry_date: entryDate,
          description: t('creditCard.feeDescription', { date: entryDate }),
          reference: null,
          lines: [
            { account_uuid: feesAccountUuid, debit: feeAmount.toFixed(2), credit: '0', description: null, tiers_uuid: null },
            { account_uuid: bankAccountUuid, debit: '0', credit: feeAmount.toFixed(2), description: null, tiers_uuid: null },
          ],
        })
        feeEntryUuid = feeEntry.uuid
      }

      setCreatedEntries({ settlementUuid: settlementEntry.uuid, feeUuid: feeEntryUuid })
      setSuccessMessage(feeEntryUuid ? t('creditCard.success') : t('creditCard.successNoFee'))
      setRows([emptyRow(), emptyRow()])
    } catch (error) {
      setLocalError(toErrorMessage(error, t('creditCard.error')))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handlePostBoth() {
    if (!createdEntries || !activeFiscalYearUuid) return
    const entryUuids = [createdEntries.settlementUuid, createdEntries.feeUuid].filter((v): v is string => Boolean(v))
    try {
      await bulkPostMutation.mutateAsync({ fiscal_year_uuid: activeFiscalYearUuid, entry_uuids: entryUuids })
      setSuccessMessage(t('creditCard.posted'))
      setCreatedEntries(null)
    } catch (error) {
      setLocalError(toErrorMessage(error, t('creditCard.error')))
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('creditCard.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('creditCard.description')}</p>
      </div>

      {localError && <Alert>{localError}</Alert>}
      {successMessage && <Banner variant="success" message={successMessage} onDismiss={() => setSuccessMessage(null)} />}
      {!activeFiscalYearUuid && <Alert>{t('creditCard.noFiscalYear')}</Alert>}
      {activeFiscalYearUuid && !bqJournal && <Alert>{t('creditCard.noJournal')}</Alert>}
      {activeFiscalYearUuid && bqJournal && settingsMissing && <Alert>{t('creditCard.settingsMissing')}</Alert>}
      {activeFiscalYearUuid && bqJournal && !settingsMissing && validRows.length === 0 && (
        <Alert>{t('creditCard.noRows')}</Alert>
      )}

      <div className="max-w-xs space-y-1">
        <Label>{t('creditCard.entryDate')}</Label>
        <Input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
        <div className="overflow-x-auto overflow-y-visible rounded-lg border bg-card">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium text-muted-foreground">{t('creditCard.columns.account')}</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('creditCard.columns.tiers')}</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('creditCard.columns.description')}</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('creditCard.columns.amount')}</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, index) => {
                const requireId = accounts.find((a) => a.uuid === row.account_uuid)?.require_id ?? 0
                const tiersOptions = requireId === 2 ? assetOptions : requireId === 3 ? supplierOptions : memberOptions
                return (
                  <tr key={index}>
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">
                      <select
                        value={row.account_uuid}
                        onChange={(event) => updateRow(index, { account_uuid: event.target.value, tiers_uuid: '' })}
                        className="h-9 w-48 min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">{t('journal.forms.selectAccount')}</option>
                        {accountOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {requireId === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <SearchableSelect
                          value={row.tiers_uuid}
                          options={tiersOptions}
                          clearable
                          clearLabel={t('journal.forms.clearTiers')}
                          onChange={(value) => updateRow(index, { tiers_uuid: value })}
                          placeholder={t('journal.forms.selectTiers')}
                          searchPlaceholder={t('journal.forms.searchTiers')}
                          noResultsText={t('journal.forms.noTiersResults')}
                          className="w-48 min-w-[12rem]"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input value={row.description} onChange={(event) => updateRow(index, { description: event.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amount}
                        onChange={(event) => updateRow(index, { amount: event.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeRow(index)}>
                        {t('creditCard.removeRow')}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-muted text-xs text-muted-foreground">
              <tr>
                <td className="px-3 py-2 font-medium" colSpan={3}>{t('creditCard.total')}</td>
                <td className="px-3 py-2 font-mono font-medium text-foreground" colSpan={2}>{total.toFixed(2)} €</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="secondary" onClick={addRow}>
            {t('creditCard.addRow')}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" disabled={!canSubmit} onClick={() => void handleGenerate()}>
          {isSubmitting ? t('creditCard.generating') : t('creditCard.generate')}
        </Button>
        {createdEntries && (
          <Button type="button" variant="secondary" disabled={bulkPostMutation.isPending} onClick={() => void handlePostBoth()}>
            {t('creditCard.postBoth')}
          </Button>
        )}
      </div>
    </section>
  )
}
