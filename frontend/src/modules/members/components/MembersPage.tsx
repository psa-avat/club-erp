import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Dialog, DialogContent } from '../../../components/ui/dialog'
import { ImportDialog } from '../../../components/ui/ImportDialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { type AccountingEntryModel, useAccountingEntryModelsQuery } from '../../banque/api'
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
  first_subscription_year: string
  ffvp_id: string
  account_id: string
  legacy_account_id: string
  photo_url: string
  status: string
  registration_status: string
  is_instructor: boolean
  is_employee: boolean
  is_executive: boolean
  is_board_member: boolean
  can_fly: boolean
  external_auth_enabled: boolean
  trigram: string
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
  expense_access_enabled: boolean
}

type RegistrationFormState = {
  start_date: string
  end_date: string
  registration_type: string
  accounting_template_uuid: string
  notes: string
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

function createEmptyMemberForm(): MemberFormState {
  return {
    genre: '0',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    email: '',
    phone: '',
    member_category: '1',
    first_subscription_year: '',
    ffvp_id: '',
    account_id: '',
    legacy_account_id: '',
    photo_url: '',
    status: '1',
    registration_status: '1',
    is_instructor: false,
    is_employee: false,
    is_executive: false,
    is_board_member: false,
    can_fly: true,
    external_auth_enabled: false,
    trigram: '',
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
    expense_access_enabled: sheet?.expense_access_enabled ?? false,
  }
}

function createRegistrationForm(year: number, member?: MemberDetail | null): RegistrationFormState {
  return {
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    registration_type: member ? String(member.member_category) : '',
    accounting_template_uuid: '',
    notes: '',
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
    first_subscription_year: member.first_subscription_year === null ? '' : String(member.first_subscription_year),
    ffvp_id: member.ffvp_id === null ? '' : String(member.ffvp_id),
    account_id: member.account_id,
    legacy_account_id: member.legacy_account_id ?? '',
    photo_url: member.photo_url ?? '',
    status: String(member.status),
    registration_status: String(member.registration_status),
    is_instructor: member.is_instructor,
    is_employee: member.is_employee,
    is_executive: member.is_executive,
    is_board_member: member.is_board_member,
    can_fly: member.can_fly,
    external_auth_enabled: member.external_auth_enabled,
    trigram: member.trigram ?? '',
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
    ...(form.first_subscription_year ? { first_subscription_year: Number(form.first_subscription_year) } : {}),
    ...(form.ffvp_id ? { ffvp_id: Number(form.ffvp_id) } : {}),
    ...(form.account_id.trim() ? { account_id: form.account_id.trim() } : {}),
    ...(form.legacy_account_id.trim() ? { legacy_account_id: form.legacy_account_id.trim() } : {}),
    ...(form.photo_url.trim() ? { photo_url: form.photo_url.trim() } : {}),
    status: Number(form.status),
    registration_status: Number(form.registration_status),
    is_instructor: form.is_instructor,
    is_employee: form.is_employee,
    is_executive: form.is_executive,
    is_board_member: form.is_board_member,
    can_fly: form.can_fly,
    external_auth_enabled: form.external_auth_enabled,
    ...(form.trigram.trim() ? { trigram: form.trigram.trim().toUpperCase() } : {}),
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
  }
}

function buildMemberUpdatePayload(form: MemberFormState): UpdateMemberPayload {
  const { account_id, ...payload } = buildMemberPayload(form)
  void account_id
  return payload as UpdateMemberPayload
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
    7: 'External organization',
    8: 'Client / Supplier',
  }

  return map[category] ?? `#${category}`
}

function memberStatusLabel(status: number, t: (key: string) => string) {
  const map: Record<number, string> = {
    1: t('statuses.active'),
    2: t('statuses.suspended'),
    3: t('statuses.anonymized'),
  }

  return map[status] ?? `#${status}`
}

