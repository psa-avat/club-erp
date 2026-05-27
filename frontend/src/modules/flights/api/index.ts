/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - flights: API hooks for flight data and Planche flight pull
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
  pull: ['flights', 'pull'] as const,
}

export type FlightListFilters = {
  date_from?: string
  date_to?: string
  type_of_flight?: number | null
  launch_method?: number | null
  pilot_query?: string
  asset_code?: string
  erp_status?: number | null
}

export type FlightPullRequest = {
  from_date?: string | null
  to_date?: string | null
  cursor?: string | null
  limit?: number
}

export type FlightPullResponse = {
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
  asset_code: string | null
  glider_erp_id: string | null
  launch_machine_erp_id: string | null
  instruction_split: number | null
  aero: string | null
  pilot_name: string | null
  second_pilot_name: string | null
  second_pilot_trigram: string | null
}

export type ValidatedFlightListResponse = {
  items: ValidatedFlightItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
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

export function useFlightsPullMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (request: FlightPullRequest = {}) => {
      const { data } = await apiClient.post<FlightPullResponse>(
        '/api/v1/flights/pull',
        request,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['flights', 'list'] })
    },
  })
}
