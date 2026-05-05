export type MemberSummary = {
  uuid: string
  account_id: string
  first_name: string
  last_name: string
  email: string | null
  member_category: number
  is_active: boolean
  status: number
  registration_status: number
  can_fly: boolean
  is_instructor: boolean
  is_employee: boolean
  is_executive: boolean
  is_board_member: boolean
  committee_count: number
  has_member_sheet_for_year: boolean
  is_registered_for_year: boolean
}

export type CommitteeMembership = {
  committee_uuid: string
  member_uuid: string
  membership_year: number
  assigned_at: string
  assigned_by: number | null
}

export type MemberSheet = {
  uuid: string
  member_uuid: string
  year: number
  licence_number: string | null
  fare_type: number
  hours_count: string
  packs_bought_count: number
  hours_done_in_pack: string
  remaining_hours_in_pack: string
  expense_access_enabled: boolean
  created_at: string
  updated_at: string
}

export type MemberRegistration = {
  uuid: string
  member_uuid: string
  start_date: string
  end_date: string
  registered_for_year: number
  registration_type: number
  status: number
  registered_at: string
  registered_by: number | null
  notes: string | null
}

export type MemberDetail = {
  uuid: string
  genre: number
  first_name: string
  last_name: string
  date_of_birth: string | null
  email: string | null
  phone: string | null
  member_category: number
  first_subscription_year: number | null
  ffvp_id: number | null
  account_id: string
  legacy_account_id: string | null
  photo_url: string | null
  is_active: boolean
  status: number
  registration_status: number
  is_instructor: boolean
  is_employee: boolean
  is_executive: boolean
  is_board_member: boolean
  can_fly: boolean
  external_auth_enabled: boolean
  last_registration_date: string | null
  trigram: string | null
  notes: string | null
  created_at: string
  updated_at: string
  committees: CommitteeMembership[]
  member_sheets: MemberSheet[]
  registrations: MemberRegistration[]
}

export type Committee = {
  uuid: string
  code: string
  description: string
  budget_amount: string | null
  last_meeting_date: string | null
  budget_status: number | null
  manager_member_uuid: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ExpenseAccessResponse = {
  member_uuid: string
  year: number
  expense_access_enabled: boolean
  generated_token: string | null
}

export type MemberFilters = {
  search?: string
  status?: number
  member_category?: number
  registration_status?: number
  committee_uuid?: string
  can_fly?: boolean
  is_instructor?: boolean
  is_employee?: boolean
  is_executive?: boolean
  is_board_member?: boolean
  is_active?: boolean
  year?: number
  registration_state?: 'registered' | 'unregistered'
}

export type CreateMemberPayload = {
  genre: number
  first_name: string
  last_name: string
  date_of_birth?: string
  email?: string
  phone?: string
  member_category: number
  first_subscription_year?: number
  ffvp_id?: number
  account_id?: string
  legacy_account_id?: string
  photo_url?: string
  is_active: boolean
  status: number
  registration_status: number
  is_instructor: boolean
  is_employee: boolean
  is_executive: boolean
  is_board_member: boolean
  can_fly: boolean
  external_auth_enabled: boolean
  last_registration_date?: string
  trigram?: string
  notes?: string
}

export type UpdateMemberPayload = Partial<CreateMemberPayload>

export type RegistrationCompletionPayload = {
  year: number
  start_date: string
  end_date: string
  registration_type?: number
  accounting_template_uuid?: string
  committee_uuids?: string[]
  status: number
  notes?: string
}

export type CreateCommitteePayload = {
  code: string
  description: string
  budget_amount?: string
  last_meeting_date?: string
  budget_status?: number
  manager_member_uuid?: string
  is_active: boolean
}

export type UpdateCommitteePayload = Partial<CreateCommitteePayload>

export type ReplaceCommitteeMembersPayload = {
  member_uuids: string[]
}

export type UpsertMemberSheetPayload = {
  licence_number?: string
  fare_type: number
  hours_count: string
  packs_bought_count: number
  hours_done_in_pack: string
  remaining_hours_in_pack: string
  expense_access_enabled: boolean
}

export type ImportRowError = {
  row: number
  field: string | null
  message: string
}

export type ImportResult = {
  created: number
  updated?: number
  skipped: number
  errors: ImportRowError[]
}
