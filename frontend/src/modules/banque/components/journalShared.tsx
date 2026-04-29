/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Shared types, helpers and primitive components for Journal screens
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
import { Link, useLocation } from 'react-router-dom'
import Decimal from 'decimal.js'
import { AxiosError } from 'axios'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import type { AccountingEntry, AccountingEntryLinePayload, AccountingEntryModel, AccountingEntryModelLinePayload } from '../api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ENTRY_STATE_DRAFT = 1
export const ENTRY_STATE_POSTED = 2
export const RECURRENCE_OPTIONS = [1, 2, 3, 4] as const

// ---------------------------------------------------------------------------
// Local form state shapes
// ---------------------------------------------------------------------------

export type LineFormState = {
  account_uuid: string
  amount: string // signed: positive = debit, negative = credit
  description: string
  member_uuid: string
}

export type EntryFormState = {
  fiscal_year_uuid: string
  journal_uuid: string
  entry_date: string
  description: string
  reference: string
  lines: LineFormState[]
}

export type ModelFormState = {
  code: string
  name: string
  journal_uuid: string
  description: string
  default_reference: string
  recurrence_type: number
  is_active: boolean
  lines: LineFormState[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
    if (Array.isArray(detail) && detail.length > 0 && typeof detail[0]?.msg === 'string') return detail[0].msg
  }
  return fallback
}

export function emptyLine(): LineFormState {
  return { account_uuid: '', amount: '', description: '', member_uuid: '' }
}

export function emptyEntryForm(today: string): EntryFormState {
  return {
    fiscal_year_uuid: '',
    journal_uuid: '',
    entry_date: today,
    description: '',
    reference: '',
    lines: [emptyLine(), emptyLine()],
  }
}

