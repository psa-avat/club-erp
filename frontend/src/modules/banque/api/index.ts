export const banqueQueryKeys = {
  root: ['banque'] as const,
  settings: (moduleName: string) => ['banque', 'settings', moduleName] as const,
  fiscalYears: () => ['banque', 'fiscal-years'] as const,
  pricingVersions: (fiscalYearUuid?: string) => ['banque', 'pricing-versions', fiscalYearUuid ?? 'all'] as const,
  pricingItems: (versionUuid: string) => ['banque', 'pricing-items', versionUuid] as const,
  pcgSeed: ['banque', 'pcg-seed'] as const,
  accounts: () => ['banque', 'accounts'] as const,
  journals: () => ['banque', 'journals'] as const,
  entries: (filters: Record<string, unknown>) => ['banque', 'entries', filters] as const,
  entryModels: () => ['banque', 'entry-models'] as const,
  accountBalances: (fiscalYearUuid: string, postedOnly: boolean) =>
    ['banque', 'account-balances', fiscalYearUuid, postedOnly] as const,
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

export function useActiveFiscalYearQuery(enabled = true) {
  return useQuery({
    queryKey: ['banque', 'fiscal-years', 'active'] as const,
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes — active FY changes rarely
    queryFn: async () => {
      const { data } = await apiClient.get<FiscalYear>(
        '/api/v1/accounting/fiscal-years/active',
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

export type JournalOption = {
  uuid: string
  code: string
  name: string
  type: number
  is_active: boolean
}

export type AccountingEntryLinePayload = {
  account_uuid: string
  debit: string
  credit: string
  description?: string | null
  member_uuid?: string | null
  analytical_asset_uuid?: string | null
}

export type AccountingEntryLine = AccountingEntryLinePayload & {
  uuid: string
  entry_uuid: string
  fiscal_year_uuid: string
}

export type AccountingEntry = {
  uuid: string
  fiscal_year_uuid: string
  journal_uuid: string
  entry_date: string
  description: string
  reference: string | null
  state: number
  sequence_number: string | null
  source_system: string | null
  external_id: string | null
  import_batch_id: string | null
  reversal_of_entry_uuid: string | null
  reversal_reason: string | null
  posted_at: string | null
  created_at: string
  created_by: number
  lines: AccountingEntryLine[]
}

export type AccountingEntriesFilters = {
  fiscal_year_uuid?: string
  journal_uuid?: string
  state?: number
  search?: string
  member_uuid?: string
  limit?: number
}

export type AccountingEntryCreatePayload = {
  fiscal_year_uuid: string
  journal_uuid: string
  entry_date: string
  description: string
  reference?: string | null
  source_system?: string | null
  external_id?: string | null
  import_batch_id?: string | null
  lines: AccountingEntryLinePayload[]
}

export type AccountingEntryUpdatePayload = {
  journal_uuid?: string
  entry_date?: string
  description?: string
  reference?: string | null
  lines?: AccountingEntryLinePayload[]
}

export type AccountingEntryModelLinePayload = {
  account_uuid: string
  debit: string
  credit: string
  description?: string | null
  member_uuid?: string | null
  analytical_asset_uuid?: string | null
}

export type AccountingEntryModelLine = AccountingEntryModelLinePayload & {
  uuid: string
  template_uuid: string
  sort_order: number
}

export type AccountingEntryModel = {
  uuid: string
  code: string
  name: string
  journal_uuid: string
  description: string | null
  default_reference: string | null
  recurrence_type: number
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: number
  lines: AccountingEntryModelLine[]
}

export type AccountingEntryModelCreatePayload = {
  code: string
  name: string
  journal_uuid: string
  description?: string | null
  default_reference?: string | null
  recurrence_type?: number
  is_active?: boolean
  lines: AccountingEntryModelLinePayload[]
}

export type AccountingEntryModelUpdatePayload = Partial<AccountingEntryModelCreatePayload>

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

// ── Financial Reports ────────────────────────────────────────────────────────

export type AccountBalance = {
  account_uuid: string
  code: string
  name: string
  type: number            // 1=Asset 2=Liability 3=Equity 4=Expense 5=Revenue
  normal_balance: number  // 1=Debit 2=Credit
  parent_account_uuid: string | null
  total_debit: string
  total_credit: string
  balance: string         // debit − credit (signed)
}

export function useAccountBalancesQuery(
  fiscalYearUuid: string | null,
  postedOnly = true,
  enabled = true,
) {
  return useQuery({
    queryKey: banqueQueryKeys.accountBalances(fiscalYearUuid ?? '', postedOnly),
    enabled: enabled && Boolean(fiscalYearUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<AccountBalance[]>(
        '/api/v1/accounting/reports/account-balances',
        {
          ...getAuthRequestConfig(),
          params: { fiscal_year_uuid: fiscalYearUuid, posted_only: postedOnly },
        },
      )
      return data
    },
  })
}

export function useJournalsQuery(enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.journals(),
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await apiClient.get<JournalOption[]>(
        '/api/v1/accounting/journals?limit=500',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useAccountingEntriesQuery(filters: AccountingEntriesFilters, enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.entries(filters),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AccountingEntry[]>(
        '/api/v1/accounting/entries',
        {
          ...getAuthRequestConfig(),
          params: filters,
        },
      )
      return data
    },
  })
}

export function useCreateAccountingEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: AccountingEntryCreatePayload) => {
      const { data } = await apiClient.post<AccountingEntry>(
        '/api/v1/accounting/entries',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

export function useUpdateAccountingEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      entryUuid,
      fiscalYearUuid,
      payload,
    }: {
      entryUuid: string
      fiscalYearUuid: string
      payload: AccountingEntryUpdatePayload
    }) => {
      const { data } = await apiClient.put<AccountingEntry>(
        `/api/v1/accounting/entries/${entryUuid}?fiscal_year_uuid=${fiscalYearUuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

export function usePostAccountingEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entryUuid, fiscalYearUuid }: { entryUuid: string; fiscalYearUuid: string }) => {
      const { data } = await apiClient.patch<AccountingEntry>(
        `/api/v1/accounting/entries/${entryUuid}/post?fiscal_year_uuid=${fiscalYearUuid}`,
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

export function useBulkPostAccountingEntriesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      fiscal_year_uuid,
      entry_uuids,
    }: {
      fiscal_year_uuid: string
      entry_uuids: string[]
    }) => {
      const { data } = await apiClient.patch<AccountingEntry[]>(
        '/api/v1/accounting/entries/post-bulk',
        { fiscal_year_uuid, entry_uuids },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

export function useReverseAccountingEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      entryUuid,
      fiscal_year_uuid,
      reversal_reason,
      entry_date,
    }: {
      entryUuid: string
      fiscal_year_uuid: string
      reversal_reason: string
      entry_date?: string
    }) => {
      const { data } = await apiClient.post<AccountingEntry>(
        `/api/v1/accounting/entries/${entryUuid}/reverse`,
        { fiscal_year_uuid, reversal_reason, entry_date },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

export function useAccountingEntryModelsQuery(enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.entryModels(),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AccountingEntryModel[]>(
        '/api/v1/accounting/entry-models',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useCreateAccountingEntryModelMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: AccountingEntryModelCreatePayload) => {
      const { data } = await apiClient.post<AccountingEntryModel>(
        '/api/v1/accounting/entry-models',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entryModels() })
    },
  })
}

export function useUpdateAccountingEntryModelMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ templateUuid, payload }: { templateUuid: string; payload: AccountingEntryModelUpdatePayload }) => {
      const { data } = await apiClient.patch<AccountingEntryModel>(
        `/api/v1/accounting/entry-models/${templateUuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entryModels() })
    },
  })
}

export function useDeleteAccountingEntryModelMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (templateUuid: string) => {
      await apiClient.delete(`/api/v1/accounting/entry-models/${templateUuid}`, getAuthRequestConfig())
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entryModels() })
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
  use_pack: boolean
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

