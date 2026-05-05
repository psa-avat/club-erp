/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Registration slide-over with checklist, fares, accounting preview, and committee assignment
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
import Decimal from 'decimal.js'
import { useTranslation } from 'react-i18next'

import { apiClient, getAuthRequestConfig } from '../../../api/client'
import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Dialog } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useCommitteesQuery,
  useCompleteRegistrationMutation,
  useReplaceCommitteeMembersMutation,
} from '../api'
import type { MemberDetail, MemberSummary } from '../types'
import {
  type AccountingEntryModel,
  useAccountingEntryModelsQuery,
  useCreateAccountingEntryMutation,
  useFiscalYearsQuery,
  usePricingVersionsQuery,
} from '../../banque/api'
import { usePricingItemsQuery } from '../../assets/api'
import type { PricingItem } from '../../assets/types'
import { toErrorMessage } from './membersShared'

type Props = {
  open: boolean
  onClose: () => void
  member: MemberDetail | null
  year: number
  onCompleted: (memberUuid: string) => void
}

const ACTIVE_VERSION_STATUS = 2

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function pricingItemTotal(items: PricingItem[], selected: string[]): string {
  const selectedSet = new Set(selected)
  const total = items.reduce((acc, item) => {
    if (!selectedSet.has(item.uuid)) return acc
    try {
      return acc.plus(new Decimal(item.base_price))
    } catch {
      return acc
    }
  }, new Decimal(0))
  return total.toFixed(2)
}

function unitLabel(unit: number): string {
  const map: Record<number, string> = {
    1: 'FlightTime',
    2: 'EngineTimeMin',
    3: 'EngineTime1/100h',
    4: 'FlightDuration',
    5: 'PerFlight',
    6: 'Fixed',
  }
  return map[unit] ?? `#${unit}`
}

type ChecklistState = 'valid' | 'pending'

function ChecklistChip({ state, t }: { state: ChecklistState; t: (key: string) => string }) {
  if (state === 'valid') {
    return (
      <span className="rounded-shape-full bg-tertiary-container px-2 py-0.5 text-xs font-medium text-on-tertiary-container">
        {t('registrationPanel.checklist.valid')}
      </span>
    )
  }

  return (
    <span className="rounded-shape-full bg-secondary-container px-2 py-0.5 text-xs font-medium text-on-secondary-container">
      {t('registrationPanel.checklist.required')}
    </span>
  )
}

