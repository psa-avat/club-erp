/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Assets module types
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

// ── Asset Families ──────────────────────────────────────────────────────────────

export type AssetFamily = {
  uuid: string
  code: string
  name: string
  /** 1=PerHour, 2=PerLaunch, 3=PerFlight, 4=Pack, 5=Subscription, 6=Fixed */
  pricing_strategy: number
  is_active: boolean
  /** Whether this family is expected to carry a flight tariff (pricing_versions). */
  is_priced: boolean
  acquisition_account_uuid: string | null
  acquisition_account_code: string | null
  depreciation_account_uuid: string | null
  depreciation_account_code: string | null
  charge_account_uuid: string | null
  charge_account_code: string | null
  revenue_account_uuid: string | null
  revenue_account_code: string | null
  updated_at: string
}

/** Narrow patch type for the family accounting-configuration section. */
export type AssetFamilyAccountingPatch = {
  acquisition_account_uuid?: string | null
  depreciation_account_uuid?: string | null
  charge_account_uuid?: string | null
  revenue_account_uuid?: string | null
}

export type FlightType = {
  uuid: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  launch_type: number | null
  updated_at: string
}

export type CreateFlightTypePayload = {
  code: string
  name: string
  description?: string | null
  is_active?: boolean
  launch_type?: number | null
}

export type UpdateFlightTypePayload = {
  name?: string
  description?: string | null
  is_active?: boolean
  launch_type?: number | null
}

// ── Asset ─────────────────────────────────────────────────────────────────────

export type AssetSummary = {
  uuid: string
  code: string
  name: string
  asset_family_uuid: string
  asset_family?: AssetFamily | null
  asset_family_name?: string
  parent_asset_uuid: string | null
  parent_asset_code?: string | null
  parent_asset_name?: string | null
  current_price_version?: string | null
  current_price_version_name?: string | null
  pricing_version?: string | null
  /** 1=Operational, 2=Maintenance, 3=OutOfService, 4=Disposed, 5=Sold */
  status: number
  /** 1=Club, 2=Private */
  ownership: number
  owner_member_uuids?: string[]
  owner_members?: AssetOwner[]
  is_active: boolean
  is_bookable: boolean
}

/** Minimal shape for an asset's children, from GET /assets/{uuid}/children. */
export type AssetChild = {
  uuid: string
  code: string
  name: string
  purchase_price: string | null
  status: number
  is_bookable: boolean
}

export type AssetStatusHistoryEntry = {
  uuid: string
  asset_uuid: string
  status: number
  reason: string | null
  changed_at: string
  changed_by: number | null
}

export type AssetOwner = {
  uuid: string
  account_id: string
  first_name: string
  last_name: string
}

export type AssetDetail = {
  uuid: string
  code: string
  name: string
  asset_family_uuid: string
  parent_asset_uuid: string | null
  parent_asset_code: string | null
  parent_asset_name: string | null
  registration: string | null
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  year_of_manufacture: number | null
  /** 1=Club, 2=Private */
  ownership: number
  owner_member_uuids: string[]
  owner_members: AssetOwner[]
  /** 1=Operational, 2=Maintenance, 3=OutOfService, 4=Disposed, 5=Sold */
  status: number
  is_bookable: boolean
  // Raw per-asset overrides (null = inherits the family default)
  acquisition_account_uuid: string | null
  depreciation_account_uuid: string | null
  charge_account_uuid: string | null
  revenue_account_uuid: string | null
  // Resolved accounts: asset override if set, else the family's default
  effective_acquisition_account_uuid: string | null
  effective_acquisition_account_code: string | null
  effective_depreciation_account_uuid: string | null
  effective_depreciation_account_code: string | null
  effective_charge_account_uuid: string | null
  effective_charge_account_code: string | null
  effective_revenue_account_uuid: string | null
  effective_revenue_account_code: string | null
  accounting_account_code_snapshot: string | null
  purchase_date: string | null
  purchase_price: string | null
  depreciation_start_date: string | null
  depreciation_duration_months: number | null
  residual_value: string | null
  is_active: boolean
  osrt_sync_enabled: boolean
  created_at: string
  updated_at: string
}

