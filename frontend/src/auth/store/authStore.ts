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
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { AuthUser } from '../types'

interface AuthState {
  hasHydrated: boolean
  authState: 'logged_out' | 'pre_auth' | 'full_auth'
  token: string | null
  preAuthToken: string | null
  expiresAt: string | null
  user: AuthUser | null
  setHasHydrated: (value: boolean) => void
  setPreAuthSession: (session: { preAuthToken: string; expiresAt: string }) => void
  setSession: (session: { token: string; expiresAt: string; user?: AuthUser | null }) => void
  setUser: (user: AuthUser) => void
  clearSession: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      authState: 'logged_out',
      token: null,
      preAuthToken: null,
      expiresAt: null,
      user: null,
      setHasHydrated: (value) => {
        set({ hasHydrated: value })
      },
      setPreAuthSession: ({ preAuthToken, expiresAt }) => {
        set({ authState: 'pre_auth', preAuthToken, expiresAt, token: null, user: null })
      },
      setSession: ({ token, expiresAt, user }) => {
        set({ authState: 'full_auth', token, preAuthToken: null, expiresAt, user: user ?? null })
      },
      setUser: (user) => {
        set({ user })
      },
      clearSession: () => {
        set({ authState: 'logged_out', token: null, preAuthToken: null, expiresAt: null, user: null })
      },
    }),
    {
      name: 'club-erp-auth',
      storage: createJSONStorage(() => sessionStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AuthState> | undefined
        if (!persisted) {
          return currentState
        }

        const currentHasSession = Boolean(currentState.token || currentState.preAuthToken)
        const persistedHasSession = Boolean(persisted.token || persisted.preAuthToken)

        // Avoid race where late hydration restores an older logged-out snapshot
        // and drops a session that was just set during login.
        if (currentHasSession && !persistedHasSession) {
          return currentState
        }

        return {
          ...currentState,
          ...persisted,
        }
      },
      partialize: (state) => ({
        authState: state.authState,
        token: state.token,
        preAuthToken: state.preAuthToken,
        expiresAt: state.expiresAt,
        user: state.user,
      }),
    },
  ),
)
