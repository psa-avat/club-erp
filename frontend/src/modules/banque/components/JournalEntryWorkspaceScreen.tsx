/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Journal entry workspace – draft editor, lines, post and reverse actions
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
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountingEntriesQuery,
  useAccountsQuery,
  useCreateAccountingEntryMutation,
  useFiscalYearsQuery,
  useJournalsQuery,
  useAccountingEntryModelsQuery,
  usePostAccountingEntryMutation,
  usePricingVersionsQuery,
  useReverseAccountingEntryMutation,
  useUpdateAccountingEntryMutation,
} from '../api'
import { usePricingItemsQuery } from '../../assets/api'
import type { PricingItem } from '../../assets/types'
import {
  ENTRY_STATE_DRAFT,
  ENTRY_STATE_POSTED,
  JournalPageShell,
  LineEditor,
  buildEntryLines,
  decimalOrZero,
  emptyEntryForm,
  emptyLine,
  isBalanced,
  mapEntryToForm,
  toErrorMessage,
  type EntryFormState,
  type LineFormState,
} from './journalShared'

type Props = {
  entryUuid?: string | null
}

export function JournalEntryWorkspaceScreen({ entryUuid = null }: Props) {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')
  const canManageModels = useCapability('MANAGE_ACCOUNTING_SETTINGS')
  const today = new Date().toISOString().slice(0, 10)

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const journalsQuery = useJournalsQuery(canView)
  const accountsQuery = useAccountsQuery(canView)
  const modelsQuery = useAccountingEntryModelsQuery(canView)

  const [entryForm, setEntryForm] = useState<EntryFormState>(() => emptyEntryForm(today))
  const [selectedEntryUuid, setSelectedEntryUuid] = useState<string | null>(entryUuid)
  const [selectedPriceVersionUuid, setSelectedPriceVersionUuid] = useState('')
  const [selectedPriceItemUuid, setSelectedPriceItemUuid] = useState('')
  const [priceQuantity, setPriceQuantity] = useState('1')
  const [priceDebitAccountUuid, setPriceDebitAccountUuid] = useState('')
  const [applyModelUuid, setApplyModelUuid] = useState('')
  const [reverseReason, setReverseReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const fiscalYears = fiscalYearsQuery.data ?? []
  const journals = journalsQuery.data ?? []
  const accounts = accountsQuery.data?.filter((account) => account.is_posting_allowed) ?? []
  const models = modelsQuery.data ?? []

  // Derive a minimal filter to load the forced entry when a UUID is provided
  const forcedEntryFilters = useMemo(
    () => (entryUuid && entryForm.fiscal_year_uuid ? { fiscal_year_uuid: entryForm.fiscal_year_uuid, limit: 200 } : undefined),
    [entryUuid, entryForm.fiscal_year_uuid],
  )
  const entriesQuery = useAccountingEntriesQuery(
    forcedEntryFilters ?? {},
    canView && Boolean(forcedEntryFilters),
  )
  const entries = entriesQuery.data ?? []

  const pricingVersionsQuery = usePricingVersionsQuery(
    entryForm.fiscal_year_uuid || null,
    canView && Boolean(entryForm.fiscal_year_uuid),
  )
  const pricingItemsQuery = usePricingItemsQuery(
    selectedPriceVersionUuid || null,
    canView && Boolean(selectedPriceVersionUuid),
  )

  const pricingVersions = pricingVersionsQuery.data ?? []
  const pricingItems = pricingItemsQuery.data ?? []

  const selectedEntry = entries.find((entry) => entry.uuid === selectedEntryUuid) ?? null
  const selectedPricingItem = pricingItems.find((item) => item.uuid === selectedPriceItemUuid) ?? null

  const createEntryMutation = useCreateAccountingEntryMutation()
  const updateEntryMutation = useUpdateAccountingEntryMutation()
  const postEntryMutation = usePostAccountingEntryMutation()
  const reverseEntryMutation = useReverseAccountingEntryMutation()

  // Seed fiscal year / journal defaults once data arrives
  useEffect(() => {
    if (fiscalYears.length > 0 && entryForm.fiscal_year_uuid === '') {
      setEntryForm((prev) => ({ ...prev, fiscal_year_uuid: fiscalYears[0].uuid }))
    }
  }, [fiscalYears, entryForm.fiscal_year_uuid])

  useEffect(() => {
    if (journals.length > 0 && entryForm.journal_uuid === '') {
      setEntryForm((prev) => ({ ...prev, journal_uuid: journals[0].uuid }))
    }
  }, [journals, entryForm.journal_uuid])

  // Load entry when forced by URL param
  useEffect(() => {
    if (!entryUuid || entries.length === 0) return
    const forced = entries.find((entry) => entry.uuid === entryUuid)
    if (!forced) return
    setSelectedEntryUuid(forced.uuid)
    setEntryForm(mapEntryToForm(forced))
    setLocalError(null)
  }, [entries, entryUuid])

  function updateEntryLine(index: number, patch: Partial<LineFormState>) {
    setEntryForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  }

  function resetEntryForm() {
    setSelectedEntryUuid(null)
    setReverseReason('')
    setSelectedPriceVersionUuid('')
    setSelectedPriceItemUuid('')
    setPriceQuantity('1')
    setPriceDebitAccountUuid('')
    setEntryForm((prev) => ({
      ...emptyEntryForm(today),
      fiscal_year_uuid: prev.fiscal_year_uuid,
      journal_uuid: prev.journal_uuid,
    }))
  }

  function applyModelToEntry() {
    const model = models.find((item) => item.uuid === applyModelUuid)
    if (!model) return
    setEntryForm((prev) => ({
      ...prev,
      journal_uuid: model.journal_uuid,
      reference: model.default_reference ?? prev.reference,
      description: model.description ?? model.name,
      lines: model.lines.map((line) => ({
        account_uuid: line.account_uuid,
        debit: line.debit,
        credit: line.credit,
        description: line.description ?? '',
      })),
    }))
  }

  function buildFromPricingItem(item: PricingItem) {
    if (!item.gl_account_credit_uuid) {
      setLocalError(t('journal.entries.pricing.missingRevenueAccount'))
      return
    }
    if (!priceDebitAccountUuid) {
      setLocalError(t('journal.entries.pricing.selectDebitAccount'))
      return
    }
    const quantity = decimalOrZero(priceQuantity || '1')
    const amount = new Decimal(item.base_price).mul(quantity).toFixed(2)
    setEntryForm((prev) => ({
      ...prev,
      description: `${t('journal.entries.pricing.generatedPrefix')} ${item.name}`,
      reference: item.name,
      lines: [
        { account_uuid: priceDebitAccountUuid, debit: amount, credit: '0', description: item.name },
        { account_uuid: item.gl_account_credit_uuid ?? '', debit: '0', credit: amount, description: item.name },
      ],
    }))
    setLocalError(null)
  }

  const entryCanSave =
    entryForm.fiscal_year_uuid !== '' &&
    entryForm.journal_uuid !== '' &&
    entryForm.description.trim() !== '' &&
    entryForm.lines.every((line) => line.account_uuid !== '') &&
    isBalanced(entryForm.lines)

  async function handleSaveEntry() {
    setLocalError(null)
    try {
      const payload = {
        fiscal_year_uuid: entryForm.fiscal_year_uuid,
        journal_uuid: entryForm.journal_uuid,
        entry_date: entryForm.entry_date,
        description: entryForm.description.trim(),
        reference: entryForm.reference.trim() || null,
        lines: buildEntryLines(entryForm.lines),
      }
      if (selectedEntryUuid) {
        await updateEntryMutation.mutateAsync({
          entryUuid: selectedEntryUuid,
          fiscalYearUuid: entryForm.fiscal_year_uuid,
          payload: {
            journal_uuid: payload.journal_uuid,
            entry_date: payload.entry_date,
            description: payload.description,
            reference: payload.reference,
            lines: payload.lines,
          },
        })
      } else {
        const created = await createEntryMutation.mutateAsync(payload)
        setSelectedEntryUuid(created.uuid)
      }
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function handlePostEntry() {
    if (!selectedEntry) return
    setLocalError(null)
    try {
      await postEntryMutation.mutateAsync({
        entryUuid: selectedEntry.uuid,
        fiscalYearUuid: selectedEntry.fiscal_year_uuid,
      })
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function handleReverseEntry() {
    if (!selectedEntry || reverseReason.trim() === '') return
    setLocalError(null)
    try {
      await reverseEntryMutation.mutateAsync({
        entryUuid: selectedEntry.uuid,
        fiscal_year_uuid: selectedEntry.fiscal_year_uuid,
        reversal_reason: reverseReason.trim(),
        entry_date: entryForm.entry_date,
      })
      setReverseReason('')
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
      </section>
    )
  }

  const anyError =
    localError ??
    (createEntryMutation.error || updateEntryMutation.error || postEntryMutation.error || reverseEntryMutation.error
      ? toErrorMessage(
          createEntryMutation.error ?? updateEntryMutation.error ?? postEntryMutation.error ?? reverseEntryMutation.error,
          t('journal.errors.generic'),
        )
      : null)

  return (
    <JournalPageShell canPost={canPost} canManageModels={canManageModels} t={t}>
      {anyError && <Alert>{anyError}</Alert>}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {selectedEntryUuid ? t('journal.entries.editDraft') : t('journal.entries.newDraft')}
          </h2>
          <Button type="button" variant="ghost" onClick={resetEntryForm}>
            {t('journal.entries.resetDraft')}
          </Button>
        </div>

        {/* Prefill helpers */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{t('journal.entries.modelSourceTitle')}</h3>
            <select
              value={applyModelUuid}
              onChange={(event) => setApplyModelUuid(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t('journal.entries.selectModel')}</option>
              {models.filter((model) => model.is_active).map((model) => (
                <option key={model.uuid} value={model.uuid}>{model.code} · {model.name}</option>
              ))}
            </select>
            <Button type="button" variant="secondary" disabled={!applyModelUuid} onClick={applyModelToEntry}>
              {t('journal.entries.applyModel')}
            </Button>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{t('journal.entries.pricing.title')}</h3>
            <select
              value={selectedPriceVersionUuid}
              onChange={(event) => { setSelectedPriceVersionUuid(event.target.value); setSelectedPriceItemUuid('') }}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t('journal.entries.pricing.selectVersion')}</option>
              {pricingVersions.map((version) => (
                <option key={version.uuid} value={version.uuid}>{version.name}</option>
              ))}
            </select>
            <select
              value={selectedPriceItemUuid}
              onChange={(event) => setSelectedPriceItemUuid(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t('journal.entries.pricing.selectItem')}</option>
              {pricingItems.map((item) => (
                <option key={item.uuid} value={item.uuid}>{item.name}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="number" min="0.01" step="0.01" value={priceQuantity}
                onChange={(event) => setPriceQuantity(event.target.value)}
                placeholder={t('journal.entries.pricing.quantity')}
              />
              <select
                value={priceDebitAccountUuid}
                onChange={(event) => setPriceDebitAccountUuid(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">{t('journal.entries.pricing.selectDebit')}</option>
                {accounts.map((account) => (
                  <option key={account.uuid} value={account.uuid}>{account.code} · {account.name}</option>
                ))}
              </select>
            </div>
            <Button
              type="button" variant="secondary"
              disabled={!selectedPricingItem}
              onClick={() => selectedPricingItem && buildFromPricingItem(selectedPricingItem)}
            >
              {t('journal.entries.pricing.apply')}
            </Button>
          </div>
        </div>

        {/* Entry header fields */}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>{t('journal.entries.fiscalYear')}</Label>
            <select
              value={entryForm.fiscal_year_uuid}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, fiscal_year_uuid: event.target.value }))}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t('journal.entries.selectFiscalYear')}</option>
              {fiscalYears.map((year) => (
                <option key={year.uuid} value={year.uuid}>{year.code}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.journal')}</Label>
            <select
              value={entryForm.journal_uuid}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, journal_uuid: event.target.value }))}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t('journal.entries.selectJournal')}</option>
              {journals.map((journal) => (
                <option key={journal.uuid} value={journal.uuid}>{journal.code} · {journal.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.entryDate')}</Label>
            <Input
              type="date" value={entryForm.entry_date}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, entry_date: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.reference')}</Label>
            <Input
              value={entryForm.reference}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, reference: event.target.value }))}
            />
          </div>
        </div>

        <div className="mt-3 space-y-1">
          <Label>{t('journal.entries.descriptionLabel')}</Label>
          <Input
            value={entryForm.description}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        <div className="mt-4">
          <LineEditor
            title={t('journal.forms.linesTitle')}
            lines={entryForm.lines}
            accounts={accounts}
            onChange={updateEntryLine}
            onAdd={() => setEntryForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}
            onRemove={(index) =>
              setEntryForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
            }
            t={t}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!canPost || !entryCanSave || createEntryMutation.isPending || updateEntryMutation.isPending}
            onClick={() => void handleSaveEntry()}
          >
            {selectedEntryUuid ? t('journal.entries.saveChanges') : t('journal.entries.saveDraft')}
          </Button>
          {selectedEntry && selectedEntry.state === ENTRY_STATE_DRAFT && (
            <Button
              type="button" variant="secondary"
              disabled={!canPost || postEntryMutation.isPending}
              onClick={() => void handlePostEntry()}
            >
              {t('journal.entries.postDraft')}
            </Button>
          )}
        </div>

        {selectedEntry && selectedEntry.state === ENTRY_STATE_POSTED && (
          <div className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <Label>{t('journal.entries.reverseReason')}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                value={reverseReason}
                onChange={(event) => setReverseReason(event.target.value)}
                className="max-w-xl"
              />
              <Button
                type="button" variant="secondary"
                disabled={!canPost || reverseReason.trim() === ''}
                onClick={() => void handleReverseEntry()}
              >
                {t('journal.entries.reverseAction')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </JournalPageShell>
  )
}
