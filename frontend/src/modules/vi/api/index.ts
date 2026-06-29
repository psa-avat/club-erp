/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: frontend API hooks for VI catalog, entitlements, planning and staging
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

export const viQueryKeys = {
  root: ['vi'] as const,
  types: ['vi', 'types'] as const,
  entitlements: (status?: number) => ['vi', 'entitlements', status ?? 'all'] as const,
  accounting: (uuid: string) => ['vi', 'accounting', uuid] as const,
  flightLinks: (uuid: string) => ['vi', 'flight-links', uuid] as const,
  staging: ['vi', 'staging'] as const,
}

export type ViType = {
  uuid: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  charge_account_uuid: string | null
  charge_account_code: string | null
  // Accounting configuration
  client_account_uuid: string | null
  client_account_code: string | null
  revenue_account_uuid: string | null
  revenue_account_code: string | null
  insurance_account_uuid: string | null
  insurance_account_code: string | null
  insurance_tiers_uuid: string | null
  insurance_amount: number | null
  max_flights: number
  analytical_cost_account_uuid: string | null
  analytical_cost_account_code: string | null
  analytical_reflection_account_uuid: string | null
  analytical_reflection_account_code: string | null
}

export type ViTypeAccountingPatch = {
  client_account_uuid?: string | null
  revenue_account_uuid?: string | null
  insurance_account_uuid?: string | null
  insurance_tiers_uuid?: string | null
  insurance_amount?: number | null
  max_flights?: number
  analytical_cost_account_uuid?: string | null
  analytical_reflection_account_uuid?: string | null
}

export type ViFlightLinkResponse = {
  uuid: string
  entitlement_uuid: string
  flight_uuid: string | null
  sequence: number
  analytical_entry_uuid: string | null
  analytical_state: number | null
  notes: string | null
  flight_date: string | null
  aircraft_code: string | null
  duration_minutes: number | null
}

export type ViAccountingEntryRef = {
  entry_uuid: string | null
  state: number | null   // 1=Draft 2=Posted 3=Cancelled
  amount: string | null
  entry_date: string | null
}

export type ViAccountingSummary = {
  entitlement_uuid: string
  entitlement_code: string
  vi_type_code: string | null
  amount_ttc: string | null
  insurance_amount: string | null
  flight_portion: string | null
  buyer_member_uuid: string | null
  buyer_member_name: string | null
  registered_member_uuid: string | null
  registered_member_name: string | null
  is_generic: boolean
  max_flights: number
  flight_links: ViFlightLinkResponse[]
  realization: ViAccountingEntryRef
  conversion: ViAccountingEntryRef
}

export type ViFlightLinkCreate = {
  flight_uuid: string
}

export type ViEntitlementAmountPatch = {
  amount_ttc?: string | null
  buyer_member_uuid?: string | null
}

export type ViRealizationEntryRequest = {
  fiscal_year_uuid: string
  entry_date?: string | null
}

export type ViEntitlement = {
  uuid: string
  code: string
  vi_type_uuid: string
  vi_type_code: string | null
  description: string | null
  validity_date: string | null
  scheduled_date: string | null
  realisation_date: string | null
  partner_code: string | null
  origin_type: number
  origin_ref: string | null
  notes: string | null
  status: number
  is_generic: boolean
  amount_ttc: string | null
  buyer_member_uuid: string | null
  registered_member_uuid: string | null
  purchase_entry_uuid: string | null
  realization_entry_uuid: string | null
  conversion_entry_uuid: string | null
  flight_link_count: number
  created_at: string
  updated_at: string
}

export type ViStagingRow = {
  uuid: string
  item_id: number
  full_name: string | null
  email: string | null
  phone: string | null
  amount_cents: number | null
  form_slug: string | null
  purchased_at: string | null
  promoted_vi_uuid: string | null
  promoted_at: string | null
  status: number
}

export type ViImportPreview = {
  fetched_count: number
  net_new_count: number
  already_staged_count: number
}

export type ViImportResult = {
  fetched_count: number
  created_count: number
  duplicate_count: number
  staging_total_count: number
}

export type ViPromotionResult = {
  selected_count: number
  promoted_count: number
  already_promoted_count: number
  failed_count: number
  promoted_entitlement_uuids: string[]
}

export function useViTypesQuery() {
  return useQuery({
    queryKey: viQueryKeys.types,
    queryFn: async () => {
      const { data } = await apiClient.get<ViType[]>('/api/v1/vi/types', getAuthRequestConfig())
      return data
    },
  })
}

