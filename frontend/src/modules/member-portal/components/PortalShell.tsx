import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useMemberPortalLogout, getPortalProfile } from '../api/client'
import type { MemberPortalProfile } from '../types'

export function PortalShell() {
  const navigate = useNavigate()
  const logout = useMemberPortalLogout()
  const profile = getPortalProfile<MemberPortalProfile>()

  const navItems = [
    { to: '/member-portal/dashboard', label: 'Tableau de bord', icon: '📊' },
    { to: '/member-portal/flights', label: 'Mes vols', icon: '✈️' },
    { to: '/member-portal/account', label: 'Compte', icon: '💰' },
    { to: '/member-portal/expenses', label: 'Dépenses', icon: '🧾' },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-slate-800">Club ERP</span>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Portail membre
            </span>
          </div>
          <div className="flex items-center gap-3">
            {profile && (
              <span className="text-sm text-slate-600">
                {profile.first_name} {profile.last_name}
              </span>
            )}
            <button
              type="button"
              onClick={() => { logout(); navigate('/member-portal/login') }}
              className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl gap-1 px-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-b-2 border-blue-600 text-blue-700'
                    : 'text-slate-500 hover:text-slate-700'
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
        Club ERP — Portail membre
      </footer>
    </div>
  )
}
