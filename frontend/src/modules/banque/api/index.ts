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
  entry: (entryUuid: string, fiscalYearUuid: string) => ['banque', 'entry', fiscalYearUuid, entryUuid] as const,
  entriesCount: (filters: Record<string, unknown>) => ['banque', 'entries-count', filters] as const,
  entryModels: () => ['banque', 'entry-models'] as const,
  entryModelPreview: (templateUuid: string) => ['banque', 'entry-models', templateUuid, 'preview'] as const,
  accountBalances: (fiscalYearUuid: string, postedOnly: boolean) =>
    ['banque', 'account-balances', fiscalYearUuid, postedOnly] as const,
  chequeCandidates: (fiscalYearUuid: string, includeDrafts: boolean) =>
    ['banque', 'cheque-candidates', fiscalYearUuid, includeDrafts] as const,
  accountingHealth: (fiscalYearUuid?: string) => ['banque', 'accounting-health', fiscalYearUuid ?? 'active'] as const,
  generalLedger: (params: Record<string, unknown>) => ['banque', 'general-ledger', params] as const,
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
      await queryClient.invalidateQueries({ queryKey: ['banque', 'fiscal-years', 'active'] as const })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

export function useCloseFiscalYearMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (fiscalYearUuid: string) => {
      const { data } = await apiClient.patch<FiscalYear>(
        `/api/v1/accounting/fiscal-years/${fiscalYearUuid}/close`,
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.fiscalYears() })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'fiscal-years', 'active'] as const })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

export function useReopenFiscalYearMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (fiscalYearUuid: string) => {
      const { data } = await apiClient.patch<FiscalYear>(
        `/api/v1/accounting/fiscal-years/${fiscalYearUuid}/reopen`,
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.fiscalYears() })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'fiscal-years', 'active'] as const })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

export type FiscalYearCloseReadiness = {
  fiscal_year_uuid: string
  has_unposted_entries: boolean
  unposted_entries_count: number
  has_unreconciled_bank_lines: boolean
  unreconciled_bank_lines_count: number
  has_reconciliation_discrepancies: boolean
  discrepancy_count: number
  has_missing_required_tiers: boolean
  missing_required_tiers_count: number
  has_due_recurring_entries: boolean
  due_recurring_entries_count: number
  reports_balanced: boolean
  can_close: boolean
}

export function useFiscalYearCloseReadinessQuery(fiscalYearUuid?: string, enabled = true) {
  return useQuery({
    queryKey: ['banque', 'fiscal-year-close-readiness', fiscalYearUuid] as const,
    enabled: enabled && Boolean(fiscalYearUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<FiscalYearCloseReadiness>(
        `/api/v1/accounting/fiscal-years/${fiscalYearUuid}/close-readiness`,
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
  is_reconcilable?: boolean
  is_active?: boolean
  require_id: number      // 0=none,1=member,2=asset,3=supplier
}

export type JournalOption = {
  uuid: string
  code: string
  name: string
  type: number
  is_active: boolean
  default_account_uuid?: string | null
}

export type AccountingEntryLinePayload = {
  account_uuid: string
  debit: string
  credit: string
  description?: string | null
  tiers_uuid?: string | null
}

export type AccountingEntryLine = AccountingEntryLinePayload & {
  uuid: string
  entry_uuid: string
  fiscal_year_uuid: string
  tiers_display_ref?: string | null   // account_id for members, registration code for assets
  tiers_display_name?: string | null  // full name for members, asset name for assets
  analytical_asset_code?: string | null
  analytical_asset_name?: string | null
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
  // Bank reconciliation status, resolved server-side — null when the entry isn't
  // referenced by any bank statement line.
  bank_match_status: 'auto_matched' | 'manually_matched' | 'discrepancy' | null
  bank_statement_status: 'imported' | 'matching' | 'reconciled' | 'flagged' | null
}

export type AccountingEntriesFilters = {
  fiscal_year_uuid?: string
  journal_uuid?: string
  state?: number
  search?: string
  member_uuid?: string
  member?: string
  account_code?: string
  description?: string
  entry_date_from?: string
  entry_date_to?: string
  amount_min?: string
  amount_max?: string
  null_tiers?: boolean
  bank_reconciliation_state?: 'unreconciled' | 'associated' | 'reconciled' | 'discrepancy'
  limit?: number
  offset?: number
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
  tiers_uuid?: string | null
  // Formula
  formula_type?: string
  formula_params?: Record<string, unknown> | null
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
  // Scheduling (pluriannual)
  valid_from: string | null
  valid_until: string | null
  next_scheduled_date: string | null
  last_generated_at: string | null
  last_generated_entry_uuid: string | null
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
  valid_from?: string | null
  valid_until?: string | null
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

export type GeneralLedgerLine = {
  entry_uuid: string
  line_uuid: string
  entry_date: string
  journal_code: string
  sequence_number: string | null
  reference: string | null
  state: number
  entry_description: string
  line_description: string | null
  tiers_display_ref: string | null
  tiers_display_name: string | null
  debit: string
  credit: string
  running_balance: string
}

export type GeneralLedger = {
  account_uuid: string
  account_code: string
  account_name: string
  fiscal_year_uuid: string
  opening_balance: string
  total_debit: string
  total_credit: string
  closing_balance: string
  total_lines: number
  limit: number
  offset: number
  lines: GeneralLedgerLine[]
}

export type GeneralLedgerFilters = {
  fiscal_year_uuid: string
  account_uuid?: string
  account_code?: string
  date_from?: string
  date_to?: string
  posted_only?: boolean
  limit?: number
  offset?: number
}

export function useGeneralLedgerQuery(filters: GeneralLedgerFilters, enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.generalLedger(filters),
    enabled: enabled && Boolean(filters.fiscal_year_uuid) && Boolean(filters.account_uuid || filters.account_code),
    queryFn: async () => {
      const { data } = await apiClient.get<GeneralLedger>('/api/v1/accounting/reports/general-ledger', {
        ...getAuthRequestConfig(),
        params: filters,
      })
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

export function useAccountingEntryQuery(entryUuid: string | null, fiscalYearUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.entry(entryUuid ?? 'none', fiscalYearUuid ?? 'none'),
    enabled: enabled && Boolean(entryUuid && fiscalYearUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<AccountingEntry>(
        `/api/v1/accounting/entries/${entryUuid}`,
        {
          ...getAuthRequestConfig(),
          params: { fiscal_year_uuid: fiscalYearUuid },
        },
      )
      return data
    },
  })
}

export function useAccountingEntriesCountQuery(
  filters: Omit<AccountingEntriesFilters, 'limit' | 'offset'>,
  enabled = true,
) {
  return useQuery({
    queryKey: banqueQueryKeys.entriesCount(filters),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<{ total: number }>(
        '/api/v1/accounting/entries/count',
        {
          ...getAuthRequestConfig(),
          params: filters,
        },
      )
      return data.total
    },
  })
}

export type AccountingHealth = {
  fiscal_year: FiscalYear | null
  draft_entries_count: number
  unreconciled_bank_lines_count: number
  reconciliation_discrepancies_count: number
  missing_required_tiers_count: number
  due_recurring_entries_count: number
}

export function useAccountingHealthQuery(fiscalYearUuid?: string, enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.accountingHealth(fiscalYearUuid),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AccountingHealth>('/api/v1/accounting/health', {
        ...getAuthRequestConfig(),
        params: fiscalYearUuid ? { fiscal_year_uuid: fiscalYearUuid } : undefined,
      })
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

// ── Preview / Generate hooks ────────────────────────────────────────────────

export type PreviewLine = {
  account_code: string
  debit: string
  credit: string
  description: string | null
}

export type PreviewResponse = {
  template_code: string
  reference: string
  description: string | null
  fiscal_year_uuid: string
  fiscal_year_label: string
  lines: PreviewLine[]
  total_debit: string
  total_credit: string
  is_balanced: boolean
  warnings: string[]
}

export type GenerateResponse = {
  entry_uuid: string
  reference: string
  fiscal_year_uuid: string
  state: number
  was_already_generated: boolean
}

export type GenerateDueItem = {
  template_code: string
  entry_uuid: string | null
  reference: string | null
  fiscal_year_uuid: string | null
}

export type GenerateDueResponse = {
  generated: GenerateDueItem[]
  skipped: { template_code: string; reason: string }[]
  errors: { template_code: string; reason: string }[]
}

export function usePreviewEntryGenerationMutation() {
  return useMutation({
    mutationFn: async ({ templateUuid, targetDate }: { templateUuid: string; targetDate: string }) => {
      const { data } = await apiClient.post<PreviewResponse>(
        `/api/v1/accounting/entry-models/${templateUuid}/preview`,
        { target_date: targetDate },
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useGenerateEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ templateUuid, targetDate }: { templateUuid: string; targetDate: string }) => {
      const { data } = await apiClient.post<GenerateResponse>(
        `/api/v1/accounting/entry-models/${templateUuid}/generate`,
        { target_date: targetDate },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entryModels() })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entries({}) })
    },
  })
}

export function useGenerateDueEntriesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<GenerateDueResponse>(
        '/api/v1/accounting/entry-models/generate-due',
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entryModels() })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entries({}) })
    },
  })
}

