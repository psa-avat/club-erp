import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '../../auth/store/authStore'
import { shellNavItems } from '../navigation'

export function Sidebar() {
  const { t } = useTranslation('common')
  const capabilities = useAuthStore((state) => state.user?.capabilities ?? [])

  const visibleLinks = shellNavItems.filter((link) => {
    if (!link.requiredCapability) {
      return true
    }

    return capabilities.includes(link.requiredCapability)
  })

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block">
      <nav className="space-y-1 p-3">
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
          >
            {t(link.labelKey)}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
