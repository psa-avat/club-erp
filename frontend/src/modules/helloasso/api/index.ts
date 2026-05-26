import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '../../../api/client'

export const helloassoQueryKeys = {
  root: ['helloasso'] as const,
  settings: ['helloasso', 'settings'] as const,
  purchases: (status: HelloAssoPurchaseStatus, source: HelloAssoPurchaseSource, campaignTypes: string[]) => ['helloasso', 'purchases', status, source, ...campaignTypes] as const,
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

export type HelloAssoPurchaseStatus = 'active' | 'done'
export type HelloAssoPurchaseSource = 'items' | 'orders'

export type HelloAssoPurchaseRecord = {
  id: number
  order_id: number | null
  item_id: number | null
  source: HelloAssoPurchaseSource
  campaign_type: string | null
  form_slug: string | null
  item_state: string | null
  payment_state: string | null
  date: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  amount_cents: number | null
  payment_ids: number[]
}

export type HelloAssoPurchasesResponse = {
  organization_slug: string
  status: HelloAssoPurchaseStatus
  source: HelloAssoPurchaseSource
  campaign_type: string | null
  count: number
  purchases: HelloAssoPurchaseRecord[]
}

export type HelloAssoItemDetailsResponse = {
  organization_slug: string
  item_id: number
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

export function useHelloAssoPurchasesQuery(status: HelloAssoPurchaseStatus, source: HelloAssoPurchaseSource, campaignTypes: string[], enabled: boolean) {
  return useQuery({
    queryKey: helloassoQueryKeys.purchases(status, source, campaignTypes),
    enabled,
    queryFn: async () => {
      const authConfig = getAuthRequestConfig()
      const { data } = await apiClient.get<HelloAssoPurchasesResponse>(
        '/api/v1/helloasso/purchases',
        {
          ...(authConfig ?? {}),
          params: {
            status,
            source,
            campaign_type: campaignTypes.length > 0 ? campaignTypes.join(',') : undefined,
          },
        },
      )
      return data
    },
  })
}

export function useHelloAssoItemDetailsMutation() {
  return useMutation({
    mutationFn: async (itemId: number) => {
      const { data } = await apiClient.get<HelloAssoItemDetailsResponse>(
        `/api/v1/helloasso/items/${itemId}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function helloassoSettingsFromResponse(response?: HelloAssoSettingsResponse | null): HelloAssoSettings {
  return response?.settings ?? EMPTY_SETTINGS
}
