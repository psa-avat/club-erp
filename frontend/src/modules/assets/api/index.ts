/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Assets module API hooks
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
import type {
  AssetCategory,
  AssetDetail,
  AssetFilters,
  AssetPricingVersion,
  AssetStatusHistoryEntry,
  AssetStatusTransitionPayload,
  AssetSummary,
  AssetFamily,
  CreateAssetPayload,
  CreateAssetCategoryPayload,
  CreateAssetFamilyPayload,
  CreateFlightTypePayload,
  CreatePricingItemPayload,
  FlightType,
  ImportResult,
  PricingItem,
  ReplaceTiersPayload,
  UpdateAssetPayload,
  UpdateAssetCategoryPayload,
  UpdateAssetFamilyPayload,
  UpdateFlightTypePayload,
  UpdatePricingItemPayload,
} from '../types'

// ── Query Keys ────────────────────────────────────────────────────────────────

export const assetsQueryKeys = {
  root: ['assets'] as const,
  categories: () => ['assets', 'categories'] as const,
  families: () => ['assets', 'families'] as const,
  flightTypes: () => ['assets', 'flight-types'] as const,
  list: (filters: AssetFilters) => ['assets', 'list', filters] as const,
  detail: (uuid: string) => ['assets', 'detail', uuid] as const,
  statusHistory: (uuid: string) => ['assets', 'status-history', uuid] as const,
  pricingVersions: (assetFamilyUuid: string) =>
    ['assets', 'pricing-versions', assetFamilyUuid] as const,
  pricingItems: (versionUuid: string) => ['assets', 'pricing-items', versionUuid] as const,
}

function compactParams(obj: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
}

// ── Asset Categories ─────────────────────────────────────────────────────────────

export function useAssetCategoriesQuery(enabled = true) {
  return useQuery({
    queryKey: assetsQueryKeys.categories(),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AssetCategory[]>('/api/v1/assets/categories', getAuthRequestConfig())
      return data
    },
  })
}

export function useCreateAssetCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateAssetCategoryPayload) => {
      const { data } = await apiClient.post<AssetCategory>('/api/v1/assets/categories', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.categories() })
    },
  })
}

export function useUpdateAssetCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, ...payload }: UpdateAssetCategoryPayload & { uuid: string }) => {
      const { data } = await apiClient.patch<AssetCategory>(
        `/api/v1/assets/categories/${uuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.categories() })
    },
  })
}

export function useDeleteAssetCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (uuid: string) => {
      await apiClient.delete(`/api/v1/assets/categories/${uuid}`, getAuthRequestConfig())
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.categories() })
    },
  })
}

// ── Asset Families ───────────────────────────────────────────────────────────────

export function useAssetFamiliesQuery(enabled = true) {
  return useQuery({
    queryKey: assetsQueryKeys.families(),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AssetFamily[]>('/api/v1/assets/families', getAuthRequestConfig())
      return data
    },
  })
}

export function useCreateAssetFamilyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateAssetFamilyPayload) => {
      const { data } = await apiClient.post<AssetFamily>('/api/v1/assets/families', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.families() })
    },
  })
}

export function useUpdateAssetFamilyMutation(uuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UpdateAssetFamilyPayload) => {
      const { data } = await apiClient.patch<AssetFamily>(
        `/api/v1/assets/families/${uuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.families() })
    },
  })
}

export function useDeleteAssetFamilyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (uuid: string) => {
      await apiClient.delete(`/api/v1/assets/families/${uuid}`, getAuthRequestConfig())
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.families() })
    },
  })
}

export function useFlightTypesQuery() {
  return useQuery({
    queryKey: assetsQueryKeys.flightTypes(),
    enabled: true,
    queryFn: async () => {
      const { data } = await apiClient.get<FlightType[]>(
        `/api/v1/assets/flight-types`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useCreateFlightTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateFlightTypePayload) => {
      const { data } = await apiClient.post<FlightType>(
        `/api/v1/assets/flight-types`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.flightTypes() })
    },
  })
}

