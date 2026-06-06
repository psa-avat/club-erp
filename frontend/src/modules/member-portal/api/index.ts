import { useQuery, useMutation } from '@tanstack/react-query'
import { portalApiClient, setPortalToken, setPortalProfile, clearPortalToken, getPortalToken, getPortalProfile, isPortalAuthenticated } from './client'
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

// ── Login ─────────────────────────────────────────────────────────────────────

async function loginRequest(memberIdentifier: string, token: string) {
  const { data } = await portalApiClient.post<MemberPortalLoginResponse>(
    '/api/v1/member-portal/login',
    { member_identifier: memberIdentifier, expense_access_token: token },
  )
  return data
}

export function useMemberPortalLogin() {
  return useMutation({
    mutationFn: ({ memberIdentifier, expenseToken }: { memberIdentifier: string; expenseToken: string }) =>
      loginRequest(memberIdentifier, expenseToken),
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
