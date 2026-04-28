import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { ImportDialog } from '../../../components/ui/ImportDialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useCommitteeMembersQuery,
  useCommitteesQuery,
  useCompleteRegistrationMutation,
  useCreateCommitteeMutation,
  useCreateMemberMutation,
  useDisableExpenseAccessMutation,
  useEnableExpenseAccessMutation,
  useImportMembersMutation,
  useMemberQuery,
  useMembersQuery,
  useMemberSheetsQuery,
  useReplaceCommitteeMembersMutation,
  useUpdateCommitteeMutation,
  useUpdateMemberMutation,
  useUpsertMemberSheetMutation,
} from '../api'
import { useMembersStore } from '../store'
import type {
  Committee,
  CreateCommitteePayload,
  CreateMemberPayload,
  MemberDetail,
  MemberSheet,
  UpdateCommitteePayload,
  UpdateMemberPayload,
  UpsertMemberSheetPayload,
} from '../types'

type MembersSection = 'members' | 'committees' | 'sheets'

type MemberFormState = {
  genre: string
  first_name: string
  last_name: string
  date_of_birth: string
  email: string
  phone: string
  member_category: string
  seniority: string
  ffvp_id: string
  account_id: string
  photo_url: string
  is_active: boolean
  status: string
  registration_status: string
  is_instructor: boolean
  is_employee: boolean
  is_executive: boolean
  is_board_member: boolean
  can_fly: boolean
  external_auth_enabled: boolean
  last_registration_year: string
  notes: string
}

type CommitteeFormState = {
  code: string
  description: string
  budget_amount: string
  manager_member_uuid: string
  is_active: boolean
}

type SheetFormState = {
  licence_number: string
  fare_type: string
  hours_count: string
  packs_bought_count: string
  hours_done_in_pack: string
  remaining_hours_in_pack: string
  expense_access_enabled: boolean
}

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }

    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string }
      if (typeof first?.msg === 'string' && first.msg.length > 0) {
        return first.msg
      }
    }

    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) {
      return response.data.message
    }
  }

  return 'Unexpected error'
}

function createEmptyMemberForm(selectedYear: number): MemberFormState {
  return {
    genre: '0',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    email: '',
    phone: '',
    member_category: '1',
    seniority: '',
    ffvp_id: '',
    account_id: '',
    photo_url: '',
    is_active: true,
    status: '1',
    registration_status: '1',
    is_instructor: false,
    is_employee: false,
    is_executive: false,
    is_board_member: false,
    can_fly: true,
    external_auth_enabled: false,
    last_registration_year: String(selectedYear),
    notes: '',
  }
}

function createCommitteeForm(committee?: Committee | null): CommitteeFormState {
  return {
    code: committee?.code ?? '',
    description: committee?.description ?? '',
    budget_amount: committee?.budget_amount ?? '',
    manager_member_uuid: committee?.manager_member_uuid ?? '',
    is_active: committee?.is_active ?? true,
  }
}

function createSheetForm(sheet?: MemberSheet | null): SheetFormState {
  return {
    licence_number: sheet?.licence_number ?? '',
    fare_type: String(sheet?.fare_type ?? 1),
    hours_count: sheet?.hours_count ?? '0',
    packs_bought_count: String(sheet?.packs_bought_count ?? 0),
    hours_done_in_pack: sheet?.hours_done_in_pack ?? '0',
    remaining_hours_in_pack: sheet?.remaining_hours_in_pack ?? '0',
    expense_access_enabled: sheet?.expense_access_enabled ?? false,
  }
}

function mapMemberToForm(member: MemberDetail): MemberFormState {
  return {
    genre: String(member.genre),
    first_name: member.first_name,
    last_name: member.last_name,
    date_of_birth: member.date_of_birth ?? '',
    email: member.email ?? '',
    phone: member.phone ?? '',
    member_category: String(member.member_category),
    seniority: member.seniority === null ? '' : String(member.seniority),
    ffvp_id: member.ffvp_id === null ? '' : String(member.ffvp_id),
    account_id: member.account_id,
    photo_url: member.photo_url ?? '',
    is_active: member.is_active,
    status: String(member.status),
    registration_status: String(member.registration_status),
    is_instructor: member.is_instructor,
    is_employee: member.is_employee,
    is_executive: member.is_executive,
    is_board_member: member.is_board_member,
    can_fly: member.can_fly,
    external_auth_enabled: member.external_auth_enabled,
    last_registration_year: member.last_registration_year === null ? '' : String(member.last_registration_year),
    notes: member.notes ?? '',
  }
}