export function useUpdateFlightTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, ...payload }: UpdateFlightTypePayload & { uuid: string }) => {
      const { data } = await apiClient.patch<FlightType>(
        `/api/v1/assets/flight-types/${uuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.flightTypes() })
    },
  })
}

// ── Assets ────────────────────────────────────────────────────────────────────

export function useAssetsQuery(filters: AssetFilters, enabled = true) {
  return useQuery({
    queryKey: assetsQueryKeys.list(filters),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AssetSummary[]>(
        '/api/v1/assets',
        {
          params: compactParams(filters),
          ...getAuthRequestConfig(),
        },
      )
      return data
    },
  })
}

export function useAssetQuery(uuid: string | null) {
  return useQuery({
    queryKey: assetsQueryKeys.detail(uuid ?? ''),
    enabled: Boolean(uuid),
    queryFn: async () => {
      const { data } = await apiClient.get<AssetDetail>(
        `/api/v1/assets/${uuid}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useAssetStatusHistoryQuery(uuid: string | null) {
  return useQuery({
    queryKey: assetsQueryKeys.statusHistory(uuid ?? ''),
    enabled: Boolean(uuid),
    queryFn: async () => {
      const { data } = await apiClient.get<AssetStatusHistoryEntry[]>(
        `/api/v1/assets/${uuid}/status-history`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useCreateAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateAssetPayload) => {
      const { data } = await apiClient.post<AssetDetail>('/api/v1/assets', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.root })
    },
  })
}

export function useUpdateAssetMutation(uuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UpdateAssetPayload) => {
      const { data } = await apiClient.patch<AssetDetail>(
        `/api/v1/assets/${uuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.root })
    },
  })
}

export function useTransitionAssetStatusMutation(uuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: AssetStatusTransitionPayload) => {
      const { data } = await apiClient.post<AssetDetail>(
        `/api/v1/assets/${uuid}/status`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.root })
    },
  })
}

// ── Asset-scoped Pricing Versions ─────────────────────────────────────────────
// Reuses the accounting pricing/versions endpoint, scoped by asset_family_uuid

export function useAssetPricingVersionsQuery(
  assetFamilyUuid: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: assetsQueryKeys.pricingVersions(assetFamilyUuid ?? ''),
    enabled: enabled && Boolean(assetFamilyUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<AssetPricingVersion[]>(
        '/api/v1/accounting/pricing/versions',
        {
          ...getAuthRequestConfig(),
          params: { asset_family_uuid: assetFamilyUuid },
        },
      )
      return data
    },
  })
}

export function useCreateAssetPricingVersionMutation(assetFamilyUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      name: string
      from_date: string
      to_date?: string | null
      status?: number
      use_pack?: boolean
    }) => {
      const { data } = await apiClient.post<AssetPricingVersion>(
        '/api/v1/accounting/pricing/versions',
        { ...payload, asset_family_uuid: assetFamilyUuid },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: assetsQueryKeys.pricingVersions(assetFamilyUuid),
      })
    },
  })
}

export function useUpdateAssetPricingVersionMutation(assetFamilyUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      uuid: string
      name?: string
      from_date?: string
      to_date?: string | null
      status?: number
      use_pack?: boolean
    }) => {
      const { uuid, ...rest } = payload
      const { data } = await apiClient.patch<AssetPricingVersion>(
        `/api/v1/accounting/pricing/versions/${uuid}`,
        rest,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: assetsQueryKeys.pricingVersions(assetFamilyUuid),
      })
    },
  })
}

export function useDeleteAssetPricingVersionMutation(assetFamilyUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (versionUuid: string) => {
      await apiClient.delete(
        `/api/v1/accounting/pricing/versions/${versionUuid}`,
        getAuthRequestConfig(),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: assetsQueryKeys.pricingVersions(assetFamilyUuid),
      })
    },
  })
}

export function useCloneAssetPricingVersionMutation(assetFamilyUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      source_version_uuid: string
      name: string
      from_date: string
      to_date?: string | null
      use_pack?: boolean
    }) => {
      const { source_version_uuid, ...rest } = payload
      const { data } = await apiClient.post<AssetPricingVersion>(
        `/api/v1/accounting/pricing/versions/${source_version_uuid}/clone`,
        rest,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: assetsQueryKeys.pricingVersions(assetFamilyUuid),
      })
    },
  })
}

// ── Pricing Items ─────────────────────────────────────────────────────────────

export function usePricingItemsQuery(versionUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: assetsQueryKeys.pricingItems(versionUuid ?? ''),
    enabled: enabled && Boolean(versionUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<PricingItem[]>(
        `/api/v1/accounting/pricing/versions/${versionUuid}/items`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useCreatePricingItemMutation(versionUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreatePricingItemPayload) => {
      const { data } = await apiClient.post<PricingItem>(
        `/api/v1/accounting/pricing/versions/${versionUuid}/items`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.pricingItems(versionUuid) })
    },
  })
}

export function useUpdatePricingItemMutation(versionUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, ...payload }: UpdatePricingItemPayload & { uuid: string }) => {
      const { data } = await apiClient.patch<PricingItem>(
        `/api/v1/accounting/pricing/items/${uuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.pricingItems(versionUuid) })
    },
  })
}

export function useDeletePricingItemMutation(versionUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (itemUuid: string) => {
      await apiClient.delete(
        `/api/v1/accounting/pricing/items/${itemUuid}`,
        getAuthRequestConfig(),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.pricingItems(versionUuid) })
    },
  })
}

export function useReplacePricingItemTiersMutation(versionUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemUuid, tiers }: { itemUuid: string; tiers: ReplaceTiersPayload }) => {
      const { data } = await apiClient.put<PricingItem>(
        `/api/v1/accounting/pricing/items/${itemUuid}/tiers`,
        tiers,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.pricingItems(versionUuid) })
    },
  })
}

export function useImportAssetsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await apiClient.post<ImportResult>(
        '/api/v1/assets/import',
        formData,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.root })
    },
  })
}
