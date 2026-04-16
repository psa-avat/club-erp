import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useCurrentUser } from '../api/useAuth'
import { useAuthStore } from '../store/authStore'

export function ProtectedRoute() {
  const location = useLocation()
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)

  const { isLoading } = useCurrentUser(Boolean(token && !user))

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-slate-600">
        Verification of session...
      </div>
    )
  }

  return <Outlet />
}
