import { apiClient } from '../../api/client'
import type { LoginRequest, LoginResponse, MeResponse } from '../types'

export async function loginRequest(payload: LoginRequest): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/api/v1/auth/login', payload)
  return data
}

export async function logoutRequest(): Promise<void> {
  await apiClient.post('/api/v1/auth/logout')
}

export async function meRequest(): Promise<MeResponse> {
  const { data } = await apiClient.get<MeResponse>('/api/v1/auth/me')
  return data
}
