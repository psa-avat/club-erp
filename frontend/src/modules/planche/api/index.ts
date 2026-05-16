import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '../../../api/client'

export const plancheQueryKeys = {
  root: ['planche'] as const,
  settings: ['planche', 'settings'] as const,
  pilotPushPreview: ['planche', 'pilots', 'push', 'preview'] as const,
  pilotsMissingErpId: ['planche', 'pilots', 'missing-erp-id'] as const,
  pilotsOrphaned: ['planche', 'pilots', 'orphaned'] as const,
}

export type PlanchePushError = {
  pilot_id?: string
  error_msg?: string
}

export type PlanchePilotsPushResponse = {
  success: boolean
  pushed_count: number
  failed_count: number
  errors: PlanchePushError[]
  last_synced_at: string | null
  sync_year?: number
  created_count?: number
  updated_count?: number
  repaired_erp_id_count?: number
  skipped_unchanged_count?: number
  processed_count?: number
  chunk_size?: number
  total_chunks?: number
  processed_chunks?: number
  dry_run?: boolean
  dry_run_eligible_count?: number
  dry_run_excluded_count?: number
}

export type PlanchePilotsPushRequest = {
  dry_run?: boolean
}

export type PlanchePilotsPushPreviewResponse = {
  sync_year: number
  eligible_count: number
  excluded_count: number
  excluded_not_registered_count: number
  excluded_inactive_count: number
  can_fly_true_count: number
  can_fly_false_count: number
  total_members_count: number
  last_synced_at: string | null
  // Planche reconciliation stats
  planche_total_pilots: number
  planche_pilots_with_erp_id: number
  planche_pilots_missing_erp_id: number
  erp_pilots_found_on_planche: number
  erp_pilots_not_on_planche: number
  planche_pilots_orphaned: number
}

export type PlanchePilot = {
  no?: string
  nom?: string
  prenom?: string
  ffvp?: string
  id_compta?: string
  erp_id?: string
  isActif?: number | boolean
}

export type PlanchePilotsListResponse = {
  pilots: PlanchePilot[]
  count: number
}

export type PlancheSettings = {
  base_url: string
  connection_id: string
  token: string
  user: string
  password: string
  environment: 'test' | 'production' | string
}

export type PlancheSettingsResponse = {
  module_name: string
  settings: PlancheSettings
  updated_at: string
  updated_by: number | null
}

export type PlancheConnectionTestResponse = {
  success: boolean
  message: string
  status_code: number | null
  details: Record<string, unknown>
}

export type PlancheLoginTestResponse = {
  success: boolean
  message: string
  status_code: number | null
  user_id: number | null
  roles: string[]
  login_token: string | null
  details: Record<string, unknown>
}

const EMPTY_SETTINGS: PlancheSettings = {
  base_url: '',
  connection_id: '',
  token: '',
  user: '',
  password: '',
  environment: 'test',
}

export function usePlancheSettingsQuery(enabled: boolean) {
  return useQuery({
    queryKey: plancheQueryKeys.settings,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<PlancheSettingsResponse>('/api/v1/planche/settings', getAuthRequestConfig())
      return data
    },
  })
}

export function useUpdatePlancheSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (settings: PlancheSettings) => {
      const { data } = await apiClient.put<PlancheSettingsResponse>(
        '/api/v1/planche/settings',
        settings,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: plancheQueryKeys.settings })
    },
  })
}

export function usePlancheConnectionTestMutation() {
  return useMutation({
    mutationFn: async (settings: PlancheSettings) => {
      const { data } = await apiClient.post<PlancheConnectionTestResponse>(
        '/api/v1/planche/settings/test-connection',
        settings,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function usePlancheLoginTestMutation() {
  return useMutation({
    mutationFn: async (settings: PlancheSettings) => {
      const { data } = await apiClient.post<PlancheLoginTestResponse>(
        '/api/v1/planche/settings/test-login',
        settings,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function usePilotsPushMutation() {
  return useMutation({
    mutationFn: async (request: PlanchePilotsPushRequest = {}) => {
      const { data } = await apiClient.post<PlanchePilotsPushResponse>(
        '/api/v1/planche/pilots/push',
        request,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function usePilotsPushPreviewQuery(enabled: boolean) {
  return useQuery({
    queryKey: plancheQueryKeys.pilotPushPreview,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<PlanchePilotsPushPreviewResponse>(
        '/api/v1/planche/pilots/push/preview',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function usePilotsMissingErpIdQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: plancheQueryKeys.pilotsMissingErpId,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<PlanchePilotsListResponse>(
        '/api/v1/planche/pilots/missing-erp-id',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function usePilotsOrphanedQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: plancheQueryKeys.pilotsOrphaned,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<PlanchePilotsListResponse>(
        '/api/v1/planche/pilots/orphaned',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function plancheSettingsFromResponse(response?: PlancheSettingsResponse | null): PlancheSettings {
  return response?.settings ?? EMPTY_SETTINGS
}