export function useDeleteAccountingEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entryUuid, fiscalYearUuid }: { entryUuid: string; fiscalYearUuid: string }) => {
      await apiClient.delete(
        `/api/v1/accounting/entries/${entryUuid}`,
        { ...getAuthRequestConfig(), params: { fiscal_year_uuid: fiscalYearUuid } },
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.root })
    },
  })
}

// ── Pricing Versions ──────────────────────────────────────────────────────────

export type PricingVersion = {
  uuid: string
  fiscal_year_uuid: string | null
  asset_family_uuid: string | null
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

export type ClonePricingVersionPayload = {
  source_version_uuid: string
  name: string
  from_date: string
  to_date?: string | null
  use_pack?: boolean
}

export function usePricingVersionsQuery(enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.pricingVersions(),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<PricingVersion[]>(
        '/api/v1/accounting/pricing/versions',
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions() })
    },
  })
}

export function useUpdatePricingVersionMutation() {
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
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions() })
    },
  })
}

export function useDeletePricingVersionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (versionUuid: string) => {
      await apiClient.delete(
        `/api/v1/accounting/pricing/versions/${versionUuid}`,
        getAuthRequestConfig(),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions() })
    },
  })
}

export function useClonePricingVersionMutation() {
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
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.pricingVersions() })
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

/** A pricing item decorated with its parent version name for display. */
export type PricingItemWithVersion = PricingItem & {
  version_uuid: string
  version_name: string
}

/**
 * Fetch ALL pricing items across all versions, each annotated with its version name.
 * Useful for pack applicability selectors where the user needs to see which version
 * a rate belongs to.
 */
