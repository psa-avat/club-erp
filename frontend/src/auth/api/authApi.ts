/*   
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - frontend API pour l'authentification
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
import { apiClient } from '../../api/client'
import type { LoginRequest, LoginResponse, MeResponse, VerifyPinRequest } from '../types'

export async function loginRequest(payload: LoginRequest): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/api/v1/auth/login', payload)
  return data
}

export async function logoutRequest(): Promise<void> {
  await apiClient.post('/api/v1/auth/logout')
}

export async function verifyPinRequest(payload: VerifyPinRequest): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/api/v1/auth/verify-pin', payload)
  return data
}

export async function meRequest(): Promise<MeResponse> {
  const { data } = await apiClient.get<MeResponse>('/api/v1/auth/me')
  return data
}
