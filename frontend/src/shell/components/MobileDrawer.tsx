import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '../../auth/store/authStore'
import { shellNavItems } from '../navigation'

const linkBase = 'block rounded-shape-sm px-3 py-2 text-sm font-medium transition-colors'
const linkActive = 'bg-primary text-on-primary'
const linkIdle = 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'

type MobileDrawerProps = {
  open: boolean
  onClose: () => void
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const { t } = useTranslation('common')
  const capabilities = useAuthStore((state) => state.user?.capabilities ?? [])
  const location = useLocation()

  if (!open) return null

  const visibleLinks = shellNavItems
    .map((link) => ({
      ...link,
      children: (link.children ?? []).filter(
        (child) => !child.requiredCapability || capabilities.includes(child.requiredCapability),
      ),
    }))
    .filter(
      (link) =>
        !link.requiredCapability ||
        capabilities.includes(link.requiredCapability) ||
        (link.children?.length ?? 0) > 0,
    )

  return (
    <div
      className="fixed inset-0 z-50 bg-primary/20 md:hidden"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="h-full w-72 bg-surface p-3 shadow-surface-4">
        <div className="mb-3 flex items-center justify-between border-b border-outline-variant pb-3">
          <p className="text-sm font-semibold text-on-surface">{t('nav.modules')}</p>
          <button
            aria-label={t('nav.closeMenu')}
            className="rounded-shape-xs border border-outline px-2 py-1 text-sm text-on-surface-variant hover:bg-surface-container"
            type="button"
            onClick={onClose}
          >
            {t('nav.closeMenu')}
          </button>
        </div>

        <nav className="space-y-0.5">
          {visibleLinks.map((link) => {
            const isGroupActive =
              link.to === '/dashboard'
                ? location.pathname === '/dashboard'
                : location.pathname === link.to ||
                  location.pathname.startsWith(link.to + '/') ||
                  (link.children ?? []).some(
                    (child) =>
                      location.pathname === child.to || location.pathname.startsWith(child.to + '/'),
                  )

            if (link.children && link.children.length > 0 && isGroupActive) {
              return (
                <div key={link.to} className="space-y-0.5">
                  <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                    {t(link.labelKey)}
                  </p>
                  <div className="space-y-0.5 border-l-2 border-outline-variant ml-2 pl-1">
                    {link.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        end={child.to === link.to}
                        className={({ isActive }) =>
                          [linkBase, isActive ? linkActive : linkIdle].join(' ')
                        }
                        onClick={onClose}
                      >
                        {t(child.labelKey)}
                      </NavLink>
                    ))}
                  </div>
                </div>
              )
            }

            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/dashboard'}
                className={({ isActive }) =>
                  [linkBase, isActive ? linkActive : linkIdle].join(' ')
                }
                onClick={onClose}
              >
                {t(link.labelKey)}
              </NavLink>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
