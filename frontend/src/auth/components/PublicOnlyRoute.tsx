import { Navigate, Outlet } from 'react-router-dom'

import { getAuthToken } from '../../api/client'
import { useAuthStore } from '../store/authStore'

export function PublicOnlyRoute() {
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const storedToken = useAuthStore((state) => state.token)
  const token = storedToken ?? getAuthToken()

  if (!hasHydrated) {
    return null
  }

  if (token) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
