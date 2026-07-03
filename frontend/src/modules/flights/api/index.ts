/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - flights: API hooks for flight data and Planche flight fetch
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '../../../api/client'

export const flightsQueryKeys = {
  root: ['flights'] as const,
  list: (page: number, pageSize: number, filters: FlightListFilters) =>
    ['flights', 'list', { page, pageSize, ...filters }] as const,
  fetch: ['flights', 'fetch'] as const,
  billingPreview: (flightUuid: string) => ['flights', 'billing-preview', flightUuid] as const,
}

export type FlightListFilters = {
  date_from?: string
  date_to?: string
  type_of_flight?: number | null
  launch_method?: number | null
  pilot_query?: string
  asset_code?: string
  erp_status?: number | null
  unlinked_vi?: boolean
}

export type FlightFetchRequest = {
  from_date?: string | null
  to_date?: string | null
  cursor?: string | null
  limit?: number
}

export type FlightFetchResponse = {
  total: number
  created: number
  updated: number
  skipped: number
  idempotent: number
  snapshots_created: number
  modified_after_transfer: number
  next_cursor: string | null
  has_more: boolean
  error_details?: string[]
  failed_count?: number
  missing_required_field_count?: number
  constraint_violation_count?: number
}

export type ValidatedFlightItem = {
  uuid: string
  jour: string | null
  type_of_flight: number | null
  pilot_erp_id: string | null
  second_pilot_erp_id: string | null
  takeoff_time: string | null
  landing_time: string | null
  launch_method: number | null
  launch_asset_code: string | null
  launch_pilot_trigram: string | null
  charge_to_erp_id: string | null
  charge_comment: string | null
  asset_code: string | null
  glider_erp_id: string | null
  launch_machine_erp_id: string | null
  instruction_split: number | null
  aero: string | null
  pilot_name: string | null
  second_pilot_name: string | null
  second_pilot_trigram: string | null
  observations: string | null
  correction_reason: string | null
  vi_erp_id: string | null
  vi_linked?: boolean
}

export type ValidatedFlightListResponse = {
  items: ValidatedFlightItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}



export type FlightBillingError = {
  code: string
  message: string
  scope: string
  blocking: boolean
}

export type FlightBillingPayerPreview = {
  member_uuid: string | null
  member_account_id: string | null
  member_name: string | null
  role: string
  share: string
  reason: string
}

export type FlightBillingAppliedLinePreview = {
  source: string
  payer_member_uuid: string | null
  payer_member_account_id: string | null
  payer_role: string
  pricing_version_uuid: string | null
  pricing_item_uuid: string | null
  pricing_item_name: string | null
  asset_uuid: string | null
  asset_code: string | null
  quantity: string
  unit: number | null  // 1=flight_hours, 2=engine_min, 3=engine_1/100h, 4=duration, etc.
  normal_unit_price: string
  applied_unit_price: string
  discount_reason: string | null
  amount: string
  debit_account_code: string | null
  credit_account_code: string | null
  pack_hours_before: string | null
  pack_hours_used: string
  pack_hours_after: string | null
}

export type FlightAccountingLinePreview = {
  side: 'debit' | 'credit' | string
  account_uuid: string | null
  account_code: string | null
  tiers_uuid: string | null
  debit: string
  credit: string
  description: string | null
}

export type FlightBillingPreviewResponse = {
  flight_uuid: string
  planche_uuid: string | null
  flight_date: string | null
  type_of_flight: number | null
  type_label: string | null
  total_amount: string
  billing_hash: string | null
  payers: FlightBillingPayerPreview[]
  applied_lines: FlightBillingAppliedLinePreview[]
  accounting_lines: FlightAccountingLinePreview[]
  errors: FlightBillingError[]
  warnings: FlightBillingError[]
  can_apply: boolean
  no_bill: boolean
}

export type FlightStats = {
  total_flights: number
  by_status: Record<string, number>
  by_type: Record<string, number>
  by_launch_method: Record<string, number>
  unbilled_count: number
  instruction_split_count: number
  modified_after_transfer_count: number
  last_fetch_at: string | null
  cursor: string | null
  pending_planche_count: number | null
}

export const flightStatsQueryKey = ['flights', 'stats'] as const

export function useFlightStatsQuery() {
  return useQuery({
    queryKey: flightStatsQueryKey,
    queryFn: async () => {
      const { data } = await apiClient.get<FlightStats>('/api/v1/flights/stats', getAuthRequestConfig())
      return data
    },
  })
}

