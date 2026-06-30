import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, getAuthRequestConfig } from '../../../api/client'
import type {
  AccountEntriesResponse,
  AccountSummary,
  Committee,
  CommitteeMembership,
  CreateCommitteePayload,
  CreateMemberPayload,
  DepositRequest,
  DepositResponse,
  ExpenseAccessResponse,
  ImportResult,
  LogbookFilters,
  LogbookResponse,
  MemberDetail,
  MemberFilters,
  MemberOption,
  MemberRegistration,
  MemberSheet,
  MemberSummary,
  RegistrationCompletionPayload,
  UpdateMemberRegistrationPayload,
  ReplaceCommitteeMembersPayload,
  UpdateCommitteePayload,
  UpdateMemberPayload,
  UpsertMemberSheetPayload,
} from '../types'

export const membersQueryKeys = {
  root: ['members'] as const,
  lists: ['members', 'list'] as const,
  list: (filters: MemberFilters) => ['members', 'list', filters] as const,
  count: (filters: Omit<MemberFilters, 'limit' | 'offset'>) => ['members', 'count', filters] as const,
  options: (params: { search?: string; limit?: number; member_categories?: number[]; registered_for_year?: number }) => ['members', 'options', params] as const,
  detail: (memberUuid: string) => ['members', 'detail', memberUuid] as const,
  registrations: (memberUuid: string) => ['members', 'registrations', memberUuid] as const,
  committees: ['members', 'committees'] as const,
  committeeMembers: (committeeUuid: string, year: number) => ['members', 'committee-members', committeeUuid, year] as const,
  sheets: (memberUuid: string) => ['members', 'sheets', memberUuid] as const,
}

function compactParams(filters: MemberFilters | Record<string, unknown>) {
  const compacted = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )

  if ('member_categories' in compacted && Array.isArray(compacted.member_categories)) {
    compacted.member_categories = compacted.member_categories.join(',')
  }

  return compacted
}

export function useMembersQuery(filters: MemberFilters) {
  return useQuery({
    queryKey: membersQueryKeys.list(filters),
    queryFn: async () => {
      const { data } = await apiClient.get<MemberSummary[]>('/api/v1/members', {
        ...getAuthRequestConfig(),
        params: compactParams(filters),
      })
      return data
    },
  })
}

export function useMembersCountQuery(filters: Omit<MemberFilters, 'limit' | 'offset'>) {
  return useQuery({
    queryKey: membersQueryKeys.count(filters),
    queryFn: async () => {
      const { data } = await apiClient.get<{ total: number }>('/api/v1/members/count', {
        ...getAuthRequestConfig(),
        params: compactParams(filters),
      })
      return data.total
    },
  })
}

export function useMemberOptionsQuery(params: { search?: string; limit?: number; member_categories?: number[]; registered_for_year?: number; is_employee?: boolean } = {}) {
  return useQuery({
    queryKey: membersQueryKeys.options(params),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data } = await apiClient.get<MemberOption[]>('/api/v1/members/options', {
        ...getAuthRequestConfig(),
        params: compactParams({ limit: 5000, ...params }),
      })
      return data
    },
  })
}

export function useMemberQuery(memberUuid: string | null) {
  return useQuery({
    queryKey: membersQueryKeys.detail(memberUuid ?? 'new'),
    enabled: Boolean(memberUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<MemberDetail>(`/api/v1/members/${memberUuid}`, getAuthRequestConfig())
      return data
    },
  })
}

export function useCreateMemberMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateMemberPayload) => {
      const { data } = await apiClient.post<MemberDetail>('/api/v1/members', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.root })
    },
  })
}

export function useUpdateMemberMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberUuid, payload }: { memberUuid: string; payload: UpdateMemberPayload }) => {
      const { data } = await apiClient.patch<MemberDetail>(`/api/v1/members/${memberUuid}`, payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.root })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.detail(variables.memberUuid) })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.sheets(variables.memberUuid) })
    },
  })
}

