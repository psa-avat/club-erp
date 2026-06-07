import { Outlet, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getPortalProfile } from '../api/client'
import { useMemberPortalLogout } from '../api'
import type { MemberPortalProfile } from '../types'

export function PortalShell() {
  const navigate = useNavigate()
  const logout = useMemberPortalLogout()
  const profile = getPortalProfile<MemberPortalProfile>()
  const { i18n, t } = useTranslation('common')

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Header — member name + language + logout */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-slate-800">Club ERP</span>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              {t('portal.portalBadge')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {profile && (
              <span className="text-sm text-slate-600">
                {profile.first_name} {profile.last_name}
              </span>
            )}
            <select
              aria-label="Langue / Language"
              value={i18n.language}
              onChange={(event) => { void i18n.changeLanguage(event.target.value) }}
              className="h-8 rounded border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="fr">FR</option>
              <option value="en">EN</option>
            </select>
            <button
              type="button"
              onClick={() => { logout(); navigate('/member-portal/login') }}
              className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              {t('portal.logout')}
            </button>
          </div>
        </div>
      </header>

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
