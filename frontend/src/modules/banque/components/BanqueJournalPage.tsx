/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Journal and ledger management screen with reusable entry models
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
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AxiosError } from 'axios'
import Decimal from 'decimal.js'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAccountingEntriesQuery,
  useAccountingEntryModelsQuery,
  useAccountsQuery,
  useCreateAccountingEntryModelMutation,
  useCreateAccountingEntryMutation,
  useDeleteAccountingEntryModelMutation,
  useFiscalYearsQuery,
  useJournalsQuery,
  usePostAccountingEntryMutation,
  usePricingVersionsQuery,
  useReverseAccountingEntryMutation,
  useUpdateAccountingEntryModelMutation,
  useUpdateAccountingEntryMutation,
  type AccountingEntry,
  type AccountingEntryLinePayload,
  type AccountingEntryModel,
  type AccountingEntryModelLinePayload,
} from '../api'
import { usePricingItemsQuery } from '../../assets/api'
import type { PricingItem } from '../../assets/types'

type TabKey = 'entries' | 'models'

type LineFormState = {
  account_uuid: string
  debit: string
  credit: string
  description: string
}

type EntryFormState = {
  fiscal_year_uuid: string
  journal_uuid: string
  entry_date: string
  description: string
  reference: string
  lines: LineFormState[]
}

type ModelFormState = {
  code: string
  name: string
  journal_uuid: string
  description: string
  default_reference: string
  recurrence_type: number
  is_active: boolean
  lines: LineFormState[]
}

const ENTRY_STATE_DRAFT = 1
const ENTRY_STATE_POSTED = 2
const RECURRENCE_OPTIONS = [1, 2, 3, 4] as const

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
    if (Array.isArray(detail) && detail.length > 0 && typeof detail[0]?.msg === 'string') return detail[0].msg
  }
  return fallback
}

function emptyLine(): LineFormState {
  return { account_uuid: '', debit: '', credit: '', description: '' }
}

function emptyEntryForm(today: string): EntryFormState {
  return {
    fiscal_year_uuid: '',
    journal_uuid: '',
    entry_date: today,
    description: '',
    reference: '',
    lines: [emptyLine(), emptyLine()],
  }
}

function emptyModelForm(): ModelFormState {
  return {
    code: '',
    name: '',
    journal_uuid: '',
    description: '',
    default_reference: '',
    recurrence_type: 1,
    is_active: true,
    lines: [emptyLine(), emptyLine()],
  }
}

function decimalOrZero(value: string): Decimal {
  if (value.trim() === '') return new Decimal(0)
  try {
    return new Decimal(value)
  } catch {
    return new Decimal(0)
  }
}

function isBalanced(lines: LineFormState[]): boolean {
  const debit = lines.reduce((sum, line) => sum.plus(decimalOrZero(line.debit)), new Decimal(0))
  const credit = lines.reduce((sum, line) => sum.plus(decimalOrZero(line.credit)), new Decimal(0))
  return debit.equals(credit) && debit.greaterThan(0)
}

function totals(lines: LineFormState[]): { debit: string; credit: string } {
  const debit = lines.reduce((sum, line) => sum.plus(decimalOrZero(line.debit)), new Decimal(0))
  const credit = lines.reduce((sum, line) => sum.plus(decimalOrZero(line.credit)), new Decimal(0))
  return { debit: debit.toFixed(2), credit: credit.toFixed(2) }
}

function mapEntryToForm(entry: AccountingEntry): EntryFormState {
  return {
    fiscal_year_uuid: entry.fiscal_year_uuid,
    journal_uuid: entry.journal_uuid,
    entry_date: entry.entry_date,
    description: entry.description,
    reference: entry.reference ?? '',
    lines: entry.lines.map((line) => ({
      account_uuid: line.account_uuid,
      debit: line.debit,
      credit: line.credit,
      description: line.description ?? '',
    })),
  }
}

function mapModelToForm(model: AccountingEntryModel): ModelFormState {
  return {
    code: model.code,
    name: model.name,
    journal_uuid: model.journal_uuid,
    description: model.description ?? '',
    default_reference: model.default_reference ?? '',
    recurrence_type: model.recurrence_type,
    is_active: model.is_active,
    lines: model.lines.map((line) => ({
      account_uuid: line.account_uuid,
      debit: line.debit,
      credit: line.credit,
      description: line.description ?? '',
    })),
  }
}

