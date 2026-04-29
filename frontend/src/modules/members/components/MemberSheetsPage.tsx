/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Member flight sheets — mobile-first layout for field access
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

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import {
  useDisableExpenseAccessMutation,
  useEnableExpenseAccessMutation,
  useMemberQuery,
  useMembersQuery,
  useMemberSheetsQuery,
  useUpsertMemberSheetMutation,
} from '../api'
import { useMembersStore } from '../store'
import {
  CheckboxField,
  Pill,
  SelectField,
  TextField,
  buildSheetPayload,
  createSheetForm,
  toErrorMessage,
  type SheetFormState,
} from './membersShared'
import { ClubPageShell } from './ClubPageShell'

export function MemberSheetsPage() {
  const { t } = useTranslation('members')
  const { selectedMemberId, setSelectedMemberId, selectedYear, filters } = useMembersStore()

  const [sheetForm, setSheetForm] = useState<SheetFormState>(() => createSheetForm())
  const [expenseToken, setExpenseToken] = useState<string | null>(null)
  // Mobile UX: list vs form view
  const [mobileView, setMobileView] = useState<'list' | 'form'>('list')

  const membersQuery = useMembersQuery(filters)
  const memberDetailQuery = useMemberQuery(selectedMemberId)
  const memberSheetsQuery = useMemberSheetsQuery(selectedMemberId)
  const upsertMemberSheetMutation = useUpsertMemberSheetMutation()
  const enableExpenseAccessMutation = useEnableExpenseAccessMutation()
  const disableExpenseAccessMutation = useDisableExpenseAccessMutation()

  const members = membersQuery.data ?? []
  const selectedMember = memberDetailQuery.data ?? null
  const sheets = memberSheetsQuery.data ?? []
  const selectedYearSheet = sheets.find((sheet) => sheet.year === selectedYear) ?? null

  useEffect(() => {
    setSheetForm(createSheetForm(selectedYearSheet))
    setExpenseToken(null)
  }, [selectedYearSheet])

  function handleSelectMember(uuid: string) {
    setSelectedMemberId(uuid)
    setMobileView('form')
  }

  function handleBackToList() {
    setMobileView('list')
  }

  async function handleSheetSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedMemberId) return
    const updatedSheet = await upsertMemberSheetMutation.mutateAsync({
      memberUuid: selectedMemberId,
      year: selectedYear,
      payload: buildSheetPayload(sheetForm),
    })
    setSheetForm(createSheetForm(updatedSheet))
  }

  async function handleEnableExpenseAccess() {
    if (!selectedMemberId) return
    const response = await enableExpenseAccessMutation.mutateAsync({
      memberUuid: selectedMemberId,
      year: selectedYear,
    })
    setExpenseToken(response.generated_token)
  }

  async function handleDisableExpenseAccess() {
    if (!selectedMemberId) return
    await disableExpenseAccessMutation.mutateAsync({
      memberUuid: selectedMemberId,
      year: selectedYear,
    })
    setExpenseToken(null)
  }

  const combinedError =
    membersQuery.error ??
    memberDetailQuery.error ??
    memberSheetsQuery.error ??
    upsertMemberSheetMutation.error ??
    enableExpenseAccessMutation.error ??
    disableExpenseAccessMutation.error

  return (
    <ClubPageShell>
      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      {expenseToken ? (
        <Alert>
          {t('sheet.generatedToken')}: <span className="font-mono">{expenseToken}</span>
        </Alert>
      ) : null}

      {/* Mobile: back button when viewing form */}
      {mobileView === 'form' && selectedMemberId ? (
        <div className="md:hidden">
          <button
            type="button"
            className="text-sm text-on-surface-variant hover:text-on-surface"
            onClick={handleBackToList}
          >
            ← {t('sheet.backToList')}
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[1.1fr,1fr]">
        {/* Member picker — hidden on mobile when form is shown */}
        <div className={mobileView === 'form' ? 'hidden md:block' : ''}>
          <div className="rounded-shape-lg border border-outline-variant bg-surface shadow-surface-1">
            <div className="border-b border-outline-variant px-4 py-3">
              <h2 className="font-semibold text-on-surface">{t('list.title')}</h2>
              <p className="text-sm text-on-surface-variant">{t('sheet.pickMember')}</p>
            </div>
            <div className="p-3">
              {membersQuery.isLoading ? (
                <p className="px-2 py-4 text-sm text-on-surface-variant">{t('states.loading')}</p>
              ) : null}
              <div className="space-y-2">
                {members.map((member) => (
                  <button
                    key={member.uuid}
                    className={[
                      'w-full rounded-shape-md border px-4 py-3 text-left transition-colors',
                      selectedMemberId === member.uuid
                        ? 'border-primary bg-primary-container'
                        : 'border-outline-variant bg-surface hover:border-outline hover:bg-surface-variant',
                    ].join(' ')}
                    type="button"
                    onClick={() => handleSelectMember(member.uuid)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-on-surface">
                          {member.first_name} {member.last_name}
                        </p>
                        <p className="text-xs uppercase tracking-wide text-on-surface-variant">
                          {member.account_id}
                        </p>
                      </div>
                      <Pill active={member.can_fly}>{t('list.canFly')}</Pill>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Sheet form — hidden on mobile when list is shown */}
        <div className={mobileView === 'list' ? 'hidden md:block' : ''}>
          <div className="rounded-shape-lg border border-outline-variant bg-surface shadow-surface-1">
            <div className="border-b border-outline-variant px-4 py-3">
              <h2 className="font-semibold text-on-surface">
                {selectedMember
                  ? `${selectedMember.first_name} ${selectedMember.last_name}`
                  : t('sheet.title')}
              </h2>
              <p className="text-sm text-on-surface-variant">{t('sheet.description')}</p>
            </div>
            <div className="p-4">
              {!selectedMemberId ? (
                <p className="text-sm text-on-surface-variant">{t('sheet.selectMember')}</p>
              ) : !selectedMember?.can_fly ? (
                <p className="text-sm text-on-surface-variant">{t('sheet.notEligible')}</p>
              ) : (
                <form className="space-y-4" onSubmit={handleSheetSubmit}>
                  <TextField
                    id="sheet-licence-number"
                    label={t('sheet.licenceNumber')}
                    value={sheetForm.licence_number}
                    onChange={(value) => setSheetForm({ ...sheetForm, licence_number: value })}
                  />
                  <SelectField
                    id="sheet-fare-type"
                    label={t('sheet.fareType')}
                    options={[
                      { value: '1', label: t('fare.standard') },
                      { value: '2', label: t('fare.student') },
                      { value: '3', label: t('fare.discovery') },
                      { value: '4', label: t('fare.pack') },
                      { value: '5', label: t('fare.other') },
                    ]}
                    value={sheetForm.fare_type}
                    onChange={(value) => setSheetForm({ ...sheetForm, fare_type: value })}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      id="sheet-hours-count"
                      label={t('sheet.hoursCount')}
                      value={sheetForm.hours_count}
                      onChange={(value) => setSheetForm({ ...sheetForm, hours_count: value })}
                    />
                    <TextField
                      id="sheet-packs-bought"
                      label={t('sheet.packsBought')}
                      type="number"
                      value={sheetForm.packs_bought_count}
                      onChange={(value) => setSheetForm({ ...sheetForm, packs_bought_count: value })}
                    />
                    <TextField
                      id="sheet-hours-in-pack"
                      label={t('sheet.hoursInPack')}
                      value={sheetForm.hours_done_in_pack}
                      onChange={(value) => setSheetForm({ ...sheetForm, hours_done_in_pack: value })}
                    />
                    <TextField
                      id="sheet-remaining-hours"
                      label={t('sheet.remainingHours')}
                      value={sheetForm.remaining_hours_in_pack}
                      onChange={(value) =>
                        setSheetForm({ ...sheetForm, remaining_hours_in_pack: value })
                      }
                    />
                  </div>
                  <CheckboxField
                    label={t('sheet.expenseAccessEnabled')}
                    checked={sheetForm.expense_access_enabled}
                    onChange={(checked) =>
                      setSheetForm({ ...sheetForm, expense_access_enabled: checked })
                    }
                  />
                  {/* Actions — full width on mobile */}
                  <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap">
                    <Button className="w-full sm:w-auto" disabled={upsertMemberSheetMutation.isPending} type="submit">
                      {t('actions.saveSheet')}
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={!selectedYearSheet || enableExpenseAccessMutation.isPending}
                      type="button"
                      variant="secondary"
                      onClick={handleEnableExpenseAccess}
                    >
                      {t('actions.enableExpenseAccess')}
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={!selectedYearSheet || disableExpenseAccessMutation.isPending}
                      type="button"
                      variant="ghost"
                      onClick={handleDisableExpenseAccess}
                    >
                      {t('actions.disableExpenseAccess')}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </ClubPageShell>
  )
}
