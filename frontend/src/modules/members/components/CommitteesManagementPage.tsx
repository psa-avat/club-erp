/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Committees management page — card grid, admin table, roster drawer
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
import { Dialog } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { PageHeader } from '../../../components/ui/page-header'
import {
  useCommitteeMembersQuery,
  useCommitteesQuery,
  useCreateCommitteeMutation,
  useMembersQuery,
  useReplaceCommitteeMembersMutation,
  useUpdateCommitteeMutation,
} from '../api'
import { useMembersStore } from '../store'
import type { Committee, UpdateCommitteePayload } from '../types'
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

// ---------------------------------------------------------------------------
// Roster drawer panel
// ---------------------------------------------------------------------------

type RosterPanelProps = {
  open: boolean
  onClose: () => void
  committee: Committee | null
  year: number
}

function RosterPanel({ open, onClose, committee, year }: RosterPanelProps) {
  const { t } = useTranslation('members')

  const [roster, setRoster] = useState<string[]>([])

  const committeeMembersQuery = useCommitteeMembersQuery(committee?.uuid ?? null, year)
  const membersQuery = useMembersQuery({})
  const replaceRosterMutation = useReplaceCommitteeMembersMutation()

  const members = membersQuery.data ?? []

  useEffect(() => {
    if (open) {
      setRoster((committeeMembersQuery.data ?? []).map((m) => m.uuid))
    }
  }, [open, committeeMembersQuery.data])

  async function handleSave() {
    if (!committee) return
    await replaceRosterMutation.mutateAsync({
      committeeUuid: committee.uuid,
      year,
      payload: { member_uuids: roster },
    })
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="roster-panel-title"
      className="ml-auto mr-0 flex h-[100vh] max-h-[100vh] max-w-md flex-col overflow-hidden rounded-none"
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-outline-variant px-6 py-4">
          <h2 id="roster-panel-title" className="text-base font-semibold text-on-surface">
            {t('committees.rosterTitle')} — {committee?.code}
          </h2>
          <p className="text-sm text-on-surface-variant">
            {t('committees.rosterDescription', { year })}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {replaceRosterMutation.error ? (
            <Alert className="mb-4">{toErrorMessage(replaceRosterMutation.error)}</Alert>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((member) => (
              <CheckboxField
                key={member.uuid}
                label={`${member.first_name} ${member.last_name}`}
                checked={roster.includes(member.uuid)}
                onChange={(checked) =>
                  setRoster((current) =>
                    checked ? [...current, member.uuid] : current.filter((uuid) => uuid !== member.uuid),
                  )
                }
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-outline-variant px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('registrationPanel.actions.cancel')}
          </Button>
          <Button
            type="button"
            disabled={replaceRosterMutation.isPending}
            onClick={handleSave}
          >
            {t('actions.saveRoster')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Committee form panel
// ---------------------------------------------------------------------------

type CommitteeFormPanelProps = {
  open: boolean
  onClose: () => void
  committee: Committee | null
  members: { uuid: string; first_name: string; last_name: string }[]
}

function CommitteeFormPanel({ open, onClose, committee, members }: CommitteeFormPanelProps) {
  const { t } = useTranslation('members')

  const [form, setForm] = useState<CommitteeFormState>(() => createCommitteeForm(committee))

  useEffect(() => {
    if (open) setForm(createCommitteeForm(committee))
  }, [open, committee])

  const createMutation = useCreateCommitteeMutation()
  const updateMutation = useUpdateCommitteeMutation()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = buildCommitteePayload(form)
    if (committee) {
      await updateMutation.mutateAsync({
        committeeUuid: committee.uuid,
        payload: payload as UpdateCommitteePayload,
      })
    } else {
      await createMutation.mutateAsync(payload)
    }
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="committee-form-title"
      className="ml-auto mr-0 flex h-[100vh] max-h-[100vh] max-w-md flex-col overflow-hidden rounded-none"
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-outline-variant px-6 py-4">
          <h2 id="committee-form-title" className="text-base font-semibold text-on-surface">
            {committee ? t('actions.saveCommittee') : t('actions.createCommittee')}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {(createMutation.error ?? updateMutation.error) ? (
            <Alert className="mb-4">
              {toErrorMessage(createMutation.error ?? updateMutation.error)}
            </Alert>
          ) : null}
          <form id="committee-form" className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            <TextField
              id="cmgmt-code"
              label={t('committees.code')}
              value={form.code}
              onChange={(value) => setForm({ ...form, code: value.toUpperCase() })}
            />
            <TextField
              id="cmgmt-budget"
              label={t('committees.budget')}
              value={form.budget_amount}
              onChange={(value) => setForm({ ...form, budget_amount: value })}
            />
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="cmgmt-description">{t('committees.descriptionLabel')}</Label>
              <Input
                id="cmgmt-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
            <SelectField
              id="cmgmt-manager"
              label={t('committees.manager')}
              options={[
                { value: '', label: t('filters.all') },
                ...members.map((m) => ({
                  value: m.uuid,
                  label: `${m.first_name} ${m.last_name}`,
                })),
              ]}
              value={form.manager_member_uuid}
              onChange={(value) => setForm({ ...form, manager_member_uuid: value })}
            />
            <CheckboxField
              label={t('committees.active')}
              checked={form.is_active}
              onChange={(checked) => setForm({ ...form, is_active: checked })}
            />
          </form>
        </div>

        <div className="flex justify-end gap-2 border-t border-outline-variant px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('registrationPanel.actions.cancel')}
          </Button>
          <Button
            form="committee-form"
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {committee ? t('actions.saveCommittee') : t('actions.createCommittee')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function exportCsv(committees: Committee[], membersByUuid: Map<string, string>) {
  const headers = ['Code', 'Description', 'Responsable', 'Budget', 'Actif']
  const rows = committees.map((c) => [
    c.code,
    c.description,
    c.manager_member_uuid ? (membersByUuid.get(c.manager_member_uuid) ?? '') : '',
    c.budget_amount ?? '',
    c.is_active ? 'Oui' : 'Non',
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'commissions.csv'
  link.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// CommitteesManagementPage
// ---------------------------------------------------------------------------

export function CommitteesManagementPage() {
  const { t } = useTranslation('members')
  const { selectedYear } = useMembersStore()

  const [rosterCommittee, setRosterCommittee] = useState<Committee | null>(null)
  const [editingCommittee, setEditingCommittee] = useState<Committee | null | undefined>(undefined)

  const committeesQuery = useCommitteesQuery()
  const membersQuery = useMembersQuery({})

  const committees = committeesQuery.data ?? []
  const members = membersQuery.data ?? []

  const membersByUuid = new Map(members.map((m) => [m.uuid, `${m.first_name} ${m.last_name}`]))

  const combinedError = committeesQuery.error ?? membersQuery.error

  return (
    <ClubPageShell>
      <PageHeader
        title={t('committees.title')}
        supportingText={t('committees.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => exportCsv(committees, membersByUuid)}
            >
              Exporter CSV
            </Button>
            <Button type="button" onClick={() => setEditingCommittee(null)}>
              {t('actions.createCommittee')}
            </Button>
          </div>
        }
      />

      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      {/* ── Card grid ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-on-surface-variant">
          {t('sections.committees.title')}
        </h2>
        {committees.length === 0 && !committeesQuery.isLoading ? (
          <p className="rounded-shape-md border border-outline-variant bg-surface p-8 text-center text-sm text-on-surface-variant">
            Aucune commission. Créez la première commission pour commencer.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {committees.map((committee) => {
              const managerName = committee.manager_member_uuid
                ? (membersByUuid.get(committee.manager_member_uuid) ?? null)
                : null

              return (
                <div
                  key={committee.uuid}
                  className="flex flex-col gap-3 rounded-shape-md border border-outline-variant bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-shape-sm bg-primary-container px-2 py-0.5 text-xs font-bold text-on-primary-container">
                      {committee.code}
                    </span>
                    <span
                      className={[
                        'rounded-shape-full px-2 py-0.5 text-xs font-medium',
                        committee.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-surface-container text-on-surface-variant',
                      ].join(' ')}
                    >
                      {committee.is_active ? t('statuses.active') : t('states.inactive')}
                    </span>
                  </div>

                  <div className="flex-1">
                    <p className="text-sm font-medium text-on-surface">{committee.description}</p>
                    {managerName ? (
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {t('committees.manager')} : {managerName}
                      </p>
                    ) : null}
                    {committee.budget_amount ? (
                      <p className="mt-0.5 text-xs text-on-surface-variant">
                        {t('committees.budget')} : {committee.budget_amount} €
                      </p>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRosterCommittee(committee)}
                      className="flex-1 text-xs"
                    >
                      {t('committees.rosterTitle')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setEditingCommittee(committee)}
                      className="text-xs"
                    >
                      ✎
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Administrative overview table ──────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Vue administrative</CardTitle>
          <CardDescription>Récapitulatif des commissions avec responsable et budget.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-container">
                <tr className="text-left text-xs uppercase tracking-wide text-on-surface-variant">
                  <th className="px-3 py-2">{t('committees.code')}</th>
                  <th className="px-3 py-2">{t('sections.committees.title')}</th>
                  <th className="px-3 py-2">{t('committees.manager')}</th>
                  <th className="px-3 py-2">{t('committees.budget')}</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {committees.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-on-surface-variant"
                    >
                      Aucune commission.
                    </td>
                  </tr>
                ) : (
                  committees.map((committee) => (
                    <tr key={`tbl-${committee.uuid}`} className="border-t border-outline-variant">
                      <td className="px-3 py-2 font-mono font-medium text-on-surface">
                        {committee.code}
                      </td>
                      <td className="px-3 py-2 text-on-surface">{committee.description}</td>
                      <td className="px-3 py-2 text-on-surface-variant">
                        {committee.manager_member_uuid
                          ? (membersByUuid.get(committee.manager_member_uuid) ?? '—')
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-on-surface-variant">
                        {committee.budget_amount ? `${committee.budget_amount} €` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={[
                            'rounded-shape-full px-2 py-0.5 text-xs font-medium',
                            committee.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-surface-container text-on-surface-variant',
                          ].join(' ')}
                        >
                          {committee.is_active ? t('statuses.active') : t('states.inactive')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingCommittee(committee)}
                          className="text-xs text-on-surface-variant underline underline-offset-2 hover:text-on-surface"
                        >
                          Modifier
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Roster panel ───────────────────────────────────────────────── */}
      <RosterPanel
        open={rosterCommittee !== null}
        onClose={() => setRosterCommittee(null)}
        committee={rosterCommittee}
        year={selectedYear}
      />

      {/* ── Committee form panel ───────────────────────────────────────── */}
      <CommitteeFormPanel
        open={editingCommittee !== undefined}
        onClose={() => setEditingCommittee(undefined)}
        committee={editingCommittee ?? null}
        members={members}
      />
    </ClubPageShell>
  )
}