export function useCreateViTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { code: string; name: string; description?: string; is_active?: boolean; charge_account_uuid?: string | null }) => {
      const { data } = await apiClient.post<ViType>('/api/v1/vi/types', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.types })
    },
  })
}

export function useUpdateViTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ typeUuid, payload }: { typeUuid: string; payload: Partial<ViType> }) => {
      const { data } = await apiClient.patch<ViType>(`/api/v1/vi/types/${typeUuid}`, payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.types })
    },
  })
}

export function useViEntitlementsQuery(status?: number) {
  return useQuery({
    queryKey: viQueryKeys.entitlements(status),
    queryFn: async () => {
      const authConfig = getAuthRequestConfig()
      const { data } = await apiClient.get<ViEntitlement[]>('/api/v1/vi/entitlements', {
        ...(authConfig ?? {}),
        params: {
          status: typeof status === 'number' ? status : undefined,
        },
      })
      return data
    },
  })
}

export function useCreateViEntitlementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      code: string
      vi_type_uuid: string
      description?: string
      amount_ttc?: string | null
      validity_date?: string | null
      scheduled_date?: string | null
      realisation_date?: string | null
      partner_code?: string | null
      origin_type?: number
      origin_ref?: string | null
      notes?: string | null
      status?: number
      is_generic?: boolean
    }) => {
      const { data } = await apiClient.post<ViEntitlement>('/api/v1/vi/entitlements', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function usePatchViEntitlementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      entitlementUuid,
      payload,
    }: {
      entitlementUuid: string
      payload: {
        code?: string
        vi_type_uuid?: string
        description?: string | null
        validity_date?: string | null
        scheduled_date?: string | null
        realisation_date?: string | null
        partner_code?: string | null
        origin_type?: number
        origin_ref?: string | null
        notes?: string | null
        status?: number
      }
    }) => {
      const { data } = await apiClient.patch<ViEntitlement>(
        `/api/v1/vi/entitlements/${entitlementUuid}`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function usePatchViNotesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entitlementUuid, notes }: { entitlementUuid: string; notes: string | null }) => {
      const { data } = await apiClient.patch<ViEntitlement>(
        `/api/v1/vi/entitlements/${entitlementUuid}/notes`,
        { notes },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function useBulkScheduleViMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { entitlement_uuids: string[]; scheduled_date: string | null }) => {
      const { data } = await apiClient.post<{ success: boolean; updated_count: number }>(
        '/api/v1/vi/planning/bulk-schedule',
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function useViStagingQuery() {
  return useQuery({
    queryKey: viQueryKeys.staging,
    queryFn: async () => {
      const { data } = await apiClient.get<ViStagingRow[]>('/api/v1/vi/staging', getAuthRequestConfig())
      return data
    },
  })
}

type ViImportPayload = {
  status: 'active' | 'done'
  source: 'items' | 'orders'
  campaign_type?: string
  page_size?: number
  purchased_from_year?: number
}

export function useHelloassoViPreviewMutation() {
  return useMutation({
    mutationFn: async (payload: ViImportPayload) => {
      const { data } = await apiClient.post<ViImportPreview>('/api/v1/helloasso/vi/staging/preview', payload, getAuthRequestConfig())
      return data
    },
  })
}

export function useHelloassoViImportMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ViImportPayload) => {
      const { data } = await apiClient.post<ViImportResult>('/api/v1/helloasso/vi/staging/import', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.staging })
    },
  })
}

export function useDiscardViStagingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (stagingUuid: string) => {
      const { data } = await apiClient.post<ViStagingRow>(
        `/api/v1/vi/staging/${stagingUuid}/discard`,
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.staging })
    },
  })
}

export function usePromoteViStagingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { staging_uuids: string[]; vi_type_uuid?: string }) => {
      const { data } = await apiClient.post<ViPromotionResult>('/api/v1/vi/staging/promote', payload, getAuthRequestConfig())
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

// ── VI Accounting hooks (Steps 2a+2b) ─────────────────────────────────────

export function useViAccountingSummaryQuery(entitlementUuid: string | null) {
  return useQuery({
    queryKey: viQueryKeys.accounting(entitlementUuid ?? ''),
    enabled: Boolean(entitlementUuid),
    queryFn: async () => {
      const { data } = await apiClient.get<ViAccountingSummary>(
        `/api/v1/vi/entitlements/${entitlementUuid}/accounting`,
        getAuthRequestConfig(),
      )
      return data
    },
  })
}

export function usePatchViAccountingMetaMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entitlementUuid, payload }: { entitlementUuid: string; payload: ViEntitlementAmountPatch }) => {
      const { data } = await apiClient.patch<ViEntitlement>(
        `/api/v1/vi/entitlements/${entitlementUuid}/accounting-meta`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, { entitlementUuid }) => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.accounting(entitlementUuid) })
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.entitlements() })
    },
  })
}