export function useCompleteRegistrationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      memberUuid,
      payload,
    }: {
      memberUuid: string
      payload: RegistrationCompletionPayload
    }) => {
      const { data } = await apiClient.post<MemberDetail>(
        `/api/v1/members/${memberUuid}/complete-registration`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.root })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.detail(variables.memberUuid) })
    },
  })
}

export function useUpdateMemberRegistrationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      memberUuid,
      registrationUuid,
      payload,
    }: {
      memberUuid: string
      registrationUuid: string
      payload: UpdateMemberRegistrationPayload
    }) => {
      const { data } = await apiClient.patch<MemberRegistration>(
        `/api/v1/members/${memberUuid}/registrations/${registrationUuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.root })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.detail(variables.memberUuid) })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.registrations(variables.memberUuid) })
    },
  })
}

export function useCommitteesQuery(activeOnly?: boolean) {
  return useQuery({
    queryKey: [...membersQueryKeys.committees, activeOnly ?? 'all'] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<Committee[]>('/api/v1/members/committees', {
        ...getAuthRequestConfig(),
        params: compactParams({ active_only: activeOnly }),
      })
      return data
    },
  })
}

export function useCreateCommitteeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateCommitteePayload) => {
      const { data } = await apiClient.post<Committee>('/api/v1/members/committees', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.root })
    },
  })
}

export function useUpdateCommitteeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ committeeUuid, payload }: { committeeUuid: string; payload: UpdateCommitteePayload }) => {
      const { data } = await apiClient.patch<Committee>(
        `/api/v1/members/committees/${committeeUuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.root })
    },
  })
}

export function useCommitteeMembersQuery(committeeUuid: string | null, year: number) {
  return useQuery({
    queryKey: membersQueryKeys.committeeMembers(committeeUuid ?? 'none', year),
    enabled: Boolean(committeeUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<MemberSummary[]>('/api/v1/members', {
        ...getAuthRequestConfig(),
        params: compactParams({ committee_uuid: committeeUuid, year }),
      })
      return data
    },
  })
}

export function useReplaceCommitteeMembersMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      committeeUuid,
      year,
      payload,
    }: {
      committeeUuid: string
      year: number
      payload: ReplaceCommitteeMembersPayload
    }) => {
      const { data } = await apiClient.put<CommitteeMembership[]>(
        `/api/v1/members/committees/${committeeUuid}/members/${year}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.root })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.committeeMembers(variables.committeeUuid, variables.year) })
    },
  })
}

export function useMemberSheetsQuery(memberUuid: string | null) {
  return useQuery({
    queryKey: membersQueryKeys.sheets(memberUuid ?? 'none'),
    enabled: Boolean(memberUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<MemberSheet[]>(`/api/v1/members/${memberUuid}/sheets`, getAuthRequestConfig())
      return data
    },
  })
}

export function useUpsertMemberSheetMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      memberUuid,
      year,
      payload,
    }: {
      memberUuid: string
      year: number
      payload: UpsertMemberSheetPayload
    }) => {
      const { data } = await apiClient.put<MemberSheet>(
        `/api/v1/members/${memberUuid}/sheets/${year}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.root })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.detail(variables.memberUuid) })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.sheets(variables.memberUuid) })
    },
  })
}

export function useEnableExpenseAccessMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberUuid, year }: { memberUuid: string; year: number }) => {
      const { data } = await apiClient.post<ExpenseAccessResponse>(
        `/api/v1/members/${memberUuid}/sheets/${year}/expense-access`,
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.sheets(variables.memberUuid) })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.detail(variables.memberUuid) })
    },
  })
}

export function useDisableExpenseAccessMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberUuid, year }: { memberUuid: string; year: number }) => {
      const { data } = await apiClient.delete<ExpenseAccessResponse>(
        `/api/v1/members/${memberUuid}/sheets/${year}/expense-access`,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.sheets(variables.memberUuid) })
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.detail(variables.memberUuid) })
    },
  })
}