function buildEntryLines(lines: LineFormState[]): AccountingEntryLinePayload[] {
  return lines.map((line) => ({
    account_uuid: line.account_uuid,
    debit: line.debit.trim() === '' ? '0' : line.debit.trim(),
    credit: line.credit.trim() === '' ? '0' : line.credit.trim(),
    description: line.description.trim() === '' ? null : line.description.trim(),
  }))
}

function buildModelLines(lines: LineFormState[]): AccountingEntryModelLinePayload[] {
  return lines.map((line) => ({
    account_uuid: line.account_uuid,
    debit: line.debit.trim() === '' ? '0' : line.debit.trim(),
    credit: line.credit.trim() === '' ? '0' : line.credit.trim(),
    description: line.description.trim() === '' ? null : line.description.trim(),
  }))
}

function recurrenceLabel(value: number, t: (key: string) => string): string {
  if (value === 2) return t('journal.models.recurrence.monthly')
  if (value === 3) return t('journal.models.recurrence.quarterly')
  if (value === 4) return t('journal.models.recurrence.yearly')
  return t('journal.models.recurrence.manual')
}

function entryStateLabel(value: number, t: (key: string) => string): string {
  if (value === ENTRY_STATE_POSTED) return t('journal.entries.states.posted')
  if (value === 3) return t('journal.entries.states.cancelled')
  return t('journal.entries.states.draft')
}