export function RegistrationPanel({ open, onClose, member, year, onCompleted }: Props) {
  const { t } = useTranslation('members')

  const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [selectedPricingItemUuids, setSelectedPricingItemUuids] = useState<string[]>([])
  const [selectedCommitteeUuids, setSelectedCommitteeUuids] = useState<string[]>([])
  const [selectedTemplateUuid, setSelectedTemplateUuid] = useState('')
  const [notes, setNotes] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const fiscalYearsQuery = useFiscalYearsQuery(open)
  const fiscalYear = useMemo(
    () => (fiscalYearsQuery.data ?? []).find((fy) => fy.year === year) ?? null,
    [fiscalYearsQuery.data, year],
  )

  const pricingVersionsQuery = usePricingVersionsQuery(fiscalYear?.uuid ?? null, open)
  const activePricingVersion = useMemo(() => {
    const versions = pricingVersionsQuery.data ?? []
    return versions.find((version) => version.status === ACTIVE_VERSION_STATUS) ?? versions[0] ?? null
  }, [pricingVersionsQuery.data])

  const pricingItemsQuery = usePricingItemsQuery(activePricingVersion?.uuid ?? null, open)
  const accountingTemplatesQuery = useAccountingEntryModelsQuery(open)
  const committeesQuery = useCommitteesQuery(true)

  const completeRegistrationMutation = useCompleteRegistrationMutation()
  const replaceCommitteeMembersMutation = useReplaceCommitteeMembersMutation()
  const createAccountingEntryMutation = useCreateAccountingEntryMutation()

  useEffect(() => {
    if (!open) return

    setEffectiveDate(todayIso())
    setSelectedPricingItemUuids([])
    setSelectedTemplateUuid('')
    setNotes('')
    setLocalError(null)

    const assigned =
      member?.committees
        .filter((membership) => membership.membership_year === year)
        .map((membership) => membership.committee_uuid) ?? []

    setSelectedCommitteeUuids(assigned)
  }, [open, member, year])

  const pricingItems = pricingItemsQuery.data ?? []
  const committees = committeesQuery.data ?? []
  const templates = accountingTemplatesQuery.data ?? []

  const totalAmountDue = useMemo(
    () => pricingItemTotal(pricingItems, selectedPricingItemUuids),
    [pricingItems, selectedPricingItemUuids],
  )

  const canValidate = selectedPricingItemUuids.length > 0 && selectedCommitteeUuids.length > 0

  const combinedError =
    localError ??
    fiscalYearsQuery.error ??
    pricingVersionsQuery.error ??
    pricingItemsQuery.error ??
    accountingTemplatesQuery.error ??
    committeesQuery.error ??
    completeRegistrationMutation.error ??
    replaceCommitteeMembersMutation.error ??
    createAccountingEntryMutation.error

  const invoiceReference = member
    ? `REG-${year}-${member.account_id}-${effectiveDate.replaceAll('-', '')}`
    : `REG-${year}`

  const checklistProfileState: ChecklistState =
    member && member.first_name.trim() !== '' && member.last_name.trim() !== '' && (member.email ?? '').trim() !== ''
      ? 'valid'
      : 'pending'
  const checklistFfvpState: ChecklistState = member?.ffvp_id !== null ? 'valid' : 'pending'
  const checklistIdentityState: ChecklistState = member?.date_of_birth ? 'valid' : 'pending'

  function togglePricingItem(uuid: string, checked: boolean) {
    setSelectedPricingItemUuids((current) =>
      checked ? Array.from(new Set([...current, uuid])) : current.filter((itemUuid) => itemUuid !== uuid),
    )
  }

  function toggleCommittee(uuid: string) {
    setSelectedCommitteeUuids((current) =>
      current.includes(uuid) ? current.filter((committeeUuid) => committeeUuid !== uuid) : [...current, uuid],
    )
  }

  async function fetchCommitteeRoster(committeeUuid: string): Promise<string[]> {
    const { data } = await apiClient.get<MemberSummary[]>('/api/v1/members', {
      ...getAuthRequestConfig(),
      params: {
        committee_uuid: committeeUuid,
        year,
      },
    })
    return data.map((m) => m.uuid)
  }

  async function handleValidate() {
    if (!member) {
      setLocalError(t('sheet.selectMember'))
      return
    }

    if (!canValidate) {
      setLocalError(t('registrationPanel.actions.requiresSelection'))
      return
    }

    setLocalError(null)

    // 1. Sync committee memberships FIRST — the backend validates them before allowing registration.
    const before = new Set(
      member.committees
        .filter((membership) => membership.membership_year === year)
        .map((membership) => membership.committee_uuid),
    )
    const after = new Set(selectedCommitteeUuids)
    const impacted = new Set<string>([...Array.from(before), ...Array.from(after)])

    for (const committeeUuid of impacted) {
      const roster = new Set(await fetchCommitteeRoster(committeeUuid))
      if (after.has(committeeUuid)) {
        roster.add(member.uuid)
      } else {
        roster.delete(member.uuid)
      }
      await replaceCommitteeMembersMutation.mutateAsync({
        committeeUuid,
        year,
        payload: { member_uuids: Array.from(roster) },
      })
    }

    // 2. Complete registration (backend now finds the committee membership).
    await completeRegistrationMutation.mutateAsync({
      memberUuid: member.uuid,
      payload: {
        year,
        start_date: `${year}-01-01`,
        end_date: `${year}-12-31`,
        registration_type: member.member_category,
        accounting_template_uuid: selectedTemplateUuid || undefined,
        notes: notes.trim() || undefined,
        status: 1,
      },
    })

    // 3. If a template and fiscal year are selected, create a draft journal entry from the template.
    if (selectedTemplateUuid && fiscalYear) {
      const model = templates.find((tpl) => tpl.uuid === selectedTemplateUuid)
      if (model) {
        await createAccountingEntryMutation.mutateAsync({
          fiscal_year_uuid: fiscalYear.uuid,
          journal_uuid: model.journal_uuid,
          entry_date: effectiveDate,
          description: `${model.description ?? model.name} — ${member.first_name} ${member.last_name}`,
          reference: invoiceReference,
          lines: model.lines.map((line) => ({
            account_uuid: line.account_uuid,
            debit: line.debit,
            credit: line.credit,
            description: line.description ?? '',
            member_uuid: member.uuid,
            analytical_asset_uuid: line.analytical_asset_uuid ?? undefined,
          })),
        })
      }
    }

    onCompleted(member.uuid)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="registration-panel-title"
      className="ml-auto mr-0 flex h-[100vh] max-h-[100vh] max-w-6xl flex-col overflow-hidden rounded-none"
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-outline-variant px-6 py-4">
          <h2 id="registration-panel-title" className="text-lg font-semibold text-on-surface">
            {t('registrationPanel.title', { year })}
          </h2>
          {member ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
              <span>{member.first_name} {member.last_name}</span>
              <span>•</span>
              <span>{member.account_id}</span>
              <span>•</span>
              <span>{t('registrationPanel.memberSince', { year: member.first_subscription_year ?? '—' })}</span>
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">{t('sheet.selectMember')}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-on-surface">{t('registrationPanel.step1')}</h3>
                <div className="space-y-2 rounded-shape-md border border-outline-variant bg-surface-container p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-on-surface">{t('registrationPanel.checklist.profile')}</span>
                    <ChecklistChip state={checklistProfileState} t={t} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-on-surface">{t('registrationPanel.checklist.ffvp')}</span>
                    <ChecklistChip state={checklistFfvpState} t={t} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-on-surface">{t('registrationPanel.checklist.identity')}</span>
                    <ChecklistChip state={checklistIdentityState} t={t} />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-on-surface">{t('registrationPanel.step2')}</h3>
                  <span className="rounded-shape-full bg-primary-container px-3 py-1 text-xs font-medium text-on-primary-container">
                    {t('registrationPanel.fares.total', { amount: totalAmountDue })}
                  </span>
                </div>
                <div className="overflow-hidden rounded-shape-md border border-outline-variant">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container">
                      <tr className="text-left text-xs uppercase tracking-wide text-on-surface-variant">
                        <th className="px-3 py-2">{t('registrationPanel.fares.colDescription')}</th>
                        <th className="px-3 py-2">{t('registrationPanel.fares.colCategory')}</th>
                        <th className="px-3 py-2">{t('registrationPanel.fares.colAmount')}</th>
                        <th className="px-3 py-2 text-right">{t('registrationPanel.fares.colSelect')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricingItems.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-on-surface-variant" colSpan={4}>
                            {t('registrationPanel.fares.empty')}
                          </td>
                        </tr>
                      ) : (
                        pricingItems.map((item) => {
                          const checked = selectedPricingItemUuids.includes(item.uuid)
                          return (
                            <tr key={item.uuid} className="border-t border-outline-variant">
                              <td className="px-3 py-2 text-on-surface">{item.name}</td>
                              <td className="px-3 py-2 text-on-surface-variant">{unitLabel(item.unit)}</td>
                              <td className="px-3 py-2 text-on-surface">{item.base_price} €</td>
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => togglePricingItem(item.uuid, event.target.checked)}
                                  aria-label={t('registrationPanel.fares.selectAriaLabel', { name: item.name })}
                                />
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-on-surface">{t('registrationPanel.step4')}</h3>
                <p className="text-sm text-on-surface-variant">
                  {t('registrationPanel.committees.helper')}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {committees.map((committee) => {
                    const selected = selectedCommitteeUuids.includes(committee.uuid)
                    return (
                      <button
                        key={committee.uuid}
                        type="button"
                        onClick={() => toggleCommittee(committee.uuid)}
                        className={[
                          'rounded-shape-md border p-3 text-left transition-colors',
                          selected
                            ? 'border-primary bg-primary-container text-on-primary-container'
                            : 'border-outline-variant bg-surface hover:bg-surface-container',
                        ].join(' ')}
                      >
                        <p className="text-sm font-semibold">{committee.code}</p>
                        <p className="text-xs text-on-surface-variant">{committee.description}</p>
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>

            <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
              <h3 className="text-sm font-semibold text-on-surface">{t('registrationPanel.step3')}</h3>
              <div className="space-y-3 rounded-shape-md border border-outline-variant bg-surface p-3">
                <div className="space-y-2">
                  <Label htmlFor="registration-template">{t('registrationPanel.accounting.templateLabel')}</Label>
                  <select
                    id="registration-template"
                    value={selectedTemplateUuid}
                    onChange={(event) => setSelectedTemplateUuid(event.target.value)}
                    className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
                  >
                    <option value="">{t('registrationWizard.templatePlaceholder')}</option>
                    {templates.map((template: AccountingEntryModel) => (
                      <option key={template.uuid} value={template.uuid}>
                        {template.code} · {template.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="registration-notes">{t('registrationPanel.accounting.notes')}</Label>
                  <Input
                    id="registration-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder={t('registrationPeriod.notes')}
                  />
                </div>

                <div className="overflow-hidden rounded-shape-md border border-outline-variant">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-container">
                        <tr className="text-left text-xs uppercase tracking-wide text-on-surface-variant">
                          <th className="px-3 py-2">{t('registrationPanel.accounting.colAccount')}</th>
                          <th className="px-3 py-2 text-right">{t('registrationPanel.accounting.colDebit')}</th>
                          <th className="px-3 py-2 text-right">{t('registrationPanel.accounting.colCredit')}</th>
                        </tr>
                      </thead>
                      <tbody>
                      <tr className="border-t border-outline-variant">
                        <td className="px-3 py-2 text-on-surface">
                          {t('registrationPanel.accounting.memberAccount', { accountId: member?.account_id ?? '—' })}
                        </td>
                        <td className="px-3 py-2 text-right text-on-surface">{totalAmountDue}</td>
                        <td className="px-3 py-2 text-right text-on-surface">0.00</td>
                      </tr>
                      {pricingItems
                        .filter((item) => selectedPricingItemUuids.includes(item.uuid))
                        .map((item) => (
                          <tr key={`gl-${item.uuid}`} className="border-t border-outline-variant">
                            <td className="px-3 py-2 text-on-surface">
                              {t('registrationPanel.accounting.product', {
                                ref: item.gl_account_credit_uuid
                                  ? item.gl_account_credit_uuid.slice(0, 8)
                                  : t('registrationPanel.accounting.undefinedAccount'),
                              })}
                            </td>
                            <td className="px-3 py-2 text-right text-on-surface">0.00</td>
                            <td className="px-3 py-2 text-right text-on-surface">{item.base_price}</td>
                          </tr>
                        ))}
                    </tbody>
                    </table>
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant">
                  {t('registrationPanel.accounting.invoiceRef', { ref: invoiceReference })}
                </p>
              </div>
            </aside>
          </div>

          {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}
        </div>

        <div className="border-t border-outline-variant px-6 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-2">
              <Label htmlFor="registration-effective-date">{t('registrationPanel.accounting.effectiveDate')}</Label>
              <Input
                id="registration-effective-date"
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('registrationPanel.actions.cancel')}
              </Button>
              <Button
                type="button"
                disabled={!canValidate || completeRegistrationMutation.isPending || replaceCommitteeMembersMutation.isPending}
                onClick={handleValidate}
              >
                {completeRegistrationMutation.isPending || replaceCommitteeMembersMutation.isPending
                  ? t('registrationPanel.actions.validating')
                  : t('registrationPanel.actions.validate')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
