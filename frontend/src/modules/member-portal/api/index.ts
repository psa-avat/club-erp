import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { portalApiClient, setPortalToken, setPortalProfile, clearPortalToken } from './client'
export { getPortalToken, getPortalProfile, clearPortalToken, isPortalAuthenticated } from './client'
import type { AccountEntriesResponse, AccountSummary, DepositRequest, DepositResponse, LogbookFilters, LogbookResponse } from '../../members/types'
import type {
  MemberPortalLoginResponse,
  MemberPortalFlightListResponse,
  MemberPortalFlightBillingDetail,
  MemberPortalAccountSummary,
  MemberPortalAccountEntriesResponse,
  MemberPortalPackBalance,
  MemberPortalExpenseListResponse,
  MemberPortalDepositRequest,
  MemberPortalDepositResponse,
} from '../types'

import type { FiscalYear } from '../../banque/api'

// ── Fiscal Years ──────────────────────────────────────────────────────────────

async function fetchPortalFiscalYears() {
  const { data } = await portalApiClient.get<FiscalYear[]>('/api/v1/member-portal/fiscal-years')
  return data
}

export function useMemberPortalFiscalYearsQuery(enabled = true) {
  return useQuery({
    queryKey: ['member-portal', 'fiscal-years'],
    queryFn: fetchPortalFiscalYears,
    enabled,
  })
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function loginRequest(memberIdentifier: string, password: string) {
  const { data } = await portalApiClient.post<MemberPortalLoginResponse>(
    '/api/v1/member-portal/login',
    { member_identifier: memberIdentifier, password },
  )
  return data
}

export function useMemberPortalLogin() {
  return useMutation({
    mutationFn: ({ memberIdentifier, password }: { memberIdentifier: string; password: string }) =>
      loginRequest(memberIdentifier, password),
    onSuccess: (data) => {
      setPortalToken(data.access_token)
      setPortalProfile(data.member)
    },
  })
}

export function useMemberPortalLogout() {
  return () => {
    clearPortalToken()
    window.location.href = '/member-portal/login'
  }
}

// ── Flights ───────────────────────────────────────────────────────────────────

async function fetchFlights(limit?: number, offset?: number) {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set('limit', String(limit))
  if (offset !== undefined) params.set('offset', String(offset))
  const { data } = await portalApiClient.get<MemberPortalFlightListResponse>(
    `/api/v1/member-portal/flights?${params}`,
  )
  return data
}

export function useMemberPortalFlights(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['member-portal', 'flights', limit, offset],
    queryFn: () => fetchFlights(limit, offset),
  })
}

async function fetchFlightBilling(flightUuid: string) {
  const { data } = await portalApiClient.get<MemberPortalFlightBillingDetail>(
    `/api/v1/member-portal/flights/${flightUuid}/billing`,
  )
  return data
}

export function useMemberPortalFlightBilling(flightUuid: string | null) {
  return useQuery({
    queryKey: ['member-portal', 'flight-billing', flightUuid],
    queryFn: () => fetchFlightBilling(flightUuid!),
    enabled: !!flightUuid,
  })
}

// ── Account ───────────────────────────────────────────────────────────────────

async function fetchAccountSummary() {
  const { data } = await portalApiClient.get<MemberPortalAccountSummary>(
    '/api/v1/member-portal/account',
  )
  return data
}

export function useMemberPortalAccount() {
  return useQuery({
    queryKey: ['member-portal', 'account'],
    queryFn: fetchAccountSummary,
  })
}

async function fetchAccountEntries(limit?: number, offset?: number) {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set('limit', String(limit))
  if (offset !== undefined) params.set('offset', String(offset))
  const { data } = await portalApiClient.get<MemberPortalAccountEntriesResponse>(
    `/api/v1/member-portal/account/entries?${params}`,
  )
  return data
}

export function useMemberPortalAccountEntries(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['member-portal', 'account-entries', limit, offset],
    queryFn: () => fetchAccountEntries(limit, offset),
  })
}

async function fetchAccountPacks() {
  const { data } = await portalApiClient.get<MemberPortalPackBalance[]>(
    '/api/v1/member-portal/account/packs',
  )
  return data
}

export function useMemberPortalPacks() {
  return useQuery({
    queryKey: ['member-portal', 'packs'],
    queryFn: fetchAccountPacks,
  })
}

// ── Expenses ──────────────────────────────────────────────────────────────────

