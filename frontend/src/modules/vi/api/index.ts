/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: frontend API hooks for VI catalog, entitlements, planning and staging
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

export const viQueryKeys = {
  root: ['vi'] as const,
  types: ['vi', 'types'] as const,
  entitlements: (status?: number) => ['vi', 'entitlements', status ?? 'all'] as const,
  staging: ['vi', 'staging'] as const,
}

export type ViType = {
  uuid: string
  code: string
  name: string
  description: string | null
  is_active: boolean
}

export type ViEntitlement = {
  uuid: string
  code: string
  vi_type_uuid: string
  vi_type_code: string | null
  description: string | null
  validity_date: string | null
  scheduled_date: string | null
  realisation_date: string | null
  partner_code: string | null
  origin_type: number
  origin_ref: string | null
  notes: string | null
  status: number
  created_at: string
  updated_at: string
}

export type ViStagingRow = {
  uuid: string
  order_id: number
  item_id: number
  payment_id: number
  full_name: string | null
  email: string | null
  phone: string | null
  amount_cents: number | null
  campaign_type: string | null
  form_slug: string | null
  payment_state: string | null
  item_state: string | null
  purchased_at: string | null
  promoted_vi_uuid: string | null
  promoted_at: string | null
  status: number
}

export type ViImportPreview = {
  fetched_count: number
  net_new_count: number
  already_staged_count: number
}

export type ViImportResult = {
  fetched_count: number
  created_count: number
  duplicate_count: number
  staging_total_count: number
}

export type ViPromotionResult = {
  selected_count: number
  promoted_count: number
  already_promoted_count: number
  failed_count: number
  promoted_entitlement_uuids: string[]
}

export function useViTypesQuery() {
  return useQuery({
    queryKey: viQueryKeys.types,
    queryFn: async () => {
      const { data } = await apiClient.get<ViType[]>('/api/v1/vi/types', getAuthRequestConfig())
      return data
    },
  })
}

export function useCreateViTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { code: string; name: string; description?: string; is_active?: boolean }) => {
      const { data } = await apiClient.post<ViType>('/api/v1/vi/types', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.types })
    },
  })
}

export function useUpdateViTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ typeUuid, payload }: { typeUuid: string; payload: Partial<ViType> }) => {
      const { data } = await apiClient.patch<ViType>(`/api/v1/vi/types/${typeUuid}`, payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.types })
    },
  })
}

export function useViEntitlementsQuery(status?: number) {
  return useQuery({
    queryKey: viQueryKeys.entitlements(status),
    queryFn: async () => {
      const authConfig = getAuthRequestConfig()
      const { data } = await apiClient.get<ViEntitlement[]>('/api/v1/vi/entitlements', {
        ...(authConfig ?? {}),
        params: {
          status: typeof status === 'number' ? status : undefined,
        },
      })
      return data
    },
  })
}

export function useCreateViEntitlementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      code: string
      vi_type_uuid: string
      description?: string
      validity_date?: string | null
      scheduled_date?: string | null
      realisation_date?: string | null
      partner_code?: string | null
      origin_type?: number
      origin_ref?: string | null
      notes?: string | null
      status?: number
    }) => {
      const { data } = await apiClient.post<ViEntitlement>('/api/v1/vi/entitlements', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function usePatchViNotesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entitlementUuid, notes }: { entitlementUuid: string; notes: string | null }) => {
      const { data } = await apiClient.patch<ViEntitlement>(
        `/api/v1/vi/entitlements/${entitlementUuid}/notes`,
        { notes },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function useBulkScheduleViMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { entitlement_uuids: string[]; scheduled_date: string | null }) => {
      const { data } = await apiClient.post<{ success: boolean; updated_count: number }>(
        '/api/v1/vi/planning/bulk-schedule',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function useViStagingQuery() {
  return useQuery({
    queryKey: viQueryKeys.staging,
    queryFn: async () => {
      const { data } = await apiClient.get<ViStagingRow[]>('/api/v1/vi/staging', getAuthRequestConfig())
      return data
    },
  })
}

export function useHelloassoViPreviewMutation() {
  return useMutation({
    mutationFn: async (payload: { status: 'active' | 'done'; source: 'items' | 'orders'; campaign_type?: string; page_size?: number }) => {
      const { data } = await apiClient.post<ViImportPreview>('/api/v1/helloasso/vi/staging/preview', payload, getAuthRequestConfig())
      return data
    },
  })
}

export function useHelloassoViImportMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { status: 'active' | 'done'; source: 'items' | 'orders'; campaign_type?: string; page_size?: number }) => {
      const { data } = await apiClient.post<ViImportResult>('/api/v1/helloasso/vi/staging/import', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.staging })
    },
  })
}

export function usePromoteViStagingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { staging_uuids: string[]; vi_type_uuid?: string }) => {
      const { data } = await apiClient.post<ViPromotionResult>('/api/v1/vi/staging/promote', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}
