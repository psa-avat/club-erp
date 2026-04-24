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

// ── Asset Types ───────────────────────────────────────────────────────────────

export type AssetType = {
  uuid: string
  code: string
  name: string
  /** 1=Glider, 2=Tow, 3=Simulator, 4=Winch, 5=Other */
  category: number
  /** 1=PerHour, 2=PerLaunch, 3=PerFlight, 4=Pack, 5=Subscription, 6=Fixed */
  pricing_strategy: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type FlightType = {
  uuid: string
  asset_type_uuid: string
  code: string
  name: string
  is_active: boolean
  created_at: string
}

// ── Asset ─────────────────────────────────────────────────────────────────────

export type AssetSummary = {
  uuid: string
  code: string
  name: string
  asset_type_uuid: string
  asset_type_name: string
  /** 1=Operational, 2=Maintenance, 3=OutOfService, 4=Disposed */
  status: number
  /** 1=Club, 2=Private */
  ownership: number
  is_active: boolean
}

export type AssetStatusHistoryEntry = {
  uuid: string
  asset_uuid: string
  status: number
  reason: string | null
  changed_at: string
  changed_by: number | null
}

export type AssetDetail = {
  uuid: string
  code: string
  name: string
  asset_type_uuid: string
  registration_number: string | null
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  year_of_manufacture: number | null
  /** 1=Club, 2=Private */
  ownership: number
  owner_member_uuid: string | null
  /** 1=Operational, 2=Maintenance, 3=OutOfService, 4=Disposed */
  status: number
  acquisition_account_uuid: string | null
  accounting_account_code_snapshot: string | null
  purchase_date: string | null
  purchase_price: string | null
  depreciation_start_date: string | null
  depreciation_duration_months: number | null
  residual_value: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  status_history: AssetStatusHistoryEntry[]
}

export type CreateAssetTypePayload = {
  code: string
  name: string
  /** 1=Aircraft 2=LaunchEquipment 3=Support 4=Consumable 5=Service */
  category: number
  /** 1=FlightHours 2=EngineTime 3=PerFlight 4=PerDuration 5=PerUnit 6=FlatRate */
  pricing_strategy: number
  is_active?: boolean
}

export type UpdateAssetTypePayload = {
  name?: string
  category?: number
  pricing_strategy?: number
  is_active?: boolean
}

export type AssetFilters = {
  asset_type_uuid?: string
  status?: number
  ownership?: number
  is_active?: boolean
}

export type CreateAssetPayload = {
  code: string
  name: string
  asset_type_uuid: string
  registration_number?: string | null
  serial_number?: string | null
  manufacturer?: string | null
  model?: string | null
  year_of_manufacture?: number | null
  ownership: number
  owner_member_uuid?: string | null
  acquisition_account_uuid?: string | null
  purchase_date?: string | null
  purchase_price?: string | null
  depreciation_start_date?: string | null
  depreciation_duration_months?: number | null
  residual_value?: string | null
}

export type UpdateAssetPayload = Partial<CreateAssetPayload>

export type AssetStatusTransitionPayload = {
  status: number
  reason?: string | null
}

// ── Pricing Items ─────────────────────────────────────────────────────────────

export type PricingItem = {
  uuid: string
  pricing_version_uuid: string
  asset_flight_type_uuid: string | null
  name: string
  /** 1=PerHour, 2=PerMinute, 3=PerLaunch, 4=PerFlight, 5=Fixed */
  unit: number
  base_price: string
  threshold_unit_count: string | null
  threshold_price: string | null
  pack_unit_count: string | null
  pack_price: string | null
  include_insurance: boolean
  include_fuel: boolean
  created_at: string
  updated_at: string
}

export type CreatePricingItemPayload = {
  asset_flight_type_uuid?: string | null
  name: string
  unit: number
  base_price: string
  threshold_unit_count?: string | null
  threshold_price?: string | null
  pack_unit_count?: string | null
  pack_price?: string | null
  include_insurance?: boolean
  include_fuel?: boolean
}

export type UpdatePricingItemPayload = Partial<CreatePricingItemPayload>

// ── Pricing Version (asset-scoped extension) ──────────────────────────────────

export type AssetPricingVersion = {
  uuid: string
  fiscal_year_uuid: string
  asset_type_uuid: string | null
  name: string
  from_date: string
  to_date: string | null
  status: number
  is_locked: boolean
  created_at: string
  updated_at: string
}
