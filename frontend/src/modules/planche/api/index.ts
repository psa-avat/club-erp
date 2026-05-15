import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '../../../api/client'

export const plancheQueryKeys = {
  root: ['planche'] as const,
  settings: ['planche', 'settings'] as const,
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

export function plancheSettingsFromResponse(response?: PlancheSettingsResponse | null): PlancheSettings {
  return response?.settings ?? EMPTY_SETTINGS
}
