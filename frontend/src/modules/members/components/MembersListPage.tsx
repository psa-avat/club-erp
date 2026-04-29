/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Members list + filter + create/edit form
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { ImportDialog } from '../../../components/ui/ImportDialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useCompleteRegistrationMutation,
  useCreateMemberMutation,
  useImportMembersMutation,
  useMemberQuery,
  useMembersQuery,
  useUpdateMemberMutation,
} from '../api'
import { useMembersStore } from '../store'
import type { UpdateMemberPayload } from '../types'
import {
  CheckboxField,
  Pill,
  SelectField,
  TextField,
  buildMemberPayload,
  createEmptyMemberForm,
  mapMemberToForm,
  memberCategoryLabel,
  toErrorMessage,
  type MemberFormState,
} from './membersShared'
import { ClubPageShell } from './ClubPageShell'

export function MembersListPage() {
  const { t } = useTranslation('members')
  const { t: tCommon } = useTranslation('common')
  const { selectedMemberId, setSelectedMemberId, selectedYear, filters, setFilters } = useMembersStore()

  const [memberForm, setMemberForm] = useState<MemberFormState>(() => createEmptyMemberForm())
  const [showImportDialog, setShowImportDialog] = useState(false)

  const membersQuery = useMembersQuery(filters)
  const memberDetailQuery = useMemberQuery(selectedMemberId)
  const createMemberMutation = useCreateMemberMutation()
  const updateMemberMutation = useUpdateMemberMutation()
  const completeRegistrationMutation = useCompleteRegistrationMutation()
  const importMembersMutation = useImportMembersMutation()

  const members = membersQuery.data ?? []
  const selectedMember = memberDetailQuery.data ?? null

  useEffect(() => {
    if (selectedMember) {
      setMemberForm(mapMemberToForm(selectedMember))
    } else {
      setMemberForm(createEmptyMemberForm())
    }
  }, [selectedMember])

  function handleNewMember() {
    setSelectedMemberId(null)
    setMemberForm(createEmptyMemberForm())
  }

  async function handleMemberSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = buildMemberPayload(memberForm)

    if (selectedMemberId) {
      const updated = await updateMemberMutation.mutateAsync({
        memberUuid: selectedMemberId,
        payload: payload as UpdateMemberPayload,
      })
      setSelectedMemberId(updated.uuid)
      return
    }

    const created = await createMemberMutation.mutateAsync(payload)
    setSelectedMemberId(created.uuid)
  }

  async function handleCompleteRegistrationFromList(memberUuid: string, memberCategory: number) {
    const completed = await completeRegistrationMutation.mutateAsync({
      memberUuid,
      payload: {
        year: selectedYear,
        start_date: `${selectedYear}-01-01`,
        end_date: `${selectedYear}-12-31`,
        registration_type: memberCategory,
        status: 1,
      },
    })
    setSelectedMemberId(completed.uuid)
  }

  const combinedError =
    membersQuery.error ??
    memberDetailQuery.error ??
    createMemberMutation.error ??
    updateMemberMutation.error ??
    completeRegistrationMutation.error

  return (
    <ClubPageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleNewMember}>
            {t('actions.newMember')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setShowImportDialog(true)}>
            {tCommon('import.button')}
          </Button>
        </div>
      </div>

      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('filters.title')}</CardTitle>
          <CardDescription>{t('filters.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="members-search">{t('filters.search')}</Label>
            <Input
              id="members-search"
              placeholder={t('filters.searchPlaceholder')}
              value={filters.search ?? ''}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>
          <SelectField
            id="members-category-filter"
            label={t('filters.category')}
            options={[
              { value: '', label: t('filters.all') },
              { value: '1', label: t('categories.full') },
              { value: '2', label: t('categories.temporary') },
              { value: '3', label: t('categories.nonFlying') },
              { value: '4', label: t('categories.shortPeriod') },
              { value: '5', label: t('categories.externalPilot') },
              { value: '6', label: t('categories.volunteer') },
            ]}
            value={filters.member_category ? String(filters.member_category) : ''}
            onChange={(value) =>
              setFilters({ ...filters, member_category: value ? Number(value) : undefined })
            }
          />
          <SelectField
            id="members-status-filter"
            label={t('filters.status')}
            options={[
              { value: '', label: t('filters.all') },
              { value: '1', label: t('statuses.active') },
              { value: '2', label: t('statuses.suspended') },
              { value: '3', label: t('statuses.resigned') },
              { value: '4', label: t('statuses.anonymized') },
            ]}
            value={filters.status ? String(filters.status) : ''}
            onChange={(value) =>
              setFilters({ ...filters, status: value ? Number(value) : undefined })
            }
          />
          <SelectField
            id="members-can-fly-filter"
            label={t('filters.canFly')}
            options={[
              { value: '', label: t('filters.all') },
              { value: 'true', label: t('filters.onlyFlying') },
              { value: 'false', label: t('filters.onlyGround') },
            ]}
            value={filters.can_fly === undefined ? '' : String(filters.can_fly)}
            onChange={(value) =>
              setFilters({ ...filters, can_fly: value ? value === 'true' : undefined })
            }
          />
          <SelectField
            id="members-registration-state-filter"
            label={t('filters.registration')}
            options={[
              { value: '', label: t('filters.all') },
              { value: 'registered', label: t('filters.registered') },
              { value: 'unregistered', label: t('filters.unregistered') },
            ]}
            value={filters.registration_state ?? ''}
            onChange={(value) =>
              setFilters({
                ...filters,
                registration_state: value ? (value as 'registered' | 'unregistered') : undefined,
              })
            }
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr,1.6fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('list.title')}</CardTitle>
            <CardDescription>{t('list.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {membersQuery.isLoading ? (
              <p className="text-sm text-on-surface-variant">{t('states.loading')}</p>
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
                  onClick={() => setSelectedMemberId(member.uuid)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-on-surface">
                        {member.first_name} {member.last_name}
                      </p>
                      <p className="text-xs uppercase tracking-wide text-on-surface-variant">
                        {member.account_id}
                      </p>
                    </div>
                    <span className="rounded-full bg-surface-container px-2 py-1 text-xs font-medium text-on-surface-variant">
                      {memberCategoryLabel(member.member_category)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <Pill active={member.is_registered_for_year}>{t('list.registered')}</Pill>
                    <Pill active={member.can_fly}>{t('list.canFly')}</Pill>
                    <Pill active={member.is_instructor}>{t('flags.instructor')}</Pill>
                    <Pill active={member.is_employee}>{t('flags.employee')}</Pill>
                    <Pill active={member.is_executive}>{t('flags.executive')}</Pill>
                    <Pill active={member.is_board_member}>{t('flags.board')}</Pill>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-on-surface-variant">
                    <span>
                      {t('list.committees')}: {member.committee_count}
                    </span>
                    <span>{member.is_active ? t('statuses.active') : t('states.inactive')}</span>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      type="button"
                      disabled={completeRegistrationMutation.isPending}
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleCompleteRegistrationFromList(member.uuid, member.member_category)
                      }}
                    >
                      {t('actions.completeRegistration')}
                    </Button>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selectedMemberId ? t('form.editTitle') : t('form.createTitle')}</CardTitle>
            <CardDescription>{t('form.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleMemberSubmit}>
              <SelectField
                id="member-genre"
                label={t('form.genre')}
                options={[
                  { value: '0', label: t('genres.unspecified') },
                  { value: '1', label: t('genres.male') },
                  { value: '2', label: t('genres.female') },
                  { value: '3', label: t('genres.other') },
                ]}
                value={memberForm.genre}
                onChange={(value) => setMemberForm({ ...memberForm, genre: value })}
              />
              <SelectField
                id="member-category"
                label={t('form.category')}
                options={[
                  { value: '1', label: t('categories.full') },
                  { value: '2', label: t('categories.temporary') },
                  { value: '3', label: t('categories.nonFlying') },
                  { value: '4', label: t('categories.shortPeriod') },
                  { value: '5', label: t('categories.externalPilot') },
                  { value: '6', label: t('categories.volunteer') },
                ]}
                value={memberForm.member_category}
                onChange={(value) => setMemberForm({ ...memberForm, member_category: value })}
              />
              <TextField
                id="member-first-name"
                label={t('form.firstName')}
                value={memberForm.first_name}
                onChange={(value) => setMemberForm({ ...memberForm, first_name: value })}
              />
              <TextField
                id="member-last-name"
                label={t('form.lastName')}
                value={memberForm.last_name}
                onChange={(value) => setMemberForm({ ...memberForm, last_name: value })}
              />
              <TextField
                id="member-email"
                label={t('form.email')}
                type="email"
                value={memberForm.email}
                onChange={(value) => setMemberForm({ ...memberForm, email: value })}
              />
              <TextField
                id="member-phone"
                label={t('form.phone')}
                value={memberForm.phone}
                onChange={(value) => setMemberForm({ ...memberForm, phone: value })}
              />
              <TextField
                id="member-birthdate"
                label={t('form.birthDate')}
                type="date"
                value={memberForm.date_of_birth}
                onChange={(value) => setMemberForm({ ...memberForm, date_of_birth: value })}
              />
              <TextField
                id="member-account-id"
                label={t('form.accountId')}
                value={memberForm.account_id}
                onChange={(value) => setMemberForm({ ...memberForm, account_id: value.toUpperCase() })}
              />
              <TextField
                id="member-seniority"
                label={t('form.seniority')}
                type="number"
                value={memberForm.seniority}
                onChange={(value) => setMemberForm({ ...memberForm, seniority: value })}
              />
              <TextField
                id="member-ffvp"
                label={t('form.ffvp')}
                type="number"
                value={memberForm.ffvp_id}
                onChange={(value) => setMemberForm({ ...memberForm, ffvp_id: value })}
              />
              <TextField
                id="member-photo-url"
                label={t('form.photoUrl')}
                value={memberForm.photo_url}
                onChange={(value) => setMemberForm({ ...memberForm, photo_url: value })}
              />
              <SelectField
                id="member-status"
                label={t('form.status')}
                options={[
                  { value: '1', label: t('statuses.active') },
                  { value: '2', label: t('statuses.suspended') },
                  { value: '3', label: t('statuses.resigned') },
                  { value: '4', label: t('statuses.anonymized') },
                ]}
                value={memberForm.status}
                onChange={(value) => setMemberForm({ ...memberForm, status: value })}
              />
              <SelectField
                id="member-registration-status"
                label={t('form.registrationStatus')}
                options={[
                  { value: '1', label: t('registration.draft') },
                  { value: '2', label: t('registration.inProgress') },
                  { value: '3', label: t('registration.completed') },
                  { value: '4', label: t('registration.archived') },
                ]}
                value={memberForm.registration_status}
                onChange={(value) => setMemberForm({ ...memberForm, registration_status: value })}
              />
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="member-notes">{t('form.notes')}</Label>
                <textarea
                  id="member-notes"
                  className="min-h-28 w-full rounded-shape-sm border border-outline bg-surface px-3 py-2 text-sm text-on-surface shadow-sm outline-none focus:border-primary"
                  value={memberForm.notes}
                  onChange={(event) => setMemberForm({ ...memberForm, notes: event.target.value })}
                />
              </div>
              <div className="grid gap-2 rounded-shape-md border border-outline-variant bg-surface-variant p-4 md:col-span-2 md:grid-cols-3">
                <CheckboxField
                  label={t('form.active')}
                  checked={memberForm.is_active}
                  disabled
                  onChange={() => {}}
                />
                <CheckboxField
                  label={t('form.canFly')}
                  checked={memberForm.can_fly}
                  onChange={(checked) => setMemberForm({ ...memberForm, can_fly: checked })}
                />
                <CheckboxField
                  label={t('form.externalAuth')}
                  checked={memberForm.external_auth_enabled}
                  onChange={(checked) => setMemberForm({ ...memberForm, external_auth_enabled: checked })}
                />
                <CheckboxField
                  label={t('flags.instructor')}
                  checked={memberForm.is_instructor}
                  onChange={(checked) => setMemberForm({ ...memberForm, is_instructor: checked })}
                />
                <CheckboxField
                  label={t('flags.employee')}
                  checked={memberForm.is_employee}
                  onChange={(checked) => setMemberForm({ ...memberForm, is_employee: checked })}
                />
                <CheckboxField
                  label={t('flags.executive')}
                  checked={memberForm.is_executive}
                  onChange={(checked) => setMemberForm({ ...memberForm, is_executive: checked })}
                />
                <CheckboxField
                  label={t('flags.board')}
                  checked={memberForm.is_board_member}
                  onChange={(checked) => setMemberForm({ ...memberForm, is_board_member: checked })}
                />
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button
                  disabled={createMemberMutation.isPending || updateMemberMutation.isPending}
                  type="submit"
                >
                  {selectedMemberId ? t('actions.saveChanges') : t('actions.createMember')}
                </Button>
                <Button type="button" variant="ghost" onClick={handleNewMember}>
                  {t('actions.reset')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {showImportDialog ? (
        <ImportDialog
          title={tCommon('import.button')}
          onUpload={(file) => importMembersMutation.mutateAsync(file)}
          sampleCsvHref="/samples/members-sample.csv"
          onClose={() => setShowImportDialog(false)}
        />
      ) : null}
    </ClubPageShell>
  )
}
