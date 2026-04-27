export const banqueQueryKeys = {
  root: ['banque'] as const,
  settings: (moduleName: string) => ['banque', 'settings', moduleName] as const,
  fiscalYears: () => ['banque', 'fiscal-years'] as const,
  pricingVersions: (fiscalYearUuid?: string) => ['banque', 'pricing-versions', fiscalYearUuid ?? 'all'] as const,
  pcgSeed: ['banque', 'pcg-seed'] as const,
  accounts: () => ['banque', 'accounts'] as const,
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '../../../api/client'
import type { PcgSeedExportResponse, PcgSeedImportRequest } from '../types'

// ── Settings ────────────────────────────────────────────────────────────────

export type ModuleSetting = {
  module_name: string
  settings: Record<string, unknown>
  updated_at: string
  updated_by: number | null
}

type SettingsRequestPayload = {
  settings: Record<string, unknown>
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { status?: number } }).response
    return response?.status === 404
  }
  return false
}

export function useBanqueModuleSettingsQuery(moduleName: string, enabled: boolean) {
  return useQuery({
    queryKey: banqueQueryKeys.settings(moduleName),
    enabled,
    queryFn: async () => {
      try {
        const { data } = await apiClient.get<ModuleSetting>(
          `/api/v1/accounting/settings/${moduleName}`,
          getAuthRequestConfig(),
        )
        return data
      } catch (error) {
        if (isNotFoundError(error)) {
          return {
            module_name: moduleName,
            settings: {},
            updated_at: new Date(0).toISOString(),
            updated_by: null,
          } satisfies ModuleSetting
        }
        throw error
      }
    },
  })
}

export function useUpsertBanqueModuleSettingsMutation(moduleName: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: SettingsRequestPayload) => {
      const { data } = await apiClient.put<ModuleSetting>(
        `/api/v1/accounting/settings/${moduleName}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.settings(moduleName) })
    },
  })
}

// ── Fiscal Years ─────────────────────────────────────────────────────────────

export type FiscalYear = {
  uuid: string
  code: string
  label: string
  year: number
  start_date: string
  end_date: string
  state: number // 1=Open, 2=Closed, 3=Reopened
  closed_at: string | null
  created_at: string
}

export type FiscalYearCreatePayload = {
  code: string
  label: string
  year: number
  start_date: string
  end_date: string
}

export function useFiscalYearsQuery(enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.fiscalYears(),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<FiscalYear[]>(
        '/api/v1/accounting/fiscal-years',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

// ── Chart of Accounts ────────────────────────────────────────────────────────

export type AccountOption = {
  uuid: string
  code: string
  name: string
  type: number            // 1=Asset 2=Liability 3=Equity 4=Expense 5=Revenue
  is_posting_allowed: boolean
}

/** Fetches all accounts; suitable for select pickers in pricing / entry forms. */
export function useAccountsQuery(enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.accounts(),
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await apiClient.get<AccountOption[]>(
        '/api/v1/accounting/accounts?limit=500',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useCreateFiscalYearMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: FiscalYearCreatePayload) => {
      const { data } = await apiClient.post<FiscalYear>(
        '/api/v1/accounting/fiscal-years',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.fiscalYears() })
    },
  })
}

// ── Pricing Versions ──────────────────────────────────────────────────────────

export type PricingVersion = {
  uuid: string
  fiscal_year_uuid: string
  name: string
  from_date: string
  to_date: string | null
  status: number // 1=Draft, 2=Active, 3=Archived
  is_locked: boolean
  created_at: string
  updated_at: string
  created_by: number | null
}

export type PricingVersionCreatePayload = {
  fiscal_year_uuid: string
  name: string
  from_date: string
  to_date?: string | null
  status?: number
  use_pack?: boolean
}

export type PricingVersionUpdatePayload = {
  name?: string
  from_date?: string
  to_date?: string | null
  status?: number
  use_pack?: boolean
}

export type CopyPricingVersionsPayload = {
  source_fiscal_year_uuid: string
  target_fiscal_year_uuid: string
}

export type CopyPricingVersionsResult = {
  copied: number
  skipped: number
  versions: PricingVersion[]
}

export function usePricingVersionsQuery(fiscalYearUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.pricingVersions(fiscalYearUuid ?? undefined),
    enabled: enabled && fiscalYearUuid !== null,
    queryFn: async () => {
      const params = fiscalYearUuid ? `?fiscal_year_uuid=${fiscalYearUuid}` : ''
      const { data } = await apiClient.get<PricingVersion[]>(
        `/api/v1/accounting/pricing/versions${params}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useCreatePricingVersionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: PricingVersionCreatePayload) => {
      const { data } = await apiClient.post<PricingVersion>(
        '/api/v1/accounting/pricing/versions',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions(data.fiscal_year_uuid) })
    },
  })
}

export function useUpdatePricingVersionMutation(fiscalYearUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, ...payload }: PricingVersionUpdatePayload & { uuid: string }) => {
      const { data } = await apiClient.patch<PricingVersion>(
        `/api/v1/accounting/pricing/versions/${uuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions(fiscalYearUuid) })
    },
  })
}

export function useDeletePricingVersionMutation(fiscalYearUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (versionUuid: string) => {
      await apiClient.delete(
        `/api/v1/accounting/pricing/versions/${versionUuid}`,
        getAuthRequestConfig(),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions(fiscalYearUuid) })
    },
  })
}

export function useCopyPricingVersionsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CopyPricingVersionsPayload) => {
      const { data } = await apiClient.post<CopyPricingVersionsResult>(
        '/api/v1/accounting/pricing/versions/copy',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: banqueQueryKeys.pricingVersions(variables.target_fiscal_year_uuid),
      })
    },
  })
}

// ── PCG Seed ──────────────────────────────────────────────────────────────────

export function usePcgSeedQuery() {
  return useQuery({
    queryKey: banqueQueryKeys.pcgSeed,
    queryFn: async () => {
      const { data } = await apiClient.get<PcgSeedExportResponse>(
        '/api/v1/accounting/accounts/pcg-seed',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useImportPcgSeedMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: PcgSeedImportRequest) => {
      const { data } = await apiClient.put<PcgSeedExportResponse>(
        '/api/v1/accounting/accounts/pcg-seed',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pcgSeed })
    },
  })
}

export function useApplyPcgSeedMutation() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<{ inserted: number; updated: number; total: number }>(
        '/api/v1/accounting/accounts/seed-pcg',
        {},
        getAuthRequestConfig(),
      )
      return data
    },
  })
}