export function useFlightListQuery(page: number, pageSize: number, filters: FlightListFilters = {}) {
  return useQuery({
    queryKey: flightsQueryKeys.list(page, pageSize, filters),
    queryFn: async () => {
      // Build params, omitting null/undefined/empty values
      const params: Record<string, string | number> = { page, page_size: pageSize }
      if (filters.date_from) params.date_from = filters.date_from
      if (filters.date_to) params.date_to = filters.date_to
      if (filters.type_of_flight !== null && filters.type_of_flight !== undefined) {
        params.type_of_flight = filters.type_of_flight
      }
      if (filters.launch_method !== null && filters.launch_method !== undefined) {
        params.launch_method = filters.launch_method
      }
      if (filters.pilot_query?.trim()) params.pilot_query = filters.pilot_query.trim()
      if (filters.asset_code?.trim()) params.asset_code = filters.asset_code.trim()
      if (filters.erp_status !== null && filters.erp_status !== undefined) {
        params.erp_status = filters.erp_status
      }
      if (filters.unlinked_vi) params.unlinked_vi = 'true'

      const { data } = await apiClient.get<ValidatedFlightListResponse>(
        '/api/v1/flights',
        {
          ...(getAuthRequestConfig() ?? {}),
          params,
        },
      )
      return data
    },
  })
}

export function useFlightsFetchMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (request: FlightFetchRequest = {}) => {
      const { data } = await apiClient.post<FlightFetchResponse>(
        '/api/v1/flights/fetch',
        request,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['flights', 'list'] })
      await queryClient.invalidateQueries({ queryKey: ['planche', 'settings'] })
      await queryClient.invalidateQueries({ queryKey: flightStatsQueryKey })
    },
  })
}


export function useFlightBillingPreviewMutation() {
  return useMutation({
    mutationFn: async ({ flightUuid, fiscalYearUuid }: { flightUuid: string; fiscalYearUuid?: string | null }) => {
      const { data } = await apiClient.post<FlightBillingPreviewResponse>(
        `/api/v1/flights/${flightUuid}/billing-preview`,
        {},
        { ...getAuthRequestConfig(), params: { fiscal_year_uuid: fiscalYearUuid || undefined } },
      )
      return data
    },
  })
}


export function useUpdateFlightBillingFieldsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ flightUuid, payload }: { flightUuid: string; payload: { charge_to_erp_id?: string | null; charge_comment?: string | null } }) => {
      const { data } = await apiClient.patch<ValidatedFlightItem>(
        `/api/v1/flights/${flightUuid}/billing-fields`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['flights'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Federal sync (GesAsso / OSRT)
// ---------------------------------------------------------------------------

export type SyncStatusItem = {
  flight_uuid: string
  platform: string
  status: number
  external_id: string | null
  last_attempt_at: string | null
}

export type SyncResult = {
  status: string
  platform: string
  total: number
  synced: number
  failed: number
  already_transferred: number
  errors: string[]
}

export type SyncCandidateIssue = {
  code: string
  blocking: boolean
}

export type SyncCandidateItem = {
  flight_uuid: string
  jour: string | null
  pilot_name: string | null
  second_pilot_name: string | null
  asset_code: string | null
  type_of_flight: number
  status: number
  external_id: string | null
  last_attempt_at: string | null
  issues: SyncCandidateIssue[]
}

export type SyncCandidatesSummary = {
  pending: number
  sent: number
  failed: number
  blocked: number
}

export type SyncCandidatesResponse = {
  items: SyncCandidateItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
  summary: SyncCandidatesSummary
}

export type SyncCandidatesFilters = {
  dateFrom?: string
  dateTo?: string
  statusFilter?: 'pending' | 'sent' | 'failed' | 'blocked'
  page?: number
  pageSize?: number
}

export const federalSyncQueryKeys = {
  status: (platform: string) => ['flights', 'sync-status', platform] as const,
  candidates: (platform: string, filters: SyncCandidatesFilters) =>
    ['flights', 'sync-candidates', platform, filters] as const,
}

export function useFederalSyncStatusQuery(platform: "gesasso" | "osrt") {
  return useQuery<SyncStatusItem[]>({
    queryKey: federalSyncQueryKeys.status(platform),
    queryFn: async () => {
      const { data } = await apiClient.get<SyncStatusItem[]>(
        `/api/v1/flights/sync-status?platform=${platform}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useFederalSyncCandidatesQuery(platform: "gesasso", filters: SyncCandidatesFilters) {
  return useQuery<SyncCandidatesResponse>({
    queryKey: federalSyncQueryKeys.candidates(platform, filters),
    queryFn: async () => {
      const params = new URLSearchParams({ platform })
      if (filters.dateFrom) params.set('date_from', filters.dateFrom)
      if (filters.dateTo) params.set('date_to', filters.dateTo)
      if (filters.statusFilter) params.set('status_filter', filters.statusFilter)
      params.set('page', String(filters.page ?? 1))
      params.set('page_size', String(filters.pageSize ?? 50))
      const { data } = await apiClient.get<SyncCandidatesResponse>(
        `/api/v1/flights/sync-candidates?${params.toString()}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useFederalSyncMutation(platform: "gesasso" | "osrt") {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ flightUuids, force = false }: { flightUuids: string[]; force?: boolean }) => {
      const { data } = await apiClient.post<SyncResult>(
        `/api/v1/flights/sync-${platform}`,
        { flight_uuids: flightUuids, force },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['flights', 'sync-status', platform] })
      await queryClient.invalidateQueries({ queryKey: ['flights', 'sync-candidates', platform] })
    },
  })
}