export type CreateAssetFamilyPayload = {
  code: string
  name: string
  is_active?: boolean
  is_priced?: boolean
  acquisition_account_uuid?: string | null
  depreciation_account_uuid?: string | null
  charge_account_uuid?: string | null
  revenue_account_uuid?: string | null
}

export type UpdateAssetFamilyPayload = {
  name?: string
  is_active?: boolean
  is_priced?: boolean
  acquisition_account_uuid?: string | null
  depreciation_account_uuid?: string | null
  charge_account_uuid?: string | null
  revenue_account_uuid?: string | null
}

export type AssetFilters = {
  asset_family_uuid?: string
  parent_asset_uuid?: string
  is_bookable?: boolean
  status?: number
  ownership?: number
  is_active?: boolean
}

export type CreateAssetPayload = {
  code: string
  name: string
  asset_family_uuid: string
  parent_asset_uuid?: string | null
  registration?: string | null
  serial_number?: string | null
  manufacturer?: string | null
  model?: string | null
  year_of_manufacture?: number | null
  ownership: number
  owner_member_uuids?: string[]
  is_bookable?: boolean
  acquisition_account_uuid?: string | null
  depreciation_account_uuid?: string | null
  charge_account_uuid?: string | null
  revenue_account_uuid?: string | null
  purchase_date?: string | null
  purchase_price?: string | null
  depreciation_start_date?: string | null
  depreciation_duration_months?: number | null
  residual_value?: string | null
  osrt_sync_enabled?: boolean
}

export type UpdateAssetPayload = Partial<CreateAssetPayload> & {
  /** Set to true to detach this asset from its parent (clears parent_asset_uuid). */
  clear_parent_asset?: boolean
}

export type AssetStatusTransitionPayload = {
  status: number
  reason?: string | null
}

// ── Pricing Items ─────────────────────────────────────────────────────────────

export type PricingItemTier = {
  uuid: string
  from_qty: string
  price: string
  sort_order: number
}

export type TierPayload = {
  from_qty: string
  price: string
}

export type PricingItem = {
  uuid: string
  pricing_version_uuid: string
  flight_type_uuid: string | null
  name: string
  /** 1=FlightTime, 2=EngineTimeMin, 3=EngineTime1/100h, 4=FlightDuration, 5=PerFlight, 6=Fixed, 7=FixedDurationTranche */
  unit: number
  base_price: string
  /** When true, tiers are applied progressively (each bracket at its own rate) */
  is_progressive: boolean
  /** Percentage discount applied when member is under-25 eligible (0 = no discount) */
  age_discount_percent: string
  /** Revenue account credited at billing time (null until configured) */
  gl_account_credit_uuid: string | null
  /** Progressive pricing brackets; sorted ascending by from_qty */
  tiers: PricingItemTier[]
  created_at: string
  updated_at: string
}


export type CreatePricingItemPayload = {
  flight_type_uuid?: string | null
  name: string
  unit: number
  base_price: string
  /** When true, tiers are applied progressively (each bracket at its own rate) */
  is_progressive?: boolean
  /** Percentage discount for under-25 members; omit or send "0" for no discount */
  age_discount_percent?: string
  /** Revenue account UUID (class 7) to credit at billing time */
  gl_account_credit_uuid?: string | null
  tiers?: TierPayload[]
}

export type UpdatePricingItemPayload = Partial<CreatePricingItemPayload>

export type ReplaceTiersPayload = TierPayload[]

// ── Pricing Version (asset-scoped extension) ──────────────────────────────────

export type AssetPricingVersion = {
  uuid: string
  fiscal_year_uuid: string
  asset_family_uuid: string | null
  name: string
  from_date: string
  to_date: string | null
  status: number
  is_locked: boolean
  use_pack: boolean
  created_at: string
  updated_at: string
}

export type ImportRowError = {
  row: number
  field: string | null
  message: string
}

export type ImportResult = {
  created: number
  skipped: number
  errors: ImportRowError[]
}
