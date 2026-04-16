import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { AuthUser } from '../types'

interface AuthState {
  token: string | null
  expiresAt: string | null
  user: AuthUser | null
  setSession: (session: { token: string; expiresAt: string; user: AuthUser }) => void
  setUser: (user: AuthUser) => void
  clearSession: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      expiresAt: null,
      user: null,
      setSession: ({ token, expiresAt, user }) => {
        set({ token, expiresAt, user })
      },
      setUser: (user) => {
        set({ user })
      },
      clearSession: () => {
        set({ token: null, expiresAt: null, user: null })
      },
    }),
    {
      name: 'club-erp-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        token: state.token,
        expiresAt: state.expiresAt,
        user: state.user,
      }),
    },
  ),
)