export type ClonePricingVersionPayload = {
  source_version_uuid: string
  name: string
  from_date: string
  to_date?: string | null
  use_pack?: boolean
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

export function useClonePricingVersionMutation(fiscalYearUuid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ClonePricingVersionPayload) => {
      const { source_version_uuid, ...rest } = payload
      const { data } = await apiClient.post<PricingVersion>(
        `/api/v1/accounting/pricing/versions/${source_version_uuid}/clone`,
        rest,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions(fiscalYearUuid) })
    },
  })
}

// ── Pricing Items (facade for journal entry prefill) ────────────────────────

/** Minimal shape of a pricing item as needed by the Journal workspace. */
export type PricingItem = {
  uuid: string
  name: string
  base_price: string
  /** Revenue account credited at billing time; null until configured. */
  gl_account_credit_uuid: string | null
}

export function usePricingItemsQuery(versionUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.pricingItems(versionUuid ?? ''),
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

// ── Legacy CSV Import ────────────────────────────────────────────────────────

export type ImportPreviewLine = {
  account_code: string
  account_uuid: string | null
  description: string | null
  member_account_id: string | null
  member_uuid: string | null
  debit: string
  credit: string
  errors: string[]
}

export type ImportPreviewEntry = {
  entry_key: string
  entry_date: string
  description: string
  row_start: number
  row_end: number
  total_debit: string
  total_credit: string
  importable: boolean
  already_imported: boolean
  errors: string[]
  lines: ImportPreviewLine[]
}

export type ImportPreviewResponse = {
  source_system: string
  fiscal_year_uuid: string
  journal_uuid: string
  entries: ImportPreviewEntry[]
  importable_count: number
  blocked_count: number
}

export type ImportApplyResponse = {
  source_system: string
  import_batch_id: string
  imported_count: number
  skipped_count: number
  created_entry_uuids: string[]
}

export function usePreviewAccountingImportMutation() {
  return useMutation({
    mutationFn: async ({
      file,
      fiscal_year_uuid,
      journal_uuid,
    }: {
      file: File
      fiscal_year_uuid: string
      journal_uuid: string
    }) => {
      const authConfig = getAuthRequestConfig()
      const formData = new FormData()
      formData.append('file', file)
      formData.append('fiscal_year_uuid', fiscal_year_uuid)
      formData.append('journal_uuid', journal_uuid)
      const { data } = await apiClient.post<ImportPreviewResponse>(
        '/api/v1/accounting/entries/import/preview',
        formData,
        {
          ...(authConfig ?? {}),
          headers: { ...(authConfig?.headers ?? {}) },
        },
      )
      return data
    },
  })
}

export function useApplyAccountingImportMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      fiscal_year_uuid,
      journal_uuid,
      selected_keys,
    }: {
      file: File
      fiscal_year_uuid: string
      journal_uuid: string
      selected_keys: string[]
    }) => {
      const authConfig = getAuthRequestConfig()
      const formData = new FormData()
      formData.append('file', file)
      formData.append('fiscal_year_uuid', fiscal_year_uuid)
      formData.append('journal_uuid', journal_uuid)
      formData.append('selected_keys', JSON.stringify(selected_keys))
      const { data } = await apiClient.post<ImportApplyResponse>(
        '/api/v1/accounting/entries/import',
        formData,
        {
          ...(authConfig ?? {}),
          headers: { ...(authConfig?.headers ?? {}) },
        },
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}
