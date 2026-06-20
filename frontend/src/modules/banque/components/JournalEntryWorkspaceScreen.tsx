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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'
import { useNavigate } from 'react-router-dom'

import { Alert } from '../../../components/ui/alert'
import { Banner } from '../../../components/ui/banner'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SectionHeader } from '../../../components/ui/section-header'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useMembersQuery } from '../../members/api'
import { useAssetsQuery } from '../../assets/api'
import {
  useAccountingEntryQuery,
  useAccountsQuery,
  useCreateAccountingEntryMutation,
  useFiscalYearsQuery,
  useJournalsQuery,
  useAccountingEntryModelsQuery,
  usePostAccountingEntryMutation,
  usePricingItemsQuery,
  usePricingVersionsQuery,
  useReverseAccountingEntryMutation,
  useUpdateAccountingEntryMutation,
  type FiscalYear,
  type PricingItem,
} from '../api'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import {
  ENTRY_STATE_DRAFT,
  ENTRY_STATE_POSTED,
  LineEditor,
  buildEntryLines,
  decimalOrZero,
  emptyEntryForm,
  emptyLine,
  entryStateBadgeClass,
  isBalanced,
  mapEntryToForm,
  toErrorMessage,
  type EntryFormState,
  type LineFormState,
} from './journalShared'
import { ReversalDialog } from './ReversalDialog'

type Props = {
  entryUuid?: string | null
  entryFiscalYearUuid?: string | null
}

