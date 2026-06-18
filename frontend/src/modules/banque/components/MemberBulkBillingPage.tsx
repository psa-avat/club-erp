/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Page de facturation groupée membres (VT) — Phase 3b
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
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { useMemberOptionsQuery } from '../../members/api'
import type { MemberOption } from '../../members/types'
import {
  useAccountsQuery,
  useJournalsQuery,
  usePricingVersionsQuery,
  usePricingItemsQuery,
  useCreateAccountingEntryMutation,
  useBulkPostAccountingEntriesMutation,
  type PricingItem,
  type PricingVersion,
  type AccountOption,
} from '../api'
import { toErrorMessage } from './journalShared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(m: MemberOption): string {
  return `${m.first_name.charAt(0)}${m.last_name.charAt(0)}`.toUpperCase()
}

function formatEur(d: Decimal): string {
  return d.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0€'
}

function generateBatchRef(): string {
  const d = new Date()
  const yymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const seq = String(d.getTime()).slice(-4)
  return `BC-${yymm}-${seq}`
}

// ---------------------------------------------------------------------------
// Step 1 — Configuration card
// ---------------------------------------------------------------------------

interface StepConfigProps {
  fiscalYearUuid: string
  versions: PricingVersion[]
  selectedVersionUuid: string
  onVersionChange: (uuid: string) => void
  items: PricingItem[]
  selectedItemUuid: string
  onItemChange: (uuid: string) => void
  quantity: string
  onQuantityChange: (v: string) => void
  unitPrice: string
  onUnitPriceChange: (v: string) => void
  description: string
  onDescriptionChange: (v: string) => void
  postingDate: string
  onPostingDateChange: (v: string) => void
  receivableAccountUuid: string
  onReceivableChange: (uuid: string) => void
  revenueAccountUuid: string
  onRevenueChange: (uuid: string) => void
  accounts: AccountOption[]
  t: (key: string) => string
}

