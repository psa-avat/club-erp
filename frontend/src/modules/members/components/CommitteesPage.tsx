/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Committees list, editor, and roster management
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
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useCommitteeMembersQuery,
  useCommitteesQuery,
  useCreateCommitteeMutation,
  useMembersQuery,
  useReplaceCommitteeMembersMutation,
  useUpdateCommitteeMutation,
} from '../api'
import { useMembersStore } from '../store'
import type { UpdateCommitteePayload } from '../types'
import {
  CheckboxField,
  SelectField,
  TextField,
  buildCommitteePayload,
  createCommitteeForm,
  toErrorMessage,
  type CommitteeFormState,
} from './membersShared'
import { ClubPageShell } from './ClubPageShell'

export function CommitteesPage() {
  const { t } = useTranslation('members')
  const { selectedYear, filters } = useMembersStore()

  const [selectedCommitteeId, setSelectedCommitteeId] = useState<string | null>(null)
  const [committeeForm, setCommitteeForm] = useState<CommitteeFormState>(() => createCommitteeForm())
  const [committeeRoster, setCommitteeRoster] = useState<string[]>([])

  const committeesQuery = useCommitteesQuery()
  const committeeMembersQuery = useCommitteeMembersQuery(selectedCommitteeId, selectedYear)
  const membersQuery = useMembersQuery(filters)
  const createCommitteeMutation = useCreateCommitteeMutation()
  const updateCommitteeMutation = useUpdateCommitteeMutation()
  const replaceCommitteeMembersMutation = useReplaceCommitteeMembersMutation()

  const committees = committeesQuery.data ?? []
  const members = membersQuery.data ?? []
  const selectedCommittee = committees.find((c) => c.uuid === selectedCommitteeId) ?? null

  useEffect(() => {
    setCommitteeForm(createCommitteeForm(selectedCommittee))
  }, [selectedCommittee])

  useEffect(() => {
    const selectedMembers = committeeMembersQuery.data ?? []
    setCommitteeRoster(selectedMembers.map((m) => m.uuid))
  }, [committeeMembersQuery.data])

  async function handleCommitteeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = buildCommitteePayload(committeeForm)

    if (selectedCommitteeId) {
      const updated = await updateCommitteeMutation.mutateAsync({
        committeeUuid: selectedCommitteeId,
        payload: payload as UpdateCommitteePayload,
      })
      setSelectedCommitteeId(updated.uuid)
      return
    }

    const created = await createCommitteeMutation.mutateAsync(payload)
    setSelectedCommitteeId(created.uuid)
  }

  async function handleRosterSubmit() {
    if (!selectedCommitteeId) return
    await replaceCommitteeMembersMutation.mutateAsync({
      committeeUuid: selectedCommitteeId,
      year: selectedYear,
      payload: { member_uuids: committeeRoster },
    })
  }

  const combinedError =
    committeesQuery.error ??
    committeeMembersQuery.error ??
    createCommitteeMutation.error ??
    updateCommitteeMutation.error ??
    replaceCommitteeMembersMutation.error

  return (
    <ClubPageShell>
      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('committees.title')}</CardTitle>
            <CardDescription>{t('committees.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-[0.95fr,1.25fr]">
            {/* Committee list */}
            <div className="space-y-3">
              {committees.map((committee) => (
                <button
                  key={committee.uuid}
                  className={[
                    'w-full rounded-shape-md border px-4 py-3 text-left transition-colors',
                    selectedCommitteeId === committee.uuid
                      ? 'border-primary bg-primary-container'
                      : 'border-outline-variant bg-surface hover:border-outline hover:bg-surface-variant',
                  ].join(' ')}
                  type="button"
                  onClick={() => setSelectedCommitteeId(committee.uuid)}
                >
                  <p className="font-medium text-on-surface">{committee.code}</p>
                  <p className="text-sm text-on-surface-variant">{committee.description}</p>
                </button>
              ))}
            </div>

            {/* Committee editor + roster */}
            <div className="space-y-6">
              <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCommitteeSubmit}>
                <TextField
                  id="committee-code"
                  label={t('committees.code')}
                  value={committeeForm.code}
                  onChange={(value) => setCommitteeForm({ ...committeeForm, code: value.toUpperCase() })}
                />
                <TextField
                  id="committee-budget"
                  label={t('committees.budget')}
                  value={committeeForm.budget_amount}
                  onChange={(value) => setCommitteeForm({ ...committeeForm, budget_amount: value })}
                />
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="committee-description">{t('committees.descriptionLabel')}</Label>
                  <Input
                    id="committee-description"
                    value={committeeForm.description}
                    onChange={(event) =>
                      setCommitteeForm({ ...committeeForm, description: event.target.value })
                    }
                  />
                </div>
                <SelectField
                  id="committee-manager"
                  label={t('committees.manager')}
                  options={[
                    { value: '', label: t('filters.all') },
                    ...members.map((member) => ({
                      value: member.uuid,
                      label: `${member.first_name} ${member.last_name}`,
                    })),
                  ]}
                  value={committeeForm.manager_member_uuid}
                  onChange={(value) =>
                    setCommitteeForm({ ...committeeForm, manager_member_uuid: value })
                  }
                />
                <CheckboxField
                  label={t('committees.active')}
                  checked={committeeForm.is_active}
                  onChange={(checked) => setCommitteeForm({ ...committeeForm, is_active: checked })}
                />
                <div className="md:col-span-2">
                  <Button
                    disabled={createCommitteeMutation.isPending || updateCommitteeMutation.isPending}
                    type="submit"
                  >
                    {selectedCommitteeId ? t('actions.saveCommittee') : t('actions.createCommittee')}
                  </Button>
                </div>
              </form>

              <div className="space-y-3 rounded-shape-md border border-outline-variant bg-surface-variant p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-on-surface">{t('committees.rosterTitle')}</h3>
                    <p className="text-sm text-on-surface-variant">
                      {t('committees.rosterDescription', { year: selectedYear })}
                    </p>
                  </div>
                  <Button
                    disabled={!selectedCommitteeId || replaceCommitteeMembersMutation.isPending}
                    type="button"
                    variant="secondary"
                    onClick={handleRosterSubmit}
                  >
                    {t('actions.saveRoster')}
                  </Button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {members.map((member) => (
                    <CheckboxField
                      key={member.uuid}
                      label={`${member.first_name} ${member.last_name}`}
                      checked={committeeRoster.includes(member.uuid)}
                      onChange={(checked) =>
                        setCommitteeRoster((current) =>
                          checked
                            ? [...current, member.uuid]
                            : current.filter((uuid) => uuid !== member.uuid),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.committees.title')}</CardTitle>
            <CardDescription>{t('sections.committees.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-on-surface-variant">
            <p>{t('committees.rosterDescription', { year: selectedYear })}</p>
            <p>{t('committees.helper')}</p>
          </CardContent>
        </Card>
      </div>
    </ClubPageShell>
  )
}
