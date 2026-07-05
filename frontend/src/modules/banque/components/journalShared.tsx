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

import Decimal from 'decimal.js'
import { AxiosError } from 'axios'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import type { AccountingEntry, AccountingEntryLinePayload, AccountingEntryModel, AccountingEntryModelLinePayload } from '../api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ENTRY_STATE_DRAFT = 1
export const ENTRY_STATE_POSTED = 2
export const ENTRY_STATE_CANCELLED = 3
export const RECURRENCE_OPTIONS = [1, 2, 3, 4] as const

// ---------------------------------------------------------------------------
// Operational status vocabulary (cross-module daily ops)
// Used by Fournisseurs, Ventes, Vols, Paiements, Salaires screens
// ---------------------------------------------------------------------------

export const OPS_STATUS = {
  DRAFT:       'draft',       // Brouillon
  PENDING:     'pending',     // À valider
  VALIDATED:   'validated',   // Validé
  OVERDUE:     'overdue',     // Échu
  PAID:        'paid',        // Payé
  PARTIAL:     'partial',     // Partiel
  REIMBURSED:  'reimbursed',  // Remboursé
  MATCHED:     'matched',     // Lettré
  ARCHIVED:    'archived',    // Archivé
  BLOCKED:     'blocked',     // Bloqué
} as const

export type OpsStatus = typeof OPS_STATUS[keyof typeof OPS_STATUS]

