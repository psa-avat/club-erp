export interface MemberPortalProfile {
  uuid: string
  account_id: string
  first_name: string
  last_name: string
  email: string | null
  member_category: number
}

export interface MemberPortalLoginResponse {
  access_token: string
  token_type: string
  expires_at: string
  member: MemberPortalProfile
}

export interface MemberPortalFlightItem {
  uuid: string
  jour: string | null
  type_of_flight: number | null
  type_label: string | null
  asset_code: string | null
  pilot_erp_id: string | null
  launch_method: number | null
  launch_asset_code: string | null
  takeoff_time: string | null
  landing_time: string | null
  billing_quote_state: string | null
  has_discount: boolean
  total_amount: string
}

export interface MemberPortalFlightListResponse {
  items: MemberPortalFlightItem[]
  total: number
}

export interface MemberPortalFlightBillingDetail {
  flight_uuid: string
  total_gross: string
  total_discount: string
  net_amount: string
  billing_hash: string | null
  applied_lines: MemberPortalBillingLine[]
  consumptions: MemberPortalConsumption[]
  entry_state: number | null
}

export interface MemberPortalBillingLine {
  source: string
  asset_code: string | null
  pricing_item_name: string | null
  quantity: string
  applied_unit_price: string
  amount: string
  discount_reason: string | null
}

export interface MemberPortalConsumption {
  pack_type: string
  quantity_consumed: string
  discount_unit_price: string
  total_discount_amount: string
  valid_from: string | null
}

export interface MemberPortalAccountSummary {
  current_balance: string
  pending_entries_count: number
  posted_entries_count: number
  active_packs: MemberPortalPackBalance[]
}

export interface MemberPortalPackBalance {
  pack_type: string
  pack_type_label: string
  total_purchased: string
  total_consumed: string
  units_remaining: string
}

export interface MemberPortalAccountEntry {
  uuid: string
  journal_code: string | null
  reference: string | null
  description: string | null
  entry_date: string | null
  state: number
  debit: string
  credit: string
}

export interface MemberPortalAccountEntriesResponse {
  items: MemberPortalAccountEntry[]
  total: number
}

export interface MemberPortalExpenseItem {
  uuid: string
  amount: string
  reason: string
  status: string
  created_at: string | null
}

export interface MemberPortalExpenseListResponse {
  items: MemberPortalExpenseItem[]
  total: number
}

export interface MemberPortalDepositRequest {
  amount: string
  payment_method: string
}

export interface MemberPortalDepositResponse {
  uuid: string
  amount: string
  status: string
  message: string
}
