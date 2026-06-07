export type MembersScreen = 'core' | 'external' | 'business'

export type MemberSummary = {
  uuid: string
  account_id: string
  ffvp_id?: string | number | null
  first_name: string
  last_name: string
  email: string | null
  member_category: number
  status: number
  registration_status: number
  can_fly: boolean
  is_instructor: boolean
  is_employee: boolean
  is_executive: boolean
  is_board_member: boolean
  last_registration_year?: number | null
  registration_start_date_for_year?: string | null
  registration_end_date_for_year?: string | null
  committee_count: number
  has_member_sheet_for_year: boolean
  is_registered_for_year: boolean
  last_flight_date?: string | null
  balance?: string | number | null
}

export type MemberOption = {
  uuid: string
  account_id: string
  first_name: string
  last_name: string
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
  member_categories?: number[]
  registration_status?: number
  committee_uuid?: string
  can_fly?: boolean
  is_instructor?: boolean
  is_employee?: boolean
  is_executive?: boolean
  is_board_member?: boolean
  last_registration_year?: number
  year?: number
  registration_state?: 'registered' | 'unregistered'
  limit?: number
  offset?: number
  include_balance?: boolean
  include_last_flight?: boolean
  has_flown_since?: string
  balance_min?: string
  balance_max?: string
  fiscal_year_uuid?: string
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
  pricing_item_uuids?: string[]
  accounting_entry_date?: string
  committee_uuids?: string[]
  status: number
  notes?: string
}

export type UpdateMemberRegistrationPayload = {
  start_date?: string
  end_date?: string
  registered_for_year?: number
  registration_type?: number
  status?: number
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

// ── Logbook ──────────────────────────────────────────────────────────────

export type LogbookFilters = {
  year?: number
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
  group_by?: 'machine' | 'type' | 'launch'
}

export type LogbookItem = {
  flight_uuid: string
  flight_date: string
  type_of_flight: number
  type_label: string | null
  launch_method: number
  launch_label: string | null
  role: string | null
  pilot_name: string | null
  second_pilot_name: string | null
  asset_code: string | null
  takeoff_time: string | null
  landing_time: string | null
  duration_minutes: number | null
  flight_km: number | null
  engine_time: number | null
  billing_quote_state: string | null
  has_discount: boolean
  gross_amount: string | null
  net_amount: string | null
  errors: string[]
}

export type LogbookSummary = {
  total_flight_count: number
  total_duration_minutes: number
  total_km: number
  pilot_duration_minutes: number
  second_pilot_duration_minutes: number
  supervised_flight_count: number
  supervised_duration_minutes: number
}

export type LogbookGroupedItem = {
  group_key: string
  group_label: string
  flight_count: number
  total_duration_minutes: number
  total_km: number
}

export type LogbookResponse = {
  items: LogbookItem[]
  total: number
  summary: LogbookSummary
  grouped: LogbookGroupedItem[]
}

// ── Account / Balance ────────────────────────────────────────────────────────

export type AccountSummary = {
  current_balance: string
  pending_total: string
  posted_total: string
  currency: string
}

export type AccountEntryItem = {
  entry_uuid: string
  entry_date: string | null
  journal_code: string | null
  description: string | null
  reference: string | null
  state: number
  debit: string
  credit: string
}

export type AccountEntriesResponse = {
  items: AccountEntryItem[]
  total: number
}

export type DepositRequest = {
  amount: string
  payment_method: string
  reference?: string
  deposit_date?: string
}

export type DepositResponse = {
  deposit_uuid: string
  entry_uuid: string
  amount: string
  status: string
  message: string
}
