import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '../../auth/store/authStore'
import { shellNavItems } from '../navigation'

type MobileDrawerProps = {
  open: boolean
  onClose: () => void
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const { t } = useTranslation('common')
  const capabilities = useAuthStore((state) => state.user?.capabilities ?? [])

  if (!open) {
    return null
  }

  const visibleLinks = shellNavItems.filter((link) => {
    if (!link.requiredCapability) {
      return true
    }

    return capabilities.includes(link.requiredCapability)
  })

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 md:hidden" role="dialog">
      <div className="h-full w-72 bg-white p-3 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3">
          <p className="text-sm font-semibold text-slate-900">{t('nav.modules')}</p>
          <button
            aria-label={t('nav.closeMenu')}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700"
            type="button"
            onClick={onClose}
          >
            {t('nav.closeMenu')}
          </button>
        </div>

        <nav className="space-y-1">
          {visibleLinks.map((link) => (
            <NavLink
              key={link.to}
              className={({ isActive }) =>
                [
                  'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
              end={link.to === '/dashboard'}
              to={link.to}
              onClick={onClose}
            >
              {t(link.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
