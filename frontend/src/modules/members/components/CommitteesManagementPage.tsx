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
import { Sheet, SheetContent } from '../../../components/ui/sheet'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'

import {
  useCommitteeMembersQuery,
  useCommitteesQuery,
  useCreateCommitteeMutation,
  useMemberOptionsQuery,
  useReplaceCommitteeMembersMutation,
  useUpdateCommitteeMutation,
} from '../api'
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
  const membersQuery = useMemberOptionsQuery()
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
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent
        side="right"
        className="flex h-full max-h-screen w-full max-w-md flex-col p-0"
        aria-labelledby="roster-panel-title"
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
      </SheetContent>
    </Sheet>
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
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent
        side="right"
        className="flex h-full max-h-screen w-full max-w-md flex-col p-0"
        aria-labelledby="committee-form-title"
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
              <TextField
                id="cmgmt-last-meeting"
              type="date"
              label={t('committees.lastMeeting')}
              value={form.last_meeting_date}
              onChange={(value) => setForm({ ...form, last_meeting_date: value })}
            />
            <SelectField
              id="cmgmt-budget-status"
              label={t('committees.budgetStatus')}
              options={[
                { value: '', label: t('filters.all') },
                { value: '1', label: t('committees.statusOnTrack') },
                { value: '2', label: t('committees.statusPendingReview') },
                { value: '3', label: t('committees.statusOverBudget') },
              ]}
              value={form.budget_status}
              onChange={(value) => setForm({ ...form, budget_status: value })}
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
      </SheetContent>
    </Sheet>
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

function committeeBadgeClasses(code: string): string {
  const prefix = code.toUpperCase().slice(0, 3)
  const map: Record<string, string> = {
    SAF: 'bg-error-container text-on-error-container',
    INS: 'bg-primary-container text-on-primary-container',
    EVT: 'bg-secondary-container text-on-secondary-container',
    MNT: 'bg-tertiary-container text-on-tertiary-container',
    SOC: 'bg-surface-container text-on-surface-variant',
  }
  return map[prefix] ?? 'bg-surface-container text-on-surface-variant'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function budgetStatus(committee: Committee): { labelKey: string; className: string } {
  if (committee.budget_status === 1) {
    return { labelKey: 'committees.statusOnTrack', className: 'bg-tertiary-container text-on-tertiary-container' }
  }
  if (committee.budget_status === 3) {
    return { labelKey: 'committees.statusOverBudget', className: 'bg-error-container text-on-error-container' }
  }
  return { labelKey: 'committees.statusPendingReview', className: 'bg-secondary-container text-on-secondary-container' }
}

// ---------------------------------------------------------------------------
// Committee avatar stack — live roster per card
// ---------------------------------------------------------------------------

const AVATAR_MAX_VISIBLE = 4

type CommitteeAvatarStackProps = {
  committeeUuid: string
  year: number
}

function CommitteeAvatarStack({ committeeUuid, year }: CommitteeAvatarStackProps) {
  const { t } = useTranslation('members')
  const query = useCommitteeMembersQuery(committeeUuid, year)
  const members = query.data ?? []
  const visible = members.slice(0, AVATAR_MAX_VISIBLE)
  const overflow = members.length - AVATAR_MAX_VISIBLE

  if (query.isLoading) {
    return <p className="mt-1 text-xs text-on-surface-variant">…</p>
  }

  if (members.length === 0) {
    return <p className="mt-1 text-xs text-on-surface-variant">{t('committees.noMembers')}</p>
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="flex -space-x-2">
        {visible.map((member) => (
          <span
            key={member.uuid}
            title={`${member.first_name} ${member.last_name}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-shape-full border-2 border-surface bg-secondary-container text-[10px] font-semibold text-on-secondary-container"
          >
            {initials(`${member.first_name} ${member.last_name}`)}
          </span>
        ))}
        {overflow > 0 && (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-shape-full border-2 border-surface bg-surface-container text-[10px] font-semibold text-on-surface-variant">
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-xs text-on-surface-variant">
        {t('committees.membersAssigned', { count: members.length })}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommitteesManagementPage
// ---------------------------------------------------------------------------

export function CommitteesManagementPage() {
  const { t } = useTranslation('members')
  const { t: tCommon } = useTranslation('common')
  const selectedYear = useFiscalYearStore((s) => s.activeFiscalYearData?.year ?? new Date().getUTCFullYear())

  const [rosterCommittee, setRosterCommittee] = useState<Committee | null>(null)
  const [editingCommittee, setEditingCommittee] = useState<Committee | null | undefined>(undefined)

  const committeesQuery = useCommitteesQuery()
  const membersQuery = useMemberOptionsQuery()

  const committees = committeesQuery.data ?? []
  const members = membersQuery.data ?? []

  const membersByUuid = new Map(members.map((m) => [m.uuid, `${m.first_name} ${m.last_name}`]))

  const combinedError = committeesQuery.error ?? membersQuery.error

  return (
    <section className="space-y-4">
      {/* ── Action bar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => exportCsv(committees, membersByUuid)}
        >
          {tCommon('export.button')}
        </Button>
        <Button type="button" onClick={() => setEditingCommittee(null)}>
          {t('actions.createCommittee')}
        </Button>
      </div>

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
                    <span className={[
                      'rounded-shape-sm px-2 py-0.5 text-xs font-bold',
                      committeeBadgeClasses(committee.code),
                    ].join(' ')}>
                      {committee.code}
                    </span>
                    <span
                      className={[
                        'rounded-shape-full px-2 py-0.5 text-xs font-medium',
                        committee.is_active
                          ? 'bg-primary-container text-on-primary-container'
                          : 'bg-surface-container text-on-surface-variant',
                      ].join(' ')}
                    >
                      {committee.is_active ? t('statuses.active') : t('states.inactive')}
                    </span>
                  </div>

                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-semibold text-on-surface">{committee.description}</p>
                    <div className="rounded-shape-sm border border-outline-variant bg-surface-container p-2">
                      <p className="text-[11px] uppercase tracking-wide text-on-surface-variant">Manager</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-shape-full bg-primary-container text-[11px] font-semibold text-on-primary-container">
                          {initials(managerName ?? 'N/A')}
                        </span>
                        <span className="text-xs text-on-surface">{managerName ?? 'Non assigné'}</span>
                      </div>
                    </div>
                    <div className="rounded-shape-sm border border-outline-variant bg-surface-container p-2">
                      <p className="text-[11px] uppercase tracking-wide text-on-surface-variant">Active members</p>
                      <CommitteeAvatarStack committeeUuid={committee.uuid} year={selectedYear} />
                    </div>
                    {committee.budget_amount ? (
                      <p className="mt-0.5 text-xs text-on-surface-variant">
                        {t('committees.budget')} : {committee.budget_amount} €
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRosterCommittee(committee)}
                      className="w-full text-xs sm:flex-1"
                    >
                      {t('committees.manageRoster')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setRosterCommittee(committee)}
                      className="text-xs"
                    >
                      {t('committees.assignMember')}
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
                  <th className="px-3 py-2">{t('committees.lastMeeting')}</th>
                  <th className="px-3 py-2">{t('committees.budgetStatus')}</th>
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
                        {committee.last_meeting_date ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const status = budgetStatus(committee)
                          return (
                        <span
                          className={[
                            'rounded-shape-full px-2 py-0.5 text-xs font-medium',
                                status.className,
                          ].join(' ')}
                        >
                          {t(status.labelKey)}
                        </span>
                          )
                        })()}
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
    </section>
  )
}
