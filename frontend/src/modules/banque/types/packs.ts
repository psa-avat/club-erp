// ── Pack Definitions ──────────────────────────────────────────────────────────

export type ApplicableItem = {
  uuid: string
  pack_definition_uuid: string
  pricing_item_uuid: string
  discounted_unit_price: string
  created_at: string
}

export type PackDefinition = {
  uuid: string
  code: string
  name: string
  fiscal_year_uuid: string
  pack_type: 'flight_hours' | 'winch_launches' | 'tow_launches' | 'engine_time'
  quantity_allowance: string
  quantity_unit: string
  pack_sales_account_uuid: string | null
  rem_discount_account_uuid: string | null
  priority: number
  created_at: string
  applicability: ApplicableItem[]
}

export type PackDefinitionCreate = {
  code: string
  name: string
  fiscal_year_uuid: string
  pack_type: string
  quantity_allowance: string
  quantity_unit?: string
  pack_sales_account_uuid?: string | null
  rem_discount_account_uuid?: string | null
  priority?: number
  applicable_items?: { pricing_item_uuid: string; discounted_unit_price: string }[]
}

export type PackDefinitionUpdate = {
  name?: string
  quantity_allowance?: string
  eligible_asset_type_uuid?: string | null
  pack_sales_account_uuid?: string | null
  rem_discount_account_uuid?: string | null
  priority?: number
  applicable_items?: { pricing_item_uuid: string; discounted_unit_price: string }[]
}

// ── Member Pack Consumptions ──────────────────────────────────────────────────

export type MemberPackConsumption = {
  uuid: string
  member_uuid: string
  flight_uuid: string
  pack_type: string
  valid_from: string
  quantity_consumed: string
  discount_unit_price: string
  total_discount_amount: string
  accounting_entry_uuid: string | null
  created_at: string
}

export type MemberPackConsumptionCreate = {
  member_uuid: string
  flight_uuid: string
  pack_type: string
  valid_from: string
  quantity_consumed: string
  discount_unit_price: string
  total_discount_amount: string
  accounting_entry_uuid?: string | null
}

// ── Member Pack Balance ───────────────────────────────────────────────────────

export type MemberPackBalance = {
  member_uuid: string
  pack_type: string
  total_purchased: string
  total_consumed: string
  units_remaining: string
}
