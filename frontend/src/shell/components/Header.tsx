import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useCurrentUser, useLogout } from '../../auth/api/useAuth'
import { ChangePasswordDialog } from '../../auth/components/ChangePasswordDialog'
import { useAuthStore } from '../../auth/store/authStore'
import { Button } from '../../components/ui/button'

type HeaderProps = {
  onOpenMobileMenu: () => void
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
  const navigate = useNavigate()
  const { i18n, t } = useTranslation('common')
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const logoutMutation = useLogout()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const meQuery = useCurrentUser(Boolean(token))
  const canChangePassword = meQuery.data?.can_change_password !== false

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

  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join('').toUpperCase() || 'U'

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <button
            aria-label={t('nav.openMenu')}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 md:hidden"
            type="button"
            onClick={onOpenMobileMenu}
          >
            {t('nav.openMenu')}
          </button>
          <Link className="text-lg font-semibold text-slate-900" to="/dashboard">
            {t('app.name')}
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <select
            aria-label="Language"
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
            value={i18n.language}
            onChange={(event) => { void i18n.changeLanguage(event.target.value) }}
          >
            <option value="fr">FR</option>
            <option value="en">EN</option>
          </select>

          {token ? (
            <div className="relative" ref={menuRef}>
              {/* Avatar trigger */}
              <button
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {initials}
                </div>
                <div className="hidden pr-1 text-left leading-tight md:block">
                  <p className="text-xs font-semibold text-slate-800">{user?.prenom} {user?.nom}</p>
                  <p className="text-xs text-slate-500">{user?.email ?? t('auth.activeSession')}</p>
                </div>
                <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Dropdown */}
              {menuOpen ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-slate-100 px-4 py-2">
                    <p className="text-sm font-semibold text-slate-800">{user?.prenom} {user?.nom}</p>
                    <p className="truncate text-xs text-slate-500">{user?.email}</p>
                  </div>

                  {canChangePassword ? (
                    <button
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      type="button"
                      onClick={() => { setMenuOpen(false); setShowChangePassword(true) }}
                    >
                      <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {t('auth.changePassword.title')}
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
                    {logoutMutation.isPending ? t('auth.logoutLoading') : t('auth.logout')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Button size="sm" onClick={() => navigate('/login')}>
              {t('auth.login')}
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

