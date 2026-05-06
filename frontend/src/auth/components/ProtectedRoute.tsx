import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { getAuthToken } from '../../api/client'
import { useCurrentUser } from '../api/useAuth'
import { useAuthStore } from '../store/authStore'

export function ProtectedRoute() {
  const { t } = useTranslation('common')
  const location = useLocation()
  const storedToken = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const token = storedToken ?? getAuthToken()

  const { isLoading } = useCurrentUser(Boolean(token && !user))

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-600">{t('auth.sessionVerification')}</div>
  }

  return <Outlet />
}