export function JournalEntryWorkspaceScreen({ entryUuid = null, entryFiscalYearUuid = null }: Props) {
  const navigate = useNavigate()
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')
  const today = new Date().toISOString().slice(0, 10)

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const journalsQuery = useJournalsQuery(canView)
  const accountsQuery = useAccountsQuery(canView)
  const modelsQuery = useAccountingEntryModelsQuery(canView)
  const membersQuery = useMembersQuery({ search: '' })
  const assetsQuery = useAssetsQuery({}, canView)

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  const [entryForm, setEntryForm] = useState<EntryFormState>(() => ({
    ...emptyEntryForm(today),
    fiscal_year_uuid: entryFiscalYearUuid ?? '',
  }))
  const [selectedEntryUuid, setSelectedEntryUuid] = useState<string | null>(entryUuid)
  const [selectedPriceVersionUuid, setSelectedPriceVersionUuid] = useState('')
  const [selectedPriceItemUuid, setSelectedPriceItemUuid] = useState('')
  const [priceQuantity, setPriceQuantity] = useState('1')
  const [priceDebitAccountUuid, setPriceDebitAccountUuid] = useState('')
  const [applyModelUuid, setApplyModelUuid] = useState('')
  const [reversalDialogOpen, setReversalDialogOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fiscalYears = fiscalYearsQuery.data ?? []
  const journals = journalsQuery.data ?? []
  const accounts = accountsQuery.data?.filter((account) => account.is_posting_allowed) ?? []
  const models = modelsQuery.data ?? []
  const allMembers = membersQuery.data ?? []
  const members = allMembers
  const assets = assetsQuery.data ?? []

  const forcedEntryFiscalYearUuid = entryFiscalYearUuid || entryForm.fiscal_year_uuid || null
  const forcedEntryQuery = useAccountingEntryQuery(
    entryUuid,
    forcedEntryFiscalYearUuid,
    canView && Boolean(entryUuid && forcedEntryFiscalYearUuid),
  )

  const pricingVersionsQuery = usePricingVersionsQuery(canView)
  const pricingItemsQuery = usePricingItemsQuery(
    selectedPriceVersionUuid || null,
    canView && Boolean(selectedPriceVersionUuid),
  )

  const pricingVersions = pricingVersionsQuery.data ?? []
  const pricingItems = pricingItemsQuery.data ?? []

  const selectedEntry = forcedEntryQuery.data && forcedEntryQuery.data.uuid === selectedEntryUuid
    ? forcedEntryQuery.data
    : null
  const selectedPricingItem = pricingItems.find((item) => item.uuid === selectedPriceItemUuid) ?? null

  const createEntryMutation = useCreateAccountingEntryMutation()
  const updateEntryMutation = useUpdateAccountingEntryMutation()
  const postEntryMutation = usePostAccountingEntryMutation()
  const reverseEntryMutation = useReverseAccountingEntryMutation()

  useEffect(() => {
    if (createEntryMutation.isSuccess || updateEntryMutation.isSuccess) {
      setSuccessMessage(t('journal.entries.saved'))
      const id = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(id)
    }
  }, [createEntryMutation.isSuccess, updateEntryMutation.isSuccess, t])

  useEffect(() => {
    if (postEntryMutation.isSuccess) {
      setSuccessMessage(t('journal.entries.posted'))
      const id = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(id)
    }
  }, [postEntryMutation.isSuccess, t])

  useEffect(() => {
    if (reverseEntryMutation.isSuccess) {
      setSuccessMessage(t('journal.entries.reversed'))
      const id = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(id)
    }
  }, [reverseEntryMutation.isSuccess, t])

  // Seed fiscal year default from global store once on mount
  useEffect(() => {
    if (!entryFiscalYearUuid && activeFiscalYearUuid && entryForm.fiscal_year_uuid === '') {
      setEntryForm((prev) => ({ ...prev, fiscal_year_uuid: activeFiscalYearUuid }))
    }
  }, [activeFiscalYearUuid, entryFiscalYearUuid, entryForm.fiscal_year_uuid])

  useEffect(() => {
    if (journals.length > 0 && entryForm.journal_uuid === '') {
      setEntryForm((prev) => ({ ...prev, journal_uuid: journals[0].uuid }))
    }
  }, [journals, entryForm.journal_uuid])

  // Load entry when forced by URL param
  useEffect(() => {
    if (!entryUuid) return
    setSelectedEntryUuid(entryUuid)
    if (entryFiscalYearUuid) {
      setEntryForm((prev) => ({ ...prev, fiscal_year_uuid: entryFiscalYearUuid }))
    }
  }, [entryUuid, entryFiscalYearUuid])

  // Load entry when forced by URL param
  useEffect(() => {
    const forced = forcedEntryQuery.data
    if (!forced) return
    setSelectedEntryUuid(forced.uuid)
    setEntryForm(mapEntryToForm(forced))
    setLocalError(null)
  }, [forcedEntryQuery.data])

  function updateEntryLine(index: number, patch: Partial<LineFormState>) {
    setEntryForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  }

  function resetEntryForm() {
    setSelectedEntryUuid(null)
    setReversalDialogOpen(false)
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
      lines: model.lines.map((line) => {
        const debit = decimalOrZero(line.debit)
        const credit = decimalOrZero(line.credit)
        const amount = debit.greaterThan(0) ? debit : credit.negated()
        return {
          account_uuid: line.account_uuid,
          amount: amount.toFixed(2),
          description: line.description ?? '',
          tiers_uuid: line.tiers_uuid ?? '',
        }
      }),
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
        { account_uuid: priceDebitAccountUuid, amount: amount, description: item.name, tiers_uuid: '' },
        { account_uuid: item.gl_account_credit_uuid ?? '', amount: new Decimal(amount).negated().toFixed(2), description: item.name, tiers_uuid: '' },
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

  async function handleCreateReversal(reason: string) {
    if (!selectedEntry || reason.trim() === '') return
    setLocalError(null)
    try {
      const reversedDraft = await reverseEntryMutation.mutateAsync({
        entryUuid: selectedEntry.uuid,
        fiscal_year_uuid: selectedEntry.fiscal_year_uuid,
        reversal_reason: reason.trim(),
        entry_date: entryForm.entry_date,
      })
      setReversalDialogOpen(false)
      setSelectedEntryUuid(reversedDraft.uuid)
      setEntryForm(mapEntryToForm(reversedDraft))
      navigate(`/banque/journal/entry/${reversedDraft.uuid}`)
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  if (!canView) {
    return (
      <section className="rounded-shape-lg border border-outline-variant bg-surface p-6 shadow-surface-1">
        <p className="text-sm text-on-surface-variant">{t('journal.noPermission')}</p>
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

  const isPostedEntry = selectedEntry?.state === ENTRY_STATE_POSTED
  const postedAtLabel = selectedEntry?.posted_at ? new Date(selectedEntry.posted_at).toLocaleString() : '—'

  return (
    <section className="space-y-4">
      {anyError && <Alert>{anyError}</Alert>}
      {successMessage && (
        <Banner variant="success" message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      )}

      <div className="rounded-shape-lg border border-outline-variant bg-surface p-6 shadow-surface-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-on-surface">
              {selectedEntryUuid ? t('journal.entries.editDraft') : t('journal.entries.newDraft')}
            </h2>
            {selectedEntry && !isPostedEntry && (
              <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${entryStateBadgeClass(selectedEntry.state)}`}>
                {t('journal.entries.draftStatus.badge')}
              </span>
            )}
            {selectedEntry && isPostedEntry && (
              <span className="shrink-0 rounded-full bg-success-container px-3 py-1 text-xs font-semibold text-on-success-container">
                {t('journal.entries.locked.badge')}
              </span>
            )}
          </div>
          <Button type="button" variant="ghost" onClick={resetEntryForm}>
            {t('journal.entries.resetDraft')}
          </Button>
        </div>

        {selectedEntry && isPostedEntry && (
          <div className="mt-4 space-y-2 rounded-shape-md border border-success-container bg-success-container p-4 text-on-success-container">
            <p className="text-base font-semibold">{t('journal.entries.locked.badge')}</p>
            <p className="text-sm">
              {t('journal.entries.locked.meta', {
                user: selectedEntry.created_by,
                date: postedAtLabel,
              })}
            </p>
          </div>
        )}

        {selectedEntry && selectedEntry.state === ENTRY_STATE_DRAFT && (
          <div className="mt-4 space-y-2 rounded-shape-md border border-warning-container bg-warning-container p-4 text-on-warning-container">
            <p className="text-base font-semibold">{t('journal.entries.draftStatus.badge')}</p>
            <p className="text-sm">{t('journal.entries.draftStatus.subtext')}</p>
          </div>
        )}

        {selectedEntry && isPostedEntry && (
          <Alert>{t('journal.entries.locked.warning')}</Alert>
        )}

        {/* Prefill helpers — FA-01: visually separated from core entry */}
        <div className="mt-4 border-t border-outline-variant pt-4">
          <SectionHeader title={t('journal.entries.helpersTitle')} className="mb-3" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-shape-md border border-outline-variant bg-surface-container p-4">
            <h3 className="text-sm font-semibold text-on-surface">{t('journal.entries.modelSourceTitle')}</h3>
            <select
              value={applyModelUuid}
              disabled={isPostedEntry}
              onChange={(event) => setApplyModelUuid(event.target.value)}
              className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
            >
              <option value="">{t('journal.entries.selectModel')}</option>
              {models.filter((model) => model.is_active).map((model) => (
                <option key={model.uuid} value={model.uuid}>{model.code} · {model.name}</option>
              ))}
            </select>
            <Button type="button" variant="secondary" disabled={isPostedEntry || !applyModelUuid} onClick={applyModelToEntry}>
              {t('journal.entries.applyModel')}
            </Button>
          </div>

          <div className="space-y-3 rounded-shape-md border border-outline-variant bg-surface-container p-4">
            <h3 className="text-sm font-semibold text-on-surface">{t('journal.entries.pricing.title')}</h3>
            <select
              value={selectedPriceVersionUuid}
              disabled={isPostedEntry}
              onChange={(event) => { setSelectedPriceVersionUuid(event.target.value); setSelectedPriceItemUuid('') }}
              className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
            >
              <option value="">{t('journal.entries.pricing.selectVersion')}</option>
              {pricingVersions.map((version) => (
                <option key={version.uuid} value={version.uuid}>{version.name}</option>
              ))}
            </select>
            <select
              value={selectedPriceItemUuid}
              disabled={isPostedEntry}
              onChange={(event) => setSelectedPriceItemUuid(event.target.value)}
              className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
            >
              <option value="">{t('journal.entries.pricing.selectItem')}</option>
              {pricingItems.map((item) => (
                <option key={item.uuid} value={item.uuid}>{item.name}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="number" min="0.01" step="0.01" value={priceQuantity}
                disabled={isPostedEntry}
                onChange={(event) => setPriceQuantity(event.target.value)}
                placeholder={t('journal.entries.pricing.quantity')}
              />
              <select
                value={priceDebitAccountUuid}
                disabled={isPostedEntry}
                onChange={(event) => setPriceDebitAccountUuid(event.target.value)}
                className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
              >
                <option value="">{t('journal.entries.pricing.selectDebit')}</option>
                {accounts.map((account) => (
                  <option key={account.uuid} value={account.uuid}>{account.code} · {account.name}</option>
                ))}
              </select>
            </div>
            <Button
              type="button" variant="secondary"
              disabled={isPostedEntry || !selectedPricingItem}
              onClick={() => selectedPricingItem && buildFromPricingItem(selectedPricingItem)}
            >
              {t('journal.entries.pricing.apply')}
            </Button>
          </div>
        </div>

        {/* Core entry — FA-01: visually separated from helpers */}
        <div className="mt-4 border-t border-outline-variant pt-4">
          <SectionHeader title={t('journal.entries.coreTitle')} className="mb-3" />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>{t('journal.entries.fiscalYear')}</Label>
            <select
              value={entryForm.fiscal_year_uuid}
              disabled={isPostedEntry}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, fiscal_year_uuid: event.target.value }))}
              className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
            >
              <option value="">{t('journal.entries.selectFiscalYear')}</option>
              {fiscalYears.map((year: FiscalYear) => (
                <option key={year.uuid} value={year.uuid}>{year.code}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.journal')}</Label>
            <select
              value={entryForm.journal_uuid}
              disabled={isPostedEntry}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, journal_uuid: event.target.value }))}
              className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
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
              disabled={isPostedEntry}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, entry_date: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('journal.entries.reference')}</Label>
            <Input
              value={entryForm.reference}
              disabled={isPostedEntry}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, reference: event.target.value }))}
            />
          </div>
        </div>

        <div className="mt-3 space-y-1">
          <Label>{t('journal.entries.descriptionLabel')}</Label>
          <Input
            value={entryForm.description}
            disabled={isPostedEntry}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        <div className="mt-4">
          <LineEditor
            title={t('journal.forms.linesTitle')}
            lines={entryForm.lines}
            accounts={accounts}
            members={members}
            assets={assets}
            onChange={updateEntryLine}
            onAdd={() => setEntryForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}
            onRemove={(index) =>
              setEntryForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
            }
            disabled={isPostedEntry}
            t={t}
          />
        </div>

        {/* Balance indicator */}
        {!isPostedEntry && entryForm.lines.length > 0 && (
          <div className="mt-4 rounded-shape-md border border-outline-variant bg-surface-container p-4">
            {(() => {
              const { debit: debitStr, credit: creditStr } = (() => {
                const debit = entryForm.lines.reduce((sum, line) => {
                  const amount = decimalOrZero(line.amount)
                  return amount.greaterThan(0) ? sum.plus(amount) : sum
                }, new Decimal(0))
                const credit = entryForm.lines.reduce((sum, line) => {
                  const amount = decimalOrZero(line.amount)
                  return amount.lessThan(0) ? sum.plus(amount.abs()) : sum
                }, new Decimal(0))
                return { debit: debit.toFixed(2), credit: credit.toFixed(2) }
              })()
              const debit = new Decimal(debitStr)
              const credit = new Decimal(creditStr)
              const isBalanced = debit.equals(credit) && debit.greaterThan(0)
              const diff = debit.minus(credit).abs().toFixed(2)
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    {isBalanced ? (
                      <>
                        <span className="rounded-full bg-success-container px-3 py-1 text-xs font-semibold text-on-success-container">
                          ✓ {t('journal.entries.balanceStatus.balanced')}
                        </span>
                        <p className="text-xs text-on-surface-variant">
                          {t('journal.entries.balanceStatus.bothSidesMatch', { amount: debitStr })}
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="rounded-full bg-warning-container px-3 py-1 text-xs font-semibold text-on-warning-container">
                          ⚠ {t('journal.entries.balanceStatus.unbalanced')}
                        </span>
                        <p className="text-xs text-on-surface-variant">
                          {t('journal.entries.balanceStatus.delta', { diff })}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-outline-variant bg-surface px-2 py-1">
                      <p className="text-on-surface-variant">{t('journal.entries.balanceStatus.debit')}</p>
                      <p className="font-semibold text-on-surface">{debitStr} €</p>
                    </div>
                    <div className="rounded border border-outline-variant bg-surface px-2 py-1">
                      <p className="text-on-surface-variant">{t('journal.entries.balanceStatus.credit')}</p>
                      <p className="font-semibold text-on-surface">{creditStr} €</p>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {!isPostedEntry && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!canPost || !entryCanSave || createEntryMutation.isPending || updateEntryMutation.isPending}
              onClick={() => void handleSaveEntry()}
            >
              {createEntryMutation.isPending || updateEntryMutation.isPending
                ? t('journal.entries.saving')
                : selectedEntryUuid ? t('journal.entries.saveChanges') : t('journal.entries.saveDraft')}
            </Button>
            {selectedEntry && selectedEntry.state === ENTRY_STATE_DRAFT && (
              <Button
                type="button" variant="secondary"
                disabled={!canPost || postEntryMutation.isPending}
                onClick={() => void handlePostEntry()}
              >
                {postEntryMutation.isPending ? t('journal.entries.posting') : t('journal.entries.postDraft')}
              </Button>
            )}
          </div>
        )}

        {selectedEntry && isPostedEntry && (
          <div className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={!canPost || reverseEntryMutation.isPending}
              onClick={() => setReversalDialogOpen(true)}
            >
              {t('journal.entries.locked.reverseCta')}
            </Button>
          </div>
        )}
      </div>

      <ReversalDialog
        open={reversalDialogOpen}
        entry={selectedEntry}
        accounts={accountsQuery.data ?? []}
        isSubmitting={reverseEntryMutation.isPending}
        onClose={() => setReversalDialogOpen(false)}
        onConfirm={handleCreateReversal}
        t={t}
      />
    </section>
  )
}