function StepConfig({
  versions,
  selectedVersionUuid, onVersionChange,
  items,
  selectedItemUuid, onItemChange,
  quantity, onQuantityChange,
  unitPrice, onUnitPriceChange,
  description, onDescriptionChange,
  postingDate, onPostingDateChange,
  receivableAccountUuid, onReceivableChange,
  revenueAccountUuid, onRevenueChange,
  accounts,
  t,
}: StepConfigProps) {
  const versionOptions = versions
    .filter((v) => v.status === 2)
    .map((v) => ({ value: v.uuid, label: v.name }))

  const itemOptions = [
    { value: '', label: t('billing.config.customItem') },
    ...items.map((i) => ({
      value: i.uuid,
      label: `${i.name}${new Decimal(i.base_price).gt(0) ? ' — ' + formatEur(new Decimal(i.base_price)) : ''}`,
    })),
  ]

  const receivableOptions = accounts
    .filter((a) => a.is_posting_allowed && a.code.startsWith('411'))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))

  const revenueOptions = accounts
    .filter((a) => a.is_posting_allowed && a.code.startsWith('7'))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))

  const selectedItem = items.find((i) => i.uuid === selectedItemUuid) ?? null
  const priceFromTariff = selectedItem && new Decimal(selectedItem.base_price).gt(0)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
          1
        </span>
        <h2 className="text-base font-semibold text-slate-900">
          {t('billing.config.title')}
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Pricing version */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            {t('billing.config.version')}
          </label>
          <SearchableSelect
            options={versionOptions}
            value={selectedVersionUuid}
            onChange={onVersionChange}
            placeholder={t('billing.config.versionPlaceholder')}
          />
        </div>

        {/* Pricing item */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            {t('billing.config.item')} *
          </label>
          <SearchableSelect
            options={itemOptions}
            value={selectedItemUuid}
            onChange={onItemChange}
            placeholder={t('billing.config.itemPlaceholder')}
          />
        </div>

        {/* Quantity */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600" htmlFor="bb-qty">
            {t('billing.config.quantity')} *
          </label>
          <Input
            id="bb-qty"
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => onQuantityChange(e.target.value)}
            className="font-mono"
          />
        </div>

        {/* Unit price */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600" htmlFor="bb-price">
            {t('billing.config.unitPrice')} (€) *
            {priceFromTariff && (
              <span className="ml-2 rounded bg-success-container px-1.5 py-0.5 text-[10px] font-normal text-on-success-container">
                {t('billing.config.fromTariff')}
              </span>
            )}
            {selectedItemUuid && !priceFromTariff && (
              <span className="ml-2 rounded bg-warning-container px-1.5 py-0.5 text-[10px] font-normal text-on-warning-container">
                {t('billing.config.manualPrice')}
              </span>
            )}
          </label>
          <Input
            id="bb-price"
            type="number"
            min="0"
            step="0.01"
            value={unitPrice}
            onChange={(e) => onUnitPriceChange(e.target.value)}
            placeholder="0.00"
            className="font-mono"
          />
        </div>

        {/* Description */}
        <div className="col-span-2 space-y-1">
          <label className="block text-xs font-medium text-slate-600" htmlFor="bb-desc">
            {t('billing.config.description')} *
          </label>
          <Input
            id="bb-desc"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={t('billing.config.descPlaceholder')}
          />
        </div>

        {/* Posting date */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600" htmlFor="bb-date">
            {t('billing.config.postingDate')} *
          </label>
          <Input
            id="bb-date"
            type="date"
            value={postingDate}
            onChange={(e) => onPostingDateChange(e.target.value)}
          />
        </div>

        {/* Receivable account */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            {t('billing.config.receivableAccount')} *
          </label>
          <SearchableSelect
            options={receivableOptions}
            value={receivableAccountUuid}
            onChange={onReceivableChange}
            placeholder={t('billing.config.accountPlaceholder')}
          />
        </div>

        {/* Revenue account */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            {t('billing.config.revenueAccount')} *
          </label>
          <SearchableSelect
            options={revenueOptions}
            value={revenueAccountUuid}
            onChange={onRevenueChange}
            placeholder={t('billing.config.accountPlaceholder')}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Member selection
// ---------------------------------------------------------------------------

interface StepMembersProps {
  members: MemberOption[]
  selectedUuids: Set<string>
  onToggle: (uuid: string) => void
  onToggleAll: (checked: boolean) => void
  search: string
  onSearchChange: (v: string) => void
  t: (key: string) => string
}

function StepMembers({
  members,
  selectedUuids,
  onToggle,
  onToggleAll,
  search,
  onSearchChange,
  t,
}: StepMembersProps) {
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.first_name.toLowerCase().includes(q) ||
        m.last_name.toLowerCase().includes(q) ||
        m.account_id.toLowerCase().includes(q),
    )
  }, [members, search])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((m) => selectedUuids.has(m.uuid))

  const someFilteredSelected =
    filtered.some((m) => selectedUuids.has(m.uuid)) && !allFilteredSelected

  // Avatar colour palette (deterministic from initials)
  const avatarColour = (m: MemberOption) => {
    const colours = [
      'bg-blue-100 text-blue-700',
      'bg-green-100 text-green-700',
      'bg-purple-100 text-purple-700',
      'bg-orange-100 text-orange-700',
      'bg-rose-100 text-rose-700',
      'bg-teal-100 text-teal-700',
    ]
    const idx = (m.first_name.charCodeAt(0) + m.last_name.charCodeAt(0)) % colours.length
    return colours[idx]
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
          2
        </span>
        <h2 className="flex-1 text-base font-semibold text-slate-900">
          {t('billing.members.title')}
        </h2>
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('billing.members.searchPlaceholder')}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
        <span className="text-xs text-slate-500">
          {selectedUuids.size} / {members.length} {t('billing.members.selected')}
        </span>
      </div>

      {/* Table */}
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="py-2 pl-4 pr-2 w-10">
                <input
                  type="checkbox"
                  aria-label={t('billing.members.selectAll')}
                  checked={allFilteredSelected}
                  ref={(el) => { if (el) el.indeterminate = someFilteredSelected }}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
              </th>
              <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {t('billing.members.col.name')}
              </th>
              <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {t('billing.members.col.accountId')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-slate-400">
                  {t('billing.members.empty')}
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const checked = selectedUuids.has(m.uuid)
                return (
                  <tr
                    key={m.uuid}
                    onClick={() => onToggle(m.uuid)}
                    className={[
                      'cursor-pointer border-b border-slate-100 last:border-0 transition-colors',
                      checked ? 'bg-slate-50' : 'hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <td className="py-2.5 pl-4 pr-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(m.uuid)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarColour(m)}`}
                        >
                          {initials(m)}
                        </span>
                        <span className="text-sm text-slate-800">
                          {m.last_name} {m.first_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-xs text-slate-500">
                      {m.account_id}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Right summary panel
// ---------------------------------------------------------------------------

interface SummaryPanelProps {
  selectedCount: number
  unitPrice: Decimal | null
  quantity: Decimal | null
  batchRef: string
  isValid: boolean
  isBusy: boolean
  progress: { done: number; total: number } | null
  errorMsg: string | null
  successMsg: string | null
  onGenerate: () => void
  onCancel: () => void
  t: (key: string) => string
}

function SummaryPanel({
  selectedCount,
  unitPrice,
  quantity,
  batchRef,
  isValid,
  isBusy,
  progress,
  errorMsg,
  successMsg,
  onGenerate,
  onCancel,
  t,
}: SummaryPanelProps) {
  const lineTotal = unitPrice && quantity ? unitPrice.mul(quantity) : null
  const grandTotal = lineTotal && selectedCount > 0 ? lineTotal.mul(selectedCount) : null

  return (
    <div className="sticky top-4 space-y-4">
      {/* Summary card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a4 4 0 0 1 4-4h4M13 7h4m0 0l-4 4m4-4l-4-4" />
          </svg>
          <h3 className="text-sm font-semibold text-slate-900">{t('billing.summary.title')}</h3>
        </div>

        <dl className="space-y-3">
          <div className="flex justify-between text-sm">
            <dt className="text-slate-500">{t('billing.summary.selectedMembers')}</dt>
            <dd className="font-semibold text-slate-900">{selectedCount}</dd>
          </div>

          {lineTotal && (
            <div className="flex justify-between text-sm">
              <dt className="text-slate-500">{t('billing.summary.lineAmount')}</dt>
              <dd className="font-mono text-slate-700">{formatEur(lineTotal)}</dd>
            </div>
          )}

          {grandTotal && (
            <div className="flex justify-between border-t border-slate-200 pt-3 text-sm">
              <dt className="font-semibold text-slate-700">{t('billing.summary.totalAmount')}</dt>
              <dd className="font-mono text-lg font-bold text-slate-900">{formatEur(grandTotal)}</dd>
            </div>
          )}

          <div className="flex justify-between text-sm">
            <dt className="text-slate-500">{t('billing.summary.journal')}</dt>
            <dd className="font-medium text-slate-700">VT (Ventes)</dd>
          </div>

          <div className="flex justify-between text-sm">
            <dt className="text-slate-500">{t('billing.summary.batchRef')}</dt>
            <dd className="font-mono text-xs text-slate-600">{batchRef}</dd>
          </div>
        </dl>

        {/* Info box */}
        <div className="mt-4 rounded-lg bg-surface-container p-3 text-xs text-slate-600">
          {t('billing.summary.infoText')}
        </div>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div role="alert" className="rounded-lg bg-error-container px-4 py-3 text-sm text-on-error-container">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div role="status" className="rounded-lg bg-success-container px-4 py-3 text-sm text-on-success-container">
          {successMsg}
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{t('billing.summary.generating')}</span>
            <span>{progress.done} / {progress.total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-slate-900 transition-all duration-300"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <Button
        className="w-full"
        disabled={!isValid || isBusy}
        onClick={onGenerate}
      >
        {isBusy ? t('billing.summary.generating') : t('billing.summary.generate')}
      </Button>

      <Button variant="ghost" className="w-full" onClick={onCancel} disabled={isBusy}>
        {t('billing.summary.cancel')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function MemberBulkBillingPage() {
  const { t } = useTranslation('banque')
  const navigate = useNavigate()
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  // ── Data queries ──────────────────────────────────────────────────────────
  const journalsQuery = useJournalsQuery()
  const accountsQuery = useAccountsQuery()
  const membersQuery = useMemberOptionsQuery({ limit: 5000 })
  const versionsQuery = usePricingVersionsQuery()

  const vtJournal = useMemo(
    () => journalsQuery.data?.find((j) => j.code === 'VT') ?? null,
    [journalsQuery.data],
  )

  // ── Form state ─────────────────────────────────────────────────────────────
  const [selectedVersionUuid, setSelectedVersionUuid] = useState('')
  const [selectedItemUuid, setSelectedItemUuid] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')
  const [description, setDescription] = useState('')
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [receivableAccountUuid, setReceivableAccountUuid] = useState('')
  const [revenueAccountUuid, setRevenueAccountUuid] = useState('')

  const [memberSearch, setMemberSearch] = useState('')
  const [selectedMemberUuids, setSelectedMemberUuids] = useState<Set<string>>(new Set())

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const [batchRef] = useState(() => generateBatchRef())

  // ── Load pricing items when version changes ────────────────────────────────
  const itemsQuery = usePricingItemsQuery(selectedVersionUuid || null, Boolean(selectedVersionUuid))

  // Auto-select first 411 account as default receivable
  const accounts = accountsQuery.data ?? []
  useEffect(() => {
    if (accounts.length > 0 && !receivableAccountUuid) {
      const first411 = accounts.find((a) => a.is_posting_allowed && a.code.startsWith('411'))
      if (first411) setReceivableAccountUuid(first411.uuid)
    }
  }, [accounts, receivableAccountUuid])

  // When pricing item selected → sync price, description, revenue account
  const items = itemsQuery.data ?? []
  useEffect(() => {
    const item = items.find((i) => i.uuid === selectedItemUuid) ?? null
    if (item) {
      setDescription(item.name)
      const price = new Decimal(item.base_price)
      if (price.gt(0)) setUnitPrice(price.toFixed(2))
      else setUnitPrice('') // manual price required
      if (item.gl_account_credit_uuid) setRevenueAccountUuid(item.gl_account_credit_uuid)
    } else {
      // "Custom" item — reset price/desc/account
      setDescription('')
      setUnitPrice('')
      setRevenueAccountUuid('')
    }
  }, [selectedItemUuid, items])

  // ── Member toggle ──────────────────────────────────────────────────────────
  const allMembers = membersQuery.data ?? []

  const handleToggle = useCallback((uuid: string) => {
    setSelectedMemberUuids((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }, [])

  const handleToggleAll = useCallback((checked: boolean) => {
    const q = memberSearch.toLowerCase()
    const filtered = !q
      ? allMembers
      : allMembers.filter(
          (m) =>
            m.first_name.toLowerCase().includes(q) ||
            m.last_name.toLowerCase().includes(q) ||
            m.account_id.toLowerCase().includes(q),
        )
    setSelectedMemberUuids((prev) => {
      const next = new Set(prev)
      for (const m of filtered) {
        if (checked) next.add(m.uuid)
        else next.delete(m.uuid)
      }
      return next
    })
  }, [allMembers, memberSearch])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useCreateAccountingEntryMutation()
  const bulkPostMutation = useBulkPostAccountingEntriesMutation()

  // ── Validation ─────────────────────────────────────────────────────────────
  const parsedQty = useMemo(() => {
    try { return new Decimal(quantity) } catch { return null }
  }, [quantity])

  const parsedPrice = useMemo(() => {
    try { return new Decimal(unitPrice) } catch { return null }
  }, [unitPrice])

  const isValid =
    canPost &&
    vtJournal !== null &&
    activeFiscalYearUuid !== null &&
    description.trim().length > 0 &&
    parsedQty !== null && parsedQty.gte(1) &&
    parsedPrice !== null && parsedPrice.gt(0) &&
    receivableAccountUuid.length > 0 &&
    revenueAccountUuid.length > 0 &&
    selectedMemberUuids.size > 0 &&
    progress === null

  const isBusy = createMutation.isPending || bulkPostMutation.isPending || progress !== null

  // ── Generate entries ──────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!isValid || !vtJournal || !activeFiscalYearUuid || !parsedQty || !parsedPrice) return
    setErrorMsg(null)
    setSuccessMsg(null)

    const members = allMembers.filter((m) => selectedMemberUuids.has(m.uuid))
    const total = members.length
    setProgress({ done: 0, total })

    const lineAmount = parsedQty.mul(parsedPrice).toFixed(4)
    const createdUuids: string[] = []

    try {
      for (let i = 0; i < members.length; i++) {
        const m = members[i]
        const desc = `${description.trim()} — ${m.last_name} ${m.first_name}`
        const entry = await createMutation.mutateAsync({
          fiscal_year_uuid: activeFiscalYearUuid,
          journal_uuid: vtJournal.uuid,
          entry_date: postingDate,
          description: desc,
          reference: batchRef,
          lines: [
            {
              account_uuid: receivableAccountUuid,
              debit: lineAmount,
              credit: '0.0000',
              description: desc,
              member_uuid: m.uuid,
            },
            {
              account_uuid: revenueAccountUuid,
              debit: '0.0000',
              credit: lineAmount,
              description: desc,
            },
          ],
        })
        createdUuids.push(entry.uuid)
        setProgress({ done: i + 1, total })
      }

      setProgress(null)
      setSuccessMsg(
        t('billing.summary.successMsg', {
          count: createdUuids.length,
          ref: batchRef,
        }),
      )
    } catch (err) {
      setProgress(null)
      setErrorMsg(
        toErrorMessage(
          err,
          t('billing.summary.errorMsg', { done: createdUuids.length, total }),
        ),
      )
    }
  }

  // ── Guard ─────────────────────────────────────────────────────────────────
  if (!canPost) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
      </section>
    )
  }

  const versions = versionsQuery.data ?? []

  return (
    <div className="space-y-4">
      {/* Page header */}
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
          <h1 className="text-xl font-semibold text-slate-900">{t('billing.title')}</h1>
          <p className="text-sm text-slate-500">{t('billing.description')}</p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* Left — Steps */}
        <div className="space-y-4">
          <StepConfig
            fiscalYearUuid={activeFiscalYearUuid ?? ''}
            versions={versions}
            selectedVersionUuid={selectedVersionUuid}
            onVersionChange={(v) => { setSelectedVersionUuid(v); setSelectedItemUuid('') }}
            items={items}
            selectedItemUuid={selectedItemUuid}
            onItemChange={setSelectedItemUuid}
            quantity={quantity}
            onQuantityChange={setQuantity}
            unitPrice={unitPrice}
            onUnitPriceChange={setUnitPrice}
            description={description}
            onDescriptionChange={setDescription}
            postingDate={postingDate}
            onPostingDateChange={setPostingDate}
            receivableAccountUuid={receivableAccountUuid}
            onReceivableChange={setReceivableAccountUuid}
            revenueAccountUuid={revenueAccountUuid}
            onRevenueChange={setRevenueAccountUuid}
            accounts={accounts}
            t={t}
          />

          <StepMembers
            members={allMembers}
            selectedUuids={selectedMemberUuids}
            onToggle={handleToggle}
            onToggleAll={handleToggleAll}
            search={memberSearch}
            onSearchChange={setMemberSearch}
            t={t}
          />
        </div>

        {/* Right — Summary */}
        <SummaryPanel
          selectedCount={selectedMemberUuids.size}
          unitPrice={parsedPrice}
          quantity={parsedQty}
          batchRef={batchRef}
          isValid={isValid}
          isBusy={isBusy}
          progress={progress}
          errorMsg={errorMsg}
          successMsg={successMsg}
          onGenerate={handleGenerate}
          onCancel={() => navigate('/banque/operations')}
          t={t}
        />
      </div>
    </div>
  )
}