export function emptyModelForm(): ModelFormState {
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

export function decimalOrZero(value: string): Decimal {
  if (value.trim() === '') return new Decimal(0)
  try {
    return new Decimal(value)
  } catch {
    return new Decimal(0)
  }
}

export function isBalanced(lines: LineFormState[]): boolean {
  const net = lines.reduce((sum, line) => sum.plus(decimalOrZero(line.amount)), new Decimal(0))
  return net.equals(0) && lines.some((line) => !decimalOrZero(line.amount).equals(0))
}

export function totals(lines: LineFormState[]): { debit: string; credit: string } {
  const debit = lines.reduce((sum, line) => {
    const amount = decimalOrZero(line.amount)
    return amount.greaterThan(0) ? sum.plus(amount) : sum
  }, new Decimal(0))
  const credit = lines.reduce((sum, line) => {
    const amount = decimalOrZero(line.amount)
    return amount.lessThan(0) ? sum.plus(amount.abs()) : sum
  }, new Decimal(0))
  return { debit: debit.toFixed(2), credit: credit.toFixed(2) }
}

export function mapEntryToForm(entry: AccountingEntry): EntryFormState {
  return {
    fiscal_year_uuid: entry.fiscal_year_uuid,
    journal_uuid: entry.journal_uuid,
    entry_date: entry.entry_date,
    description: entry.description,
    reference: entry.reference ?? '',
    lines: entry.lines.map((line) => {
      const debit = decimalOrZero(line.debit)
      const credit = decimalOrZero(line.credit)
      const amount = debit.greaterThan(0) ? debit : credit.negated()
      return {
        account_uuid: line.account_uuid,
        amount: amount.toFixed(2),
        description: line.description ?? '',
        member_uuid: line.member_uuid ?? '',
      }
    }),
  }
}

export function mapModelToForm(model: AccountingEntryModel): ModelFormState {
  return {
    code: model.code,
    name: model.name,
    journal_uuid: model.journal_uuid,
    description: model.description ?? '',
    default_reference: model.default_reference ?? '',
    recurrence_type: model.recurrence_type,
    is_active: model.is_active,
    lines: model.lines.map((line) => {
      const debit = decimalOrZero(line.debit)
      const credit = decimalOrZero(line.credit)
      const amount = debit.greaterThan(0) ? debit : credit.negated()
      return {
        account_uuid: line.account_uuid,
        amount: amount.toFixed(2),
        description: line.description ?? '',
        member_uuid: line.member_uuid ?? '',
      }
    }),
  }
}

export function buildEntryLines(lines: LineFormState[]): AccountingEntryLinePayload[] {
  return lines.map((line) => {
    const amount = decimalOrZero(line.amount)
    const debit = amount.greaterThan(0) ? amount.toFixed(2) : '0'
    const credit = amount.lessThan(0) ? amount.abs().toFixed(2) : '0'
    return {
      account_uuid: line.account_uuid,
      debit,
      credit,
      description: line.description.trim() === '' ? null : line.description.trim(),
      member_uuid: line.member_uuid.trim() === '' ? null : line.member_uuid.trim(),
    }
  })
}

export function buildModelLines(lines: LineFormState[]): AccountingEntryModelLinePayload[] {
  return lines.map((line) => {
    const amount = decimalOrZero(line.amount)
    const debit = amount.greaterThan(0) ? amount.toFixed(2) : '0'
    const credit = amount.lessThan(0) ? amount.abs().toFixed(2) : '0'
    return {
      account_uuid: line.account_uuid,
      debit,
      credit,
      description: line.description.trim() === '' ? null : line.description.trim(),
      member_uuid: line.member_uuid.trim() === '' ? null : line.member_uuid.trim(),
    }
  })
}

export function recurrenceLabel(value: number, t: (key: string) => string): string {
  if (value === 2) return t('journal.models.recurrence.monthly')
  if (value === 3) return t('journal.models.recurrence.quarterly')
  if (value === 4) return t('journal.models.recurrence.yearly')
  return t('journal.models.recurrence.manual')
}

export function entryStateLabel(value: number, t: (key: string) => string): string {
  if (value === ENTRY_STATE_POSTED) return t('journal.entries.states.posted')
  if (value === 3) return t('journal.entries.states.cancelled')
  return t('journal.entries.states.draft')
}

export function entryStateBadgeClass(state: number): string {
  if (state === ENTRY_STATE_POSTED) return 'bg-success-container text-on-success-container'
  if (state === 3) return 'bg-error-container text-on-error-container'
  return 'bg-warning-container text-on-warning-container'
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

// ---------------------------------------------------------------------------
// Shared primitive: LineEditor
// ---------------------------------------------------------------------------

export function LineEditor({
  title,
  lines,
  accounts,
  members,
  onChange,
  onAdd,
  onRemove,
  t,
}: {
  title: string
  lines: LineFormState[]
  accounts: Array<{ uuid: string; code: string; name: string }>
  members: Array<{ uuid: string; first_name: string; last_name: string }>
  onChange: (index: number, patch: Partial<LineFormState>) => void
  onAdd: () => void
  onRemove: (index: number) => void
  t: (key: string) => string
}) {
  const summary = totals(lines)
  const balanced = isBalanced(lines)
  return (
    <div className="space-y-3 rounded-shape-md border border-outline-variant bg-surface-container p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
      </div>
      <div className="overflow-x-auto rounded-shape-md border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-outline-variant text-sm">
          <thead className="bg-surface-container">
            <tr>
              <th className="sticky left-0 z-10 bg-surface-container px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.forms.account')}</th>
              <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.forms.amount')}</th>
              <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.forms.lineDescription')}</th>
              <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.forms.tiers')}</th>
              <th className="px-3 py-2 text-left font-medium text-on-surface-variant">{t('journal.forms.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {lines.map((line, index) => (
              <tr key={index}>
                <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                  <select
                    value={line.account_uuid}
                    onChange={(event) => onChange(index, { account_uuid: event.target.value })}
                    className="h-9 w-48 min-w-[12rem] rounded-shape-sm border border-outline bg-surface px-2 text-sm"
                  >
                    <option value="">{t('journal.forms.selectAccount')}</option>
                    {accounts.map((account) => (
                      <option key={account.uuid} value={account.uuid}>{account.code} · {account.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <Input type="number" step="0.01" value={line.amount} onChange={(event) => onChange(index, { amount: event.target.value })} placeholder={t('journal.forms.amountPlaceholder')} />
                </td>
                <td className="px-3 py-2">
                  <Input value={line.description} onChange={(event) => onChange(index, { description: event.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={line.member_uuid}
                    onChange={(event) => onChange(index, { member_uuid: event.target.value })}
                    className="h-9 w-48 min-w-[12rem] rounded-shape-sm border border-outline bg-surface px-2 text-sm"
                  >
                    <option value="">{t('journal.forms.selectTiers')}</option>
                    {members.map((member) => (
                      <option key={member.uuid} value={member.uuid}>{member.first_name} {member.last_name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)}>
                    {t('journal.forms.remove')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-container text-xs text-on-surface-variant">
            <tr>
              <td className="px-3 py-2 font-medium">{t('journal.forms.total')}</td>
              <td colSpan={2} className="px-3 py-2">
                <span className={`font-mono ${balanced ? 'text-success' : 'text-error'}`}>
                  {t('journal.forms.debit')}: {summary.debit} · {t('journal.forms.credit')}: {summary.credit}
                </span>
              </td>
              <td className={`px-3 py-2 font-medium ${balanced ? 'text-success' : 'text-error'}`} colSpan={2}>
                {balanced ? t('journal.forms.balanced') : t('journal.forms.unbalanced')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {/* FA-03: duplicate add-line button at bottom so it's reachable after many rows */}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="secondary" onClick={onAdd}>
          {t('journal.forms.addLine')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared layout: JournalPageShell
// ---------------------------------------------------------------------------

export function JournalPageShell({
  canPost,
  canManageModels,
  t,
  children,
}: {
  canPost: boolean
  canManageModels: boolean
  t: (key: string) => string
  children: React.ReactNode
}) {
  const location = useLocation()
  const isEntriesActive =
    location.pathname === '/banque/journal' || location.pathname === '/banque/journal/entries'
  const isWorkspaceActive = location.pathname.startsWith('/banque/journal/entry/')
  const isTemplatesActive = location.pathname === '/banque/journal/templates'

  const linkClass = (active: boolean) =>
    [
      'rounded-shape-sm border px-3 py-2 text-sm transition-colors',
      active
        ? 'border-primary bg-primary text-on-primary'
        : 'border-outline-variant bg-surface-variant text-on-surface hover:bg-surface-container',
    ].join(' ')

  return (
    <section className="space-y-4">
      <div className="rounded-shape-lg border border-outline-variant bg-surface p-6 shadow-surface-1">
        <div className="mb-2">
          <Link to="/banque" className="text-xs text-on-surface-variant hover:text-on-surface">← {t('journal.back')}</Link>
        </div>
        <h1 className="text-xl font-semibold text-on-surface">{t('journal.title')}</h1>
        <p className="mt-1 text-sm text-on-surface-variant">{t('journal.description')}</p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Journal navigation">
          <Link
            to="/banque/journal/entries"
            className={linkClass(isEntriesActive)}
            aria-current={isEntriesActive ? 'page' : undefined}
          >
            {t('journal.tabs.entries')}
          </Link>
          {canPost && (
            <Link
              to="/banque/journal/entry/new"
              className={linkClass(isWorkspaceActive)}
              aria-current={isWorkspaceActive ? 'page' : undefined}
            >
              {t('journal.entries.newDraft')}
            </Link>
          )}
          {canManageModels && (
            <Link
              to="/banque/journal/templates"
              className={linkClass(isTemplatesActive)}
              aria-current={isTemplatesActive ? 'page' : undefined}
            >
              {t('journal.tabs.models')}
            </Link>
          )}
        </nav>
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Shared primitive: JournalSubNav (standalone, for backward compat)
// ---------------------------------------------------------------------------

export function JournalSubNav({
  isEntriesActive,
  isWorkspaceActive,
  isTemplatesActive,
  canPost,
  canManageModels,
  t,
}: {
  isEntriesActive: boolean
  isWorkspaceActive: boolean
  isTemplatesActive: boolean
  canPost: boolean
  canManageModels: boolean
  t: (key: string) => string
}) {
  const linkClass = (active: boolean) =>
    [
      'rounded-shape-sm border px-3 py-2 text-sm transition-colors',
      active
        ? 'border-primary bg-primary text-on-primary'
        : 'border-outline-variant bg-surface-variant text-on-surface hover:bg-surface-container',
    ].join(' ')

  return (
    <nav className="mt-4 flex flex-wrap gap-2" aria-label="Journal navigation">
      <Link to="/banque/journal/entries" className={linkClass(isEntriesActive)} aria-current={isEntriesActive ? 'page' : undefined}>
        {t('journal.tabs.entries')}
      </Link>
      {canPost && (
        <Link to="/banque/journal/entry/new" className={linkClass(isWorkspaceActive)} aria-current={isWorkspaceActive ? 'page' : undefined}>
          {t('journal.entries.newDraft')}
        </Link>
      )}
      {canManageModels && (
        <Link to="/banque/journal/templates" className={linkClass(isTemplatesActive)} aria-current={isTemplatesActive ? 'page' : undefined}>
          {t('journal.tabs.models')}
        </Link>
      )}
    </nav>
  )
}
