import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '../../../api/client'

export const storageQueryKeys = {
  root: ['storage'] as const,
  settings: ['storage', 'settings'] as const,
}

export type StorageSettings = {
  endpoint: string
  access_key: string
  secret_key: string
  bucket_name: string
  region: string
  use_ssl: boolean
  presigned_url_expiry_seconds: number
}

export type StorageSettingsResponse = {
  module_name: string
  settings: StorageSettings
  updated_at: string
  updated_by: number | null
}

export type StorageConnectionTestResponse = {
  success: boolean
  message: string
  bucket_exists: boolean | null
  details: Record<string, unknown>
}

const EMPTY_SETTINGS: StorageSettings = {
  endpoint: '',
  access_key: '',
  secret_key: '',
  bucket_name: '',
  region: 'us-east-1',
  use_ssl: true,
  presigned_url_expiry_seconds: 3600,
}

export function useStorageSettingsQuery(enabled: boolean) {
  return useQuery({
    queryKey: storageQueryKeys.settings,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<StorageSettingsResponse>('/api/v1/storage/settings', getAuthRequestConfig())
      return data
    },
  })
}

export function useUpdateStorageSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (settings: StorageSettings) => {
      const { data } = await apiClient.put<StorageSettingsResponse>(
        '/api/v1/storage/settings',
        settings,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: storageQueryKeys.settings })
    },
  })
}

export function useStorageConnectionTestMutation() {
  return useMutation({
    mutationFn: async (settings: StorageSettings) => {
      const { data } = await apiClient.post<StorageConnectionTestResponse>(
        '/api/v1/storage/test-connection',
        settings,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function storageSettingsFromResponse(response?: StorageSettingsResponse | null): StorageSettings {
  return response?.settings ?? EMPTY_SETTINGS
}