export function useAllActivePricingItemsQuery(enabled = true) {
  const versionsQuery = usePricingVersionsQuery(enabled)
  const versionUuids = (versionsQuery.data ?? []).map((v) => v.uuid)

  // Build a stable key from the sorted list of version UUIDs so the query key
  // changes when available versions change (e.g. after a new version is created).
  const stableKey = [...versionUuids].sort().join('::')

  return useQuery({
    queryKey: [...banqueQueryKeys.root, 'all-pricing-items', stableKey] as const,
    enabled: enabled && versionUuids.length > 0,
    queryFn: async () => {
      const versionMap = new Map(
        (versionsQuery.data ?? []).map((v) => [v.uuid, v.name]),
      )
      const results: PricingItemWithVersion[] = []
      for (const vUuid of versionUuids) {
        const { data } = await apiClient.get<PricingItem[]>(
          `/api/v1/accounting/pricing/versions/${vUuid}/items`,
          getAuthRequestConfig(),
        )
        const vName = versionMap.get(vUuid) ?? vUuid
        for (const item of data) {
          results.push({ ...item, version_uuid: vUuid, version_name: vName })
        }
      }
      return results
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
  // Raw CSV identifier (the member_account_id column), resolved to a member/supplier
  // or an asset depending on the account's require_id.
  tiers_id: string | null
  tiers_uuid: string | null
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

// ── Packs ─────────────────────────────────────────────────────────────────────

import type {
  PackDefinition,
  PackDefinitionCreate,
  PackDefinitionUpdate,
  MemberPackConsumption,
  MemberPackConsumptionCreate,
  MemberPackBalance,
} from '../types/packs'

export const banquePackKeys = {
  definitions: (filters?: Record<string, unknown>) => ['banque', 'packs', 'definitions', filters] as const,
  definition: (uuid: string) => ['banque', 'packs', 'definitions', uuid] as const,
  applicableItems: (packUuid: string) => ['banque', 'packs', 'applicable-items', packUuid] as const,
  consumptionsByFlight: (flightUuid: string) => ['banque', 'packs', 'consumptions', 'flight', flightUuid] as const,
  consumptionsByMember: (memberUuid: string) => ['banque', 'packs', 'consumptions', 'member', memberUuid] as const,
  balances: (memberUuid: string, fyUuid: string) => ['banque', 'packs', 'balances', memberUuid, fyUuid] as const,
}

export function usePackDefinitionsQuery(packType?: string, enabled = true) {
  return useQuery({
    queryKey: banquePackKeys.definitions({ packType }),
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (packType) params.set('pack_type', packType)
      const qs = params.toString()
      const { data } = await apiClient.get<PackDefinition[]>(
        `/api/v1/packs/definitions${qs ? `?${qs}` : ''}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function usePackDefinitionQuery(packUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: banquePackKeys.definition(packUuid ?? 'none'),
    enabled: enabled && Boolean(packUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<PackDefinition>(
        `/api/v1/packs/definitions/${packUuid}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useCreatePackDefinitionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: PackDefinitionCreate) => {
      const { data } = await apiClient.post<PackDefinition>(
        '/api/v1/packs/definitions',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs'] })
    },
  })
}

export function useUpdatePackDefinitionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ packUuid, payload }: { packUuid: string; payload: PackDefinitionUpdate }) => {
      const { data } = await apiClient.put<PackDefinition>(
        `/api/v1/packs/definitions/${packUuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs'] })
    },
  })
}

export function useDeletePackDefinitionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (packUuid: string) => {
      await apiClient.delete(`/api/v1/packs/definitions/${packUuid}`, getAuthRequestConfig())
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs'] })
    },
  })
}

export function useRecordPackConsumptionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: MemberPackConsumptionCreate) => {
      const { data } = await apiClient.post<MemberPackConsumption>(
        '/api/v1/packs/consumptions',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs'] })
    },
  })
}

export function useMemberPackConsumptionsQuery(flightUuid?: string, memberUuid?: string, enabled = true) {
  const baseQuery = flightUuid
    ? `/api/v1/packs/consumptions/by-flight/${flightUuid}`
    : memberUuid
      ? `/api/v1/packs/consumptions/by-member/${memberUuid}`
      : null
  return useQuery({
    queryKey: flightUuid
      ? banquePackKeys.consumptionsByFlight(flightUuid)
      : banquePackKeys.consumptionsByMember(memberUuid ?? 'none'),
    enabled: enabled && Boolean(baseQuery),
    queryFn: async () => {
      const { data } = await apiClient.get<MemberPackConsumption[]>(
        baseQuery!,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useMemberPackBalancesQuery(memberUuid: string | null, fiscalYearUuid: string | null, packType?: string, enabled = true) {
  return useQuery({
    queryKey: banquePackKeys.balances(memberUuid ?? 'none', fiscalYearUuid ?? 'none'),
    enabled: enabled && Boolean(memberUuid && fiscalYearUuid),
    queryFn: async () => {
      const params = new URLSearchParams({ fiscal_year_uuid: fiscalYearUuid! })
      if (packType) params.set('pack_type', packType)
      const { data } = await apiClient.get<MemberPackBalance[]>(
        `/api/v1/packs/balances/${memberUuid}?${params.toString()}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useUpdateConsumptionValidFromMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consumptionUuid, valid_from }: { consumptionUuid: string; valid_from: string }) => {
      const { data } = await apiClient.patch<MemberPackConsumption>(
        `/api/v1/packs/consumptions/${consumptionUuid}/valid-from`,
        { valid_from },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs'] })
    },
  })
}

export type PackPurchaseLine = {
  entry_uuid: string
  reference: string
  description: string
  entry_date: string
  member_uuid: string
  member_name: string | null
  pack_code: string | null
  pack_type: string | null
  amount: string
  valid_from: string | null
  units_purchased: string
  units_consumed: string
  units_remaining: string
  total_discount: string
  consumptions: Array<{
    consumption_uuid: string
    flight_uuid: string
    flight_date: string | null
    asset_code: string | null
    quantity_consumed: string
    discount_unit_price: string
    total_discount_amount: string
    valid_from: string | null
    pack_definition_uuid: string | null
  }>
}

export type PackPurchaseListResponse = {
  items: PackPurchaseLine[]
  total: string
  total_count: number
  page: number
  page_size: number
  total_pages: number
}

export function useBuyPackMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { memberUuid: string; packDefinitionUuid: string; price: string; valid_from: string }) => {
      const { data } = await apiClient.post<{ entry_uuid: string; reference: string; description: string; amount: string; units_purchased: string }>(
        `/api/v1/packs/purchase/${payload.memberUuid}`,
        { pack_definition_uuid: payload.packDefinitionUuid, price: payload.price, valid_from: payload.valid_from },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs'] })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs', 'balances'] })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs', 'purchases'] })
    },
  })
}

