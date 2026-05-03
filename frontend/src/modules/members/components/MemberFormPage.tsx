/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Dedicated member create/edit page with two-column profile and privileges layout
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
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { PageHeader } from '../../../components/ui/page-header'
import { useCreateMemberMutation, useMemberQuery, useUpdateMemberMutation } from '../api'
import { useMembersStore } from '../store'
import type { UpdateMemberPayload } from '../types'
import {
  CheckboxField,
  SelectField,
  TextField,
  buildMemberCreatePayload,
  buildMemberUpdatePayload,
  createEmptyMemberForm,
  mapMemberToForm,
  toErrorMessage,
  type MemberFormState,
} from './membersShared'
import { ClubPageShell } from './ClubPageShell'

export function MemberFormPage() {
  const { t } = useTranslation('members')
  const navigate = useNavigate()
  const { memberUuid } = useParams<{ memberUuid: string }>()
  const { setSelectedMemberId } = useMembersStore()

  const isEditMode = Boolean(memberUuid)

  const memberQuery = useMemberQuery(memberUuid ?? null)
  const createMemberMutation = useCreateMemberMutation()
  const updateMemberMutation = useUpdateMemberMutation()

  const [memberForm, setMemberForm] = useState<MemberFormState>(() => createEmptyMemberForm())

  useEffect(() => {
    if (!isEditMode) {
      setMemberForm(createEmptyMemberForm())
      return
    }

    if (memberQuery.data) {
      setMemberForm(mapMemberToForm(memberQuery.data))
    }
  }, [isEditMode, memberQuery.data])

  const verification = useMemo(() => {
    const checks = [
      memberForm.first_name.trim().length > 0,
      memberForm.last_name.trim().length > 0,
      memberForm.member_category.trim().length > 0,
    ]
    const ready = checks.every(Boolean)
    return { ready }
  }, [memberForm.first_name, memberForm.last_name, memberForm.member_category])

  async function handleMemberSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (memberUuid) {
      const updated = await updateMemberMutation.mutateAsync({
        memberUuid,
        payload: buildMemberUpdatePayload(memberForm) as UpdateMemberPayload,
      })
      setSelectedMemberId(updated.uuid)
      navigate('/club/members')
      return
    }

    const created = await createMemberMutation.mutateAsync(buildMemberCreatePayload(memberForm))
    setSelectedMemberId(created.uuid)
    navigate('/club/members')
  }

  const combinedError = memberQuery.error ?? createMemberMutation.error ?? updateMemberMutation.error

  return (
    <ClubPageShell>
      <PageHeader
        title={isEditMode ? t('form.editTitle') : t('form.createTitle')}
        supportingText={isEditMode ? 'MEMBERS > EDIT PROFILE' : 'MEMBERS > NEW PROFILE'}
      />

      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      <form className="grid gap-4 lg:grid-cols-3" onSubmit={handleMemberSubmit}>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('form.title')}</CardTitle>
              <CardDescription>{t('form.description')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
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
              <TextField
                id="member-birthdate"
                label={t('form.birthDate')}
                type="date"
                value={memberForm.date_of_birth}
                onChange={(value) => setMemberForm({ ...memberForm, date_of_birth: value })}
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('form.memberCategory')}</CardTitle>
              <CardDescription>Classification club et identifiants</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <SelectField
                id="member-category"
                label={t('form.memberCategory')}
                options={[
                  { value: '1', label: t('categories.full') },
                  { value: '2', label: t('categories.temporary') },
                  { value: '3', label: t('categories.nonFlying') },
                  { value: '4', label: t('categories.shortPeriod') },
                  { value: '5', label: t('categories.externalPilot') },
                  { value: '6', label: t('categories.volunteer') },
                  { value: '7', label: t('categories.externalOrganization') },
                ]}
                value={memberForm.member_category}
                onChange={(value) => setMemberForm({ ...memberForm, member_category: value })}
              />
              <TextField
                id="member-ffvp"
                label={t('form.ffvp')}
                type="number"
                value={memberForm.ffvp_id}
                onChange={(value) => setMemberForm({ ...memberForm, ffvp_id: value })}
              />
              <TextField
                id="member-account-id"
                label={t('form.accountId')}
                value={memberForm.account_id}
                disabled={isEditMode}
                onChange={(value) => setMemberForm({ ...memberForm, account_id: value.toUpperCase() })}
              />
              <TextField
                id="member-first-subscription-year"
                label={t('form.firstSubscriptionYear')}
                type="number"
                value={memberForm.first_subscription_year}
                onChange={(value) => setMemberForm({ ...memberForm, first_subscription_year: value })}
              />
              <TextField
                id="member-trigram"
                label={t('form.trigram')}
                value={memberForm.trigram}
                onChange={(value) => setMemberForm({ ...memberForm, trigram: value.toUpperCase().slice(0, 3) })}
              />
              <TextField
                id="member-legacy-account-id"
                label={t('form.legacyAccountId')}
                value={memberForm.legacy_account_id}
                onChange={(value) => setMemberForm({ ...memberForm, legacy_account_id: value })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('form.notes')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="member-notes" className="sr-only">
                {t('form.notes')}
              </Label>
              <textarea
                id="member-notes"
                className="min-h-28 w-full rounded-shape-sm border border-outline bg-surface px-3 py-2 text-sm text-on-surface shadow-sm outline-none focus:border-primary"
                value={memberForm.notes}
                onChange={(event) => setMemberForm({ ...memberForm, notes: event.target.value })}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Aperçu du profil</CardTitle>
              <CardDescription>Photo et informations système</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex h-24 w-24 items-center justify-center rounded-shape-full border border-outline-variant bg-surface-container text-xs text-on-surface-variant">
                PHOTO
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-photo-url">{t('form.photoUrl')}</Label>
                <Input
                  id="member-photo-url"
                  value={memberForm.photo_url}
                  onChange={(event) => setMemberForm({ ...memberForm, photo_url: event.target.value })}
                />
              </div>
              <div className="space-y-2 rounded-shape-sm border border-outline-variant bg-surface-variant p-3">
                <p className="text-xs text-on-surface-variant">Vérification système</p>
                <span
                  className={[
                    'inline-flex rounded-shape-full px-2 py-0.5 text-xs font-medium',
                    verification.ready
                      ? 'bg-primary-container text-on-primary-container'
                      : 'bg-surface-container text-on-surface-variant',
                  ].join(' ')}
                >
                  {verification.ready ? 'Prêt pour enregistrement' : 'Données incomplètes'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rôles & privilèges</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <CheckboxField
                label={t('form.canFly')}
                checked={memberForm.can_fly}
                onChange={(checked) => setMemberForm({ ...memberForm, can_fly: checked })}
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
              <CheckboxField
                label={t('form.externalAuth')}
                checked={memberForm.external_auth_enabled}
                onChange={(checked) => setMemberForm({ ...memberForm, external_auth_enabled: checked })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={createMemberMutation.isPending || updateMemberMutation.isPending || (isEditMode && memberQuery.isLoading)}
                  type="submit"
                >
                  {isEditMode ? t('actions.saveChanges') : t('actions.createMember')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => navigate('/club/members')}>
                  {t('registrationPanel.actions.cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </ClubPageShell>
  )
}
