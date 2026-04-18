import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { useCurrentUser, useLogout } from '../../auth/api/useAuth'
import { ChangePasswordDialog } from '../../auth/components/ChangePasswordDialog'
import { useAuthStore } from '../../auth/store/authStore'
import { Button } from '../ui/button'

export function GlobalMenuBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const logoutMutation = useLogout()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const meQuery = useCurrentUser(Boolean(token))
  const canChangePassword = meQuery.data?.can_change_password !== false

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  async function handleLogout() {
    setMenuOpen(false)
    await logoutMutation.mutateAsync()
    navigate('/', { replace: true })
  }

  function handleLogin() {
    navigate('/login', { state: { from: location.pathname } })
  }

  function handleChangePassword() {
    setMenuOpen(false)
    setShowChangePassword(true)
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
            <div className="relative" ref={menuRef}>
              {/* Avatar trigger */}
              <button
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {initials || 'U'}
                </div>
                <div className="hidden pr-1 leading-tight text-left md:block">
                  <p className="text-xs font-semibold text-slate-800">
                    {user?.prenom} {user?.nom}
                  </p>
                  <p className="text-xs text-slate-500">{user?.email ?? 'Session active'}</p>
                </div>
                <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Dropdown panel */}
              {menuOpen ? (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg z-50">
                  {/* User info header */}
                  <div className="border-b border-slate-100 px-4 py-2">
                    <p className="text-sm font-semibold text-slate-800">{user?.prenom} {user?.nom}</p>
                    <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                  </div>

                  {canChangePassword ? (
                    <button
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      type="button"
                      onClick={handleChangePassword}
                    >
                      <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Changer le mot de passe
                    </button>
                  ) : null}

                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    disabled={logoutMutation.isPending}
                    type="button"
                    onClick={() => { void handleLogout() }}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {logoutMutation.isPending ? 'Déconnexion...' : 'Se déconnecter'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Button size="sm" onClick={handleLogin}>
              Se connecter
            </Button>
          )}
        </div>
      </div>

      {showChangePassword ? (
        <ChangePasswordDialog onClose={() => setShowChangePassword(false)} />
      ) : null}
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