export function MembersPage() {
  const { t } = useTranslation('members')
  const { selectedMemberId, setSelectedMemberId, selectedYear, setSelectedYear, filters, setFilters } = useMembersStore()
  const [activeSection, setActiveSection] = useState<MembersSection>('members')
  const [memberForm, setMemberForm] = useState<MemberFormState>(() => createEmptyMemberForm())
  const [selectedCommitteeId, setSelectedCommitteeId] = useState<string | null>(null)
  const [committeeForm, setCommitteeForm] = useState<CommitteeFormState>(() => createCommitteeForm())
  const [committeeRoster, setCommitteeRoster] = useState<string[]>([])
  const [sheetForm, setSheetForm] = useState<SheetFormState>(() => createSheetForm())
  const [expenseToken, setExpenseToken] = useState<string | null>(null)
  const [registrationDialogOpen, setRegistrationDialogOpen] = useState(false)
  const [registrationForm, setRegistrationForm] = useState<RegistrationFormState>(() => createRegistrationForm(new Date().getFullYear()))
  const [registrationError, setRegistrationError] = useState<string | null>(null)

  const membersQuery = useMembersQuery(filters)
  const memberDetailQuery = useMemberQuery(selectedMemberId)
  const committeesQuery = useCommitteesQuery()
  const committeeMembersQuery = useCommitteeMembersQuery(selectedCommitteeId, selectedYear)
  const memberSheetsQuery = useMemberSheetsQuery(selectedMemberId)
  const accountingTemplatesQuery = useAccountingEntryModelsQuery(registrationDialogOpen && selectedMemberId !== null)

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
  const selectedTemplate = accountingTemplatesQuery.data?.find((template) => template.uuid === registrationForm.accounting_template_uuid)
  const isRegistrationCompleted = selectedMember?.registration_status === 3

  useEffect(() => {
    if (selectedMember) {
      setMemberForm(mapMemberToForm(selectedMember))
    } else {
      setMemberForm(createEmptyMemberForm())
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
    setMemberForm(createEmptyMemberForm())
  }

  async function handleMemberSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (selectedMemberId) {
      const updated = await updateMemberMutation.mutateAsync({
        memberUuid: selectedMemberId,
        payload: buildMemberUpdatePayload(memberForm),
      })
      setSelectedMemberId(updated.uuid)
      return
    }

    const payload = buildMemberPayload(memberForm)
    const created = await createMemberMutation.mutateAsync(payload)
    setSelectedMemberId(created.uuid)
  }

  function handleOpenRegistrationDialog() {
    if (!selectedMember) {
      return
    }
    setRegistrationForm(createRegistrationForm(selectedYear, selectedMember))
    setRegistrationError(null)
    setRegistrationDialogOpen(true)
  }

  async function handleCompleteRegistrationFromDialog() {
    if (!selectedMemberId || !selectedMember) {
      return
    }

    if (registrationForm.start_date === '' || registrationForm.end_date === '') {
      setRegistrationError(t('registrationWizard.errors.missingDates'))
      return
    }
    if (registrationForm.end_date < registrationForm.start_date) {
      setRegistrationError(t('registrationWizard.errors.invalidDateRange'))
      return
    }
    if (registrationForm.accounting_template_uuid === '') {
      setRegistrationError(t('registrationWizard.errors.templateRequired'))
      return
    }

    const completed = await completeRegistrationMutation.mutateAsync({
      memberUuid: selectedMemberId,
      payload: {
        year: selectedYear,
        start_date: registrationForm.start_date,
        end_date: registrationForm.end_date,
        registration_type: registrationForm.registration_type === '' ? undefined : Number(registrationForm.registration_type),
        accounting_template_uuid: registrationForm.accounting_template_uuid,
        notes: registrationForm.notes.trim() === '' ? undefined : registrationForm.notes.trim(),
        status: 1,
      },
    })
    setSelectedMemberId(completed.uuid)
    setRegistrationDialogOpen(false)
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

  const assignedCommitteesForYear = selectedMember
    ? selectedMember.committees.filter((membership) => membership.membership_year === selectedYear)
    : []
  const hasProfileChecklist =
    selectedMember !== null &&
    selectedMember.first_name.trim() !== '' &&
    selectedMember.last_name.trim() !== '' &&
    (selectedMember.email ?? '').trim() !== ''
  const hasCommitteeChecklist = assignedCommitteesForYear.length > 0
  const hasPeriodChecklist =
    registrationForm.start_date !== '' &&
    registrationForm.end_date !== '' &&
    registrationForm.end_date >= registrationForm.start_date
  const hasTemplateChecklist =
    registrationForm.accounting_template_uuid !== '' &&
    selectedTemplate !== undefined &&
    selectedTemplate.is_active
  const canSubmitRegistrationChecklist =
    hasProfileChecklist &&
    hasCommitteeChecklist &&
    hasPeriodChecklist &&
    hasTemplateChecklist

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1.8fr,1fr]">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('hero.title')}</h1>
            <p className="max-w-2xl text-sm text-slate-600">{t('hero.description')}</p>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500" htmlFor="members-year">
                {t('filters.year')}
              </Label>
              <Input
                id="members-year"
                className="h-9"
                type="number"
                value={selectedYear}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
              />
            </div>
            <Button size="sm" variant="secondary" type="button" onClick={handleNewMember}>
              {t('actions.newMember')}
            </Button>
            <Button size="sm" variant="secondary" type="button" onClick={() => setShowImportDialog(true)}>
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
                  { value: '7', label: t('categories.externalOrganization') },
                  { value: '8', label: t('categories.clientSupplier') },
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
                  { value: '3', label: t('statuses.anonymized') },
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
                        <span>{memberStatusLabel(member.status, t)}</span>
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
                {selectedMemberId ? (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
                    <div>
                      <p className="text-sm font-medium text-sky-900">{t('actions.completeRegistration')}</p>
                      <p className="text-xs text-sky-700">{t('registrationWizard.checklistTitle')}</p>
                    </div>
                    <Button disabled={completeRegistrationMutation.isPending} type="button" onClick={handleOpenRegistrationDialog}>
                      {t('actions.completeRegistration')}
                    </Button>
                  </div>
                ) : null}
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
                      { value: '7', label: t('categories.externalOrganization') },
                      { value: '8', label: t('categories.clientSupplier') },
                    ]}
                    value={memberForm.member_category}
                    onChange={(value) => setMemberForm({ ...memberForm, member_category: value })}
                  />
                  <TextField id="member-first-name" label={t('form.firstName')} value={memberForm.first_name} onChange={(value) => setMemberForm({ ...memberForm, first_name: value })} />
                  <TextField id="member-last-name" label={t('form.lastName')} value={memberForm.last_name} onChange={(value) => setMemberForm({ ...memberForm, last_name: value })} />
                  <TextField id="member-email" label={t('form.email')} type="email" value={memberForm.email} onChange={(value) => setMemberForm({ ...memberForm, email: value })} />
                  <TextField id="member-phone" label={t('form.phone')} value={memberForm.phone} onChange={(value) => setMemberForm({ ...memberForm, phone: value })} />
                  <TextField id="member-birthdate" label={t('form.birthDate')} type="date" value={memberForm.date_of_birth} onChange={(value) => setMemberForm({ ...memberForm, date_of_birth: value })} />
                  <TextField id="member-account-id" label={t('form.accountId')} value={memberForm.account_id} disabled={Boolean(selectedMemberId)} onChange={(value) => setMemberForm({ ...memberForm, account_id: value.toUpperCase() })} />
                  <TextField id="member-first-subscription-year" label={t('form.firstSubscriptionYear')} type="number" value={memberForm.first_subscription_year} onChange={(value) => setMemberForm({ ...memberForm, first_subscription_year: value })} />
                  <TextField id="member-ffvp" label={t('form.ffvp')} type="number" value={memberForm.ffvp_id} onChange={(value) => setMemberForm({ ...memberForm, ffvp_id: value })} />
                  <TextField id="member-trigram" label={t('form.trigram')} value={memberForm.trigram} onChange={(value) => setMemberForm({ ...memberForm, trigram: value.toUpperCase().slice(0, 3) })} />
                  <TextField id="member-legacy-account-id" label={t('form.legacyAccountId')} value={memberForm.legacy_account_id} onChange={(value) => setMemberForm({ ...memberForm, legacy_account_id: value })} />
                  <TextField id="member-photo-url" label={t('form.photoUrl')} value={memberForm.photo_url} onChange={(value) => setMemberForm({ ...memberForm, photo_url: value })} />
                  <SelectField
                    id="member-status"
                    label={t('form.status')}
                    options={[
                      { value: '1', label: t('statuses.active') },
                      { value: '2', label: t('statuses.suspended') },
                      { value: '3', label: t('statuses.anonymized') },
                    ]}
                    value={memberForm.status}
                    disabled={isRegistrationCompleted}
                    onChange={(value) => setMemberForm({ ...memberForm, status: value })}
                  />
                  <SelectField
                    id="member-registration-status"
                    label={t('form.registrationStatus')}
                    options={[
                      { value: '1', label: t('registration.pending') },
                      { value: '2', label: t('registration.completed') },
                    ]}
                    value={memberForm.registration_status}
                    disabled={isRegistrationCompleted}
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
                    <StatusField label={t('form.active')} value={(selectedMember?.status ?? 1) === 1 ? t('statuses.active') : t('states.inactive')} />
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
                      <Button disabled={completeRegistrationMutation.isPending} type="button" variant="secondary" onClick={handleOpenRegistrationDialog}>
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
                    <div></div>
                    <div></div>
                    <div></div>
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
      <Dialog open={registrationDialogOpen} onClose={() => setRegistrationDialogOpen(false)}>
        <DialogContent className="sm:max-w-lg" aria-labelledby="registration-checklist-title">
          <div className="space-y-5">
          <div className="space-y-1">
            <h2 id="registration-checklist-title" className="text-lg font-semibold text-slate-900">
              {t('registrationWizard.title', { year: selectedYear })}
            </h2>
            <p className="text-sm text-slate-600">
              {selectedMember ? `${selectedMember.first_name} ${selectedMember.last_name}` : t('sheet.selectMember')}
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">{t('registrationWizard.checklistTitle')}</p>
            <ChecklistRow passed={hasProfileChecklist} label={t('registrationWizard.checks.profile')} />
            <ChecklistRow passed={hasCommitteeChecklist} label={t('registrationWizard.checks.committee', { count: assignedCommitteesForYear.length })} />
            <ChecklistRow passed={hasPeriodChecklist} label={t('registrationWizard.checks.period')} />
            <ChecklistRow passed={hasTemplateChecklist} label={t('registrationWizard.checks.template')} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              id="registration-start-date"
              label={t('registrationPeriod.startDate')}
              type="date"
              value={registrationForm.start_date}
              onChange={(value) => {
                setRegistrationError(null)
                setRegistrationForm((prev) => ({ ...prev, start_date: value }))
              }}
            />
            <TextField
              id="registration-end-date"
              label={t('registrationPeriod.endDate')}
              type="date"
              value={registrationForm.end_date}
              onChange={(value) => {
                setRegistrationError(null)
                setRegistrationForm((prev) => ({ ...prev, end_date: value }))
              }}
            />
            <SelectField
              id="registration-type"
              label={t('registrationPeriod.type')}
              options={[
                { value: '', label: t('registrationPeriod.useMemberCategory') },
                { value: '1', label: t('categories.full') },
                { value: '2', label: t('categories.temporary') },
                { value: '3', label: t('categories.nonFlying') },
                { value: '4', label: t('categories.shortPeriod') },
                { value: '5', label: t('categories.externalPilot') },
                { value: '6', label: t('categories.volunteer') },
                { value: '7', label: t('categories.externalOrganization') },
                { value: '8', label: t('categories.clientSupplier') },
              ]}
              value={registrationForm.registration_type}
              onChange={(value) => {
                setRegistrationError(null)
                setRegistrationForm((prev) => ({ ...prev, registration_type: value }))
              }}
            />
            <SelectField
              id="registration-template"
              label={t('registrationWizard.templateLabel')}
              options={[
                { value: '', label: t('registrationWizard.templatePlaceholder') },
                ...((accountingTemplatesQuery.data ?? []).map((template: AccountingEntryModel) => ({
                  value: template.uuid,
                  label: `${template.code} · ${template.name}`,
                }))),
              ]}
              value={registrationForm.accounting_template_uuid}
              onChange={(value) => {
                setRegistrationError(null)
                setRegistrationForm((prev) => ({ ...prev, accounting_template_uuid: value }))
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="registration-notes">{t('registrationPeriod.notes')}</Label>
            <textarea
              id="registration-notes"
              className="min-h-24 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-400"
              value={registrationForm.notes}
              onChange={(event) => {
                setRegistrationError(null)
                setRegistrationForm((prev) => ({ ...prev, notes: event.target.value }))
              }}
            />
          </div>

          {accountingTemplatesQuery.error ? <Alert>{toErrorMessage(accountingTemplatesQuery.error)}</Alert> : null}
          {registrationError ? <Alert>{registrationError}</Alert> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRegistrationDialogOpen(false)}>
              {t('actions.reset')}
            </Button>
            <Button
              type="button"
              disabled={completeRegistrationMutation.isPending || !canSubmitRegistrationChecklist}
              onClick={handleCompleteRegistrationFromDialog}
            >
              {t('actions.completeRegistration')}
            </Button>
          </div>
      </div>
        </DialogContent>
      </Dialog>
      {showImportDialog && (
        <ImportDialog
          title={tCommon('import.button')}
          onUpload={(file, options) => importMembersMutation.mutateAsync({ file, updateExisting: options.updateExisting })}
          showUpdateExistingToggle
          sampleCsvHref="/samples/members-sample.csv"
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
  disabled = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function SelectField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        disabled={disabled}
        className={[
          'flex h-10 w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none',
          disabled
            ? 'border-slate-100 bg-slate-100 text-slate-500'
            : 'border-slate-200 bg-white text-slate-900 focus:border-slate-400',
        ].join(' ')}
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
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>
      <input disabled={disabled} checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function StatusField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex h-10 items-center rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
        {value}
      </div>
    </div>
  )
}

function Pill({ active, children }: { active: boolean; children: string }) {
  if (!active) {
    return null
  }

  return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{children}</span>
}

function ChecklistRow({ passed, label }: { passed: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700">
      <span
        aria-hidden="true"
        className={[
          'inline-block h-2.5 w-2.5 rounded-full',
          passed ? 'bg-emerald-500' : 'bg-amber-500',
        ].join(' ')}
      />
      <span>{label}</span>
    </div>
  )
}
