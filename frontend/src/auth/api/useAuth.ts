import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useAuthStore } from '../store/authStore'
import type { LoginRequest } from '../types'
import { loginRequest, logoutRequest, meRequest } from './authApi'

export function useLogin() {
  const setSession = useAuthStore((state) => state.setSession)

  return useMutation({
    mutationFn: (payload: LoginRequest) => loginRequest(payload),
    onSuccess: (data) => {
      setSession({
        token: data.access_token,
        expiresAt: data.expires_at,
        user: data.user,
      })
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
        role: data.role,
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
