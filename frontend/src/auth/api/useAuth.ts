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
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useAuthStore } from '../store/authStore'
import type { ChangePasswordRequest, LoginRequest, VerifyPinRequest } from '../types'
import { changePasswordRequest, loginRequest, logoutRequest, meRequest, verifyPinRequest } from './authApi'

export function useLogin() {
  const setSession = useAuthStore((state) => state.setSession)
  const setPreAuthSession = useAuthStore((state) => state.setPreAuthSession)

  return useMutation({
    mutationFn: (payload: LoginRequest) => loginRequest(payload),
    onSuccess: (data) => {
      if (data.auth_state === 'full_auth' && data.access_token) {
        setSession({
          token: data.access_token,
          expiresAt: data.expires_at,
          user: data.user ?? null,
        })
      } else if (data.auth_state === 'pre_auth' && data.pre_auth_token) {
        setPreAuthSession({
          preAuthToken: data.pre_auth_token,
          expiresAt: data.expires_at,
        })
      }
    },
  })
}

export function useVerifyPin() {
  const setSession = useAuthStore((state) => state.setSession)

  return useMutation({
    mutationFn: (payload: VerifyPinRequest) => verifyPinRequest(payload),
    onSuccess: (data) => {
      if (data.auth_state === 'full_auth' && data.access_token) {
        setSession({
          token: data.access_token,
          expiresAt: data.expires_at,
          user: data.user ?? null,
        })
      }
    },
  })
}

export function useLogout() {
  const clearSession = useAuthStore((state) => state.clearSession)

  return useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      clearSession()
    },
  })
}

export function useCurrentUser(enabled: boolean) {
  const setUser = useAuthStore((state) => state.setUser)
  const clearSession = useAuthStore((state) => state.clearSession)

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: meRequest,
    enabled,
    retry: false,
  })

  useEffect(() => {
    if (query.data) {
      const data = query.data
      setUser({
        id: data.id,
        email: data.email,
        prenom: data.prenom,
        nom: data.nom,
        roles: data.roles,
        capabilities: data.capabilities,
      })
    }
  }, [query.data, setUser])

  useEffect(() => {
    if (query.error) {
      clearSession()
    }
  }, [query.error, clearSession])

  return query
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: ChangePasswordRequest) => changePasswordRequest(payload),
  })
}
