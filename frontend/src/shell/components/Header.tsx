import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useCurrentUser, useLogout } from '../../auth/api/useAuth'
import { useAuthStore } from '../../auth/store/authStore'
import { Button } from '../../components/ui/button'

type HeaderProps = {
  onOpenMobileMenu: () => void
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
  const { i18n, t } = useTranslation('common')
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const logoutMutation = useLogout()

  useCurrentUser(Boolean(token && !user))

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
            onChange={(event) => {
              void i18n.changeLanguage(event.target.value)
            }}
          >
            <option value="fr">FR</option>
            <option value="en">EN</option>
          </select>

          {token ? (
            <>
              <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 md:flex">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {initials}
                </div>
                <div className="pr-2 leading-tight">
                  <p className="text-xs font-semibold text-slate-800">
                    {user?.prenom} {user?.nom}
                  </p>
                  <p className="text-xs text-slate-500">{user?.email ?? t('auth.activeSession')}</p>
                </div>
              </div>
              <Button
                disabled={logoutMutation.isPending}
                size="sm"
                variant="secondary"
                onClick={() => logoutMutation.mutate()}
              >
                {logoutMutation.isPending ? t('auth.logoutLoading') : t('auth.logout')}
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link to="/login">{t('auth.login')}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
