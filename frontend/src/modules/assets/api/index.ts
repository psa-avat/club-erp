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
  AssetDetail,
  AssetFilters,
  AssetPricingVersion,
  AssetStatusTransitionPayload,
  AssetSummary,
  AssetType,
  CreateAssetPayload,
  CreateAssetTypePayload,
  CreatePricingItemPayload,
  FlightType,
  PricingItem,
  UpdateAssetPayload,
  UpdateAssetTypePayload,
  UpdatePricingItemPayload,
} from '../types'
import { banqueQueryKeys } from '../../banque/api'

// ── Query Keys ────────────────────────────────────────────────────────────────

export const assetsQueryKeys = {
  root: ['assets'] as const,
  types: () => ['assets', 'types'] as const,
  flightTypes: (typeUuid: string) => ['assets', 'flight-types', typeUuid] as const,
  list: (filters: AssetFilters) => ['assets', 'list', filters] as const,
  detail: (uuid: string) => ['assets', 'detail', uuid] as const,
  statusHistory: (uuid: string) => ['assets', 'status-history', uuid] as const,
  pricingVersions: (assetTypeUuid: string, fyUuid: string) =>
    ['assets', 'pricing-versions', assetTypeUuid, fyUuid] as const,
  pricingItems: (versionUuid: string) => ['assets', 'pricing-items', versionUuid] as const,
}

function compactParams(obj: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
}

// ── Asset Types ───────────────────────────────────────────────────────────────

export function useAssetTypesQuery(enabled = true) {
  return useQuery({
    queryKey: assetsQueryKeys.types(),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AssetType[]>('/api/v1/assets/types', getAuthRequestConfig())
      return data
    },
  })
}

export function useCreateAssetTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateAssetTypePayload) => {
      const { data } = await apiClient.post<AssetType>('/api/v1/assets/types', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.types() })
    },
  })
}

export function useUpdateAssetTypeMutation(uuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UpdateAssetTypePayload) => {
      const { data } = await apiClient.patch<AssetType>(
        `/api/v1/assets/types/${uuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetsQueryKeys.types() })
    },
  })
}

export function useFlightTypesQuery(assetTypeUuid: string | null) {
  return useQuery({
    queryKey: assetsQueryKeys.flightTypes(assetTypeUuid ?? ''),
    enabled: Boolean(assetTypeUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<FlightType[]>(
        `/api/v1/assets/types/${assetTypeUuid}/flight-types`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

// ── Assets ────────────────────────────────────────────────────────────────────

export function useAssetsQuery(filters: AssetFilters, enabled = true) {
  return useQuery({
    queryKey: assetsQueryKeys.list(filters),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AssetSummary[]>('/api/v1/assets', {
        ...getAuthRequestConfig(),
        params: compactParams(filters as Record<string, unknown>),
      })
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
// Reuses the accounting pricing/versions endpoint, scoped by asset_type_uuid

export function useAssetPricingVersionsQuery(
  assetTypeUuid: string | null,
  fiscalYearUuid: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: assetsQueryKeys.pricingVersions(assetTypeUuid ?? '', fiscalYearUuid ?? ''),
    enabled: enabled && Boolean(assetTypeUuid) && Boolean(fiscalYearUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<AssetPricingVersion[]>(
        '/api/v1/accounting/pricing/versions',
        {
          ...getAuthRequestConfig(),
          params: { fiscal_year_uuid: fiscalYearUuid, asset_type_uuid: assetTypeUuid },
        },
      )
      return data
    },
  })
}

export function useCreateAssetPricingVersionMutation(fiscalYearUuid: string, assetTypeUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      name: string
      from_date: string
      to_date?: string | null
      status?: number
    }) => {
      const { data } = await apiClient.post<AssetPricingVersion>(
        '/api/v1/accounting/pricing/versions',
        { ...payload, fiscal_year_uuid: fiscalYearUuid, asset_type_uuid: assetTypeUuid },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: assetsQueryKeys.pricingVersions(assetTypeUuid, fiscalYearUuid),
      })
      // Also refresh global pricing list in banque module
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions(fiscalYearUuid) })
    },
  })
}

export function useUpdateAssetPricingVersionMutation(fiscalYearUuid: string, assetTypeUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      uuid: string
      name?: string
      from_date?: string
      to_date?: string | null
      status?: number
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
        queryKey: assetsQueryKeys.pricingVersions(assetTypeUuid, fiscalYearUuid),
      })
    },
  })
}

export function useDeleteAssetPricingVersionMutation(fiscalYearUuid: string, assetTypeUuid: string) {
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
        queryKey: assetsQueryKeys.pricingVersions(assetTypeUuid, fiscalYearUuid),
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
