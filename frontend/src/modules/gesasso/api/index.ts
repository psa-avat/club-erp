/*
    ERP-CLUB - ERP pour Club de vol à voile
    - gesasso: React Query hooks for GesAsso (FFVP) API
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

import { apiClient, getAuthRequestConfig } from '@/api/client'

export const gesassoQueryKeys = {
  settings: ['gesasso', 'settings'] as const,
  pilot: (ffvpId: number) => ['gesasso', 'pilot', ffvpId] as const,
  memberPilot: (memberUuid: string) => ['gesasso', 'member-pilot', memberUuid] as const,
}

export type GesAssoSettings = {
  base_url: string
  username: string
  secret: string
  association_code: string
}

export type RecentFlightItem = {
  uuid: string
  jour: string
  asset_code: string
  takeoff_time: string
  landing_time: string
  pilot_name: string
  pilot_erp_id: string
}

export type GesAssoSettingsResponse = {
  module_name: string
  settings: GesAssoSettings
  updated_at: string | null
  updated_by: number | null
}

export type GesAssoLicenceInfo = {
  licenceNumber: string | null
  seasonStartDate: string | null
  seasonEndDate: string | null
}

export type GesAssoPilotPersonalInfo = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone_number: string | null
  mobile_phone_number: string | null
  civility: string | null
  birth_date: string | null
  licence: GesAssoLicenceInfo | null
}

export type GesAssoPilotData = {
  ffvp_id: number
  personal_info: GesAssoPilotPersonalInfo
}

export function useGesAssoSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: gesassoQueryKeys.settings,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<GesAssoSettingsResponse>(
        '/api/v1/gesasso/settings',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useUpdateGesAssoSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: GesAssoSettings) => {
      const { data } = await apiClient.put<GesAssoSettingsResponse>(
        '/api/v1/gesasso/settings',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: gesassoQueryKeys.settings })
    },
  })
}

export function useGesAssoPilotLookupMutation() {
  return useMutation({
    mutationFn: async (ffvpId: number) => {
      const { data } = await apiClient.get<GesAssoPilotData>(
        `/api/v1/gesasso/pilot/${ffvpId}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useGesAssoMemberPilotDataMutation() {
  return useMutation({
    mutationFn: async (memberUuid: string) => {
      const { data } = await apiClient.get<GesAssoPilotData>(
        `/api/v1/gesasso/members/${memberUuid}/pilot-data`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export type TestFlightPushResult = {
  flight_uuid: string
  pilot_erp_id: string | null
  ffvp_id: string | null
  payload: Record<string, unknown>
  dry_run: boolean
  response_status: number | null
  response_body: unknown
  error: string | null
}

export function useRecentFlightsQuery(enabled = true) {
  return useQuery({
    queryKey: ['gesasso', 'recent-flights'] as const,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<RecentFlightItem[]>(
        '/api/v1/gesasso/recent-flights',
        getAuthRequestConfig(),
      )
      return data
    },
    staleTime: 60_000,
  })
}

export function useTestFlightPushMutation() {
  return useMutation({
    mutationFn: async (params: { flight_uuid: string; dry_run: boolean }) => {
      const { data } = await apiClient.post<TestFlightPushResult>(
        '/api/v1/gesasso/test-flight-push',
        params,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}