function LineEditor({
  title,
  lines,
  accounts,
  onChange,
  onAdd,
  onRemove,
  t,
}: {
  title: string
  lines: LineFormState[]
  accounts: Array<{ uuid: string; code: string; name: string }>
  onChange: (index: number, patch: Partial<LineFormState>) => void
  onAdd: () => void
  onRemove: (index: number) => void
  t: (key: string) => string
}) {
  const summary = totals(lines)

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <Button type="button" size="sm" variant="secondary" onClick={onAdd}>
          {t('journal.forms.addLine')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-700">{t('journal.forms.account')}</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">{t('journal.forms.debit')}</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">{t('journal.forms.credit')}</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">{t('journal.forms.lineDescription')}</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">{t('journal.forms.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line, index) => (
              <tr key={index}>
                <td className="px-3 py-2">
                  <select
                    value={line.account_uuid}
                    onChange={(event) => onChange(index, { account_uuid: event.target.value })}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                  >
                    <option value="">{t('journal.forms.selectAccount')}</option>
                    {accounts.map((account) => (
                      <option key={account.uuid} value={account.uuid}>{account.code} · {account.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.debit}
                    onChange={(event) => onChange(index, { debit: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.credit}
                    onChange={(event) => onChange(index, { credit: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input value={line.description} onChange={(event) => onChange(index, { description: event.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)}>
                    {t('journal.forms.remove')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <td className="px-3 py-2 font-medium">{t('journal.forms.total')}</td>
              <td className="px-3 py-2 font-mono">{summary.debit}</td>
              <td className="px-3 py-2 font-mono">{summary.credit}</td>
              <td className="px-3 py-2" colSpan={2}>
                {summary.debit === summary.credit ? t('journal.forms.balanced') : t('journal.forms.unbalanced')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export function BanqueJournalPage() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')
  const canManageModels = useCapability('MANAGE_ACCOUNTING_SETTINGS')
  const today = new Date().toISOString().slice(0, 10)

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const journalsQuery = useJournalsQuery(canView)
  const accountsQuery = useAccountsQuery(canView)
  const modelsQuery = useAccountingEntryModelsQuery(canView)

  const [activeTab, setActiveTab] = useState<TabKey>('entries')
  const [filters, setFilters] = useState({ fiscal_year_uuid: '', journal_uuid: '', state: 0, search: '' })
  const [entryForm, setEntryForm] = useState<EntryFormState>(() => emptyEntryForm(today))
  const [modelForm, setModelForm] = useState<ModelFormState>(() => emptyModelForm())
  const [selectedEntryUuid, setSelectedEntryUuid] = useState<string | null>(null)
  const [selectedModelUuid, setSelectedModelUuid] = useState<string | null>(null)
  const [selectedPriceVersionUuid, setSelectedPriceVersionUuid] = useState('')
  const [selectedPriceItemUuid, setSelectedPriceItemUuid] = useState('')
  const [priceQuantity, setPriceQuantity] = useState('1')
  const [priceDebitAccountUuid, setPriceDebitAccountUuid] = useState('')
  const [applyModelUuid, setApplyModelUuid] = useState('')
  const [reverseReason, setReverseReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const entryFilters = useMemo(
    () => ({
      fiscal_year_uuid: filters.fiscal_year_uuid || undefined,
      journal_uuid: filters.journal_uuid || undefined,
      state: filters.state || undefined,
      search: filters.search.trim() || undefined,
      limit: 200,
    }),
    [filters],
  )

  const entriesQuery = useAccountingEntriesQuery(entryFilters, canView && Boolean(filters.fiscal_year_uuid))
  const pricingVersionsQuery = usePricingVersionsQuery(entryForm.fiscal_year_uuid || null, canView && Boolean(entryForm.fiscal_year_uuid))
  const pricingItemsQuery = usePricingItemsQuery(selectedPriceVersionUuid || null, canView && Boolean(selectedPriceVersionUuid))

  const createEntryMutation = useCreateAccountingEntryMutation()
  const updateEntryMutation = useUpdateAccountingEntryMutation()
  const postEntryMutation = usePostAccountingEntryMutation()
  const reverseEntryMutation = useReverseAccountingEntryMutation()
  const createModelMutation = useCreateAccountingEntryModelMutation()
  const updateModelMutation = useUpdateAccountingEntryModelMutation()
  const deleteModelMutation = useDeleteAccountingEntryModelMutation()

  const fiscalYears = fiscalYearsQuery.data ?? []
  const journals = journalsQuery.data ?? []
  const accounts = accountsQuery.data?.filter((account) => account.is_posting_allowed) ?? []
  const entries = entriesQuery.data ?? []
  const models = modelsQuery.data ?? []
  const pricingVersions = pricingVersionsQuery.data ?? []
  const pricingItems = pricingItemsQuery.data ?? []

  const selectedEntry = entries.find((entry) => entry.uuid === selectedEntryUuid) ?? null
  const selectedPricingItem = pricingItems.find((item) => item.uuid === selectedPriceItemUuid) ?? null

  useEffect(() => {
    if (fiscalYears.length > 0 && filters.fiscal_year_uuid === '') {
      const initialFiscalYear = fiscalYears[0].uuid
      setFilters((prev) => ({ ...prev, fiscal_year_uuid: initialFiscalYear }))
      setEntryForm((prev) => ({ ...prev, fiscal_year_uuid: initialFiscalYear }))
    }
  }, [filters.fiscal_year_uuid, fiscalYears])

  useEffect(() => {
    if (journals.length > 0 && entryForm.journal_uuid === '') {
      setEntryForm((prev) => ({ ...prev, journal_uuid: journals[0].uuid }))
      setModelForm((prev) => ({ ...prev, journal_uuid: prev.journal_uuid || journals[0].uuid }))
    }
  }, [entryForm.journal_uuid, journals])

  function updateEntryLine(index: number, patch: Partial<LineFormState>) {
    setEntryForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    }))
  }

  function updateModelLine(index: number, patch: Partial<LineFormState>) {
    setModelForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
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

  function resetModelForm() {
    setSelectedModelUuid(null)
    setModelForm((prev) => ({ ...emptyModelForm(), journal_uuid: prev.journal_uuid }))
  }

  function selectEntry(entry: AccountingEntry) {
    setSelectedEntryUuid(entry.uuid)
    setEntryForm(mapEntryToForm(entry))
    setLocalError(null)
    setActiveTab('entries')
  }

  function selectModel(model: AccountingEntryModel) {
    setSelectedModelUuid(model.uuid)
    setModelForm(mapModelToForm(model))
    setLocalError(null)
    setActiveTab('models')
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
        {
          account_uuid: priceDebitAccountUuid,
          debit: amount,
          credit: '0',
          description: item.name,
        },
        {
          account_uuid: item.gl_account_credit_uuid ?? '',
          debit: '0',
          credit: amount,
          description: item.name,
        },
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

  const modelCanSave =
    modelForm.code.trim() !== '' &&
    modelForm.name.trim() !== '' &&
    modelForm.journal_uuid !== '' &&
    modelForm.lines.every((line) => line.account_uuid !== '') &&
    isBalanced(modelForm.lines)

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
      await postEntryMutation.mutateAsync({ entryUuid: selectedEntry.uuid, fiscalYearUuid: selectedEntry.fiscal_year_uuid })
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

  async function handleSaveModel() {
    setLocalError(null)
    const payload = {
      code: modelForm.code.trim(),
      name: modelForm.name.trim(),
      journal_uuid: modelForm.journal_uuid,
      description: modelForm.description.trim() || null,
      default_reference: modelForm.default_reference.trim() || null,
      recurrence_type: modelForm.recurrence_type,
      is_active: modelForm.is_active,
      lines: buildModelLines(modelForm.lines),
    }
    try {
      if (selectedModelUuid) {
        await updateModelMutation.mutateAsync({ templateUuid: selectedModelUuid, payload })
      } else {
        const created = await createModelMutation.mutateAsync(payload)
        setSelectedModelUuid(created.uuid)
      }
    } catch (error) {
      setLocalError(toErrorMessage(error, t('journal.errors.generic')))
    }
  }

  async function handleDeleteModel(templateUuid: string) {
    setLocalError(null)
    try {
      await deleteModelMutation.mutateAsync(templateUuid)
      if (selectedModelUuid === templateUuid) resetModelForm()
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

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2">
          <Link to="/banque" className="text-xs text-slate-500 hover:text-slate-800">← {t('journal.back')}</Link>
        </div>
        <h1 className="text-xl font-semibold text-slate-900">{t('journal.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('journal.description')}</p>
      </div>

      {(localError || createEntryMutation.error || updateEntryMutation.error || postEntryMutation.error || reverseEntryMutation.error || createModelMutation.error || updateModelMutation.error || deleteModelMutation.error) && (
        <Alert>
          {localError ?? toErrorMessage(createEntryMutation.error ?? updateEntryMutation.error ?? postEntryMutation.error ?? reverseEntryMutation.error ?? createModelMutation.error ?? updateModelMutation.error ?? deleteModelMutation.error, t('journal.errors.generic'))}
        </Alert>
      )}

      <div className="flex gap-2">
        <Button variant={activeTab === 'entries' ? 'default' : 'secondary'} type="button" onClick={() => setActiveTab('entries')}>
          {t('journal.tabs.entries')}
        </Button>
        <Button variant={activeTab === 'models' ? 'default' : 'secondary'} type="button" onClick={() => setActiveTab('models')}>
          {t('journal.tabs.models')}
        </Button>
      </div>

      {activeTab === 'entries' ? (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{t('journal.entries.filtersTitle')}</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label>{t('journal.entries.fiscalYear')}</Label>
                  <select
                    value={filters.fiscal_year_uuid}
                    onChange={(event) => {
                      const fiscalYearUuid = event.target.value
                      setFilters((prev) => ({ ...prev, fiscal_year_uuid: fiscalYearUuid }))
                      setEntryForm((prev) => ({ ...prev, fiscal_year_uuid: fiscalYearUuid }))
                    }}
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
                    value={filters.journal_uuid}
                    onChange={(event) => setFilters((prev) => ({ ...prev, journal_uuid: event.target.value }))}
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  >
                    <option value="">{t('journal.entries.allJournals')}</option>
                    {journals.map((journal) => (
                      <option key={journal.uuid} value={journal.uuid}>{journal.code} · {journal.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>{t('journal.entries.state')}</Label>
                  <select
                    value={filters.state}
                    onChange={(event) => setFilters((prev) => ({ ...prev, state: Number(event.target.value) }))}
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  >
                    <option value={0}>{t('journal.entries.allStates')}</option>
                    <option value={1}>{t('journal.entries.states.draft')}</option>
                    <option value={2}>{t('journal.entries.states.posted')}</option>
                    <option value={3}>{t('journal.entries.states.cancelled')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>{t('journal.entries.search')}</Label>
                  <Input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{selectedEntryUuid ? t('journal.entries.editDraft') : t('journal.entries.newDraft')}</h2>
                <Button type="button" variant="ghost" onClick={resetEntryForm}>{t('journal.entries.resetDraft')}</Button>
              </div>

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
                    onChange={(event) => {
                      setSelectedPriceVersionUuid(event.target.value)
                      setSelectedPriceItemUuid('')
                    }}
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
                    <Input type="number" min="0.01" step="0.01" value={priceQuantity} onChange={(event) => setPriceQuantity(event.target.value)} placeholder={t('journal.entries.pricing.quantity')} />
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
                    type="button"
                    variant="secondary"
                    disabled={!selectedPricingItem}
                    onClick={() => selectedPricingItem && buildFromPricingItem(selectedPricingItem)}
                  >
                    {t('journal.entries.pricing.apply')}
                  </Button>
                </div>
              </div>

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
                  <Input type="date" value={entryForm.entry_date} onChange={(event) => setEntryForm((prev) => ({ ...prev, entry_date: event.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>{t('journal.entries.reference')}</Label>
                  <Input value={entryForm.reference} onChange={(event) => setEntryForm((prev) => ({ ...prev, reference: event.target.value }))} />
                </div>
              </div>

              <div className="mt-3 space-y-1">
                <Label>{t('journal.entries.descriptionLabel')}</Label>
                <Input value={entryForm.description} onChange={(event) => setEntryForm((prev) => ({ ...prev, description: event.target.value }))} />
              </div>

              <div className="mt-4">
                <LineEditor
                  title={t('journal.forms.linesTitle')}
                  lines={entryForm.lines}
                  accounts={accounts}
                  onChange={updateEntryLine}
                  onAdd={() => setEntryForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}
                  onRemove={(index) => setEntryForm((prev) => ({ ...prev, lines: prev.lines.filter((_, lineIndex) => lineIndex !== index) }))}
                  t={t}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" disabled={!canPost || !entryCanSave || createEntryMutation.isPending || updateEntryMutation.isPending} onClick={() => void handleSaveEntry()}>
                  {selectedEntryUuid ? t('journal.entries.saveChanges') : t('journal.entries.saveDraft')}
                </Button>
                {selectedEntry && selectedEntry.state === ENTRY_STATE_DRAFT && (
                  <Button type="button" variant="secondary" disabled={!canPost || postEntryMutation.isPending} onClick={() => void handlePostEntry()}>
                    {t('journal.entries.postDraft')}
                  </Button>
                )}
              </div>

              {selectedEntry && selectedEntry.state === ENTRY_STATE_POSTED && (
                <div className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <Label>{t('journal.entries.reverseReason')}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} className="max-w-xl" />
                    <Button type="button" variant="secondary" disabled={!canPost || reverseReason.trim() === ''} onClick={() => void handleReverseEntry()}>
                      {t('journal.entries.reverseAction')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{t('journal.entries.listTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('journal.entries.listDescription')}</p>
            <div className="mt-4 space-y-3">
              {entriesQuery.isLoading ? (
                <p className="text-sm text-slate-500">{t('settings.loading')}</p>
              ) : entries.length === 0 ? (
                <p className="text-sm text-slate-500">{t('journal.entries.empty')}</p>
              ) : (
                entries.map((entry) => {
                  const summary = totals(entry.lines.map((line) => ({
                    account_uuid: line.account_uuid,
                    debit: line.debit,
                    credit: line.credit,
                    description: line.description ?? '',
                  })))
                  return (
                    <button
                      key={entry.uuid}
                      type="button"
                      onClick={() => selectEntry(entry)}
                      className={[
                        'w-full rounded-lg border p-4 text-left transition-colors',
                        selectedEntryUuid === entry.uuid
                          ? 'border-slate-900 bg-slate-50'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{entry.sequence_number ?? t('journal.entries.draftSequence')}</p>
                          <p className="text-sm text-slate-700">{entry.description}</p>
                          <p className="text-xs text-slate-500">{entry.entry_date} · {entry.reference ?? t('journal.entries.noReference')}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{entryStateLabel(entry.state, t)}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>{entry.lines.length} {t('journal.entries.linesCount')}</span>
                        <span className="font-mono">D {summary.debit} / C {summary.credit}</span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">{selectedModelUuid ? t('journal.models.editTitle') : t('journal.models.newTitle')}</h2>
              <Button type="button" variant="ghost" onClick={resetModelForm}>{t('journal.models.reset')}</Button>
            </div>
            {!canManageModels && <p className="mt-3 text-sm text-slate-500">{t('journal.models.noPermission')}</p>}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('journal.models.code')}</Label>
                <Input value={modelForm.code} onChange={(event) => setModelForm((prev) => ({ ...prev, code: event.target.value }))} disabled={!canManageModels} />
              </div>
              <div className="space-y-1">
                <Label>{t('journal.models.name')}</Label>
                <Input value={modelForm.name} onChange={(event) => setModelForm((prev) => ({ ...prev, name: event.target.value }))} disabled={!canManageModels} />
              </div>
              <div className="space-y-1">
                <Label>{t('journal.entries.journal')}</Label>
                <select
                  value={modelForm.journal_uuid}
                  onChange={(event) => setModelForm((prev) => ({ ...prev, journal_uuid: event.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  disabled={!canManageModels}
                >
                  <option value="">{t('journal.entries.selectJournal')}</option>
                  {journals.map((journal) => (
                    <option key={journal.uuid} value={journal.uuid}>{journal.code} · {journal.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t('journal.models.recurrence.label')}</Label>
                <select
                  value={modelForm.recurrence_type}
                  onChange={(event) => setModelForm((prev) => ({ ...prev, recurrence_type: Number(event.target.value) }))}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  disabled={!canManageModels}
                >
                  {RECURRENCE_OPTIONS.map((value) => (
                    <option key={value} value={value}>{recurrenceLabel(value, t)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('journal.models.defaultReference')}</Label>
                <Input value={modelForm.default_reference} onChange={(event) => setModelForm((prev) => ({ ...prev, default_reference: event.target.value }))} disabled={!canManageModels} />
              </div>
              <label className="mt-7 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={modelForm.is_active} onChange={(event) => setModelForm((prev) => ({ ...prev, is_active: event.target.checked }))} disabled={!canManageModels} />
                {t('journal.models.active')}
              </label>
            </div>
            <div className="mt-3 space-y-1">
              <Label>{t('journal.models.descriptionLabel')}</Label>
              <Input value={modelForm.description} onChange={(event) => setModelForm((prev) => ({ ...prev, description: event.target.value }))} disabled={!canManageModels} />
            </div>
            <div className="mt-4">
              <LineEditor
                title={t('journal.models.linesTitle')}
                lines={modelForm.lines}
                accounts={accounts}
                onChange={updateModelLine}
                onAdd={() => setModelForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}
                onRemove={(index) => setModelForm((prev) => ({ ...prev, lines: prev.lines.filter((_, lineIndex) => lineIndex !== index) }))}
                t={t}
              />
            </div>
            {canManageModels && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" disabled={!modelCanSave} onClick={() => void handleSaveModel()}>
                  {selectedModelUuid ? t('journal.models.saveChanges') : t('journal.models.saveModel')}
                </Button>
                {selectedModelUuid && (
                  <Button type="button" variant="secondary" onClick={() => void handleDeleteModel(selectedModelUuid)}>
                    {t('journal.models.deleteModel')}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{t('journal.models.listTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('journal.models.listDescription')}</p>
            <div className="mt-4 space-y-3">
              {modelsQuery.isLoading ? (
                <p className="text-sm text-slate-500">{t('settings.loading')}</p>
              ) : models.length === 0 ? (
                <p className="text-sm text-slate-500">{t('journal.models.empty')}</p>
              ) : (
                models.map((model) => (
                  <div key={model.uuid} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{model.code} · {model.name}</p>
                        <p className="text-xs text-slate-500">{recurrenceLabel(model.recurrence_type, t)} · {model.is_active ? t('journal.models.statusActive') : t('journal.models.statusInactive')}</p>
                      </div>
                      <Button type="button" size="sm" variant="ghost" onClick={() => selectModel(model)}>
                        {t('journal.models.editAction')}
                      </Button>
                    </div>
                    {model.description && <p className="mt-2 text-sm text-slate-600">{model.description}</p>}
                    <div className="mt-3 text-xs text-slate-500">{model.lines.length} {t('journal.entries.linesCount')}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