export function useCreateViRealizationEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entitlementUuid, payload }: { entitlementUuid: string; payload: ViRealizationEntryRequest }) => {
      const { data } = await apiClient.post<ViAccountingSummary>(
        `/api/v1/vi/entitlements/${entitlementUuid}/realization-entry`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, { entitlementUuid }) => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.accounting(entitlementUuid) })
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.entitlements() })
    },
  })
}

export function useCancelViRealizationEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (entitlementUuid: string) => {
      const { data } = await apiClient.post<ViAccountingSummary>(
        `/api/v1/vi/entitlements/${entitlementUuid}/cancel-realization-entry`,
        {},
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, entitlementUuid) => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.accounting(entitlementUuid) })
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.entitlements() })
    },
  })
}

// Archive a voucher: set realisation_date → auto sets status=REALIZED
export function useArchiveViEntitlementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entitlementUuid, date }: { entitlementUuid: string; date: string }) => {
      const { data } = await apiClient.patch<ViEntitlement>(
        `/api/v1/vi/entitlements/${entitlementUuid}/realisation-date`,
        { value: date },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function useCreateViReimbursementEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      entitlementUuid,
      fiscalYearUuid,
      bankAccountUuid,
      amountTtc,
      notes,
    }: {
      entitlementUuid: string
      fiscalYearUuid: string
      bankAccountUuid: string
      amountTtc?: string | null
      notes?: string | null
    }) => {
      const { data } = await apiClient.post<ViEntitlement>(
        `/api/v1/vi/entitlements/${entitlementUuid}/reimbursement-entry`,
        { fiscal_year_uuid: fiscalYearUuid, bank_account_uuid: bankAccountUuid, amount_ttc: amountTtc ?? null, notes: notes ?? null },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function useCreateViPurchaseEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      entitlementUuid,
      fiscalYearUuid,
      bankAccountUuid,
      entryDate,
      amountTtc,
      notes,
    }: {
      entitlementUuid: string
      fiscalYearUuid: string
      bankAccountUuid: string
      entryDate?: string | null
      amountTtc?: string | null
      notes?: string | null
    }) => {
      const { data } = await apiClient.post<ViEntitlement>(
        `/api/v1/vi/entitlements/${entitlementUuid}/purchase-entry`,
        {
          fiscal_year_uuid: fiscalYearUuid,
          bank_account_uuid: bankAccountUuid,
          entry_date: entryDate ?? null,
          amount_ttc: amountTtc ?? null,
          notes: notes ?? null,
        },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

// ── VI Flight Link hooks ───────────────────────────────────────────────────

export function useAddViFlightLinkMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entitlementUuid, payload }: { entitlementUuid: string; payload: ViFlightLinkCreate }) => {
      const { data } = await apiClient.post<ViAccountingSummary>(
        `/api/v1/vi/entitlements/${entitlementUuid}/flight-links`,
        payload,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, { entitlementUuid }) => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.accounting(entitlementUuid) })
    },
  })
}

export function useCreateViConversionEntryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      entitlementUuid,
      fiscalYearUuid,
      registeredMemberUuid,
    }: {
      entitlementUuid: string
      fiscalYearUuid: string
      registeredMemberUuid: string
    }) => {
      const { data } = await apiClient.post<ViAccountingSummary>(
        `/api/v1/vi/entitlements/${entitlementUuid}/conversion-entry`,
        { fiscal_year_uuid: fiscalYearUuid, registered_member_uuid: registeredMemberUuid },
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, { entitlementUuid }) => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.accounting(entitlementUuid) })
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.root })
    },
  })
}

export function useRemoveViFlightLinkMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entitlementUuid, linkUuid }: { entitlementUuid: string; linkUuid: string }) => {
      const { data } = await apiClient.delete<ViAccountingSummary>(
        `/api/v1/vi/entitlements/${entitlementUuid}/flight-links/${linkUuid}`,
        getAuthRequestConfig(),
      )
      return data
    },
    onSuccess: async (_data, { entitlementUuid }) => {
      await queryClient.invalidateQueries({ queryKey: viQueryKeys.accounting(entitlementUuid) })
    },
  })
}
