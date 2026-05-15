import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '../../../api/client'

export const helloassoQueryKeys = {
  root: ['helloasso'] as const,
  settings: ['helloasso', 'settings'] as const,
}

export type HelloAssoSettings = {
  client_id: string
  client_secret: string
  environment: 'production' | 'test' | string
}

export type HelloAssoSettingsResponse = {
  module_name: string
  settings: HelloAssoSettings
  updated_at: string
  updated_by: number | null
}

export type HelloAssoConnectionTestResponse = {
  success: boolean
  message: string
  status_code: number | null
  organizations_count: number
  organization_slug: string | null
  details: Record<string, unknown>
}

const EMPTY_SETTINGS: HelloAssoSettings = {
  client_id: '',
  client_secret: '',
  environment: 'production',
}

export function useHelloAssoSettingsQuery(enabled: boolean) {
  return useQuery({
    queryKey: helloassoQueryKeys.settings,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<HelloAssoSettingsResponse>('/api/v1/helloasso/settings', getAuthRequestConfig())
      return data
    },
  })
}

export function useUpdateHelloAssoSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (settings: HelloAssoSettings) => {
      const { data } = await apiClient.put<HelloAssoSettingsResponse>(
        '/api/v1/helloasso/settings',
        settings,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: helloassoQueryKeys.settings })
    },
  })
}

export function useHelloAssoConnectionTestMutation() {
  return useMutation({
    mutationFn: async (settings: HelloAssoSettings) => {
      const { data } = await apiClient.post<HelloAssoConnectionTestResponse>(
        '/api/v1/helloasso/settings/test-connection',
        settings,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function helloassoSettingsFromResponse(response?: HelloAssoSettingsResponse | null): HelloAssoSettings {
  return response?.settings ?? EMPTY_SETTINGS
}
