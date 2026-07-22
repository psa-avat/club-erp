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

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useCommitteesQuery,
  useCompleteRegistrationMutation,
  useUpdateMemberRegistrationMutation,
} from '../api'
import type { MemberDetail } from '../types'
import {
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
  allowWorkflow: boolean
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
    7: 'FixedDurationTranche',
  }
  return map[unit] ?? `#${unit}`
}

type ChecklistState = 'valid' | 'pending'

function ChecklistChip({ state, t }: { state: ChecklistState; t: (key: string) => string }) {
  if (state === 'valid') {
    return (
      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
        {t('registrationPanel.checklist.valid')}
      </span>
    )
  }

  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
      {t('registrationPanel.checklist.required')}
    </span>
  )
}

export function RegistrationPanel({ open, onClose, member, year, allowWorkflow, onCompleted }: Props) {
  const { t } = useTranslation('members')

  const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [selectedPricingItemUuids, setSelectedPricingItemUuids] = useState<string[]>([])
  const [selectedCommitteeUuids, setSelectedCommitteeUuids] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const fiscalYearsQuery = useFiscalYearsQuery(open)
  const pricingVersionsQuery = usePricingVersionsQuery(open)
  const activePricingVersion = useMemo(() => {
    const versions = pricingVersionsQuery.data ?? []
    return versions.find((version) => version.status === ACTIVE_VERSION_STATUS) ?? versions[0] ?? null
  }, [pricingVersionsQuery.data])

  const pricingItemsQuery = usePricingItemsQuery(activePricingVersion?.uuid ?? null, open)
  const committeesQuery = useCommitteesQuery(true)

  const completeRegistrationMutation = useCompleteRegistrationMutation()
  const updateRegistrationMutation = useUpdateMemberRegistrationMutation()

  useEffect(() => {
    if (!open) return

    setEffectiveDate(todayIso())
    setSelectedPricingItemUuids([])
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
    committeesQuery.error ??
    completeRegistrationMutation.error ??
    updateRegistrationMutation.error

  const invoiceReference = member
    ? `REG-${year}-${member.account_id}-${effectiveDate.replaceAll('-', '')}`
    : `REG-${year}`

  const currentYearRegistration = useMemo(() => {
    if (!member) return null
    return member.registrations.find((registration) => registration.registered_for_year === year) ?? null
  }, [member, year])

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

  async function handleValidate() {
    if (!allowWorkflow) {
      setLocalError('Registration workflow is disabled for this screen.')
      return
    }

    if (!member) {
      setLocalError(t('sheet.selectMember'))
      return
    }

    if (currentYearRegistration?.status === 1) {
      setLocalError(`Le membre est deja inscrit pour ${year}.`)
      return
    }

    if (!canValidate) {
      setLocalError(t('registrationPanel.actions.requiresSelection'))
      return
    }

    setLocalError(null)

    // Complete registration, attach selected committee memberships, and create
    // the draft accounting entry from selected pricing items on the backend.
    await completeRegistrationMutation.mutateAsync({
      memberUuid: member.uuid,
      payload: {
        year,
        start_date: `${year}-01-01`,
        end_date: `${year}-12-31`,
        registration_type: member.member_category,
        pricing_item_uuids: selectedPricingItemUuids,
        accounting_entry_date: effectiveDate,
        committee_uuids: selectedCommitteeUuids,
        notes: notes.trim() || undefined,
        status: 1,
      },
    })

    onCompleted(member.uuid)
  }

  async function handleToggleCurrentYearRegistration() {
    if (!member || !currentYearRegistration) return

    setLocalError(null)

    await updateRegistrationMutation.mutateAsync({
      memberUuid: member.uuid,
      registrationUuid: currentYearRegistration.uuid,
      payload: {
        status: currentYearRegistration.status === 1 ? 2 : 1,
      },
    })
  }

  const isCurrentYearRegistrationActive = currentYearRegistration?.status === 1

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('registrationPanel.title', { year })}</DialogTitle>
          {member ? (
            <DialogDescription>
              {member.first_name} {member.last_name} • {member.account_id} • {t('registrationPanel.memberSince', { year: member.first_subscription_year ?? '—' })}
            </DialogDescription>
          ) : (
            <DialogDescription>{t('sheet.selectMember')}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">{t('registrationPanel.step1')}</h3>
                <div className="space-y-2 rounded-md border border-border bg-muted p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground">{t('registrationPanel.checklist.profile')}</span>
                    <ChecklistChip state={checklistProfileState} t={t} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground">{t('registrationPanel.checklist.ffvp')}</span>
                    <ChecklistChip state={checklistFfvpState} t={t} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground">{t('registrationPanel.checklist.identity')}</span>
                    <ChecklistChip state={checklistIdentityState} t={t} />
                  </div>
                </div>
              </section>

              {currentYearRegistration ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted p-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {t('registrationPanel.currentYear.title', { year })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('registrationPanel.currentYear.statusLabel', {
                          status:
                            currentYearRegistration.status === 1
                              ? t('registrationPeriod.active')
                              : currentYearRegistration.status === 2
                                ? t('registrationPeriod.cancelled')
                                : t('registrationPeriod.superseded'),
                        })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant={isCurrentYearRegistrationActive ? 'secondary' : 'default'}
                      disabled={updateRegistrationMutation.isPending}
                      onClick={handleToggleCurrentYearRegistration}
                    >
                      {updateRegistrationMutation.isPending
                        ? t('registrationPanel.currentYear.updating')
                        : isCurrentYearRegistrationActive
                          ? t('registrationPanel.currentYear.revokeAction')
                          : t('registrationPanel.currentYear.reactivateAction')}
                    </Button>
                  </div>
                </section>
              ) : null}

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{t('registrationPanel.step2')}</h3>
                  <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                    {t('registrationPanel.fares.total', { amount: totalAmountDue })}
                  </span>
                </div>
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2">{t('registrationPanel.fares.colDescription')}</th>
                        <th className="px-3 py-2">{t('registrationPanel.fares.colCategory')}</th>
                        <th className="px-3 py-2">{t('registrationPanel.fares.colAmount')}</th>
                        <th className="px-3 py-2 text-right">{t('registrationPanel.fares.colSelect')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricingItems.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                            {t('registrationPanel.fares.empty')}
                          </td>
                        </tr>
                      ) : (
                        pricingItems.map((item) => {
                          const checked = selectedPricingItemUuids.includes(item.uuid)
                          return (
                            <tr key={item.uuid} className="border-t border-border">
                              <td className="px-3 py-2 text-foreground">{item.name}</td>
                              <td className="px-3 py-2 text-muted-foreground">{unitLabel(item.unit)}</td>
                              <td className="px-3 py-2 text-foreground">{item.base_price} €</td>
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
                <h3 className="text-sm font-semibold text-foreground">{t('registrationPanel.step4')}</h3>
                <p className="text-sm text-muted-foreground">
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
                        disabled={completeRegistrationMutation.isPending}
                        className={[
                          'rounded-md border p-3 text-left transition-colors',
                          selected
                            ? 'border-primary bg-primary/15 text-primary'
                            : 'border-border bg-card hover:bg-muted',
                        ].join(' ')}
                      >
                        <p className="text-sm font-semibold">{committee.code}</p>
                        <p className="text-xs text-muted-foreground">{committee.description}</p>
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>

            <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
              <h3 className="text-sm font-semibold text-foreground">{t('registrationPanel.step3')}</h3>
              <div className="space-y-3 rounded-md border border-border bg-card p-3">
                <div className="space-y-2">
                  <Label htmlFor="registration-notes">{t('registrationPanel.accounting.notes')}</Label>
                  <Input
                    id="registration-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder={t('registrationPeriod.notes')}
                  />
                </div>

                <div className="overflow-hidden rounded-md border border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2">{t('registrationPanel.accounting.colAccount')}</th>
                          <th className="px-3 py-2 text-right">{t('registrationPanel.accounting.colDebit')}</th>
                          <th className="px-3 py-2 text-right">{t('registrationPanel.accounting.colCredit')}</th>
                        </tr>
                      </thead>
                      <tbody>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-foreground">
                          {t('registrationPanel.accounting.memberAccount', { accountId: member?.account_id ?? '—' })}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">{totalAmountDue}</td>
                        <td className="px-3 py-2 text-right text-foreground">0.00</td>
                      </tr>
                      {pricingItems
                        .filter((item) => selectedPricingItemUuids.includes(item.uuid))
                        .map((item) => (
                          <tr key={`gl-${item.uuid}`} className="border-t border-border">
                            <td className="px-3 py-2 text-foreground">
                              {t('registrationPanel.accounting.product', {
                                ref: item.gl_account_credit_uuid
                                  ? item.gl_account_credit_uuid.slice(0, 8)
                                  : t('registrationPanel.accounting.undefinedAccount'),
                              })}
                            </td>
                            <td className="px-3 py-2 text-right text-foreground">0.00</td>
                            <td className="px-3 py-2 text-right text-foreground">{item.base_price}</td>
                          </tr>
                        ))}
                    </tbody>
                    </table>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('registrationPanel.accounting.invoiceRef', { ref: invoiceReference })}
                </p>
              </div>
            </aside>
          </div>

          {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-4">
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
              disabled={!allowWorkflow || !canValidate || completeRegistrationMutation.isPending}
              onClick={handleValidate}
            >
              {!allowWorkflow
                ? 'Disabled for this screen'
                : completeRegistrationMutation.isPending
                ? t('registrationPanel.actions.validating')
                : t('registrationPanel.actions.validate')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