export function usePackPurchasesQuery(
  fiscalYearUuid: string | null,
  memberUuid?: string,
  enabled = true,
  pilotQuery?: string,
  page = 1,
  pageSize = 50,
) {
  return useQuery({
    queryKey: ['banque', 'packs', 'purchases', fiscalYearUuid, memberUuid, pilotQuery ?? '', page, pageSize],
    enabled: enabled && !!fiscalYearUuid,
    queryFn: async () => {
      const params = new URLSearchParams({ fiscal_year_uuid: fiscalYearUuid! })
      if (memberUuid) params.append('member_uuid', memberUuid)
      if (pilotQuery) params.append('pilot_query', pilotQuery)
      params.append('page', String(page))
      params.append('page_size', String(pageSize))
      const { data } = await apiClient.get<PackPurchaseListResponse>(
        `/api/v1/packs/purchases?${params}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useUpdatePackPurchaseMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { entryUuid: string; valid_from: string }) => {
      const { data } = await apiClient.patch<{ entry_uuid: string; reference: string; description: string; amount: string; units_purchased: string }>(
        `/api/v1/packs/purchases/${payload.entryUuid}`,
        { valid_from: payload.valid_from },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs', 'purchases'] })
    },
  })
}

// ── REM Adjustment Hooks ────────────────────────────────────────────────

export function useRemAdjustmentPreviewMutation() {
  return useMutation({
    mutationFn: async (payload: { member_uuid: string; fiscal_year_uuid: string; period_start: string; period_end: string }) => {
      const { data } = await apiClient.post<{
        member_uuid: string; total_discount: string; has_existing_draft: boolean; existing_draft_entry_uuid: string | null
      }>('/api/v1/accounting/rem-adjustments/preview', payload, getAuthRequestConfig())
      return data
    },
  })
}

export function useRemAdjustmentApplyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { member_uuid: string; fiscal_year_uuid: string; period_start: string; period_end: string }) => {
      const { data } = await apiClient.post<{ entry_uuid: string; reference: string; description: string; state: number; total_discount: string }>(
        '/api/v1/accounting/rem-adjustments/apply', payload, getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'entries'] })
    },
  })
}

export function useCloseRemPeriodMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { fiscal_year_uuid: string; period_end: string }) => {
      const { data } = await apiClient.post<{ posted_count: number; total_discount: string; entries: Array<{ entry_uuid: string; posted: boolean }> }>(
        '/api/v1/accounting/rem-adjustments/close-period', payload, getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'entries'] })
    },
  })
}

// ── Discount Review ────────────────────────────────────────────────────

export type DiscountReviewResult = {
  members_affected: number
  flights_recalculated: number
  total_discount: string
  rem_entries_created: number
  details: Array<{
    member_uuid: string
    member_name: string
    flights_count: number
    total_discount: string
    rem_entry_uuid?: string
    error?: string
  }>
}

export function useDiscountReviewMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { fiscal_year_uuid: string; force_full?: boolean }) => {
      const { data } = await apiClient.post<DiscountReviewResult>(
        '/api/v1/packs/discount-review', payload, getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs'] })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs', 'purchases'] })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'entries'] })
    },
  })
}

export function useMemberDiscountReviewMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { memberUuid: string; fiscal_year_uuid: string; force_full?: boolean }) => {
      const { data } = await apiClient.post<DiscountReviewResult>(
        `/api/v1/packs/discount-review/${payload.memberUuid}`,
        { fiscal_year_uuid: payload.fiscal_year_uuid, force_full: payload.force_full },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs'] })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'packs', 'purchases'] })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'entries'] })
    },
  })
}

// ── Billable Flights (Phase 4/5) ─────────────────────────────────────────

export const banqueFlightsKeys = {
  billable: (dateFrom?: string, dateTo?: string, typeOfFlight?: number, launchMethod?: number, status?: string, pilotQuery?: string, assetCode?: string, page?: number, pageSize?: number) =>
    ['banque', 'flights', 'billable', dateFrom ?? 'all', dateTo ?? 'all', typeOfFlight ?? 'all', launchMethod ?? 'all', status ?? 'pending', pilotQuery ?? 'all', assetCode ?? 'all', page ?? 1, pageSize ?? 50] as const,
}

export type BillableFlight = {
  uuid: string
  planche_uuid: string | null
  jour: string | null
  pilot_erp_id: string | null
  pilot_name: string | null
  second_pilot_erp_id: string | null
  second_pilot_name: string | null
  second_pilot_trigram: string | null
  charge_to_erp_id: string | null
  charge_to_name: string | null
  charge_comment: string | null
  asset_code: string | null
  type_of_flight: number | null
  type_label: string | null
  takeoff_time: string | null
  landing_time: string | null
  launch_method: number | null
  launch_asset_code: string | null
  launch_pilot_trigram: string | null
  instruction_split: number | null
  aero: string | null
  total_preview: string | null
  status: string
  has_discount: boolean
  errors: string[]
  warnings: string[]
  observations: string | null
  correction_reason: string | null
}

export type BillableFlightListResponse = {
  items: BillableFlight[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export function useBillableFlightsQuery(
  dateFrom?: string,
  dateTo?: string,
  typeOfFlight?: number,
  launchMethod?: number,
  status?: string,
  pilotQuery?: string,
  assetCode?: string,
  page = 1,
  pageSize = 50,
  enabled = true,
) {
  return useQuery({
    queryKey: banqueFlightsKeys.billable(dateFrom, dateTo, typeOfFlight, launchMethod, status, pilotQuery, assetCode, page, pageSize),
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (typeOfFlight !== undefined) params.set('type_of_flight', String(typeOfFlight))
      if (launchMethod !== undefined) params.set('launch_method', String(launchMethod))
      if (status) params.set('status', status)
      if (pilotQuery) params.set('pilot_query', pilotQuery)
      if (assetCode) params.set('asset_code', assetCode)
      params.set('page', String(page))
      params.set('page_size', String(pageSize))
      const query = params.toString() ? `?${params.toString()}` : ''
      const { data } = await apiClient.get<BillableFlightListResponse>(
        `/api/v1/flights/billable${query}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

// ── Raw Flight Details (DB-level dump) ────────────────────────────────────

export type RawFlightDetails = {
  uuid: string
  planche_uuid: string | null
  aero: string | null
  source_snapshot_uuid: string | null
  jour: string | null
  asset_code: string | null
  glider_erp_id: string | null
  pilot_erp_id: string | null
  pilot_name: string | null
  pilot_compta_id: string | null
  second_pilot_erp_id: string | null
  second_pilot_name: string | null
  second_pilot_id: string | null
  charge_to_erp_id: string | null
  charge_to_name: string | null
  charge_to_compta_id: string | null
  charge_comment: string | null
  instruction_split: number
  vi_erp_id: string | null
  vi_name: string | null
  type_of_flight: number | null
  type_label: string | null
  launch_method: number | null
  launch_method_label: string | null
  launch_type: number | null
  launch_asset_code: string | null
  launch_machine_erp_id: string | null
  launch_pilot_trigram: string | null
  launch_instructor_trigram: string | null
  takeoff_time: string | null
  landing_time: string | null
  start_index: number | null
  stop_index: number | null
  engine_time: number | null
  landing_count: number
  flight_km: number | null
  takeoff_location: string | null
  landed_location: string | null
  observations: string | null
  erp_status: number
  erp_status_label: string | null
  validated_at: string | null
  validated_by: string | null
  transferred_at: string | null
  transferred_by: string | null
  revision: number
  source_status: string
  corrected_at: string | null
  corrected_by: string | null
  correction_reason: string | null
  last_export_hash: string | null
  accounting_entry_uuid: string | null
  billing_quote_state: string | null
  has_discount: boolean
}

export function useFlightRawDetailsQuery(flightUuid: string | null) {
  return useQuery({
    queryKey: ['banque', 'flights', 'raw-details', flightUuid],
    enabled: !!flightUuid,
    queryFn: async () => {
      const { data } = await apiClient.get<RawFlightDetails>(
        `/api/v1/flights/${flightUuid}/raw-details`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

// ── Billable Flights — Preview / Apply Mutations ─────────────────────────

export type FlightBillingPayerPreview = {
  member_uuid: string | null
  member_account_id: string | null
  member_name: string | null
  role: string
  share: string
  reason: string
}

export type FlightBillingAppliedLinePreview = {
  source: string
  payer_member_uuid: string | null
  payer_member_account_id: string | null
  payer_role: string
  pricing_version_uuid: string | null
  pricing_item_uuid: string | null
  pricing_item_name: string | null
  asset_uuid: string | null
  asset_code: string | null
  quantity: string
  unit: number | null  // 1=flight_hours, 2=engine_min, 3=engine_1/100h, 4=duration, etc.
  normal_unit_price: string
  applied_unit_price: string
  discount_reason: string | null
  amount: string
  debit_account_code: string | null
  credit_account_code: string | null
  pack_hours_before: string | null
  pack_hours_used: string
  pack_hours_after: string | null
}

export type FlightAccountingLinePreview = {
  side: 'debit' | 'credit' | string
  account_uuid: string | null
  account_code: string | null
  tiers_uuid: string | null
  debit: string
  credit: string
  description: string | null
}

export type FlightBillingPreviewResponse = {
  flight_uuid: string
  planche_uuid: string | null
  flight_date: string | null
  type_of_flight: number | null
  type_label: string | null
  total_amount: string
  billing_hash: string | null
  payers: FlightBillingPayerPreview[]
  applied_lines: FlightBillingAppliedLinePreview[]
  accounting_lines: FlightAccountingLinePreview[]
  errors: { code: string; message: string; scope: string; blocking: boolean }[]
  warnings: { code: string; message: string; scope: string; blocking: boolean }[]
  can_apply: boolean
  no_bill: boolean
}

export type FlightBillingBatchPreviewResponse = {
  items: FlightBillingPreviewResponse[]
  total: number
  billable_count: number
  error_count: number
  total_amount: string
}

export type FlightBillingApplyResponse = {
  entry_uuid: string
  reference: string
  description: string
  state: number
}

export type FlightBillingBatchApplyResponse = {
  items: {
    flight_uuid: string
    entry_uuid: string
    entry_state: number
    reference: string
    description: string
    errors: string[]
  }[]
  total: number
  success_count: number
  error_count: number
}

export function useFlightBillingPreviewMutation() {
  return useMutation({
    mutationFn: async ({ flightUuid, fiscalYearUuid }: { flightUuid: string; fiscalYearUuid?: string | null }) => {
      const { data } = await apiClient.post<FlightBillingPreviewResponse>(
        `/api/v1/flights/${flightUuid}/billing-preview`,
        {},
        { ...getAuthRequestConfig(), params: { fiscal_year_uuid: fiscalYearUuid || undefined } },
      )
      return data
    },
  })
}

export function useFlightBillingBatchPreviewMutation() {
  return useMutation({
    mutationFn: async (payload: { date_from?: string; date_to?: string; flight_uuids?: string[]; fiscal_year_uuid?: string | null }) => {
      const { fiscal_year_uuid, ...body } = payload
      const { data } = await apiClient.post<FlightBillingBatchPreviewResponse>(
        '/api/v1/flights/billing-preview',
        body,
        { ...getAuthRequestConfig(), params: { fiscal_year_uuid: fiscal_year_uuid || undefined } },
      )
      return data
    },
  })
}

export function useFlightBillingApplyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      flightUuid,
      fiscalYearUuid,
    }: {
      flightUuid: string
      fiscalYearUuid: string
    }) => {
      const { data } = await apiClient.post<FlightBillingApplyResponse>(
        `/api/v1/flights/${flightUuid}/billing-apply`,
        { fiscal_year_uuid: fiscalYearUuid },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'flights', 'billable'] })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entries({}) })
    },
  })
}

export function useFlightBillingPostMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      flightUuid,
      fiscalYearUuid,
    }: {
      flightUuid: string
      fiscalYearUuid: string
    }) => {
      const { data } = await apiClient.post<FlightBillingApplyResponse>(
        `/api/v1/flights/${flightUuid}/billing-post`,
        { fiscal_year_uuid: fiscalYearUuid },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'flights', 'billable'] })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entries({}) })
    },
  })
}

export function useFlightBillingBatchApplyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      flight_uuids: string[]
      fiscal_year_uuid: string
    }) => {
      const { data } = await apiClient.post<FlightBillingBatchApplyResponse>(
        '/api/v1/flights/billing-batch-apply',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'flights', 'billable'] })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entries({}) })
    },
  })
}

export function useFlightBillingUnbillMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (flightUuid: string) => {
      await apiClient.post(
        `/api/v1/flights/${flightUuid}/billing-unbill`,
        {},
        getAuthRequestConfig(),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'flights', 'billable'] })
      await queryClient.invalidateQueries({ queryKey: banqueQueryKeys.entries({}) })
    },
  })
}

// ── Flight Billing Settings ──────────────────────────────────────────────

export type FlightBillingSettings = {
  id: number
  fiscal_year_uuid: string
  fl_journal_uuid: string
  receivable_account_uuid: string
  vt_journal_uuid: string
  default_pack_sales_account_uuid: string | null
  rem_journal_uuid: string
  default_pack_discount_expense_account_uuid: string | null
  default_initiation_charge_account_uuid: string | null
  club_charge_account_uuid: string | null
  club_member_uuid: string | null
  rem_period_days: number
  allow_post_purchase_recalculation: boolean
  max_days_for_post_purchase_discount: number | null
  require_approval_for_late_discount: boolean
  created_at: string
  updated_at: string
  updated_by: number | null
}