export function opsStatusBadgeClass(status: OpsStatus): string {
  switch (status) {
    case 'validated':
    case 'paid':
    case 'matched':
      return 'badge-success'
    case 'overdue':
    case 'blocked':
      return 'badge-destructive'
    case 'pending':
    case 'draft':
      return 'badge-warning'
    case 'partial':
    case 'reimbursed':
      return 'bg-secondary text-secondary-foreground'
    case 'archived':
      return 'bg-muted text-muted-foreground'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

export function opsStatusLabel(status: OpsStatus, t: (key: string) => string): string {
  return t(`ops.statuses.${status}`)
}

// ---------------------------------------------------------------------------
// Bank reconciliation status vocabulary
// ---------------------------------------------------------------------------

export function reconciliationStatusBadgeClass(status: 'imported' | 'matching' | 'reconciled' | 'flagged'): string {
  switch (status) {
    case 'imported': return 'badge-info'
    case 'matching': return 'badge-warning'
    case 'reconciled': return 'badge-success'
    case 'flagged': return 'badge-destructive'
    default: return 'bg-muted text-muted-foreground'
  }
}

export function reconciliationLineStatusBadgeClass(
  status: 'unmatched' | 'auto_matched' | 'manually_matched' | 'discrepancy' | 'excluded',
): string {
  switch (status) {
    case 'auto_matched': return 'badge-success'
    case 'manually_matched': return 'badge-info'
    case 'discrepancy': return 'badge-warning'
    case 'excluded': return 'bg-muted text-muted-foreground line-through'
    case 'unmatched':
    default:
      return 'bg-muted text-muted-foreground'
  }
}

/** Badge for the main journal entries list: whether an entry is tied to a bank
 * statement line, distinguishing "Rapproché" (parent statement closed) from
 * "Associé" (matched but the statement isn't reconciled yet). Returns null when
 * the entry has no bank match at all. */
export function bankMatchBadge(
  bankMatchStatus: 'auto_matched' | 'manually_matched' | 'discrepancy' | null | undefined,
  bankStatementStatus: 'imported' | 'matching' | 'reconciled' | 'flagged' | null | undefined,
  t: (key: string, fallback: string) => string,
): { label: string; className: string } | null {
  if (bankMatchStatus === 'auto_matched' || bankMatchStatus === 'manually_matched') {
    return bankStatementStatus === 'reconciled'
      ? { label: t('journal.entries.bankReconciled', 'Rapproché'), className: 'badge-success' }
      : { label: t('journal.entries.bankAssociated', 'Associé'), className: 'badge-info' }
  }
  if (bankMatchStatus === 'discrepancy') {
    return { label: t('journal.entries.bankDiscrepancy', 'Écart'), className: 'badge-warning' }
  }
  return null
}

// ---------------------------------------------------------------------------
// Local form state shapes
// ---------------------------------------------------------------------------

export type FormulaType = 'fixed' | 'percentage' | 'previous_period' | 'rounding_adjustment'

export type LineFormState = {
  account_uuid: string
  amount: string // signed: positive = debit, negative = credit
  description: string
  tiers_uuid: string  // UUID of member, asset, or supplier depending on account.require_id
  // Formula (optional — defaults to 'fixed' in buildModelLines)
  formula_type?: FormulaType
  formula_params?: {
    percentage?: number
    source_line_index?: number
    fallback_amount?: number
  }
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
  // Scheduling (pluriannual)
  valid_from: string
  valid_until: string
  next_scheduled_date: string
  last_generated_at: string
  last_generated_entry_uuid: string
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
  return { account_uuid: '', amount: '', description: '', tiers_uuid: '', formula_type: 'fixed' }
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
    valid_from: '',
    valid_until: '',
    next_scheduled_date: '',
    last_generated_at: '',
    last_generated_entry_uuid: '',
    lines: [emptyLine(), emptyLine()],
  }
}

export function formulaTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case 'fixed': return t('journal.models.recurring.formulaType.fixed')
    case 'percentage': return t('journal.models.recurring.formulaType.percentage')
    case 'previous_period': return t('journal.models.recurring.formulaType.previousPeriod')
    case 'rounding_adjustment': return t('journal.models.recurring.formulaType.rounding')
    default: return type
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
        tiers_uuid: line.tiers_uuid ?? '',
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
    valid_from: model.valid_from ?? '',
    valid_until: model.valid_until ?? '',
    next_scheduled_date: model.next_scheduled_date ?? '',
    last_generated_at: model.last_generated_at ?? '',
    last_generated_entry_uuid: model.last_generated_entry_uuid ?? '',
    lines: model.lines.map((line) => {
      const debit = decimalOrZero(line.debit)
      const credit = decimalOrZero(line.credit)
      const amount = debit.greaterThan(0) ? debit : credit.negated()
      return {
        account_uuid: line.account_uuid,
        amount: amount.toFixed(2),
        description: line.description ?? '',
        tiers_uuid: line.tiers_uuid ?? '',
        formula_type: (line.formula_type as FormulaType | undefined) ?? 'fixed',
        formula_params: line.formula_params ?? undefined,
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
      tiers_uuid: line.tiers_uuid.trim() === '' ? null : line.tiers_uuid.trim(),
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
      tiers_uuid: line.tiers_uuid.trim() === '' ? null : line.tiers_uuid.trim(),
      formula_type: line.formula_type ?? 'fixed',
      formula_params: line.formula_params ?? null,
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
  if (state === ENTRY_STATE_POSTED) return 'badge-success'
  if (state === 3) return 'badge-destructive'
  return 'badge-warning'
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

/** Normalizes a free-typed amount filter (comma or dot decimal, optional sign) into
 * a canonical numeric string, or undefined if the input isn't a valid amount yet. */
export function normalizeAmountFilter(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const normalized = trimmed.replace(',', '.')
  return /^-?\d+(\.\d{1,4})?$/.test(normalized) ? normalized : undefined
}

// ---------------------------------------------------------------------------
// Shared primitive: LineEditor
// ---------------------------------------------------------------------------

export function LineEditor({
  title,
  lines,
  accounts,
  members,
  assets,
  onChange,
  onAdd,
  onRemove,
  disabled = false,
  t,
}: {
  title: string
  lines: LineFormState[]
  accounts: Array<{ uuid: string; code: string; name: string; require_id: number }>
  members: Array<{ uuid: string; account_id: string; first_name: string; last_name: string }>
  assets: Array<{ uuid: string; code: string; name: string }>
  onChange: (index: number, patch: Partial<LineFormState>) => void
  onAdd: () => void
  onRemove: (index: number) => void
  disabled?: boolean
  t: (key: string) => string
}) {
  const summary = totals(lines)
  const balanced = isBalanced(lines)

  const memberOptions = members
    .filter((m) => !m.account_id.startsWith('FO-'))
    .map((m) => ({ value: m.uuid, label: `${m.last_name} ${m.first_name}`.trim() }))

  const supplierOptions = members
    .filter((m) => m.account_id.startsWith('FO-'))
    .map((m) => ({ value: m.uuid, label: `${m.last_name} ${m.first_name} (${m.account_id})`.trim() }))

  const assetOptions = assets.map((a) => ({
    value: a.uuid,
    label: `${a.code} · ${a.name}`,
  }))

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="overflow-x-auto overflow-y-visible rounded-lg border bg-card">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.account')}</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.amount')}</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.models.recurring.formulaType.fixed').replace(' fixe', '')}</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.lineDescription')}</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.tiers')}</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('journal.forms.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line, index) => {
              const requireId = accounts.find((a) => a.uuid === line.account_uuid)?.require_id ?? 0
              return (
              <tr key={index}>
                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                  <select
                    value={line.account_uuid}
                    disabled={disabled}
                    onChange={(event) => onChange(index, { account_uuid: event.target.value, tiers_uuid: '' })}
                    className="h-9 w-48 min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
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
                    step="0.01"
                    value={line.amount}
                    disabled={disabled || line.formula_type === 'rounding_adjustment'}
                    onChange={(event) => onChange(index, { amount: event.target.value })}
                    placeholder={t('journal.forms.amountPlaceholder')}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={line.formula_type}
                    disabled={disabled}
                    onChange={(event) => onChange(index, { formula_type: event.target.value as FormulaType })}
                    className="h-9 w-36 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="fixed">{t('journal.models.recurring.formulaType.fixed')}</option>
                    <option value="percentage">{t('journal.models.recurring.formulaType.percentage')}</option>
                    <option value="previous_period">{t('journal.models.recurring.formulaType.previousPeriod')}</option>
                    <option value="rounding_adjustment">{t('journal.models.recurring.formulaType.rounding')}</option>
                  </select>
                  {line.formula_type === 'percentage' && (
                    <div className="mt-1 flex gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="%"
                        value={line.formula_params?.percentage ?? ''}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange(index, {
                            formula_params: {
                              ...line.formula_params,
                              percentage: Number(event.target.value),
                            },
                          })
                        }
                        className="w-20"
                      />
                      <Input
                        type="number"
                        step="1"
                        placeholder="#"
                        value={line.formula_params?.source_line_index ?? ''}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange(index, {
                            formula_params: {
                              ...line.formula_params,
                              source_line_index: Number(event.target.value),
                            },
                          })
                        }
                        className="w-16"
                      />
                    </div>
                  )}
                  {line.formula_type === 'previous_period' && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                          {t('journal.models.recurring.previousPeriodHint') || 'Montant basé sur la période précédente'}
                    </p>
                  )}
                  {line.formula_type === 'rounding_adjustment' && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t('journal.models.recurring.roundingHint') || "Calculé automatiquement pour équilibrer l'écriture"}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={line.description}
                    disabled={disabled}
                    onChange={(event) => onChange(index, { description: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  {requireId === 0 ? (
                    <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <SearchableSelect
                      value={line.tiers_uuid}
                      options={
                        requireId === 2 ? assetOptions
                        : requireId === 3 ? supplierOptions
                        : memberOptions
                      }
                      disabled={disabled}
                      clearable
                      clearLabel={t('journal.forms.clearTiers')}
                      onChange={(value) => onChange(index, { tiers_uuid: value })}
                      placeholder={t('journal.forms.selectTiers')}
                      searchPlaceholder={t('journal.forms.searchTiers')}
                      noResultsText={t('journal.forms.noTiersResults')}
                      className="w-48 min-w-[12rem]"
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onRemove(index)}>
                    {t('journal.forms.remove')}
                  </Button>
                </td>
              </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-muted text-xs text-muted-foreground">
            <tr>
              <td className="px-3 py-2 font-medium">{t('journal.forms.total')}</td>
              <td colSpan={2} className="px-3 py-2">
                <span className={`font-mono ${balanced ? 'text-success' : 'text-destructive'}`}>
                  {t('journal.forms.debit')}: {summary.debit} · {t('journal.forms.credit')}: {summary.credit}
                </span>
              </td>
              <td className={`px-3 py-2 font-medium ${balanced ? 'text-success' : 'text-destructive'}`} colSpan={2}>
                {balanced ? t('journal.forms.balanced') : t('journal.forms.unbalanced')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {/* FA-03: duplicate add-line button at bottom so it's reachable after many rows */}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onAdd}>
          {t('journal.forms.addLine')}
        </Button>
      </div>
    </div>
  )
}