function buildMemberPayload(form: MemberFormState): CreateMemberPayload {
  return {
    genre: Number(form.genre),
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    ...(form.date_of_birth ? { date_of_birth: form.date_of_birth } : {}),
    ...(form.email.trim() ? { email: form.email.trim() } : {}),
    ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
    member_category: Number(form.member_category),
    ...(form.seniority ? { seniority: Number(form.seniority) } : {}),
    ...(form.ffvp_id ? { ffvp_id: Number(form.ffvp_id) } : {}),
    ...(form.account_id.trim() ? { account_id: form.account_id.trim() } : {}),
    ...(form.photo_url.trim() ? { photo_url: form.photo_url.trim() } : {}),
    is_active: form.is_active,
    status: Number(form.status),
    registration_status: Number(form.registration_status),
    is_instructor: form.is_instructor,
    is_employee: form.is_employee,
    is_executive: form.is_executive,
    is_board_member: form.is_board_member,
    can_fly: form.can_fly,
    external_auth_enabled: form.external_auth_enabled,
    ...(form.last_registration_year ? { last_registration_year: Number(form.last_registration_year) } : {}),
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
  }
}

function buildCommitteePayload(form: CommitteeFormState): CreateCommitteePayload {
  return {
    code: form.code.trim(),
    description: form.description.trim(),
    ...(form.budget_amount.trim() ? { budget_amount: form.budget_amount.trim() } : {}),
    ...(form.manager_member_uuid ? { manager_member_uuid: form.manager_member_uuid } : {}),
    is_active: form.is_active,
  }
}

function buildSheetPayload(form: SheetFormState): UpsertMemberSheetPayload {
  return {
    ...(form.licence_number.trim() ? { licence_number: form.licence_number.trim() } : {}),
    fare_type: Number(form.fare_type),
    hours_count: form.hours_count || '0',
    packs_bought_count: Number(form.packs_bought_count || 0),
    hours_done_in_pack: form.hours_done_in_pack || '0',
    remaining_hours_in_pack: form.remaining_hours_in_pack || '0',
    expense_access_enabled: form.expense_access_enabled,
  }
}

function memberCategoryLabel(category: number) {
  const map: Record<number, string> = {
    1: 'Full',
    2: 'Temporary',
    3: 'Non-flying',
    4: 'Short period',
    5: 'External pilot',
    6: 'Volunteer',
  }

  return map[category] ?? `#${category}`
}