export type FlightBillingSettingsUpdate = {
  fiscal_year_uuid: string
  fl_journal_uuid: string
  receivable_account_uuid: string
  vt_journal_uuid: string
  default_pack_sales_account_uuid: string | null
  rem_journal_uuid: string
  default_pack_discount_expense_account_uuid: string | null
  default_initiation_charge_account_uuid: string | null
  club_charge_account_uuid: string | null
  club_member_uuid: string | null
  rem_period_days: number
  allow_post_purchase_recalculation: boolean
  max_days_for_post_purchase_discount: number | null
  require_approval_for_late_discount: boolean
}

export type FlightBillingSettingsDefaults = {
  fiscal_year_uuid: string
  fl_journal_uuid: string | null
  receivable_account_uuid: string | null
  vt_journal_uuid: string | null
  default_pack_sales_account_uuid: string | null
  rem_journal_uuid: string | null
  default_pack_discount_expense_account_uuid: string | null
  default_initiation_charge_account_uuid: string | null
  club_charge_account_uuid: string | null
  club_member_uuid: string | null
  rem_period_days: number
  allow_post_purchase_recalculation: boolean
  max_days_for_post_purchase_discount: number
  require_approval_for_late_discount: boolean
}

export function useFlightBillingSettingsQuery(fiscalYearUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: ['banque', 'settings', 'flight-billing', fiscalYearUuid],
    enabled: enabled && !!fiscalYearUuid,
    queryFn: async () => {
      const { data } = await apiClient.get<FlightBillingSettings>(
        `/api/v1/accounting/settings/flight-billing?fiscal_year_uuid=${fiscalYearUuid}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useFlightBillingSettingsDefaultsQuery(fiscalYearUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: ['banque', 'settings', 'flight-billing', 'defaults', fiscalYearUuid],
    enabled: enabled && !!fiscalYearUuid,
    queryFn: async () => {
      const { data } = await apiClient.get<FlightBillingSettingsDefaults>(
        `/api/v1/accounting/settings/flight-billing/defaults?fiscal_year_uuid=${fiscalYearUuid}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useUpsertFlightBillingSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: FlightBillingSettingsUpdate) => {
      const { data } = await apiClient.put<FlightBillingSettings>(
        '/api/v1/accounting/settings/flight-billing',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['banque', 'settings', 'flight-billing', data.fiscal_year_uuid] })
      queryClient.invalidateQueries({ queryKey: ['banque', 'settings', 'flight-billing', 'defaults', data.fiscal_year_uuid] })
    },
  })
}

// ── Bank reconciliation ───────────────────────────────────────────────────────

export const reconciliationQueryKeys = {
  statements: (filters: Record<string, unknown>) => ['banque', 'reconciliation', 'statements', filters] as const,
  statement: (statementUuid: string) => ['banque', 'reconciliation', 'statement', statementUuid] as const,
  lines: (statementUuid: string, filters: Record<string, unknown>) =>
    ['banque', 'reconciliation', 'lines', statementUuid, filters] as const,
  candidates: (lineUuid: string, includeDrafts: boolean) =>
    ['banque', 'reconciliation', 'candidates', lineUuid, includeDrafts] as const,
  report: (statementUuid: string) => ['banque', 'reconciliation', 'report', statementUuid] as const,
  csvMappings: ['banque', 'reconciliation', 'csv-mappings'] as const,
}

