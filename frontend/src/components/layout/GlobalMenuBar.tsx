import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { useCurrentUser, useLogout } from '../../auth/api/useAuth'
import { useAuthStore } from '../../auth/store/authStore'
import { Button } from '../ui/button'

export function GlobalMenuBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const logoutMutation = useLogout()

  useCurrentUser(Boolean(token && !user))

  async function handleLogout() {
    await logoutMutation.mutateAsync()
    navigate('/', { replace: true })
  }

  function handleLogin() {
    navigate('/login', {
      state: {
        from: location.pathname,
      },
    })
  }

  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join('').toUpperCase()

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-6">
          <Link className="text-lg font-semibold text-slate-900" to="/">
            Club ERP
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            <NavItem to="/">Accueil</NavItem>
            <NavItem to="/pricing">Tarification</NavItem>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {token ? (
            <>
              <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 md:flex">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {initials || 'U'}
                </div>
                <div className="pr-2 leading-tight">
                  <p className="text-xs font-semibold text-slate-800">
                    {user?.prenom} {user?.nom}
                  </p>
                  <p className="text-xs text-slate-500">{user?.email ?? 'Session active'}</p>
                </div>
              </div>
              <Button
                disabled={logoutMutation.isPending}
                size="sm"
                variant="secondary"
                onClick={handleLogout}
              >
                {logoutMutation.isPending ? 'Deconnexion...' : 'Se deconnecter'}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleLogin}>
              Se connecter
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}

function NavItem({ children, to }: { children: string; to: string }) {
  return (
    <NavLink
      className={({ isActive }) =>
        [
          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
        ].join(' ')
      }
      end={to === '/'}
      to={to}
    >
      {children}
    </NavLink>
  )
}