async function fetchExpenses() {
  const { data } = await portalApiClient.get<MemberPortalExpenseListResponse>(
    '/api/v1/member-portal/expenses',
  )
  return data
}

export function useMemberPortalExpenses() {
  return useQuery({
    queryKey: ['member-portal', 'expenses'],
    queryFn: fetchExpenses,
  })
}

async function declareExpenseRequest(amount: string, reason: string, receiptPhoto?: string) {
  const { data } = await portalApiClient.post('/api/v1/member-portal/expenses', {
    amount,
    reason,
    receipt_photo: receiptPhoto,
  })
  return data
}

export function useMemberPortalDeclareExpense() {
  return useMutation({
    mutationFn: ({ amount, reason, receiptPhoto }: { amount: string; reason: string; receiptPhoto?: string }) =>
      declareExpenseRequest(amount, reason, receiptPhoto),
  })
}

// ── Deposits ──────────────────────────────────────────────────────────────────

async function depositRequest(payload: MemberPortalDepositRequest) {
  const { data } = await portalApiClient.post<MemberPortalDepositResponse>(
    '/api/v1/member-portal/deposit',
    payload,
  )
  return data
}

export function useMemberPortalDeposit() {
  return useMutation({
    mutationFn: (payload: MemberPortalDepositRequest) => depositRequest(payload),
  })
}

// ── Tax Expenses ──────────────────────────────────────────────────────────────

async function fetchTaxExpenses() {
  const { data } = await portalApiClient.get('/api/v1/member-portal/tax-expenses')
  return data
}

export function useMemberPortalTaxExpenses() {
  return useQuery({
    queryKey: ['member-portal', 'tax-expenses'],
    queryFn: fetchTaxExpenses,
  })
}

// ── Logbook ───────────────────────────────────────────────────────────────────

async function fetchPortalLogbook(filters: LogbookFilters) {
  const { data } = await portalApiClient.get<LogbookResponse>('/api/v1/member-portal/logbook', {
    params: filters,
  })
  return data
}

export function useMemberPortalLogbookQuery(filters: LogbookFilters = {}, enabled = true) {
  return useQuery({
    queryKey: ['member-portal', 'logbook', filters],
    queryFn: () => fetchPortalLogbook(filters),
    enabled,
  })
}

// ── Account / Balance ─────────────────────────────────────────────────────────

async function fetchPortalAccountSummary(fiscalYearUuid?: string) {
  const { data } = await portalApiClient.get<AccountSummary>('/api/v1/member-portal/account', {
    params: fiscalYearUuid ? { fiscal_year_uuid: fiscalYearUuid } : {},
  })
  return data
}

export function useMemberPortalAccountSummaryQuery(fiscalYearUuid?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['member-portal', 'account-summary', fiscalYearUuid],
    queryFn: () => fetchPortalAccountSummary(fiscalYearUuid ?? undefined),
    enabled,
  })
}

async function fetchPortalAccountEntries(filters: { fiscalYearUuid?: string; state?: number; limit?: number; offset?: number }) {
  const params: Record<string, string | number> = {}
  if (filters.fiscalYearUuid) params.fiscal_year_uuid = filters.fiscalYearUuid
  if (filters.state !== undefined) params.state = filters.state
  if (filters.limit !== undefined) params.limit = filters.limit
  if (filters.offset !== undefined) params.offset = filters.offset

  const { data } = await portalApiClient.get<AccountEntriesResponse>('/api/v1/member-portal/account/entries', { params })
  return data
}

export function useMemberPortalAccountEntriesQuery(filters: { fiscalYearUuid?: string; state?: number; limit?: number; offset?: number } = {}, enabled = true) {
  return useQuery({
    queryKey: ['member-portal', 'account-entries', filters],
    queryFn: () => fetchPortalAccountEntries(filters),
    enabled,
  })
}

async function fetchPortalDeposit(payload: DepositRequest) {
  const { data } = await portalApiClient.post<DepositResponse>('/api/v1/member-portal/deposit', payload)
  return data
}

export function useMemberPortalDepositMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: DepositRequest) => fetchPortalDeposit(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['member-portal', 'account-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['member-portal', 'account-entries'] })
    },
  })
}

// ── Password change ───────────────────────────────────────────────────────────

export function useChangePortalPasswordMutation() {
  return useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      await portalApiClient.patch('/api/v1/member-portal/password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
    },
  })
}

export type { LogbookFilters } from '../../members/types'