export type BankStatementLine = {
  uuid: string
  statement_uuid: string
  line_index: number
  line_date: string
  description: string | null
  amount: string
  reference: string | null
  counterparty: string | null
  match_status: 'unmatched' | 'auto_matched' | 'manually_matched' | 'excluded' | 'discrepancy'
  matched_entry_uuid: string | null
  matched_fiscal_year_uuid: string | null
  match_confidence: string | null
  discrepancy_type: 'missing_entry' | 'amount_variance' | 'timing' | 'duplicate' | null
  discrepancy_notes: string | null
  resolved_at: string | null
  resolved_by: number | null
  created_at: string
}

export type BankStatement = {
  uuid: string
  fiscal_year_uuid: string
  journal_uuid: string
  account_uuid: string
  import_date: string
  statement_date: string
  statement_period_start: string | null
  statement_period_end: string | null
  source_format: string
  raw_filename: string | null
  opening_balance: string
  closing_balance: string
  total_debits: string
  total_credits: string
  line_count: number
  status: 'imported' | 'matching' | 'reconciled' | 'flagged'
  reconciled_balance: string | null
  balance_difference: string | null
  reconciled_at: string | null
  reconciled_by: number | null
  created_by: number
  created_at: string
  updated_at: string
}

export type BankStatementSummary = BankStatement & {
  status_counts: Record<string, number>
  unresolved_count: number
  live_balance_difference: string
}

export type MatchResult = {
  auto_matched: number
  flagged_review: number
  unmatched: number
}

export type Discrepancy = {
  line_uuid: string
  type: 'missing_entry' | 'amount_variance' | 'timing' | 'duplicate'
  description: string
}

export type ReconciliationUnresolvedLine = {
  uuid: string
  line_date: string
  description: string | null
  amount: string
  match_status: string
  discrepancy_type: string | null
  discrepancy_notes: string | null
}

export type ReconciliationCorrectingEntry = {
  line_uuid: string
  entry_uuid: string
  fiscal_year_uuid: string
  reference: string | null
  description: string | null
}

export type ReconciliationReport = {
  statement_uuid: string
  fiscal_year_uuid: string
  journal_uuid: string
  account_uuid: string
  statement_date: string
  period_start: string | null
  period_end: string | null
  opening_balance: string
  closing_balance: string
  reconciled_balance: string | null
  balance_difference: string | null
  live_balance_difference: string
  status: string
  line_count: number
  status_counts: Record<string, number>
  correcting_entries: ReconciliationCorrectingEntry[]
  unresolved_lines: ReconciliationUnresolvedLine[]
  reconciled_at: string | null
  reconciled_by: number | null
}

export type BankCsvMapping = {
  uuid: string
  name: string
  created_by: number
  column_mapping: Record<string, string>
  separator: string | null
  encoding: string | null
  date_format: string
  created_at: string
}

export type BankCsvMappingCreatePayload = {
  name: string
  column_mapping: Record<string, string>
  separator?: string | null
  encoding?: string | null
  date_format: string
}

export type ReconciliationStatementFilters = {
  fiscal_year_uuid?: string
  journal_uuid?: string
  status?: string
}

export function useReconciliationStatementsQuery(filters: ReconciliationStatementFilters, enabled = true) {
  return useQuery({
    queryKey: reconciliationQueryKeys.statements(filters),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<{ items: BankStatementSummary[]; total: number }>(
        '/api/v1/reconciliation/statements',
        { ...getAuthRequestConfig(), params: filters },
      )
      return data
    },
  })
}

export function useReconciliationStatementQuery(statementUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: reconciliationQueryKeys.statement(statementUuid ?? 'none'),
    enabled: enabled && Boolean(statementUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<BankStatement>(
        `/api/v1/reconciliation/statements/${statementUuid}`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export type ReconciliationLineFilters = {
  description?: string
  match_status?: string
  date_from?: string
  date_to?: string
  amount_min?: string
  amount_max?: string
  limit?: number
  offset?: number
}

export type BankStatementLineListResponse = {
  items: BankStatementLine[]
  total: number
}

export function useReconciliationLinesQuery(
  statementUuid: string | null,
  filters: ReconciliationLineFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: reconciliationQueryKeys.lines(statementUuid ?? 'none', filters),
    enabled: enabled && Boolean(statementUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<BankStatementLineListResponse>(
        `/api/v1/reconciliation/statements/${statementUuid}/lines`,
        { ...getAuthRequestConfig(), params: filters },
      )
      return data
    },
  })
}

export type ReconciliationCandidate = {
  entry_uuid: string
  fiscal_year_uuid: string
  entry_date: string
  description: string | null
  reference: string | null
  state: number
  amount: string
  amount_diff: string
  date_diff: number
  description_score: string
  score: string
  is_internal_transfer: boolean
}

export function useReconciliationCandidatesQuery(lineUuid: string | null, includeDrafts: boolean, enabled = true) {
  return useQuery({
    queryKey: reconciliationQueryKeys.candidates(lineUuid ?? 'none', includeDrafts),
    enabled: enabled && Boolean(lineUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<ReconciliationCandidate[]>(
        `/api/v1/reconciliation/lines/${lineUuid}/candidates`,
        { ...getAuthRequestConfig(), params: { include_drafts: includeDrafts } },
      )
      return data
    },
  })
}

export function useImportStatementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      fiscal_year_uuid,
      journal_uuid,
      account_uuid,
      csv_mapping_uuid,
    }: {
      file: File
      fiscal_year_uuid: string
      journal_uuid: string
      account_uuid: string
      csv_mapping_uuid?: string
    }) => {
      const authConfig = getAuthRequestConfig()
      const formData = new FormData()
      formData.append('file', file)
      formData.append('fiscal_year_uuid', fiscal_year_uuid)
      formData.append('journal_uuid', journal_uuid)
      formData.append('account_uuid', account_uuid)
      if (csv_mapping_uuid) formData.append('csv_mapping_uuid', csv_mapping_uuid)
      const { data } = await apiClient.post<BankStatement>(
        '/api/v1/reconciliation/import',
        formData,
        { ...(authConfig ?? {}), headers: { ...(authConfig?.headers ?? {}) } },
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation'] })
    },
  })
}

export function useDeleteReconciliationStatementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (statementUuid: string) => {
      await apiClient.delete(`/api/v1/reconciliation/statements/${statementUuid}`, getAuthRequestConfig())
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation'] })
    },
  })
}

export function useRunAutoMatchMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ statementUuid, includeDrafts }: { statementUuid: string; includeDrafts?: boolean }) => {
      const { data } = await apiClient.post<MatchResult>(
        `/api/v1/reconciliation/statements/${statementUuid}/match`,
        {},
        { ...getAuthRequestConfig(), params: { include_drafts: includeDrafts ?? false } },
      )
      return data
    },
    onSuccess: async (_data, { statementUuid }) => {
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.statement(statementUuid) })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'lines', statementUuid] })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'statements'] })
      // A matched entry can never be a candidate for any other line — invalidate every
      // open candidate list, not just this statement's.
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'candidates'] })
    },
  })
}

export function useManualMatchMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      line_uuid: string
      entry_uuid: string
      fiscal_year_uuid: string
      include_drafts?: boolean
    }) => {
      const { data } = await apiClient.post<BankStatementLine>(
        '/api/v1/reconciliation/manual-match',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.statement(data.statement_uuid) })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'lines', data.statement_uuid] })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'candidates'] })
    },
  })
}

export function useUnmatchLineMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { line_uuid: string; reason: string }) => {
      const { data } = await apiClient.post<BankStatementLine>(
        '/api/v1/reconciliation/unmatch',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.statement(data.statement_uuid) })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'lines', data.statement_uuid] })
      // Unmatching frees the entry back up as a candidate for other lines.
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'candidates'] })
    },
  })
}

/** One-shot discrepancy detection — invoked explicitly (e.g. right after a matching run)
 * rather than as an ambient query, since it scans every line of the statement server-side. */
export function useDetectDiscrepanciesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (statementUuid: string) => {
      const { data } = await apiClient.get<Discrepancy[]>(
        `/api/v1/reconciliation/statements/${statementUuid}/discrepancies`,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, statementUuid) => {
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.statement(statementUuid) })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'lines', statementUuid] })
    },
  })
}

export function useResolveDiscrepancyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      line_uuid: string
      action: 'accept' | 'exclude' | 'create_correcting_entry'
      counter_account_uuid?: string
      notes?: string
    }) => {
      const { data } = await apiClient.post<BankStatementLine>(
        '/api/v1/reconciliation/resolve-discrepancy',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.statement(data.statement_uuid) })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'lines', data.statement_uuid] })
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.report(data.statement_uuid) })
    },
  })
}

export function useCloseReconciliationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (statementUuid: string) => {
      const { data } = await apiClient.post<BankStatement>(
        `/api/v1/reconciliation/statements/${statementUuid}/close`,
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, statementUuid) => {
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.statement(statementUuid) })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'lines', statementUuid] })
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.report(statementUuid) })
      await queryClient.invalidateQueries({ queryKey: ['banque', 'reconciliation', 'statements'] })
    },
  })
}

export function useReconciliationReportQuery(statementUuid: string | null, enabled = true) {
  return useQuery({
    queryKey: reconciliationQueryKeys.report(statementUuid ?? 'none'),
    enabled: enabled && Boolean(statementUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<ReconciliationReport>(
        `/api/v1/reconciliation/statements/${statementUuid}/report`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export async function downloadReconciliationReport(statementUuid: string, filename: string) {
  const { data } = await apiClient.get(
    `/api/v1/reconciliation/statements/${statementUuid}/report/download`,
    { ...getAuthRequestConfig(), params: { format: 'json' }, responseType: 'blob' },
  )
  const url = window.URL.createObjectURL(data as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export function useCsvMappingsQuery(enabled = true) {
  return useQuery({
    queryKey: reconciliationQueryKeys.csvMappings,
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<BankCsvMapping[]>(
        '/api/v1/reconciliation/csv-mappings',
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function useCreateCsvMappingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: BankCsvMappingCreatePayload) => {
      const { data } = await apiClient.post<BankCsvMapping>(
        '/api/v1/reconciliation/csv-mappings',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.csvMappings })
    },
  })
}

export function useDeleteCsvMappingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (mappingUuid: string) => {
      await apiClient.delete(`/api/v1/reconciliation/csv-mappings/${mappingUuid}`, getAuthRequestConfig())
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.csvMappings })
    },
  })
}

// ── Cheque remittance ────────────────────────────────────────────────────────

export type ChequeCandidate = {
  entry_uuid: string
  fiscal_year_uuid: string
  entry_date: string
  description: string
  state: number
  account_code: string
  tiers_display_ref: string | null
  tiers_display_name: string | null
  amount: string
}

export type ChequeRemittance = {
  uuid: string
  fiscal_year_uuid: string
  remittance_date: string
  deposit_entry_uuid: string
  total_amount: string
  entry_count: number
  created_at: string
}

export function useChequeCandidatesQuery(fiscalYearUuid: string, includeDrafts: boolean, enabled = true) {
  return useQuery({
    queryKey: banqueQueryKeys.chequeCandidates(fiscalYearUuid, includeDrafts),
    enabled: enabled && Boolean(fiscalYearUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<ChequeCandidate[]>(
        '/api/v1/cheque-remittances/candidates',
        {
          ...getAuthRequestConfig(),
          params: { fiscal_year_uuid: fiscalYearUuid, include_drafts: includeDrafts },
        },
      )
      return data
    },
  })
}

export function useCreateChequeRemittanceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { fiscal_year_uuid: string; remittance_date: string; entry_uuids: string[] }) => {
      const { data } = await apiClient.post<ChequeRemittance>(
        '/api/v1/cheque-remittances',
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