export function useImportMembersMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ file, updateExisting = false }: { file: File; updateExisting?: boolean }) => {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await apiClient.post<ImportResult>(
        '/api/v1/members/import',
        formData,
        {
          ...getAuthRequestConfig(),
          params: {
            update_existing: updateExisting,
          },
        },
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKeys.lists })
    },
  })
}

export async function exportMembersToCSV(
  filters?: {
    status?: number
    member_category?: number
    search?: string
  },
) {
  try {
    const { data } = await apiClient.get<Blob | string>('/api/v1/members/export', {
      ...getAuthRequestConfig(),
      params: compactParams(filters ?? {}),
      responseType: 'blob',
    })

    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `members_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    const responseData =
      typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      typeof (error as { response?: unknown }).response === 'object'
        ? (error as { response?: { data?: unknown } }).response?.data
        : null

    if (responseData instanceof Blob) {
      const errorText = await responseData.text()
      try {
        const parsed = JSON.parse(errorText) as { detail?: unknown; message?: unknown }
        const detailMessage = typeof parsed.detail === 'string' ? parsed.detail : null
        const message = typeof parsed.message === 'string' ? parsed.message : null
        throw new Error(detailMessage ?? message ?? errorText)
      } catch {
        throw new Error(errorText || 'Export failed')
      }
    }

    throw error
  }
}

// ── Logbook ──────────────────────────────────────────────────────────────

export const logbookQueryKeys = {
  list: (memberUuid: string, filters: LogbookFilters) => ['members', 'logbook', memberUuid, filters] as const,
}

export function useMemberLogbookQuery(memberUuid: string | null, filters: LogbookFilters = {}) {
  return useQuery({
    queryKey: logbookQueryKeys.list(memberUuid ?? 'none', filters),
    enabled: Boolean(memberUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<LogbookResponse>(
        `/api/v1/members/${memberUuid}/logbook`,
        {
          ...getAuthRequestConfig(),
          params: compactParams(filters as unknown as Record<string, unknown>),
        },
      )
      return data
    },
  })
}

export type { LogbookFilters } from '../types'

// ── Account / Balance ────────────────────────────────────────────────────

export function useMemberAccountSummaryQuery(memberUuid: string | null, fiscalYearUuid?: string | null) {
  return useQuery({
    queryKey: ['members', 'account-summary', memberUuid, fiscalYearUuid],
    enabled: Boolean(memberUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<AccountSummary>(
        `/api/v1/members/${memberUuid}/account-summary`,
        {
          ...getAuthRequestConfig(),
          params: fiscalYearUuid ? { fiscal_year_uuid: fiscalYearUuid } : {},
        },
      )
      return data
    },
  })
}

export function useMemberAccountEntriesQuery(
  memberUuid: string | null,
  filters: { fiscalYearUuid?: string; state?: number; limit?: number; offset?: number } = {},
) {
  return useQuery({
    queryKey: ['members', 'account-entries', memberUuid, filters],
    enabled: Boolean(memberUuid),
    queryFn: async () => {
      const params: Record<string, string | number> = {}
      if (filters.fiscalYearUuid) params.fiscal_year_uuid = filters.fiscalYearUuid
      if (filters.state !== undefined) params.state = filters.state
      if (filters.limit !== undefined) params.limit = filters.limit
      if (filters.offset !== undefined) params.offset = filters.offset

      const { data } = await apiClient.get<AccountEntriesResponse>(
        `/api/v1/members/${memberUuid}/account-entries`,
        { ...getAuthRequestConfig(), params },
      )
      return data
    },
  })
}

export function useCreateMemberDepositMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberUuid, payload }: { memberUuid: string; payload: DepositRequest }) => {
      const { data } = await apiClient.post<DepositResponse>(
        `/api/v1/members/${memberUuid}/deposit`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['members', 'account-summary', variables.memberUuid] })
      await queryClient.invalidateQueries({ queryKey: ['members', 'account-entries', variables.memberUuid] })
    },
  })
}

export type { AccountSummary, AccountEntriesResponse, AccountEntryItem, DepositResponse } from '../types'