export function MembersPage() {
  const { t } = useTranslation('members')
  const { selectedMemberId, setSelectedMemberId, selectedYear, setSelectedYear, filters, setFilters } = useMembersStore()
  const [activeSection, setActiveSection] = useState<MembersSection>('members')
  const [memberForm, setMemberForm] = useState<MemberFormState>(() => createEmptyMemberForm(selectedYear))
  const [selectedCommitteeId, setSelectedCommitteeId] = useState<string | null>(null)
  const [committeeForm, setCommitteeForm] = useState<CommitteeFormState>(() => createCommitteeForm())
  const [committeeRoster, setCommitteeRoster] = useState<string[]>([])
  const [sheetForm, setSheetForm] = useState<SheetFormState>(() => createSheetForm())
  const [expenseToken, setExpenseToken] = useState<string | null>(null)

  const membersQuery = useMembersQuery(filters)
  const memberDetailQuery = useMemberQuery(selectedMemberId)
  const committeesQuery = useCommitteesQuery()
  const committeeMembersQuery = useCommitteeMembersQuery(selectedCommitteeId, selectedYear)
  const memberSheetsQuery = useMemberSheetsQuery(selectedMemberId)

  const createMemberMutation = useCreateMemberMutation()
  const updateMemberMutation = useUpdateMemberMutation()
  const completeRegistrationMutation = useCompleteRegistrationMutation()
  const createCommitteeMutation = useCreateCommitteeMutation()
  const updateCommitteeMutation = useUpdateCommitteeMutation()
  const replaceCommitteeMembersMutation = useReplaceCommitteeMembersMutation()
  const upsertMemberSheetMutation = useUpsertMemberSheetMutation()
  const enableExpenseAccessMutation = useEnableExpenseAccessMutation()
  const disableExpenseAccessMutation = useDisableExpenseAccessMutation()
  const importMembersMutation = useImportMembersMutation()
  const [showImportDialog, setShowImportDialog] = useState(false)
  const { t: tCommon } = useTranslation('common')

  const members = membersQuery.data ?? []
  const committees = committeesQuery.data ?? []
  const selectedMember = memberDetailQuery.data ?? null
  const selectedCommittee = committees.find((committee) => committee.uuid === selectedCommitteeId) ?? null
  const sheets = memberSheetsQuery.data ?? []
  const selectedYearSheet = sheets.find((sheet) => sheet.year === selectedYear) ?? null

  useEffect(() => {
    if (selectedMember) {
      setMemberForm(mapMemberToForm(selectedMember))
    } else {
      setMemberForm(createEmptyMemberForm(selectedYear))
    }
  }, [selectedMember, selectedYear])

  useEffect(() => {
    setCommitteeForm(createCommitteeForm(selectedCommittee))
  }, [selectedCommittee])

  useEffect(() => {
    const selectedMembers = committeeMembersQuery.data ?? []
    setCommitteeRoster(selectedMembers.map((member) => member.uuid))
  }, [committeeMembersQuery.data])

  useEffect(() => {
    setSheetForm(createSheetForm(selectedYearSheet))
    setExpenseToken(null)
  }, [selectedYearSheet])

  function handleNewMember() {
    setSelectedMemberId(null)
    setExpenseToken(null)
    setMemberForm(createEmptyMemberForm(selectedYear))
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

  async function handleCompleteRegistration() {
    if (!selectedMemberId) {
      return
    }

    const completed = await completeRegistrationMutation.mutateAsync({
      memberUuid: selectedMemberId,
      payload: { year: selectedYear },
    })
    setSelectedMemberId(completed.uuid)
  }

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
    if (!selectedCommitteeId) {
      return
    }

    await replaceCommitteeMembersMutation.mutateAsync({
      committeeUuid: selectedCommitteeId,
      year: selectedYear,
      payload: {
        member_uuids: committeeRoster,
      },
    })
  }

  async function handleSheetSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedMemberId) {
      return
    }

    const updatedSheet = await upsertMemberSheetMutation.mutateAsync({
      memberUuid: selectedMemberId,
      year: selectedYear,
      payload: buildSheetPayload(sheetForm),
    })
    setSheetForm(createSheetForm(updatedSheet))
  }

  async function handleEnableExpenseAccess() {
    if (!selectedMemberId) {
      return
    }

    const response = await enableExpenseAccessMutation.mutateAsync({
      memberUuid: selectedMemberId,
      year: selectedYear,
    })
    setExpenseToken(response.generated_token)
  }

  async function handleDisableExpenseAccess() {
    if (!selectedMemberId) {
      return
    }

    await disableExpenseAccessMutation.mutateAsync({
      memberUuid: selectedMemberId,
      year: selectedYear,
    })
    setExpenseToken(null)
  }

  const combinedError =
    membersQuery.error ??
    memberDetailQuery.error ??
    committeesQuery.error ??
    committeeMembersQuery.error ??
    memberSheetsQuery.error ??
    createMemberMutation.error ??
    updateMemberMutation.error ??
    completeRegistrationMutation.error ??
    createCommitteeMutation.error ??
    updateCommitteeMutation.error ??
    replaceCommitteeMembersMutation.error ??
    upsertMemberSheetMutation.error ??
    enableExpenseAccessMutation.error ??
    disableExpenseAccessMutation.error

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-sky-950 via-teal-900 to-emerald-800 text-white shadow-xl">
        <div className="grid gap-4 p-6 md:grid-cols-[1.8fr,1fr] md:p-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">{t('hero.kicker')}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{t('hero.title')}</h1>
            <p className="max-w-2xl text-sm text-emerald-50/85">{t('hero.description')}</p>
          </div>
          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <Label className="text-emerald-50" htmlFor="members-year">
              {t('filters.year')}
            </Label>
            <Input
              id="members-year"
              className="border-white/20 bg-white/90 text-slate-900"
              type="number"
              value={selectedYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
            />
            <Button className="w-full" variant="secondary" type="button" onClick={handleNewMember}>
              {t('actions.newMember')}
            </Button>
            <Button className="w-full" variant="secondary" type="button" onClick={() => setShowImportDialog(true)}>
              {tCommon('import.button')}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 border-t border-white/10 bg-slate-950/20 p-4 md:grid-cols-3">
          <SectionButton
            active={activeSection === 'members'}
            title={t('sections.members.title')}
            description={t('sections.members.description')}
            onClick={() => setActiveSection('members')}
          />
          <SectionButton
            active={activeSection === 'committees'}
            title={t('sections.committees.title')}
            description={t('sections.committees.description')}
            onClick={() => setActiveSection('committees')}
          />
          <SectionButton
            active={activeSection === 'sheets'}
            title={t('sections.sheets.title')}
            description={t('sections.sheets.description')}
            onClick={() => setActiveSection('sheets')}
          />
        </div>
      </div>

      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      {expenseToken ? (
        <Alert>
          {t('sheet.generatedToken')}: <span className="font-mono">{expenseToken}</span>
        </Alert>
      ) : null}

      {activeSection === 'members' ? (
        <>
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
                  setFilters({
                    ...filters,
                    member_category: value ? Number(value) : undefined,
                  })
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
                  setFilters({
                    ...filters,
                    status: value ? Number(value) : undefined,
                  })
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
                  setFilters({
                    ...filters,
                    can_fly: value ? value === 'true' : undefined,
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
                {membersQuery.isLoading ? <p className="text-sm text-slate-600">{t('states.loading')}</p> : null}
                <div className="space-y-2">
                  {members.map((member) => (
                    <button
                      key={member.uuid}
                      className={[
                        'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                        selectedMemberId === member.uuid
                          ? 'border-sky-500 bg-sky-50'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      ].join(' ')}
                      type="button"
                      onClick={() => setSelectedMemberId(member.uuid)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">
                            {member.first_name} {member.last_name}
                          </p>
                          <p className="text-xs uppercase tracking-wide text-slate-500">{member.account_id}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {memberCategoryLabel(member.member_category)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                        <Pill active={member.can_fly}>{t('list.canFly')}</Pill>
                        <Pill active={member.is_instructor}>{t('flags.instructor')}</Pill>
                        <Pill active={member.is_employee}>{t('flags.employee')}</Pill>
                        <Pill active={member.is_executive}>{t('flags.executive')}</Pill>
                        <Pill active={member.is_board_member}>{t('flags.board')}</Pill>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>
                          {t('list.committees')}: {member.committee_count}
                        </span>
                        <span>{member.is_active ? t('statuses.active') : t('states.inactive')}</span>
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
                  <TextField id="member-first-name" label={t('form.firstName')} value={memberForm.first_name} onChange={(value) => setMemberForm({ ...memberForm, first_name: value })} />
                  <TextField id="member-last-name" label={t('form.lastName')} value={memberForm.last_name} onChange={(value) => setMemberForm({ ...memberForm, last_name: value })} />
                  <TextField id="member-email" label={t('form.email')} type="email" value={memberForm.email} onChange={(value) => setMemberForm({ ...memberForm, email: value })} />
                  <TextField id="member-phone" label={t('form.phone')} value={memberForm.phone} onChange={(value) => setMemberForm({ ...memberForm, phone: value })} />
                  <TextField id="member-birthdate" label={t('form.birthDate')} type="date" value={memberForm.date_of_birth} onChange={(value) => setMemberForm({ ...memberForm, date_of_birth: value })} />
                  <TextField id="member-account-id" label={t('form.accountId')} value={memberForm.account_id} onChange={(value) => setMemberForm({ ...memberForm, account_id: value.toUpperCase() })} />
                  <TextField id="member-seniority" label={t('form.seniority')} type="number" value={memberForm.seniority} onChange={(value) => setMemberForm({ ...memberForm, seniority: value })} />
                  <TextField id="member-ffvp" label={t('form.ffvp')} type="number" value={memberForm.ffvp_id} onChange={(value) => setMemberForm({ ...memberForm, ffvp_id: value })} />
                  <TextField id="member-last-registration-year" label={t('form.registrationYear')} type="number" value={memberForm.last_registration_year} onChange={(value) => setMemberForm({ ...memberForm, last_registration_year: value })} />
                  <TextField id="member-photo-url" label={t('form.photoUrl')} value={memberForm.photo_url} onChange={(value) => setMemberForm({ ...memberForm, photo_url: value })} />
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
                      className="min-h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-400"
                      value={memberForm.notes}
                      onChange={(event) => setMemberForm({ ...memberForm, notes: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 md:grid-cols-3">
                    <CheckboxField label={t('form.active')} checked={memberForm.is_active} onChange={(checked) => setMemberForm({ ...memberForm, is_active: checked })} />
                    <CheckboxField label={t('form.canFly')} checked={memberForm.can_fly} onChange={(checked) => setMemberForm({ ...memberForm, can_fly: checked })} />
                    <CheckboxField label={t('form.externalAuth')} checked={memberForm.external_auth_enabled} onChange={(checked) => setMemberForm({ ...memberForm, external_auth_enabled: checked })} />
                    <CheckboxField label={t('flags.instructor')} checked={memberForm.is_instructor} onChange={(checked) => setMemberForm({ ...memberForm, is_instructor: checked })} />
                    <CheckboxField label={t('flags.employee')} checked={memberForm.is_employee} onChange={(checked) => setMemberForm({ ...memberForm, is_employee: checked })} />
                    <CheckboxField label={t('flags.executive')} checked={memberForm.is_executive} onChange={(checked) => setMemberForm({ ...memberForm, is_executive: checked })} />
                    <CheckboxField label={t('flags.board')} checked={memberForm.is_board_member} onChange={(checked) => setMemberForm({ ...memberForm, is_board_member: checked })} />
                  </div>
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    <Button disabled={createMemberMutation.isPending || updateMemberMutation.isPending} type="submit">
                      {selectedMemberId ? t('actions.saveChanges') : t('actions.createMember')}
                    </Button>
                    {selectedMemberId ? (
                      <Button disabled={completeRegistrationMutation.isPending} type="button" variant="secondary" onClick={handleCompleteRegistration}>
                        {t('actions.completeRegistration')}
                      </Button>
                    ) : null}
                    <Button type="button" variant="ghost" onClick={handleNewMember}>
                      {t('actions.reset')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {activeSection === 'committees' ? (
        <div className="grid gap-6 xl:grid-cols-[1.2fr,1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{t('committees.title')}</CardTitle>
              <CardDescription>{t('committees.description')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[0.95fr,1.25fr]">
              <div className="space-y-3">
                {committees.map((committee) => (
                  <button
                    key={committee.uuid}
                    className={[
                      'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                      selectedCommitteeId === committee.uuid
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                    ].join(' ')}
                    type="button"
                    onClick={() => setSelectedCommitteeId(committee.uuid)}
                  >
                    <p className="font-medium text-slate-900">{committee.code}</p>
                    <p className="text-sm text-slate-600">{committee.description}</p>
                  </button>
                ))}
              </div>
              <div className="space-y-6">
                <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCommitteeSubmit}>
                  <TextField id="committee-code" label={t('committees.code')} value={committeeForm.code} onChange={(value) => setCommitteeForm({ ...committeeForm, code: value.toUpperCase() })} />
                  <TextField id="committee-budget" label={t('committees.budget')} value={committeeForm.budget_amount} onChange={(value) => setCommitteeForm({ ...committeeForm, budget_amount: value })} />
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="committee-description">{t('committees.descriptionLabel')}</Label>
                    <Input
                      id="committee-description"
                      value={committeeForm.description}
                      onChange={(event) => setCommitteeForm({ ...committeeForm, description: event.target.value })}
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
                    onChange={(value) => setCommitteeForm({ ...committeeForm, manager_member_uuid: value })}
                  />
                  <CheckboxField label={t('committees.active')} checked={committeeForm.is_active} onChange={(checked) => setCommitteeForm({ ...committeeForm, is_active: checked })} />
                  <div className="md:col-span-2">
                    <Button disabled={createCommitteeMutation.isPending || updateCommitteeMutation.isPending} type="submit">
                      {selectedCommitteeId ? t('actions.saveCommittee') : t('actions.createCommittee')}
                    </Button>
                  </div>
                </form>

                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-slate-900">{t('committees.rosterTitle')}</h3>
                      <p className="text-sm text-slate-600">{t('committees.rosterDescription', { year: selectedYear })}</p>
                    </div>
                    <Button disabled={!selectedCommitteeId || replaceCommitteeMembersMutation.isPending} type="button" variant="secondary" onClick={handleRosterSubmit}>
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
                            checked ? [...current, member.uuid] : current.filter((uuid) => uuid !== member.uuid),
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
            <CardContent className="space-y-3 text-sm text-slate-600">
              <p>{t('committees.rosterDescription', { year: selectedYear })}</p>
              <p>{t('committees.helper')}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeSection === 'sheets' ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr,1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{t('list.title')}</CardTitle>
              <CardDescription>{t('sheet.pickMember')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {membersQuery.isLoading ? <p className="text-sm text-slate-600">{t('states.loading')}</p> : null}
              <div className="space-y-2">
                {members.map((member) => (
                  <button
                    key={member.uuid}
                    className={[
                      'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                      selectedMemberId === member.uuid
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                    ].join(' ')}
                    type="button"
                    onClick={() => setSelectedMemberId(member.uuid)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">
                          {member.first_name} {member.last_name}
                        </p>
                        <p className="text-xs uppercase tracking-wide text-slate-500">{member.account_id}</p>
                      </div>
                      <Pill active={member.can_fly}>{t('list.canFly')}</Pill>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sheet.title')}</CardTitle>
              <CardDescription>{t('sheet.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedMemberId ? (
                <p className="text-sm text-slate-600">{t('sheet.selectMember')}</p>
              ) : !selectedMember?.can_fly ? (
                <p className="text-sm text-slate-600">{t('sheet.notEligible')}</p>
              ) : (
                <form className="grid gap-4" onSubmit={handleSheetSubmit}>
                  <TextField id="sheet-licence-number" label={t('sheet.licenceNumber')} value={sheetForm.licence_number} onChange={(value) => setSheetForm({ ...sheetForm, licence_number: value })} />
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
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField id="sheet-hours-count" label={t('sheet.hoursCount')} value={sheetForm.hours_count} onChange={(value) => setSheetForm({ ...sheetForm, hours_count: value })} />
                    <TextField id="sheet-packs-bought" label={t('sheet.packsBought')} type="number" value={sheetForm.packs_bought_count} onChange={(value) => setSheetForm({ ...sheetForm, packs_bought_count: value })} />
                    <TextField id="sheet-hours-in-pack" label={t('sheet.hoursInPack')} value={sheetForm.hours_done_in_pack} onChange={(value) => setSheetForm({ ...sheetForm, hours_done_in_pack: value })} />
                    <TextField id="sheet-remaining-hours" label={t('sheet.remainingHours')} value={sheetForm.remaining_hours_in_pack} onChange={(value) => setSheetForm({ ...sheetForm, remaining_hours_in_pack: value })} />
                  </div>
                  <CheckboxField
                    label={t('sheet.expenseAccessEnabled')}
                    checked={sheetForm.expense_access_enabled}
                    onChange={(checked) => setSheetForm({ ...sheetForm, expense_access_enabled: checked })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={upsertMemberSheetMutation.isPending} type="submit">
                      {t('actions.saveSheet')}
                    </Button>
                    <Button disabled={!selectedYearSheet || enableExpenseAccessMutation.isPending} type="button" variant="secondary" onClick={handleEnableExpenseAccess}>
                      {t('actions.enableExpenseAccess')}
                    </Button>
                    <Button disabled={!selectedYearSheet || disableExpenseAccessMutation.isPending} type="button" variant="ghost" onClick={handleDisableExpenseAccess}>
                      {t('actions.disableExpenseAccess')}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
      {showImportDialog && (
        <ImportDialog
          title={tCommon('import.button')}
          onUpload={(file) => importMembersMutation.mutateAsync(file)}
          sampleCsvHref="/docs/members-sample.csv"
          onClose={() => setShowImportDialog(false)}
        />
      )}
    </section>
  )
}

function SectionButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      className={[
        'rounded-2xl border p-4 text-left transition-colors',
        active
          ? 'border-white/40 bg-white/15 text-white'
          : 'border-white/10 bg-slate-950/10 text-emerald-50/80 hover:border-white/20 hover:bg-white/10',
      ].join(' ')}
      type="button"
      onClick={onClick}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm opacity-80">{description}</p>
    </button>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-400"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={`${id}-${option.value || 'empty'}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function Pill({ active, children }: { active: boolean; children: string }) {
  if (!active) {
    return null
  }

  return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{children}</span>
}
